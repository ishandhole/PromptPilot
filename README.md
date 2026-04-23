# ⚡ PromptPilot

**AI-powered prompt engineering layer for IDE coding agents.**

PromptPilot sits between you and your AI coding agent. You type a rough, 
casual instruction — PromptPilot rewrites it into a precise, well-structured 
prompt and sends it directly to Claude, ChatGPT, Gemini, Copilot, or Cursor 
with one click.

![PromptPilot Demo](https://github.com/ishandhole/PromptPilot/raw/main/assets/demo.png)

---

## Why PromptPilot

AI coding agents are only as good as the prompts they receive. Most developers 
type quick, vague instructions and get mediocre results. PromptPilot fixes this 
automatically — it reads your codebase, understands what you are working on, 
and rewrites your instruction into something an AI agent can execute perfectly 
on the first try.

**Before PromptPilot:**

"fix the auth bug" 

**After PromptPilot:**

Review the authentication flow in backend/auth.py. There is a bug where
JWT tokens are not being validated correctly on refresh. The verify_token()
function on line 47 is not checking the token expiry before returning the
user object. Fix this by adding expiry validation before the user lookup,
and ensure the refresh endpoint at /api/auth/refresh returns a 401 if
the token is expired rather than a 500. Use the existing error handling
patterns from backend/utils/errors.py.

---

## Features

- **Intelligent prompt rewriting** — transforms vague instructions into 
  detailed, actionable prompts
- **Smart classification** — automatically detects coding tasks, project 
  planning, and general questions and applies the right strategy for each
- **Codebase context** — reads your project structure and current file 
  automatically so prompts are specific to your actual code
- **Session memory** — remembers previous prompts per file so context 
  builds over time
- **File attachments** — upload images, PDFs, and Word docs for richer context
- **Browser integration** — auto-pastes prompts into Claude, ChatGPT, 
  Gemini, and Perplexity with one click
- **IDE integration** — sends prompts directly to Cursor, Copilot, and 
  other IDE agents
- **Works everywhere** — VS Code, Cursor, Windsurf, and all VS Code-based IDEs

---

## Installation

### Part 1 — VS Code Extension

Install from the VS Code Marketplace:

👉 [PromptPilot on VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=ishandhole.promptpilot-ishandhole)

Or search for **PromptPilot** inside VS Code in the Extensions panel.

### Part 2 — Browser Extension

The browser extension enables auto-pasting prompts directly into your 
browser AI tools. It links to the VS Code extension using your API key 
as a shared secret — no account needed.

**Step 1 — Download**

Download `promptpilot-browser-extension.zip` from the 
[latest release](https://github.com/ishandhole/PromptPilot/releases/latest).

**Step 2 — Unzip**

Unzip the file anywhere on your computer. You will get a folder 
called `browser-extension`.

**Step 3 — Open Chrome Extensions**

chrome://extensions

**Step 4 — Enable Developer Mode**

Toggle on **Developer mode** in the top right corner.

**Step 5 — Load the Extension**

Click **Load unpacked** and select the `browser-extension` folder.

The PromptPilot icon will appear in your browser toolbar.

**Step 6 — Connect**

A setup page opens automatically. Enter your Gemini API key and 
click **Connect**. Use the same key you will enter in VS Code.

---

## Setup

### Getting a Gemini API Key

PromptPilot uses Google Gemini to engineer your prompts. The key is free 
and requires no credit card.

1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Sign in with your Google account
3. Click **Get API key** → **Create API key**
4. Copy the key — it starts with `AIza`

### Connecting VS Code

1. Click the ⚡ PromptPilot icon in the VS Code activity bar
2. Paste your Gemini API key and click **Save & Connect**

### Connecting the Browser Extension

1. Click the PromptPilot icon in your browser toolbar
2. If not already connected, click **Connect API Key**
3. Enter the same Gemini API key and click **Connect**

Once both are connected the VS Code sidebar will show 
**Browser extension connected** in green.

---

## How to Use

### Basic Usage

1. Open any project in VS Code
2. Click the ⚡ PromptPilot icon in the activity bar
3. Type your rough prompt in the **Your Prompt** box
4. Click **Engineer Prompt**
5. Review the refined prompt
6. Choose how to send it:
   - **Browser Agent** — auto-pastes into Claude/ChatGPT/Gemini/Perplexity
   - **IDE Agent** — sends to Cursor, Copilot, or your IDE's built-in agent
   - **Copy** — copies to clipboard for manual pasting
   - **Edit** — edit the prompt before sending

### Using Attachments

You can attach files to give PromptPilot more context:

- **Images** — paste a UI screenshot and say "build this"
- **PDFs** — attach a spec document and say "implement this feature"
- **Word docs** — attach a requirements doc and say "make a project plan"
- **Text files** — attach any reference material

Click the upload area or drag and drop files. Up to 5 files at once.

### Prompt Types

PromptPilot automatically detects what kind of prompt you are writing 
and applies the right strategy:

| Type | Example | Strategy |
|------|---------|----------|
| Coding | "fix the auth bug" | Uses full codebase context |
| Project | "make an ML project with PRD" | Uses project planning template |
| General | "explain how transformers work" | Uses clarity and depth template |

---

## Supported Platforms

### IDEs
- VS Code
- Cursor
- Windsurf
- Any VS Code-based IDE

### Browser AI Tools
- Claude (claude.ai)
- ChatGPT (chatgpt.com)
- Gemini (gemini.google.com)
- Perplexity (perplexity.ai)

### IDE Agents
- Cursor Agent
- GitHub Copilot Chat
- Antigravity
- Any IDE chat that accepts clipboard paste

---

## Architecture

VS Code Extension (TypeScript)
├── Reads project files locally
├── Sends prompt + context to hosted API
└── Receives refined prompt
Hosted API (FastAPI on Render)
├── Classifies prompt type
├── Calls Gemini using user's API key
├── Returns refined prompt
└── WebSocket server for browser relay
Browser Extension (Chrome MV3)
├── Connects to hosted WebSocket channel
├── Receives refined prompts
└── Injects into Claude / ChatGPT / Gemini / Perplexity

**Privacy:** Your Gemini API key is stored locally and only sent to 
the Gemini API. It is hashed to create a channel ID for the WebSocket 
relay — the original key is never stored on any server.

---

## Project Structure

prompt-engineer/
├── extension/          # VS Code extension (TypeScript)
│   ├── src/
│   │   ├── extension.ts    # Activation, commands, server communication
│   │   └── panel.ts        # Sidebar webview UI
│   ├── icon.svg
│   ├── icon.png
│   └── package.json
├── server/             # Hosted FastAPI backend
│   ├── main.py             # API endpoints + WebSocket channels
│   ├── requirements.txt
│   └── Dockerfile
├── browser-extension/  # Chrome extension
│   ├── background.js       # WebSocket client, tab messaging
│   ├── content.js          # Prompt injection into AI sites
│   ├── setup.html/js       # One-time API key setup page
│   ├── popup.html/js       # Extension popup
│   └── manifest.json
└── backend/            # Local Python tool (for development)
├── main.py             # Full prompt engine with RAG
└── indexer.py          # ChromaDB indexer

---

## Troubleshooting

**First prompt takes a long time**

The server runs on a free hosting tier that sleeps after 15 minutes of 
inactivity. The extension wakes it up automatically when VS Code opens 
but the first wake can take up to 30 seconds. Subsequent requests are fast.

**Browser extension not connecting**

Make sure you used the same Gemini API key in both VS Code and the 
browser extension. The channel ID is derived from your key — if the 
keys are different the channel IDs will not match.

**Prompt not appearing in browser**

Make sure you have Claude, ChatGPT, Gemini, or Perplexity open in a 
tab. The extension searches all open tabs and injects into the first 
supported site it finds.

**Server error on first use**

If you see a server error on the very first request, wait 30 seconds 
and try again. The server was asleep and is waking up.

**Re-index Project button**

This button exists for completeness but project files are read 
automatically on every prompt — you do not need to click it.

---

## Contributing

Pull requests are welcome. For major changes please open an issue first.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -m 'Add your feature'`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

---

## Roadmap

- [ ] Chrome Web Store publication
- [ ] Firefox support
- [ ] More AI sites (Mistral, Grok, Kagi)
- [ ] Prompt history viewer
- [ ] Team sharing — share refined prompts with teammates
- [ ] Custom system prompts per project

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

## Author

**Ishan Dhole**
- GitHub: [@ishandhole](https://github.com/ishandhole)
- Marketplace: [PromptPilot](https://marketplace.visualstudio.com/items?itemName=ishandhole.promptpilot-ishandhole)

---

*Built with Gemini API, FastAPI, and VS Code Extension API*