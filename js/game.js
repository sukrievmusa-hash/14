// ЭРА ЯЩЕРОВ — выживание динозавров в браузере.
// Вылупляешься детёнышем, ищешь еду и воду, растёшь до взрослого, охотишься или спасаешься от хищников.
import * as THREE from 'three';
import { SPECIES, SP_KEYS, STAGES, stageOf, scaleOf, massOf, statK, buildDino, animate, setHurt } from './dinos.js';
import { World, height, depthAt, WATER_Y, MAP_R } from './world.js';
import { connect } from './net.js';
import { sfx, initAudio } from './sfx.js';

const $ = id => document.getElementById(id);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const isMobile = isTouch || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
const NOW = () => performance.now();
if (isTouch) document.body.classList.add('touch');
const PI = Math.PI, TAU = PI * 2;
const cl = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > PI) d -= TAU; if (d < -PI) d += TAU; return d; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ================= Рендер и свет =================
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, powerPreference: 'high-performance' });
let pixelRatio = Math.min(window.devicePixelRatio || 1, isMobile ? 1.25 : 1.75);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd4f0);
scene.fog = new THREE.Fog(0x9fd4f0, 70, 190);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.2, 200);
const hemi = new THREE.HemisphereLight(0xdcefff, 0x55603a, 1.1); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1d6, 2.2); scene.add(sun); scene.add(sun.target);
const boot = window.__boot || (async () => {});
await boot(68, 'Строю мир: холмы, реки, леса…');
const world = new World(scene);
await boot(90, 'Готовлю динозавров…');
function onResize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', onResize);
addEventListener('orientationchange', () => setTimeout(onResize, 300));

// ----- День и ночь: время общее для всех игроков (от часов) -----
const DAY_LEN = 16 * 60;
const SKY_DAY = new THREE.Color('#9fd4f0'), SKY_SET = new THREE.Color('#e9a06a'), SKY_NIGHT = new THREE.Color('#1c2c48');
const _sky = new THREE.Color();
let dayK = 1, isNight = false;
function updateSky() {
  const t = ((Date.now() / 1000) / DAY_LEN + 0.12) % 1, a = t * TAU;
  const sy = Math.sin(a), sx = Math.cos(a);
  dayK = cl(sy * 2.6 + 0.4);
  isNight = dayK < 0.25;
  const setK = cl(1 - Math.abs(sy) * 4) * 0.8;
  _sky.copy(SKY_NIGHT).lerp(SKY_DAY, dayK).lerp(SKY_SET, setK * dayK);
  scene.background.copy(_sky); scene.fog.color.copy(_sky);
  const fogFar = scene.userData.far || 190;
  scene.fog.far = fogFar * (0.65 + 0.35 * dayK); scene.fog.near = scene.fog.far * 0.35;
  hemi.intensity = 0.6 + 0.55 * dayK; hemi.color.setRGB(0.55 + 0.4 * dayK, 0.65 + 0.3 * dayK, 0.9 + 0.1 * dayK);
  sun.intensity = 0.5 + 1.75 * dayK; sun.color.setRGB(1, 0.75 + 0.2 * dayK - setK * 0.2, 0.6 + 0.3 * dayK - setK * 0.3);
  if (dayK < 0.1) sun.color.setRGB(0.55, 0.65, 0.95); // лунный свет
  const fx = focus(); sun.target.position.set(fx.x, 0, fx.z);
  sun.position.set(fx.x + sx * 80 * (dayK > 0.1 ? 1 : -1), 90, fx.z + 40);
  world.waterMat.color.setRGB(0.12 + 0.12 * dayK, 0.3 + 0.25 * dayK, 0.45 + 0.25 * dayK);
  $('tod').textContent = isNight ? '🌙' : setK > 0.4 ? '🌅' : '☀️';
}

// ================= Частицы: кровь, брызги, пыль =================
const PN = 240;
const pGeo = new THREE.BufferGeometry();
const pPos = new Float32Array(PN * 3), pCol = new Float32Array(PN * 3), pVel = new Float32Array(PN * 3), pLife = new Float32Array(PN);
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.35, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false }));
points.frustumCulled = false; scene.add(points);
let pI = 0;
const _pc = new THREE.Color();
function burst(x, y, z, n, color, spread = 2, up = 3, size = 1) {
  _pc.set(color);
  for (let k = 0; k < n; k++) {
    const i = pI = (pI + 1) % PN;
    pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
    pVel[i * 3] = (Math.random() - 0.5) * spread * size; pVel[i * 3 + 1] = Math.random() * up * size; pVel[i * 3 + 2] = (Math.random() - 0.5) * spread * size;
    pCol[i * 3] = _pc.r; pCol[i * 3 + 1] = _pc.g; pCol[i * 3 + 2] = _pc.b; pLife[i] = 0.6 + Math.random() * 0.5;
  }
}
function updateParticles(dt) {
  for (let i = 0; i < PN; i++) {
    if (pLife[i] <= 0) { pPos[i * 3 + 1] = -999; continue; }
    pLife[i] -= dt; pVel[i * 3 + 1] -= 9 * dt;
    pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
  }
  pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
}

// ================= Динозавр =================
const clientId = Math.random().toString(36).slice(2, 10);
let uid = 0;
const ents = new Set();
let me = null, playing = false, net = null, roomName = '', online = true;

function makeLabel(text) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 48;
  const c = cv.getContext('2d'); c.font = 'bold 26px system-ui,sans-serif'; c.textAlign = 'center';
  c.fillStyle = 'rgba(0,0,0,.45)'; const w = Math.min(250, c.measureText(text).width + 24); c.fillRect(128 - w / 2, 6, w, 36);
  c.fillStyle = '#fff'; c.fillText(text, 128, 34);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true }));
  sp.scale.set(3.2, 0.6, 1); sp.renderOrder = 10;
  return sp;
}

class Dino {
  constructor(sp, o = {}) {
    this.sp = sp; this.S = SPECIES[sp]; this.m = buildDino(sp); scene.add(this.m.root);
    this.id = o.id || 'e' + (++uid); this.name = o.name || this.S.name;
    this.local = !o.remote; this.remote = !!o.remote; this.ai = !!o.ai; this.peer = o.peer;
    this.g = o.g ?? 0; this.x = o.x || 0; this.z = o.z || 0; this.yaw = o.yaw || 0; this.y = height(this.x, this.z);
    this.hp = this.maxHP(); this.st = 100; this.food = o.food ?? 85; this.water = o.water ?? 85;
    this.bleed = 0; this.fracture = 0; this.rest = 0; this.resting = false; this.dead = 0; this.isDead = false;
    this.spd = 0; this.turn = 0; this.act = null; this.cd = 0; this.scd = 0; this.seed = Math.random() * 10;
    this.kx = 0; this.kz = 0; this.charge = 0; this.leap = null; this.dash = 0; this.hurtT = 0; this.swimY = 0; this.slope = 0;
    this.born = NOW(); this.lastAttacker = null; this.lastHitT = 0;
    if (o.label) { this.label = makeLabel(o.label); scene.add(this.label); }
    ents.add(this);
  }
  get scale() { return scaleOf(this.S, this.g); }
  get mass() { return massOf(this.S, this.g); }
  maxHP() { return this.S.hp * statK(this.g); }
  radius() { return this.m.r * this.scale; }
  len() { return this.m.len * this.scale; }
  headPos() { const s = this.scale, f = this.m.headPt[2] * s; return { x: this.x + Math.sin(this.yaw) * f, z: this.z + Math.cos(this.yaw) * f }; }
  dispose() { scene.remove(this.m.root); if (this.label) { scene.remove(this.label); this.label.material.map.dispose(); this.label.material.dispose(); } ents.delete(this); }
  visual(dt, time) {
    const r = this.m.root, vis = camD(this.x, this.z) < (scene.userData.far || 190) * 0.8 || this === me;
    r.visible = vis; if (this.label) this.label.visible = vis && !this.isDead;
    if (!vis) return;
    const s = this.scale;
    r.position.set(this.x, this.y, this.z); r.rotation.y = this.yaw; r.scale.setScalar(s);
    this.m.shadow.visible = !this.swimY;
    this.rest += ((this.resting ? 1 : 0) - this.rest) * Math.min(1, dt * 2.5);
    if (this.isDead) this.dead = Math.min(1, this.dead + dt * 1.6);
    if (this.hurtT > 0) { this.hurtT -= dt; setHurt(this.m, this.hurtT > 0); }
    animate(this, dt, time);
    if (this.label) this.label.position.set(this.x, this.y + (this.m.bodyY + this.m.hip * 0.9) * s + 0.8, this.z);
  }
}

