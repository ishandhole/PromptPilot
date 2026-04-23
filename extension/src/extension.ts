import * as vscode from 'vscode';
import * as https from 'https';
import * as crypto from 'crypto';
import { SidebarPanel } from './panel';

export const SERVER_URL = 'https://promptpilot-api.onrender.com';
export const BROWSER_EXTENSION_URL = 'https://github.com/ishandhole/PromptPilot/releases/tag/v0.0.1';

export function activate(context: vscode.ExtensionContext) {
	console.log('PromptPilot extension activated');

	// Wake up the Render server immediately on activation
	// Free tier spins down after 15min — this ensures it is warm before first use
	wakeUpServer();

	const sidebarProvider = new SidebarPanel(context.extensionUri, context);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			'promptEngineer.sidebar',
			sidebarProvider
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('promptEngineer.reindex', () => {
			vscode.window.showInformationMessage(
				'PromptPilot: Project files are read automatically with each prompt.'
			);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('promptEngineer.setApiKey', async () => {
			const key = await vscode.window.showInputBox({
				prompt: 'Enter your Gemini API key',
				password: true,
				placeHolder: 'AIza...',
				ignoreFocusOut: true
			});
			if (key) {
				await context.secrets.store('geminiApiKey', key);
				vscode.window.showInformationMessage('PromptPilot: API key saved successfully.');
				sidebarProvider.refresh();
			}
		})
	);
}

function wakeUpServer() {
	const serverUrl = new URL(SERVER_URL);

	const options = {
		hostname: serverUrl.hostname,
		path: '/health',
		method: 'GET',
		timeout: 30000
	};

	const req = https.request(options, (res) => {
		console.log('PromptPilot: Server is awake and ready.');
	});

	req.on('error', () => {
		// Server is waking up — this is expected on cold start
		// The sidebar will handle the delay gracefully
		console.log('PromptPilot: Server waking up in background...');
	});

	req.on('timeout', () => {
		req.destroy();
		console.log('PromptPilot: Server wake up timed out — will retry on first prompt.');
	});

	req.end();
}

export function getChannelId(apiKey: string): string {
	return crypto.createHash('sha256').update(apiKey).digest('hex');
}

export async function sendToIDEOnly(text: string): Promise<boolean> {
	await vscode.env.clipboard.writeText(text);

	try {
		await vscode.commands.executeCommand('aichat.newchataction');
		await new Promise(resolve => setTimeout(resolve, 500));
		await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
		vscode.window.showInformationMessage('PromptPilot: Prompt sent to IDE agent.');
		return true;
	} catch { }

	try {
		await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
		await new Promise(resolve => setTimeout(resolve, 500));
		await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
		vscode.window.showInformationMessage('PromptPilot: Prompt sent to Copilot chat.');
		return true;
	} catch { }

	try {
		await vscode.commands.executeCommand('workbench.action.chat.open', { query: text });
		vscode.window.showInformationMessage('PromptPilot: Prompt sent to IDE agent.');
		return true;
	} catch { }

	vscode.window.showWarningMessage(
		'PromptPilot: No IDE agent found. Prompt copied to clipboard.'
	);
	return false;
}

export async function sendToBrowserOnly(text: string, apiKey: string): Promise<boolean> {
	await vscode.env.clipboard.writeText(text);

	if (!apiKey) {
		vscode.window.showWarningMessage('PromptPilot: No API key set.');
		return false;
	}

	const channelId = getChannelId(apiKey);
	const browserResult = await sendToBrowserViaServer(channelId, text);

	if (browserResult) {
		vscode.window.showInformationMessage(
			'PromptPilot: Prompt sent to your browser AI tool.'
		);
		return true;
	}

	const action = await vscode.window.showWarningMessage(
		'PromptPilot: Browser extension not connected. Install it to auto-paste into Claude, ChatGPT, and Gemini.',
		'Install Browser Extension',
		'Use Clipboard Instead'
	);

	if (action === 'Install Browser Extension') {
		vscode.env.openExternal(vscode.Uri.parse(BROWSER_EXTENSION_URL));
	}

	return false;
}

export function sendToBrowserViaServer(channelId: string, prompt: string): Promise<boolean> {
	return new Promise((resolve) => {
		const body = JSON.stringify({ channel_id: channelId, prompt });
		const serverUrl = new URL(SERVER_URL);

		const options = {
			hostname: serverUrl.hostname,
			path: '/send',
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(body)
			},
			timeout: 10000
		};

		const req = https.request(options, (res) => {
			let data = '';
			res.on('data', (chunk: Buffer) => data += chunk.toString());
			res.on('end', () => {
				try {
					const parsed = JSON.parse(data);
					resolve(parsed.status === 'sent');
				} catch {
					resolve(false);
				}
			});
		});

		req.on('error', () => resolve(false));
		req.on('timeout', () => {
			req.destroy();
			resolve(false);
		});

		req.write(body);
		req.end();
	});
}

export async function getApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
	return await context.secrets.get('geminiApiKey');
}

export function deactivate() { }