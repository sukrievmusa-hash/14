import * as THREE from 'three';
import { SPECIES, SP_KEYS, STAGES, buildDino, setFlash, growthScale, statMul, stageIndex } from './species.js';
import { World, height, inWater, MAP_R, WATER_Y } from './world.js';
import { connect } from './net.js';
import { sfx, initAudio } from './sfx.js';
import { createFx } from './fx.js';
import { animate, AN, hitTimes } from './anim.js';

const $ = id => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const isMobile = isTouch || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
document.body.classList.toggle('touch', isTouch);

// ================= Рендер =================
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, powerPreference: 'high-performance' });
let pixelRatio = Math.min(window.devicePixelRatio || 1, isMobile ? 1.25 : 1.75);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
const scene = new THREE.Scene();
const SKY = 0xa9d9f2;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 70, 215);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.3, 230);
scene.add(new THREE.HemisphereLight(0xe3f3ff, 0x5b6d3c, 2.0));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.4); sun.position.set(60, 100, 40); scene.add(sun);
const world = new World(scene);
function onResize() {
  renderer.setSize(innerWidth, innerHeight);
  // на узком (вертикальном) экране шире угол обзора, чтобы мех влезал
  camera.fov = innerWidth < innerHeight ? 75 : 60;
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', onResize); onResize();

// ================= Состояние =================
const clientId = Math.random().toString(36).slice(2, 10);
const ents = new Map();          // id -> Mech
const peers = new Map();         // peerId -> { c: clientId, t: время }
let me = null, net = null, mode = null, netStatus = 'off', netStart = 0;
let life = 0, botN = 0, botTimer = 0, sendTimer = 0, hudTimer = 0, mapTimer = 0;
let camYaw = 0, camPitch = 0.34, shake = 0, playing = false, lastCamInput = 0;
let lifeStats = { start: 0, kills: 0, best: 0 };
const NOW = () => performance.now();
const DBG = { ts: 1, freeze: false, cam: null }; // для отладки: замедление времени, заморозка ботов, своя камера
const BOT_NAMES = ['Клык', 'Шрам', 'Гроза', 'Тень', 'Коготь', 'Буря', 'Титан', 'Ржавый', 'Молния', 'Гром', 'Хищник', 'Рогач', 'Кочевник', 'Болт', 'Поршень', 'Вольт', 'Дизель', 'Сталь'];

const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ================= Подписи над головой =================
function makeLabel() {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  scene.add(sp);
  return { cv, ctx: cv.getContext('2d'), tex, sp, key: '' };
}
function drawLabel(L, name, frac, stage, isBot) {
  const key = name + '|' + Math.round(frac * 20) + '|' + stage;
  if (L.key === key) return; L.key = key;
  const c = L.ctx; c.clearRect(0, 0, 256, 64);
  c.font = 'bold 24px system-ui, sans-serif'; c.textAlign = 'center';
  c.lineWidth = 5; c.strokeStyle = 'rgba(0,0,0,.75)'; c.fillStyle = isBot ? '#ffd9a0' : '#ffffff';
  const t = name + (stage === 4 ? ' ★' : '');
  c.strokeText(t, 128, 26); c.fillText(t, 128, 26);
  c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(48, 38, 160, 12);
  c.fillStyle = frac > 0.5 ? '#5fd35f' : frac > 0.25 ? '#f2c230' : '#e8453c';
  c.fillRect(50, 40, 156 * Math.max(0, frac), 8);
  L.tex.needsUpdate = true;
}

// ================= Мех =================
class Mech {
  constructor(id, sp, name, o = {}) {
    this.id = id; this.sp = sp; this.S = SPECIES[sp]; this.name = name;
    this.local = !!o.local; this.bot = !!o.bot; this.g = o.g ?? 0; this.kills = 0; this.preview = !!o.preview;
    this.m = buildDino(sp); scene.add(this.m.root);
    this.x = o.x || 0; this.z = o.z || 0; this.y = height(this.x, this.z); this.rot = o.rot || 0;
    this.tx = this.x; this.tz = this.z; this.trot = this.rot;
    this.hp = this.maxHp(); this.hpFrac = 1; this.st = 100;
    this.atkT = 0; this.spT = 0; this.ultCd = 0; this.ultT = 0; this.atkFlagT = 0; this.spFlagT = 0; this.ultFlagT = 0;
    this.dashT = 0; this.dashHit = null;
    this.combatT = 0; this.protUntil = o.local && !o.bot ? NOW() + 3000 : 0; this.eatT = 0; this.flashT = 0;
    this.moving = false; this.sprint = false; this.vsp = 0; this.seed = Math.random() * 10;
    this.lastSeen = NOW(); this.peer = null; this.lastAtkFlag = 0; this.lastSpFlag = 0; this.lastUltFlag = 0;
    this.stunT = 0; this.slowT = 0; this.shieldT = 0; this.stunImm = 0; this.kvx = 0; this.kvz = 0;
    this.act = null; this.dir = 1; this.stepF = 0; this.stepR = 0; this.chainT = 0; this.lastMv = 0; this.queued = false; this.combo = 0;
    this.react = 0; this.reactSide = 0; this.leap = null; this.leapH = 0; this.leapPeak = 1; this.rideUp = null; this.rideHost = null; this.dropH = 0;
    this.latch = null; this.clung = false; this.storm = null; this.ringT = 0;
    this.phase = ''; this.phaseT = 0; this.hits = 0; this.orbit = 1; this.orbitT = 2; this.home = null;
    this.label = o.self || o.preview ? null : makeLabel();
    this.think = 0; this.wx = this.x; this.wz = this.z; this.target = null; this.flee = false; this.aggro = null;
  }
  get scale() { return growthScale(this.g); }
  maxHp() { return this.S.hp * statMul(this.g); }
  over() { return this.sp === 'rex' && this.frac() < 0.4; } // Разгон реактора
  boost() { return this.ultT > 0 && this.S.ult.type === 'buff'; } // Форсаж
  dmg() { return this.S.dmg * statMul(this.g) * (this.bot ? 0.8 : 1) * Math.max(this.over() ? 1.35 : 1, this.boost() ? 1.3 : 1); }
  radius() { return this.S.r * this.scale; }
  frac() { return this.local ? this.hp / this.maxHp() : this.hpFrac; }
  speed(run) { return (run ? this.S.run : this.S.spd) * (0.8 + 0.3 * Math.min(this.g, 1)) * (inWater(this.x, this.z) && this.sp !== 'spino' ? 0.6 : 1) * (this.slowT > 0 ? 0.55 : 1) * (this.boost() ? 1.15 : 1); }
  setGrowth(g) { const f = this.hp / this.maxHp(); this.g = Math.min(1, g); this.hp = f * this.maxHp(); }
  flash() { this.flashT = 0.09; }
  // идёт замах или удар (новый удар начинать нельзя)
  busy() { const A = this.act; if (!A) return false; const an = AN[A.an]; return A.t < an.w + an.s + (A.hold || 0); }
  visual(dt, time) {
    this.y = height(this.x, this.z);
    // наездник: раптор сидит точно на спине того, в кого вцепился (и у себя, и у других игроков)
    const prevRide = this.rideUp;
    this.rideUp = null;
    const host = this.local ? (this.latch && this.latch.kind === 'cling' ? ents.get(this.latch.id) : null) : (this.clung ? findHost(this) : null);
    if (host && !host.dead) {
      const R = host.S.ride, hs = host.scale;
      this.x = host.x + Math.sin(host.rot) * R[0] * hs; this.z = host.z + Math.cos(host.rot) * R[0] * hs; this.rot = host.rot;
      this.y = height(this.x, this.z);
      this.rideUp = Math.max(0, host.m.root.position.y + (R[1] + host.m.body.position.y) * hs - Math.max(this.y, WATER_Y - 1.2 * this.scale));
    } else if (!this.local && prevRide != null) this.dropH = prevRide;
    if (this.local) { this.leapH = this.leap ? this.leap.h : 0; if (this.leap) this.leapPeak = this.leap.H + this.leap.h0; }
    else {
      this.leapH = 0;
      if (!host && this.act && this.act.an === 'leap') {
        const an = AN.leap, u = (this.act.t - an.w) / an.s;
        if (u > 0 && u < 1) { this.leapH = 4 * u * (1 - u) * 2.6 * this.scale; this.leapPeak = 2.6 * this.scale; }
      }
      if (this.dropH > 0) { this.dropH = Math.max(0, this.dropH - dt * 10); this.leapH = Math.max(this.leapH, this.dropH); }
      if (this.storm) stormTick(this, dt);
    }
    animate(this, dt, time, HOOKS);
    const s = this.scale;
    this.ringT -= dt;
    if (this.ringT <= 0) {
      if (this.shieldT > 0) { this.ringT = 0.45; ring(this.x, this.y, this.z, this.radius() * 1.6, '#66ccff'); }
      else if (this.over() || this.boost()) { this.ringT = 0.25; fx.steam(this.x - Math.sin(this.rot) * this.radius() * 0.6, this.y + this.S.h * 0.8 * s, this.z - Math.cos(this.rot) * this.radius() * 0.6, 0.6 * s, 1, 3); }
      else if (this.stunT > 0) { this.ringT = 0.12; sparks(this.x, this.y + this.S.h * s, this.z, 0.5, 2); bolt(this.x, this.y + this.S.h * 0.9 * s, this.z, this.x + (Math.random() - 0.5) * 2 * s, this.y + this.S.h * 0.5 * s, this.z + (Math.random() - 0.5) * 2 * s, '#bfe9ff', 2, 0.4); }
    }
    if (this.flashT > 0) { this.flashT -= dt; setFlash(this.m, this.flashT > 0); }
    if (this.label) {
      const L = this.label;
      drawLabel(L, this.name, this.frac(), stageIndex(this.g), this.bot);
      L.sp.position.set(this.x, this.m.root.position.y + (this.S.h + 0.6) * s + 0.6, this.z);
      const d = camera.position.distanceTo(L.sp.position);
      const k = Math.max(1, d * 0.05);
      L.sp.scale.set(3.6 * k, 0.9 * k, 1);
    }
  }
  dispose() {
    scene.remove(this.m.root);
    if (this.label) { scene.remove(this.label.sp); this.label.tex.dispose(); this.label.sp.material.dispose(); }
  }
}
// у кого на спине сидит чужой раптор
function findHost(e) {
  const h = e.rideHost && ents.get(e.rideHost);
  if (h && !h.dead && Math.hypot(h.x - e.x, h.z - e.z) < h.radius() * 2.5 + 3) return h;
  let best = null, bd = 1e9;
  for (const o of ents.values()) { if (o === e || o.dead) continue; const d = Math.hypot(o.x - e.x, o.z - e.z) - o.radius(); if (d < bd) { bd = d; best = o; } }
  if (best && bd < 3) { e.rideHost = best.id; return best; }
  return null;
}

// ================= Эффекты =================
const fx = createFx(scene, camera, height);
const sparks = fx.sparks, ring = fx.ring, bolt = fx.bolt;
const _wp = new THREE.Vector3();
const camD = (x, z) => Math.hypot(camera.position.x - x, camera.position.z - z);
// громкость звука робота: свой — полная, чужие — по расстоянию до камеры, превью в меню — без звука
const volAt = e => (e === me ? 1 : e.preview ? 0 : Math.max(0, 1 - camD(e.x, e.z) / 45) * 0.8);
let camBump = 0, hitStop = 0;
const HOOKS = {
  step: (e, L) => footstep(e, L),
  strike: (e, A) => strikeFx(e, A),
  wind: (e, A, dt) => windFx(e, A, dt),
  loop: (e, A, dt) => loopFx(e, A, dt),
};

// Цифры урона: пул DOM-элементов, проецируем 3D-точку на экран
const nums = [];
for (let i = 0; i < 14; i++) { const el = document.createElement('div'); el.className = 'dmg'; $('nums').appendChild(el); nums.push({ el, life: 0, p: new THREE.Vector3() }); }
let numI = 0;
const _pv = new THREE.Vector3();
function dmgNum(x, y, z, val, mine) {
  const n = nums[numI++ % nums.length];
  n.life = 0.9; n.p.set(x + (Math.random() - 0.5), y, z + (Math.random() - 0.5));
  n.el.textContent = typeof val === 'number' ? '-' + val : val; n.el.className = 'dmg ' + (mine ? 'mine' : 'hurt');
}
function updateNums(dt) {
  for (const n of nums) {
    if (n.life <= 0) { if (n.el.style.opacity !== '0') n.el.style.opacity = '0'; continue; }
    n.life -= dt; n.p.y += dt * 2.5;
    _pv.copy(n.p).project(camera);
    if (_pv.z > 1) { n.el.style.opacity = '0'; continue; }
    const x = (_pv.x * 0.5 + 0.5) * innerWidth, y = (-_pv.y * 0.5 + 0.5) * innerHeight;
    n.el.style.transform = `translate(${x}px, ${y}px) translate(-50%,-50%) scale(${1 + Math.max(0, n.life - 0.7) * 2})`;
    n.el.style.opacity = Math.min(1, n.life * 2.5);
  }
}

// ================= Бой =================
function nearestInFront(a, reach, cone = 1.1, back = false) {
  let best = null, bd = 1e9;
  for (const e of ents.values()) {
    if (e === a || e.dead) continue;
    const dx = e.x - a.x, dz = e.z - a.z, d = Math.hypot(dx, dz) - e.radius();
    if (d > reach) continue;
    const ang = Math.abs(angDiff(back ? a.rot + Math.PI : a.rot, Math.atan2(dx, dz)));
    if (ang > cone && d > a.radius() * 0.3) continue;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
// Автонаведение: если впереди (или сзади для удара хвостом) никого, а враг рядом — доворачиваем.
// Тяжёлые роботы доворачивают немного — их нельзя мгновенно развернуть.
function autoAim(a, reach, mv, rear) {
  if (mv.area === 'around') return;
  if (nearestInFront(a, reach, rear ? mv.arc : (mv.cone || 1.1), rear)) return;
  const t = nearestInFront(a, reach * 1.25, Math.PI);
  if (!t) return;
  const want = Math.atan2(t.x - a.x, t.z - a.z) + (rear ? Math.PI : 0), lim = a.S.turn * 0.4;
  a.rot += Math.max(-lim, Math.min(lim, angDiff(a.rot, want)));
}

const bodyPt = a => [a.x, (a.m ? a.m.root.position.y : a.y) + a.S.h * 0.55 * a.scale, a.z];
const nearEnemies = (a, R) => { const r = []; for (const e of ents.values()) if (e !== a && !e.dead && Math.hypot(e.x - a.x, e.z - a.z) - e.radius() < R) r.push(e); return r; };
const rangeOf = (a, mv) => a.S.reach * a.scale * (mv.reach || 1);
const jit = (k = 0.8) => (Math.random() - 0.5) * k;
function hitSound(snd, v) { if (v < 0.03) return; (sfx[snd] || sfx.clank)(v); if (snd && snd !== 'clank') sfx.clank(v * 0.35); }

function dealDamage(a, t, amount, f, mv) {
  if (!t || t.dead) return;
  amount = Math.round(amount);
  const hy = t.m.root.position.y + t.S.h * 0.55 * t.scale;
  // точка попадания — на стороне цели, обращённой к атакующему
  const dx = a.x - t.x, dz = a.z - t.z, dd = Math.hypot(dx, dz) || 1, hr = t.radius() * 0.7;
  const hx = t.x + dx / dd * hr, hz = t.z + dz / dd * hr;
  if (a === me || t === me || camD(t.x, t.z) < 50) { sparks(hx, hy, hz, Math.max(0.6, t.scale), 7); fx.flash(hx, hy, hz, 0.5 + t.scale * 0.5, a.S.glow); }
  t.flash();
  t.react = Math.min(1, 0.6 + amount / Math.max(1, t.maxHp()) * 4);
  t.reactSide = Math.sign(angDiff(t.rot, Math.atan2(dx, dz))) || 1;
  a.combatT = 6;
  if (a === me) {
    dmgNum(t.x, hy + 1, t.z, amount, true);
    hitSound(mv && mv.snd, 1);
    hitStop = Math.max(hitStop, (mv && mv.stop) || 0.04);
    shake = Math.max(shake, mv && mv.stop ? 0.22 : 0.08);
  } else hitSound(mv && mv.snd, volAt(a) * 0.7);
  if (t.local) applyDamage(t, amount, a.id, a.name, f);
  else if (net && t.peer) net.hit(t.peer, f ? { t: t.id, d: amount, b: a.id, n: a.name, f } : { t: t.id, d: amount, b: a.id, n: a.name });
}

// Кого задевает удар (проверяется в момент удара — от замаха можно увернуться)
function targetsFor(a, mv) {
  const R = rangeOf(a, mv), out = [];
  if (mv.area === 'front') { const t = nearestInFront(a, R, mv.cone || 1.1); return t ? [t] : out; }
  let cx = a.x, cz = a.z;
  if (mv.area === 'spot') { cx += Math.sin(a.rot) * R * mv.at; cz += Math.cos(a.rot) * R * mv.at; }
  for (const e of ents.values()) {
    if (e === a || e.dead) continue;
    const dx = e.x - cx, dz = e.z - cz, d = Math.hypot(dx, dz) - e.radius();
    if (mv.area === 'spot') { if (d < mv.rad * a.scale) out.push(e); continue; }
    if (d > R) continue;
    if (mv.area === 'around') { out.push(e); continue; }
    const back = mv.area === 'rear', lim = back ? mv.arc : (mv.cone || 1.1);
    if (Math.abs(angDiff(a.rot + (back ? Math.PI : 0), Math.atan2(dx, dz))) <= lim || d < a.radius() * 0.3) out.push(e);
  }
  return out;
}

// Враг сзади и близко — следующий удар будет хвостом назад; иначе — серия вперёд
function chainOf(a) {
  const S = a.S; if (!S.rear.length) return 'F';
  const rr = Math.max(...S.rear.map(m => rangeOf(a, m)));
  let best = null, bd = 1e9;
  for (const e of ents.values()) { if (e === a || e.dead) continue; const d = Math.hypot(e.x - a.x, e.z - a.z) - e.radius(); if (d < bd) { bd = d; best = e; } }
  if (!best || bd > rr * 1.15) return 'F';
  return Math.abs(angDiff(a.rot, Math.atan2(best.x - a.x, best.z - a.z))) > 1.75 ? 'R' : 'F';
}
function nextMove(a) {
  const ch = chainOf(a), list = ch === 'R' ? a.S.rear : a.S.front;
  const i = a.chainT > 0 ? (ch === 'R' ? a.stepR : a.stepF) % list.length : 0;
  return { mv: list[i], ch, i };
}
function startAct(a, an, extra) { a.act = Object.assign({ an, t: 0, fx: false, hi: 0, hold: 0 }, extra); }

function attack(a, special) {
  if (!a || a.dead || a.stunT > 0 || a.leap) return;
  if (a.latch) { if (special && a.latch.kind === 'cling') dismount(a); return; } // повторный «Спец» — спрыгнуть со спины
  const S = a.S;
  if (!special) {
    if (a.atkT > 0 || a.busy()) { if (a === me && a.atkT < 0.3) a.queued = true; return; } // нажатие заранее запоминается
    const { mv, ch, i } = nextMove(a);
    if (a === me) autoAim(a, rangeOf(a, mv), mv, ch === 'R');
    if (ch === 'R') a.stepR = i + 1; else a.stepF = i + 1;
    a.chainT = 1.8;
    a.atkT = mv.cd * (a.over() || a.boost() ? 0.78 : 1); a.atkFlagT = 0.3;
    a.dir = mv.side || -a.dir; a.lastMv = S.all.indexOf(mv);
    startAct(a, mv.anim, { mv, hits: hitTimes(AN[mv.anim]) });
    const v = volAt(a); if (v > 0.05) sfx.servo(a.sp === 'raptor' ? 1.6 : 1, v);
    return;
  }
  if (a.spT > 0 || a.busy()) return;
  const sp = S.special;
  if (a === me && sp.type !== 'area') autoAim(a, (sp.range || S.reach) * a.scale, { cone: sp.type === 'leap' ? 0.6 : 1.1 });
  a.spT = sp.cd; a.spFlagT = 0.4;
  startAct(a, sp.anim, { sp: true });
  const v = volAt(a); if (v > 0.05) sfx.roar(a.sp === 'raptor' ? 1.8 : 1, v * 0.7);
}

function ultimate(a) {
  if (!a || a.dead || a.stunT > 0 || a.latch || a.leap || a.ultCd > 0 || a.busy()) return;
  const U = a.S.ult;
  a.ultCd = U.cd; a.ultFlagT = 0.5;
  startAct(a, U.anim, { ult: true });
  const v = volAt(a); if (v > 0.05) sfx.roar(0.7, v);
  if (a === me) toast(`${U.name}!`);
}

// Ход атаки у владельца робота: урон — строго в момент удара по анимации
function tickAttacks(d, dt) {
  const A = d.act;
  if (A) {
    const an = AN[A.an];
    A.t += dt;
    if (d.stunT > 0 && A.t < an.w + an.s) d.act = null; // оглушение сбивает замах
    else if (A.mv) {
      if (A.mv.lunge && !A.lunged && A.t >= an.w) { A.lunged = true; d.kvx += Math.sin(d.rot) * A.mv.lunge; d.kvz += Math.cos(d.rot) * A.mv.lunge; } // шаг в удар
      while (A.hi < A.hits.length && A.t >= A.hits[A.hi]) resolveMove(d, A.mv, A.hi++);
    } else if (!A.done && A.t >= an.h) { A.done = true; if (A.sp) resolveSpecial(d, A); else if (A.ult) resolveUlt(d); }
  }
  if (d.queued && d.atkT <= 0 && !d.busy()) { d.queued = false; attack(d, false); }
  if (d.storm) stormTick(d, dt);
  const L = d.latch;
  if (L) { // захват: Рекс держит челюстями, Раптор рубит со спины
    L.t -= dt; L.acc -= dt;
    const t = ents.get(L.id);
    if (!t || t.dead || d.stunT > 0) endLatch(d);
    else {
      if (L.acc <= 0) {
        L.acc += L.tick;
        if (L.kind === 'cling') { const mv = d.S.front[d.combo++ % 2]; d.dir = mv.side; d.lastMv = d.S.all.indexOf(mv); d.atkFlagT = 0.25; startAct(d, mv.anim, { mv, hits: [] }); }
        dealDamage(d, t, d.dmg() * L.mult, L.fx || null, { snd: L.kind === 'cling' ? 'slash' : 'crunch' });
      }
      if (d.latch && L.t <= 0) endLatch(d);
    }
  }
}

function resolveMove(a, mv) {
  if (mv.area === 'proj') { volley(a, mv); return; }
  for (const t of targetsFor(a, mv)) dealDamage(a, t, a.dmg() * mv.dmg, mv.fx || null, mv);
}

// Снаряды (шипы, ракеты): летят по дуге, урон — когда долетели. dry — только картинка (чужой игрок)
function volley(a, o, dry) {
  const R = o.range * a.scale, list = [];
  for (const e of ents.values()) {
    if (e === a || e.dead) continue;
    const dx = e.x - a.x, dz = e.z - a.z, d = Math.hypot(dx, dz) - e.radius();
    if (d > R) continue;
    if (o.cone < Math.PI && Math.abs(angDiff(a.rot, Math.atan2(dx, dz))) > o.cone) continue;
    list.push([d, e]);
  }
  list.sort((p, q) => p[0] - q[0]);
  const targets = list.slice(0, o.targets || 3).map(p => p[1]);
  if (camD(a.x, a.z) > 70) { if (!dry) for (let i = 0; i < o.count && targets.length; i++) { const e = targets[i % targets.length]; dealDamage(a, e, a.dmg() * o.dmg, o.fx || null, { snd: 'clank' }); } return; }
  const s = a.scale, ry = a.m.root.position.y, sx = a.x - Math.sin(a.rot) * (o.back ? 0.4 : -0.3) * s, sz = a.z - Math.cos(a.rot) * (o.back ? 0.4 : -0.3) * s;
  const sy = ry + a.S.h * (o.back ? 0.62 : 0.8) * s;
  const v = volAt(a); if (v > 0.03) (o.snd === 'rocket' ? sfx.rocket : sfx.shoot)(v);
  if (!targets.length) {
    for (let i = 0; i < Math.min(3, o.count); i++) {
      const an = a.rot + (i - 1) * 0.25, px = a.x + Math.sin(an) * R * 0.8, pz = a.z + Math.cos(an) * R * 0.8, py = height(px, pz) + 0.3;
      fx.proj({ x: sx, y: sy, z: sz, to: () => [px, py, pz], T: (o.T || 0.3) + i * (o.stagger || 0.04), arc: o.arc ?? 1, color: o.color, smoke: o.smoke, s, onHit: () => fx.dust(px, py, pz, s * 0.6, 3) });
    }
    return;
  }
  for (let i = 0; i < o.count; i++) {
    const e = targets[i % targets.length];
    const side = jit(o.spread || 1.5) * s;
    fx.proj({ x: sx + jit(0.4), y: sy, z: sz + jit(0.4), to: () => bodyPt(e), T: (o.T || 0.3) + i * (o.stagger || 0.04), arc: (o.arc ?? 1) * s, side, color: o.color, smoke: o.smoke, s,
      onHit: () => {
        if (!dry && !e.dead && ents.has(e.id)) dealDamage(a, e, a.dmg() * o.dmg, o.fx || null, { snd: 'clank' });
        else { const p = bodyPt(e); sparks(p[0], p[1], p[2], 0.6, 4); }
      } });
  }
}
const rocketsOf = a => { const U = a.S.ult; return { count: U.count, range: U.range, cone: Math.PI, dmg: U.dmg, targets: 3, color: '#ffb03a', smoke: true, arc: 6, spread: 6, T: 0.65, stagger: 0.08, back: true, snd: 'rocket' }; };

// Шипы веером во все стороны (Стего): по врагам — с уроном, остальные — для красоты
function quills(a, dry) {
  const sp = a.S.special, R = sp.radius * a.scale, s = a.scale, ry = a.m.root.position.y + a.S.h * 0.75 * s;
  const vis = camD(a.x, a.z) < 70;
  const hit = nearEnemies(a, R);
  for (const e of hit) {
    if (vis) fx.proj({ x: a.x, y: ry, z: a.z, to: () => bodyPt(e), T: 0.2, arc: 0.5 * s, color: a.S.glow, s, onHit: () => { if (!dry && !e.dead && ents.has(e.id)) dealDamage(a, e, a.dmg() * sp.mult, sp.fx, { snd: 'clank' }); } });
    else if (!dry) dealDamage(a, e, a.dmg() * sp.mult, sp.fx, { snd: 'clank' });
  }
  if (vis) for (let i = 0; i < 10; i++) {
    const an = i * 0.628 + Math.random() * 0.2, px = a.x + Math.sin(an) * R, pz = a.z + Math.cos(an) * R, py = height(px, pz) + 0.3;
    fx.proj({ x: a.x, y: ry, z: a.z, to: () => [px, py, pz], T: 0.22, arc: 0.8 * s, color: a.S.glow, s, onHit: () => fx.dust(px, py, pz, s * 0.5, 2) });
  }
}

// Молния Спино: от головы к цели и перескок на второго
function arcBolt(a, dry) {
  const sp = a.S.special, range = sp.range * a.scale;
  const t = nearestInFront(a, range, 0.5);
  a.m.head.getWorldPosition(_wp);
  const hx = _wp.x, hy = _wp.y, hz = _wp.z;
  if (!t) { bolt(hx, hy, hz, a.x + Math.sin(a.rot) * range * 0.7, a.y + 1, a.z + Math.cos(a.rot) * range * 0.7, a.S.glow, 5, 1.2); return false; }
  const p = bodyPt(t);
  bolt(hx, hy, hz, ...p, '#ffffff', 5, 1.2); bolt(hx, hy, hz, ...p, a.S.glow, 5, 1.6);
  fx.flash(...p, 1.2 * t.scale, '#bfe9ff');
  if (!dry) dealDamage(a, t, a.dmg() * sp.mult, sp.fx, { snd: 'zap', stop: 0.06 });
  let n2 = null, nd = 8 * a.scale;
  for (const e of ents.values()) { if (e === a || e === t || e.dead) continue; const dd = Math.hypot(e.x - t.x, e.z - t.z); if (dd < nd) { nd = dd; n2 = e; } }
  if (n2) { bolt(...p, ...bodyPt(n2), a.S.glow, 4, 1.2); if (!dry) dealDamage(a, n2, a.dmg() * sp.mult * 0.5, sp.fx, { snd: 'zap' }); }
  return true;
}

function resolveSpecial(a, A) {
  const S = a.S, sp = S.special, reach = S.reach * a.scale;
  if (sp.type === 'clamp') {
    const t = nearestInFront(a, reach * 1.15, 1.3);
    if (t) {
      dealDamage(a, t, a.dmg() * sp.mult, { s: sp.dur + 0.1 }, { snd: 'crunch', stop: 0.08 });
      a.latch = { id: t.id, kind: 'clamp', t: sp.dur, tick: sp.tick, acc: sp.tick * 0.6, mult: sp.tickMult, dmg: 0 };
      A.hold = sp.dur;
    } else a.spT = Math.min(a.spT, 2); // промах — перезарядка короче
  } else if (sp.type === 'leap') startLeap(a);
  else if (sp.type === 'bolt') { if (!arcBolt(a, false)) a.spT = Math.min(a.spT, 2); }
  else if (sp.type === 'dash') { a.dashT = sp.dur; a.dashHit = new Set(); }
  else if (sp.type === 'area') quills(a, false);
}

function resolveUlt(a) {
  const U = a.S.ult;
  if (U.type === 'buff') a.ultT = U.dur;
  else if (U.type === 'barrage') volley(a, rocketsOf(a));
  else if (U.type === 'storm') a.storm = { t: U.dur, tick: 0.05, left: U.strikes };
  else if (U.type === 'stomp') for (const e of nearEnemies(a, U.radius * a.scale)) dealDamage(a, e, a.dmg() * U.dmg, U.fx, { snd: 'thud', stop: 0.1 });
  else if (U.type === 'fortress') a.shieldT = U.dur;
}

// Грозовая буря: молнии с неба по врагам рядом
function stormTick(d, dt) {
  const U = d.S.ult, St = d.storm;
  St.t -= dt; St.tick -= dt;
  if (St.tick <= 0 && St.left > 0) { St.tick += U.dur / U.strikes; St.left--; stormStrike(d, !St.dry); }
  if (St.t <= 0) d.storm = null;
}
function stormStrike(a, real) {
  const U = a.S.ult, R = U.range * a.scale, list = nearEnemies(a, R);
  let x, z, y;
  if (list.length) { const e = list[Math.floor(Math.random() * list.length)]; x = e.x; z = e.z; y = bodyPt(e)[1]; if (real) dealDamage(a, e, a.dmg() * U.dmg, U.fx, { snd: 'zap' }); }
  else { const an = Math.random() * 6.28, r = 4 + Math.random() * 8; x = a.x + Math.sin(an) * r; z = a.z + Math.cos(an) * r; y = height(x, z) + 1; }
  if (camD(x, z) < 80) {
    bolt(x + jit(), y + 18, z + jit(), x, y, z, '#ffffff', 6, 2.2); bolt(x + jit(), y + 18, z + jit(), x, y, z, '#59a8ff', 6, 3);
    fx.flash(x, y, z, 1.6, '#bfe9ff'); ring(x, y - 1, z, 3, '#59a8ff'); fx.dust(x, y, z, 1, 4, 1.5);
    const v = Math.max(0, 1 - camD(x, z) / 60); if (v > 0.05) sfx.zap(v);
  }
}

// ---- Прыжок раптора: настоящая дуга, наводится на цель, приземляется ей на спину ----
function startLeap(a) {
  const sp = a.S.special, R = sp.range * a.scale;
  const t = nearestInFront(a, R, 0.6);
  let tx, tz;
  if (t) { tx = t.x; tz = t.z; } else { tx = a.x + Math.sin(a.rot) * R * 0.6; tz = a.z + Math.cos(a.rot) * R * 0.6; }
  const dist = Math.hypot(tx - a.x, tz - a.z);
  const H = (1.6 + dist * 0.16) * Math.max(0.7, a.scale);
  a.leap = { t: 0, T: sp.flight, x0: a.x, z0: a.z, tx, tz, H, h0: 0, h: 0, tid: t ? t.id : null };
  if (!t) a.spT = Math.min(a.spT, 3);
}
// спрыгнуть со спины: короткий прыжок назад-вбок
function dismount(d) {
  const t = d.latch && ents.get(d.latch.id);
  d.latch = null; d.spT = Math.max(d.spT, 1.5);
  const r = (t ? t.rot : d.rot) + Math.PI + (Math.random() - 0.5) * 1.4;
  const back = (t ? t.radius() : 0) + d.radius() + 0.8;
  const cx = t ? t.x : d.x, cz = t ? t.z : d.z, h0 = d.rideUp || 0;
  d.leap = { t: 0, T: 0.4, x0: d.x, z0: d.z, tx: cx + Math.sin(r) * back, tz: cz + Math.cos(r) * back, H: 1.0 * d.scale, h0, h: h0, tid: null, off: true };
  if (d.bot) { d.phase = 'retreat'; d.phaseT = 1.1; d.orbit = Math.random() < 0.5 ? 1 : -1; }
}
function endLatch(d) {
  const L = d.latch;
  if (!L) return;
  if (L.kind === 'cling') { dismount(d); return; }
  d.latch = null;
  const A = d.act; // Рекс отпускает — заканчиваем удержание в анимации
  if (A && A.an === 'clamp') { const an = AN.clamp; A.hold = Math.max(0, Math.min(A.hold, A.t - an.w - an.s)); }
}

// ---- Эффекты атак (у всех: свои, боты, чужие игроки, превью в меню) ----
function bumpNear(e, k) { if (!me) return; const dd = Math.hypot(me.x - e.x, me.z - e.z); if (dd < 25) shake = Math.max(shake, k * (1 - dd / 25)); }
function strikeFx(e, A) {
  if (camD(e.x, e.z) > 70) return;
  const S = e.S, s = e.scale, v = volAt(e), y0 = e.y, yaw = e.rot, glow = S.glow, R = S.reach * s, mv = A.mv;
  const ahead = k => [e.x + Math.sin(yaw) * k, e.z + Math.cos(yaw) * k];
  const hy = e.m.root.position.y + S.h * 0.45 * s;
  switch (A.an) {
    case 'bite': case 'clamp': {
      e.m.jaw.getWorldPosition(_wp);
      const mx = _wp.x + Math.sin(yaw) * 0.8 * s, mz = _wp.z + Math.cos(yaw) * 0.8 * s;
      fx.flash(mx, _wp.y, mz, 0.45 * s, '#ffffff'); sparks(mx, _wp.y, mz, 0.45 * s, 4);
      if (v > 0.03) sfx.whoosh(0.7, v * 0.5);
      break;
    }
    case 'slap': fx.slash(e.x, hy, e.z, yaw, e.dir * 0.35, R * 0.85, 2.2, glow); if (v > 0.03) sfx.whoosh(0.9, v); break;
    case 'clawR': case 'clawL': fx.slash(e.x, hy, e.z, yaw, -((mv && mv.side) || e.dir) * 0.9, R * 0.9, 2.0, glow); if (v > 0.03) sfx.whoosh(1.5, v); break;
    case 'kick': fx.slash(e.x, e.m.root.position.y + S.h * 0.35 * s, e.z, yaw, Math.PI / 2, R * 0.8, 1.8, glow); if (v > 0.03) sfx.whoosh(1.3, v); break;
    case 'ram': { const [x, z] = ahead(R * 0.6); fx.dust(e.x, y0, e.z, s, 6, 1.6); ring(x, y0, z, 1.8 * s, glow); if (v > 0.03) sfx.whoosh(0.6, v); break; }
    case 'gore': fx.slash(e.x, hy, e.z, yaw, Math.PI / 2, R * 0.75, 1.6, glow); fx.dust(e.x, y0, e.z, s, 4, 1.2); if (v > 0.03) sfx.whoosh(0.6, v); break;
    case 'hornswipe': fx.slash(e.x, hy, e.z, yaw, e.dir * 0.15, R * 0.9, 2.4, glow); if (v > 0.03) sfx.whoosh(0.8, v); break;
    case 'tailwhip': case 'tailside': case 'tailflick':
      fx.slash(e.x, e.m.root.position.y + S.h * 0.4 * s, e.z, yaw, e.dir * 0.2, R, 2.8, glow, true); if (v > 0.03) sfx.whoosh(0.7, v); break;
    case 'tailslam': {
      const [x, z] = ahead(-R * 0.75);
      fx.slash(e.x, e.m.root.position.y + S.h * 0.5 * s, e.z, yaw, Math.PI / 2, R * 0.9, 1.4, glow, true);
      ring(x, y0, z, 2.6 * s, glow); fx.dustRing(x, z, 2.2 * s, 12, s); bumpNear(e, 0.25); if (v > 0.03) sfx.thud(v);
      break;
    }
    case 'bash': fx.slash(e.x, hy, e.z, yaw, e.dir * 0.3, R * 0.7, 2.2, glow); fx.dust(e.x, y0, e.z, s, 4); if (v > 0.03) sfx.whoosh(0.6, v); break;
    case 'claws2': fx.slash(e.x, hy, e.z, yaw, 0.8, R * 0.85, 1.8, glow); fx.slash(e.x, hy, e.z, yaw, -0.8, R * 0.85, 1.8, glow); if (v > 0.03) sfx.whoosh(1.1, v); break;
    case 'shock': {
      const r = R * 0.85; ring(e.x, y0, e.z, r, glow); ring(e.x, y0 + 0.3, e.z, r * 0.6, '#ffffff');
      const p = bodyPt(e);
      for (let i = 0; i < 6; i++) { const a = i * 1.047 + Math.random(); bolt(...p, e.x + Math.sin(a) * r, y0 + 0.4, e.z + Math.cos(a) * r, glow, 3, 0.8); }
      if (v > 0.03) sfx.zap(v);
      break;
    }
    case 'saw': if (v > 0.03) sfx.saw(v); break;
    case 'rearstomp': case 'quake': {
      const big = A.an === 'quake', [x, z] = big ? [e.x, e.z] : ahead(R * 0.75), rr = big ? S.ult.radius * s : 3.6 * s, n = big ? 3 : 2;
      for (let i = 1; i <= n; i++) ring(x, y0, z, rr * i / n, i === 1 ? '#ffffff' : glow, 0.45 + i * 0.1);
      fx.dustRing(x, z, rr * 0.6, big ? 22 : 12, s); bumpNear(e, big ? 0.6 : 0.3); if (v > 0.03) sfx.thud(v);
      break;
    }
    case 'spikes': if (!e.local) volley(e, mv, true); break;
    case 'quills': ring(e.x, y0, e.z, S.special.radius * s, glow); if (!e.local) quills(e, true); if (v > 0.03) sfx.shoot(v); break;
    case 'leap': fx.dust(e.x, y0, e.z, s, 6, 1.5); if (v > 0.03) sfx.whoosh(1.2, v); break;
    case 'charge': if (!e.local) arcBolt(e, true); if (v > 0.03) sfx.zap(v); break;
    case 'paw': fx.dust(e.x, y0, e.z, s * 1.2, 8, 2); if (v > 0.03) sfx.steam(v); break;
    case 'roar': {
      ring(e.x, y0, e.z, 6 * s, glow); ring(e.x, y0, e.z, 3.5 * s, '#ffffff');
      for (const sd of [-1, 1]) {
        const bx = e.x - Math.sin(yaw) * 0.9 * s + Math.cos(yaw) * 0.4 * sd * s, bz = e.z - Math.cos(yaw) * 0.9 * s - Math.sin(yaw) * 0.4 * sd * s;
        fx.steam(bx, e.m.root.position.y + S.h * 0.8 * s, bz, s, 6, 6);
      }
      if (v > 0.03) sfx.steam(v);
      break;
    }
    case 'launch': if (!e.local) volley(e, rocketsOf(e), true); break;
    case 'storm': ring(e.x, y0, e.z, S.ult.range * s * 0.5, glow); if (!e.local) e.storm = { t: S.ult.dur, tick: 0.05, left: S.ult.strikes, dry: true }; break;
    case 'fortress': ring(e.x, y0, e.z, 5 * s, glow); ring(e.x, y0, e.z, 3 * s, '#ffffff'); if (v > 0.03) sfx.thud(v * 0.6); break;
  }
}
// во время замаха: треск разрядов на парусе / вокруг тела
function windFx(e, A, dt) {
  if (camD(e.x, e.z) > 55 || Math.random() > dt * 28) return;
  const s = e.scale, top = e.m.root.position.y + e.S.h * 0.8 * s;
  const z = (Math.random() - 0.5) * 3 * s, px = e.x + Math.sin(e.rot) * z, pz = e.z + Math.cos(e.rot) * z;
  bolt(px, top, pz, px + jit(1.5 * s), top + (0.5 + Math.random()) * s, pz + jit(1.5 * s), e.S.glow, 2, 0.5);
}
// пила: искры с диска, пока она пилит
function loopFx(e, A, dt) {
  if (!e.m.saw || camD(e.x, e.z) > 55 || Math.random() > dt * 30) return;
  e.m.saw.getWorldPosition(_wp);
  sparks(_wp.x, _wp.y, _wp.z, 0.55 * e.scale, 2, 0.6);
}
// шаг: пыль, звук по весу робота, лёгкий толчок камеры от тяжёлых
function footstep(e, L) {
  e.thump = 1;
  const d = camD(e.x, e.z); if (d > 55) return;
  const w = e.S.weight, s = e.scale;
  L.knee.getWorldPosition(_wp);
  fx.dust(_wp.x, height(_wp.x, _wp.z), _wp.z, 0.45 * s * (0.4 + w), w > 0.6 ? 3 : 1, 0.6 + w);
  const v = volAt(e);
  if (v > 0.05 && (e === me || w > 0.6 || d < 15)) sfx.step(w * Math.min(1.2, s), v * (e === me ? 0.8 : 0.6));
  if (w > 0.6 && me) {
    if (e === me) camBump = Math.max(camBump, 0.07 * w * s);
    else { const dm = Math.hypot(me.x - e.x, me.z - e.z); if (dm < 20) camBump = Math.max(camBump, 0.04 * w * s * (1 - dm / 20)); }
  }
}

const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, +v || 0));
function applyDamage(t, dmg, byId, byName, f) {
  if (t.dead || NOW() < t.protUntil) return;
  f = f || {};
  const att = ents.get(byId);
  if (t.sp === 'raptor' && !f.th && Math.random() < 0.2) { // Реактивное уклонение
    dmgNum(t.x, t.y + t.S.h * t.scale + 0.5, t.z, 'УКЛОН', t === me);
    sparks(t.x, t.y + 1, t.z, 0.5, 4, 0.4); fx.dust(t.x, t.y, t.z, t.scale, 3); return;
  }
  if (t.sp === 'trike' && att && Math.abs(angDiff(t.rot, Math.atan2(att.x - t.x, att.z - t.z))) < 0.9) dmg *= 0.6; // фронтальная броня
  if (t.shieldT > 0) dmg *= 0.45; // Крепость
  dmg = Math.round(dmg);
  t.hp -= dmg; t.combatT = 6; t.flash();
  if (att) { t.react = Math.max(t.react, Math.min(1, 0.6 + dmg / t.maxHp() * 4)); t.reactSide = Math.sign(angDiff(t.rot, Math.atan2(att.x - t.x, att.z - t.z))) || 1; }
  if (t.latch && t.latch.kind === 'cling') { t.latch.dmg += dmg; if (t.latch.dmg > t.maxHp() * 0.18) { dismount(t); if (t === me) toast('Сбросили с брони!'); } } // сбили наездника
  if (f.s && t.stunImm <= 0) { t.stunT = Math.max(t.stunT, f.s); t.stunImm = f.s + 2; t.dashT = 0; if (t === me) toast('⚡ Системы обесточены!'); }
  if (f.sl) t.slowT = Math.max(t.slowT, f.sl);
  if (f.kb && att) { const dx = t.x - att.x, dz = t.z - att.z, dd = Math.hypot(dx, dz) || 1; t.kvx += dx / dd * f.kb * 3; t.kvz += dz / dd * f.kb * 3; }
  if (t.sp === 'stego' && att && !att.dead && !f.th && att !== t) { // Шипы-контрудар
    const r = Math.round(dmg * (t.shieldT > 0 ? 0.3 : 0.15));
    if (r > 0) {
      sparks(att.x, att.y + 1, att.z, 0.6, 4);
      if (att.local) applyDamage(att, r, t.id, t.name, { th: 1 });
      else if (net && att.peer) net.hit(att.peer, { t: att.id, d: r, b: t.id, n: t.name, f: { th: 1 } });
    }
  }
  if (t === me) { shake = Math.max(shake, 0.3); hitStop = Math.max(hitStop, 0.035); sfx.hurt(); flashVignette(); dmgNum(me.x, me.y + me.S.h * me.scale + 0.5, me.z, dmg, false); }
  if (t.bot) t.aggro = byId;
  if (t.hp <= 0) killEnt(t, byId, byName);
}

function killEnt(t, byId, byName) {
  t.dead = true;
  const msg = { id: t.id, b: byId, x: r1(t.x), z: r1(t.z), s: r2(t.scale), n: t.name, bn: byName || '?' };
  net && net.kill(msg);
  onKill(msg);
}

const _kp = new THREE.Vector3();
function onKill(msg) {
  const e = ents.get(msg.id);
  world.spawnCarcass(msg.x, msg.z, msg.s);
  const y = height(msg.x, msg.z) + 1;
  sparks(msg.x, y + msg.s, msg.z, 1.2 + msg.s, 16);
  fx.flash(msg.x, y + msg.s, msg.z, 2.5 + msg.s * 2, '#ffb03a');
  fx.dustRing(msg.x, msg.z, 3 + msg.s * 2, 16, 1 + msg.s * 0.5);
  fx.steam(msg.x, y + msg.s, msg.z, 1 + msg.s, 6, 4);
  ring(msg.x, y - 0.6, msg.z, 5 + msg.s * 3, '#ffb03a');
  if (camera.position.distanceTo(_kp.set(msg.x, y, msg.z)) < 60) { sfx.boom(); bumpNear({ x: msg.x, z: msg.z }, 0.4); }
  feed(`⚙️ ${msg.bn} уничтожил ${msg.n}`);
  const k = ents.get(msg.b);
  if (k && k.local && !k.dead) {
    k.kills++;
    if (mode === 'grow') k.setGrowth(k.g + 0.1 + 0.1 * Math.min(1, msg.s));
    k.hp = Math.min(k.maxHp(), k.hp + k.maxHp() * 0.35);
    if (k === me) { lifeStats.kills++; toast('Уничтожен! Собери металлолом 🔩'); }
  }
  for (const o of ents.values()) if (o.latch && o.latch.id === msg.id) endLatch(o);
  if (e) {
    ents.delete(e.id); e.dispose();
    if (e === me) { me = null; playing = false; showDeath(msg.bn); }
  }
}

// ================= Сеть =================
const handlers = {
  onState(d, peerId) {
    if (!d || !Array.isArray(d.e)) return;
    peers.set(peerId, { c: String(d.c), t: NOW() });
    const seen = new Set();
    for (const a of d.e) {
      if (!Array.isArray(a)) continue;
      const [id, spI, name, x, z, rot, g, hp, flags, kills] = a;
      const sp = SP_KEYS[spI]; if (!sp || typeof id !== 'string' || !isFinite(x) || !isFinite(z)) continue;
      seen.add(id);
      let e = ents.get(id);
      if (e && e.local) continue;
      if (!e) {
        e = new Mech(id, sp, String(name).slice(0, 16), { x, z, rot, g });
        e.bot = (flags & 8) !== 0;
        ents.set(id, e);
      }
      e.peer = peerId; e.lastSeen = NOW();
      if (hp < e.hpFrac - 0.005) { e.flash(); e.react = Math.max(e.react, 0.6); }
      e.tx = x; e.tz = z; e.trot = rot; e.g = Math.max(0, Math.min(1, +g || 0)); e.hpFrac = hp; e.kills = kills | 0;
      e.moving = (flags & 1) !== 0; e.sprint = (flags & 4) !== 0;
      const af = flags & 2;
      const sf = flags & 16, uf = flags & 2048;
      if (af && !e.lastAtkFlag && !sf && !uf) { const mv = e.S.all[(flags >> 7) & 7]; if (mv) { e.dir = flags & 4096 ? -1 : 1; startAct(e, mv.anim, { mv }); } }
      if (sf && !e.lastSpFlag) startAct(e, e.S.special.anim, { sp: true });
      if (uf && !e.lastUltFlag) startAct(e, e.S.ult.anim, { ult: true });
      e.lastAtkFlag = af; e.lastSpFlag = sf; e.lastUltFlag = uf;
      e.ultT = (flags & 1024) ? 0.5 : 0; e.shieldT = (flags & 32) ? 0.5 : 0; e.stunT = (flags & 8192) ? 0.3 : 0;
      e.clung = (flags & 64) !== 0;
    }
    for (const e of ents.values()) if (!e.local && e.peer === peerId && !seen.has(e.id)) { ents.delete(e.id); e.dispose(); }
  },
  onHit(d) {
    const t = ents.get(d && d.t);
    if (t && t.local) {
      const f = d.f && typeof d.f === 'object' ? { s: clampN(d.f.s, 0, 2), sl: clampN(d.f.sl, 0, 3), kb: clampN(d.f.kb, 0, 12), th: d.f.th ? 1 : 0 } : null;
      applyDamage(t, Math.max(0, Math.min(5000, +d.d || 0)), String(d.b), String(d.n || '?').slice(0, 16), f);
    }
  },
  onKill(d) {
    if (!d || typeof d.id !== 'string') return;
    const e = ents.get(d.id);
    if (e && e.local) return; // своих хороним сами
    onKill({ id: d.id, b: String(d.b), x: +d.x || 0, z: +d.z || 0, s: +d.s || 1, n: String(d.n).slice(0, 16), bn: String(d.bn).slice(0, 16) });
  },
  onLeave(peerId) {
    peers.delete(peerId);
    for (const e of ents.values()) if (!e.local && e.peer === peerId) { ents.delete(e.id); e.dispose(); }
  },
};

function activePeers() { const n = NOW(); let c = 0; for (const p of peers.values()) if (n - p.t < 4000) c++; return c; }
function isHost() {
  let h = clientId; const n = NOW();
  for (const p of peers.values()) if (n - p.t < 4000 && p.c < h) h = p.c;
  return h === clientId;
}

async function startNet(m) {
  if (net && mode === m) return;
  if (net) { net.leave(); net = null; }
  for (const e of [...ents.values()]) if (e !== me) { ents.delete(e.id); e.dispose(); }
  peers.clear(); mode = m; netStatus = 'connecting'; netStart = NOW();
  const want = m;
  let n = null;
  try { n = await connect(m, handlers); } catch (e) { console.warn(e); }
  if (mode !== want) { n && n.leave(); return; }
  net = n; netStatus = n ? 'online' : 'offline';
}

function sendState() {
  if (!net) return;
  const e = [];
  for (const d of ents.values()) {
    if (!d.local || d.dead) continue;
    const flags = (d.moving ? 1 : 0) | (d.atkFlagT > 0 ? 2 : 0) | (d.sprint ? 4 : 0) | (d.bot ? 8 : 0) | (d.spFlagT > 0 ? 16 : 0) | (d.shieldT > 0 ? 32 : 0) | (isClung(d) ? 64 : 0) | ((d.lastMv & 7) << 7) | (d.ultT > 0 ? 1024 : 0) | (d.ultFlagT > 0 ? 2048 : 0) | (d.dir < 0 ? 4096 : 0) | (d.stunT > 0 ? 8192 : 0);
    e.push([d.id, SP_KEYS.indexOf(d.sp), d.name, r1(d.x), r1(d.z), r2(d.rot), r2(d.g), r2(Math.max(0, d.hp / d.maxHp())), flags, d.kills]);
  }
  net.state({ c: clientId, e });
}

// ================= Спавн =================
function spawnPoint() {
  let best = null, bd = -1;
  for (let i = 0; i < 12; i++) {
    const [x, z] = world.randLand();
    let md = 1e9; for (const e of ents.values()) md = Math.min(md, Math.hypot(e.x - x, e.z - z));
    if (md > bd) { bd = md; best = [x, z]; }
    if (md > 40) break;
  }
  return best;
}

function spawnMe(sp, name) {
  const [x, z] = spawnPoint();
  life++;
  me = new Mech(`${clientId}-${life}`, sp, name, { local: true, self: true, x, z, rot: Math.random() * 6, g: mode === 'prime' ? 1 : 0 });
  ents.set(me.id, me);
  camYaw = me.rot; playing = true;
  lifeStats = { start: NOW(), kills: 0, best: stageIndex(me.g) };
  ring(x, height(x, z), z, 6, me.S.glow);
}

function spawnBot(force) {
  const sp = force || SP_KEYS[Math.floor(Math.random() * SP_KEYS.length)];
  const [x, z] = spawnPoint();
  const g = mode === 'prime' ? 1 : 0.15 + Math.random() * 0.75;
  const used = new Set([...ents.values()].map(e => e.name));
  const free = BOT_NAMES.filter(n => !used.has(n + ' (бот)'));
  const list = free.length ? free : BOT_NAMES;
  const b = new Mech(`${clientId}-b${++botN}`, sp, list[Math.floor(Math.random() * list.length)] + ' (бот)', { local: true, bot: true, x, z, rot: Math.random() * 6, g });
  ents.set(b.id, b);
}

// ================= Движение (общее для игрока и ботов) =================
const isClung = e => (e.local ? !!(e.latch && e.latch.kind === 'cling') : e.clung);
const isAir = e => isClung(e) || (e.local ? !!e.leap : e.leapH > 0.3);
function moveMech(d, mx, mz, run, dt) {
  if (d.stunT > 0) { mx = 0; mz = 0; run = false; d.dashT = 0; }
  // полёт (прыжок раптора или соскок со спины)
  if (d.leap) {
    const L = d.leap; L.t += dt;
    const u = Math.min(1, L.t / L.T), t = L.tid ? ents.get(L.tid) : null;
    if (t && !t.dead) { L.tx = t.x; L.tz = t.z; } // наводится на цель в полёте
    d.x = L.x0 + (L.tx - L.x0) * u; d.z = L.z0 + (L.tz - L.z0) * u;
    if (!L.off && Math.hypot(L.tx - d.x, L.tz - d.z) > 0.3) d.rot = Math.atan2(L.tx - d.x, L.tz - d.z);
    L.h = L.h0 * (1 - u) + 4 * u * (1 - u) * L.H;
    d.moving = false; d.sprint = false; d.vsp = 0; d.kvx = d.kvz = 0;
    if (t && !t.dead && u > 0.55 && Math.hypot(t.x - d.x, t.z - d.z) < t.radius() + d.radius() + 0.8) {
      const sp = d.S.special;
      d.leap = null;
      dealDamage(d, t, d.dmg() * sp.mult, sp.fx, { snd: 'slash', stop: 0.07 });
      d.latch = { id: t.id, kind: 'cling', t: sp.latch, tick: sp.tick, acc: 0.3, mult: sp.tickMult, fx: sp.fx, dmg: 0 };
      if (camD(t.x, t.z) < 50) ring(t.x, t.y, t.z, t.radius() * 1.4, d.S.glow);
      if (t === me) toast('🦖 Раптор на спине! Бей его — сбросишь');
      return;
    }
    if (u >= 1) {
      d.leap = null;
      if (camD(d.x, d.z) < 50) { fx.dust(d.x, d.y, d.z, d.scale * 1.2, 7, 2); sfx.step(0.5, volAt(d)); }
      if (!L.off) d.atkT = 0; // после прыжка удар готов сразу
    }
    world.collide(d, d.radius());
    return;
  }
  if (d.latch) {
    const L = d.latch, t = ents.get(L.id);
    if (!t || t.dead || d.stunT > 0 || L.t <= 0) endLatch(d);
    else if (L.kind === 'cling') { // Раптор сидит на спине врага и двигается вместе с ним
      const R = t.S.ride, hs = t.scale;
      d.x = t.x + Math.sin(t.rot) * R[0] * hs; d.z = t.z + Math.cos(t.rot) * R[0] * hs; d.rot = t.rot;
      d.moving = false; d.sprint = false; d.vsp = 0; d.kvx = d.kvz = 0;
      return;
    } else if (Math.hypot(t.x - d.x, t.z - d.z) > d.radius() + t.radius() + d.S.reach * d.scale * 1.6) endLatch(d);
    else { // Рекс держит челюстями и стоит на месте
      d.moving = false; d.sprint = false; d.vsp = 0;
      d.rot += Math.max(-d.S.turn * dt, Math.min(d.S.turn * dt, angDiff(d.rot, Math.atan2(t.x - d.x, t.z - d.z))));
      return;
    }
  }
  // во время замаха и удара тяжёлые почти стоят — удар «весит»
  let actK = 1, turnK = 1;
  const A = d.act;
  if (A) {
    const an = AN[A.an], heavy = d.S.weight > 0.6, hitPhase = A.t < an.w + an.s;
    if (A.mv) { actK = hitPhase ? (heavy ? 0.25 : 0.65) : (heavy ? 0.6 : 0.9); turnK = hitPhase && heavy ? 0.45 : 1; }
    else if (A.an !== 'paw' || A.t < an.w) { actK = hitPhase ? 0.15 : 0.6; turnK = 0.4; }
  }
  const mag = Math.min(1, Math.hypot(mx, mz));
  d.moving = mag > 0.08 || d.dashT > 0;
  d.sprint = run && d.moving && d.st > 2;
  if (d.sprint) d.st = Math.max(0, d.st - 22 * dt); else d.st = Math.min(100, d.st + 14 * dt);
  if (d.dashT > 0) { // Трицера: таран
    d.dashT -= dt;
    const spd = d.S.special.speed * Math.max(0.6, d.scale);
    d.x += Math.sin(d.rot) * spd * dt; d.z += Math.cos(d.rot) * spd * dt;
    if (Math.random() < 0.5 && camD(d.x, d.z) < 50) fx.dust(d.x - Math.sin(d.rot) * d.radius(), d.y, d.z - Math.cos(d.rot) * d.radius(), d.scale, 1, 1);
    for (const e of ents.values()) {
      if (e === d || e.dead || d.dashHit.has(e.id) || isAir(e)) continue;
      if (Math.hypot(e.x - d.x, e.z - d.z) < d.radius() + e.radius() + 0.8 * d.scale) {
        const sp = d.S.special;
        d.dashHit.add(e.id); dealDamage(d, e, d.dmg() * sp.mult, sp.fx, { snd: 'thud', stop: 0.09 });
      }
    }
    d.vsp = spd * 0.5;
  } else {
    let tsp = 0;
    if (d.moving) {
      const want = Math.atan2(mx, mz), turn = d.S.turn * turnK * dt, df = angDiff(d.rot, want);
      d.rot += Math.max(-turn, Math.min(turn, df));
      tsp = d.speed(d.sprint) * mag * (Math.abs(df) > 1.6 ? 0.4 : 1) * actK;
    }
    d.vsp += (tsp - d.vsp) * Math.min(1, d.S.accel * dt); // тяжёлые разгоняются и тормозят медленнее
    if (d.vsp < 0.05) d.vsp = 0;
    if (d.vsp > 0) { d.x += Math.sin(d.rot) * d.vsp * dt; d.z += Math.cos(d.rot) * d.vsp * dt; }
    if (d.vsp > 0.8) d.moving = true;
  }
  if (d.kvx || d.kvz) { // отбрасывание и шаг в удар
    d.x += d.kvx * dt; d.z += d.kvz * dt;
    const k = Math.exp(-6 * dt); d.kvx *= k; d.kvz *= k;
    if (Math.abs(d.kvx) + Math.abs(d.kvz) < 0.1) d.kvx = d.kvz = 0;
  }
  // мягкое расталкивание: не больше 7 м/с, и никого не толкает тот, кто в воздухе или на спине
  if (!isAir(d)) for (const e of ents.values()) {
    if (e === d || e.dead || isAir(e)) continue;
    const dx = d.x - e.x, dz = d.z - e.z, dist = Math.hypot(dx, dz), m = (d.radius() + e.radius()) * 0.75;
    if (dist < m && dist > 0.001) { const p = Math.min((m - dist) * (e.local ? 0.5 : 1), 7 * dt); d.x += dx / dist * p; d.z += dz / dist * p; }
  }
  world.collide(d, d.radius());
  const r = Math.hypot(d.x, d.z);
  if (r > MAP_R - 8) { d.x *= (MAP_R - 8) / r; d.z *= (MAP_R - 8) / r; }
}

function levelUp(d) {
  if (d !== me) return;
  toast(`Апгрейд: ${STAGES[stageIndex(d.g)]}!`); sfx.levelUp(); ring(d.x, d.y, d.z, 5 * d.scale, d.S.glow);
  lifeStats.best = Math.max(lifeStats.best, stageIndex(d.g));
}

function tickCommon(d, dt) {
  d.atkT -= dt; d.spT -= dt; d.atkFlagT -= dt; d.combatT -= dt; d.spFlagT -= dt;
  d.stunT -= dt; d.slowT -= dt; d.shieldT -= dt; d.stunImm -= dt; d.chainT -= dt; d.ultCd -= dt; d.ultT -= dt; d.ultFlagT -= dt;
  tickAttacks(d, dt);
  if (d.sp === 'spino' && inWater(d.x, d.z)) d.hp = Math.min(d.maxHp(), d.hp + d.maxHp() * 0.04 * dt); // водяное охлаждение
  if (mode === 'grow' && d.g < 1) {
    const before = stageIndex(d.g);
    d.setGrowth(d.g + 0.009 * dt);
    if (stageIndex(d.g) > before) levelUp(d);
  }
  if (d.combatT <= 0) d.hp = Math.min(d.maxHp(), d.hp + d.maxHp() * 0.025 * dt);
  d.eatT -= dt;
  if (d.eatT <= 0 && (d.hp < d.maxHp() * 0.999 || (mode === 'grow' && d.g < 1))) {
    d.eatT = 0.6;
    const food = world.tryEat(d.S.diet, d.x, d.z, d.radius() + 0.8);
    if (food) {
      const before = stageIndex(d.g);
      if (mode === 'grow') d.setGrowth(d.g + (food === 'scrap' ? 0.06 : 0.045));
      d.hp = Math.min(d.maxHp(), d.hp + d.maxHp() * 0.2);
      if (d === me) {
        sfx.eat();
        sparks(d.x + Math.sin(d.rot) * d.radius(), d.y + 0.5, d.z + Math.cos(d.rot) * d.radius(), 0.5, 5);
        if (stageIndex(d.g) > before) levelUp(d);
      }
    }
  }
}

// ================= ИИ ботов: у каждого меха свой характер =================
const AI_RANGE = { brawler: 32, skirmisher: 30, circler: 30, rammer: 12, bastion: 16 };
const AI_FLEE = { brawler: 0.12, skirmisher: 0.35, circler: 0.25, rammer: 0.2, bastion: 0.15 };
function botAI(b, dt) {
  const ai = b.S.ai;
  if (!b.home) b.home = { x: b.x, z: b.z };
  b.think -= dt;
  if (b.think <= 0) {
    b.think = 0.35 + Math.random() * 0.3;
    b.flee = false;
    let tgt = null;
    if (b.aggro) { const a = ents.get(b.aggro); if (a && !a.dead && Math.hypot(a.x - b.x, a.z - b.z) < 50) tgt = a; else b.aggro = null; }
    if (!tgt) {
      const hunters = new Map(); // не больше двух ботов на одну цель
      for (const o of ents.values()) if (o.bot && o !== b && o.target && !o.flee) hunters.set(o.target.id, (hunters.get(o.target.id) || 0) + 1);
      let best = null, bs = 1e9;
      for (const e of ents.values()) {
        if (e === b || e.dead || (hunters.get(e.id) || 0) >= 2) continue;
        if (e.bot && Math.random() < 0.35) continue;
        const d = Math.hypot(e.x - b.x, e.z - b.z);
        if (d > AI_RANGE[ai]) continue;
        const score = ai === 'skirmisher' ? d * 0.5 + e.frac() * 40 : d; // налётчик выбирает раненых
        if (score < bs) { bs = score; best = e; }
      }
      tgt = best;
    }
    if (ai === 'bastion' && tgt && Math.hypot(tgt.x - b.home.x, tgt.z - b.home.z) > 24) tgt = null; // бастион не уходит от точки
    if (tgt && b.hp < b.maxHp() * AI_FLEE[ai] && Math.random() < 0.7) b.flee = true;
    b.target = tgt;
    if (!tgt) {
      if (ai === 'bastion') { // не гонится: живёт возле своей точки, иногда переставляет её
        if (Math.random() < 0.05) b.home = { x: b.x, z: b.z };
        if (Math.hypot(b.wx - b.x, b.wz - b.z) < 4) { const an = Math.random() * 6.28, r = 4 + Math.random() * 10; b.wx = b.home.x + Math.sin(an) * r; b.wz = b.home.z + Math.cos(an) * r; }
      } else if (Math.hypot(b.wx - b.x, b.wz - b.z) < 6) [b.wx, b.wz] = world.randLand();
    }
  }
  let mx = 0, mz = 0, run = false;
  const t = b.target && !b.target.dead && ents.has(b.target.id) ? b.target : null;
  if (t && (b.latch || b.leap)) { /* на спине или в полёте — управляет сам захват */ }
  else if (t) {
    const dx = t.x - b.x, dz = t.z - b.z, d = Math.hypot(dx, dz) || 1, ang = Math.atan2(dx, dz);
    const reach = b.S.reach * b.scale + t.radius();
    const rearR = b.S.rear.length ? Math.max(...b.S.rear.map(m => rangeOf(b, m))) + t.radius() : 0;
    const off = Math.abs(angDiff(b.rot, ang)), behind = off > 1.75 && d < rearR * 0.95;
    const lim = b.S.turn * dt;
    const turnTo = a => { b.rot += Math.max(-lim, Math.min(lim, angDiff(b.rot, a))); };
    const face = () => turnTo(ang);
    const fwd = (k = 1) => { mx = dx / d * k; mz = dz / d * k; };
    const back = () => { mx = -dx / d; mz = -dz / d; };
    const side = k => { mx = -dz / d * b.orbit * k; mz = dx / d * b.orbit * k; };
    if (b.flee) { back(); run = b.st > 20; }
    else if (behind && b.phase !== 'retreat') { turnTo(ang + Math.PI); attack(b, false); } // враг сзади — бьём хвостом
    else if (ai === 'brawler') { // Рекс: давит напролом
      if (d > reach * 0.85) { fwd(); run = d > 12 && b.st > 30; }
      else { face(); if (off < 0.5) { if (b.spT <= 0 && Math.random() < 0.08) attack(b, true); else attack(b, false); } }
    } else if (ai === 'skirmisher') { // Раптор: серия — отскок по кругу, прыжок на спину для сближения
      if (b.phase === 'retreat') {
        b.phaseT -= dt; back(); const bx = mx, bz = mz; side(1); mx = mx * 0.8 + bx * 0.6; mz = mz * 0.8 + bz * 0.6; run = b.st > 15;
        if (b.phaseT <= 0) { b.phase = 'strike'; b.hits = 0; }
      } else if (d > reach * 0.85) {
        fwd(); run = b.st > 20;
        if (b.spT <= 0 && d < 12 && d > 4.5 && off < 0.2) attack(b, true); // прыжок-захват
      } else {
        face();
        if (off < 0.6 && b.atkT <= 0 && !b.busy()) { attack(b, false); if (++b.hits >= 3) { b.phase = 'retreat'; b.phaseT = 1.0 + Math.random() * 0.6; b.orbit = Math.random() < 0.5 ? 1 : -1; } }
      }
    } else if (ai === 'circler') { // Спино: кусает и рвёт когтями, потом разворачивается к врагу пилой; издали — молния
      if (b.phase === 'saw') {
        b.phaseT -= dt; turnTo(ang + Math.PI);
        if (b.phaseT <= 0 || d > rearR * 1.2) b.phase = '';
      } else if (d > reach * 0.85) {
        fwd(); run = d > 14 && b.st > 30;
        if (b.spT <= 0 && d > 6 && d < b.S.special.range * 0.9 * b.scale && off < 0.35) attack(b, true);
      } else {
        face();
        if (off < 0.6 && b.atkT <= 0 && !b.busy()) { attack(b, false); if (b.stepF >= 3) { b.phase = 'saw'; b.phaseT = 2.2; b.stepF = 0; } }
      }
    } else if (ai === 'rammer') { // Трицера: разгоняется и таранит
      if (d > reach * 0.85) { fwd(); run = d > 10 && b.st > 30; if (b.spT <= 0 && d > 6 && d < 20 && off < 0.25) attack(b, true); }
      else { face(); if (off < 0.6) attack(b, false); }
    } else { // bastion — Стего: держит точку, поворачивается к врагу хвостом; издали — залп шипов
      const hd = Math.hypot(b.home.x - b.x, b.home.z - b.z);
      if (hd > 20) { mx = (b.home.x - b.x) / hd; mz = (b.home.z - b.z) / hd; }
      else if (d < rearR * 1.3) turnTo(ang + Math.PI);
      else if (d < 10) {
        face();
        const nm = nextMove(b).mv;
        if (off < 0.45 && (nm.area === 'proj' || d < rangeOf(b, nm) + t.radius())) attack(b, false);
      }
      const R = b.S.special.radius * b.scale * 0.9;
      if (b.spT <= 0 && d < R && (b.hp < b.maxHp() * 0.7 || Math.random() < 0.03)) attack(b, true);
    }
    if (b.ultCd <= 0 && !b.flee && Math.random() < 0.05) { // ультимейт по ситуации
      const U = b.S.ult;
      const go = U.type === 'buff' ? d < 12 : U.type === 'barrage' || U.type === 'storm' ? d < U.range * 0.8 : U.type === 'stomp' ? d < U.radius * 0.85 : (b.hp < b.maxHp() * 0.65 && d < 14);
      if (go) ultimate(b);
    }
  } else {
    const dx = b.wx - b.x, dz = b.wz - b.z, d = Math.hypot(dx, dz) || 1;
    const k = ai === 'bastion' ? 0.35 : 0.55;
    mx = dx / d * k; mz = dz / d * k;
  }
  moveMech(b, mx, mz, run, dt);
}

function manageBots(dt) {
  const host = netStatus === 'offline' || (netStatus === 'online' && NOW() - netStart > 3000 && isHost());
  const mine = [...ents.values()].filter(e => e.bot && e.local);
  if (!host) { for (const b of mine) { ents.delete(b.id); b.dispose(); } return; }
  const want = Math.max(3, Math.min(8, 10 - (1 + activePeers())));
  botTimer -= dt;
  if (mine.length < want && botTimer <= 0) { spawnBot(); botTimer = 1.5; }
  else if (mine.length > want + 1) { const b = mine[0]; ents.delete(b.id); b.dispose(); }
}

// ================= Ввод =================
const keys = {};
addEventListener('keydown', e => {
  if (e.target && e.target.tagName === 'INPUT') return;
  keys[e.code] = true;
  if (!playing) return;
  if (e.code === 'Space' || e.code === 'KeyJ') { attack(me, false); e.preventDefault(); }
  if (e.code === 'KeyE' || e.code === 'KeyK') attack(me, true);
  if (e.code === 'KeyQ' || e.code === 'KeyL' || e.code === 'KeyR') ultimate(me);
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
const camDrag = { id: null, x: 0, y: 0, moved: 0, type: '' };
let runToggle = false;
const touchLayer = $('touch'), joyBase = $('joy'), joyKnob = $('knob');

touchLayer.addEventListener('pointerdown', e => {
  initAudio();
  if (e.pointerType === 'touch' && e.clientX < innerWidth * 0.45 && joy.id === null) {
    joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY; joy.x = joy.y = 0;
    joyBase.style.display = 'block'; joyBase.style.left = e.clientX + 'px'; joyBase.style.top = e.clientY + 'px';
    joyKnob.style.transform = 'translate(-50%,-50%)';
    $('joy-hint').classList.add('hidden');
  } else if (camDrag.id === null) {
    camDrag.id = e.pointerId; camDrag.x = e.clientX; camDrag.y = e.clientY; camDrag.moved = 0; camDrag.type = e.pointerType;
  }
  touchLayer.setPointerCapture(e.pointerId);
});
touchLayer.addEventListener('pointermove', e => {
  if (e.pointerId === joy.id) {
    let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy; const d = Math.hypot(dx, dy), R = 55;
    if (d > R) { dx = dx / d * R; dy = dy / d * R; }
    joy.x = dx / R; joy.y = dy / R;
    joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  } else if (e.pointerId === camDrag.id) {
    const dx = e.clientX - camDrag.x, dy = e.clientY - camDrag.y;
    camDrag.x = e.clientX; camDrag.y = e.clientY; camDrag.moved += Math.abs(dx) + Math.abs(dy);
    const k = camDrag.type === 'touch' ? 0.008 : 0.006;
    camYaw -= dx * k; camPitch = Math.max(0.08, Math.min(1.1, camPitch + dy * 0.004));
    lastCamInput = NOW();
  }
});
const endPtr = e => {
  if (e.pointerId === joy.id) { joy.id = null; joy.x = joy.y = 0; joyBase.style.display = 'none'; }
  if (e.pointerId === camDrag.id) {
    if (camDrag.type === 'mouse' && camDrag.moved < 6 && playing) attack(me, false);
    camDrag.id = null;
  }
};
touchLayer.addEventListener('pointerup', endPtr);
touchLayer.addEventListener('pointercancel', endPtr);
touchLayer.addEventListener('contextmenu', e => e.preventDefault());

function bindBtn(id, fn) {
  $(id).addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); initAudio(); if (playing) fn(); });
}
bindBtn('b-atk', () => attack(me, false));
bindBtn('b-sp', () => attack(me, true));
bindBtn('b-ult', () => ultimate(me));
bindBtn('b-run', () => { runToggle = !runToggle; $('b-run').classList.toggle('on', runToggle); });

