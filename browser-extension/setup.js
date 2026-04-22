async function deriveChannelId(apiKey) {
    const encoder = new TextEncoder();
    const data = encoder.encode(apiKey);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Check if already connected
chrome.storage.local.get(['channelId', 'connected'], (result) => {
    if (result.channelId && result.connected) {
        const statusEl = document.getElementById('status');
        statusEl.textContent = '✅ Already connected! You can close this tab.';
        statusEl.className = 'status success';
    }
});

document.getElementById('connect-btn').addEventListener('click', async () => {
    const apiKey = document.getElementById('api-key-input').value.trim();
    const statusEl = document.getElementById('status');

    if (!apiKey) {
        statusEl.textContent = 'Please enter your API key.';
        statusEl.className = 'status error';
        return;
    }

    if (!apiKey.startsWith('AIza')) {
        statusEl.textContent = 'That does not look like a valid Gemini API key. It should start with AIza.';
        statusEl.className = 'status error';
        return;
    }

    try {
        const channelId = await deriveChannelId(apiKey);
        await chrome.storage.local.set({ channelId, connected: true });
        chrome.runtime.sendMessage({ type: 'setChannelId', channelId });

        statusEl.textContent = '✅ Connected! PromptPilot will now auto-paste prompts into your browser AI tools.';
        statusEl.className = 'status success';

        document.getElementById('api-key-input').value = '';

    } catch (e) {
        statusEl.textContent = 'Something went wrong. Please try again.';
        statusEl.className = 'status error';
    }
});

document.getElementById('api-key-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('connect-btn').click();
});