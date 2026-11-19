import * as THREE from 'three';
import { SPECIES, SP_KEYS, STAGES, buildDino, growthScale, statMul, stageIndex } from './species.js';
import { World, height, inWater, MAP_R } from './world.js';
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
const sun = new THREE.DirectionalLight(0xfff1d6, 2.2); sun.position.set(60, 100, 40); scene.add(sun);
const world = new World(scene);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
});

// ================= Состояние =================
const clientId = Math.random().toString(36).slice(2, 10);
const ents = new Map();          // id -> Dino
const peers = new Map();         // peerId -> { c: clientId, t: время }
let me = null, net = null, mode = null, netStatus = 'off', netStart = 0;
let life = 0, botN = 0, botTimer = 0, sendTimer = 0, hudTimer = 0;
let camYaw = 0, camPitch = 0.34, shake = 0, playing = false;
const NOW = () => performance.now();
const BOT_NAMES = ['Клык', 'Шрам', 'Гроза', 'Тень', 'Коготь', 'Буря', 'Титан', 'Злыдень', 'Ржавый', 'Молния', 'Зубастик', 'Гром', 'Хищник', 'Рогач', 'Кочевник'];

const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

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
  c.lineWidth = 5; c.strokeStyle = 'rgba(0,0,0,.7)'; c.fillStyle = isBot ? '#ffe7b0' : '#ffffff';
  const t = name + (stage === 4 ? ' ★' : '');
  c.strokeText(t, 128, 26); c.fillText(t, 128, 26);
  c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(48, 38, 160, 12);
  c.fillStyle = frac > 0.5 ? '#5fd35f' : frac > 0.25 ? '#f2c230' : '#e8453c';
  c.fillRect(50, 40, 156 * Math.max(0, frac), 8);
  L.tex.needsUpdate = true;
}

