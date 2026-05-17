const downloadBtn = document.getElementById('downloadBtn');
const statusEl = document.getElementById('status');
const btnTextEl = downloadBtn?.querySelector('.btn-text');

const QWEN_HOST = 'chat.qwen.ai';

function showStatus(type, message) {
  statusEl.textContent = message;
  statusEl.className = `status visible ${type}`;
}

function clearStatus() {
  statusEl.textContent = '';
  statusEl.className = 'status';
}

function setLoading(isLoading) {
  downloadBtn.disabled = isLoading;
  downloadBtn.classList.toggle('is-loading', isLoading);
  document.body.classList.toggle('is-exporting', isLoading);
  if (btnTextEl) {
    btnTextEl.textContent = isLoading ? 'Preparing PDF…' : 'Download Chat as PDF';
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function isQwenChatUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname === QWEN_HOST || parsed.hostname.endsWith(`.${QWEN_HOST}`);
  } catch {
    return false;
  }
}

async function ensureContentScript(tabId) {
  try {
    const ping = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (!ping?.ok || ping.version !== '1.0.0') {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
    }
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
  }
}

downloadBtn.addEventListener('click', async () => {
  clearStatus();
  setLoading(true);

  try {
    const tab = await getActiveTab();

    if (!tab?.id) {
      showStatus('error', 'No active tab found. Open chat.qwen.ai and try again.');
      return;
    }

    if (!isQwenChatUrl(tab.url)) {
      showStatus(
        'error',
        'This extension only works on chat.qwen.ai. Navigate to your conversation first.'
      );
      return;
    }

    await ensureContentScript(tab.id);

    showStatus('info', 'Building your PDF…');

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'EXPORT_PDF',
      options: { autoScroll: false },
    });

    if (!response?.success) {
      throw new Error(response?.error || 'PDF export failed.');
    }

    showStatus(
      'success',
      `Downloaded "${response.filename}" (${response.messageCount} messages, v${response.version || '1.0.0'}).`
    );
  } catch (err) {
    const message =
      err?.message?.includes('Receiving end does not exist')
        ? 'Could not reach the page. Refresh chat.qwen.ai and try again.'
        : err?.message || 'An unexpected error occurred.';

    showStatus('error', message);
    console.error('[Qwen PDF Popup]', err);
  } finally {
    setLoading(false);
  }
});

getActiveTab().then((tab) => {
  if (tab && !isQwenChatUrl(tab.url)) {
    showStatus('info', 'Visit chat.qwen.ai with an open conversation to export.');
  }
});