// ================= Движение =================
function gaitSpeeds(e) { const k = 0.6 + 0.4 * Math.min(1, e.g), S = e.S; return [S.walk * k, S.trot * k, S.sprint * k]; }
function move(e, dx, dz, mag, sprint, dt) {
  const S = e.S, sc = e.scale, [W, T, R] = gaitSpeeds(e);
  let want = 0, turnStep = 0;
  if (e.leap) return tickLeap(e, dt);
  if (e.charge > 0) { // таран/атака: летим вперёд, повернуть почти нельзя
    e.charge -= dt; want = R * 1.25; mag = 1;
    if (Math.hypot(dx, dz) > 0.1) turnStep = cl(angDiff(e.yaw, Math.atan2(dx, dz)), -S.turn * 0.35 * dt, S.turn * 0.35 * dt);
    chargeHit(e);
  } else if (mag > 0.06 && !e.isDead) {
    const target = Math.atan2(dx, dz), d = angDiff(e.yaw, target);
    const rate = S.turn * (1.35 - 0.35 * Math.min(1, e.g)) * (e.spd > T ? 0.65 : 1);
    turnStep = cl(d, -rate * dt, rate * dt);
    const canRun = sprint && e.st > 1 && e.fracture <= 0;
    want = canRun ? R * (e.dash > 0 ? 1.2 : 1) : mag < 0.55 ? W * Math.max(0.35, mag / 0.55) : T;
    if (Math.abs(d) > 1.3) want *= 0.35; // сначала развернуться
    if (e.resting || e.feeding) { e.resting = false; e.feeding = null; }
  }
  e.yaw += turnStep; e.turn += (turnStep / Math.max(dt, 1e-3) - e.turn) * Math.min(1, dt * 8);
  // вода: мелко — медленнее, глубоко — плывём
  const dep = depthAt(e.x, e.z), hipH = e.m.hip * sc;
  e.swim = dep > hipH * 0.95;
  if (e.swim) { want = Math.min(want, T * 0.5); if (want > 0) e.st = Math.max(0, e.st - 3 * dt); }
  else if (dep > 0.2) want *= 0.75;
  if (e.fracture > 0) want *= 0.55;
  if (e.feeding || e.resting || e.isDead || (e.act && (e.act.k === 'call'))) want = e.charge > 0 ? want : 0;
  e.spd += (want - e.spd) * Math.min(1, dt * (want > e.spd ? 2.4 : 4.5));
  e.x += Math.sin(e.yaw) * e.spd * dt + e.kx * dt; e.z += Math.cos(e.yaw) * e.spd * dt + e.kz * dt;
  e.kx *= Math.exp(-dt * 5); e.kz *= Math.exp(-dt * 5);
  world.collide(e, e.radius());
  // выносливость
  const sprinting = e.spd > T * 1.05 && e.charge <= 0;
  if (sprinting && e.dash <= 0) e.st -= 9 / S.stam * dt;
  else e.st += (e.rest > 0.5 ? 14 : 6.5) * (e.food > 10 && e.water > 10 ? 1 : 0.35) * dt;
  e.st = cl(e.st, 0, 100);
  if (e.dash > 0) e.dash -= dt;
  placeOnGround(e, dt);
}
function placeOnGround(e, dt) {
  const sc = e.scale, g = height(e.x, e.z);
  const float = WATER_Y - e.m.bodyY * sc * 0.75;
  e.y = e.swim ? Math.max(g, float) : g;
  const L = e.len() * 0.45, sx = Math.sin(e.yaw) * L, sz = Math.cos(e.yaw) * L;
  const want = e.swim ? 0 : cl(Math.atan2(height(e.x - sx, e.z - sz) - height(e.x + sx, e.z + sz), L * 2), -0.45, 0.45);
  e.slope += (want - e.slope) * Math.min(1, dt * 6);
  // шаги и брызги
  const stepLen = e.m.hip * sc * 1.3;
  e.stepAcc = (e.stepAcc || 0) + e.spd * dt;
  if (e.stepAcc > stepLen) {
    e.stepAcc = 0;
    const vol = volAt(e), w = cl(Math.log10(e.mass + 1) / 4);
    if (depthAt(e.x, e.z) > 0.1) { sfx.splash(vol); burst(e.x, WATER_Y + 0.1, e.z, 4, '#cfe8f5', 2 * sc + 0.5, 2.5, 1); }
    else { sfx.step(w, vol); if (w > 0.6 && e.spd > 2) burst(e.x, e.y + 0.1, e.z, 3, '#9b8a64', 2.5, 1.2, 1); }
    if (e !== me && me && w > 0.75 && vol > 0.3) shake = Math.max(shake, 0.06 * vol);
    if (e === me && w > 0.75) shake = Math.max(shake, 0.05);
  }
}
const camD = (x, z) => Math.hypot(camera.position.x - x, camera.position.z - z);
const volAt = e => (e === me ? 1 : Math.max(0, 1 - camD(e.x, e.z) / 70));

// ================= Бой =================
const alive = () => [...ents].filter(e => !e.isDead);
function inFront(a, reach, cone, rear = false) {
  const out = [];
  for (const e of ents) {
    if (e === a || e.isDead || isFriend(a, e)) continue;
    const d = dist(a, e) - e.radius() * 0.8;
    if (d > reach) continue;
    const ang = Math.abs(angDiff(a.yaw, Math.atan2(e.x - a.x, e.z - a.z)));
    if (rear ? ang > PI - cone : ang < cone) out.push({ e, d });
  }
  return out.sort((p, q) => p.d - q.d);
}
// Кого задевает атака. Укус — зона от груди до пасти, хвост — сзади и по бокам, вихрь — всё вокруг.
function hitList(a, mode, extra = 0) {
  const s = a.scale, fwd = a.m.headPt[2] * s, R = a.S.reach * s * 0.5 + 0.4 + extra, fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
  const tl = a.len() * 0.55, out = [];
  for (const e of ents) {
    if (e === a || e.isDead || isFriend(a, e)) continue;
    const dx = e.x - a.x, dz = e.z - a.z, u = dx * fx + dz * fz, v = Math.abs(dx * fz - dz * fx), er = e.radius() * 0.8;
    let ok;
    if (mode === 'bite') ok = u > -er && u < fwd + R + er && v < a.radius() * 0.35 + R * 0.7 + er;
    else if (mode === 'rear') ok = (u < er && u > -(tl + R + er) && v < R + er + a.radius() * 0.4) || (u > -tl && u < fwd * 0.3 && v < a.radius() + R + er);
    else ok = Math.hypot(dx, dz) < tl + R + er;
    if (ok) out.push({ e, d: Math.hypot(dx - fx * fwd, dz - fz * fwd) });
  }
  return out.sort((p, q) => p.d - q.d);
}
// «свои»: игрок и его стая, звери одной стаи
const leaderOf = e => (e.leader && !e.leader.isDead ? e.leader : e);
const isFriend = (a, b) => a !== b && leaderOf(a) === leaderOf(b);
const reachOf = a => a.S.reach * a.scale + 0.6;

