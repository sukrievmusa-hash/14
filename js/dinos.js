// Динозавры: виды, характеристики, модели (собраны из простых фигур) и анимация.
// Все модели нарисованы в коде — никаких чужих моделей и текстур.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const PI = Math.PI, TAU = PI * 2;
export const SKIN = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
export const HURT = new THREE.MeshLambertMaterial({ color: 0xff6a50, emissive: 0x551010, flatShading: true });

// ---------------- Виды ----------------
// Числа — для взрослой особи. Скорости в м/с, время роста в минутах.
export const SPECIES = {
  rex: {
    name: 'Тираннозавр', emoji: '🦖', diet: 'carn', mass: 8000, grow: 24,
    hp: 1600, dmg: 210, bleed: 1.6, reach: 3.4, cd: 1.3, walk: 2.4, trot: 5.2, sprint: 8.6, turn: 1.25, stam: 0.9,
    atk: 'Укус', spec: 'Сокрушить', specInfo: 'Мощный укус: ломает кость — жертва хромает',
    info: 'Король хищников. Медленно растёт, медленно разворачивается, но один укус взрослого решает исход боя.',
    hatch: 0.17, call: 0.45,
  },
  carno: {
    name: 'Карнотавр', emoji: '🐂', diet: 'carn', mass: 1500, grow: 15,
    hp: 820, dmg: 105, bleed: 1.0, reach: 2.4, cd: 0.95, walk: 2.6, trot: 6.4, sprint: 12.5, turn: 1.9, stam: 1.0,
    atk: 'Укус', spec: 'Таран', specInfo: 'Разгон и удар рогатой головой — отбрасывает врага',
    info: 'Самый быстрый крупный хищник. Догоняет почти всех, но плохо поворачивает на бегу.',
    hatch: 0.22, call: 0.7,
  },
  deino: {
    name: 'Дейноних', emoji: '🦅', diet: 'carn', mass: 80, grow: 9,
    hp: 230, dmg: 34, bleed: 2.4, reach: 1.1, cd: 0.55, walk: 2.0, trot: 5.0, sprint: 11.5, turn: 4.2, stam: 1.15,
    atk: 'Коготь', spec: 'Прыжок', specInfo: 'Прыжок на добычу с серповидными когтями — сильное кровотечение',
    info: 'Маленький охотник в перьях. Охотится стаей, прыгает на добычу и пускает ей кровь.',
    hatch: 0.3, call: 1.5,
  },
  trike: {
    name: 'Трицератопс', emoji: '🦏', diet: 'herb', mass: 6000, grow: 20,
    hp: 1500, dmg: 130, bleed: 1.2, reach: 3.0, cd: 1.2, walk: 2.0, trot: 4.6, sprint: 8.0, turn: 1.3, stam: 0.9,
    atk: 'Рога', spec: 'Атака', specInfo: 'Разгон и удар рогами — огромный урон с разбега',
    info: 'Травоядный танк. Не убегает — встречает хищника рогами и щитом-воротником.',
    hatch: 0.18, call: 0.55,
  },
  stego: {
    name: 'Стегозавр', emoji: '🦕', diet: 'herb', mass: 4200, grow: 17,
    hp: 1300, dmg: 150, bleed: 2.2, reach: 3.6, cd: 1.15, walk: 1.8, trot: 3.8, sprint: 6.4, turn: 1.4, stam: 0.85,
    atk: 'Хвост', spec: 'Вихрь', specInfo: 'Разворот с хвостом — шипы бьют всех вокруг',
    info: 'Медленный, но опасный сзади: шипы на хвосте рвут хищников. Атакует хвостом назад и в стороны.',
    hatch: 0.19, call: 0.6, tailAtk: true,
  },
  dryo: {
    name: 'Дриозавр', emoji: '🦎', diet: 'herb', mass: 90, grow: 8,
    hp: 170, dmg: 20, bleed: 0.3, reach: 1.0, cd: 0.6, walk: 2.2, trot: 5.6, sprint: 13.2, turn: 4.6, stam: 1.3,
    atk: 'Пинок', spec: 'Рывок', specInfo: 'Резкий рывок: на 2 секунды почти не тратишь силы',
    info: 'Маленький и самый быстрый. Выживает за счёт скорости, слуха и умения вовремя убежать.',
    hatch: 0.32, call: 1.7,
  },
};
export const SP_KEYS = Object.keys(SPECIES);

// ---------------- Рост ----------------
export const STAGES = ['Детёныш', 'Юнец', 'Подросток', 'Взрослый'];
export const stageOf = g => (g >= 1 ? 3 : g >= 0.6 ? 2 : g >= 0.25 ? 1 : 0);
export const scaleOf = (S, g) => S.hatch + (1 - S.hatch) * Math.min(1, g);
export const massOf = (S, g) => S.mass * scaleOf(S, g) ** 3;
export const statK = g => 0.12 + 0.88 * Math.min(1, g); // сила и здоровье растут вместе с особью