function updatePlayer(dt) {
  let ix = 0, iy = 0;
  if (keys.KeyW || keys.ArrowUp) iy += 1; if (keys.KeyS || keys.ArrowDown) iy -= 1;
  if (keys.KeyA || keys.ArrowLeft) ix -= 1; if (keys.KeyD || keys.ArrowRight) ix += 1;
  if (joy.id !== null) { ix = joy.x; iy = -joy.y; }
  const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
  const mx = fx * iy - fz * ix, mz = fz * iy + fx * ix;
  const run = keys.ShiftLeft || keys.ShiftRight || runToggle;
  moveMech(me, mx, mz, run, dt);
  if (runToggle && me.st <= 1) { runToggle = false; $('b-run').classList.remove('on'); }
  // камера мягко заходит за спину, когда идёшь вперёд и не крутишь её сам
  if (iy > 0.3 && Math.abs(ix) < 0.5 && NOW() - lastCamInput > 1200) camYaw += angDiff(camYaw, me.rot) * Math.min(1, dt * 1.2);
}

// ================= Камера и превью в меню =================
const camTarget = new THREE.Vector3(), camWant = new THREE.Vector3(), _right = new THREE.Vector3();
let menuAngle = 0, viewT = 0, preview = null, previewKey = '', previewT = 1.2, previewI = 0;
const PREVIEW_POS = (() => {
  for (let r = 0; r < 80; r += 3) for (let a = 0; a < 6.28; a += 0.4) {
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (height(x, z) > WATER_Y + 1.5 && world.trees.every(t => Math.hypot(t.x - x, t.z - z) > 8)) return [x, z];
  }
  return [0, 0];
})();
function setPreview(key) {
  if (previewKey === key) return;
  if (preview) preview.dispose();
  preview = new Mech('preview', key, '', { preview: true, x: PREVIEW_POS[0], z: PREVIEW_POS[1], g: 1 });
  previewKey = key; previewT = 1.0; previewI = 0;
  ring(preview.x, preview.y, preview.z, 5, preview.S.glow);
}
function updateCamera(dt, time) {
  if (DBG.cam) { const c = typeof DBG.cam === 'function' ? DBG.cam() : DBG.cam; camera.position.set(...c[0]); camera.lookAt(...c[1]); return; }
  if (me) {
    const s = me.scale * me.S.cam;
    const dist = 3.8 + 10.5 * s, h = 1.0 + 3.2 * s;
    camTarget.set(me.x, me.y + h, me.z);
    const cp = Math.cos(camPitch);
    const cx = me.x - Math.sin(camYaw) * dist * cp, cz = me.z - Math.cos(camYaw) * dist * cp;
    const cy = Math.max(camTarget.y + Math.sin(camPitch) * dist, height(cx, cz) + 1.2, WATER_Y + 1);
    camera.position.lerp(camWant.set(cx, cy, cz), Math.min(1, dt * 10));
    if (shake > 0) { shake -= dt; camera.position.x += (Math.random() - 0.5) * shake * 2; camera.position.y += (Math.random() - 0.5) * shake * 2; }
    if (camBump > 0.002) camera.position.y -= camBump; // тяжёлый шаг — камера чуть вздрагивает
    camBump *= Math.exp(-dt * 14);
    camera.lookAt(camTarget);
    viewT -= dt; if (viewT <= 0) { viewT = 0.12; world.clearView(camera.position, me.x, me.z); }
    if (preview) { preview.dispose(); preview = null; previewKey = ''; }
  } else if (preview) {
    // меню: камера облетает выбранного меха, а сам мех стоит в свободной части экрана
    menuAngle += dt * 0.22;
    // в меню робот показывает свои атаки по очереди
    previewT -= dt;
    if (previewT <= 0) {
      const S = preview.S, list = S.all.map(m => ({ an: m.anim, mv: m })).concat([{ an: S.special.anim, sp: true }, { an: S.ult.anim, ult: true }]);
      const it = list[previewI++ % list.length];
      preview.dir = (it.mv && it.mv.side) || -preview.dir;
      startAct(preview, it.an, it.mv ? { mv: it.mv } : { sp: it.sp, ult: it.ult });
      previewT = AN[it.an].d + 0.9;
    }
    preview.visual(dt, time);
    const p = preview.m.root.position, land = innerWidth > innerHeight, D = land ? 15 : 19;
    camera.position.set(p.x + Math.sin(menuAngle) * D, p.y + 5, p.z + Math.cos(menuAngle) * D);
    camTarget.set(p.x, p.y + 2.4, p.z);
    _right.set(Math.cos(menuAngle), 0, -Math.sin(menuAngle));
    if (land) camTarget.addScaledVector(_right, D * 0.55); else camTarget.y -= 4.2;
    camera.lookAt(camTarget);
    viewT -= dt; if (viewT <= 0) { viewT = 0.2; world.clearView(camera.position, p.x, p.z); }
  } else {
    menuAngle += dt * 0.08;
    camera.position.set(Math.sin(menuAngle) * 70, 32, Math.cos(menuAngle) * 70);
    camera.lookAt(0, 0, 0);
  }
}

