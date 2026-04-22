import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import {
    sendToIDEOnly,
    sendToBrowserOnly,
    sendToBrowserViaServer,
    getChannelId,
    getApiKey,
    SERVER_URL,
    BROWSER_EXTENSION_URL
} from './extension';

interface HistoryEntry {
    prompt: string;
    refined: string;
    timestamp: string;
}

const IGNORE_DIRS = new Set([
    '.git', '__pycache__', 'venv', 'node_modules',
    'chroma_db', 'dist', '.next', 'build', 'out', '.cache'
]);

const MAX_HISTORY = 20;
const MAX_FILE_SIZE = 50000;

export class SidebarPanel implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _context: vscode.ExtensionContext;
    private _extensionUri: vscode.Uri;

    constructor(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this._extensionUri = extensionUri;
        this._context = context;
    }

    public refresh() {
        if (this._view) {
            this._updateView();
        }
    }

    private async _updateView() {
        const apiKey = await getApiKey(this._context);
        if (apiKey) {
            this._view?.webview.postMessage({ command: 'showMain' });
            const channelId = getChannelId(apiKey);
            this._checkBrowserConnection(channelId);
        } else {
            this._view?.webview.postMessage({ command: 'showSetup' });
        }
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this._getHtml();

        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'saveApiKey':
                    await this._context.secrets.store('geminiApiKey', message.key);
                    vscode.window.showInformationMessage('PromptPilot: API key saved.');
                    this._view?.webview.postMessage({ command: 'showMain' });
                    const newApiKey = message.key;
                    const newChannelId = getChannelId(newApiKey);
                    this._checkBrowserConnection(newChannelId);
                    break;
                case 'engineerPrompt':
                    await this._runBackend(
                        message.userPrompt,
                        message.currentFile,
                        message.attachments || []
                    );
                    break;
                case 'sendToIDE':
                    await sendToIDEOnly(message.refinedPrompt);
                    break;
                case 'sendToBrowser':
                    const apiKey = await getApiKey(this._context) || '';
                    await sendToBrowserOnly(message.refinedPrompt, apiKey);
                    break;
                case 'copyPrompt':
                    await vscode.env.clipboard.writeText(message.refinedPrompt);
                    vscode.window.showInformationMessage('PromptPilot: Prompt copied to clipboard.');
                    break;
                case 'reindex':
                    vscode.window.showInformationMessage(
                        'PromptPilot: Project files are read automatically with each prompt.'
                    );
                    this._view?.webview.postMessage({ command: 'indexingDone' });
                    break;
                case 'getCurrentFile':
                    this._sendCurrentFile();
                    break;
                case 'checkApiKey':
                    await this._updateView();
                    break;
                case 'clearApiKey':
                    await this._context.secrets.delete('geminiApiKey');
                    this._view?.webview.postMessage({ command: 'showSetup' });
                    vscode.window.showInformationMessage('PromptPilot: API key cleared.');
                    break;
                case 'openInstallPage':
                    vscode.env.openExternal(vscode.Uri.parse(BROWSER_EXTENSION_URL));
                    break;
                case 'checkBrowserConnection':
                    const key = await getApiKey(this._context);
                    if (key) {
                        this._checkBrowserConnection(getChannelId(key));
                    }
                    break;
            }
        });

        this._sendCurrentFile();
        this._updateView();
    }

    private _sendCurrentFile() {
        const editor = vscode.window.activeTextEditor;
        const currentFile = editor
            ? path.basename(editor.document.fileName)
            : 'No file open';
        this._view?.webview.postMessage({ command: 'currentFile', file: currentFile });
    }

    private _getWorkspacePath(): string | null {
        const folders = vscode.workspace.workspaceFolders;
        return folders ? folders[0].uri.fsPath : null;
    }

    private _getProjectStructure(rootDir: string): string {
        const lines: string[] = [];
        const walk = (dir: string, level: number) => {
            if (level > 4) return;
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
                    const indent = '  '.repeat(level);
                    if (entry.isDirectory()) {
                        lines.push(`${indent}${entry.name}/`);
                        walk(path.join(dir, entry.name), level + 1);
                    } else {
                        lines.push(`${indent}${entry.name}`);
                    }
                }
            } catch { }
        };
        lines.push(path.basename(rootDir) + '/');
        walk(rootDir, 1);
        return lines.join('\n');
    }

    private _readFileContent(filePath: string): string {
        try {
            const stat = fs.statSync(filePath);
            if (stat.size > MAX_FILE_SIZE) {
                return `[File too large — ${Math.round(stat.size / 1024)}KB]`;
            }
            return fs.readFileSync(filePath, 'utf8');
        } catch {
            return '[Could not read file]';
        }
    }

    private _buildContext(currentFile: string): string {
        const workspacePath = this._getWorkspacePath();
        if (!workspacePath) return '';

        const parts: string[] = [];

        try {
            const structure = this._getProjectStructure(workspacePath);
            parts.push(`--- Project Structure ---\n${structure}`);
        } catch { }

        const configFiles = [
            'package.json', 'requirements.txt', 'pyproject.toml',
            'Pipfile', 'tsconfig.json', 'pom.xml', 'build.gradle'
        ];
        for (const config of configFiles) {
            const configPath = path.join(workspacePath, config);
            if (fs.existsSync(configPath)) {
                const content = this._readFileContent(configPath);
                parts.push(`--- ${config} ---\n${content}`);
            }
        }

        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const content = editor.document.getText();
            if (content.length <= MAX_FILE_SIZE) {
                parts.push(`--- ${currentFile} (current file) ---\n${content}`);
            }
        } else if (currentFile !== 'No file open') {
            const fullPath = path.join(workspacePath, currentFile);
            if (fs.existsSync(fullPath)) {
                const content = this._readFileContent(fullPath);
                parts.push(`--- ${currentFile} (current file) ---\n${content}`);
            }
        }

        return parts.join('\n\n');
    }

    private _getHistoryKey(currentFile: string): string {
        return `pp_history_${currentFile.replace(/[^a-zA-Z0-9]/g, '_')}`;
    }

    private _loadHistory(currentFile: string): HistoryEntry[] {
        const key = this._getHistoryKey(currentFile);
        return this._context.globalState.get<HistoryEntry[]>(key, []);
    }

    private async _saveHistory(currentFile: string, history: HistoryEntry[]) {
        const key = this._getHistoryKey(currentFile);
        await this._context.globalState.update(key, history.slice(-MAX_HISTORY));
    }

    private _buildHistoryContext(currentFile: string): string {
        const history = this._loadHistory(currentFile);
        if (history.length === 0) return '';
        return history.slice(-5).map(h =>
            `[${h.timestamp}]\nDeveloper typed: ${h.prompt}\nRefined output: ${h.refined}`
        ).join('\n\n');
    }

    private _checkBrowserConnection(channelId: string) {
        const body = JSON.stringify({ channel_id: channelId, prompt: '__ping__' });
        const options = {
            hostname: 'promptpilot-api.onrender.com',
            path: '/send',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            },
            timeout: 8000
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk: Buffer) => data += chunk.toString());
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    const connected = parsed.status === 'sent';
                    this._view?.webview.postMessage({ command: 'browserStatus', connected });
                } catch {
                    this._view?.webview.postMessage({ command: 'browserStatus', connected: false });
                }
            });
        });

        req.on('error', () => {
            this._view?.webview.postMessage({ command: 'browserStatus', connected: false });
        });

        req.write(body);
        req.end();
    }

    private _postToServer(body: any): Promise<any> {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify(body);
            const serverUrl = new URL(SERVER_URL);

            const options = {
                hostname: serverUrl.hostname,
                path: '/engineer',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data)
                },
                timeout: 120000
            };

            const req = https.request(options, (res) => {
                let responseData = '';
                res.on('data', (chunk: Buffer) => responseData += chunk.toString());
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(responseData);
                        if (res.statusCode && res.statusCode >= 400) {
                            reject(new Error(parsed.detail || `Server error ${res.statusCode}`));
                        } else {
                            resolve(parsed);
                        }
                    } catch (e) {
                        reject(new Error('Failed to parse server response'));
                    }
                });
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('timeout'));
            });

            req.write(data);
            req.end();
        });
    }

    private async _runBackend(userPrompt: string, currentFile: string, attachments: any[] = []) {
        const apiKey = await getApiKey(this._context);

        if (!apiKey) {
            this._view?.webview.postMessage({
                command: 'error',
                message: 'No API key found. Please enter your Gemini API key.'
            });
            this._view?.webview.postMessage({ command: 'showSetup' });
            return;
        }

        this._view?.webview.postMessage({ command: 'loading' });

        try {
            const context = this._buildContext(currentFile);
            const history = this._buildHistoryContext(currentFile);

            const response = await this._postToServer({
                user_prompt: userPrompt,
                api_key: apiKey,
                context,
                history,
                attachments
            });

            const refined = response.refined_prompt;
            if (!refined) throw new Error('Server returned empty response');

            this._view?.webview.postMessage({
                command: 'refinedPrompt',
                prompt: refined
            });

            // Check browser connection status
            const channelId = getChannelId(apiKey);
            this._checkBrowserConnection(channelId);

            // Save to session memory
            const existingHistory = this._loadHistory(currentFile);
            existingHistory.push({
                prompt: userPrompt,
                refined,
                timestamp: new Date().toISOString()
            });
            await this._saveHistory(currentFile, existingHistory);

        } catch (error: any) {
            const msg = error.message || 'Unknown error';
            if (msg.includes('timeout') || msg.includes('ECONNREFUSED') || msg.includes('socket hang up')) {
                this._view?.webview.postMessage({
                    command: 'error',
                    message: 'Server is waking up — this takes about 30 seconds on the free tier. Please try again shortly.'
                });
            } else {
                this._view?.webview.postMessage({ command: 'error', message: msg });
            }
        }
    }

    private _getHtml(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PromptPilot</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

        :root {
            --accent: #3b82f6;
            --accent-hover: #2563eb;
            --accent-subtle: rgba(59, 130, 246, 0.1);
            --accent-border: rgba(59, 130, 246, 0.25);
            --surface-1: rgba(255, 255, 255, 0.04);
            --surface-2: rgba(255, 255, 255, 0.07);
            --border: rgba(255, 255, 255, 0.08);
            --border-strong: rgba(255, 255, 255, 0.14);
            --text-primary: rgba(255, 255, 255, 0.92);
            --text-secondary: rgba(255, 255, 255, 0.55);
            --text-muted: rgba(255, 255, 255, 0.32);
            --success: #10b981;
            --success-subtle: rgba(16, 185, 129, 0.1);
            --danger: #ef4444;
            --danger-subtle: rgba(239, 68, 68, 0.1);
            --warning: #f59e0b;
            --radius-sm: 5px;
            --radius: 7px;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { width: 100%; height: 100%; }

        body {
            font-family: 'Inter', var(--vscode-font-family), system-ui, sans-serif;
            font-size: 12px;
            color: var(--text-primary);
            background: var(--vscode-sideBar-background);
            display: flex;
            flex-direction: column;
            min-height: 100vh;
            overflow-x: hidden;
        }

        .header {
            padding: 12px 14px 10px;
            border-bottom: 1px solid var(--border);
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-shrink: 0;
        }

        .header-left {
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 0;
        }

        .logo-mark {
            width: 20px;
            height: 20px;
            background: var(--accent);
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }

        .logo-mark svg { width: 11px; height: 11px; fill: white; }

        .logo-text {
            font-size: 13px;
            font-weight: 600;
            color: var(--text-primary);
            letter-spacing: -0.2px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .header-badge {
            font-size: 9px;
            font-weight: 500;
            color: var(--accent);
            background: var(--accent-subtle);
            border: 1px solid var(--accent-border);
            padding: 1px 6px;
            border-radius: 20px;
            white-space: nowrap;
            flex-shrink: 0;
        }

        .label {
            font-size: 10px;
            font-weight: 500;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.6px;
            margin-bottom: 5px;
        }

        .file-row {
            display: flex;
            align-items: center;
            gap: 7px;
            padding: 7px 10px;
            background: var(--surface-1);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            min-width: 0;
        }

        .file-indicator {
            width: 5px;
            height: 5px;
            border-radius: 50%;
            background: var(--success);
            flex-shrink: 0;
        }

        .file-label { font-size: 10px; color: var(--text-muted); flex-shrink: 0; }

        .file-name {
            font-family: 'JetBrains Mono', monospace;
            font-size: 11px;
            color: var(--text-primary);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            min-width: 0;
            flex: 1;
        }

        /* Browser status row */
        .browser-status-row {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 5px 10px;
            background: var(--surface-1);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            font-size: 10px;
            color: var(--text-muted);
            cursor: default;
        }

        .browser-dot {
            width: 5px;
            height: 5px;
            border-radius: 50%;
            background: var(--text-muted);
            flex-shrink: 0;
            transition: background 0.2s;
        }

        .browser-dot.connected { background: var(--success); }
        .browser-dot.disconnected { background: var(--warning); }

        .browser-status-text { flex: 1; }

        .browser-install-link {
            color: var(--accent);
            font-size: 10px;
            text-decoration: none;
            cursor: pointer;
            background: none;
            border: none;
            padding: 0;
            font-family: inherit;
        }

        .browser-install-link:hover { text-decoration: underline; }

        textarea, input[type="password"], input[type="text"] {
            width: 100%;
            background: var(--surface-1);
            color: var(--text-primary);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 8px 10px;
            font-family: 'Inter', var(--vscode-font-family), system-ui, sans-serif;
            font-size: 12px;
            outline: none;
            transition: border-color 0.15s, background 0.15s;
            resize: vertical;
            line-height: 1.5;
        }

        textarea { min-height: 70px; }

        textarea:focus, input:focus {
            border-color: var(--accent-border);
            background: var(--surface-2);
        }

        textarea::placeholder, input::placeholder { color: var(--text-muted); }

        .upload-area {
            border: 1px dashed var(--border-strong);
            border-radius: var(--radius);
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 4px;
            cursor: pointer;
            transition: border-color 0.15s, background 0.15s;
            position: relative;
        }

        .upload-area:hover, .upload-area.drag-over {
            border-color: var(--accent-border);
            background: var(--accent-subtle);
        }

        .upload-area input[type="file"] {
            position: absolute;
            inset: 0;
            opacity: 0;
            cursor: pointer;
            width: 100%;
            height: 100%;
            padding: 0;
            border: none;
            background: none;
        }

        .upload-hint {
            display: flex;
            align-items: center;
            gap: 6px;
            color: var(--text-muted);
            font-size: 11px;
            pointer-events: none;
        }

        .upload-types { font-size: 10px; color: var(--text-muted); pointer-events: none; }

        .attachments-list { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }

        .attachment-item {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 5px 8px;
            background: var(--surface-2);
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
        }

        .attachment-name {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: var(--text-secondary);
            font-family: 'JetBrains Mono', monospace;
            font-size: 10px;
        }

        .attachment-remove {
            background: none;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            padding: 0 2px;
            font-size: 14px;
            line-height: 1;
            width: auto;
        }

        .attachment-remove:hover { color: var(--danger); }

        .btn {
            width: 100%;
            padding: 7px 12px;
            border: none;
            border-radius: var(--radius);
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            font-family: 'Inter', var(--vscode-font-family), system-ui, sans-serif;
            transition: all 0.15s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
        }

        .btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none !important; }

        .btn-primary { background: var(--accent); color: white; }
        .btn-primary:not(:disabled):hover { background: var(--accent-hover); transform: translateY(-1px); }

        .btn-ghost {
            background: var(--surface-1);
            color: var(--text-secondary);
            border: 1px solid var(--border);
        }
        .btn-ghost:not(:disabled):hover {
            background: var(--surface-2);
            border-color: var(--border-strong);
            color: var(--text-primary);
        }

        .btn-success { background: var(--success); color: white; }
        .btn-success:not(:disabled):hover { background: #059669; transform: translateY(-1px); }

        /* IDE button — distinct teal colour */
        .btn-ide {
            background: #0d9488;
            color: white;
        }
        .btn-ide:not(:disabled):hover { background: #0f766e; transform: translateY(-1px); }

        .btn-neutral {
            background: var(--surface-2);
            color: var(--text-secondary);
            border: 1px solid var(--border-strong);
        }
        .btn-neutral:not(:disabled):hover { background: rgba(255,255,255,0.1); color: var(--text-primary); }

        .btn-danger {
            background: var(--danger-subtle);
            color: var(--danger);
            border: 1px solid rgba(239, 68, 68, 0.2);
        }
        .btn-danger:not(:disabled):hover { background: rgba(239, 68, 68, 0.18); }

        .btn-link {
            background: none;
            border: none;
            color: var(--text-muted);
            font-size: 11px;
            cursor: pointer;
            padding: 0;
            font-family: inherit;
            text-decoration: underline;
            text-underline-offset: 2px;
            width: auto;
        }
        .btn-link:hover { color: var(--text-secondary); }

        .btn-row { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
        .btn-row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 5px; }

        .divider { height: 1px; background: var(--border); flex-shrink: 0; }

        .section-label-small {
            font-size: 9px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--text-muted);
            text-align: center;
            margin-bottom: 4px;
        }

        .status {
            display: none;
            align-items: center;
            gap: 7px;
            padding: 7px 10px;
            border-radius: var(--radius);
            font-size: 11px;
            line-height: 1.4;
        }
        .status.loading { background: var(--accent-subtle); border: 1px solid var(--accent-border); color: var(--accent); }
        .status.error { background: var(--danger-subtle); border: 1px solid rgba(239,68,68,0.2); color: var(--danger); }
        .status.success { background: var(--success-subtle); border: 1px solid rgba(16,185,129,0.2); color: var(--success); }

        .spinner {
            width: 11px; height: 11px;
            border: 1.5px solid currentColor;
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 0.7s linear infinite;
            flex-shrink: 0; opacity: 0.7;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        .output-card {
            background: var(--surface-1);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            overflow: hidden;
            animation: fadeUp 0.2s ease;
        }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

        .output-card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 6px 10px;
            border-bottom: 1px solid var(--border);
            background: var(--surface-2);
        }
        .output-card-title { font-size: 10px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
        .output-card-tag { font-size: 9px; color: var(--accent); background: var(--accent-subtle); padding: 1px 6px; border-radius: 3px; font-weight: 500; }

        .output-card-body {
            padding: 10px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 11px;
            line-height: 1.65;
            color: var(--text-primary);
            white-space: pre-wrap;
            word-break: break-word;
            max-height: 200px;
            overflow-y: auto;
            scrollbar-width: thin;
            scrollbar-color: var(--border-strong) transparent;
        }
        .output-card-body::-webkit-scrollbar { width: 3px; }
        .output-card-body::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 2px; }

        #setup-screen { display: none; flex-direction: column; flex: 1; }
        .setup-body { padding: 16px 14px; display: flex; flex-direction: column; gap: 14px; flex: 1; }
        .setup-intro { display: flex; flex-direction: column; gap: 4px; }
        .setup-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
        .setup-desc { font-size: 11px; color: var(--text-secondary); line-height: 1.5; }
        .setup-desc a { color: var(--accent); text-decoration: none; }
        .setup-desc a:hover { text-decoration: underline; }
        .steps { display: flex; flex-direction: column; gap: 8px; }
        .steps-title { font-size: 10px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 2px; }
        .step { display: flex; align-items: flex-start; gap: 8px; }
        .step-num { width: 16px; height: 16px; border-radius: 50%; background: var(--surface-2); border: 1px solid var(--border-strong); font-size: 9px; font-weight: 600; color: var(--text-secondary); display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; }
        .step-text { font-size: 11px; color: var(--text-secondary); line-height: 1.5; }
        .step-text a { color: var(--accent); text-decoration: none; }
        .step-text a:hover { text-decoration: underline; }
        .step-text code { font-family: 'JetBrains Mono', monospace; font-size: 10px; background: var(--surface-2); border: 1px solid var(--border); padding: 0 4px; border-radius: 3px; color: var(--text-primary); }
        .secure-note { font-size: 10px; color: var(--text-muted); display: flex; align-items: center; gap: 5px; }

        #main-screen { display: none; flex-direction: column; flex: 1; }
        .main-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; flex: 1; }
        #refined-section { display: none; flex-direction: column; gap: 8px; animation: fadeUp 0.2s ease; }
        #edit-area { display: none; }
        .bottom-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 2px; }
        .bottom-bar .btn-ghost { width: auto; padding: 5px 10px; font-size: 11px; }
    </style>
</head>
<body>

    <!-- Header -->
    <div class="header">
        <div class="header-left">
            <div class="logo-mark">
                <svg viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">
                    <path d="M7 1L2 7h4l-1 4 5-6H6l1-4z"/>
                </svg>
            </div>
            <span class="logo-text">PromptPilot</span>
        </div>
        <span class="header-badge">AI</span>
    </div>

    <!-- Setup Screen -->
    <div id="setup-screen">
        <div class="setup-body">
            <div class="setup-intro">
                <div class="setup-title">Connect your API key</div>
                <div class="setup-desc">
                    PromptPilot uses the Gemini API to engineer your prompts.
                    Get a free key — no credit card required.
                </div>
            </div>

            <div class="steps">
                <div class="steps-title">How to get your key</div>
                <div class="step">
                    <div class="step-num">1</div>
                    <div class="step-text">Go to <a href="https://aistudio.google.com" target="_blank">aistudio.google.com</a> and sign in with your Google account</div>
                </div>
                <div class="step">
                    <div class="step-num">2</div>
                    <div class="step-text">Click <strong>Get API key</strong> then <strong>Create API key</strong></div>
                </div>
                <div class="step">
                    <div class="step-num">3</div>
                    <div class="step-text">Copy the key — it starts with <code>AIza</code></div>
                </div>
                <div class="step">
                    <div class="step-num">4</div>
                    <div class="step-text">Paste it below and click Save</div>
                </div>
            </div>

            <div>
                <div class="label">Gemini API Key</div>
                <input type="password" id="api-key-input" placeholder="AIzaSy..." />
            </div>

            <button class="btn btn-primary" id="save-key-btn">Save &amp; Connect</button>

            <div class="secure-note">
                <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
                    <path d="M6 1C4.3 1 3 2.3 3 4v1H2v6h8V5H9V4C9 2.3 7.7 1 6 1zm0 1.5c.8 0 1.5.7 1.5 1.5v1h-3V4C4.5 3.2 5.2 2.5 6 2.5zM6 7c.6 0 1 .4 1 1s-.4 1-1 1-1-.4-1-1 .4-1 1-1z"/>
                </svg>
                Stored securely in VS Code's encrypted secret storage
            </div>
        </div>
    </div>

    <!-- Main Screen -->
    <div id="main-screen">
        <div class="main-body">

            <!-- Current file -->
            <div class="file-row">
                <div class="file-indicator"></div>
                <span class="file-label">Working on</span>
                <span class="file-name" id="current-file">Detecting...</span>
            </div>

            <!-- Browser connection status -->
            <div class="browser-status-row" id="browser-status-row" style="display:none">
                <div class="browser-dot" id="browser-dot"></div>
                <span class="browser-status-text" id="browser-status-text">Checking browser...</span>
                <button class="browser-install-link" id="install-browser-btn" style="display:none">
                    Install extension
                </button>
            </div>

            <!-- Prompt input -->
            <div>
                <div class="label">Your Prompt</div>
                <textarea id="user-prompt" placeholder="Describe what you want... e.g. fix the auth bug, make a DBMS project, add error handling"></textarea>
            </div>

            <!-- Attachments -->
            <div>
                <div class="label">Attachments <span style="color:var(--text-muted);font-size:9px;text-transform:none;letter-spacing:0">(optional — images, PDFs, Word docs)</span></div>
                <div class="upload-area" id="upload-area">
                    <input type="file" id="file-input" multiple accept="image/*,.pdf,.doc,.docx,.txt" />
                    <div class="upload-hint">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M6 1v7M3 4l3-3 3 3M1 9v1a1 1 0 001 1h8a1 1 0 001-1V9"/>
                        </svg>
                        Click to upload or drag and drop
                    </div>
                    <div class="upload-types">Images, PDF, Word, TXT — up to 5 files</div>
                </div>
                <div class="attachments-list" id="attachments-list" style="display:none"></div>
            </div>

            <button class="btn btn-primary" id="engineer-btn">Engineer Prompt</button>

            <div class="status" id="status">
                <div class="spinner" id="status-spinner" style="display:none"></div>
                <span id="status-text"></span>
            </div>

            <!-- Refined output -->
            <div id="refined-section">
                <div class="output-card">
                    <div class="output-card-header">
                        <span class="output-card-title">Refined Prompt</span>
                        <span class="output-card-tag">Enhanced</span>
                    </div>
                    <div class="output-card-body" id="refined-output"></div>
                </div>

                <textarea id="edit-area" placeholder="Edit the refined prompt..."></textarea>

                <!-- Send actions -->
                <div class="section-label-small">Send to</div>
                <div class="btn-row">
                    <button class="btn btn-success" id="send-browser-btn" title="Send to AI tool open in your browser (Claude, ChatGPT, Gemini, Perplexity)">
                        Browser Agent
                    </button>
                    <button class="btn btn-ide" id="send-ide-btn" title="Send to AI agent inside this IDE (Cursor, Copilot, Antigravity)">
                        IDE Agent
                    </button>
                </div>

                <!-- Secondary actions -->
                <div class="btn-row">
                    <button class="btn btn-neutral" id="copy-btn">Copy</button>
                    <button class="btn btn-ghost" id="edit-btn">Edit</button>
                </div>

                <button class="btn btn-danger" id="reject-btn">Reject — Try Again</button>
            </div>

            <div class="divider"></div>

            <div class="bottom-bar">
                <button class="btn btn-ghost" id="reindex-btn">Re-index Project</button>
                <button class="btn-link" id="change-key-btn">Change key</button>
            </div>

        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentFile = '';
        let refinedPrompt = '';
        let isEditing = false;
        let attachments = [];

        vscode.postMessage({ command: 'checkApiKey' });
        vscode.postMessage({ command: 'getCurrentFile' });

        // Setup
        document.getElementById('save-key-btn').addEventListener('click', () => {
            const key = document.getElementById('api-key-input').value.trim();
            if (!key) return;
            vscode.postMessage({ command: 'saveApiKey', key });
        });

        document.getElementById('api-key-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') document.getElementById('save-key-btn').click();
        });

        document.getElementById('change-key-btn').addEventListener('click', () => {
            vscode.postMessage({ command: 'clearApiKey' });
        });

        // Install browser extension link
        document.getElementById('install-browser-btn').addEventListener('click', () => {
            vscode.postMessage({ command: 'openInstallPage' });
        });

        // File upload
        const fileInput = document.getElementById('file-input');
        const uploadArea = document.getElementById('upload-area');

        fileInput.addEventListener('change', (e) => { handleFiles(e.target.files); });

        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('drag-over');
        });

        uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');
            handleFiles(e.dataTransfer.files);
        });

        function handleFiles(files) {
            const allowedTypes = [
                'image/jpeg', 'image/png', 'image/gif', 'image/webp',
                'application/pdf', 'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'text/plain'
            ];
            Array.from(files).slice(0, 5 - attachments.length).forEach(file => {
                if (!allowedTypes.includes(file.type)) return;
                const reader = new FileReader();
                reader.onload = (e) => {
                    attachments.push({ name: file.name, mimeType: file.type, data: e.target.result.split(',')[1] });
                    renderAttachments();
                };
                reader.readAsDataURL(file);
            });
        }

        function getFileIcon(mimeType) {
            if (mimeType.startsWith('image/')) return '🖼';
            if (mimeType === 'application/pdf') return '📄';
            if (mimeType.includes('word')) return '📝';
            return '📎';
        }

        function renderAttachments() {
            const list = document.getElementById('attachments-list');
            if (attachments.length === 0) { list.style.display = 'none'; return; }
            list.style.display = 'flex';
            list.innerHTML = attachments.map((a, i) =>
                '<div class="attachment-item">' +
                '<span style="font-size:12px;flex-shrink:0">' + getFileIcon(a.mimeType) + '</span>' +
                '<span class="attachment-name">' + a.name + '</span>' +
                '<button class="attachment-remove" onclick="removeAttachment(' + i + ')">×</button>' +
                '</div>'
            ).join('');
        }

        function removeAttachment(index) {
            attachments.splice(index, 1);
            renderAttachments();
        }

        // Engineer prompt
        document.getElementById('engineer-btn').addEventListener('click', () => {
            const prompt = document.getElementById('user-prompt').value.trim();
            if (!prompt) { showStatus('Please enter a prompt first.', 'error', false); return; }
            document.getElementById('engineer-btn').disabled = true;
            document.getElementById('refined-section').style.display = 'none';
            showStatus('Engineering your prompt...', 'loading', true);
            vscode.postMessage({ command: 'engineerPrompt', userPrompt: prompt, currentFile, attachments });
        });

        // Send to browser agent only
        document.getElementById('send-browser-btn').addEventListener('click', () => {
            const text = isEditing ? document.getElementById('edit-area').value : refinedPrompt;
            vscode.postMessage({ command: 'sendToBrowser', refinedPrompt: text });
            setTimeout(() => resetAfterSend(), 400);
        });

        // Send to IDE agent only
        document.getElementById('send-ide-btn').addEventListener('click', () => {
            const text = isEditing ? document.getElementById('edit-area').value : refinedPrompt;
            vscode.postMessage({ command: 'sendToIDE', refinedPrompt: text });
            setTimeout(() => resetAfterSend(), 400);
        });

        // Copy
        document.getElementById('copy-btn').addEventListener('click', () => {
            const text = isEditing ? document.getElementById('edit-area').value : refinedPrompt;
            vscode.postMessage({ command: 'copyPrompt', refinedPrompt: text });
        });

        // Edit
        document.getElementById('edit-btn').addEventListener('click', () => {
            const editArea = document.getElementById('edit-area');
            if (!isEditing) {
                editArea.value = refinedPrompt;
                editArea.style.display = 'block';
                document.getElementById('edit-btn').textContent = 'Done';
                isEditing = true;
            } else {
                editArea.style.display = 'none';
                document.getElementById('edit-btn').textContent = 'Edit';
                isEditing = false;
            }
        });

        // Reject
        document.getElementById('reject-btn').addEventListener('click', () => {
            document.getElementById('refined-section').style.display = 'none';
            document.getElementById('edit-area').style.display = 'none';
            document.getElementById('user-prompt').value = '';
            document.getElementById('user-prompt').focus();
            isEditing = false;
            hideStatus();
        });

        // Re-index
        document.getElementById('reindex-btn').addEventListener('click', () => {
            vscode.postMessage({ command: 'reindex' });
        });

        function resetAfterSend() {
            document.getElementById('user-prompt').value = '';
            document.getElementById('refined-section').style.display = 'none';
            document.getElementById('edit-area').style.display = 'none';
            attachments = [];
            renderAttachments();
            isEditing = false;
            hideStatus();
        }

        window.addEventListener('message', (event) => {
            const message = event.data;
            switch (message.command) {
                case 'showSetup':
                    document.getElementById('setup-screen').style.display = 'flex';
                    document.getElementById('main-screen').style.display = 'none';
                    break;
                case 'showMain':
                    document.getElementById('setup-screen').style.display = 'none';
                    document.getElementById('main-screen').style.display = 'flex';
                    // Check browser connection when main screen shows
                    vscode.postMessage({ command: 'checkBrowserConnection' });
                    break;
                case 'currentFile':
                    currentFile = message.file;
                    document.getElementById('current-file').textContent = message.file;
                    break;
                case 'loading':
                    showStatus('Engineering your prompt...', 'loading', true);
                    break;
                case 'refinedPrompt':
                    refinedPrompt = message.prompt;
                    document.getElementById('refined-output').textContent = message.prompt;
                    document.getElementById('refined-section').style.display = 'flex';
                    document.getElementById('engineer-btn').disabled = false;
                    hideStatus();
                    break;
                case 'error':
                    showStatus(message.message, 'error', false);
                    document.getElementById('engineer-btn').disabled = false;
                    break;
                case 'indexingDone':
                    showStatus('Project files read automatically each time.', 'success', false);
                    setTimeout(hideStatus, 3000);
                    break;
                case 'browserStatus':
                    const browserRow = document.getElementById('browser-status-row');
                    const browserDot = document.getElementById('browser-dot');
                    const browserText = document.getElementById('browser-status-text');
                    const installBtn = document.getElementById('install-browser-btn');
                    const sendBrowserBtn = document.getElementById('send-browser-btn');

                    browserRow.style.display = 'flex';

                    if (message.connected) {
                        browserDot.className = 'browser-dot connected';
                        browserText.textContent = 'Browser extension connected';
                        installBtn.style.display = 'none';
                        sendBrowserBtn.disabled = false;
                        sendBrowserBtn.title = 'Send to AI tool open in your browser';
                    } else {
                        browserDot.className = 'browser-dot disconnected';
                        browserText.textContent = 'Browser extension not connected';
                        installBtn.style.display = 'block';
                        sendBrowserBtn.disabled = false;
                        sendBrowserBtn.title = 'Browser extension not connected — click to install';
                    }
                    break;
            }
        });

        function showStatus(msg, type, showSpinner) {
            const el = document.getElementById('status');
            const spinner = document.getElementById('status-spinner');
            const text = document.getElementById('status-text');
            el.className = 'status ' + type;
            el.style.display = 'flex';
            text.textContent = msg;
            spinner.style.display = showSpinner ? 'block' : 'none';
        }

        function hideStatus() {
            document.getElementById('status').style.display = 'none';
        }
    </script>
</body>
</html>`;
    }
}