// ---------------- Детали моделей ----------------
const _q = new THREE.Quaternion(), _Y = new THREE.Vector3(0, 1, 0), _dv = new THREE.Vector3(), _e = new THREE.Euler();
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
function fin(g) { g = g.index ? g.toNonIndexed() : g; if (g.attributes.uv) g.deleteAttribute('uv'); return g; }
function ell(r, pos, rot = [0, 0, 0], seg = [9, 6]) {
  const g = new THREE.SphereGeometry(1, seg[0], seg[1]);
  g.scale(r[0], r[1], r[2]); g.applyQuaternion(_q.setFromEuler(_e.set(rot[0], rot[1], rot[2]))); g.translate(pos[0], pos[1], pos[2]);
  return fin(g);
}
function tube(a, b, r0, r1, seg = 7) {
  _dv.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _dv.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
  g.translate(0, len / 2, 0); g.applyQuaternion(_q.setFromUnitVectors(_Y, _dv.normalize())); g.translate(a[0], a[1], a[2]);
  return fin(g);
}
// конус от точки a к точке b (основание в a)
function spike(a, b, r, seg = 5) {
  _dv.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _dv.length();
  const g = new THREE.ConeGeometry(r, len, seg);
  g.translate(0, len / 2, 0); g.applyQuaternion(_q.setFromUnitVectors(_Y, _dv.normalize())); g.translate(a[0], a[1], a[2]);
  return fin(g);
}