function attack(a, special) {
  if (!a || a.isDead || a.leap || a.charge > 0) return;
  if (a.act && (a.act.k === 'bite' || a.act.k === 'spec') && a.act.t < a.act.d) return;
  if (special ? a.scd > 0 : a.cd > 0) return;
  const cost = special ? 22 : 7;
  if (a.st < cost * 0.6) { if (a === me) toast('Нет сил — отдохни 💤'); return; }
  a.st -= cost; a.resting = false; a.feeding = null;
  const S = a.S;
  // автонаведение: доворачиваем к ближайшему врагу впереди
  const aim = inFront(a, a.m.headPt[2] * a.scale + reachOf(a) * 1.6, S.tailAtk ? PI : 1.5)[0];
  if (aim && !S.tailAtk) a.yaw += cl(angDiff(a.yaw, Math.atan2(aim.e.x - a.x, aim.e.z - a.z)), -0.9, 0.9);
  if (!special) {
    a.act = { k: 'bite', t: 0, d: Math.max(0.45, S.cd * 0.75), side: 1 };
    if (S.tailAtk && aim) a.act.side = Math.sign(angDiff(a.yaw, Math.atan2(aim.e.x - a.x, aim.e.z - a.z))) || 1;
    a.cd = S.cd;
    sfx.whoosh(volAt(a) * 0.6);
    return;
  }
  a.scd = { rex: 8, carno: 7, deino: 5, trike: 8, stego: 7, dryo: 9 }[a.sp];
  if (a.sp === 'carno' || a.sp === 'trike') { a.charge = 1.0; a.chargeHit = false; a.act = { k: 'spec', t: 0, d: 1.0 }; sfx.roar(pitchOf(a) * 1.2, volAt(a) * 0.6); }
  else if (a.sp === 'deino') startLeap(a, aim && aim.e);
  else if (a.sp === 'dryo') { a.dash = 2.2; a.st = Math.min(100, a.st + 20); if (a === me) toast('💨 Рывок!'); }
  else a.act = { k: 'spec', t: 0, d: a.sp === 'stego' ? 0.9 : 0.85, side: 1 };
}
function tickAct(a, dt) {
  a.cd = Math.max(0, a.cd - dt); a.scd = Math.max(0, a.scd - dt);
  const A = a.act; if (!A) return;
  A.t += dt;
  const hitAt = A.k === 'bite' || A.k === 'spec' ? A.d * (a.S.tailAtk ? 0.45 : 0.42) : 99;
  if (!A.done && A.t >= hitAt && a.local) { A.done = true; resolveHit(a, A.k === 'spec'); }
  if (A.t >= A.d) a.act = null;
}
function resolveHit(a, special) {
  const S = a.S, k = statK(a.g);
  let dmg = S.dmg * k, bleed = S.bleed * k, fr = 0, targets;
  if (S.tailAtk) {
    // стегозавр: хвост бьёт назад и в стороны, вихрь — всех вокруг
    targets = special ? hitList(a, 'around') : hitList(a, 'rear').slice(0, 2);
    if (special) { dmg *= 1.1; bleed *= 1.4; }
    sfx.whoosh(volAt(a));
  } else {
    targets = hitList(a, 'bite').slice(0, 1);
    if (special && a.sp === 'rex') { dmg *= 1.6; fr = 7; }
  }
  if (!targets.length) {
    // промах — может, рыба? (хищники в воде)
    if (S.diet === 'carn' && !special) {
      const h = a.headPos();
      if (depthAt(h.x, h.z) > 0.25 && Math.random() < 0.4) {
        const val = 30 / (1 + a.mass / 150);
        a.food = Math.min(100, a.food + val);
        burst(h.x, WATER_Y + 0.2, h.z, 6, '#cfe8f5', 2, 3);
        if (a === me) { toast(`🐟 Поймал рыбу! +${Math.round(val)}% еды`); sfx.chew(1); }
      } else if (depthAt(h.x, h.z) > 0.25) burst(h.x, WATER_Y + 0.1, h.z, 4, '#cfe8f5', 2, 2);
    }
    return;
  }
  for (const { e } of targets) hit(a, e, dmg, bleed, fr, special ? 1.5 : 0.5);
}
function hit(a, t, dmg, bleed, fr, knock) {
  const dx = t.x - a.x, dz = t.z - a.z, d = Math.hypot(dx, dz) || 1;
  // тяжёлого не отбросишь
  const kk = knock * cl(a.mass / (t.mass + 1), 0.05, 3) * 3;
  const kx = dx / d * kk, kz = dz / d * kk;
  const hx = t.x - dx / d * t.radius() * 0.5, hz = t.z - dz / d * t.radius() * 0.5;
  burst(hx, t.y + t.m.bodyY * t.scale, hz, 8 + Math.round(dmg / 30), '#a3121a', 2.5, 3, cl(t.scale, 0.5, 2));
  sfx.bite(Math.max(volAt(a), volAt(t)));
  if (a === me || t === me) shake = Math.max(shake, 0.12 + Math.min(0.3, dmg / 600));
  if (t.remote) { if (net) net.hit(t.peer, { d: dmg, b: bleed, f: fr, kx, kz, by: a.name, bs: a.sp }); t.hurtT = 0.12; return; }
  applyHit(t, dmg, bleed, fr, kx, kz, a.name, a.sp, a);
}
function applyHit(t, dmg, bleed, fr, kx, kz, byName, bySp, attacker) {
  if (t.isDead) return;
  t.hp -= dmg; t.bleed = Math.min(8, t.bleed + bleed); t.fracture = Math.max(t.fracture, fr);
  t.kx += kx; t.kz += kz; t.hurtT = 0.12; t.resting = false; t.feeding = null;
  t.lastAttacker = attacker || t.lastAttacker; t.lastHitT = NOW();
  if (t === me) { flashVignette(); lastHitBy = byName ? `${byName} (${SPECIES[bySp] ? SPECIES[bySp].name : ''})` : ''; if (fr) toast('🦴 Перелом! Ты хромаешь'); }
  if (Math.random() < 0.5) sfx.hurt(pitchOf(t), volAt(t));
  if (t.hp <= 0) kill(t, byName ? 'Убит: ' + byName : 'Погиб в бою');
}
// таран: бьём первого, в кого врезались
function chargeHit(a) {
  if (a.chargeHit) return;
  const t = hitList(a, 'bite', -0.2)[0];
  if (!t) return;
  a.chargeHit = true; a.charge = Math.min(a.charge, 0.15);
  const k = statK(a.g), m = a.sp === 'trike' ? 1.9 : 1.35;
  hit(a, t.e, a.S.dmg * k * m, a.S.bleed * k, 0, 3);
  sfx.thud(Math.max(volAt(a), volAt(t.e)));
}
// прыжок дейнониха
function startLeap(a, target) {
  const L = 7 * a.scale + 2;
  let tx = a.x + Math.sin(a.yaw) * L, tz = a.z + Math.cos(a.yaw) * L;
  if (target && dist(a, target) < L * 1.4) { tx = target.x; tz = target.z; a.yaw = Math.atan2(tx - a.x, tz - a.z); }
  a.leap = { t: 0, d: 0.55, fx: a.x, fz: a.z, tx, tz, H: 1.2 + 2 * a.scale };
  a.act = { k: 'spec', t: 0, d: 0.7 };
  sfx.whoosh(volAt(a));
}
function tickLeap(a, dt) {
  const L = a.leap; L.t += dt; const u = cl(L.t / L.d);
  a.x = L.fx + (L.tx - L.fx) * u; a.z = L.fz + (L.tz - L.fz) * u;
  a.y = height(a.x, a.z) + Math.sin(u * PI) * L.H; a.spd = 0;
  if (u >= 1) {
    a.leap = null;
    const t = hitList(a, 'around', 0.8)[0];
    if (t) { const k = statK(a.g); hit(a, t.e, a.S.dmg * k * 1.6, a.S.bleed * k * 2.2, 0, 0.6); }
    placeOnGround(a, dt);
  }
}

// ================= Жизнь: голод, жажда, кровь, рост =================
let lastHitBy = '', deathCause = '';
function tickVitals(e, dt) {
  const sprinting = e.spd > gaitSpeeds(e)[1] * 1.05;
  const mult = e.rest > 0.5 ? 0.45 : sprinting ? 1.7 : 1;
  const ai = e.ai ? 0.6 : 1;
  e.food = Math.max(0, e.food - 100 / (11 * 60) * mult * ai * dt);
  e.water = Math.max(0, e.water - 100 / (8 * 60) * mult * ai * dt);
  const max = e.maxHP();
  let cause = '';
  if (e.food <= 0) { e.hp -= max * 0.01 * dt; cause = 'Умер от голода'; }
  if (e.water <= 0) { e.hp -= max * 0.013 * dt; cause = 'Умер от жажды'; }
  if (e.bleed > 0.02) { e.hp -= max * e.bleed * 0.006 * dt; e.bleed = Math.max(0, e.bleed - (e.rest > 0.5 ? 0.35 : 0.08) * dt); cause = cause || 'Истёк кровью'; if (Math.random() < dt * e.bleed * 0.8) burst(e.x, e.y + 0.3, e.z, 1, '#8a0f14', 0.4, 0.5); }
  if (e.food > 35 && e.water > 35 && e.bleed < 0.05) e.hp = Math.min(max, e.hp + max * (e.rest > 0.5 ? 0.022 : 0.004) * dt);
  e.fracture = Math.max(0, e.fracture - dt * (e.rest > 0.5 ? 2 : 1));
  // рост — только если сыт и напоён
  if (e.food > 25 && e.water > 25 && e.g < 1) {
    const before = stageOf(e.g), frac = e.hp / max;
    e.g = Math.min(1, e.g + dt / (e.S.grow * 60));
    e.hp = frac * e.maxHP();
    if (e === me && stageOf(e.g) !== before) { sfx.grow(); toast(`⬆️ Ты вырос: ${STAGES[stageOf(e.g)]}!`); }
  }
  if (e.hp <= 0) kill(e, (e === me && lastHitBy && NOW() - me.lastHitT < 15000) ? 'Убит: ' + lastHitBy : cause || 'Погиб');
}

function kill(t, cause) {
  if (t.isDead) return;
  t.isDead = true; t.hp = 0; t.spd = 0; t.act = null; t.charge = 0; t.leap = null; t.feeding = null; t.resting = false;
  sfx.hurt(pitchOf(t) * 0.8, volAt(t));
  const c = makeCarcass(t);
  if (t === me) {
    deathCause = cause;
    try { localStorage.removeItem('era_save'); } catch (e) { /* нет хранилища */ }
    if (net) net.kill({ x: t.x, z: t.z, sp: t.sp, g: t.g, yaw: t.yaw });
    setTimeout(showDeath, 2600);
  }
  return c;
}
// Туша: мёртвое тело лежит, пока его не обглодают наполовину, потом остаются рёбра
function makeCarcass(t) {
  const meat = Math.pow(t.mass / 1000, 0.6) * 60 + 3;
  const c = world.spawnCarcass(t.x, t.z, cl(t.len() / 3.2, 0.3, 4), meat, t.sp);
  c.mesh.visible = false; c.body = t; ents.delete(t); corpses.add(c);
  return c;
}
const corpses = new Set();
function updateCorpses(dt, time) {
  for (const c of corpses) {
    const b = c.body;
    if (!c.active || c.body !== b || c.meat / c.max < 0.45) {
      scene.remove(b.m.root); if (b.label) scene.remove(b.label);
      corpses.delete(c);
      if (c.active && c.body === b) c.mesh.visible = true;
      c.body = null;
      continue;
    }
    b.visual(dt, time);
  }
}

