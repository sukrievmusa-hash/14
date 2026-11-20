// Звуки без файлов: рёв, зов, укусы, шаги, вода и звуки леса синтезируются прямо в браузере.
let ctx = null, noise = null, master = null, amb = null;
export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // ветер: тихий шум, всегда играет
    const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
    amb = ctx.createGain(); amb.gain.value = 0.05;
    s.connect(f).connect(amb).connect(master); s.start();
  } catch (e) { ctx = null; }
}
const lastT = {};
const ok = (k, ms) => { const n = performance.now(); if (n - (lastT[k] || 0) < ms) return false; lastT[k] = n; return true; };
function env(g, t, a, peak, dur) { peak = Math.max(peak, 0.0002); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); }
function nz(t, dur, type, f0, f1, q, peak, a = 0.004) {
  const s = ctx.createBufferSource(); s.buffer = noise;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain(); env(g, t, a, peak, dur);
  s.connect(f).connect(g).connect(master); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}
function tone(t, dur, type, f0, f1, peak, a = 0.004) {
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain(); env(g, t, a, peak, dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
}
// голос животного: пила с вибрато через два фильтра-форманты + рычащий шум
function voice(t, dur, f0, f1, vol, rough = 0.5, a = 0.08) {
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * 1.15, t + dur * 0.3); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const lfo = ctx.createOscillator(); lfo.frequency.value = 18 + Math.random() * 10;
  const lg = ctx.createGain(); lg.gain.value = f0 * 0.06 * (0.5 + rough); lfo.connect(lg).connect(o.frequency);
  const f1f = ctx.createBiquadFilter(); f1f.type = 'bandpass'; f1f.frequency.value = f0 * 3.2; f1f.Q.value = 2.5;
  const f2f = ctx.createBiquadFilter(); f2f.type = 'lowpass'; f2f.frequency.value = f0 * 9;
  const g = ctx.createGain(); env(g, t, a, vol, dur);
  o.connect(f2f).connect(g); o.connect(f1f).connect(g); g.connect(master);
  o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  if (rough > 0) nz(t, dur * 0.9, 'bandpass', f0 * 4, f0 * 2, 1.5, vol * rough * 0.5, a);
}

export const sfx = {
  // шаг: глухой удар, тем ниже и громче, чем тяжелее животное (w: 0..1)
  step(w, vol) {
    if (!ctx || vol < 0.04 || !ok('step', 70)) return; const t = ctx.currentTime;
    if (w > 0.25) tone(t, 0.12 + w * 0.25, 'sine', 90 - w * 50, 30, 0.6 * vol * w);
    nz(t, 0.06 + w * 0.08, 'lowpass', 900 - w * 500, 300, 0.8, 0.25 * vol * (0.3 + w));
  },
  splash(vol = 1) { if (!ctx || vol < 0.04 || !ok('splash', 120)) return; const t = ctx.currentTime; nz(t, 0.25, 'bandpass', 1400, 600, 1.2, 0.25 * vol, 0.01); },
  bite(vol = 1) {
    if (!ctx || !ok('bite', 60)) return; const t = ctx.currentTime;
    nz(t, 0.09, 'lowpass', 2400, 600, 1, 0.9 * vol);
    tone(t, 0.07, 'square', 180, 70, 0.18 * vol);
    nz(t + 0.04, 0.1, 'bandpass', 3200, 1600, 3, 0.35 * vol);
  },
  whoosh(vol = 1) { if (!ctx || !ok('whoosh', 60)) return; nz(ctx.currentTime, 0.25, 'bandpass', 300, 1600, 1.4, 0.3 * vol, 0.06); },
  thud(vol = 1) { if (!ctx || !ok('thud', 60)) return; const t = ctx.currentTime; tone(t, 0.3, 'sine', 120, 35, 0.9 * vol); nz(t, 0.2, 'lowpass', 600, 120, 1, 0.5 * vol); },
  // p — высота голоса (меньше животное — выше), vol — громкость по расстоянию
  roar(p = 1, vol = 1) { if (!ctx || vol < 0.03 || !ok('roar', 300)) return; voice(ctx.currentTime, 1.3, 75 * p, 48 * p, 0.55 * vol, 0.9, 0.12); },
  call(p = 1, vol = 1) {
    if (!ctx || vol < 0.03 || !ok('call', 250)) return; const t = ctx.currentTime;
    voice(t, 0.55, 140 * p, 120 * p, 0.38 * vol, 0.25, 0.05);
    voice(t + 0.6, 0.8, 160 * p, 95 * p, 0.42 * vol, 0.3, 0.05);
  },
  hurt(p = 1, vol = 1) { if (!ctx || vol < 0.04 || !ok('hurt', 200)) return; voice(ctx.currentTime, 0.4, 200 * p, 110 * p, 0.35 * vol, 0.6, 0.02); },
  chew(vol = 1) { if (!ctx || !ok('chew', 260)) return; const t = ctx.currentTime; nz(t, 0.08, 'lowpass', 1500, 500, 1, 0.3 * vol); nz(t + 0.12, 0.07, 'lowpass', 1300, 400, 1, 0.22 * vol); },
  slurp(vol = 1) { if (!ctx || !ok('slurp', 300)) return; const t = ctx.currentTime; nz(t, 0.18, 'bandpass', 700, 1500, 4, 0.25 * vol, 0.03); tone(t + 0.05, 0.1, 'sine', 500, 900, 0.05 * vol); },
  sniff(vol = 1) { if (!ctx || !ok('sniff', 300)) return; const t = ctx.currentTime; for (let i = 0; i < 3; i++) nz(t + i * 0.13, 0.1, 'highpass', 2500, 4000, 1, 0.18 * vol, 0.03); },
  grow() { if (!ctx) return; const t = ctx.currentTime; [523, 659, 784, 1046].forEach((f, i) => tone(t + i * 0.1, 0.35, 'triangle', f, f, 0.16)); },
  // звуки леса: птицы днём, сверчки ночью
  ambient(night) {
    if (!ctx || !ok('amb', 1500) || Math.random() < 0.45) return; const t = ctx.currentTime;
    if (night) { for (let i = 0; i < 6; i++) tone(t + i * 0.07, 0.04, 'sine', 4200 + Math.random() * 300, 4300, 0.025); }
    else { const f = 1800 + Math.random() * 1600, n = 2 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) tone(t + i * 0.16, 0.12, 'sine', f, f * (1.2 + Math.random() * 0.4), 0.03); }
  },
};
