import * as THREE from 'three';
import { SPECIES, SP_KEYS, STAGES, buildDino, setFlash, growthScale, statMul, stageIndex } from './species.js';
import { World, height, inWater, MAP_R, WATER_Y } from './world.js';
import { connect } from './net.js';
import { sfx, initAudio } from './sfx.js';

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
    this.local = !!o.local; this.bot = !!o.bot; this.g = o.g ?? 0; this.kills = 0;
    this.m = buildDino(sp); scene.add(this.m.root);
    this.x = o.x || 0; this.z = o.z || 0; this.y = height(this.x, this.z); this.rot = o.rot || 0;
    this.tx = this.x; this.tz = this.z; this.trot = this.rot;
    this.hp = this.maxHp(); this.hpFrac = 1; this.st = 100;
    this.atkT = 0; this.spT = 0; this.dashT = 0; this.dashHit = null; this.atkAnim = 0; this.atkFlagT = 0;
    this.combatT = 0; this.protUntil = o.local && !o.bot ? NOW() + 3000 : 0; this.eatT = 0; this.flashT = 0;
    this.moving = false; this.sprint = false; this.walk = 0; this.amp = 0; this.seed = Math.random() * 10;
    this.lastSeen = NOW(); this.peer = null; this.lastAtkFlag = 0; this.lastSpFlag = 0;
    this.stunT = 0; this.slowT = 0; this.shieldT = 0; this.stunImm = 0; this.kvx = 0; this.kvz = 0; this.combo = 0; this.spFlagT = 0; this.ringT = 0; this.step = 0; this.chainT = 0; this.lastStep = 0; this.curMove = null; this.ultCd = 0; this.ultT = 0; this.ultFlagT = 0; this.lastUltFlag = 0; this.stormT = 0; this.stormTick = 0; this.stormLeft = 0; this.stormVis = 0; this.stormVT = 0; this.spinVis = 0; this.spinDur = 1; this.spinTurns = 1; this.sawMove = null; this.tailMove = null; this.latch = null; this.sawT = 0; this.sawTick = 0; this.sawVis = 0; this.tailT = 0; this.hopT = 0; this.clung = false; this.vsp = 0; this.dir = 1; this.wasLatch = false; this.phase = ''; this.hits = 0; this.orbit = 1; this.orbitT = 2; this.home = null;
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
  visual(dt, time) {
    const m = this.m, s = this.scale;
    this.y = height(this.x, this.z);
    let up = 0;
    if (this.hopT > 0) { this.hopT -= dt; const sp = this.S.special; up += Math.sin(Math.PI * Math.max(0, 1 - this.hopT / sp.dur)) * sp.hop * s; }
    if (this.local ? !!(this.latch && this.latch.kind === 'cling') : this.clung) up += 2.2;
    m.root.position.set(this.x, Math.max(this.y, WATER_Y - 1.2 * s) + up, this.z);
    m.root.rotation.y = this.rot;
    m.root.scale.setScalar(s);
    const target = this.moving ? (this.sprint ? 0.7 : 0.48) : 0;
    this.amp += (target - this.amp) * Math.min(1, dt * 8);
    this.walk += dt * (this.sprint ? 12 : 8) / Math.sqrt(s * this.S.cam + 0.2) * (this.moving ? 1 : 0.15);
    for (const L of m.legs) L.pivot.rotation.x = Math.sin(this.walk + L.ph) * this.amp;
    m.tail.rotation.y = Math.sin(time * 1.5 + this.seed) * 0.08 + Math.sin(this.walk * 0.5) * 0.2 * this.amp;
    // механическая походка: корпус чуть качается
    m.body.position.y = Math.abs(Math.sin(this.walk)) * 0.1 * this.amp;
    m.body.rotation.z = Math.sin(this.walk) * 0.04 * this.amp;
    // у каждого робота и у каждого удара серии своя анимация
    const mv = this.curMove || this.S.moves[0], anim = mv.anim;
    m.body.rotation.x = 0; m.body.rotation.y = 0; m.body.position.z = 0;
    let tYaw = 0, tPitch = 0;
    if (this.atkAnim > 0) {
      this.atkAnim = Math.max(0, this.atkAnim - dt * (mv.as || 3));
      const u = 1 - this.atkAnim, k = Math.sin(u * Math.PI), sd = this.dir;
      if (anim === 'bite') { m.head.rotation.x = k * 0.5; m.head.position.z = m.headZ + k * 0.6; m.body.rotation.x = k * 0.06; }
      else if (anim === 'slap') { m.body.rotation.y = sd * k * 0.5; m.head.rotation.x = k * 0.2; m.head.position.z = m.headZ + k * 0.3; }
      else if (anim === 'ram') { m.head.rotation.x = k * 0.6; m.head.position.z = m.headZ + k * 0.7; m.body.position.z = k * 0.8; m.body.rotation.x = k * 0.15; }
      else if (anim === 'claw') { m.head.rotation.x = k * 0.3; m.head.position.z = m.headZ + k * 0.5; m.body.rotation.y = sd * k * 0.45; }
      else if (anim === 'gore') { m.head.rotation.x = k * 0.8; m.head.position.z = m.headZ + k * 0.9; m.body.position.z = k * 0.5; m.body.rotation.x = k * 0.1; }
      else if (anim === 'uppercut') { m.head.rotation.x = -k * 0.7; m.head.position.z = m.headZ + k * 0.5; m.body.rotation.x = -k * 0.08; }
      else if (anim === 'tail') { // хвост поднимается над землёй, затем хлёст вниз-в сторону (не проходит сквозь корпус)
        tPitch = u < 0.5 ? 0.9 * Math.sin(u / 0.5 * Math.PI / 2) : Math.max(0, 0.9 * (1 - (u - 0.5) / 0.4));
        tYaw = u > 0.45 ? Math.sin(Math.min(1, (u - 0.45) / 0.55) * Math.PI) * 0.9 * sd : 0;
        m.head.rotation.x = 0; m.head.position.z = m.headZ;
      } else if (anim === 'tailside') { tYaw = (u - 0.5) * 2.2 * sd; tPitch = 0.2 * k; m.head.rotation.x = 0; m.head.position.z = m.headZ; }
      else if (anim === 'spikes') { m.body.rotation.x = -k * 0.1; m.head.rotation.x = -k * 0.2; }
      else if (anim === 'shock') { m.body.rotation.x = k * 0.06; m.head.rotation.x = -k * 0.15; }
      else { m.head.rotation.x = k * 0.2; m.head.position.z = m.headZ + k * 0.3; }
    } else {
      // робот: голова сканирует местность рывками, как сервопривод
      const st = Math.round(Math.sin(time * 0.5 + this.seed) * 2) / 2;
      m.head.rotation.y += (st * 0.4 - m.head.rotation.y) * Math.min(1, dt * 10);
      m.head.rotation.x = Math.round(Math.sin(time * 0.9 + this.seed) * 3) / 3 * 0.05; m.head.position.z = m.headZ;
    }
    if (this.spinVis > 0) { // вращение всем корпусом: хвост-пила и веер клинков (хвост не проходит сквозь тело)
      this.spinVis -= dt;
      const u = 1 - Math.max(0, this.spinVis) / this.spinDur;
      m.root.rotation.y = this.rot + u * Math.PI * 2 * this.spinTurns;
    }
    if (this.stormVis > 0 && !this.local) { this.stormVis -= dt; this.stormVT -= dt; if (this.stormVT <= 0) { this.stormVT += this.S.ult.dur / this.S.ult.strikes; stormStrike(this, false); } }
    m.tail.rotation.y += tYaw; m.tail.rotation.x = tPitch;
    if (this.stunT > 0) m.head.rotation.z = Math.sin(time * 40) * 0.12; else m.head.rotation.z = 0;
    this.ringT -= dt;
    if (this.ringT <= 0) {
      if (this.shieldT > 0) { this.ringT = 0.45; ring(this.x, this.y, this.z, this.radius() * 1.5, '#66ccff'); }
      else if (this.over() || this.boost()) { this.ringT = 0.3; sparks(this.x, this.y + this.S.h * s * 0.7, this.z, 0.5, 2); }
      else if (this.stunT > 0) { this.ringT = 0.15; sparks(this.x, this.y + this.S.h * s, this.z, 0.5, 2); }
    }
    if (this.flashT > 0) { this.flashT -= dt; setFlash(m, this.flashT > 0); }
    if (this.label) {
      const L = this.label;
      drawLabel(L, this.name, this.frac(), stageIndex(this.g), this.bot);
      L.sp.position.set(this.x, this.y + (this.S.h + 0.6) * s + 0.6, this.z);
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

// ================= Эффекты: искры, кольца, цифры урона =================
const fxGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffc23a });
const fx = [];
for (let i = 0; i < 60; i++) { const m = new THREE.Mesh(fxGeo, sparkMat); m.visible = false; scene.add(m); fx.push({ m, life: 0, vx: 0, vy: 0, vz: 0, g: 20 }); }
let fxI = 0;
function sparks(x, y, z, s = 1, n = 8, up = 1) {
  for (let i = 0; i < n; i++) {
    const p = fx[fxI++ % fx.length];
    p.life = 0.5 + Math.random() * 0.2; p.m.visible = true; p.m.position.set(x, Math.max(y, height(x, z) + 0.25), z); p.m.scale.setScalar(s * (0.6 + Math.random() * 0.6));
    p.vx = (Math.random() - 0.5) * 10 * s; p.vy = (2 + Math.random() * 7) * s * up; p.vz = (Math.random() - 0.5) * 10 * s; p.g = 22;
  }
}
const boltGeo = new THREE.BoxGeometry(0.14, 0.14, 1).translate(0, 0, 0.5);
const bolts = [];
for (let i = 0; i < 48; i++) { const m = new THREE.Mesh(boltGeo, new THREE.MeshBasicMaterial({ color: 0x7af6ff })); m.visible = false; scene.add(m); bolts.push({ m, life: 0 }); }
let boltI = 0;
const _b1 = new THREE.Vector3(), _b2 = new THREE.Vector3();
function bolt(x1, y1, z1, x2, y2, z2, color = '#7af6ff') {
  let px = x1, py = y1, pz = z1;
  for (let i = 1; i <= 3; i++) {
    const k = i / 3, j = i < 3 ? 0.7 : 0;
    const nx = x1 + (x2 - x1) * k + (Math.random() - 0.5) * j, ny = y1 + (y2 - y1) * k + (Math.random() - 0.5) * j, nz = z1 + (z2 - z1) * k + (Math.random() - 0.5) * j;
    const b = bolts[boltI++ % bolts.length];
    b.life = 0.16; b.m.visible = true; b.m.material.color.set(color);
    b.m.position.set(px, py, pz); _b2.set(nx, ny, nz); b.m.lookAt(_b2); b.m.scale.z = Math.max(0.1, _b1.set(nx - px, ny - py, nz - pz).length());
    px = nx; py = ny; pz = nz;
  }
}
const ringGeo = new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2);
const rings = [];
for (let i = 0; i < 6; i++) {
  const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  m.visible = false; scene.add(m); rings.push({ m, life: 0, R: 1 });
}
let ringI = 0;
function ring(x, y, z, R, color) {
  const r = rings[ringI++ % rings.length];
  r.life = 0.45; r.R = R; r.m.visible = true; r.m.position.set(x, Math.max(y, height(x, z)) + 0.5, z); r.m.material.color.set(color);
}
function updateFx(dt) {
  for (const p of fx) {
    if (p.life <= 0) continue;
    p.life -= dt; p.vy -= p.g * dt;
    p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
    p.m.rotation.x += dt * 8;
    if (p.life <= 0) p.m.visible = false;
  }
  for (const b of bolts) { if (b.life <= 0) continue; b.life -= dt; if (b.life <= 0) b.m.visible = false; }
  for (const r of rings) {
    if (r.life <= 0) continue;
    r.life -= dt; const k = 1 - r.life / 0.45;
    r.m.scale.setScalar(0.3 * r.R + k * r.R); r.m.material.opacity = 1 - k;
    if (r.life <= 0) r.m.visible = false;
  }
}
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
// Автонаведение: если впереди никого, но враг рядом — разворачиваемся к нему
function autoAim(a, reach, mv) {
  if (mv && (mv.type === 'ring' || mv.type === 'saw')) return;
  const rear = !!mv && mv.type === 'tail';
  if (rear ? nearestInFront(a, reach, mv.arc, true) : nearestInFront(a, reach, mv && mv.cone || 1.1)) return;
  const t = nearestInFront(a, reach * 1.25, Math.PI);
  if (!t) return;
  // тяжёлые роботы разворачиваются медленно — автонаведение их не телепортирует
  const want = Math.atan2(t.x - a.x, t.z - a.z) + (rear ? Math.PI : 0), lim = a.S.turn * 0.4;
  a.rot += Math.max(-lim, Math.min(lim, angDiff(a.rot, want)));
}