// еда и вода
const eatRate = e => Math.max(0.5, Math.pow(e.mass / 1000, 0.6) * 4);
function feedTarget(e) {
  const h = e.headPos(), R = reachOf(e) + 0.8;
  if (e.S.diet === 'carn') { const c = world.nearestCarcass(h.x, h.z, R); if (c) return { k: 'eat', c }; }
  else { const p = world.nearestPlant(h.x, h.z, R + 0.4); if (p) return { k: 'eat', p }; }
  if (world.waterNear(h.x, h.z, R)) return { k: 'drink' };
  return null;
}
function tickFeeding(e, dt) {
  const F = e.feeding; if (!F) return;
  if (!e.act || e.act.k !== F.k) e.act = { k: F.k, t: 0, d: 9999 };
  e.act.t += dt;
  if (e.act.t < 0.4) return;
  if (F.k === 'drink') {
    e.water = Math.min(100, e.water + 16 * dt);
    if (Math.random() < dt * 2) sfx.slurp(volAt(e) * 0.7);
    if (e.water >= 100 || !world.waterNear(e.headPos().x, e.headPos().z, reachOf(e) + 1.2)) return stopFeeding(e, e.water >= 100 ? '💧 Напился' : '');
  } else {
    const src = F.c || F.p;
    const left = F.c ? (F.c.active ? F.c.meat : 0) : F.p.food * 40;
    if (left <= 0.01 || (F.c && !F.c.active)) return stopFeeding(e, '🍽 Еда закончилась');
    const units = eatRate(e) * dt;
    if (F.c) world.eatCarcass(F.c, units); else world.eatPlant(F.p, units / 40);
    e.food = Math.min(100, e.food + 13 * dt);
    if (Math.random() < dt * 2.5) sfx.chew(volAt(e) * 0.8);
    if (F.c && Math.random() < dt * 3) burst(src.x, height(src.x, src.z) + 0.4, src.z, 1, '#8a1a14', 0.8, 1.2);
    if (e.food >= 100) return stopFeeding(e, '😋 Наелся');
  }
}
function stopFeeding(e, msg) { e.feeding = null; if (e.act && (e.act.k === 'eat' || e.act.k === 'drink')) e.act.d = e.act.t + 0.35; if (e === me && msg) toast(msg); }

// ================= Голос: зов =================
const pitchOf = e => e.S.call * (1.6 - 0.6 * Math.min(1, e.g));
const calls = []; // { x, z, sp, t, friend }
function doCall(e) {
  if (e.isDead || (e.callCd && NOW() < e.callCd)) return;
  e.callCd = NOW() + 3500; e.resting = false; e.feeding = null;
  e.act = { k: 'call', t: 0, d: 1.6 };
  if (e.S.diet === 'carn' && e.g > 0.6) sfx.roar(pitchOf(e), volAt(e)); else sfx.call(pitchOf(e), volAt(e));
  if (e !== me && me) calls.push({ x: e.x, z: e.z, sp: e.sp, t: NOW(), friend: isFriend(me, e) || e.sp === me.sp });
  if (e === me) {
    if (net) net.call({ x: e.x, z: e.z, sp: e.sp });
    // свои того же вида отвечают и могут присоединиться к стае
    let joined = 0;
    for (const b of ents) {
      if (!b.ai || b.isDead || b.sp !== e.sp || dist(b, e) > 70) continue;
      if (b.angry === me) continue;
      setTimeout(() => { if (!b.isDead && ents.has(b)) doCall(b); }, 700 + Math.random() * 900);
      if (b.leader !== me && packSize() + joined < 4 && b.state !== 'hunt') { b.leader = me; b.leaderAI = null; joined++; }
    }
    if (joined) setTimeout(() => toast(`🤝 К стае присоединились: ${joined}`), 1500);
  }
}
const packSize = () => { let n = 0; for (const b of ents) if (b.ai && !b.isDead && b.leader === me) n++; return n; };

// ================= ИИ =================
const AI_MAX = isMobile ? 16 : 22;
const AI_W = { dryo: 5, trike: 3, stego: 2, deino: 3, carno: 2, rex: 1 };
function pickSpecies() { let s = 0; for (const k in AI_W) s += AI_W[k]; let r = Math.random() * s; for (const k in AI_W) { if ((r -= AI_W[k]) <= 0) return k; } return 'dryo'; }
function spawnGroup(force) {
  const sp = pickSpecies(), n = sp === 'dryo' || sp === 'deino' || sp === 'trike' ? 1 + Math.floor(Math.random() * 3) : 1;
  const c = me || { x: 0, z: 0 };
  let x = 0, z = 0;
  for (let t = 0; t < 30; t++) {
    const a = Math.random() * TAU, r = force ? 45 + Math.random() * 110 : 80 + Math.random() * 110;
    x = c.x + Math.cos(a) * r; z = c.z + Math.sin(a) * r;
    if (Math.hypot(x, z) < MAP_R - 35 && height(x, z) > WATER_Y + 0.8) break;
  }
  let lead = null;
  for (let i = 0; i < n; i++) {
    const g = lead ? cl(lead.g - Math.random() * 0.5, 0.15, 1) : 0.25 + Math.random() * 0.8;
    const b = new Dino(sp, { ai: true, g: Math.min(1, g), x: x + (Math.random() - 0.5) * 8, z: z + (Math.random() - 0.5) * 8, yaw: Math.random() * TAU, food: 40 + Math.random() * 60 });
    b.state = 'wander'; b.think = Math.random(); b.goal = null;
    if (lead) b.leader = lead; else lead = b;
  }
}
function manageAI(dt) {
  manageAI.t = (manageAI.t || 0) - dt;
  if (manageAI.t > 0) return;
  manageAI.t = 1.5;
  let n = 0;
  for (const b of ents) {
    if (!b.ai) continue;
    if (me && dist(b, me) > 240 && b.leader !== me) { b.dispose(); continue; }
    n++;
  }
  if (n < AI_MAX) spawnGroup(n < AI_MAX / 2);
}
function randGoal(b, R) {
  for (let t = 0; t < 12; t++) {
    const a = Math.random() * TAU, r = R * (0.4 + Math.random() * 0.6), x = b.x + Math.cos(a) * r, z = b.z + Math.sin(a) * r;
    if (Math.hypot(x, z) < MAP_R - 35 && depthAt(x, z) < b.m.hip * b.scale * 0.7) return [x, z];
  }
  return [b.x * 0.9, b.z * 0.9];
}
function thinkAI(b) {
  const S = b.S, M = b.mass, sense = 40 + 30 * b.scale;
  let threat = null, td = 1e9, prey = null, pd = 1e9;
  const lead = leaderOf(b);
  for (const e of ents) {
    if (e === b || e.isDead || isFriend(b, e)) continue;
    const d = dist(b, e); if (d > sense) continue;
    const em = e.mass;
    if (e.sp === b.sp && b.angry !== e) continue; // свой вид не трогаем
    if (e.S.diet === 'carn' && em > M * 0.45 && (S.diet === 'herb' || em > M * 1.6) && d < td) { threat = e; td = d; }
    const edible = em >= M * 0.04 && (e.S.diet === 'herb' ? em <= M * 1.25 : b.food < 45 && em <= M * 0.8);
    if (S.diet === 'carn' && b.food < 80 && edible) {
      if (e === me && NOW() - lifeStart < 40000) continue; // дадим детёнышу освоиться
      const w = d * (e === me ? 0.85 : 1); if (w < pd) { prey = e; pd = w; }
    }
  }
  // кто напал — тому отвечаем (или убегаем)
  const att = b.lastAttacker;
  if (att && !att.isDead && ents.has(att) && NOW() - b.lastHitT < 12000 && dist(b, att) < 60) {
    if (att.mass < M * 1.6) { b.angry = att; b.target = att; b.state = 'hunt'; return; }
    threat = att; td = dist(b, att);
  }
  // стая защищает вожака
  if (lead !== b && lead.lastAttacker && !lead.lastAttacker.isDead && ents.has(lead.lastAttacker) && NOW() - lead.lastHitT < 10000 && !isFriend(b, lead.lastAttacker) && dist(b, lead.lastAttacker) < 50 && lead.lastAttacker.mass < M * 3) { b.target = lead.lastAttacker; b.state = 'hunt'; return; }
  if (threat) {
    const brave = (b.sp === 'trike' || b.sp === 'stego') && threat.mass < M * 1.3;
    if (brave && td < 25) { b.target = threat; b.state = 'fight'; return; }
    b.state = 'flee'; b.target = threat;
    const ax = b.x - threat.x, az = b.z - threat.z, d = Math.hypot(ax, az) || 1;
    b.goal = [b.x + ax / d * 40, b.z + az / d * 40];
    if (Math.hypot(b.goal[0], b.goal[1]) > MAP_R - 40) b.goal = [b.goal[0] * 0.6, b.goal[1] * 0.6];
    return;
  }
  if (prey && b.leader !== me) { b.target = prey; b.state = 'hunt'; return; }
  if (b.state === 'hunt' && b.target && (b.target.isDead || !ents.has(b.target) || dist(b, b.target) > sense * 1.3)) { b.target = null; b.state = 'wander'; }
  if (b.state === 'hunt') return;
  b.target = null;
  if (b.food < 60) {
    if (S.diet === 'carn') { const c = world.nearestCarcass(b.x, b.z, 90); if (c) { b.state = 'eat'; b.goal = [c.x, c.z]; b.food_src = { c }; return; } }
    else { const p = world.nearestPlant(b.x, b.z, 45); if (p) { b.state = 'eat'; b.goal = [p.x, p.z]; b.food_src = { p }; return; } }
  }
  if (b.water < 45) { const w = world.findWater(b.x, b.z, 90); if (w) { b.state = 'drink'; b.goal = w; return; } }
  if (lead !== b) { b.state = 'follow'; return; }
  if (b.state !== 'wander' || !b.goal || Math.hypot(b.goal[0] - b.x, b.goal[1] - b.z) < 4 || Math.random() < 0.05) { b.state = 'wander'; b.goal = randGoal(b, 45); }
}
function updateAI(b, dt) {
  b.think -= dt;
  if (b.think <= 0) { b.think = 0.5 + Math.random() * 0.3; thinkAI(b); }
  let gx = b.x, gz = b.z, mag = 0, run = false;
  const reach = reachOf(b);
  const S = b.S;
  if ((b.state === 'hunt' || b.state === 'fight') && b.target && !b.target.isDead) {
    const t = b.target, d = dist(b, t) - t.radius() * 0.7;
    gx = t.x; gz = t.z; mag = 1; run = d > b.len() * 0.8 + 5 && b.st > 15;
    const ang = Math.abs(angDiff(b.yaw, Math.atan2(t.x - b.x, t.z - b.z)));
    const close = d < b.len() * 0.6 + reach;
    if (S.tailAtk) {
      // стегозавр подставляет хвост
      if (close) { gx = b.x - (t.x - b.x); gz = b.z - (t.z - b.z); mag = 0.3; if (hitList(b, 'rear').some(o => o.e === t)) attack(b, Math.random() < 0.25); }
    } else {
      if (close) mag = ang < 0.5 ? 0.3 : 0.1; // вблизи — тормозим и доворачиваем, а не кружим
      if (hitList(b, 'bite').some(o => o.e === t)) attack(b, b.scd <= 0 && Math.random() < 0.15);
      if (b.scd <= 0 && ang < 0.4) {
        if ((b.sp === 'carno' || b.sp === 'trike') && d > 5 && d < 14 && b.st > 30) attack(b, true);
        if (b.sp === 'deino' && d > 2.5 && d < 8 && b.st > 25) attack(b, true);
      }
    }
  } else if (b.state === 'follow') {
    const L = leaderOf(b), d = dist(b, L);
    const sideA = (b.seed % 1) * TAU, off = (L.radius() + b.radius()) * 2.2;
    gx = L.x + Math.cos(sideA) * off; gz = L.z + Math.sin(sideA) * off;
    const dg = Math.hypot(gx - b.x, gz - b.z);
    mag = dg > 3 ? (dg > 12 ? 1 : 0.5) : 0; run = d > 25 || (L.spd > gaitSpeeds(L)[1] && d > 8);
    if (d > 170) b.leader = null;
    if (!L.isDead && L.resting && dg < 4) b.resting = true;
  } else if (b.goal) {
    gx = b.goal[0]; gz = b.goal[1];
    const d = Math.hypot(gx - b.x, gz - b.z);
    mag = b.state === 'flee' ? 1 : d > 2 ? 0.45 : 0; run = b.state === 'flee' && b.st > 5;
    if (b.state === 'flee' && d < 3) b.state = 'wander';
    if ((b.state === 'eat' || b.state === 'drink') && !b.feeding) {
      const F = feedTarget(b);
      if (F && (F.k === b.state)) { b.feeding = F; mag = 0; }
      else if (d < reach + 1) { b.goal = null; b.state = 'wander'; }
    }
  }
  if (b.feeding) {
    mag = 0;
    if (b.food > 95 && b.feeding.k === 'eat') b.feeding = null;
    if (b.water > 95 && b.feeding && b.feeding.k === 'drink') b.feeding = null;
    if (!b.feeding) { b.state = 'wander'; b.goal = null; if (b.act) b.act.d = b.act.t + 0.3; }
  }
  if (mag > 0) b.resting = false;
  const dx = gx - b.x, dz = gz - b.z;
  move(b, dx, dz, mag, run, dt);
}

