// Installed only in the test browser's new, isolated context.
(() => {
  const state = window.streamFixture = { queue: [], requests: [], aborted: 0 };
  localStorage.setItem('chat-demo:api-key', 'offline-fixture');
  const fetchLocal = window.fetch.bind(window);
  window.fetch = async (url, init) => {
    if (!/^https?:/.test(String(url))) return fetchLocal(url, init);
    if (new URL(url).pathname !== '/anthropic/v1/messages' || init.method !== 'POST') {
      throw Error('Unexpected network operation in offline fixture');
    }
    const { messages, title } = JSON.parse(init.body);
    state.requests.push(messages.filter(m => m.role !== 'latest_reminder').map(m => [m.role,
      typeof m.content === 'string' ? m.content : m.content.map(b => b.text).join('')]));
    const next = state.queue.shift();
    if (!next) throw Error('Unexpected extra message request');
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        const emit = event => controller.enqueue(encoder.encode(
          `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
        emit({ type: 'message_start', message: {} });
        const blocks = next.blocks ?? [];
        blocks.forEach((content_block, index) => {
          emit({ type: 'content_block_start', index, content_block });
          emit({ type: 'content_block_stop', index });
        });
        const textIndex = blocks.length;
        const hasText = typeof next.text === 'string';
        const append = text => emit({ type: 'content_block_delta', index: textIndex, delta: { type: 'text_delta', text } });
        if (hasText) {
          emit({ type: 'content_block_start', index: textIndex, content_block: { type: 'text', text: '' } });
          append(next.text);
        }
        const clearHold = () => {
          delete state.append;
          delete state.finish;
        };
        const abort = () => {
          state.aborted++;
          clearHold();
          controller.error(init.signal.reason);
        };
        const finish = () => {
          if (next.hold) {
            init.signal.removeEventListener('abort', abort);
            clearHold();
          }
          if (hasText) emit({ type: 'content_block_stop', index: textIndex });
          emit({ type: 'message_delta', delta: { stop_reason: 'end_turn', ...(title?.enabled && { title: 'Branch fixture' }) } });
          emit({ type: 'message_stop' });
          controller.close();
        };
        if (next.hold) {
          if (hasText) state.append = append;
          state.finish = finish;
          init.signal.addEventListener('abort', abort, { once: true });
        } else {
          finish();
        }
      },
    });
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
  };
})();