// ================= Миникарта =================
const mm = $('minimap'), mctx = mm.getContext('2d'), MM = 120;
mm.width = MM; mm.height = MM;
const mmBg = (() => {
  const c = document.createElement('canvas'); c.width = c.height = MM; const x = c.getContext('2d');
  const img = x.createImageData(MM, MM);
  for (let j = 0; j < MM; j++) for (let i = 0; i < MM; i++) {
    const wx = (i / MM - 0.5) * 2 * MAP_R, wz = (j / MM - 0.5) * 2 * MAP_R, k = (j * MM + i) * 4;
    const d = Math.hypot(wx, wz), h = height(wx, wz);
    const col = d > MAP_R - 5 ? [0, 0, 0, 0] : h < WATER_Y ? [59, 143, 196, 230] : h < WATER_Y + 0.5 ? [217, 197, 140, 230] : [86, 150, 64, 230];
    img.data.set(col, k);
  }
  x.putImageData(img, 0, 0); return c;
})();
function drawMinimap() {
  mctx.clearRect(0, 0, MM, MM);
  mctx.drawImage(mmBg, 0, 0);
  // карта повёрнута так, чтобы «вперёд» камеры было вверху
  mctx.save();
  const toM = v => (v / (2 * MAP_R) + 0.5) * MM;
  for (const e of ents.values()) {
    if (e === me || e.dead) continue;
    mctx.fillStyle = e.bot ? '#ffb03a' : '#ff3b3b';
    const r = 1.5 + e.scale * 1.3;
    mctx.fillRect(toM(e.x) - r, toM(e.z) - r, r * 2, r * 2);
  }
  if (me) {
    mctx.translate(toM(me.x), toM(me.z)); mctx.rotate(-me.rot + Math.PI);
    mctx.fillStyle = '#fff'; mctx.strokeStyle = '#000'; mctx.lineWidth = 1;
    mctx.beginPath(); mctx.moveTo(0, -6); mctx.lineTo(4.5, 4.5); mctx.lineTo(-4.5, 4.5); mctx.closePath(); mctx.fill(); mctx.stroke();
  }
  mctx.restore();
}