// ================= Сеть =================
const remotes = new Map(); // clientId -> Dino
const peers = new Map();
const ACT_CODE = { bite: 1, spec: 2, call: 3, eat: 4, drink: 5 }, ACT_NAME = ['', 'bite', 'spec', 'call', 'eat', 'drink'];
const handlers = {
  onState(d, peerId) {
    if (!d || typeof d !== 'object' || !SPECIES[d.s]) return;
    peers.set(peerId, NOW());
    let r = remotes.get(d.c);
    if (r && (r.sp !== d.s || r.isDead)) { if (!r.isDead) r.dispose(); remotes.delete(d.c); r = null; }
    if (d.dead) return;
    if (!r) {
      r = new Dino(d.s, { remote: true, peer: peerId, id: 'p' + d.c, g: +d.g || 0, x: +d.x, z: +d.z, label: String(d.n || 'Игрок').slice(0, 16) });
      r.name = String(d.n || 'Игрок').slice(0, 16);
      remotes.set(d.c, r);
    }
    r.peer = peerId; r.lastSeen = NOW();
    r.tx = +d.x || 0; r.tz = +d.z || 0; r.tyaw = +d.r || 0; r.g = cl(+d.g || 0); r.tspd = +d.v || 0;
    r.hp = cl(+d.h || 0) * r.maxHP(); r.resting = !!d.rs; r.swim = !!d.sw;
    if (d.a && ACT_NAME[d.a] && (!r.act || r.act.k !== ACT_NAME[d.a] || d.at < r.act.t)) {
      const k = ACT_NAME[d.a]; r.act = { k, t: +d.at || 0, d: k === 'eat' || k === 'drink' ? 9999 : k === 'call' ? 1.6 : 0.8, side: d.sd || 1, done: true };
    } else if (!d.a && r.act && (r.act.k === 'eat' || r.act.k === 'drink')) r.act.d = r.act.t + 0.3;
  },
  onHit(d) {
    if (!me || me.isDead || !d) return;
    const by = [...remotes.values()].find(r => r.name === d.by);
    applyHit(me, cl(+d.d, 0, 5000), cl(+d.b, 0, 10), cl(+d.f, 0, 10), cl(+d.kx, -40, 40), cl(+d.kz, -40, 40), String(d.by || '').slice(0, 16), d.bs, by);
  },
  onKill(d, peerId) {
    for (const [c, r] of remotes) if (r.peer === peerId) { remotes.delete(c); r.x = +d.x; r.z = +d.z; r.yaw = +d.yaw || r.yaw; kill(r, ''); }
  },
  onCall(d) { if (!me || !d || !SPECIES[d.sp]) return; calls.push({ x: +d.x, z: +d.z, sp: d.sp, t: NOW(), friend: d.sp === me.sp }); sfx.call(SPECIES[d.sp].call, Math.max(0.15, 1 - Math.hypot(me.x - d.x, me.z - d.z) / 200)); },
  onLeave(peerId) { peers.delete(peerId); for (const [c, r] of remotes) if (r.peer === peerId) { r.dispose(); remotes.delete(c); } },
};
async function startNet() {
  if (net || !online) return;
  setNet('…');
  try { net = await connect(roomName, handlers); } catch (e) { net = null; }
  setNet(net ? '🌐 1' : '🏝 офлайн');
}
function setNet(t) { $('online').textContent = t; }
function sendState() {
  if (!net || !me) return;
  const a = me.act;
  net.state({ c: clientId, n: myName, s: me.sp, g: Math.round(me.g * 1000) / 1000, x: Math.round(me.x * 10) / 10, z: Math.round(me.z * 10) / 10,
    r: Math.round(me.yaw * 100) / 100, v: Math.round(me.spd * 10) / 10, h: Math.round(me.hp / me.maxHP() * 100) / 100,
    rs: me.resting ? 1 : 0, sw: me.swim ? 1 : 0, a: a ? ACT_CODE[a.k] || 0 : 0, at: a ? Math.round(a.t * 10) / 10 : 0, sd: a ? a.side : 0, dead: me.isDead ? 1 : 0 });
}
function updateRemote(r, dt) {
  if (NOW() - r.lastSeen > 6000) { r.dispose(); for (const [c, x] of remotes) if (x === r) remotes.delete(c); return; }
  const k = Math.min(1, dt * 8);
  if (Math.hypot(r.tx - r.x, r.tz - r.z) > 30) { r.x = r.tx; r.z = r.tz; }
  r.x += (r.tx - r.x) * k; r.z += (r.tz - r.z) * k;
  const dy = angDiff(r.yaw, r.tyaw) * k; r.yaw += dy; r.turn = dy / Math.max(dt, 1e-3);
  r.spd += (r.tspd - r.spd) * k;
  if (r.act) { r.act.t += dt; if (r.act.t >= r.act.d) r.act = null; }
  placeOnGround(r, dt);
}

