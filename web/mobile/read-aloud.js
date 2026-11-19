/* Automatic playback follows a live generation, never a rendered history item. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.createChatAutoRead = options => factory({...options, native:root.DeepSeekAndroid});
})(typeof window !== 'undefined' ? window : null, function ({storage, foreground, active, play, stop, native}) {
  const key = 'ds.mobile.read-aloud.v1', listeners = new Set();
  let enabled = false, pending = null;
  const nativePrefs = typeof native?.getAutoReadEnabled === 'function' && typeof native?.setAutoReadEnabled === 'function';
  try { enabled = nativePrefs ? native.getAutoReadEnabled() : storage().getItem(key) === '1'; } catch (_) {}

  const interrupt = () => { pending = null; stop(); };
  return {
    isEnabled: () => enabled,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    toggle() {
      const next = !enabled;
      if (!next) interrupt();
      try {
        if (nativePrefs) {
          // Android commits this flag on the JS bridge thread before acknowledging the tap.
          if (!native.setAutoReadEnabled(next) && next) return;
        } else storage().setItem(key, next ? '1' : '0');
      } catch (_) { if (nativePrefs && next) return; }
      enabled = next;
      listeners.forEach(fn => fn());
    },
    begin(session, message) {
      if (!foreground() || active() !== session) return null;
      return pending = {session, message};
    },
    finish(ticket, reply) {
      if (!ticket || ticket !== pending) return;
      pending = null;
      if (!enabled || !foreground() || active() !== ticket.session || reply.id !== ticket.message ||
          reply.status !== 'done' || reply.stopReason === 'refusal') return;
      // Only the trailing answer is visible as the final response; tool steps and reasoning are not speech.
      let text = '';
      for (const block of reply.blocks) {
        if (block.type === 'text' && !block.isTemplate) text += block.text;
        else if (!block.isTemplate) text = '';
      }
      text = text.replace(/\[citation:\d+\]/g, '').trim();
      if (text) play(reply.id, text);
    },
    observe(subscribe, doc, win) {
      const hidden = () => { if (doc.hidden) interrupt(); };
      const unsub = subscribe((next, prev) => {
        if (next.activeId !== prev.activeId || (next.importingHistory && !prev.importingHistory)) interrupt();
      });
      doc.addEventListener('visibilitychange', hidden);
      win.addEventListener('pagehide', interrupt);
      return () => {
        unsub(); doc.removeEventListener('visibilitychange', hidden); win.removeEventListener('pagehide', interrupt);
        interrupt();
      };
    }
  };
});