function dealDamage(a, t, amount, f) {
  if (!t || t.dead) return;
  amount = Math.round(amount);
  const hy = t.y + t.S.h * 0.55 * t.scale;
  sparks(t.x, hy, t.z, Math.max(0.6, t.scale));
  t.flash();
  a.combatT = 6;
  if (a === me) { dmgNum(t.x, hy + 1, t.z, amount, true); sfx.clank(1); }
  if (t.local) applyDamage(t, amount, a.id, a.name, f);
  else if (net && t.peer) net.hit(t.peer, f ? { t: t.id, d: amount, b: a.id, n: a.name, f } : { t: t.id, d: amount, b: a.id, n: a.name });
}

const bodyPt = a => [a.x, a.y + a.S.h * 0.65 * a.scale, a.z];
const nearEnemies = (a, R) => { const r = []; for (const e of ents.values()) if (e !== a && !e.dead && Math.hypot(e.x - a.x, e.z - a.z) - e.radius() < R) r.push(e); return r; };

const rangeOf = (a, mv) => a.S.reach * a.scale * (mv.reach || 1);
const jit = () => (Math.random() - 0.5) * 0.8;

// Залп: самонаводящиеся выстрелы по ближайшим врагам (dry = только эффект, без урона — для чужих игроков)
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
  const vis = camera.position.distanceTo(a.m.root.position) < 60;
  const targets = list.slice(0, o.targets || 3).map(p => p[1]);
  if (!targets.length) {
    if (vis) for (let i = 0; i < Math.min(3, o.count); i++) bolt(...bodyPt(a), a.x + Math.sin(a.rot + (i - 1) * 0.2) * R * 0.7, a.y + a.S.h * 0.5 * a.scale, a.z + Math.cos(a.rot + (i - 1) * 0.2) * R * 0.7, o.color);
    return false;
  }
  for (let i = 0; i < o.count; i++) {
    const e = targets[i % targets.length];
    if (!dry) dealDamage(a, e, a.dmg() * o.dmg, o.fx || null);
    if (vis) bolt(...bodyPt(a), e.x + jit(), e.y + e.S.h * 0.55 * e.scale + jit(), e.z + jit(), o.color);
  }
  return true;
}

