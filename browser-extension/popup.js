chrome.storage.local.get(['channelId', 'connected'], (result) => {
    const statusEl = document.getElementById('status');
    const setupBtn = document.getElementById('setup-btn');
    const disconnectBtn = document.getElementById('disconnect-btn');

    if (result.channelId && result.connected) {
        statusEl.textContent = '✅ Connected — ready to receive prompts';
        statusEl.className = 'status connected';
        disconnectBtn.style.display = 'block';
    } else {
        statusEl.textContent = '⚡ Not connected — enter your API key to connect';
        statusEl.className = 'status disconnected';
        setupBtn.style.display = 'block';
    }
});

document.getElementById('setup-btn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') });
});

document.getElementById('disconnect-btn').addEventListener('click', () => {
    chrome.storage.local.remove(['channelId', 'connected'], () => {
        chrome.runtime.sendMessage({ type: 'disconnect' });
        window.close();
    });
});