// ================= Динозавр =================
class Dino {
  constructor(id, sp, name, o = {}) {
    this.id = id; this.sp = sp; this.S = SPECIES[sp]; this.name = name;
    this.local = !!o.local; this.bot = !!o.bot; this.g = o.g ?? 0; this.kills = 0;
    this.m = buildDino(sp); scene.add(this.m.root);
    this.x = o.x || 0; this.z = o.z || 0; this.y = height(this.x, this.z); this.rot = o.rot || 0;
    this.tx = this.x; this.tz = this.z; this.trot = this.rot;
    this.hp = this.maxHp(); this.hpFrac = 1; this.st = 100;
    this.atkT = 0; this.spT = 0; this.dashT = 0; this.dashHit = null; this.atkAnim = 0; this.atkFlagT = 0;
    this.combatT = 0; this.protUntil = o.local && !o.bot ? NOW() + 3000 : 0; this.eatT = 0;
    this.moving = false; this.sprint = false; this.walk = 0; this.amp = 0; this.seed = Math.random() * 10;
    this.lastSeen = NOW(); this.peer = null; this.lastAtkFlag = 0;
    this.label = (this === me || o.self) ? null : makeLabel();
    // ИИ бота
    this.think = 0; this.wx = this.x; this.wz = this.z; this.target = null; this.flee = false; this.aggro = null;
  }
  get scale() { return growthScale(this.g); }
  maxHp() { return this.S.hp * statMul(this.g); }
  dmg() { return this.S.dmg * statMul(this.g) * (this.bot ? 0.8 : 1); }
  radius() { return this.S.r * this.scale; }
  frac() { return this.local ? this.hp / this.maxHp() : this.hpFrac; }
  speed(run) { return (run ? this.S.run : this.S.spd) * (0.8 + 0.3 * Math.min(this.g, 1)) * (inWater(this.x, this.z) ? 0.6 : 1); }
  setGrowth(g) {
    const f = this.hp / this.maxHp();
    this.g = Math.min(1, g);
    this.hp = f * this.maxHp();
  }
  visual(dt, time) {
    const m = this.m, s = this.scale;
    this.y = height(this.x, this.z);
    m.root.position.set(this.x, this.y, this.z);
    m.root.rotation.y = this.rot;
    m.root.scale.setScalar(s);
    const target = this.moving ? (this.sprint ? 0.75 : 0.5) : 0;
    this.amp += (target - this.amp) * Math.min(1, dt * 8);
    this.walk += dt * (this.sprint ? 13 : 8.5) / Math.sqrt(s * this.S.cam + 0.2) * (this.moving ? 1 : 0.2);
    for (const L of m.legs) L.pivot.rotation.x = Math.sin(this.walk + L.ph) * this.amp;
    m.tail.rotation.y = Math.sin(time * 1.7 + this.seed) * 0.12 + Math.sin(this.walk * 0.5) * 0.25 * this.amp;
    m.body.position.y = Math.abs(Math.sin(this.walk)) * 0.12 * this.amp;
    if (this.atkAnim > 0) {
      this.atkAnim = Math.max(0, this.atkAnim - dt * 3);
      const k = Math.sin((1 - this.atkAnim) * Math.PI);
      m.head.rotation.x = k * 0.5; m.head.position.z = m.headZ + k * 0.6;
    } else {
      m.head.rotation.x = Math.sin(time * 0.9 + this.seed) * 0.05; m.head.position.z = m.headZ;
    }
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

// ================= Эффекты попаданий =================
const fxGeo = new THREE.BoxGeometry(0.35, 0.35, 0.35);
const fxMat = new THREE.MeshBasicMaterial({ color: 0xd8262f });
const fx = [];
for (let i = 0; i < 40; i++) { const m = new THREE.Mesh(fxGeo, fxMat); m.visible = false; scene.add(m); fx.push({ m, life: 0, vx: 0, vy: 0, vz: 0 }); }
let fxI = 0;
function hitFx(x, y, z, s = 1) {
  for (let i = 0; i < 7; i++) {
    const p = fx[fxI++ % fx.length];
    p.life = 0.6; p.m.visible = true; p.m.position.set(x, y, z); p.m.scale.setScalar(s);
    p.vx = (Math.random() - 0.5) * 8; p.vy = 3 + Math.random() * 6; p.vz = (Math.random() - 0.5) * 8;
  }
}
function updateFx(dt) {
  for (const p of fx) {
    if (p.life <= 0) continue;
    p.life -= dt; p.vy -= 20 * dt;
    p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
    if (p.life <= 0) p.m.visible = false;
  }
}

// ================= Бой =================
function nearestInFront(a, reach, cone = 1.1) {
  let best = null, bd = 1e9;
  for (const e of ents.values()) {
    if (e === a || e.dead) continue;
    const dx = e.x - a.x, dz = e.z - a.z, d = Math.hypot(dx, dz) - e.radius();
    if (d > reach) continue;
    const ang = Math.abs(angDiff(a.rot, Math.atan2(dx, dz)));
    if (ang > cone && d > a.radius() * 0.3) continue;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function dealDamage(a, t, amount) {
  if (!t || t.dead) return;
  amount = Math.round(amount);
  hitFx(t.x, t.y + t.S.h * 0.5 * t.scale, t.z, Math.max(0.6, t.scale));
  a.combatT = 6;
  if (t.local) applyDamage(t, amount, a.id, a.name);
  else if (net && t.peer) net.hit(t.peer, { t: t.id, d: amount, b: a.id, n: a.name });
  if (a === me) sfx.bite(1);
}

function attack(a, special) {
  if (a.dead) return;
  const S = a.S, reach = S.reach * a.scale;
  if (!special) {
    if (a.atkT > 0) return;
    a.atkT = S.cd; a.atkAnim = 1; a.atkFlagT = 0.3;
    const t = nearestInFront(a, reach);
    if (t) dealDamage(a, t, a.dmg());
    else if (a === me) sfx.bite(0.35);
    return;
  }
  if (a.spT > 0) return;
  const sp = S.special;
  a.spT = sp.cd; a.atkAnim = 1; a.atkFlagT = 0.4;
  if (a === me || camera.position.distanceTo(a.m.root.position) < 40) sfx.roar(a.sp === 'raptor' ? 1.8 : 1, a === me ? 1 : 0.5);
  if (sp.type === 'heavy') {
    const t = nearestInFront(a, reach * 1.15, 1.3);
    if (t) dealDamage(a, t, a.dmg() * sp.mult);
  } else if (sp.type === 'area') {
    const R = sp.radius * a.scale;
    for (const e of ents.values()) {
      if (e === a || e.dead) continue;
      if (Math.hypot(e.x - a.x, e.z - a.z) - e.radius() < R) dealDamage(a, e, a.dmg() * sp.mult);
    }
    hitFx(a.x, a.y + 0.5, a.z, a.scale * 1.5);
  } else if (sp.type === 'dash') {
    a.dashT = sp.dur; a.dashHit = new Set();
  }
}

function applyDamage(t, dmg, byId, byName) {
  if (t.dead || NOW() < t.protUntil) return;
  t.hp -= dmg; t.combatT = 6;
  if (t === me) { shake = 0.35; sfx.hurt(); flashVignette(); }
  if (t.bot) t.aggro = byId;
  if (t.hp <= 0) killEnt(t, byId, byName);
}

function killEnt(t, byId, byName) {
  t.dead = true;
  const msg = { id: t.id, b: byId, x: r1(t.x), z: r1(t.z), s: r2(t.scale), n: t.name, bn: byName || '?' };
  net && net.kill(msg);
  onKill(msg);
}

function onKill(msg) {
  const e = ents.get(msg.id);
  world.spawnCarcass(msg.x, msg.z, msg.s);
  feed(`${msg.bn} победил ${msg.n}`);
  const k = ents.get(msg.b);
  if (k && k.local && !k.dead) {
    k.kills++;
    if (mode === 'grow') k.setGrowth(k.g + 0.1 + 0.1 * Math.min(1, msg.s));
    k.hp = Math.min(k.maxHp(), k.hp + k.maxHp() * 0.35);
    if (k === me) toast(`+1 победа! Съешь тушу 🍖`);
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
      const [id, spI, name, x, z, rot, g, hp, flags, kills] = a;
      const sp = SP_KEYS[spI]; if (!sp || typeof id !== 'string') continue;
      seen.add(id);
      let e = ents.get(id);
      if (e && e.local) continue;
      if (!e) {
        e = new Dino(id, sp, String(name).slice(0, 16), { x, z, rot, g });
        e.bot = (flags & 8) !== 0;
        ents.set(id, e);
      }
      e.peer = peerId; e.lastSeen = NOW();
      e.tx = x; e.tz = z; e.trot = rot; e.g = g; e.hpFrac = hp; e.kills = kills | 0;
      e.moving = (flags & 1) !== 0; e.sprint = (flags & 4) !== 0;
      const af = flags & 2;
      if (af && !e.lastAtkFlag) e.atkAnim = 1;
      e.lastAtkFlag = af;
    }
    for (const e of ents.values()) if (!e.local && e.peer === peerId && !seen.has(e.id)) { ents.delete(e.id); e.dispose(); }
  },
  onHit(d) {
    const t = ents.get(d && d.t);
    if (t && t.local) {
      const dmg = Math.max(0, Math.min(5000, +d.d || 0));
      applyDamage(t, dmg, String(d.b), String(d.n || '?').slice(0, 16));
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
    const flags = (d.moving ? 1 : 0) | (d.atkFlagT > 0 ? 2 : 0) | (d.sprint ? 4 : 0) | (d.bot ? 8 : 0);
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
  me = new Dino(`${clientId}-${life}`, sp, name, { local: true, self: true, x, z, rot: Math.random() * 6, g: mode === 'prime' ? 1 : 0 });
  ents.set(me.id, me);
  camYaw = me.rot; playing = true;
}

function spawnBot() {
  const sp = SP_KEYS[Math.floor(Math.random() * SP_KEYS.length)];
  const [x, z] = spawnPoint();
  const g = mode === 'prime' ? 1 : 0.15 + Math.random() * 0.75;
  const used = new Set([...ents.values()].map(e => e.name));
  const free = BOT_NAMES.filter(n => !used.has(n + ' (бот)'));
  const name = (free.length ? free : BOT_NAMES)[Math.floor(Math.random() * (free.length || BOT_NAMES.length))] + ' (бот)';
  const b = new Dino(`${clientId}-b${++botN}`, sp, name, { local: true, bot: true, x, z, rot: Math.random() * 6, g });
  ents.set(b.id, b);
}

// ================= Движение (общий для игрока и ботов) =================
function moveDino(d, mx, mz, run, dt) {
  const mag = Math.min(1, Math.hypot(mx, mz));
  d.moving = mag > 0.08 || d.dashT > 0;
  d.sprint = run && d.moving && d.st > 2;
  if (d.sprint) d.st = Math.max(0, d.st - 22 * dt); else d.st = Math.min(100, d.st + 14 * dt);
  if (d.dashT > 0) {
    d.dashT -= dt;
    const sp = d.S.special.speed * Math.max(0.6, d.scale);
    d.x += Math.sin(d.rot) * sp * dt; d.z += Math.cos(d.rot) * sp * dt;
    for (const e of ents.values()) {
      if (e === d || e.dead || d.dashHit.has(e.id)) continue;
      if (Math.hypot(e.x - d.x, e.z - d.z) < d.radius() + e.radius() + 0.8 * d.scale) { d.dashHit.add(e.id); dealDamage(d, e, d.dmg() * d.S.special.mult); }
    }
  } else if (d.moving) {
    const want = Math.atan2(mx, mz);
    const turn = (d.sp === 'raptor' ? 12 : 7) * dt;
    const df = angDiff(d.rot, want);
    d.rot += Math.max(-turn, Math.min(turn, df));
    const sp = d.speed(d.sprint) * mag * (Math.abs(df) > 1.6 ? 0.4 : 1);
    d.x += Math.sin(d.rot) * sp * dt; d.z += Math.cos(d.rot) * sp * dt;
  }
  // столкновения с другими динозаврами
  for (const e of ents.values()) {
    if (e === d || e.dead) continue;
    const dx = d.x - e.x, dz = d.z - e.z, dist = Math.hypot(dx, dz), m = (d.radius() + e.radius()) * 0.75;
    if (dist < m && dist > 0.001) { const k = (m - dist) / dist * (e.local ? 0.5 : 1); d.x += dx * k; d.z += dz * k; }
  }
  world.collide(d, d.radius());
  const r = Math.hypot(d.x, d.z);
  if (r > MAP_R - 8) { d.x *= (MAP_R - 8) / r; d.z *= (MAP_R - 8) / r; }
}

function tickCommon(d, dt) {
  d.atkT -= dt; d.spT -= dt; d.atkFlagT -= dt; d.combatT -= dt;
  if (mode === 'grow' && d.g < 1) {
    const before = stageIndex(d.g);
    d.setGrowth(d.g + 0.009 * dt);
    if (d === me && stageIndex(d.g) > before) { toast(`Ты вырос: ${STAGES[stageIndex(d.g)]}!`); sfx.levelUp(); }
  }
  if (d.combatT <= 0) d.hp = Math.min(d.maxHp(), d.hp + d.maxHp() * 0.025 * dt);
  // еда
  d.eatT -= dt;
  if (d.eatT <= 0 && (d.hp < d.maxHp() * 0.999 || (mode === 'grow' && d.g < 1))) {
    d.eatT = 0.6;
    const food = world.tryEat(d.S.diet, d.x, d.z, d.radius() + 0.8);
    if (food) {
      const before = stageIndex(d.g);
      if (mode === 'grow') d.setGrowth(d.g + (food === 'meat' ? 0.06 : 0.045));
      d.hp = Math.min(d.maxHp(), d.hp + d.maxHp() * 0.2);
      if (d === me) {
        sfx.eat();
        if (stageIndex(d.g) > before) { toast(`Ты вырос: ${STAGES[stageIndex(d.g)]}!`); sfx.levelUp(); }
      }
    }
  }
}

// ================= ИИ ботов =================
function botAI(b, dt) {
  b.think -= dt;
  if (b.think <= 0) {
    b.think = 0.35 + Math.random() * 0.3;
    let tgt = null;
    if (b.aggro) { const a = ents.get(b.aggro); if (a && !a.dead && Math.hypot(a.x - b.x, a.z - b.z) < 50) tgt = a; else b.aggro = null; }
    // не больше двух ботов на одну цель, чтобы не было толпы на одного
    const hunters = new Map();
    for (const o of ents.values()) if (o.bot && o !== b && o.target && !o.flee) hunters.set(o.target.id, (hunters.get(o.target.id) || 0) + 1);
    let nearest = null, nd = 1e9;
    for (const e of ents.values()) {
      if (e === b || e.dead) continue;
      if ((hunters.get(e.id) || 0) >= 2) continue;
      if (e.bot && Math.random() < 0.35) continue;
      const d = Math.hypot(e.x - b.x, e.z - b.z);
      if (d < nd) { nd = d; nearest = e; }
    }
    b.flee = false;
    if (!tgt && nearest) {
      if (b.S.diet === 'carn' && nd < 28) tgt = nearest;
      else if (b.S.diet === 'herb' && nearest.S.diet === 'carn' && nd < 14) {
        if (b.g < nearest.g * 0.8) { tgt = nearest; b.flee = true; } else if (nd < 8) tgt = nearest;
      }
    }
    if (tgt && b.hp < b.maxHp() * 0.22 && Math.random() < 0.7) b.flee = true;
    b.target = tgt;
    if (!tgt && Math.hypot(b.wx - b.x, b.wz - b.z) < 6) [b.wx, b.wz] = world.randLand();
  }
  let mx = 0, mz = 0, run = false;
  const t = b.target && !b.target.dead && ents.has(b.target.id) ? b.target : null;
  if (t) {
    const dx = t.x - b.x, dz = t.z - b.z, d = Math.hypot(dx, dz);
    if (b.flee) { mx = -dx / d; mz = -dz / d; run = b.st > 20; }
    else {
      const reach = b.S.reach * b.scale + t.radius();
      if (d > reach * 0.85) { mx = dx / d; mz = dz / d; run = d > 12 && b.st > 30; }
      else {
        const df = angDiff(b.rot, Math.atan2(dx, dz)); b.rot += Math.max(-6 * dt, Math.min(6 * dt, df));
        if (Math.abs(df) < 0.6) {
          if (b.spT <= 0 && Math.random() < 0.02) attack(b, true); else attack(b, false);
        }
      }
      if (b.S.special.type === 'dash' && b.spT <= 0 && d < 14 && d > reach && Math.abs(angDiff(b.rot, Math.atan2(dx, dz))) < 0.2) attack(b, true);
    }
  } else {
    const dx = b.wx - b.x, dz = b.wz - b.z, d = Math.hypot(dx, dz) || 1;
    mx = dx / d * 0.55; mz = dz / d * 0.55;
  }
  moveDino(b, mx, mz, run, dt);
}

function manageBots(dt) {
  const host = netStatus === 'offline' || (netStatus === 'online' && NOW() - netStart > 3000 && isHost());
  const mine = [...ents.values()].filter(e => e.bot && e.local);
  if (!host) { for (const b of mine) { ents.delete(b.id); b.dispose(); } return; }
  const players = 1 + activePeers();
  const want = Math.max(3, Math.min(8, 10 - players));
  botTimer -= dt;
  if (mine.length < want && botTimer <= 0) { spawnBot(); botTimer = 1.5; }
  else if (mine.length > want + 1) { const b = mine[0]; ents.delete(b.id); b.dispose(); }
}

// ================= Ввод =================
const keys = {};
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (!playing) return;
  if (e.code === 'Space' || e.code === 'KeyJ') { attack(me, false); e.preventDefault(); }
  if (e.code === 'KeyE' || e.code === 'KeyK') attack(me, true);
});
addEventListener('keyup', e => { keys[e.code] = false; });

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
    camYaw -= dx * 0.006; camPitch = Math.max(0.08, Math.min(1.1, camPitch + dy * 0.004));
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

function bindBtn(id, fn) {
  $(id).addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); initAudio(); if (playing) fn(); });
}
bindBtn('b-atk', () => attack(me, false));
bindBtn('b-sp', () => attack(me, true));
bindBtn('b-run', () => { runToggle = !runToggle; $('b-run').classList.toggle('on', runToggle); });