// Молния сверху по случайному врагу рядом (Грозовая буря)
function stormStrike(a, real) {
  const U = a.S.ult, R = U.range * a.scale, list = [];
  for (const e of ents.values()) if (e !== a && !e.dead && Math.hypot(e.x - a.x, e.z - a.z) - e.radius() < R) list.push(e);
  let x, z, y;
  if (list.length) { const e = list[Math.floor(Math.random() * list.length)]; x = e.x; z = e.z; y = e.y + e.S.h * 0.5 * e.scale; if (real) dealDamage(a, e, a.dmg() * U.dmg, U.fx); }
  else if (real) return;
  else { const an = Math.random() * 6.28, r = 4 + Math.random() * 8; x = a.x + Math.sin(an) * r; z = a.z + Math.cos(an) * r; y = height(x, z) + 1; }
  if (camera.position.distanceTo(a.m.root.position) < 70) { bolt(x + jit(), y + 16, z + jit(), x, y, z, '#ffffff'); ring(x, y - 1, z, 2.5, '#59a8ff'); }
}

// Удар из серии: у каждого свой тип
function doMove(a, mv) {
  const reach = rangeOf(a, mv), d = a.dmg();
  a.curMove = mv;
  if (mv.spin) { a.spinVis = a.spinDur = mv.spin; a.spinTurns = mv.turns || 2; }
  if (mv.type === 'saw') { a.sawMove = mv; a.sawT = mv.spin; a.sawTick = mv.spin / mv.ticks * 0.5; a.sawLeft = mv.ticks; return; }     // хвост-пила
  if (mv.type === 'tail') { a.tailMove = mv; a.tailT = mv.wind; return; }                                                              // хвост назад (удар придёт после замаха)
  if (mv.type === 'volley') { volley(a, mv); return; }                                                                                 // залп шипов
  if (mv.type === 'ring') {                                                                                                            // удар вокруг себя
    for (const e of nearEnemies(a, reach * 0.95)) dealDamage(a, e, d * mv.dmg, mv.fx || null);
    ring(a.x, a.y, a.z, reach * 0.95, a.S.glow);
    return;
  }
  if (mv.lunge) { a.kvx += Math.sin(a.rot) * mv.lunge; a.kvz += Math.cos(a.rot) * mv.lunge; }                                         // рывок вперёд
  const t = nearestInFront(a, reach, mv.cone || 1.1);
  if (t) dealDamage(a, t, d * mv.dmg, mv.fx || null);
  else if (a === me) sfx.clank(0.3);
}

