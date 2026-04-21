import * as vscode from 'vscode';
import * as https from 'https';
import * as crypto from 'crypto';
import { SidebarPanel } from './panel';

export const SERVER_URL = 'https://promptpilot-api.onrender.com';
export const BROWSER_EXTENSION_URL = 'https://github.com/ishandhole/PromptPilot/releases';

export function activate(context: vscode.ExtensionContext) {
	console.log('PromptPilot extension activated');

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

export function getChannelId(apiKey: string): string {
	return crypto.createHash('sha256').update(apiKey).digest('hex');
}

export async function sendToIDEAgent(text: string, apiKey: string): Promise<boolean> {
	await vscode.env.clipboard.writeText(text);

	// Try to send to browser extension via hosted server
	if (apiKey) {
		const channelId = getChannelId(apiKey);
		const browserResult = await sendToBrowserViaServer(channelId, text);

		if (!browserResult) {
			// No browser extension connected — show install prompt
			const action = await vscode.window.showInformationMessage(
				'PromptPilot: No browser extension connected. Install it to auto-paste into Claude, ChatGPT, and Gemini.',
				'Install Browser Extension',
				'Use Clipboard Instead'
			);

			if (action === 'Install Browser Extension') {
				vscode.env.openExternal(vscode.Uri.parse(BROWSER_EXTENSION_URL));
			}
		} else {
			vscode.window.showInformationMessage(
				'PromptPilot: Prompt sent to your browser AI tool.'
			);
		}
	}

	// Try IDE agent commands
	try {
		await vscode.commands.executeCommand('aichat.newchataction');
		await new Promise(resolve => setTimeout(resolve, 500));
		await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
		return true;
	} catch { }

	try {
		await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
		await new Promise(resolve => setTimeout(resolve, 500));
		await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
		return true;
	} catch { }

	try {
		await vscode.commands.executeCommand('workbench.action.chat.open', { query: text });
		return true;
	} catch { }

	return false;
}

function sendToBrowserViaServer(channelId: string, prompt: string): Promise<boolean> {
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
					// Returns true only if browser extension received it
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