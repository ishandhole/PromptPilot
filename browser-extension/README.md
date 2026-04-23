# PromptPilot Browser Extension

The PromptPilot browser extension is the second half of the PromptPilot system. 
It receives engineered prompts from the VS Code extension and automatically pastes 
them into whatever AI tool you have open in your browser — Claude, ChatGPT, Gemini, 
or Perplexity — with a single click.

---

## How It Works
No copy-pasting. No switching windows to type. Just one click.

---

## Installation

The browser extension is not yet on the Chrome Web Store so installation 
requires a one-time manual setup. It takes about 60 seconds.

### Step 1 — Download

Download `promptpilot-browser-extension.zip` from the 
[latest release](https://github.com/ishandhole/PromptPilot/releases/latest).

### Step 2 — Unzip

Unzip the file anywhere on your computer. You will get a folder 
called `browser-extension`.

### Step 3 — Open Chrome Extensions

Open Chrome (or Arc, Brave, or Edge) and go to: chrome://extensions/

### Step 4 — Enable Developer Mode

In the top right corner of the extensions page, toggle on **Developer mode**.

### Step 5 — Load the Extension

Click **Load unpacked** and select the `browser-extension` folder you unzipped.

The PromptPilot icon will appear in your browser toolbar.

### Step 6 — Connect Your API Key

A setup page will open automatically. Enter the same Gemini API key you 
entered in the VS Code extension and click **Connect**.

That is it. The extension is now linked to your VS Code PromptPilot.

---

## Supported AI Tools

| Tool | URL | Status |
|------|-----|--------|
| Claude | claude.ai | ✅ Supported |
| ChatGPT | chatgpt.com | ✅ Supported |
| Gemini | gemini.google.com | ✅ Supported |
| Perplexity | perplexity.ai | ✅ Supported |

---

## Usage

1. Open Claude, ChatGPT, Gemini, or Perplexity in your browser
2. Switch to VS Code and type your rough prompt in the PromptPilot sidebar
3. Click **Engineer Prompt** and wait for the refined prompt
4. Click **Browser Agent**
5. The prompt appears automatically in your browser AI tool

The browser extension will also bring the AI tab into focus automatically 
so you can see the prompt and hit send.

---

## Troubleshooting

**The prompt is not appearing in my browser**

Make sure you are on one of the supported sites listed above. The extension 
only injects into Claude, ChatGPT, Gemini, and Perplexity. If you have 
multiple tabs open, it will find the first supported one.

**The sidebar shows "Browser extension not connected"**

This means the extension either is not installed, or the API key in the 
browser extension does not match the one in VS Code. Open the extension 
popup, click Disconnect, then reconnect with the correct key.

**The first prompt takes a long time**

The PromptPilot server runs on a free hosting tier that sleeps after 15 
minutes of inactivity. The VS Code extension automatically wakes it up 
when you open VS Code, but if you have not used it for a while the first 
request may take up to 30 seconds. Subsequent requests are fast.

**I updated the browser extension but it is not working**

Go to `chrome://extensions`, find PromptPilot, and click the refresh icon. 
Then close and reopen your AI tool tab.

---

## Privacy

- Your Gemini API key is stored locally in your browser — it never leaves 
  your machine except to call the Gemini API directly
- Your API key is hashed to create a unique channel ID — the original key 
  is never sent to the PromptPilot server
- Prompts are relayed through the PromptPilot server only to connect your 
  VS Code and browser — they are not stored or logged

---

## Requirements

- Chrome, Arc, Brave, or Edge (any Chromium browser)
- The [PromptPilot VS Code extension](https://marketplace.visualstudio.com/items?itemName=ishandhole.promptpilot-ishandhole)
- A free Gemini API key from [aistudio.google.com](https://aistudio.google.com)

## Source Code

Full source code at [github.com/ishandhole/PromptPilot](https://github.com/ishandhole/PromptPilot)
