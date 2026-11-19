// Анимация роботов: шаги без скольжения (фаза ног зависит от пройденного пути), колени, вес шага,
// наклоны корпуса, хвост-пружина и позы атак «замах → удар → возврат».
import { WATER_Y } from './world.js';

const PI = Math.PI, TAU = PI * 2;
const cl = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const eo = u => 1 - (1 - u) * (1 - u);
const eio = u => u * u * (3 - 2 * u);
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > PI) d -= TAU; if (d < -PI) d += TAU; return d; };

// Тайминги (сек): w — замах, s — удар, d — вся анимация, h — момент попадания (по умолчанию середина удара)
export const AN = {
  bite: { w: 0.22, s: 0.12, d: 0.7 },
  slap: { w: 0.2, s: 0.12, d: 0.62 },
  ram: { w: 0.3, s: 0.15, d: 0.9 },
  tailwhip: { w: 0.28, s: 0.2, d: 0.85 },
  clawR: { w: 0.1, s: 0.08, d: 0.36 },
  clawL: { w: 0.1, s: 0.08, d: 0.36 },
  kick: { w: 0.16, s: 0.14, d: 0.6 },
  tailflick: { w: 0.12, s: 0.12, d: 0.45 },
  saw: { w: 0.25, s: 0.7, d: 1.15, loop: 1, ticks: [0.15, 0.5, 0.85] },
  claws2: { w: 0.25, s: 0.1, d: 0.7 },
  shock: { w: 0.3, s: 0.12, d: 0.75, cr: 1 },
  gore: { w: 0.25, s: 0.12, d: 0.75 },
  hornswipe: { w: 0.2, s: 0.12, d: 0.65 },
  rearstomp: { w: 0.45, s: 0.1, d: 1.0 },
  tailside: { w: 0.2, s: 0.15, d: 0.7 },
  tailslam: { w: 0.4, s: 0.12, d: 1.1 },
  bash: { w: 0.22, s: 0.12, d: 0.7 },
  spikes: { w: 0.25, s: 0.1, d: 0.7 },
  // спецприёмы
  clamp: { w: 0.25, s: 0.1, d: 0.7 },
  leap: { w: 0.15, s: 0.5, d: 0.75, h: 0.15 },
  charge: { w: 0.35, s: 0.1, d: 0.8, cr: 1, h: 0.35 },
  paw: { w: 0.35, s: 0.55, d: 1.0, h: 0.35 },
  quills: { w: 0.3, s: 0.1, d: 0.8 },
  // ультимейты
  roar: { w: 0.3, s: 0.5, d: 1.1, h: 0.3 },
  launch: { w: 0.25, s: 0.3, d: 0.9, h: 0.25 },
  storm: { w: 0.3, s: 2.0, d: 2.5, cr: 1, h: 0.3 },
  quake: { w: 0.55, s: 0.12, d: 1.2 },
  fortress: { w: 0.25, s: 0.3, d: 0.9, h: 0.25 },
};
for (const a of Object.values(AN)) if (a.h === undefined) a.h = a.w + a.s * 0.5;
export const hitTimes = an => (an.ticks ? an.ticks.map(k => an.w + an.s * k) : [an.h]);

// Каналы позы (каждый кадр обнуляются). Смещения bY/bZ/hZ/up — в «единицах Рекса», масштабируются под размер.
const P = {};
const CH = ['bY', 'bZ', 'pitch', 'roll', 'tw', 'hP', 'hY', 'hR', 'hZ', 'jaw', 'tY', 'tP', 'kY', 'kP', 'aL', 'aR', 'aLz', 'aRz', 'up', 'saw',
  'lF', 'kF', 'lB', 'kB', 'paw', 'kickH', 'kickK', 'supH', 'supK'];
function reset() { for (const k of CH) P[k] = 0; P.legMode = 0; P.kickOn = false; }

