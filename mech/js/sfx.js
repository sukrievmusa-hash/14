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
// не даём одному звуку срабатывать чаще, чем раз в ms (телефонам тяжело с сотней звуков)
const lastT = {};
const ok = (k, ms) => { const n = performance.now(); if (n - (lastT[k] || 0) < ms) return false; lastT[k] = n; return true; };
function nz(t, dur, type, f0, f1, q, peak, a = 0.004) {
  const s = ctx.createBufferSource(); s.buffer = noise;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain(); env(g, t, a, peak, dur);
  s.connect(f).connect(g).connect(master); s.start(t); s.stop(t + dur + 0.02);
}
function tone(t, dur, type, f0, f1, peak, a = 0.004) {
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain(); env(g, t, a, peak, dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function env(g, t, a, peak, dur) {
  peak = Math.max(peak, 0.0002); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); }

export const sfx = {
  // тяжёлый металлический шаг: глухой удар + звон + шипение гидравлики (w — вес робота)
  step(w = 1, vol = 1) {
    if (!ctx || vol < 0.03 || !ok('step', w > 0.6 ? 55 : 90)) return; const t = ctx.currentTime;
    tone(t, 0.16 + w * 0.12, 'sine', 120 - w * 55, 38, 0.55 * vol * (0.4 + w * 0.6));
    nz(t, 0.05, 'bandpass', 2200 - w * 900, 2200 - w * 900, 4, 0.12 * vol);
    if (w > 0.6) nz(t + 0.03, 0.12, 'highpass', 5000, 5000, 0.7, 0.035 * vol * w, 0.02);
  },
  // свист замаха
  whoosh(p = 1, vol = 1) {
    if (!ctx || vol < 0.03 || !ok('whoosh', 40)) return; const t = ctx.currentTime;
    nz(t, 0.22, 'bandpass', 350 * p, 2200 * p, 1.6, 0.35 * vol, 0.05);
  },
  // сервопривод: короткое «вжжж» робота при замахе
  servo(p = 1, vol = 1) {
    if (!ctx || vol < 0.03 || !ok('servo', 60)) return; const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(180 * p, t); o.frequency.exponentialRampToValueAtTime(420 * p, t + 0.12);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
    const g = ctx.createGain(); env(g, t, 0.01, 0.06 * vol, 0.14);
    o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + 0.16);
  },
  // хруст челюстей
  crunch(vol = 1) {
    if (!ctx || !ok('crunch', 50)) return; const t = ctx.currentTime;
    nz(t, 0.12, 'lowpass', 1800, 500, 1, 0.8 * vol);
    tone(t, 0.06, 'square', 260, 120, 0.15 * vol);
    nz(t + 0.05, 0.08, 'bandpass', 3000, 3000, 3, 0.3 * vol);
  },
  // рубящий клинок
  slash(vol = 1) {
    if (!ctx || !ok('slash', 40)) return; const t = ctx.currentTime;
    nz(t, 0.08, 'highpass', 3500, 3500, 0.8, 0.45 * vol);
    tone(t, 0.25, 'triangle', 2400, 1900, 0.09 * vol);
  },
  // тяжёлый удар (хвост-молот, таран, топот)
  thud(vol = 1) {
    if (!ctx || !ok('thud', 50)) return; const t = ctx.currentTime;
    tone(t, 0.35, 'sine', 95, 32, 0.9 * vol);
    nz(t, 0.25, 'lowpass', 900, 120, 1, 0.7 * vol);
    nz(t, 0.1, 'bandpass', 1600, 1600, 3, 0.25 * vol);
  },
  // хлыст хвоста
  whip(vol = 1) {
    if (!ctx || !ok('whip', 40)) return; const t = ctx.currentTime;
    nz(t, 0.05, 'highpass', 2500, 2500, 0.7, 0.5 * vol);
    tone(t, 0.18, 'sine', 140, 60, 0.4 * vol);
  },
  // визг пилы
  saw(vol = 1) {
    if (!ctx || !ok('saw', 90)) return; const t = ctx.currentTime;
    tone(t, 0.2, 'sawtooth', 620, 540, 0.08 * vol);
    nz(t, 0.18, 'bandpass', 4200, 3600, 5, 0.35 * vol);
  },
  // электрический разряд
  zap(vol = 1) {
    if (!ctx || !ok('zap', 50)) return; const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square';
    for (let i = 0; i < 6; i++) o.frequency.setValueAtTime(200 + Math.random() * 1600, t + i * 0.03);
    const g = ctx.createGain(); env(g, t, 0.003, 0.16 * vol, 0.2);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.22);
    nz(t, 0.2, 'highpass', 3000, 3000, 0.7, 0.3 * vol);
  },
  // выстрел шипом / запуск ракеты
  shoot(vol = 1) {
    if (!ctx || !ok('shoot', 45)) return; const t = ctx.currentTime;
    nz(t, 0.12, 'bandpass', 900, 2600, 2, 0.4 * vol);
    tone(t, 0.08, 'square', 300, 160, 0.06 * vol);
  },
  rocket(vol = 1) {
    if (!ctx || !ok('rocket', 50)) return; const t = ctx.currentTime;
    nz(t, 0.45, 'bandpass', 300, 3000, 1.2, 0.35 * vol, 0.03);
  },
  // шипение пара
  steam(vol = 1) {
    if (!ctx || !ok('steam', 120)) return; const t = ctx.currentTime;
    nz(t, 0.6, 'highpass', 4000, 6000, 0.6, 0.18 * vol, 0.05);
  },
  // металлический лязг удара
  clank(vol = 1) {
    if (!ctx) return; const t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 3;
    const g = ctx.createGain(); env(g, t, 0.003, 0.9 * vol, 0.15);
    s.connect(f).connect(g).connect(master); s.start(t); s.stop(t + 0.16);
    [523, 1390].forEach(fr => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = fr * (0.9 + Math.random() * 0.2);
      const og = ctx.createGain(); env(og, t, 0.002, 0.12 * vol, 0.35);
      o.connect(og).connect(master); o.start(t); o.stop(t + 0.36);
    });
  },
  // взрыв при уничтожении меха
  boom() {
    if (!ctx) return; const t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = noise;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(1200, t); f.frequency.exponentialRampToValueAtTime(80, t + 0.6);
    const g = ctx.createGain(); env(g, t, 0.01, 1.0, 0.7);
    s.connect(f).connect(g).connect(master); s.start(t); s.stop(t + 0.5);
  },
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
    o.frequency.setValueAtTime(90 * pitch, t); o.frequency.exponentialRampToValueAtTime(220 * pitch, t + 0.25); o.frequency.exponentialRampToValueAtTime(60 * pitch, t + 0.8);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 28; const lg = ctx.createGain(); lg.gain.value = 25 * pitch;
    lfo.connect(lg).connect(o.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    const g = ctx.createGain(); env(g, t, 0.04, 0.45 * vol, 0.9);
    o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + 0.95); lfo.start(t); lfo.stop(t + 0.95);
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