// Отложенные и затяжные атаки (пила, хвост, захваты, буря) — считаются у владельца робота
function tickAttacks(d, dt) {
  if (d.sawT > 0) {
    const A = d.sawMove;
    d.sawT -= dt; d.sawTick -= dt;
    if (A && d.sawTick <= 0 && d.sawLeft > 0) {
      d.sawTick += A.spin / A.ticks; d.sawLeft--;
      for (const e of nearEnemies(d, d.S.reach * d.scale * 0.9)) dealDamage(d, e, d.dmg() * A.dmg, { sl: 0.5 });
      if (camera.position.distanceTo(d.m.root.position) < 50) sparks(d.x + Math.sin(d.rot + Math.PI) * 4 * d.scale, d.y + 1, d.z + Math.cos(d.rot + Math.PI) * 4 * d.scale, 0.8, 4);
    }
  }
  if (d.tailT > 0) {
    d.tailT -= dt;
    if (d.tailT <= 0 && d.tailMove) { // хлёст хвостом назад
      const A = d.tailMove, R = d.S.reach * d.scale * (A.reach || 1);
      let hit = false;
      for (const e of ents.values()) {
        if (e === d || e.dead) continue;
        const dx = e.x - d.x, dz = e.z - d.z, dist = Math.hypot(dx, dz) - e.radius();
        if (dist > R) continue;
        if (Math.abs(angDiff(d.rot + Math.PI, Math.atan2(dx, dz))) > A.arc && dist > d.radius() * 0.3) continue;
        hit = true; dealDamage(d, e, d.dmg() * A.dmg, { kb: A.kb });
      }
      if (camera.position.distanceTo(d.m.root.position) < 50) {
        ring(d.x - Math.sin(d.rot) * R * 0.6, d.y, d.z - Math.cos(d.rot) * R * 0.6, 2.2 * d.scale, d.S.glow);
        if (d === me) { shake = Math.max(shake, hit ? 0.3 : 0.1); sfx.clank(hit ? 1 : 0.3); }
      }
    }
  }
  if (d.stormT > 0) { // Грозовая буря
    const U = d.S.ult;
    d.stormT -= dt; d.stormTick -= dt;
    if (d.stormTick <= 0 && d.stormLeft > 0) { d.stormTick += U.dur / U.strikes; d.stormLeft--; stormStrike(d, true); }
  }
  const L = d.latch;
  if (L) { // захват: Рекс держит челюстями, Раптор сидит на спине
    L.t -= dt; L.acc -= dt;
    const t = ents.get(L.id);
    if (!t || t.dead) d.latch = null;
    else {
      if (L.acc <= 0) { L.acc += L.tick; d.atkAnim = 1; d.atkFlagT = 0.3; dealDamage(d, t, d.dmg() * L.mult, L.fx || null); }
      if (L.t <= 0) d.latch = null;
    }
  }
  if (d.wasLatch && !d.latch && d.sp === 'raptor') { d.kvx += -Math.sin(d.rot) * 6; d.kvz += -Math.cos(d.rot) * 6; } // спрыгивает
  d.wasLatch = !!d.latch;
}

// Визуальный эффект спецприёма (виден и у чужих игроков)
function specialFx(a) {
  const S = a.S, sp = S.special, reach = S.reach * a.scale;
  if (camera.position.distanceTo(a.m.root.position) > 60) return;
  if (sp.type === 'clamp') ring(a.x + Math.sin(a.rot) * reach * 0.7, a.y, a.z + Math.cos(a.rot) * reach * 0.7, 2.2 * a.scale, S.glow);
  else if (sp.type === 'leap') { a.hopT = sp.dur; sparks(a.x, a.y + 0.3, a.z, 1, 8, 0.5); ring(a.x, a.y, a.z, 2.2, S.glow); }
  else if (sp.type === 'bolt') {
    const t = nearestInFront(a, sp.range * a.scale, 0.5);
    if (t) {
      bolt(...bodyPt(a), ...bodyPt(t));
      let n2 = null, nd = 8 * a.scale;
      for (const e of ents.values()) { if (e === a || e === t || e.dead) continue; const dd = Math.hypot(e.x - t.x, e.z - t.z); if (dd < nd) { nd = dd; n2 = e; } }
      if (n2) bolt(...bodyPt(t), ...bodyPt(n2));
    } else bolt(...bodyPt(a), a.x + Math.sin(a.rot) * sp.range * 0.6, a.y + a.S.h * 0.5 * a.scale, a.z + Math.cos(a.rot) * sp.range * 0.6);
  } else if (sp.type === 'area') {
    const R = sp.radius * a.scale;
    ring(a.x, a.y, a.z, R, S.glow); ring(a.x, a.y + 0.3, a.z, R * 0.7, '#ffffff');
    for (let i = 0; i < 8; i++) { const an = i * 0.785; sparks(a.x + Math.sin(an) * R * 0.6, a.y + 0.5, a.z + Math.cos(an) * R * 0.6, 0.7, 2, 0.6); }
  }
}

