// Install only in the replica's debug WebView, in a fresh, empty chat.
// Supply a base64 WAV with known speech. No speaker or microphone is connected.
async function installVoiceFixture(wav) {
  if (window.__voiceQA) throw new Error('Fixture is already installed');
  if (!location.href.startsWith('file:///android_asset/chat/index.html')) throw new Error('Wrong page');
  const devices = navigator.mediaDevices;
  const previous = Object.getOwnPropertyDescriptor(devices, 'getUserMedia');
  const originalFetch = window.fetch;
  const ctx = new AudioContext();
  const sources = [], tracks = [], asr = [];
  let sound;
  try {
    sound = await ctx.decodeAudioData(Uint8Array.from(atob(wav), c => c.charCodeAt(0)).buffer);
  } catch (e) { await ctx.close(); throw e; }
  Object.defineProperty(devices, 'getUserMedia', {configurable:true, value:async ({audio, video}) => {
    if (!audio || video) throw new Error('Audio-only fixture');
    await ctx.resume();
    const dest = ctx.createMediaStreamDestination(), source = ctx.createBufferSource();
    source.buffer = sound;
    source.connect(dest);
    sources.push(source); tracks.push(...dest.stream.getTracks());
    // Let the application's recorder attach before the first syllable.
    source.start(ctx.currentTime + 0.30);
    return dest.stream;
  }});
  window.fetch = function (input, opts) {
    const path = new URL(typeof input === 'string' ? input : input.url || input, location.href).pathname;
    if (path !== '/v1/tools/asr') return originalFetch.apply(this, arguments);
    const call = {status:null}; asr.push(call);
    return originalFetch.apply(this, arguments).then(r => { call.status = r.status; return r; });
  };
  window.__voiceQA = {
    state: () => ({tracks:tracks.map(t => t.readyState), asr:asr.map(r => r.status),
      questions:document.querySelectorAll('.container-_4cfe7').length,
      answers:document.querySelectorAll('.ds-assistant-message-main-content').length}),
    restore: async () => {
      if (previous) Object.defineProperty(devices, 'getUserMedia', previous);
      else delete devices.getUserMedia;
      window.fetch = originalFetch;
      tracks.forEach(t => t.stop()); sources.forEach(s => s.disconnect());
      delete window.__voiceQA;
      await ctx.close();
    }
  };
  return sound.duration;
}