// V(A, B): A — поза в конце замаха, B — в момент удара; потом плавно возвращается к 0
function mk(t, an, hold) {
  const w = an.w, e1 = w + an.s, e2 = e1 + hold, d = an.d + hold;
  let st, u;
  if (t < w) { st = 0; u = eo(t / w); }
  else if (t < e1) { st = 1; u = eo((t - w) / an.s); }
  else if (t < e2) { st = 1; u = 1; }
  else { st = 2; u = eio(cl((t - e2) / Math.max(0.01, d - e2))); }
  return (A, B) => (st === 0 ? A * u : st === 1 ? A + (B - A) * u : B * (1 - u));
}
const jawSnap = (t, an, open) => (t < an.w ? open * eo(t / an.w) : t < an.w + an.s ? open * (1 - eo((t - an.w) / an.s)) : 0);
function arm(sd, v, z) { if (sd > 0) { P.aL += v; P.aLz += z; } else { P.aR += v; P.aRz += z; } }

const POSE = {
  bite(V, t, an) { P.hP += V(-0.35, 0.35); P.hZ += V(-0.35, 0.8); P.jaw = jawSnap(t, an, 0.85); P.pitch += V(-0.06, 0.1); P.bZ += V(-0.2, 0.45); },
  clamp(V, t, an, e, A) {
    const h0 = an.w + an.s, hold = A.hold || 0;
    P.hP += V(-0.35, 0.3); P.hZ += V(-0.35, 0.7); P.pitch += V(-0.06, 0.12); P.bZ += V(-0.2, 0.45);
    if (t < h0) P.jaw = jawSnap(t, an, 1.0);
    else if (t < h0 + hold) { // держит и трясёт головой, как пёс
      P.jaw = 0.12; P.hY += Math.sin(t * 24) * 0.32; P.roll += Math.sin(t * 24) * 0.05; P.hP += Math.sin(t * 31) * 0.06;
    }
  },
  slap(V, t, an, e) { const d = e.dir; arm(d, V(-1.6, 0.6), V(0.5, -0.25)); P.tw += V(d * 0.25, -d * 0.42); P.hY += V(d * 0.15, -d * 0.2); P.roll += V(d * 0.04, -d * 0.06); },
  ram(V) { P.bY += V(-0.28, 0.05); P.pitch += V(-0.12, 0.2); P.hP += V(0.25, 0.45); P.hZ += V(-0.3, 0.6); P.bZ += V(-0.45, 0.9); P.aL += V(0.3, -0.6); P.aR += V(0.3, -0.6); },
  tailwhip(V, t, an, e) { const d = e.dir; P.tw += V(-0.35, 0.7) * d; P.tY += V(-0.6, 0.6) * d; P.kY += V(-0.4, 0.7) * d; P.tP += V(0.15, 0.05); P.roll += V(0.04, -0.07) * d; P.hY += V(0.3, -0.3) * d; },
  claw(V, t, an, e, A) {
    const sd = (A.mv && A.mv.side) || e.dir;
    arm(sd, V(-2.0, 0.75), V(0.5, -0.25)); arm(-sd, V(-0.5, 0.1), 0);
    P.tw += V(sd * 0.3, -sd * 0.5); P.hP += V(-0.1, 0.25); P.hZ += V(0, 0.35); P.pitch += V(-0.05, 0.12);
  },
  kick(V, t, an) {
    P.bY += V(-0.3, 0.05); P.kickOn = true;
    P.kickH = V(-0.4, -1.5); P.kickK = V(1.6, 0.05); P.supH = V(0.2, 0.45); P.supK = V(0.6, 0.7);
    P.pitch += V(0.15, -0.3); P.aL += V(-0.6, -0.9); P.aR += V(-0.6, -0.9); P.tP += V(0.1, 0.3);
    if (t > an.w) P.up += Math.sin(PI * cl((t - an.w) / (an.s + 0.18))) * 0.9;
  },
  tailflick(V, t, an, e) { const d = e.dir; P.tw += V(-0.25, 0.5) * d; P.tY += V(-0.7, 0.9) * d; P.kY += V(-0.5, 0.9) * d; P.tP += V(0.2, 0.15); },
  tailside(V, t, an, e) { const d = e.dir; P.tw += V(-0.15, 0.3) * d; P.tY += V(-0.7, 0.9) * d; P.kY += V(-0.5, 0.8) * d; P.tP += V(0.2, 0.1); },
  tailslam(V) { P.tP += V(1.0, -0.12); P.kP += V(0.6, -0.3); P.pitch += V(0.1, -0.03); P.bY += V(-0.05, -0.15); P.hP += V(0.15, 0); },
  bash(V, t, an, e) { const d = e.dir; P.tw += V(0.3, -0.4) * d; P.roll += V(-0.1, 0.15) * d; P.bZ += V(-0.2, 0.5); P.hP += V(0.3, 0.1); },
  saw(V, t, an, e) {
    // хвост с пилой ходит из стороны в сторону за спиной; корпус помогает бёдрами, но не крутится волчком
    const d = e.dir, w = an.w, s = an.s;
    let y;
    if (t < w) y = 0.95 * d * eo(t / w);
    else if (t < w + s) y = 0.95 * d * Math.cos(TAU * (t - w) / s);
    else y = 0.95 * d * (1 - eio(cl((t - w - s) / (an.d - w - s))));
    P.tY += y; P.kY += y * 0.6; P.tw += y * 0.25; P.tP += V(0.35, 0.3); P.saw = t < w + s ? 1 : 0.3;
  },
  claws2(V) { P.aL += V(-1.8, 0.7); P.aR += V(-1.8, 0.7); P.aLz += V(0.3, -0.1); P.aRz += V(0.3, -0.1); P.pitch += V(-0.15, 0.22); P.bY += V(0.08, -0.1); P.hP += V(-0.2, 0.2); P.jaw = Math.max(P.jaw, V(0.35, 0.1)); },
  shock(V) { P.bY += V(-0.15, 0.08); P.pitch += V(0.08, -0.06); P.hP += V(0.2, -0.25); P.jaw = Math.max(P.jaw, V(0.2, 0.6)); P.aL += V(-0.3, -0.9); P.aR += V(-0.3, -0.9); P.aLz += V(0.2, 0.9); P.aRz += V(0.2, 0.9); },
  gore(V) { P.hP += V(0.55, -0.45); P.hZ += V(-0.25, 0.65); P.bZ += V(-0.3, 0.55); P.pitch += V(0.1, -0.08); P.bY += V(-0.12, 0.05); },
  hornswipe(V, t, an, e) { const d = e.dir; P.hY += V(0.6, -0.75) * d; P.tw += V(0.18, -0.32) * d; P.hP += V(0.25, 0.05); P.roll += V(0.04, -0.06) * d; P.bZ += V(0, 0.25); },
  rearstomp(V) { P.pitch += V(-0.5, 0.14); P.lF += V(-0.75, 0.1); P.kF += V(1.1, 0.15); P.lB += V(0.3, 0.05); P.kB += V(0.3, 0.2); P.hP += V(-0.35, 0.35); P.jaw = Math.max(P.jaw, V(0.4, 0)); P.bY += V(0.1, -0.12); },
  quake(V) { P.pitch += V(-0.66, 0.18); P.lF += V(-0.95, 0.15); P.kF += V(1.3, 0.1); P.lB += V(0.35, 0.05); P.kB += V(0.35, 0.25); P.hP += V(-0.5, 0.45); P.jaw = Math.max(P.jaw, V(0.6, 0)); P.bY += V(0.15, -0.2); },
  spikes(V) { P.pitch += V(0.12, -0.1); P.bY += V(-0.12, 0.06); P.hP += V(0.25, -0.1); },
  quills(V, t) { P.bY += V(-0.3, 0.12); P.pitch += V(0.05, -0.05); if (t < 0.3) P.roll += Math.sin(t * 40) * 0.02; P.tP += V(0.3, -0.05); },
  leap(V, t, an) { if (t < an.w) { P.bY += V(-0.35, 0); P.pitch += V(0.25, 0); P.aL += V(-0.6, 0); P.aR += V(-0.6, 0); } },
  charge(V, t) { P.pitch += V(-0.15, 0.12); P.hP += V(-0.4, 0.3); P.jaw = Math.max(P.jaw, V(0.5, 0.8)); P.aLz += V(0.4, 0.2); P.aRz += V(0.4, 0.2); P.bY += V(-0.1, 0.05); P.hY += Math.sin(t * 40) * 0.03; },
  paw(V, t, an) {
    if (t < an.w) { P.bY += V(-0.2, 0); P.pitch += V(0.1, 0); P.hP += V(0.4, 0); P.paw = Math.sin(t * 22) * 0.45 - 0.25; }
    else { P.hP += V(0.4, 0.4); P.pitch += V(0.1, 0.1); }
  },
  roar(V, t, an) {
    P.hP += V(0.25, -0.75); P.jaw = Math.max(P.jaw, V(0.1, 1.0)); P.pitch += V(0.1, -0.18);
    P.aL += V(0.2, -0.8); P.aR += V(0.2, -0.8); P.aLz += V(0, 0.6); P.aRz += V(0, 0.6);
    if (t > an.w && t < an.w + an.s) P.hY += Math.sin(t * 30) * 0.12;
  },
  launch(V) { P.bY += V(-0.25, 0); P.pitch += V(0.1, -0.3); P.tP += V(0, 0.4); P.aL += V(-0.3, -1.0); P.aR += V(-0.3, -1.0); },
  storm(V, t, an) {
    P.pitch += V(-0.15, -0.28); P.hP += V(-0.3, -0.7); P.jaw = Math.max(P.jaw, V(0.3, 0.9));
    P.aLz += V(0.3, 1.0); P.aRz += V(0.3, 1.0); P.aL += V(-0.5, -1.4); P.aR += V(-0.5, -1.4);
    if (t > an.w) P.roll += Math.sin(t * 35) * 0.015;
  },
  fortress(V) { P.bY += V(-0.35, -0.3); P.tP += V(0.2, 0.1); P.hP += V(0.3, 0.2); },
};
POSE.clawL = POSE.clawR = POSE.claw;

