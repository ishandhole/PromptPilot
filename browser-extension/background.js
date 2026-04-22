let socket = null;
let reconnectTimeout = null;
let channelId = null;

const WS_SERVER = 'wss://promptpilot-api.onrender.com';

// Auto-open setup page when extension is first installed
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        chrome.tabs.create({
            url: chrome.runtime.getURL('setup.html')
        });
    }
});

// Load channel ID from storage on startup
chrome.storage.local.get(['channelId', 'connected'], (result) => {
    if (result.channelId && result.connected) {
        channelId = result.channelId;
        connect();
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'setChannelId') {
        channelId = message.channelId;
        if (socket) {
            socket.close();
            socket = null;
        }
        connect();
    }

    if (message.type === 'disconnect') {
        channelId = null;
        if (socket) {
            socket.close();
            socket = null;
        }
    }

    if (message.type === 'getStatus') {
        sendResponse({ connected: socket && socket.readyState === WebSocket.OPEN });
        return true;
    }
});

function connect() {
    if (!channelId) return;
    if (socket && socket.readyState === WebSocket.OPEN) return;

    try {
        console.log('PromptPilot: Connecting to channel', channelId.substring(0, 8) + '...');
        socket = new WebSocket(`${WS_SERVER}/ws/${channelId}`);

        socket.onopen = () => {
            console.log('PromptPilot: Connected to hosted server');
            if (reconnectTimeout) {
                clearTimeout(reconnectTimeout);
                reconnectTimeout = null;
            }
        };

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'prompt') {
                    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                        if (tabs[0]) {
                            chrome.tabs.sendMessage(tabs[0].id, {
                                type: 'insertPrompt',
                                prompt: data.prompt
                            }, (response) => {
                                if (chrome.runtime.lastError) {
                                    console.log('PromptPilot: Could not reach content script on this tab');
                                } else {
                                    console.log('PromptPilot: Prompt delivered');
                                }
                            });
                        }
                    });
                }
            } catch (e) {
                console.error('PromptPilot: Failed to parse message', e);
            }
        };

        socket.onclose = () => {
            console.log('PromptPilot: Disconnected. Retrying in 5s...');
            socket = null;
            reconnectTimeout = setTimeout(connect, 5000);
        };

        socket.onerror = () => {
            socket = null;
        };

    } catch (e) {
        console.log('PromptPilot: Could not connect:', e);
        reconnectTimeout = setTimeout(connect, 5000);
    }
}

chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener(() => {
    if (channelId && (!socket || socket.readyState !== WebSocket.OPEN)) {
        connect();
    }
});