// Звуки без файлов: генерируются Web Audio прямо в браузере.
let ctx = null, noise = null, master = null;
export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { ctx = null; }
}
function env(g, t, a, peak, dur) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); }

export const sfx = {
  bite(vol = 1) {
    if (!ctx) return; const t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = noise;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    const g = ctx.createGain(); env(g, t, 0.005, 0.8 * vol, 0.18);
    s.connect(f).connect(g).connect(master); s.start(t); s.stop(t + 0.2);
  },
  roar(pitch = 1, vol = 1) {
    if (!ctx) return; const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(140 * pitch, t); o.frequency.exponentialRampToValueAtTime(55 * pitch, t + 0.8);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
    const g = ctx.createGain(); env(g, t, 0.05, 0.5 * vol, 0.9);
    o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + 0.95);
  },
  hurt() {
    if (!ctx) return; const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.25);
    const g = ctx.createGain(); env(g, t, 0.005, 0.9, 0.3);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.32);
  },
  eat() {
    if (!ctx) return; const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(900, t + 0.08);
    const g = ctx.createGain(); env(g, t, 0.005, 0.15, 0.12);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.13);
  },
  levelUp() {
    if (!ctx) return; const t = ctx.currentTime;
    [523, 659, 784, 1046].forEach((fr, i) => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = fr;
      const g = ctx.createGain(); env(g, t + i * 0.08, 0.01, 0.25, 0.25);
      o.connect(g).connect(master); o.start(t + i * 0.08); o.stop(t + i * 0.08 + 0.3);
    });
  },
};