function updatePlayer(dt) {
  let ix = 0, iy = 0;
  if (keys.KeyW || keys.ArrowUp) iy += 1; if (keys.KeyS || keys.ArrowDown) iy -= 1;
  if (keys.KeyA || keys.ArrowLeft) ix -= 1; if (keys.KeyD || keys.ArrowRight) ix += 1;
  if (joy.id !== null) { ix = joy.x; iy = -joy.y; }
  const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
  const mx = fx * iy - fz * ix, mz = fz * iy + fx * ix;
  const run = keys.ShiftLeft || keys.ShiftRight || runToggle;
  moveDino(me, mx, mz, run, dt);
  if (runToggle && me.st <= 1) { runToggle = false; $('b-run').classList.remove('on'); }
}

// ================= Камера =================
const camTarget = new THREE.Vector3();
let menuAngle = 0, viewT = 0;
function updateCamera(dt) {
  if (me) {
    const s = me.scale * me.S.cam;
    const dist = 4.5 + 11 * s, h = 1.2 + 3.2 * s;
    camTarget.set(me.x, me.y + h, me.z);
    const cp = Math.cos(camPitch);
    let cx = me.x - Math.sin(camYaw) * dist * cp, cz = me.z - Math.cos(camYaw) * dist * cp;
    let cy = camTarget.y + Math.sin(camPitch) * dist;
    cy = Math.max(cy, height(cx, cz) + 1.2);
    camera.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(1, dt * 10));
    if (shake > 0) { shake -= dt; camera.position.x += (Math.random() - 0.5) * shake * 2; camera.position.y += (Math.random() - 0.5) * shake * 2; }
    camera.lookAt(camTarget);
    viewT -= dt; if (viewT <= 0) { viewT = 0.12; world.clearView(camera.position, me.x, me.z); }
  } else {
    menuAngle += dt * 0.08;
    camera.position.set(Math.sin(menuAngle) * 70, 32, Math.cos(menuAngle) * 70);
    camera.lookAt(0, 0, 0);
  }
}

