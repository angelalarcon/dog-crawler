// ── Open app as a full tab when the icon is clicked ───────────────────────────
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
});

// ── Fetch relay — bypasses CORS for host_permissions URLs ─────────────────────
// The page can't fetch miwuki.com directly (CORS), so it asks the background
// worker to do it. The background worker runs in a privileged extension context
// and can fetch any URL listed in host_permissions without CORS restrictions.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'fetch') return;

  const options = {
    method: msg.method || 'GET',
    headers: {
      'Accept-Language': 'es-ES,es;q=0.9',
      'User-Agent': navigator.userAgent,
      ...(msg.headers || {}),
    },
  };
  if (msg.body) options.body = msg.body;

  fetch(msg.url, options)
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    })
    .then(html => sendResponse({ ok: true, html }))
    .catch(err => sendResponse({ ok: false, error: err.message }));

  return true;
});