// ================= Интерфейс =================
function toast(t) { const el = $('toast'); el.textContent = t; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); }
function feed(t) {
  const el = document.createElement('div'); el.textContent = t; $('feed').prepend(el);
  while ($('feed').children.length > 3) $('feed').lastChild.remove();
  setTimeout(() => el.remove(), 6000);
}
function flashVignette() { const v = $('vignette'); v.classList.remove('hit'); void v.offsetWidth; v.classList.add('hit'); }

function updateHud() {
  const st = netStatus === 'online' ? `🟢 ${1 + activePeers()} онлайн` : netStatus === 'connecting' ? '🟡 Подключение…' : '🔴 Оффлайн, только боты';
  $('online').textContent = st + (mode === 'prime' ? ' · Прайм-арена' : ' · Апгрейд');
  const top = innerHeight < 500 ? 3 : 5;
  const list = [...ents.values()].filter(e => !e.dead).sort((a, b) => b.kills - a.kills || b.g - a.g).slice(0, top);
  $('lb').innerHTML = list.map((e, i) => `<div class="${e === me ? 'me' : ''}">${i + 1}. ${esc(e.name)} <span>${STAGES[stageIndex(e.g)]} · ⚙️${e.kills}</span></div>`).join('');
  if (!me) return;
  const f = Math.max(0, me.hp / me.maxHp());
  $('hp-fill').style.width = f * 100 + '%';
  $('hp-txt').textContent = `${Math.ceil(Math.max(0, me.hp))} / ${Math.round(me.maxHp())}`;
  $('st-fill').style.width = me.st + '%';
  $('gr-fill').style.width = Math.min(1, me.g) * 100 + '%';
  $('stage').innerHTML = `<b style="color:${me.S.glow}">${me.S.name}</b> · ${STAGES[stageIndex(me.g)]}` + (me.g < 1 ? ` <small>${Math.floor(me.g * 100)}%</small>` : ' ★');
  $('b-sp').style.setProperty('--cd', Math.max(0, me.spT / me.S.special.cd));
  const mv = nextMove(me).mv;
  $('b-atk').style.setProperty('--cd', Math.max(0, me.atkT / mv.cd));
  $('b-ult').style.setProperty('--cd', Math.max(0, me.ultCd / me.S.ult.cd));
  $('b-ult').classList.toggle('ready', me.ultCd <= 0);
  if ($('atk-name').textContent !== mv.name) $('atk-name').textContent = mv.name;
  $('food-hint').textContent = mode === 'prime' ? (me.S.diet === 'carn' ? '🔩 Металлолом чинит броню' : '💎 Кристаллы чинят броню')
    : me.S.diet === 'carn' ? '🔩 Собирай металлолом и побеждай' : '💎 Собирай энергокристаллы';
}