// ================= Интерфейс =================
function toast(t) { const el = $('toast'); el.textContent = t; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); }
function feed(t) {
  const el = document.createElement('div'); el.textContent = t; $('feed').prepend(el);
  while ($('feed').children.length > 4) $('feed').lastChild.remove();
  setTimeout(() => el.remove(), 6000);
}
function flashVignette() { const v = $('vignette'); v.classList.remove('hit'); void v.offsetWidth; v.classList.add('hit'); }

function updateHud() {
  const st = netStatus === 'online' ? `🟢 Онлайн: ${1 + activePeers()} игр.` : netStatus === 'connecting' ? '🟡 Подключение…' : '🔴 Оффлайн (только боты)';
  $('online').textContent = st + (mode === 'prime' ? ' · Прайм-арена' : ' · Рост');
  const list = [...ents.values()].filter(e => !e.dead).sort((a, b) => b.kills - a.kills || b.g - a.g).slice(0, 5);
  $('lb').innerHTML = list.map((e, i) => `<div class="${e === me ? 'me' : ''}">${i + 1}. ${esc(e.name)} <span>${STAGES[stageIndex(e.g)]} · 💀${e.kills}</span></div>`).join('');
  if (!me) return;
  const f = Math.max(0, me.hp / me.maxHp());
  $('hp-fill').style.width = f * 100 + '%';
  $('hp-txt').textContent = `${Math.ceil(Math.max(0, me.hp))} / ${Math.round(me.maxHp())}`;
  $('st-fill').style.width = me.st + '%';
  $('gr-fill').style.width = Math.min(1, me.g) * 100 + '%';
  $('stage').textContent = `${me.S.name} · ${STAGES[stageIndex(me.g)]}` + (me.g < 1 ? ` ${Math.floor(me.g * 100)}%` : ' ★');
  $('b-sp').style.setProperty('--cd', Math.max(0, me.spT / me.S.special.cd));
  $('b-atk').style.setProperty('--cd', Math.max(0, me.atkT / me.S.cd));
  $('food-hint').textContent = mode === 'prime' ? (me.S.diet === 'carn' ? '🍖 Мясо лечит' : '🌿 Ягоды лечат')
    : me.S.diet === 'carn' ? '🍖 Ешь мясо и побеждай, чтобы расти' : '🌿 Ешь ягодные кусты, чтобы расти';
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ----- Меню -----
let chosen = localStorage.getItem('dino_sp') || 'rex';
let chosenMode = localStorage.getItem('dino_mode') || 'grow';
$('nick').value = localStorage.getItem('dino_nick') || '';
function renderCards() {
  const max = { hp: 1300, dmg: 150, run: 15 };
  $('cards').innerHTML = SP_KEYS.map(k => {
    const S = SPECIES[k];
    const bar = (v, m) => `<i><b style="width:${Math.round(v / m * 100)}%"></b></i>`;
    return `<button class="card ${k === chosen ? 'sel' : ''}" data-k="${k}">
      <div class="dot" style="background:${S.color}"></div>
      <div class="cn">${S.name}</div>
      <div class="cd">${S.diet === 'carn' ? '🥩 Хищник' : '🌿 Травоядный'}</div>
      <div class="st">❤️ ${bar(S.hp, max.hp)}</div>
      <div class="st">⚔️ ${bar(S.dmg, max.dmg)}</div>
      <div class="st">💨 ${bar(S.run, max.run)}</div>
      <div class="cx">✨ ${S.special.name}</div>
    </button>`;
  }).join('');
  $('desc').textContent = SPECIES[chosen].desc;
  document.querySelectorAll('.card').forEach(b => b.onclick = () => { chosen = b.dataset.k; renderCards(); });
  document.querySelectorAll('.mode').forEach(b => {
    b.classList.toggle('sel', b.dataset.m === chosenMode);
    b.onclick = () => { chosenMode = b.dataset.m; renderCards(); };
  });
}
renderCards();

$('play').onclick = async () => {
  initAudio();
  const name = ($('nick').value.trim() || 'Игрок' + Math.floor(Math.random() * 900 + 100)).slice(0, 14);
  localStorage.setItem('dino_nick', name); localStorage.setItem('dino_sp', chosen); localStorage.setItem('dino_mode', chosenMode);
  $('menu').classList.add('hidden'); $('death').classList.add('hidden'); $('hud').classList.remove('hidden');
  if (mode !== chosenMode || !net) startNet(chosenMode);
  if (me) { ents.delete(me.id); me.dispose(); me = null; }
  spawnMe(chosen, name);
  $('sp-name').textContent = SPECIES[chosen].special.name;
  toast(chosenMode === 'prime' ? 'Прайм-арена: все сразу взрослые. В бой!' : 'Ешь, расти и стань праймом!');
};
function showDeath(by) {
  $('death-by').textContent = by ? `Тебя победил: ${by}` : '';
  $('death').classList.remove('hidden');
}
$('again').onclick = () => { $('death').classList.add('hidden'); $('play').onclick(); };
$('to-menu').onclick = () => { $('death').classList.add('hidden'); $('hud').classList.add('hidden'); $('menu').classList.remove('hidden'); };

// ================= Главный цикл =================
let last = NOW(), fpsAcc = 0, fpsFrames = 0, lowStreak = 0;
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
  world.update(dt);
  updateFx(dt);
  updateCamera(dt);

  sendTimer -= dt; if (sendTimer <= 0) { sendTimer = 0.1; sendState(); }
  hudTimer -= dt; if (hudTimer <= 0) { hudTimer = 0.2; updateHud(); }

  renderer.render(scene, camera);

  // Автонастройка качества: если тормозит — снижаем разрешение
  fpsAcc += dt; fpsFrames++;
  if (fpsAcc > 2) {
    const fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0;
    if (fps < 40 && pixelRatio > 0.7) {
      if (++lowStreak >= 1) { pixelRatio = Math.max(0.7, pixelRatio - 0.2); renderer.setPixelRatio(pixelRatio); lowStreak = 0; }
      if (fps < 28) { scene.fog.far = 150; camera.far = 160; camera.updateProjectionMatrix(); }
    }
    $('fps').textContent = Math.round(fps) + ' FPS';
  }
}
requestAnimationFrame(frame);
window.__game = { ents, get me() { return me; }, attack };