// ================= Ввод =================
const keys = {};
let runToggle = false, myName = '';
addEventListener('keydown', e => {
  if (e.target && e.target.tagName === 'INPUT') return;
  keys[e.code] = true;
  if (!playing || !me) return;
  if (e.code === 'Space') { attack(me, false); e.preventDefault(); }
  if (e.code === 'KeyE') attack(me, true);
  if (e.code === 'KeyF') toggleFeed();
  if (e.code === 'KeyR') smell();
  if (e.code === 'KeyQ') doCall(me);
  if (e.code === 'KeyC') toggleRest();
  if (e.code === 'KeyM') toggleMap();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

let camYaw = 0, camPitch = 0.32, lastCamInput = 0, shake = 0;
const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
const camDrag = { id: null, x: 0, y: 0, moved: 0, type: '' };
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
    camYaw -= dx * k; camPitch = cl(camPitch + dy * 0.004, -0.1, 1.15);
    lastCamInput = NOW();
  }
});
const endPtr = e => {
  if (e.pointerId === joy.id) { joy.id = null; joy.x = joy.y = 0; joyBase.style.display = 'none'; }
  if (e.pointerId === camDrag.id) { if (camDrag.type === 'mouse' && camDrag.moved < 6 && playing && me) attack(me, false); camDrag.id = null; }
};
touchLayer.addEventListener('pointerup', endPtr);
touchLayer.addEventListener('pointercancel', endPtr);
touchLayer.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('wheel', e => { if (playing) camZoom = cl(camZoom * (e.deltaY > 0 ? 1.1 : 0.9), 0.5, 2); }, { passive: true });
let camZoom = 1;

function bindBtn(id, fn) { $(id).addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); initAudio(); if (playing && me && !me.isDead) fn(); }); }
bindBtn('b-atk', () => attack(me, false));
bindBtn('b-sp', () => attack(me, true));
bindBtn('b-run', () => { runToggle = !runToggle; $('b-run').classList.toggle('on', runToggle); });
bindBtn('b-feed', () => toggleFeed());
bindBtn('b-smell', () => smell());
bindBtn('b-call', () => doCall(me));
bindBtn('b-rest', () => toggleRest());
$('b-map').addEventListener('pointerdown', e => { e.stopPropagation(); toggleMap(); });
$('map').addEventListener('pointerdown', e => { e.stopPropagation(); toggleMap(); });

function toggleFeed() {
  if (me.feeding) { stopFeeding(me, ''); return; }
  const F = feedTarget(me);
  if (!F) { toast(me.S.diet === 'carn' ? 'Рядом нет туши или воды. Нюхай 👃' : 'Рядом нет растений или воды. Нюхай 👃'); return; }
  me.resting = false; me.feeding = F;
}
function toggleRest() {
  if (me.swim) { toast('В воде не лечь'); return; }
  me.resting = !me.resting; me.feeding = null;
  if (me.resting) toast('💤 Отдых: быстрее лечишься и копишь силы');
}
function updatePlayer(dt) {
  let ix = 0, iy = 0;
  if (keys.KeyW || keys.ArrowUp) iy += 1; if (keys.KeyS || keys.ArrowDown) iy -= 1;
  if (keys.KeyA || keys.ArrowLeft) ix -= 1; if (keys.KeyD || keys.ArrowRight) ix += 1;
  if (joy.id !== null) { ix = joy.x; iy = -joy.y; }
  const mag = Math.min(1, Math.hypot(ix, iy));
  const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
  const mx = fx * iy - fz * ix, mz = fz * iy + fx * ix;
  const run = keys.ShiftLeft || keys.ShiftRight || runToggle;
  move(me, mx, mz, mag, run, dt);
  if (runToggle && me.st <= 1) { runToggle = false; $('b-run').classList.remove('on'); }
  if (iy > 0.3 && Math.abs(ix) < 0.5 && NOW() - lastCamInput > 1500) camYaw += angDiff(camYaw, me.yaw) * Math.min(1, dt * 1.1);
}

// ================= Нюх =================
const marks = []; // { x, z, y, html, t }
let smellCd = 0;
const markPool = [];
function smell() {
  if (NOW() < smellCd) return;
  smellCd = NOW() + 6000;
  sfx.sniff(1);
  $('smell-fx').classList.remove('on'); void $('smell-fx').offsetWidth; $('smell-fx').classList.add('on');
  marks.length = 0;
  const t = NOW(), R = 60 + 50 * me.scale;
  const w = world.findWater(me.x, me.z, 180);
  if (w) marks.push({ x: w[0], z: w[1], icon: '💧', cls: 'water', t });
  if (me.S.diet === 'carn') {
    const cs = world.carcasses.filter(c => c.active && c.meat > 0).map(c => ({ c, d: Math.hypot(c.x - me.x, c.z - me.z) })).filter(o => o.d < R * 2).sort((a, b) => a.d - b.d).slice(0, 4);
    for (const { c } of cs) marks.push({ x: c.x, z: c.z, icon: '🍖', cls: 'food', t });
  } else {
    const ps = world.near(world.pgrid, me.x, me.z, R * 0.8, p => p.food > 0.4).map(p => ({ p, d: Math.hypot(p.x - me.x, p.z - me.z) })).sort((a, b) => a.d - b.d).slice(0, 4);
    for (const { p } of ps) marks.push({ x: p.x, z: p.z, icon: '🌿', cls: 'food', t });
  }
  for (const e of ents) {
    if (e === me || e.isDead || dist(e, me) > R) continue;
    const danger = e.S.diet === 'carn' && e.mass > me.mass * 0.45 && e.sp !== me.sp && !isFriend(me, e);
    const friend = isFriend(me, e) || e.sp === me.sp;
    marks.push({ x: e.x, z: e.z, ent: e, icon: e.S.emoji, cls: danger ? 'danger' : friend ? 'friend' : 'prey', t, label: e.S.name });
  }
  const n = marks.length - 1;
  toast(`👃 Учуял: ${n > 0 ? n + ' запах(ов)' : 'ничего'}${w ? ', вода рядом' : ''}`);
}
const _v3 = new THREE.Vector3();
function drawMarks() {
  const t = NOW();
  let used = 0;
  for (const m of marks) {
    if (t - m.t > 9000) continue;
    if (m.ent) { if (m.ent.isDead || !ents.has(m.ent)) continue; m.x = m.ent.x; m.z = m.ent.z; }
    const y = height(m.x, m.z) + (m.ent ? m.ent.m.bodyY * m.ent.scale + 1.5 : 1.5);
    _v3.set(m.x, Math.max(y, WATER_Y + 1), m.z).project(camera);
    if (_v3.z > 1 || Math.abs(_v3.x) > 1 || Math.abs(_v3.y) > 1) continue; // за краем экрана — только на компасе
    let el = markPool[used];
    if (!el) { el = document.createElement('div'); el.className = 'mark'; $('marks').appendChild(el); markPool.push(el); }
    used++;
    const sx = (_v3.x + 1) / 2 * innerWidth, sy = (1 - _v3.y) / 2 * innerHeight;
    const d = Math.round(Math.hypot(m.x - me.x, m.z - me.z));
    el.className = 'mark ' + m.cls; el.style.transform = `translate(${sx}px,${sy}px)`;
    el.style.opacity = String(cl((9000 - (t - m.t)) / 1500));
    const html = `${m.icon}<small>${d} м</small>`;
    if (el._h !== html) { el.innerHTML = html; el._h = html; }
    el.style.display = '';
  }
  for (let i = used; i < markPool.length; i++) markPool[i].style.display = 'none';
}

// ================= Камера =================
const camTarget = new THREE.Vector3(), camWant = new THREE.Vector3();
let menuAngle = 0, viewT = 0, preview = null;
const focus = () => me || preview || { x: 0, z: 0 };
function updateCamera(dt) {
  if (window.__dbgCam) { const c = window.__dbgCam(); camera.position.set(...c[0]); camera.lookAt(...c[1]); return; }
  if (me && playing) {
    const L = me.len(), s = me.scale;
    const dist0 = (2.2 + L * 1.2) * camZoom, h = me.m.bodyY * s * 1.15 + 0.4;
    camTarget.set(me.x, me.y + h, me.z);
    const cp = Math.cos(camPitch);
    const cx = me.x - Math.sin(camYaw) * dist0 * cp, cz = me.z - Math.cos(camYaw) * dist0 * cp;
    const cy = Math.max(camTarget.y + Math.sin(camPitch) * dist0, height(cx, cz) + 0.6 + s * 0.4, WATER_Y + 0.5);
    camera.position.lerp(camWant.set(cx, cy, cz), Math.min(1, dt * 9));
    if (shake > 0.002) { camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; shake *= Math.exp(-dt * 8); }
    camera.lookAt(camTarget);
    viewT -= dt; if (viewT <= 0) { viewT = 0.12; world.clearView(camera.position, me.x, me.z, s); }
  } else if (preview) {
    menuAngle += dt * 0.18;
    const p = preview, L = p.len(), land = innerWidth > innerHeight, D = 3 + L * (land ? 1.15 : 1.6);
    camera.position.set(p.x + Math.sin(menuAngle) * D, p.y + L * 0.32 + 1, p.z + Math.cos(menuAngle) * D);
    camTarget.set(p.x, p.y + p.m.bodyY * p.scale * 0.9, p.z);
    if (land) { camTarget.x += Math.cos(menuAngle) * D * 0.42; camTarget.z -= Math.sin(menuAngle) * D * 0.42; } else camTarget.y -= L * 0.35;
    camera.lookAt(camTarget);
    viewT -= dt; if (viewT <= 0) { viewT = 0.2; world.clearView(camera.position, p.x, p.z, 1); }
  }
}