// ----- Полный экран и горизонтальная ориентация -----
async function goLandscape() {
  if (!isTouch) return;
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
  } catch (e) { /* iPhone не даёт — покажем подсказку повернуть */ }
}
$('b-full').addEventListener('pointerdown', e => {
  e.stopPropagation();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else goLandscape();
});
if (!document.documentElement.requestFullscreen) $('b-full').classList.add('hidden');

// ----- Меню -----
let chosen = localStorage.getItem('mech_sp') || 'rex';
let chosenMode = localStorage.getItem('mech_mode') || 'grow';
if (!SPECIES[chosen]) chosen = 'rex';
$('nick').value = localStorage.getItem('mech_nick') || '';
function renderCards() {
  const max = { hp: 1600, dmg: 160, run: 17 };
  $('cards').innerHTML = SP_KEYS.map(k => {
    const S = SPECIES[k];
    const bar = (v, m) => `<i><b style="width:${Math.round(v / m * 100)}%;background:${S.glow}"></b></i>`;
    return `<button class="card ${k === chosen ? 'sel' : ''}" data-k="${k}" style="--g:${S.glow}">
      <div class="cn">${S.name}</div>
      <div class="cd">${S.diet === 'carn' ? '🔩 Металлолом' : '💎 Кристаллы'}</div>
      <div class="st"><em>ЗАЩ</em>${bar(S.rate.def, max.hp)}</div>
      <div class="st"><em>УРН</em>${bar(S.rate.dps, max.dmg)}</div>
      <div class="st"><em>СКР</em>${bar(S.run, max.run)}</div>
    </button>`;
  }).join('');
  const S = SPECIES[chosen];
  $('desc').innerHTML = `<span class="dd">${S.desc}</span>
    <div class="tr"><b>⚔️ Серия:</b> ${S.front.map(m => m.name).join(' → ')}</div>
    <div class="tr"><b>↩️ Враг сзади:</b> ${S.rear.map(m => m.name).join(', ')}</div>
    <div class="tr"><b style="color:${S.glow}">✨ ${S.special.name}:</b> ${S.special.info}</div>
    <div class="tr"><b style="color:${S.glow}">🌀 ${S.ult.name}:</b> ${S.ult.info}</div>
    <div class="tr"><b>🛡 ${S.passive.name}:</b> ${S.passive.info}</div>
    <div class="tr ai"><b>🧠 Стиль:</b> ${S.aiInfo}</div>`;
  document.querySelectorAll('.card').forEach(b => b.onclick = () => { chosen = b.dataset.k; renderCards(); });
  document.querySelectorAll('.mode').forEach(b => {
    b.classList.toggle('sel', b.dataset.m === chosenMode);
    b.onclick = () => { chosenMode = b.dataset.m; renderCards(); };
  });
  setPreview(chosen);
}
renderCards();