// Раскраска: тёмная спина → светлое брюхо, полосы или пятна. Цвет — на всю грань (низкополигональный вид).
const _c = new THREE.Color(), _c2 = new THREE.Color();
const u0 = (y, h) => y < h * 0.12;
function paint(g, P, fixed, limb) {
  const pos = g.attributes.position, n = pos.count, col = new Float32Array(n * 3);
  const back = new THREE.Color(P.back), belly = new THREE.Color(P.belly), mark = new THREE.Color(P.mark || P.back);
  for (let i = 0; i < n; i += 3) {
    if (fixed) _c.set(fixed);
    else {
      const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
      const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
      const z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
      let t = (y - P.yLo) / (P.yHi - P.yLo); t = t < 0 ? 0 : t > 1 ? 1 : t; t = t * t * (3 - 2 * t);
      if (limb) { const u = y / (limb + 1e-3); t = 0.45 + 0.4 * (u > 1 ? 1 : u < 0 ? 0 : u); if (u < 0.12) t = 0.2; }
      _c.copy(belly).lerp(back, t);
      if (limb && u0(y, limb)) _c.lerp(mark, 0.35);
      if (P.stripes && t > 0.35 && Math.sin(z * P.stripes + Math.abs(x) * 0.6) > 0.45) _c.lerp(mark, 0.75);
      if (P.spots) { const h = Math.sin(Math.floor(x * P.spots) * 12.9898 + Math.floor(y * P.spots) * 78.233 + Math.floor(z * P.spots) * 37.719) * 43758.5; if (h - Math.floor(h) > 0.8 && t > 0.3) _c.lerp(mark, 0.8); }
      // лёгкий шум, чтобы грани не были одинаковыми
      const s = Math.sin(i * 12.9898) * 43758.5453; _c.offsetHSL(0, 0, ((s - Math.floor(s)) - 0.5) * 0.05);
    }
    for (let k = 0; k < 3; k++) { col[(i + k) * 3] = _c.r; col[(i + k) * 3 + 1] = _c.g; col[(i + k) * 3 + 2] = _c.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// ---------------- Скелет ----------------
// Модель описывается в «модельных» координатах (метры, взрослая особь), потом каждая часть
// переносится к своему шарниру. Шарниры: body → neck → head → jaw; body → tail0 → tail1 → tail2; body → ноги (бедро → колено).
function skeleton() {
  return { parts: { body: [], neck: [], head: [], jaw: [], tail0: [], tail1: [], tail2: [] }, piv: {}, legs: [] };
}
function put(sk, grp, g, fixed) { sk.parts[grp].push({ g, fixed }); }
function legPut(leg, lo, g, fixed) { (lo ? leg.lo : leg.up).push({ g, fixed }); }

function head(sk, P, N, h) {
  // h: { L, H, W, carn, beak }
  sk.piv.head = N;
  const skull = add3(N, [0, h.H * 0.08, h.L * 0.3]);
  put(sk, 'head', ell([h.W * 0.5, h.H * 0.5, h.L * 0.42], skull));
  put(sk, 'head', ell([h.W * 0.36, h.H * 0.34, h.L * 0.32], add3(N, [0, -h.H * 0.02, h.L * 0.72]), [0.08, 0, 0]));
  // глаза и надбровья
  for (const s of [-1, 1]) {
    put(sk, 'head', ell([h.W * 0.09, h.H * 0.1, h.W * 0.09], add3(N, [s * h.W * 0.44, h.H * 0.24, h.L * 0.42]), [0, 0, 0], [6, 4]), '#121212');
    put(sk, 'head', ell([h.W * 0.14, h.H * 0.08, h.L * 0.12], add3(N, [s * h.W * 0.38, h.H * 0.36, h.L * 0.42])));
    put(sk, 'head', ell([h.W * 0.05, h.H * 0.05, h.W * 0.05], add3(N, [s * h.W * 0.18, h.H * 0.12, h.L * 0.98]), [0, 0, 0], [5, 3]), '#1c1a18');
  }
  const J = add3(N, [0, -h.H * 0.26, h.L * 0.08]);
  sk.piv.jaw = J;
  put(sk, 'jaw', ell([h.W * 0.34, h.H * 0.16, h.L * 0.46], add3(J, [0, -h.H * 0.06, h.L * 0.46])));
  if (h.carn) {
    // зубы сверху и снизу
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
      const z = h.L * (0.42 + i * 0.13), x = s * h.W * (0.3 - i * 0.03);
      put(sk, 'head', spike(add3(N, [x, -h.H * 0.22, z]), add3(N, [x, -h.H * 0.36, z + 0.02]), h.W * 0.05, 4), '#efe8d4');
      put(sk, 'jaw', spike(add3(J, [x * 0.9, -h.H * 0.02, z - h.L * 0.06]), add3(J, [x * 0.9, h.H * 0.11, z - h.L * 0.04]), h.W * 0.04, 4), '#efe8d4');
    }
  }
  if (h.beak) {
    put(sk, 'head', spike(add3(N, [0, -h.H * 0.08, h.L * 0.86]), add3(N, [0, -h.H * 0.24, h.L * 1.12]), h.W * 0.24, 5), h.beak);
    put(sk, 'jaw', spike(add3(J, [0, -h.H * 0.02, h.L * 0.78]), add3(J, [0, h.H * 0.02, h.L * 1.0]), h.W * 0.18, 5), h.beak);
  }
}

function tail(sk, T0, L, R, droop = 0.12) {
  const ks = [0.36, 0.34, 0.3], rs = [R, R * 0.62, R * 0.32, R * 0.07];
  let a = T0;
  for (let i = 0; i < 3; i++) {
    sk.piv['tail' + i] = a;
    const b = add3(a, [0, -L * ks[i] * droop * (i === 0 ? 1.2 : 0.4), -L * ks[i]]);
    put(sk, 'tail' + i, tube(a, b, rs[i], rs[i + 1], 7));
    if (i < 2) put(sk, 'tail' + i, ell([rs[i + 1], rs[i + 1], rs[i + 1]], b, [0, 0, 0], [7, 5]));
    a = b;
  }
  sk.tailEnd = a;
}
// точка на хвосте по доле длины (0 — основание, 1 — кончик): нужна для шипов и пластин
function tailPoint(sk, u) {
  const p = [sk.piv.tail0, sk.piv.tail1, sk.piv.tail2, sk.tailEnd];
  const ks = [0.36, 0.34, 0.3];
  let acc = 0;
  for (let i = 0; i < 3; i++) {
    if (u <= acc + ks[i] || i === 2) { const k = Math.min(1, (u - acc) / ks[i]); return { grp: 'tail' + i, p: [p[i][0] + (p[i + 1][0] - p[i][0]) * k, p[i][1] + (p[i + 1][1] - p[i][1]) * k, p[i][2] + (p[i + 1][2] - p[i][2]) * k] }; }
    acc += ks[i];
  }
}

// ---------- Двуногие ----------
function biped(p) {
  const sk = skeleton();
  const { hip, bl, bw, bh, bz } = p;
  sk.piv.body = [0, hip, 0];
  const ty = hip + bh * 0.12;
  put(sk, 'body', ell([bw / 2, bh / 2, bl / 2], [0, ty, bz], [-0.06, 0, 0], [10, 7]));
  put(sk, 'body', ell([bw * 0.44, bh * 0.42, bl * 0.3], [0, hip + bh * 0.05, bz - bl * 0.3]));        // таз
  put(sk, 'body', ell([bw * 0.36, bh * 0.38, bl * 0.28], [0, ty + bh * 0.06, bz + bl * 0.36], [-0.3, 0, 0])); // грудь
  const C = [0, ty + bh * 0.18, bz + bl * 0.42];
  const N = add3(C, [0, Math.sin(p.neckA) * p.neckL, Math.cos(p.neckA) * p.neckL]);
  sk.piv.neck = C;
  put(sk, 'neck', tube(C, N, p.neckR * 1.25, p.neckR, 8));
  put(sk, 'neck', ell([p.neckR * 1.05, p.neckR * 1.05, p.neckR * 1.05], N, [0, 0, 0], [7, 5]));
  head(sk, p, N, { L: p.headL, H: p.headH, W: p.headW, carn: p.carn, beak: p.beak });
  tail(sk, [0, hip + bh * 0.1, bz - bl * 0.45], p.tailL, p.tailR, 0.1);
  // ручки
  for (const s of [-1, 1]) {
    const S = [s * bw * 0.36, ty - bh * 0.12, bz + bl * 0.38], E = add3(S, [s * 0.03, -p.armL * 0.38, p.armL * 0.22]), Hd = add3(E, [0, -p.armL * 0.08, p.armL * 0.45]);
    sk.arm = sk.arm || {}; sk.arm[s] = [S, E, Hd];
    put(sk, 'body', tube(S, E, p.armR, p.armR * 0.8, 5));
    put(sk, 'body', tube(E, Hd, p.armR * 0.8, p.armR * 0.5, 5));
    for (const d of [-1, 1]) put(sk, 'body', spike(Hd, add3(Hd, [d * p.armR * 0.6, -p.armL * 0.12, p.armL * 0.16]), p.armR * 0.3, 4), '#2b2622');
  }
  // ноги: бедро → колено (вперёд) → голень назад → плюсна вниз → пальцы
  for (const s of [-1, 1]) {
    const H = [s * bw * 0.4, hip, 0];
    const K = add3(H, [s * 0.01, -0.45 * hip, 0.17 * hip]);
    const A = add3(K, [0, -0.4 * hip, -0.25 * hip]);
    const F = add3(A, [0, -0.15 * hip, 0.08 * hip]);
    const leg = { hip: H, knee: K, up: [], lo: [], ph: s > 0 ? 0 : PI, front: false };
    legPut(leg, 0, ell([p.legW * 0.95, hip * 0.3, p.legW * 1.7], add3(H, [0, -hip * 0.1, hip * 0.02]), [-0.35, 0, 0]));
    legPut(leg, 0, tube(add3(H, [0, -hip * 0.2, 0]), K, p.legW * 0.8, p.legW * 0.55, 6));
    legPut(leg, 1, ell([p.legW * 0.55, p.legW * 0.55, p.legW * 0.55], K, [0, 0, 0], [6, 4]));
    legPut(leg, 1, tube(K, A, p.legW * 0.55, p.legW * 0.32, 6));
    legPut(leg, 1, tube(A, add3(F, [0, 0.02, 0]), p.legW * 0.32, p.legW * 0.26, 5));
    for (const d of [-1, 0, 1]) legPut(leg, 1, spike(add3(F, [0, 0.03 * hip, 0]), add3(F, [d * p.legW * 0.55, 0.005, p.legW * (d ? 0.9 : 1.15)]), p.legW * 0.16, 4));
    if (p.sickle) legPut(leg, 1, spike(add3(F, [0, 0.06 * hip, 0.02]), add3(F, [0, 0.16 * hip, p.legW * 1.1]), p.legW * 0.14, 4), '#2b2622');
    sk.legs.push(leg);
  }
  return sk;
}

// ---------- Четвероногие ----------
function quad(p) {
  const sk = skeleton();
  const { hip, sh, bl, bw, bh, bz } = p;
  const midY = (hip + sh) / 2 + bh * 0.12, tilt = Math.atan((hip - sh) / bl) * 0.8;
  sk.piv.body = [0, midY - bh * 0.12, 0];
  put(sk, 'body', ell([bw / 2, bh / 2, bl / 2], [0, midY, bz], [tilt, 0, 0], [10, 8]));
  put(sk, 'body', ell([bw * 0.42, bh * 0.4, bl * 0.28], [0, hip + bh * 0.08, bz - bl * 0.32]));
  const C = [0, sh + bh * 0.12, bz + bl * 0.44];
  const N = add3(C, [0, Math.sin(p.neckA) * p.neckL, Math.cos(p.neckA) * p.neckL]);
  sk.piv.neck = C;
  put(sk, 'neck', tube(C, N, p.neckR * 1.2, p.neckR, 8));
  head(sk, p, N, { L: p.headL, H: p.headH, W: p.headW, beak: p.beak });
  tail(sk, [0, hip + bh * 0.08, bz - bl * 0.46], p.tailL, p.tailR, 0.14);
  const legsDef = [
    { z: bz - bl * 0.28, y: hip, front: false, w: p.legW },
    { z: bz + bl * 0.3, y: sh, front: true, w: p.legW * 0.85 },
  ];
  for (const L of legsDef) for (const s of [-1, 1]) {
    const H = [s * bw * 0.38, L.y, L.z];
    const K = add3(H, [s * 0.02, -0.5 * L.y, L.front ? -0.06 * L.y : 0.1 * L.y]);
    const F = add3(K, [s * 0.01, -0.5 * L.y + 0.06, L.front ? 0.06 * L.y : -0.1 * L.y]);
    // диагональная рысь: левый-передний с правым-задним
    const leg = { hip: H, knee: K, up: [], lo: [], ph: (s > 0) === L.front ? 0 : PI, front: L.front };
    legPut(leg, 0, ell([L.w * 1.0, L.y * 0.32, L.w * 1.35], add3(H, [0, -L.y * 0.2, 0]), [L.front ? 0.1 : -0.15, 0, 0]));
    legPut(leg, 0, tube(add3(H, [0, -L.y * 0.25, 0]), K, L.w * 0.8, L.w * 0.65, 6));
    legPut(leg, 1, tube(K, F, L.w * 0.65, L.w * 0.55, 6));
    legPut(leg, 1, ell([L.w * 0.75, 0.06 + L.w * 0.25, L.w * 0.85], add3(F, [0, 0.03, L.w * 0.15]), [0, 0, 0], [7, 4]));
    for (const d of [-1, 0, 1]) legPut(leg, 1, ell([L.w * 0.16, L.w * 0.14, L.w * 0.2], add3(F, [d * L.w * 0.42, 0.02, L.w * 0.85]), [0, 0, 0], [5, 3]), '#3a332b');
    sk.legs.push(leg);
  }
  return sk;
}

// ---------- Внешность каждого вида ----------
const MODELS = {
  rex() {
    const p = { hip: 3.0, bl: 4.8, bw: 2.0, bh: 2.5, bz: 0.4, neckL: 1.3, neckR: 0.62, neckA: 0.45, headL: 1.7, headH: 0.9, headW: 0.78,
      tailL: 5.8, tailR: 0.78, legW: 0.56, armL: 0.75, armR: 0.13, carn: true };
    const sk = biped(p);
    sk.pal = { back: '#5b4a33', belly: '#cdb894', mark: '#3c2f20', yLo: 2.4, yHi: 4.1, stripes: 2.1 };
    sk.len = 11; sk.r = 2.2;
    return sk;
  },
  carno() {
    const p = { hip: 2.1, bl: 3.1, bw: 1.2, bh: 1.55, bz: 0.3, neckL: 1.05, neckR: 0.36, neckA: 0.5, headL: 0.85, headH: 0.58, headW: 0.48,
      tailL: 4.0, tailR: 0.46, legW: 0.34, armL: 0.32, armR: 0.07, carn: true };
    const sk = biped(p);
    const N = sk.piv.head;
    for (const s of [-1, 1]) put(sk, 'head', spike(add3(N, [s * 0.18, 0.32, 0.32]), add3(N, [s * 0.42, 0.62, 0.18]), 0.09, 5), '#2c2420');
    for (let i = 0; i < 6; i++) put(sk, 'body', ell([0.08, 0.06, 0.1], [0, 2.6 - i * 0.02, 1.2 - i * 0.5], [0, 0, 0], [5, 3]), '#4a1e16');
    sk.pal = { back: '#8a3a25', belly: '#d8b48a', mark: '#4a1e16', yLo: 1.6, yHi: 2.9, stripes: 3.2 };
    sk.len = 8; sk.r = 1.4;
    return sk;
  },
  deino() {
    const p = { hip: 0.86, bl: 1.15, bw: 0.42, bh: 0.55, bz: 0.08, neckL: 0.55, neckR: 0.12, neckA: 0.85, headL: 0.4, headH: 0.21, headW: 0.18,
      tailL: 1.7, tailR: 0.14, legW: 0.12, armL: 0.58, armR: 0.045, carn: true, sickle: true };
    const sk = biped(p);
    // перья: гребень на голове, «крылья» на руках, веер на хвосте
    const N = sk.piv.head;
    for (let i = 0; i < 4; i++) put(sk, 'head', spike(add3(N, [0, 0.08, 0.14 - i * 0.06]), add3(N, [0, 0.22 - i * 0.02, 0.02 - i * 0.1]), 0.03, 4), '#1d2a3a');
    for (const s of [-1, 1]) { const [S0, E, Hd] = sk.arm[s]; for (let i = 0; i < 5; i++) { const u = i / 4, b = [E[0] + (Hd[0] - E[0]) * u, E[1] + (Hd[1] - E[1]) * u, E[2] + (Hd[2] - E[2]) * u]; put(sk, 'body', spike(b, add3(b, [s * 0.05, -0.2, -0.12]), 0.04, 3), '#25344a'); } }
    for (let i = 0; i < 6; i++) { const t = tailPoint(sk, 0.55 + i * 0.08); for (const s of [-1, 1]) put(sk, t.grp, spike(t.p, add3(t.p, [s * 0.22, 0.02, -0.08]), 0.04, 3), '#1d2a3a'); }
    sk.pal = { back: '#4a5d72', belly: '#d9d2c2', mark: '#1d2a3a', yLo: 0.7, yHi: 1.25, stripes: 9 };
    sk.len = 3.2; sk.r = 0.5;
    return sk;
  },
  dryo() {
    const p = { hip: 0.8, bl: 0.95, bw: 0.38, bh: 0.5, bz: 0.06, neckL: 0.5, neckR: 0.1, neckA: 0.95, headL: 0.3, headH: 0.18, headW: 0.16,
      tailL: 1.55, tailR: 0.13, legW: 0.12, armL: 0.32, armR: 0.035, beak: '#3a3226' };
    const sk = biped(p);
    sk.pal = { back: '#8a7a3c', belly: '#efe3c0', mark: '#5a4a22', yLo: 0.65, yHi: 1.15, spots: 9 };
    sk.len = 2.8; sk.r = 0.45;
    return sk;
  },
  trike() {
    const p = { hip: 2.2, sh: 1.85, bl: 4.3, bw: 2.4, bh: 2.2, bz: 0, neckL: 0.55, neckR: 0.6, neckA: -0.15, headL: 1.7, headH: 1.0, headW: 0.95,
      tailL: 2.9, tailR: 0.58, legW: 0.5, beak: '#2e2620' };
    const sk = quad(p);
    const N = sk.piv.head;
    // воротник-щит, два рога над глазами и рог на носу
    put(sk, 'head', ell([1.45, 1.25, 0.16], add3(N, [0, 0.75, -0.15]), [-0.75, 0, 0], [12, 8]), null);
    for (let i = 0; i < 9; i++) { const a = -1.2 + i * 0.3; put(sk, 'head', ell([0.13, 0.13, 0.1], add3(N, [Math.sin(a) * 1.42, 0.75 + Math.cos(a) * 1.2 * 0.66, -0.15 - Math.cos(a) * 0.82]), [0, 0, 0], [5, 3]), '#e0c48a'); }
    for (const s of [-1, 1]) put(sk, 'head', spike(add3(N, [s * 0.33, 0.48, 0.55]), add3(N, [s * 0.42, 1.25, 1.85]), 0.13, 6), '#e8dcc0');
    put(sk, 'head', spike(add3(N, [0, 0.25, 1.3]), add3(N, [0, 0.72, 1.6]), 0.11, 5), '#e8dcc0');
    sk.pal = { back: '#56653a', belly: '#c7bf93', mark: '#b5642b', yLo: 1.4, yHi: 3.2, stripes: 2.6 };
    sk.frill = true;
    sk.len = 8.5; sk.r = 2.0;
    return sk;
  },
  stego() {
    const p = { hip: 2.6, sh: 1.35, bl: 4.0, bw: 1.8, bh: 2.0, bz: -0.1, neckL: 1.1, neckR: 0.35, neckA: -0.35, headL: 0.65, headH: 0.36, headW: 0.34,
      tailL: 3.6, tailR: 0.5, legW: 0.42, beak: '#3a3020' };
    const sk = quad(p);
    // пластины вдоль спины и хвоста, шипы на конце хвоста
    const PL = '#c25a2c';
    for (let i = 0; i < 7; i++) {
      const z = 1.7 - i * 0.55, y = 2.0 + 1.2 * Math.sin((i + 0.6) / 7 * PI), h = 0.5 + 0.75 * Math.sin((i + 0.5) / 7 * PI);
      for (const s of [-1, 1]) put(sk, 'body', ell([0.06, h * 0.6, h * 0.42], [s * 0.18, y + h * 0.3, z + s * 0.12], [0.15, 0, s * 0.12], [6, 5]), PL);
    }
    for (let i = 0; i < 4; i++) { const t = tailPoint(sk, 0.08 + i * 0.12), h = 0.45 - i * 0.08; for (const s of [-1, 1]) put(sk, t.grp, ell([0.05, h * 0.6, h * 0.42], add3(t.p, [s * 0.12, 0.28 + h * 0.2, s * 0.1]), [0.2, 0, s * 0.15], [6, 4]), PL); }
    for (const s of [-1, 1]) for (const k of [0, 1]) { const t = tailPoint(sk, 0.84 + k * 0.1); put(sk, 'tail2', spike(t.p, add3(t.p, [s * 0.7, 0.42, -0.25 + k * 0.1]), 0.07, 5), '#efe6cc'); }
    sk.pal = { back: '#3f5b55', belly: '#cbc3a1', mark: '#24383a', yLo: 1.3, yHi: 3.0, stripes: 3.4 };
    sk.len = 8.5; sk.r = 1.7;
    return sk;
  },
};

// ---------------- Сборка ----------------
const cache = {};
const shadowGeo = new THREE.CircleGeometry(1, 14).rotateX(-PI / 2);
const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });

