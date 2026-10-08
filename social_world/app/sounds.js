/* Effect registry. Register a file below, then call Sound.play('name'). */
(function (global) {
  'use strict';
  const effects = new Map(), buffers = new Map();
  let context = null, active = null, muted = false, masterVolume = 0.65, requestId = 0;

  function register(name, src, options = {}) {
    if (!name || !src) throw new Error('Sound.register requires a name and file path.');
    effects.set(name, { src, volume: options.volume ?? 1 });
  }
  function getContext() {
    const Context = global.AudioContext || global.webkitAudioContext;
    if (!Context) return null;
    return context ??= new Context();
  }
  async function unlock() {
    try {
      const ctx = getContext();
      if (ctx?.state === 'suspended') await ctx.resume();
    } catch (_) { /* A blocked sound must not interrupt the game. */ }
  }
  async function load(src) {
    if (!buffers.has(src)) {
      const promise = (async () => {
        const response = await fetch(src);
        if (!response.ok) throw new Error('Sound file could not be loaded: ' + src);
        return getContext().decodeAudioData(await response.arrayBuffer());
      })().catch(error => { buffers.delete(src); throw error; });
      buffers.set(src, promise);
    }
    return buffers.get(src);
  }
  function stop(cancelPending = true) {
    if (cancelPending) requestId++;
    if (!active) return;
    try { active.stop ? active.stop() : active.pause(); } catch (_) {}
    active = null;
  }
  async function play(name) {
    const effect = effects.get(name);
    if (!effect || muted) return false;
    const requestedAt = Date.now(), request = ++requestId;
    const volume = Math.max(0, Math.min(1, masterVolume * effect.volume));
    try {
      const ctx = getContext();
      if (ctx) {
        await unlock();
        if (ctx.state !== 'running' || request !== requestId) return false;
        const buffer = await load(effect.src);
        // Do not replay an old alert after a later click unlocks sound.
        if (muted || request !== requestId || Date.now() - requestedAt > 2000) return false;
        stop(false);
        const source = ctx.createBufferSource(), gain = ctx.createGain();
        source.buffer = buffer;
        gain.gain.value = volume;
        source.connect(gain); gain.connect(ctx.destination);
        active = source;
        source.onended = () => {
          source.disconnect(); gain.disconnect();
          if (active === source) active = null;
        };
        source.start();
        return true;
      }
    } catch (_) { /* file:// may reject fetch; the audio element also supports local files. */ }
    if (muted || Date.now() - requestedAt > 2000) return false;
    try {
      stop(false);
      const audio = new Audio(effect.src);
      audio.volume = volume; active = audio;
      audio.onended = () => { if (active === audio) active = null; };
      await audio.play();
      return true;
    } catch (_) { active = null; return false; }
  }
  global.Sound = {
    register, play, stop, unlock,
    setVolume(value) { masterVolume = Math.max(0, Math.min(1, Number(value) || 0)); },
    setMuted(value) { muted = !!value; if (muted) stop(); }
  };
  // These listeners only unlock audio; they do not play an effect.
  for (const event of ['pointerdown', 'keydown']) {
    document.addEventListener(event, unlock, { capture: true });
  }

  // Add future sound files and names here.
  Sound.register('cocoNotification', 'assets/notification.mp3');
  Sound.register('missionComplete', 'assets/notification.mp3');
  Sound.register('fishingBite', 'assets/universfield-bubble-pop-293342.mp3');
  // Future: register missionAccept with your own acceptance effect file.
})(window);