function startGame() {
  initAudio();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); // иначе клавиши уходят в поле ника
  goLandscape();
  const name = ($('nick').value.trim() || 'Пилот' + Math.floor(Math.random() * 900 + 100)).slice(0, 14);
  localStorage.setItem('mech_nick', name); localStorage.setItem('mech_sp', chosen); localStorage.setItem('mech_mode', chosenMode);
  $('menu').classList.add('hidden'); $('death').classList.add('hidden'); $('hud').classList.remove('hidden');
  document.body.classList.add('playing');
  if (mode !== chosenMode || !net) startNet(chosenMode);
  if (me) { ents.delete(me.id); me.dispose(); me = null; }
  spawnMe(chosen, name);
  $('sp-name').textContent = SPECIES[chosen].special.name; $('ult-name').textContent = SPECIES[chosen].ult.name;
  toast(chosenMode === 'prime' ? 'Прайм-арена: все на максимуме. В бой!' : 'Собирай ресурсы и прокачайся до ПРАЙМА!');
}
$('play').onclick = startGame;
function showDeath(by) {
  const sec = Math.round((NOW() - lifeStats.start) / 1000);
  $('death-by').textContent = by ? `Тебя уничтожил: ${by}` : '';
  $('death-stats').innerHTML = `<div><b>${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}</b><span>в бою</span></div>
    <div><b>${lifeStats.kills}</b><span>побед</span></div><div><b>${STAGES[lifeStats.best]}</b><span>уровень</span></div>`;
  document.body.classList.remove('playing');
  setTimeout(() => $('death').classList.remove('hidden'), 700);
}
$('again').onclick = startGame;
$('to-menu').onclick = () => { $('death').classList.add('hidden'); $('hud').classList.add('hidden'); $('menu').classList.remove('hidden'); previewKey = ''; setPreview(chosen); };

