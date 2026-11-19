/* Local history search: only scan session text, never attachment data. */
(function () {
  'use strict';
  const fold = s => s.replace(/\s+/g, ' ').trim().toLowerCase();
  function excerpt(text, query, word) {
    if (typeof text !== 'string' || !text.toLowerCase().includes(word)) return null;
    const line = text.replace(/\s+/g, ' ').trim();
    const i = line.toLowerCase().indexOf(query);
    if (i < 0) return null;
    const left = Math.max(0, i - 22), right = Math.min(line.length, i + query.length + 42);
    return (left ? '…' : '') + line.slice(left, right) + (right < line.length ? '…' : '');
  }
  function messageMatch(session, query) {
    // Skip whitespace normalization on text that cannot contain the query.
    const word = query.split(' ').reduce((longest, part) => part.length > longest.length ? part : longest, '');
    for (const message of session.messages || []) {
      let snippet = null;
      if (message.role === 'user') {
        snippet = excerpt(message.content, query, word);
      } else if (message.role === 'assistant') {
        for (const block of message.blocks || []) {
          if (block.type !== 'text') continue;
          snippet = excerpt(block.text, query, word);
          if (snippet !== null) break;
        }
      }
      if (snippet !== null) return { messageId: message.id, snippet };
    }
    return null;
  }
  if (typeof document === 'undefined') { module.exports = { fold, messageMatch }; return; }

  const rowTargets = new WeakMap();
  window.chatHistorySearchTarget = row => rowTargets.get(row);

  function bind(input) {
    if (input.dataset.dsBound) return;
    const area = input.closest('.sider-ac14ac'), list = area?.querySelector('.list-ac14ac');
    if (!list) return;
    input.dataset.dsBound = '1';
    const status = document.createElement('div');
    status.className = 'ds-search-status';
    status.setAttribute('role', 'status');
    list.parentNode.appendChild(status);
    let query = '', version = 0, timer, txn, results = new Map(), state = 'idle';
    function render() {
      let visible = 0;
      for (const section of list.querySelectorAll('.section-ac14ac')) {
        let count = 0;
        for (const row of section.querySelectorAll('[data-session-id]')) {
          const title = row.querySelector('.title-ff6fc9');
          if (!title) continue;
          const match = results.get(row.dataset.sessionId);
          const hit = !query || fold(title.textContent).includes(query) || !!match;
          row.classList.toggle('ds-search-hidden', !hit);
          if (query && match) {
            title.dataset.match = match.snippet;
            rowTargets.set(row, { messageId: match.messageId, query });
          } else {
            delete title.dataset.match;
            rowTargets.delete(row);
          }
          if (hit) count++;
        }
        section.classList.toggle('ds-search-hidden', !!query && !count);
        visible += count;
      }
      const zh = !document.documentElement.lang.startsWith('en');
      status.textContent = !query ? '' : state === 'error' ? (zh ? '正文搜索失败，已显示标题匹配' : 'Could not search messages. Showing matching titles.') : state === 'loading' ? (zh ? '正在搜索…' : 'Searching…') : !visible ? (zh ? '没有找到相关对话' : 'No matching conversations') : '';
    }
    function search() {
      const id = ++version;
      clearTimeout(timer);
      if (txn) { try { txn.abort(); } catch {} txn = null; }
      query = fold(input.value); results = new Map(); state = query ? 'loading' : 'idle'; render();
      if (!query) return;
      timer = setTimeout(() => {
        const request = indexedDB.open('chat-demo');
        request.onupgradeneeded = () => request.transaction.abort();
        const fail = () => { if (id === version) { txn = null; state = 'error'; render(); } };
        request.onerror = fail;
        request.onsuccess = () => {
          const db = request.result;
          if (id !== version || !input.isConnected) { db.close(); return; }
          try {
            const tx = txn = db.transaction('sessions', 'readonly');
            tx.onabort = () => { db.close(); fail(); };
            tx.oncomplete = () => { db.close(); if (id === version) { txn = null; state = 'done'; render(); } };
            const cursor = tx.objectStore('sessions').openCursor();
            cursor.onsuccess = () => {
              const entry = cursor.result;
              if (!entry || id !== version) return;
              const match = messageMatch(entry.value, query);
              if (match !== null) results.set(String(entry.primaryKey), match);
              entry.continue();
            };
          } catch { db.close(); fail(); }
        };
      }, 120);
    }
    input.addEventListener('input', e => { if (!e.isComposing) search(); });
    input.addEventListener('compositionend', search);
    input.addEventListener('search', search);
    input.addEventListener('keydown', e => { if (e.key === 'Escape' && !e.isComposing) { input.value = ''; search(); input.blur(); } });
    const listObserver = new MutationObserver(() => { if (query) search(); });
    listObserver.observe(list, {childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['data-search-revision']});
    const drawer = area.closest('.drawer-ac14ac');
    if (drawer) new MutationObserver(() => { if (query && drawer.getAttribute('aria-hidden') === 'true') { input.value = ''; search(); } }).observe(drawer, {attributes:true, attributeFilter:['aria-hidden']});
  }
  function bindAll() { document.querySelectorAll('.ds-search-input:not([data-ds-bound])').forEach(bind); }
  bindAll();
  document.addEventListener('focusin', e => { if (e.target.matches?.('.ds-search-input')) bind(e.target); });
})();
