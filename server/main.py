from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from google import genai
from google.genai import errors
from google.genai import types
import base64
import hashlib
from typing import Optional, Dict, Set

app = FastAPI(title="PromptPilot API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── WebSocket channel manager ─────────────────────────────────────────────────

class ChannelManager:
    def __init__(self):
        self.channels: Dict[str, Set[WebSocket]] = {}

    async def connect(self, channel_id: str, websocket: WebSocket):
        await websocket.accept()
        if channel_id not in self.channels:
            self.channels[channel_id] = set()
        self.channels[channel_id].add(websocket)
        print(f"Client connected to channel {channel_id[:8]}... Total: {len(self.channels[channel_id])}")

    def disconnect(self, channel_id: str, websocket: WebSocket):
        if channel_id in self.channels:
            self.channels[channel_id].discard(websocket)
            if not self.channels[channel_id]:
                del self.channels[channel_id]
        print(f"Client disconnected from channel {channel_id[:8]}...")

    def has_clients(self, channel_id: str) -> bool:
        return channel_id in self.channels and len(self.channels[channel_id]) > 0

    async def broadcast(self, channel_id: str, message: dict) -> bool:
        if channel_id not in self.channels:
            return False
        disconnected = set()
        sent = False
        for websocket in self.channels[channel_id]:
            try:
                await websocket.send_json(message)
                sent = True
            except Exception:
                disconnected.add(websocket)
        for ws in disconnected:
            self.channels[channel_id].discard(ws)
        return sent

manager = ChannelManager()

MODELS = [
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash",
    "gemini-flash-latest",
]

RECOVERABLE_ERROR_CODES = ["500", "502", "503", "UNAVAILABLE", "INTERNAL"]

# ── System Prompts ────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """
You are an expert prompt engineer who specializes in AI coding agents.

Your job is to take a rough, casual, or vague instruction from a developer
and rewrite it into a clear, structured, well-scoped prompt that an AI
coding agent (like Copilot or Cursor) can execute accurately on the first try.

You will be given:
- The project structure
- Relevant config files
- The file the developer is currently working on
- Relevant history of previous prompts and refined outputs for this file
- Any images, documents, or files the developer has attached for context

Use all of this context to make the rewritten prompt specific and accurate
to their actual codebase and current working session.

If images are provided, analyze them carefully and incorporate visual details
into the refined prompt. If documents are provided, extract the key requirements
and include them in the refined prompt.

Rules:
- Be specific about what needs to be built or changed
- Include relevant constraints (language, framework, patterns)
- Scope the task clearly - not too broad, not too narrow
- Preserve the original intent exactly
- Never ask clarifying questions - make reasonable assumptions and state them explicitly
- Output only the rewritten prompt, nothing else
"""

PROJECT_PROMPT = """
You are an expert prompt engineer specializing in project planning and technical specifications.

Your job is to take a rough project idea and transform it into a comprehensive, detailed prompt
that an AI agent can use to produce exactly what the user needs.

For project prompts:
- Identify all the deliverables mentioned or implied
- Specify technical requirements, architecture, and constraints
- Include format requirements for any documents requested (PRDs, specs, diagrams)
- Break down complex projects into clear, ordered components
- Specify tech stack, tools, and frameworks where relevant
- Include success criteria and acceptance conditions
- Make assumptions explicit and reasonable
- If images or documents are attached, extract requirements from them and incorporate them
- Output only the rewritten prompt, nothing else
"""

GENERAL_PROMPT = """
You are an expert prompt engineer.

Your job is to take a rough, casual question or request and rewrite it into a clear,
detailed prompt that will get the most accurate, useful, and comprehensive response from an AI.

For general prompts:
- Add specificity and context that improves the answer quality
- Specify the desired format, depth, and style of response
- Include relevant constraints or requirements
- Make the intent completely unambiguous
- If the question is about a technical topic, specify the level of detail needed
- If images or documents are attached, incorporate their content into the prompt
- Output only the rewritten prompt, nothing else
"""

CLASSIFICATION_PROMPT = """
You are a prompt classifier. Given a developer's instruction, classify it into one of three types:

1. "coding" - modifying, fixing, or building on existing code in a project
2. "project" - creating something new from scratch that needs planning, architecture, or documents like PRDs
3. "general" - questions, explanations, research, or tasks unrelated to a specific codebase

Return only one word: coding, project, or general.
"""

# ── Request Models ────────────────────────────────────────────────────────────

class Attachment(BaseModel):
    name: str
    mimeType: str
    data: str

class EngineerRequest(BaseModel):
    user_prompt: str
    api_key: str
    context: Optional[str] = ""
    history: Optional[str] = ""
    attachments: Optional[list[Attachment]] = []
    prompt_type: Optional[str] = None

class SendToChannelRequest(BaseModel):
    channel_id: str
    prompt: str

# ── Core Logic ────────────────────────────────────────────────────────────────

def classify_prompt(user_input: str, client) -> str:
    for model in MODELS:
        try:
            response = client.models.generate_content(
                model=model,
                config={"system_instruction": CLASSIFICATION_PROMPT},
                contents=user_input
            )
            result = response.text.strip().lower()
            if result in ["coding", "project", "general"]:
                return result
            return "coding"
        except Exception:
            continue
    return "coding"


def call_gemini_api(model_name, user_input, context, attachments, system_prompt, client):
    full_input = f"{context}\n\n--- User Instruction ---\n{user_input}" if context.strip() else user_input
    content_parts = [full_input]

    for attachment in attachments:
        try:
            file_data = base64.b64decode(attachment.data)
            content_parts.append(
                types.Part.from_bytes(data=file_data, mime_type=attachment.mimeType)
            )
        except Exception as e:
            print(f"Warning: Could not process attachment {attachment.name}: {e}")

    response = client.models.generate_content(
        model=model_name,
        config={"system_instruction": system_prompt},
        contents=content_parts
    )

    if not response.text or not response.text.strip():
        raise ValueError(f"Model {model_name} returned an empty response.")

    return response.text


def rewrite_prompt_logic(user_input, context, attachments, client, prompt_type=None):
    if not prompt_type:
        prompt_type = classify_prompt(user_input, client)

    if prompt_type == "coding":
        system = SYSTEM_PROMPT
        active_context = context
    elif prompt_type == "project":
        system = PROJECT_PROMPT
        active_context = ""
    else:
        system = GENERAL_PROMPT
        active_context = ""

    last_error = None

    for model in MODELS:
        try:
            refined = call_gemini_api(model, user_input, active_context, attachments, system, client)
            return refined, prompt_type
        except errors.ClientError as e:
            last_error = e
            print(f"Model {model} failed: {e}")
            continue
        except Exception as e:
            if any(code in str(e) for code in RECOVERABLE_ERROR_CODES):
                last_error = e
                continue
            raise e

    raise Exception(f"All models failed. Last error: {last_error}")


# ── API Routes ────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return JSONResponse(
        content={"status": "ok", "version": "1.0.0"},
        headers={"Content-Type": "application/json; charset=utf-8"}
    )


@app.get("/health")
def health():
    return JSONResponse(
        content={"status": "healthy"},
        headers={"Content-Type": "application/json; charset=utf-8"}
    )


@app.get("/channel/{api_key}")
def get_channel_id(api_key: str):
    channel_id = hashlib.sha256(api_key.encode()).hexdigest()
    return JSONResponse(
        content={"channel_id": channel_id},
        headers={"Content-Type": "application/json; charset=utf-8"}
    )


@app.post("/engineer")
async def engineer_prompt(request: EngineerRequest):
    if not request.user_prompt.strip():
        raise HTTPException(status_code=400, detail="user_prompt cannot be empty")
    if not request.api_key.strip():
        raise HTTPException(status_code=400, detail="api_key cannot be empty")

    try:
        client = genai.Client(api_key=request.api_key)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid API key: {e}")

    context_parts = []
    if request.history:
        context_parts.append(f"--- Relevant Session History ---\n{request.history}")
    if request.context:
        context_parts.append(request.context)

    full_context = "\n\n".join(context_parts)

    try:
        refined, prompt_type = rewrite_prompt_logic(
            user_input=request.user_prompt,
            context=full_context,
            attachments=request.attachments or [],
            client=client,
            prompt_type=request.prompt_type
        )
        # Use JSONResponse with explicit UTF-8 to fix latin-1 encoding errors
        return JSONResponse(
            content={
                "refined_prompt": refined,
                "prompt_type": prompt_type,
                "status": "success"
            },
            headers={"Content-Type": "application/json; charset=utf-8"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.websocket("/ws/{channel_id}")
async def websocket_endpoint(websocket: WebSocket, channel_id: str):
    await manager.connect(channel_id, websocket)
    try:
        while True:
            data = await websocket.receive_text()
            await websocket.send_json({"type": "ack"})
    except WebSocketDisconnect:
        manager.disconnect(channel_id, websocket)


@app.post("/send")
async def send_to_channel(request: SendToChannelRequest):
    # Handle ping — just check if clients are connected, don't broadcast
    if request.prompt == "__ping__":
        has_clients = manager.has_clients(request.channel_id)
        return JSONResponse(
            content={"status": "sent" if has_clients else "no_clients"},
            headers={"Content-Type": "application/json; charset=utf-8"}
        )

    # Real prompt — broadcast to browser extension
    success = await manager.broadcast(
        request.channel_id,
        {"type": "prompt", "prompt": request.prompt}
    )

    return JSONResponse(
        content={"status": "sent" if success else "no_clients"},
        headers={"Content-Type": "application/json; charset=utf-8"}
    )