// H — крючки для эффектов: step(e, leg), strike(e, act), wind(e, act, dt), loop(e, act, dt)
export function animate(e, dt, time, H) {
  const m = e.m, S = e.S, s = e.scale, hip = m.hipH, k = hip / 2;
  if (e._px === undefined) {
    e._px = e.x; e._pz = e.z; e._prot = e.rot; e._vs0 = 0;
    e.vs = 0; e.walk = Math.random() * TAU; e.amp = 0; e.lean = 0; e.bank = 0; e.tYs = 0; e.kYs = 0; e.thump = 0;
    e.scanY = 0; e.scanTo = 0; e.scanT = 1;
  }
  // реальное перемещение за кадр — работает одинаково для своих, ботов и чужих игроков
  let dist = Math.hypot(e.x - e._px, e.z - e._pz); e._px = e.x; e._pz = e.z;
  if (dist > 4) dist = 0;
  let drot = angDiff(e._prot, e.rot); e._prot = e.rot;
  if (Math.abs(drot) > 0.5) drot = 0;
  const idt = 1 / Math.max(dt, 1e-3);
  const air = e.rideUp != null || e.leapH > 0.05;
  e.vs += (dist * idt - e.vs) * Math.min(1, dt * 8);
  const turn = drot * idt;
  const rel = Math.min(1.3, e.vs / S.run);
  const moving = !air && (e.vs > 0.35 || Math.abs(turn) > 0.6);
  const ampT = moving ? 0.2 + 0.36 * Math.min(1, rel) + (Math.abs(turn) > 0.6 && e.vs < 1 ? 0.08 : 0) : 0;
  e.amp += (ampT - e.amp) * Math.min(1, dt * (ampT > e.amp ? 9 : 5));
  const A = Math.max(e.amp, 0.18);
  // фаза шага: длина шага зависит от длины ноги и размаха — ступни не скользят по земле
  if (!air) e.walk += Math.min(32 * dt, TAU * (dist + Math.abs(drot) * e.radius() * 0.7) / (4.8 * A * hip * s));

  reset();
  const W = S.weight, sw = Math.sin(e.walk);
  e.thump *= Math.exp(-dt * 9);
  let locoY = -Math.abs(sw) * e.amp * 0.12 * hip * (0.5 + W * 0.5) - e.thump * 0.05 * hip * W
    + Math.sin(time * 1.7 + e.seed) * 0.018 * hip * (1 - Math.min(1, e.amp * 4)); // в покое — «дыхание» гидравлики
  P.roll = sw * e.amp * (m.quad ? 0.025 : 0.06);
  const accel = (e.vs - e._vs0) * idt; e._vs0 = e.vs;
  e.lean += (cl(rel * 0.06 + accel * 0.004, -0.1, 0.14) - e.lean) * Math.min(1, dt * 4);
  P.pitch = e.lean;
  e.bank += (cl(-turn * (0.25 + rel) * 0.035, -0.13, 0.13) - e.bank) * Math.min(1, dt * 5);
  P.roll += e.bank;
  P.hP = -e.lean * 0.6 + Math.sin(e.walk * 2) * e.amp * 0.04;
  e.tYs += (cl(-turn * 0.14 + sw * e.amp * 0.22 + Math.sin(time * 1.2 + e.seed) * 0.06, -0.6, 0.6) - e.tYs) * Math.min(1, dt * 5);
  e.kYs += (e.tYs * 0.7 - e.kYs) * Math.min(1, dt * 3);
  P.tY = e.tYs; P.kY = e.kYs; P.tP = -0.03 + rel * 0.1; P.kP = 0.03 + rel * 0.05;
  P.aL = sw * e.amp * 0.35 - rel * 0.25; P.aR = -sw * e.amp * 0.35 - rel * 0.25;
  // в покое голова «сканирует» местность рывками, как сервопривод
  e.scanT -= dt;
  if (e.scanT <= 0) { e.scanT = 0.8 + Math.random() * 2; e.scanTo = (Math.random() - 0.5) * 0.9; }
  e.scanY += (e.scanTo - e.scanY) * Math.min(1, dt * 9);
  if (!e.act) P.hY = e.scanY * (1 - Math.min(1, e.amp * 3));
  // реакция на попадание: корпус откидывает назад и в сторону
  if (e.react > 0) {
    e.react = Math.max(0, e.react - dt * 4);
    const r = Math.sin(e.react * PI * 0.5);
    P.pitch -= r * 0.12; P.bZ -= r * 0.22; P.roll += r * 0.1 * (e.reactSide || 0); P.hP -= r * 0.25;
  }
  if (e.stunT > 0) { P.roll += Math.sin(time * 30) * 0.04; P.hP += 0.25; P.hY += Math.sin(time * 23) * 0.15; P.hR = Math.sin(time * 40) * 0.12; }
  if (e.shieldT > 0) P.bY -= 0.12;
  if (e.rideUp != null) { P.legMode = 2; P.pitch += 0.25; P.aL -= 0.9; P.aR -= 0.9; }
  else if (air) { P.legMode = 1; P.tP += 0.3; P.aL -= 1.3; P.aR -= 1.3; P.pitch += -0.25 + 0.5 * cl(1 - e.leapH / Math.max(0.1, e.leapPeak || 1)); }

  // поза атаки
  const act = e.act;
  if (act) {
    const an = AN[act.an];
    if (!e.local) act.t += dt;
    if (!an || act.t > an.d + (act.hold || 0)) e.act = null;
    else {
      POSE[act.an](mk(act.t, an, act.hold || 0), act.t, an, e, act);
      if (!act.fx && act.t >= an.h) { act.fx = true; H.strike(e, act); }
      if (an.cr && act.t < an.w) H.wind(e, act, dt);
      if (an.loop && act.t >= an.w && act.t < an.w + an.s) H.loop(e, act, dt);
    }
  }

  // ---- применяем позу ----
  const up = (e.rideUp != null ? e.rideUp : e.leapH || 0) + P.up * k * s;
  m.root.position.set(e.x, Math.max(e.y, WATER_Y - 1.2 * s) + up, e.z);
  m.root.rotation.y = e.rot;
  m.root.scale.setScalar(s);
  // корпус вращается вокруг линии бёдер: при вставании на дыбы — вокруг задних, при наклоне — вокруг передних
  const qz = m.quad ? (P.pitch < 0 ? m.hindZ : m.frontZ) : m.hindZ;
  const cp = Math.cos(P.pitch), sp = Math.sin(P.pitch), ct = Math.cos(P.tw), st = Math.sin(P.tw);
  const qy2 = hip * cp - qz * sp, qz2 = hip * sp + qz * cp;
  const bY = locoY + P.bY * k, bZ = P.bZ * k;
  m.body.position.set(-qz2 * st, bY + hip - qy2, bZ + qz - qz2 * ct);
  m.body.rotation.set(P.pitch, P.tw, P.roll);
  // присед: колени сгибаются, чтобы ступни не уходили в землю
  const drop = Math.max(0, -bY), kneeX = Math.min(0.7, drop / (hip * 0.5) * 1.3), hipX = -kneeX * 0.5;
  for (const L of m.legs) {
    const [px, py, pz] = L.base;
    const y1 = py * cp - pz * sp, z1 = py * sp + pz * cp;
    L.pivot.position.set(m.body.position.x + px * ct + z1 * st, m.body.position.y + y1, m.body.position.z - px * st + z1 * ct);
    L.pivot.rotation.y = P.tw;
    const ph = e.walk + L.ph, sn = Math.sin(ph), cs = Math.cos(ph);
    let h = sn * e.amp, kn = Math.max(0, -cs) * e.amp * 1.9 + e.amp * 0.12;
    // ступня встаёт на землю в конце переноса ноги — здесь «шаг»
    const n = Math.floor((ph - 1.5 * PI) / TAU);
    if (n !== L.n) { if (L.n !== undefined && e.amp > 0.13 && !air) H.step(e, L); L.n = n; }
    h += hipX; kn += kneeX;
    if (m.quad) {
      if (L.front) { h += P.lF; kn += P.kF; if (L.side > 0) { h += P.paw; kn += Math.max(0, -P.paw) * 1.2; } }
      else { h += P.lB; kn += P.kB; }
    } else if (P.kickOn) {
      if (L.side > 0) { h = P.kickH; kn = P.kickK; } else { h += P.supH; kn += P.supK; }
    }
    if (P.legMode === 1) { h = h * 0.15 - 0.8; kn = kn * 0.15 + 1.5; }
    else if (P.legMode === 2) { h = -0.35 + Math.sin(time * 9 + L.ph) * 0.05; kn = 1.3; }
    L.pivot.rotation.x = h; L.knee.rotation.x = Math.max(0, kn);
  }
  m.head.position.set(m.headP[0], m.headP[1], m.headP[2] + P.hZ * k);
  m.head.rotation.set(P.hP, P.hY, P.hR);
  m.jaw.rotation.x = Math.max(0, P.jaw);
  m.tail.rotation.set(P.tP, P.tY, 0);
  m.tip.rotation.set(P.kP, P.kY, 0);
  if (m.saw) m.saw.rotation.x -= dt * (3 + P.saw * 38);
  for (const a of m.arms) {
    const left = a.side > 0;
    a.pivot.rotation.x = left ? P.aL : P.aR;
    a.pivot.rotation.z = (left ? P.aLz : P.aRz) * a.side;
  }
}