function mergeAt(list, P, piv, limb) {
  if (!list.length) return null;
  const gs = list.map(({ g, fixed }) => paint(g.clone(), P, fixed, limb));
  const m = mergeGeometries(gs);
  m.translate(-piv[0], -piv[1], -piv[2]);
  m.computeBoundingSphere();
  return m;
}
function geos(key) {
  if (cache[key]) return cache[key];
  const sk = MODELS[key]();
  const P = sk.pal, pv = sk.piv;
  const out = { sk };
  for (const k of ['body', 'neck', 'head', 'jaw', 'tail0', 'tail1', 'tail2']) out[k] = mergeAt(sk.parts[k], P, pv[k]);
  out.legs = sk.legs.map(l => ({ l, up: mergeAt(l.up, P, l.hip, l.hip[1] * 1.15), lo: mergeAt(l.lo, P, l.knee, l.hip[1] * 1.15) }));
  return (cache[key] = out);
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export function buildDino(key) {
  const G = geos(key), sk = G.sk, pv = sk.piv;
  const meshes = [];
  const mesh = g => { const m = new THREE.Mesh(g, SKIN); meshes.push(m); return m; };
  const node = (parent, at, g) => { const o = new THREE.Group(); o.position.set(at[0], at[1], at[2]); o.rotation.order = 'YXZ'; if (g) o.add(mesh(g)); parent.add(o); return o; };
  const root = new THREE.Group();
  const body = node(root, pv.body, G.body);
  const neck = node(body, sub(pv.neck, pv.body), G.neck);
  const headN = node(neck, sub(pv.head, pv.neck), G.head);
  const jaw = node(headN, sub(pv.jaw, pv.head), G.jaw);
  const t0 = node(body, sub(pv.tail0, pv.body), G.tail0);
  const t1 = node(t0, sub(pv.tail1, pv.tail0), G.tail1);
  const t2 = node(t1, sub(pv.tail2, pv.tail1), G.tail2);
  const legs = G.legs.map(({ l, up, lo }) => {
    const hip = node(body, sub(l.hip, pv.body), up);
    const knee = node(hip, sub(l.knee, l.hip), lo);
    return { hip, knee, ph: l.ph, front: l.front, h: l.hip[1] };
  });
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.scale.set(sk.r * 1.1, 1, sk.len * 0.42); shadow.position.y = 0.06; shadow.renderOrder = -1;
  root.add(shadow);
  return {
    root, body, neck, head: headN, jaw, tail: [t0, t1, t2], legs, meshes, shadow,
    bodyY: pv.body[1], hip: sk.legs[0].hip[1], len: sk.len, r: sk.r, quad: sk.legs.length > 2,
    headPt: [pv.head[0], pv.head[1], pv.head[2] + 0.6 * (sk.len / 8)],
  };
}

export function setHurt(m, on) {
  if (m.hurt === on) return; m.hurt = on;
  for (const mesh of m.meshes) mesh.material = on ? HURT : SKIN;
}

// ---------------- Анимация ----------------
const cl = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const sm = u => u * u * (3 - 2 * u);
// e: { m, S, scale, spd, turn, rest(0..1), dead(0..1), act:{k,t,d}, phase, swim, slope }
export function animate(e, dt, time) {
  const m = e.m, S = e.S, sc = e.scale;
  const stride = m.hip * (m.quad ? 2.2 : 2.6) * sc;
  e.phase = (e.phase || 0) + (e.spd * dt) / stride * TAU;
  const ratio = cl(e.spd / (S.sprint * sc * 0.9 + 0.01));
  e.mv = (e.mv || 0) + ((e.spd > 0.15 ? 1 : 0) - (e.mv || 0)) * Math.min(1, dt * 6);
  const mv = e.mv * (1 - e.rest) * (1 - e.dead);
  const amp = (m.quad ? 0.3 : 0.38) + 0.32 * ratio;
  const ph = e.phase, rest = sm(cl(e.rest)), dead = sm(cl(e.dead));
  const breath = Math.sin(time * 2.1 + (e.seed || 0)) * 0.012;

  // действие (укус, спецприём, зов, еда, питьё)
  let jaw = 0.04 + breath, neckX = 0, neckY = 0, headX = 0, lunge = 0, tailWhip = 0;
  const A = e.act;
  if (A) {
    const u = cl(A.t / A.d);
    if (A.k === 'bite' || A.k === 'spec') {
      if (S.tailAtk) { tailWhip = Math.sin(u * PI) * (A.k === 'spec' ? 1.4 : 1.0) * (A.side || 1); }
      else {
        const wind = u < 0.35 ? u / 0.35 : 0, snap = u >= 0.35 ? 1 - (u - 0.35) / 0.65 : 0;
        jaw = 0.55 * (u < 0.35 ? sm(wind) : sm(snap)) + 0.04;
        neckX = u < 0.35 ? -0.25 * sm(wind) : 0.35 * sm(snap);
        lunge = u < 0.35 ? -0.05 * wind : 0.12 * snap;
        if (m.quad) { neckX = u < 0.4 ? -0.35 * (u / 0.4) : 0.45 * Math.sin((u - 0.4) / 0.6 * PI); jaw = 0.08; }
      }
    } else if (A.k === 'call') {
      const k = Math.sin(u * PI);
      jaw = 0.75 * k; neckX = -0.55 * k; headX = -0.2 * k;
    } else if (A.k === 'eat' || A.k === 'drink') {
      const k = cl(A.t / 0.4) * cl((A.d - A.t) / 0.3);
      neckX = (m.quad ? 0.55 : 0.95) * k; headX = (m.quad ? 0.25 : 0.35) * k;
      jaw = A.k === 'eat' ? 0.12 + 0.18 * Math.max(0, Math.sin(time * 11)) * k : 0.08 + 0.05 * Math.sin(time * 14) * k;
    }
  }

  // туловище
  const b = m.body;
  const bob = -Math.abs(Math.sin(ph)) * 0.035 * m.hip * mv * (0.6 + ratio);
  b.position.y = m.bodyY + bob - m.hip * 0.42 * rest - m.hip * 0.5 * dead + (e.swimY || 0);
  b.position.z = lunge * m.len * 0.1;
  b.rotation.x = (e.slope || 0) * (1 - dead) + 0.05 * ratio * mv - (m.quad ? 0 : 0.04 * rest) + breath * 0.5;
  b.rotation.z = -(e.turn || 0) * 0.06 * mv + dead * 1.42;
  b.rotation.y = 0;
  b.scale.set(1, 1 + breath, 1);

  // шея и голова
  m.neck.rotation.x = neckX + 0.15 * rest + Math.sin(ph * 2) * 0.03 * mv - 0.25 * dead;
  m.neck.rotation.y = neckY + cl(e.turn || 0, -1.5, 1.5) * 0.12 + Math.sin(time * 0.5 + (e.seed || 0)) * 0.05 * (1 - mv);
  m.head.rotation.x = headX + Math.sin(ph * 2 + 0.5) * 0.04 * mv;
  m.jaw.rotation.x = jaw + 0.3 * dead;

  // хвост: волна, отстаёт при повороте, удар хвостом
  const tw = Math.sin(time * 1.4 + (e.seed || 0));
  for (let i = 0; i < 3; i++) {
    const t = m.tail[i];
    t.rotation.y = tw * 0.05 * (1 + i * 0.5) + Math.sin(ph - i * 0.9) * 0.05 * mv - (e.turn || 0) * 0.13 * (i + 1) * 0.5 + tailWhip * (0.55 - i * 0.1);
    t.rotation.x = (i === 0 ? -0.06 * ratio * mv + 0.12 * rest : 0.03 * rest) + dead * 0.08;
  }

  // ноги
  for (const L of m.legs) {
    const s = Math.sin(ph + L.ph), c = Math.cos(ph + L.ph);
    let hx = -s * amp * mv, kx = Math.max(0, c) * amp * (m.quad ? 0.7 : 1.1) * mv;
    if (m.quad && L.front) kx = -kx * 0.6; // передние гнутся назад
    if (rest > 0) {
      if (m.quad) { hx += (L.front ? -0.25 : 0.55) * rest; kx += (L.front ? 0.9 : -1.2) * rest; }
      else { hx += -1.05 * rest; kx += 1.9 * rest; }
    }
    if (dead > 0) { hx = hx * (1 - dead) + (L.front ? -0.3 : 0.25) * dead; kx *= 1 - dead; }
    L.hip.rotation.x = hx; L.knee.rotation.x = kx;
  }
}

// Заполнение модели для иконки в меню: строим один раз и рендерим.
export function speciesStats(key) {
  const S = SPECIES[key];
  return {
    hp: Math.round(S.hp / 16), dmg: Math.round(S.dmg / 2.2), spd: Math.round(S.sprint / 13.5 * 100), grow: S.grow,
  };
}