// ================= Интерфейс =================
function toast(t) { const el = $('toast'); el.textContent = t; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); }
function flashVignette() { const v = $('vignette'); v.classList.remove('hit'); void v.offsetWidth; v.classList.add('hit'); }
const setBar = (id, v) => { $(id).style.transform = `scaleX(${cl(v / 100)})`; };
let feedHint = null;
function updateHud() {
  if (!me) return;
  setBar('hp-f', me.hp / me.maxHP() * 100); setBar('st-f', me.st); setBar('fd-f', me.food); setBar('wt-f', me.water);
  $('v-hp').classList.toggle('low', me.hp / me.maxHP() < 0.3);
  $('v-fd').classList.toggle('low', me.food < 20); $('v-wt').classList.toggle('low', me.water < 20);
  const st = stageOf(me.g);
  $('stage').textContent = `${me.S.emoji} ${me.S.name} · ${STAGES[st]}`;
  $('gr-txt').textContent = me.g >= 1 ? 'Взрослый ★' : `Рост ${Math.floor(me.g * 100)}%`;
  setBar('gr-f', me.g * 100);
  $('gr-hint').textContent = me.g < 1 && (me.food <= 25 || me.water <= 25) ? '⏸ голоден — не растёшь' : '';
  const st2 = [];
  if (me.bleed > 0.05) st2.push('🩸 Кровотечение');
  if (me.fracture > 0) st2.push('🦴 Перелом');
  if (me.swim) st2.push('🌊 Плывёшь');
  if (me.resting) st2.push('💤 Отдых');
  const ps = packSize(); if (ps) st2.push(`🤝 Стая: ${ps}`);
  $('status').textContent = st2.join(' · ');
  // кнопка «Есть/Пить» появляется рядом с едой или водой
  const F = me.feeding || feedTarget(me);
  feedHint = F;
  const fb = $('b-feed');
  fb.classList.toggle('hidden', !F);
  if (F) { fb.querySelector('span').textContent = me.feeding ? '✋' : F.k === 'drink' ? '💧' : me.S.diet === 'carn' ? '🍖' : '🌿'; fb.querySelector('small').textContent = me.feeding ? 'Хватит' : F.k === 'drink' ? 'Пить' : 'Есть'; }
  $('b-rest').classList.toggle('on', me.resting);
  $('b-sp').classList.toggle('cd', me.scd > 0);
  $('sp-cd').textContent = me.scd > 0 ? Math.ceil(me.scd) : '';
  $('b-smell').classList.toggle('cd', NOW() < smellCd);
  const np = [...peers.values()].filter(t => NOW() - t < 5000).length;
  if (net) setNet(`🌐 ${np + 1}`);
}
// Компас сверху: стороны света, зовы и запахи
const cmp = $('compass'), cctx = cmp.getContext('2d');
function drawCompass() {
  const W = cmp.width = cmp.clientWidth * 2, H = cmp.height = cmp.clientHeight * 2;
  cctx.clearRect(0, 0, W, H);
  const fov = PI * 0.9, yaw = camYaw;
  const toX = a => W / 2 + angDiff(yaw, a) / fov * W;
  cctx.textAlign = 'center'; cctx.textBaseline = 'middle';
  const dirs = [['С', PI], ['СВ', PI * 0.75], ['В', PI / 2], ['ЮВ', PI * 0.25], ['Ю', 0], ['ЮЗ', -PI * 0.25], ['З', -PI / 2], ['СЗ', -PI * 0.75]];
  for (let i = 0; i < 36; i++) { const a = i / 36 * TAU, x = toX(a); if (x < 0 || x > W) continue; cctx.fillStyle = 'rgba(255,255,255,.45)'; cctx.fillRect(x - 1, H * 0.62, 2, i % 3 ? H * 0.12 : H * 0.22); }
  cctx.font = `bold ${H * 0.36}px system-ui,sans-serif`;
  for (const [t, a] of dirs) { const x = toX(-a + PI); if (x < -20 || x > W + 20) continue; cctx.fillStyle = t === 'С' ? '#ff7a5c' : '#fff'; cctx.fillText(t, x, H * 0.32); }
  const t = NOW();
  cctx.font = `${H * 0.44}px system-ui,sans-serif`;
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i], age = t - c.t;
    if (age > 12000) { calls.splice(i, 1); continue; }
    const a = Math.atan2(c.x - me.x, c.z - me.z), x = toX(a);
    if (x < 0 || x > W) continue;
    cctx.globalAlpha = cl((12000 - age) / 3000);
    cctx.fillStyle = c.friend ? 'rgba(80,220,120,.5)' : 'rgba(255,90,70,.5)';
    cctx.beginPath(); cctx.arc(x, H * 0.5, H * 0.34, 0, TAU); cctx.fill();
    cctx.fillText(SPECIES[c.sp].emoji, x, H * 0.52);
    cctx.globalAlpha = 1;
  }
  for (const m of marks) {
    if (t - m.t > 9000) continue;
    const x = toX(Math.atan2(m.x - me.x, m.z - me.z)); if (x < 0 || x > W) continue;
    cctx.globalAlpha = cl((9000 - (t - m.t)) / 1500) * 0.85; cctx.font = `${H * 0.3}px system-ui,sans-serif`;
    cctx.fillText(m.icon, x, H * 0.84); cctx.globalAlpha = 1;
  }
}
// Карта
let mapOpen = false;
function toggleMap() { mapOpen = !mapOpen; $('map').classList.toggle('hidden', !mapOpen); if (mapOpen) drawMap(); }
function drawMap() {
  const cv = $('map-c'), S = Math.min(innerWidth, innerHeight) * 0.86 * (devicePixelRatio > 1 ? 2 : 1);
  cv.width = cv.height = S; cv.style.width = cv.style.height = (Math.min(innerWidth, innerHeight) * 0.86) + 'px';
  const c = cv.getContext('2d'); c.imageSmoothingEnabled = true;
  c.drawImage(world.mapImage(), 0, 0, S, S);
  const P = (x, z) => [(x / MAP_R / 2 + 0.5) * S, (z / MAP_R / 2 + 0.5) * S];
  c.font = `${S * 0.04}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle';
  for (const b of ents) if (b.ai && b.leader === me && !b.isDead) { const [x, y] = P(b.x, b.z); c.fillStyle = '#5be37a'; c.beginPath(); c.arc(x, y, S * 0.012, 0, TAU); c.fill(); }
  for (const r of remotes.values()) { const [x, y] = P(r.x, r.z); c.fillStyle = '#ffd34d'; c.beginPath(); c.arc(x, y, S * 0.012, 0, TAU); c.fill(); }
  if (me) {
    const [x, y] = P(me.x, me.z);
    c.save(); c.translate(x, y); c.rotate(-me.yaw + PI);
    c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = S * 0.004;
    c.beginPath(); c.moveTo(0, -S * 0.03); c.lineTo(S * 0.02, S * 0.02); c.lineTo(-S * 0.02, S * 0.02); c.closePath(); c.fill(); c.stroke();
    c.restore();
  }
  c.fillStyle = '#ff7a5c'; c.font = `bold ${S * 0.05}px system-ui`; c.fillText('С', S / 2, S * 0.04);
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
$('b-full').addEventListener('pointerdown', e => { e.stopPropagation(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else goLandscape(); });
if (!document.documentElement.requestFullscreen) $('b-full').classList.add('hidden');

// ================= Меню =================
let chosen = localStorage.getItem('era_sp') || 'dryo';
if (!SPECIES[chosen]) chosen = 'dryo';
online = localStorage.getItem('era_online') !== '0';
roomName = (new URLSearchParams(location.search).get('room') || 'world').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'WORLD';
$('nick').value = localStorage.getItem('era_nick') || '';
const PREVIEW_AT = (() => { for (let r = 30; r < 200; r += 7) for (let a = 0; a < 16; a++) { const x = 95 + Math.cos(a) * r * 0.4, z = -105 + Math.sin(a) * r * 0.4 + 40; if (height(x, z) > WATER_Y + 0.8 && height(x, z) < 6) return [x, z]; } return [60, -40]; })();
function setPreview(sp) {
  if (preview) preview.dispose();
  preview = new Dino(sp, { g: 1, x: PREVIEW_AT[0], z: PREVIEW_AT[1], yaw: 0.6 });
  preview.preview = true; ents.delete(preview);
  placeOnGround(preview, 1);
  preview.nextAct = 1.5;
}
function renderCards() {
  $('cards').innerHTML = SP_KEYS.map(k => {
    const S = SPECIES[k];
    return `<button class="card ${k === chosen ? 'sel' : ''}" data-k="${k}"><span class="em">${S.emoji}</span><b>${S.name}</b><small class="${S.diet}">${S.diet === 'carn' ? '🥩 Хищник' : '🌿 Травоядный'}</small></button>`;
  }).join('');
  const S = SPECIES[chosen];
  const bar = (label, v) => `<div class="stat"><span>${label}</span><i><b style="width:${Math.round(cl(v) * 100)}%"></b></i></div>`;
  $('desc').innerHTML = `<p>${S.info}</p>
    ${bar('Здоровье', S.hp / 1600)}${bar('Сила', S.dmg / 210)}${bar('Скорость', S.sprint / 13.5)}${bar('Рост', 8 / S.grow)}
    <p class="sp">⚔️ ${S.atk} · ⚡ ${S.spec}: ${S.specInfo}</p>`;
  for (const b of document.querySelectorAll('.card')) b.onclick = () => { chosen = b.dataset.k; localStorage.setItem('era_sp', chosen); renderCards(); setPreview(chosen); };
  $('m-online').classList.toggle('on', online); $('m-solo').classList.toggle('on', !online);
  const save = loadSave();
  $('continue').classList.toggle('hidden', !save);
  if (save) $('continue').innerHTML = `▶ Продолжить: ${SPECIES[save.sp].emoji} ${SPECIES[save.sp].name} · ${STAGES[stageOf(save.g)]} ${Math.floor(save.g * 100)}%`;
}
$('m-online').onclick = () => { online = true; localStorage.setItem('era_online', '1'); renderCards(); };
$('m-solo').onclick = () => { online = false; localStorage.setItem('era_online', '0'); renderCards(); };
$('play').onclick = () => startGame(null);
$('continue').onclick = () => startGame(loadSave());
$('again').onclick = () => { $('death').classList.add('hidden'); startGame(null); };
$('to-menu').onclick = () => { $('death').classList.add('hidden'); toMenu(); };
$('b-menu').addEventListener('pointerdown', e => { e.stopPropagation(); if (me && !me.isDead) save(); toMenu(); });

function loadSave() { try { const s = JSON.parse(localStorage.getItem('era_save')); return s && SPECIES[s.sp] ? s : null; } catch (e) { return null; } }
function save() {
  if (!me || me.isDead) return;
  try { localStorage.setItem('era_save', JSON.stringify({ sp: me.sp, g: me.g, hp: me.hp / me.maxHP(), food: me.food, water: me.water, x: me.x, z: me.z, yaw: me.yaw, t: Date.now() })); } catch (e) { /* нет хранилища */ }
}
addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

function spawnPoint() {
  for (let t = 0; t < 80; t++) {
    const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * (MAP_R - 50), x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (height(x, z) < WATER_Y + 1 || height(x, z) > 10) continue;
    if (!world.findWater(x, z, 70)) continue; // рядом с водой — у детёныша есть шанс
    let ok = true; for (const e of ents) if (e.S.diet === 'carn' && e.mass > 300 && Math.hypot(e.x - x, e.z - z) < 60) ok = false;
    if (ok) return [x, z];
  }
  return [0, 0];
}
function startGame(sv) {
  initAudio();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  goLandscape();
  myName = ($('nick').value.trim() || 'Ящер' + Math.floor(Math.random() * 900 + 100)).slice(0, 14);
  localStorage.setItem('era_nick', $('nick').value.trim());
  if (me) { if (!me.isDead) me.dispose(); me = null; }
  if (preview) { preview.dispose(); preview = null; }
  const sp = sv ? sv.sp : chosen;
  const [x, z] = sv ? [sv.x, sv.z] : spawnPoint();
  me = new Dino(sp, { g: sv ? sv.g : 0, x, z, yaw: sv ? sv.yaw : Math.random() * TAU, food: sv ? sv.food : 80, water: sv ? sv.water : 80, name: myName });
  me.name = myName;
  if (sv) me.hp = cl(sv.hp, 0.1, 1) * me.maxHP();
  camYaw = me.yaw; camPitch = 0.3;
  // в начале мира есть немного жизни вокруг
  for (let i = 0; i < 5; i++) spawnGroup(true);
  playing = true; lifeStart = NOW(); document.body.classList.add('playing');
  $('atk-name').textContent = me.S.atk; $('sp-name').textContent = me.S.spec;
  $('b-atk').querySelector('span').textContent = { rex: '🦷', carno: '🦷', deino: '🗡️', trike: '🔱', stego: '🌵', dryo: '🦶' }[me.sp];
  $('menu').classList.add('hidden'); $('hud').classList.remove('hidden');
  marks.length = 0; calls.length = 0;
  if (online) startNet(); else { if (net) { net.leave(); net = null; } setNet('🏝 Один'); }
  toast(sv ? 'С возвращением!' : `Ты вылупился! Найди воду 💧 и еду ${me.S.diet === 'carn' ? '🍖' : '🌿'}`);
  setTimeout(() => { if (me && !me.isDead && !sv) toast('👃 Нюхай, чтобы найти воду и еду. Ешь и пей — так растёшь'); }, 4500);
}
let lifeStart = 0;
function showDeath() {
  if (!me || !me.isDead) return;
  playing = false; document.body.classList.remove('playing');
  const mins = Math.floor((NOW() - lifeStart) / 60000), secs = Math.floor((NOW() - lifeStart) / 1000) % 60;
  $('death-by').textContent = deathCause;
  $('death-stats').innerHTML = `Прожил: <b>${mins} мин ${secs} с</b><br>Достиг: <b>${STAGES[stageOf(me.g)]}</b> (${Math.floor(me.g * 100)}%)`;
  $('hud').classList.add('hidden'); $('death').classList.remove('hidden');
  me = null;
}
function toMenu() {
  playing = false; document.body.classList.remove('playing');
  if (me && !me.isDead) me.dispose();
  me = null;
  for (const e of [...ents]) if (e.ai) e.dispose();
  $('hud').classList.add('hidden'); $('menu').classList.remove('hidden');
  setPreview(chosen); renderCards();
}

// ================= Главный цикл =================
let last = NOW(), fpsAcc = 0, fpsFrames = 0, hudT = 0, sendT = 0, saveT = 0, skyT = 0;
function frame() {
  requestAnimationFrame(frame);
  const now = NOW(), dt = Math.min(0.05, (now - last) / 1000); last = now;
  const time = now / 1000;
  if (playing && me && !me.isDead) { updatePlayer(dt); tickFeeding(me, dt); tickVitals(me, dt); }
  if (playing) manageAI(dt);
  for (const e of [...ents]) {
    if (e === me) { tickAct(e, dt); }
    else if (e.ai) {
      const far = me && dist(e, me) > 150;
      if (!e.isDead) {
        if (far) { e.farT = (e.farT || 0) + dt; if (e.farT > 0.5) { updateAI(e, e.farT); tickVitals(e, e.farT); e.farT = 0; } }
        else { updateAI(e, dt); tickFeeding(e, dt); tickVitals(e, dt); tickAct(e, dt); }
      }
    } else if (e.remote) { updateRemote(e, dt); }
    if (ents.has(e)) e.visual(dt, time);
  }
  // мягко расталкиваем динозавров, чтобы не проходили сквозь друг друга
  separate();
  if (preview) {
    preview.nextAct -= dt;
    if (preview.nextAct <= 0) { const k = ['call', 'bite', 'eat', 'bite'][Math.floor(Math.random() * 4)]; preview.act = { k, t: 0, d: k === 'eat' ? 2.5 : k === 'call' ? 1.6 : 0.8, side: 1, done: true }; if (k === 'call') sfx.call(pitchOf(preview), 0.4); preview.nextAct = 3 + Math.random() * 2; }
    if (preview.act) { preview.act.t += dt; if (preview.act.t >= preview.act.d) preview.act = null; }
    preview.visual(dt, time);
  }
  updateCorpses(dt, time);
  world.update(dt);
  updateParticles(dt);
  updateCamera(dt);
  skyT -= dt; if (skyT <= 0) { skyT = 0.5; updateSky(); if (playing) sfx.ambient(isNight); }
  if (playing && me) {
    drawCompass(); drawMarks();
    hudT -= dt; if (hudT <= 0) { hudT = 0.2; updateHud(); if (mapOpen) drawMap(); }
    sendT -= dt; if (sendT <= 0) { sendT = 0.12; sendState(); }
    saveT -= dt; if (saveT <= 0) { saveT = 5; save(); }
  }
  renderer.render(scene, camera);
  fpsAcc += dt; fpsFrames++;
  if (fpsAcc > 2) {
    const fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0;
    if (fps < 40 && pixelRatio > 0.7) {
      pixelRatio = Math.max(0.7, pixelRatio - 0.15); renderer.setPixelRatio(pixelRatio);
      if (fps < 28) { scene.userData.far = 140; camera.far = 150; camera.updateProjectionMatrix(); }
    }
    $('fps').textContent = Math.round(fps) + ' FPS';
  }
}
function separate() {
  const list = [...ents];
  for (let i = 0; i < list.length; i++) {
    const a = list[i]; if (a.isDead || a.leap) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j]; if (b.isDead || b.leap) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), m = (a.radius() + b.radius()) * 0.55;
      if (d < m && d > 0.001) {
        const push = (m - d), wa = b.mass / (a.mass + b.mass), wb = 1 - wa;
        if (a.local) { a.x -= dx / d * push * wa; a.z -= dz / d * push * wa; }
        if (b.local) { b.x += dx / d * push * wb; b.z += dz / d * push * wb; }
      }
    }
  }
}

setPreview(chosen); renderCards(); updateSky();
await boot(100, 'Готово!');
document.body.classList.add('ready');
$('loading').classList.add('hidden');
requestAnimationFrame(frame);
// для отладки
window.__game = { ents, world, SPECIES, get me() { return me; }, camera, attack, doCall, smell, kill, spawnGroup, startGame, setTime(t) { window.__tod = t; },
  get preview() { return preview; }, handlers, remotes,
  spawnAt(sp, g, x, z) { const b = new Dino(sp, { ai: true, g, x, z, food: 30 }); b.state = 'wander'; b.think = 0; return b; }, feedTarget, height, depthAt,
  cam(y, p) { camYaw = y; camPitch = p; lastCamInput = NOW() + 1e9; }, toggleMap, setPreview, renderer };