// ================= Главный цикл =================
let last = NOW(), fpsAcc = 0, fpsFrames = 0;
function frame() {
  requestAnimationFrame(frame);
  const now = NOW();
  const rdt = Math.min(0.05, (now - last) / 1000); last = now;
  const time = now / 1000;
  // хит-стоп: на долю секунды всё «замирает» при сильном ударе — удар ощущается
  const dt = (hitStop > 0 ? rdt * 0.12 : rdt) * DBG.ts; hitStop = Math.max(0, hitStop - rdt);

  if (playing && me && !me.dead) { updatePlayer(dt); tickCommon(me, dt); }
  if (mode) manageBots(dt);
  for (const e of ents.values()) {
    if (e.local && e.bot && !e.dead && !DBG.freeze) { botAI(e, dt); tickCommon(e, dt); }
    if (!e.local) {
      if (now - e.lastSeen > 5000) { ents.delete(e.id); e.dispose(); continue; }
      const k = Math.min(1, dt * 10);
      if (Math.hypot(e.tx - e.x, e.tz - e.z) > 25) { e.x = e.tx; e.z = e.tz; }
      e.x += (e.tx - e.x) * k; e.z += (e.tz - e.z) * k; e.rot += angDiff(e.rot, e.trot) * k;
    }
    e.visual(dt, time);
  }
  world.update(dt, time);
  fx.update(dt);
  updateCamera(rdt, time);
  updateNums(rdt);

  sendTimer -= rdt; if (sendTimer <= 0) { sendTimer = 0.1; sendState(); }
  hudTimer -= rdt; if (hudTimer <= 0) { hudTimer = 0.2; updateHud(); }
  mapTimer -= rdt; if (mapTimer <= 0 && playing) { mapTimer = 0.25; drawMinimap(); }

  renderer.render(scene, camera);

  // Автонастройка качества: если тормозит — снижаем разрешение
  fpsAcc += rdt; fpsFrames++;
  if (fpsAcc > 2) {
    const fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0;
    if (fps < 40 && pixelRatio > 0.7) {
      pixelRatio = Math.max(0.7, pixelRatio - 0.2); renderer.setPixelRatio(pixelRatio);
      if (fps < 28) { scene.fog.far = 150; camera.far = 160; camera.updateProjectionMatrix(); }
    }
    $('fps').textContent = Math.round(fps) + ' FPS';
  }
}
$('loading').classList.add('hidden');
requestAnimationFrame(frame);
window.__game = { ents, world, renderer, get me() { return me; }, attack, ultimate, AN, DBG, cam(y, p) { camYaw = y; camPitch = p; lastCamInput = NOW() + 1e9; }, spawn: sp => spawnBot(sp),
  // для отладки сети: подменить отправку состояния (зеркало самого себя)
  dbgNet(fn) { net = fn ? { state: fn, hit() {}, kill() {}, leave() {} } : null; }, handlers };