// Эффект ультимейта; remote = чужой игрок (урон уже посчитал он сам)
function ultFx(a, remote) {
  const U = a.S.ult;
  if (camera.position.distanceTo(a.m.root.position) > 70) return;
  if (U.type === 'stomp') {
    for (let i = 1; i <= 3; i++) ring(a.x, a.y, a.z, U.radius * a.scale * i / 3, i === 3 ? a.S.glow : '#ffffff');
    for (let i = 0; i < 14; i++) { const an = i * 0.45; sparks(a.x + Math.sin(an) * U.radius * 0.7, a.y + 0.3, a.z + Math.cos(an) * U.radius * 0.7, 0.9, 2, 0.5); }
    if (a === me || camera.position.distanceTo(a.m.root.position) < 30) shake = Math.max(shake, 0.5);
  } else {
    ring(a.x, a.y, a.z, 5 * a.scale, a.S.glow);
    if (remote) {
      if (U.type === 'barrage') volley(a, { count: U.count, range: U.range, cone: Math.PI, dmg: 0, targets: 3, color: '#ffb03a' }, true);
      if (U.type === 'storm') { a.stormVis = U.dur; a.stormVT = 0.1; }
    }
  }
}

function attack(a, special) {
  if (!a || a.dead || a.stunT > 0) return;
  if (a.latch) { if (special && a.latch.kind === 'cling') { a.latch = null; a.spT = Math.max(a.spT, 1.5); } return; } // повторный «Спец» — спрыгнуть
  const S = a.S;
  if (!special) {
    if (a.atkT > 0) return;
    if (a.chainT <= 0) a.step = 0;
    const step = a.step, mv = S.moves[step];
    if (a === me) autoAim(a, rangeOf(a, mv), mv);
    a.lastStep = step; a.step = (step + 1) % S.moves.length; a.chainT = mv.win || 1.7;
    a.atkT = mv.cd * (a.over() || a.boost() ? 0.78 : 1); a.atkAnim = 1; a.atkFlagT = mv.type === 'saw' ? 0.8 : 0.3; a.dir = -a.dir;
    doMove(a, mv);
    return;
  }
  if (a.spT > 0) return;
  const reach = S.reach * a.scale, sp = S.special, range = (sp.range || S.reach) * a.scale;
  if (a === me && sp.type !== 'area') autoAim(a, range);
  a.spT = sp.cd; a.atkAnim = 1; a.atkFlagT = 0.4; a.spFlagT = 0.4;
  const near = a === me || camera.position.distanceTo(a.m.root.position) < 45;
  if (near) sfx.roar(a.sp === 'raptor' ? 1.8 : 1, a === me ? 1 : 0.45);
  let miss = false;
  if (sp.type === 'clamp') {
    const t = nearestInFront(a, reach * 1.15, 1.3);
    if (t) {
      dealDamage(a, t, a.dmg() * sp.mult, { s: sp.dur });
      a.latch = { id: t.id, kind: 'clamp', t: sp.dur, tick: sp.tick, acc: sp.tick * 0.6, mult: sp.tickMult, dmg: 0 };
    } else miss = true;
  } else if (sp.type === 'bolt') {
    const t = nearestInFront(a, range, 0.5);
    if (t) {
      dealDamage(a, t, a.dmg() * sp.mult, sp.fx);
      let n2 = null, nd = 8 * a.scale;
      for (const e of ents.values()) { if (e === a || e === t || e.dead) continue; const dd = Math.hypot(e.x - t.x, e.z - t.z); if (dd < nd) { nd = dd; n2 = e; } }
      if (n2) dealDamage(a, n2, a.dmg() * sp.mult * 0.5, sp.fx);
    } else miss = true;
  } else if (sp.type === 'area') {
    for (const e of nearEnemies(a, sp.radius * a.scale)) dealDamage(a, e, a.dmg() * sp.mult, sp.fx);
  } else if (sp.type === 'dash' || sp.type === 'leap') {
    a.dashT = sp.dur; a.dashHit = new Set();
  }
  if (miss) a.spT = Math.min(a.spT, 2);
  if (near) specialFx(a);
}

// Ультимейт: у каждого робота свой, долгая перезарядка
function ultimate(a) {
  if (!a || a.dead || a.stunT > 0 || a.latch || a.ultCd > 0) return;
  const U = a.S.ult;
  a.ultCd = U.cd; a.ultFlagT = 0.5; a.atkAnim = 1;
  if (a === me || camera.position.distanceTo(a.m.root.position) < 45) sfx.roar(0.7, a === me ? 1 : 0.5);
  if (U.type === 'buff') a.ultT = U.dur;
  else if (U.type === 'barrage') volley(a, { count: U.count, range: U.range, cone: Math.PI, dmg: U.dmg, targets: 3, color: '#ffb03a' });
  else if (U.type === 'storm') { a.stormT = U.dur; a.stormTick = 0.1; a.stormLeft = U.strikes; }
  else if (U.type === 'stomp') for (const e of nearEnemies(a, U.radius * a.scale)) dealDamage(a, e, a.dmg() * U.dmg, U.fx);
  else if (U.type === 'fortress') a.shieldT = U.dur;
  ultFx(a, false);
  if (a === me) toast(`${U.name}!`);
}

const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, +v || 0));
function applyDamage(t, dmg, byId, byName, f) {
  if (t.dead || NOW() < t.protUntil) return;
  f = f || {};
  const att = ents.get(byId);
  if (t.sp === 'raptor' && !f.th && Math.random() < 0.22) { // Реактивное уклонение
    dmgNum(t.x, t.y + t.S.h * t.scale + 0.5, t.z, 'УКЛОН', t === me);
    sparks(t.x, t.y + 1, t.z, 0.5, 4, 0.4); return;
  }
  if (t.sp === 'trike' && att && Math.abs(angDiff(t.rot, Math.atan2(att.x - t.x, att.z - t.z))) < 0.9) dmg *= 0.6; // фронтальная броня
  if (t.shieldT > 0) dmg *= 0.45; // Крепость
  dmg = Math.round(dmg);
  t.hp -= dmg; t.combatT = 6; t.flash();
  if (t.latch && t.latch.kind === 'cling') { t.latch.dmg += dmg; if (t.latch.dmg > t.maxHp() * 0.18) { t.latch = null; t.spT = Math.max(t.spT, 2); if (t === me) toast('Сбросили с брони!'); } } // сбили наездника
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
  if (t === me) { shake = 0.35; sfx.hurt(); flashVignette(); dmgNum(me.x, me.y + me.S.h * me.scale + 0.5, me.z, dmg, false); }
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
  sparks(msg.x, y, msg.z, 1.2 + msg.s, 14);
  ring(msg.x, y - 0.6, msg.z, 5 + msg.s * 3, '#ffb03a');
  if (camera.position.distanceTo(_kp.set(msg.x, y, msg.z)) < 60) sfx.boom();
  feed(`⚙️ ${msg.bn} уничтожил ${msg.n}`);
  const k = ents.get(msg.b);
  if (k && k.local && !k.dead) {
    k.kills++;
    if (mode === 'grow') k.setGrowth(k.g + 0.1 + 0.1 * Math.min(1, msg.s));
    k.hp = Math.min(k.maxHp(), k.hp + k.maxHp() * 0.35);
    if (k === me) { lifeStats.kills++; toast('Уничтожен! Собери металлолом 🔩'); }
  }
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
      if (hp < e.hpFrac - 0.005) e.flash();
      e.tx = x; e.tz = z; e.trot = rot; e.g = Math.max(0, Math.min(1, +g || 0)); e.hpFrac = hp; e.kills = kills | 0;
      e.moving = (flags & 1) !== 0; e.sprint = (flags & 4) !== 0;
      const af = flags & 2;
      const sf = flags & 16, uf = flags & 1024;
      if (af && !e.lastAtkFlag && !sf) {
        const mv = e.S.moves[(flags >> 7) & 3] || e.S.moves[0];
        e.curMove = mv; e.atkAnim = 1; e.dir = -e.dir;
        if (mv.spin) { e.spinVis = e.spinDur = mv.spin; e.spinTurns = mv.turns || 2; }
        if (mv.type === 'volley') volley(e, mv, true);
      } else if (af && !e.lastAtkFlag) e.atkAnim = 1;
      if (sf && !e.lastSpFlag) specialFx(e);
      if (uf && !e.lastUltFlag) { e.atkAnim = 1; ultFx(e, true); }
      e.lastAtkFlag = af; e.lastSpFlag = sf; e.lastUltFlag = uf;
      e.ultT = (flags & 512) ? 0.5 : 0;
      e.shieldT = (flags & 32) ? 0.5 : 0; e.clung = (flags & 64) !== 0;
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
    const flags = (d.moving ? 1 : 0) | (d.atkFlagT > 0 ? 2 : 0) | (d.sprint ? 4 : 0) | (d.bot ? 8 : 0) | (d.spFlagT > 0 ? 16 : 0) | (d.shieldT > 0 ? 32 : 0) | (d.latch && d.latch.kind === 'cling' ? 64 : 0) | ((d.lastStep & 3) << 7) | (d.ultT > 0 ? 512 : 0) | (d.ultFlagT > 0 ? 1024 : 0);
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

function spawnBot() {
  const sp = SP_KEYS[Math.floor(Math.random() * SP_KEYS.length)];
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
function moveMech(d, mx, mz, run, dt) {
  if (d.stunT > 0) { mx = 0; mz = 0; run = false; d.dashT = 0; }
  if (d.latch) {
    const L = d.latch, t = ents.get(L.id);
    if (!t || t.dead || d.stunT > 0 || L.t <= 0) d.latch = null;
    else if (L.kind === 'cling') { // Раптор сидит на спине врага
      d.x = t.x - Math.sin(t.rot) * 0.4; d.z = t.z - Math.cos(t.rot) * 0.4; d.rot = t.rot; d.moving = false; d.sprint = false; return;
    } else if (Math.hypot(t.x - d.x, t.z - d.z) > d.radius() + t.radius() + d.S.reach * d.scale * 1.6) d.latch = null;
    else { // Рекс держит и не двигается
      d.moving = false; d.sprint = false;
      d.rot += Math.max(-d.S.turn * dt, Math.min(d.S.turn * dt, angDiff(d.rot, Math.atan2(t.x - d.x, t.z - d.z)))); return;
    }
  }
  const mag = Math.min(1, Math.hypot(mx, mz));
  d.moving = mag > 0.08 || d.dashT > 0;
  d.sprint = run && d.moving && d.st > 2;
  if (d.sprint) d.st = Math.max(0, d.st - 22 * dt); else d.st = Math.min(100, d.st + 14 * dt);
  if (d.dashT > 0) {
    d.dashT -= dt;
    const sp = d.S.special.speed * Math.max(0.6, d.scale);
    d.x += Math.sin(d.rot) * sp * dt; d.z += Math.cos(d.rot) * sp * dt;
    if (Math.random() < 0.6) sparks(d.x - Math.sin(d.rot) * d.radius(), d.y + d.S.h * 0.4 * d.scale, d.z - Math.cos(d.rot) * d.radius(), d.scale * 0.8, 1, 0.3);
    for (const e of ents.values()) {
      if (e === d || e.dead || d.dashHit.has(e.id)) continue;
      if (Math.hypot(e.x - d.x, e.z - d.z) < d.radius() + e.radius() + 0.8 * d.scale) {
        const sp = d.S.special;
        if (sp.type === 'leap') { // Раптор: вцепляется в первого, кого достал
          dealDamage(d, e, d.dmg() * sp.mult, sp.fx);
          d.latch = { id: e.id, kind: 'cling', t: sp.latch, tick: sp.tick, acc: 0.25, mult: sp.tickMult, fx: sp.fx, dmg: 0 };
          d.dashT = 0; d.hopT = 0; break;
        }
        d.dashHit.add(e.id); dealDamage(d, e, d.dmg() * sp.mult, sp.fx);
      }
    }
    if (d.dashT <= 0 && d.sp === 'raptor') d.atkT = 0; // после прыжка удар готов сразу
  } else {
    let tsp = 0;
    if (d.moving) {
      const want = Math.atan2(mx, mz), turn = d.S.turn * dt, df = angDiff(d.rot, want);
      d.rot += Math.max(-turn, Math.min(turn, df));
      tsp = d.speed(d.sprint) * mag * (Math.abs(df) > 1.6 ? 0.4 : 1) * (d.sawT > 0 ? 0.6 : 1);
    }
    d.vsp += (tsp - d.vsp) * Math.min(1, d.S.accel * dt); // тяжёлые разгоняются и тормозят медленнее
    if (d.vsp < 0.05) d.vsp = 0;
    if (d.vsp > 0) { d.x += Math.sin(d.rot) * d.vsp * dt; d.z += Math.cos(d.rot) * d.vsp * dt; }
    if (d.vsp > 0.8) d.moving = true;
  }
  if (d.kvx || d.kvz) { // отбрасывание
    d.x += d.kvx * dt; d.z += d.kvz * dt;
    const k = Math.exp(-6 * dt); d.kvx *= k; d.kvz *= k;
    if (Math.abs(d.kvx) + Math.abs(d.kvz) < 0.1) d.kvx = d.kvz = 0;
  }
  for (const e of ents.values()) {
    if (e === d || e.dead || isClung(e)) continue; // наездник на спине не должен выталкивать хозяина (иначе тот «улетает»)
    const dx = d.x - e.x, dz = d.z - e.z, dist = Math.hypot(dx, dz), m = (d.radius() + e.radius()) * 0.75;
    if (dist < m && dist > 0.001) { const k = (m - dist) / dist * (e.local ? 0.5 : 1); d.x += dx * k; d.z += dz * k; }
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
  if (b.wasLatch && !b.latch && ai === 'skirmisher') { b.phase = 'retreat'; b.phaseT = 1.0; b.orbit = Math.random() < 0.5 ? 1 : -1; } // спрыгнул — отскок
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
  if (t) {
    const dx = t.x - b.x, dz = t.z - b.z, d = Math.hypot(dx, dz) || 1, ang = Math.atan2(dx, dz);
    const reach = b.S.reach * b.scale + t.radius();
    const off = Math.abs(angDiff(b.rot, ang));
    const step = b.chainT > 0 ? b.step : 0, lim = b.S.turn * dt;
    const face = () => { b.rot += Math.max(-lim, Math.min(lim, angDiff(b.rot, ang))); };
    const fwd = (k = 1) => { mx = dx / d * k; mz = dz / d * k; };
    const back = () => { mx = -dx / d; mz = -dz / d; };
    const side = k => { mx = -dz / d * b.orbit * k; mz = dx / d * b.orbit * k; };
    if (b.flee) { back(); run = b.st > 20; }
    else if (ai === 'brawler') { // Рекс: давит напролом
      if (d > reach * 0.85) { fwd(); run = d > 12 && b.st > 30; }
      else { face(); if (off < 0.5) { if (b.spT <= 0 && Math.random() < 0.08) attack(b, true); else attack(b, false); } }
    } else if (ai === 'skirmisher') { // Раптор: 3 удара — отскок по кругу, прыжок для сближения
      if (b.phase === 'retreat') {
        b.phaseT -= dt; back(); const bx = mx, bz = mz; side(1); mx = mx * 0.8 + bx * 0.6; mz = mz * 0.8 + bz * 0.6; run = b.st > 15;
        if (b.phaseT <= 0) { b.phase = 'strike'; b.hits = 0; }
      } else if (d > reach * 0.85) {
        fwd(); run = b.st > 20;
        if (b.spT <= 0 && d < 12 && d > 4.5 && off < 0.2) attack(b, true); // прыжок-захват
      } else {
        face();
        if (off < 0.6 && b.atkT <= 0) { attack(b, false); if (++b.hits >= 3) { b.phase = 'retreat'; b.phaseT = 1.0 + Math.random() * 0.6; b.orbit = Math.random() < 0.5 ? 1 : -1; } }
      }
    } else if (ai === 'circler') { // Спино: кружит вокруг врага и пилит хвостом, издали бьёт молнией
      b.orbitT -= dt; if (b.orbitT <= 0) { b.orbit = -b.orbit; b.orbitT = 2.5 + Math.random() * 1.5; }
      const R = b.S.reach * b.scale * 0.9;
      if (d > R * 1.1) { fwd(); run = d > 14 && b.st > 30; if (b.spT <= 0 && d > 6 && d < b.S.special.range * 0.9 * b.scale) { face(); if (off < 0.35) attack(b, true); } }
      else if (step === 1) { mx = 0; mz = 0; face(); if (off < 0.6) attack(b, false); } // укус: надо смотреть на врага
      else { if (d < R * 0.5) { const bx = -dx / d, bz = -dz / d; side(0.8); mx = mx + bx * 0.4; mz = mz + bz * 0.4; } else side(0.9); attack(b, false); }
    } else if (ai === 'rammer') { // Трицера: разгоняется и таранит
      if (d > reach * 0.85) { fwd(); run = d > 10 && b.st > 30; if (b.spT <= 0 && d > 6 && d < 20 && off < 0.25) attack(b, true); }
      else { face(); if (off < 0.6) attack(b, false); }
    } else { // bastion — Стего: стоит на месте, разворачивается к врагу задом и бьёт хвостом, потом лицом — залп шипов
      const hd = Math.hypot(b.home.x - b.x, b.home.z - b.z);
      const hitD = b.S.reach * b.scale + t.radius();
      if (hd > 20) { mx = (b.home.x - b.x) / hd; mz = (b.home.z - b.z) / hd; }
      else if (d < hitD * 1.5 || (step === 2 && d < 9)) {
        const rear = step < 2, want = rear ? ang + Math.PI : ang;
        b.rot += Math.max(-lim, Math.min(lim, angDiff(b.rot, want)));
        if (Math.abs(angDiff(rear ? b.rot + Math.PI : b.rot, ang)) < (rear ? 0.8 : 0.45) && d < (rear ? hitD : 9)) attack(b, false);
      } else if (d < 14) face();
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
let menuAngle = 0, viewT = 0, preview = null, previewKey = '';
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
  previewKey = key;
  ring(preview.x, preview.y, preview.z, 5, preview.S.glow);
}
function updateCamera(dt, time) {
  if (me) {
    const s = me.scale * me.S.cam;
    const dist = 3.8 + 10.5 * s, h = 1.0 + 3.2 * s;
    camTarget.set(me.x, me.y + h, me.z);
    const cp = Math.cos(camPitch);
    const cx = me.x - Math.sin(camYaw) * dist * cp, cz = me.z - Math.cos(camYaw) * dist * cp;
    const cy = Math.max(camTarget.y + Math.sin(camPitch) * dist, height(cx, cz) + 1.2, WATER_Y + 1);
    camera.position.lerp(camWant.set(cx, cy, cz), Math.min(1, dt * 10));
    if (shake > 0) { shake -= dt; camera.position.x += (Math.random() - 0.5) * shake * 2; camera.position.y += (Math.random() - 0.5) * shake * 2; }
    camera.lookAt(camTarget);
    viewT -= dt; if (viewT <= 0) { viewT = 0.12; world.clearView(camera.position, me.x, me.z); }
    if (preview) { preview.dispose(); preview = null; previewKey = ''; }
  } else if (preview) {
    // меню: камера облетает выбранного меха, а сам мех стоит в свободной части экрана
    menuAngle += dt * 0.22;
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
  const mv = me.S.moves[me.chainT > 0 ? me.step : 0];
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
    <div class="tr"><b>⚔️ Серия:</b> ${S.moves.map(m => m.name).join(' → ')}</div>
    <div class="tr"><b style="color:${S.glow}">✨ ${S.special.name}:</b> ${S.special.info}</div>
    <div class="tr"><b style="color:${S.glow}">🌀 ${S.ult.name}:</b> ${S.ult.info}</div>
    <div class="tr"><b>🛡 ${S.passive.name}:</b> ${S.passive.info}</div>
    <div class="tr"><b>🧠 Стиль:</b> ${S.aiInfo}</div>`;
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
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const time = now / 1000;

  if (playing && me && !me.dead) { updatePlayer(dt); tickCommon(me, dt); }
  if (mode) manageBots(dt);
  for (const e of ents.values()) {
    if (e.local && e.bot && !e.dead) { botAI(e, dt); tickCommon(e, dt); }
    if (!e.local) {
      if (now - e.lastSeen > 5000) { ents.delete(e.id); e.dispose(); continue; }
      const k = Math.min(1, dt * 10);
      if (Math.hypot(e.tx - e.x, e.tz - e.z) > 25) { e.x = e.tx; e.z = e.tz; }
      e.x += (e.tx - e.x) * k; e.z += (e.tz - e.z) * k; e.rot += angDiff(e.rot, e.trot) * k;
    }
    e.visual(dt, time);
  }
  world.update(dt, time);
  updateFx(dt);
  updateCamera(dt, time);
  updateNums(dt);

  sendTimer -= dt; if (sendTimer <= 0) { sendTimer = 0.1; sendState(); }
  hudTimer -= dt; if (hudTimer <= 0) { hudTimer = 0.2; updateHud(); }
  mapTimer -= dt; if (mapTimer <= 0 && playing) { mapTimer = 0.25; drawMinimap(); }

  renderer.render(scene, camera);

  // Автонастройка качества: если тормозит — снижаем разрешение
  fpsAcc += dt; fpsFrames++;
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
window.__game = { ents, get me() { return me; }, attack };
