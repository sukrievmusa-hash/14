// Мехазавры: железные машины в виде динозавров.
// Модели собраны из простых фигур: броня (металл) + светящиеся детали (глаза, ядро, полосы).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const METAL = new THREE.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: 60, specular: 0x7a7a7a });
export const GLOW = new THREE.MeshBasicMaterial({ vertexColors: true });
export const FLASH = new THREE.MeshBasicMaterial({ color: 0xffffff });

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color();
const PI = Math.PI;

// Деталь: геометрия + цвет + позиция + поворот (+ светится ли)
function P(geo, color, pos = [0, 0, 0], rot = [0, 0, 0], glow = false) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  _e.set(rot[0], rot[1], rot[2]); _q.setFromEuler(_e); _v.set(pos[0], pos[1], pos[2]);
  _m.compose(_v, _q, _s); g.applyMatrix4(_m);
  _c.set(color);
  const n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.userData.glow = glow;
  return g;
}
const G = (geo, color, pos, rot) => P(geo, color, pos, rot, true);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 6) => new THREE.CylinderGeometry(rt, rb, h, s);
const cone = (r, h, s = 5) => new THREE.ConeGeometry(r, h, s);
const cylX = (r, len, color, pos) => P(cyl(r, r, len, 8), color, pos, [0, 0, PI / 2]);

// Сегментированный железный хвост
function mechTail(base, len, c, n = 4) {
  const parts = [], seg = len / n;
  for (let i = 0; i < n; i++) {
    const k = 1 - i * 0.2;
    parts.push(P(box(base * 1.6 * k, base * 1.4 * k, seg * 0.92), i % 2 ? c.dark : c.main, [0, -i * base * 0.12, -(i + 0.5) * seg]));
    parts.push(P(box(base * 0.5 * k, base * 0.25, seg * 0.7), c.armor, [0, base * 0.72 * k - i * base * 0.12, -(i + 0.5) * seg]));
  }
  parts.push(G(box(base * 0.35, base * 0.35, seg * 0.4), c.glow, [0, -n * base * 0.12, -len - seg * 0.1]));
  return parts;
}

// ---------- Двуногие мехи ----------
function biped(p, extra) {
  const { L, bw, bh, bl, neck, hw, hh, hl, tl, arm, c } = p;
  const ty = L + bh * 0.3, tilt = [-0.08, 0, 0];
  const torso = [
    P(box(bw * 0.86, bh * 0.92, bl * 0.96), c.dark, [0, ty, 0], tilt),
    P(box(bw, bh * 0.55, bl * 0.82), c.main, [0, ty + bh * 0.2, 0.05], tilt),
    P(box(bw * 1.04, bh * 0.14, bl * 0.5), c.armor, [0, ty + bh * 0.02, 0.1], tilt),
    P(box(bw * 0.9, bh * 0.28, bl * 0.7), c.light, [0, ty - bh * 0.32, 0.1]),
    G(box(bw * 0.42, bh * 0.3, 0.12), c.glow, [0, ty + bh * 0.02, bl * 0.49]),
  ];
  for (let i = 0; i < 3; i++) torso.push(P(box(bw * 0.22, bh * 0.16, bl * 0.18), c.armor, [0, ty + bh * 0.53 - i * 0.03, bl * 0.25 - i * bl * 0.25]));
  // шея из сегментов
  for (let i = 0; i < 3; i++) {
    const k = (i + 0.5) / 3;
    torso.push(P(box(bw * (0.55 - i * 0.05), bh * 0.5, neck * 0.42), i % 2 ? c.dark : c.main,
      [0, ty + bh * (0.2 + 0.25 * k), bl / 2 + neck * 0.8 * k], [-0.5, 0, 0]));
  }
  // руки-манипуляторы с когтями
  for (const s of [-1, 1]) {
    torso.push(P(box(bw * 0.16, bw * 0.16, arm), c.dark, [s * bw * 0.48, ty - bh * 0.1, bl * 0.45], [0.7, 0, 0]));
    torso.push(P(box(bw * 0.2, bw * 0.08, arm * 0.35), c.light, [s * bw * 0.48, ty - bh * 0.1 - arm * 0.4, bl * 0.45 + arm * 0.35], [1.3, 0, 0]));
  }
  if (p.exhaust) for (const s of [-1, 1]) {
    torso.push(P(cyl(bw * 0.09, bw * 0.11, bh * 0.6, 6), c.dark, [s * bw * 0.28, ty + bh * 0.55, -bl * 0.3], [-0.35, 0, 0]));
    torso.push(G(cyl(bw * 0.07, bw * 0.07, 0.06, 6), c.glow, [s * bw * 0.28, ty + bh * 0.84, -bl * 0.4], [-0.35, 0, 0]));
  }
  const head = {
    p: [0, ty + bh * 0.42, bl / 2 + neck * 0.75],
    parts: [
      P(box(hw, hh * 0.72, hl), c.main, [0, hh * 0.12, hl * 0.45]),
      P(box(hw * 1.04, hh * 0.18, hl * 0.6), c.armor, [0, hh * 0.5, hl * 0.35]),
      P(box(hw * 0.86, hh * 0.3, hl * 0.92), c.dark, [0, -hh * 0.42, hl * 0.45]),
      P(box(hw * 0.74, hh * 0.1, hl * 0.82), c.light, [0, -hh * 0.24, hl * 0.5]),
      G(box(hw * 1.06, hh * 0.13, hl * 0.22), c.glow, [0, hh * 0.3, hl * 0.66]),
    ],
  };
  const tail = { p: [0, ty + bh * 0.05, -bl / 2 + 0.1], parts: mechTail(bh * 0.4, tl, c) };
  const legs = [];
  for (const [s, ph] of [[-1, 0], [1, PI]]) {
    legs.push({
      p: [s * bw * 0.4, L, -bl * 0.05], ph,
      parts: [
        P(box(bw * 0.36, L * 0.55, bl * 0.38), c.main, [0, -L * 0.2, 0.05]),
        P(box(bw * 0.38, L * 0.12, bl * 0.3), c.armor, [0, -L * 0.05, 0.06]),
        cylX(bw * 0.14, bw * 0.4, c.dark, [0, -L * 0.5, -0.02]),
        P(box(bw * 0.2, L * 0.5, bw * 0.22), c.dark, [0, -L * 0.7, -0.08]),
        P(cyl(bw * 0.04, bw * 0.04, L * 0.45, 5), c.light, [0, -L * 0.52, -bl * 0.16]),
        P(box(bw * 0.34, L * 0.1, bl * 0.22), c.main, [0, -L * 0.95, bl * 0.06]),
        P(box(bw * 0.07, L * 0.06, bl * 0.12), c.light, [-bw * 0.11, -L * 0.97, bl * 0.2]),
        P(box(bw * 0.07, L * 0.06, bl * 0.12), c.light, [bw * 0.11, -L * 0.97, bl * 0.2]),
      ],
    });
  }
  extra && extra({ torso, head, tail, legs, ty, p });
  return { torso, head, tail, legs };
}

// ---------- Четвероногие мехи ----------
function quad(p, extra) {
  const { L, bw, bh, bl, hw, hh, hl, tl, c } = p;
  const ty = L + bh * 0.4;
  const torso = [
    P(box(bw * 0.9, bh * 0.9, bl * 0.96), c.dark, [0, ty, 0]),
    P(box(bw, bh * 0.5, bl * 0.86), c.main, [0, ty + bh * 0.24, 0]),
    P(box(bw * 1.06, bh * 0.36, bl * 0.7), c.armor, [0, ty - bh * 0.12, 0]),
    P(box(bw * 0.8, bh * 0.22, bl * 0.75), c.light, [0, ty - bh * 0.4, 0]),
  ];
  for (const s of [-1, 1]) for (const z of [-0.25, 0.05, 0.35]) torso.push(G(box(0.06, bh * 0.1, bl * 0.12), c.glow, [s * bw * 0.535, ty - bh * 0.12, z * bl]));
  const head = { p: p.headP(ty), parts: [
    P(box(hw, hh, hl), c.main, [0, 0, hl * 0.45]),
    P(box(hw * 0.8, hh * 0.3, hl * 0.8), c.dark, [0, -hh * 0.45, hl * 0.45]),
    G(box(hw * 1.06, hh * 0.14, hl * 0.2), c.glow, [0, hh * 0.18, hl * 0.62]),
  ] };
  const tail = { p: [0, ty + bh * 0.1, -bl / 2 + 0.1], parts: mechTail(bh * 0.32, tl, c) };
  const legs = [];
  for (const [x, z, ph] of [[-1, 1, 0], [1, 1, PI], [-1, -1, PI], [1, -1, 0]]) {
    legs.push({
      p: [x * bw * 0.38, L, z * bl * 0.32], ph,
      parts: [
        P(box(bw * 0.28, L * 0.58, bw * 0.3), c.main, [0, -L * 0.2, 0]),
        P(box(bw * 0.3, L * 0.14, bw * 0.32), c.armor, [0, -L * 0.08, 0]),
        cylX(bw * 0.12, bw * 0.3, c.dark, [0, -L * 0.5, 0]),
        P(box(bw * 0.2, L * 0.5, bw * 0.22), c.dark, [0, -L * 0.72, 0]),
        P(box(bw * 0.3, L * 0.14, bw * 0.34), c.main, [0, -L * 0.94, 0.05]),
      ],
    });
  }
  extra && extra({ torso, head, tail, legs, ty });
  return { torso, head, tail, legs };
}

// ---------- Виды ----------
// hp/dmg — для взрослого; spd/run — шаг/бег; reach — дальность удара от центра;
// r — радиус корпуса; h — высота для подписи; cam — размер для камеры.
export const SPECIES = {
  rex: {
    name: 'Мега-Рекс', diet: 'carn', hp: 1200, dmg: 150, spd: 6.5, run: 10.5, cd: 1.2,
    reach: 4.6, r: 1.8, h: 4.8, cam: 1.0, color: '#b8372c', glow: '#ff4a2a',
    special: { type: 'heavy', name: 'Гидро-укус', mult: 2.5, cd: 8 },
    desc: 'Тяжёлый штурмовой мех. Медленный, но гидравлические челюсти рвут броню.',
    model: () => biped({
      L: 2.2, bw: 1.4, bh: 1.6, bl: 3.0, neck: 0.8, hw: 1.0, hh: 1.1, hl: 1.7, tl: 3.8, arm: 0.55, exhaust: true,
      c: { main: '#8a9099', armor: '#b8372c', dark: '#33373e', light: '#d7dbe0', glow: '#ff4a2a' },
    }),
  },
  raptor: {
    name: 'Раптор-Дрон', diet: 'carn', hp: 380, dmg: 48, spd: 9, run: 15, cd: 0.5,
    reach: 2.7, r: 0.8, h: 2.3, cam: 0.55, color: '#1f8fd6', glow: '#3ff2ff',
    special: { type: 'dash', name: 'Реактивный прыжок', mult: 2.2, cd: 4, speed: 30, dur: 0.35 },
    desc: 'Лёгкий скоростной дрон. Бьёт часто и прыгает на реактивной тяге.',
    model: () => biped({
      L: 1.15, bw: 0.55, bh: 0.62, bl: 1.35, neck: 0.65, hw: 0.42, hh: 0.45, hl: 0.9, tl: 2.0, arm: 0.7,
      c: { main: '#a9b3bd', armor: '#1f8fd6', dark: '#2c3138', light: '#e4e8ec', glow: '#3ff2ff' },
    }, ({ torso, head, ty }) => {
      head.parts.push(P(box(0.06, 0.3, 0.5), '#1f8fd6', [0, 0.45, 0.25]));
      for (const s of [-1, 1]) {
        torso.push(P(cyl(0.09, 0.12, 0.45, 6), '#2c3138', [s * 0.18, ty + 0.3, -0.55], [-PI / 2 + 0.3, 0, 0]));
        torso.push(G(cyl(0.07, 0.07, 0.04, 6), '#3ff2ff', [s * 0.18, ty + 0.24, -0.78], [-PI / 2 + 0.3, 0, 0]));
      }
    }),
  },
  spino: {
    name: 'Спино-Крейсер', diet: 'carn', hp: 1000, dmg: 120, spd: 7, run: 11, cd: 1.0,
    reach: 5.2, r: 1.9, h: 5.6, cam: 1.05, color: '#2b5d9a', glow: '#59a8ff',
    special: { type: 'area', name: 'Электро-хвост', mult: 1.5, cd: 7, radius: 6.5 },
    desc: 'Крейсер с электрическим парусом. Бьёт разрядом всех вокруг.',
    model: () => biped({
      L: 2.0, bw: 1.15, bh: 1.4, bl: 3.4, neck: 1.0, hw: 0.6, hh: 0.6, hl: 2.1, tl: 4.2, arm: 0.9,
      c: { main: '#6b7784', armor: '#2b5d9a', dark: '#262b33', light: '#c9d0d8', glow: '#59a8ff' },
    }, ({ torso, ty }) => {
      const n = 7, top = ty + 0.7;
      for (let i = 0; i < n; i++) {
        const h = 2.1 * Math.sin(PI * (i + 0.5) / n) + 0.2, z = 1.6 - (i + 0.5) * 3.4 / n;
        torso.push(P(box(0.1, h, 3.4 / n - 0.06), i % 2 ? '#2b5d9a' : '#3a73b8', [0, top + h / 2 - 0.1, z]));
        torso.push(G(box(0.14, 0.1, 3.4 / n - 0.1), '#59a8ff', [0, top + h - 0.12, z]));
      }
    }),
  },
  trike: {
    name: 'Трицера-Танк', diet: 'herb', hp: 1300, dmg: 110, spd: 6.5, run: 10, cd: 1.2,
    reach: 4.2, r: 1.9, h: 3.8, cam: 0.9, color: '#d07a2a', glow: '#ffb22e',
    special: { type: 'dash', name: 'Турбо-таран', mult: 2.3, cd: 7, speed: 22, dur: 0.55 },
    desc: 'Бронированный танк с тремя бурами. Разгоняется и таранит.',
    model: () => quad({
      L: 1.3, bw: 1.9, bh: 1.7, bl: 3.4, hw: 1.1, hh: 0.95, hl: 1.4, tl: 2.2,
      headP: ty => [0, ty - 0.1, 1.6],
      c: { main: '#9c8e74', armor: '#d07a2a', dark: '#3a3631', light: '#e0d6c2', glow: '#ffb22e' },
    }, ({ head }) => {
      head.parts.push(P(box(2.3, 1.9, 0.2), '#d07a2a', [0, 0.75, -0.05], [-0.45, 0, 0]));
      head.parts.push(P(box(2.0, 1.6, 0.22), '#3a3631', [0, 0.75, 0.05], [-0.45, 0, 0]));
      head.parts.push(G(box(2.34, 0.12, 0.24), '#ffb22e', [0, 1.6, -0.45], [-0.45, 0, 0]));
      head.parts.push(P(cone(0.3, 0.6, 4), '#3a3631', [0, -0.25, 1.55], [PI / 2 + 0.3, 0, 0]));
      for (const s of [-1, 1]) head.parts.push(P(cone(0.16, 1.6, 6), '#d7dbe0', [s * 0.35, 0.95, 0.9], [1.0, 0, 0]));
      head.parts.push(P(cone(0.13, 0.5, 6), '#d7dbe0', [0, 0.4, 1.35], [0.6, 0, 0]));
    }),
  },
  stego: {
    name: 'Стего-Бастион', diet: 'herb', hp: 1100, dmg: 130, spd: 5.5, run: 8.5, cd: 1.3,
    reach: 3.8, r: 1.9, h: 4.6, cam: 0.9, color: '#4f7a3a', glow: '#66ff7a',
    special: { type: 'area', name: 'Шоковые шипы', mult: 1.9, cd: 7, radius: 6.5 },
    desc: 'Крепость на ногах. Пластины-клинки и шоковые шипы на хвосте.',
    model: () => quad({
      L: 1.35, bw: 1.5, bh: 1.8, bl: 3.4, hw: 0.5, hh: 0.45, hl: 0.95, tl: 3.2,
      headP: ty => [0, ty - 0.7, 2.3],
      c: { main: '#76806c', armor: '#4f7a3a', dark: '#2f3430', light: '#d4d9cf', glow: '#66ff7a' },
    }, ({ torso, tail, ty }) => {
      torso.push(P(box(0.6, 0.6, 1.0), '#2f3430', [0, ty - 0.45, 1.95], [0.3, 0, 0]));
      const n = 7;
      for (let i = 0; i < n; i++) {
        const k = Math.sin(PI * (i + 0.5) / n), h = 0.5 + 1.1 * k, s = i % 2 ? 1 : -1;
        torso.push(P(box(0.1, h, h * 0.9), i % 2 ? '#4f7a3a' : '#5f8f46', [s * 0.18, ty + 0.9 + h / 2 - 0.15, 1.5 - i * 0.5], [0, 0, -s * 0.18]));
        torso.push(G(box(0.13, 0.08, h * 0.7), '#66ff7a', [s * 0.18 + s * h * 0.17, ty + 0.9 + h - 0.2, 1.5 - i * 0.5], [0, 0, -s * 0.18]));
      }
      for (const s of [-1, 1]) for (const z of [-2.6, -2.95]) {
        tail.parts.push(P(cone(0.11, 0.9, 5), '#d4d9cf', [s * 0.4, 0.15, z], [0, 0, -s * 1.1]));
      }
    }),
  },
};
export const SP_KEYS = Object.keys(SPECIES);

// ---------- Уровни ----------
export const STAGES = ['Прототип', 'Mk-I', 'Mk-II', 'Mk-III', 'ПРАЙМ'];
export const stageIndex = g => (g >= 1 ? 4 : Math.min(3, Math.floor(g * 4)));
export const growthScale = g => (0.32 + 0.68 * Math.min(g, 1)) * (g >= 1 ? 1.08 : 1);
export const statMul = g => (0.22 + 0.78 * Math.min(g, 1)) * (g >= 1 ? 1.15 : 1);

// ---------- Сборка модели ----------
const cache = {};
const shadowGeo = new THREE.CircleGeometry(1, 12).rotateX(-PI / 2);
const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false });

// Металл и свечение в одной геометрии (2 группы): меньше вызовов отрисовки
function mergeSplit(parts) {
  const metal = parts.filter(g => !g.userData.glow), glow = parts.filter(g => g.userData.glow);
  const a = mergeGeometries(metal);
  if (!glow.length) return { geo: a, glow: false };
  return { geo: mergeGeometries([a, mergeGeometries(glow)], true), glow: true };
}
function geos(key) {
  if (cache[key]) return cache[key];
  const d = SPECIES[key].model();
  return (cache[key] = {
    torso: mergeSplit(d.torso),
    head: { p: d.head.p, ...mergeSplit(d.head.parts) },
    tail: { p: d.tail.p, ...mergeSplit(d.tail.parts) },
    legs: d.legs.map(l => ({ p: l.p, ph: l.ph, ...mergeSplit(l.parts) })),
  });
}

export function buildDino(key) {
  const Gm = geos(key), S = SPECIES[key];
  const meshes = [];
  const mk = g => { const m = new THREE.Mesh(g.geo, g.glow ? [METAL, GLOW] : METAL); m.userData.mat = m.material; meshes.push(m); return m; };
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  body.add(mk(Gm.torso));
  const head = new THREE.Group(); head.position.set(...Gm.head.p); head.add(mk(Gm.head)); body.add(head);
  const tail = new THREE.Group(); tail.position.set(...Gm.tail.p); tail.add(mk(Gm.tail)); body.add(tail);
  const legs = Gm.legs.map(l => {
    const pv = new THREE.Group(); pv.position.set(...l.p); pv.add(mk(l)); root.add(pv);
    return { pivot: pv, ph: l.ph };
  });
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.scale.setScalar(S.r * 1.3); shadow.position.y = 0.08; shadow.renderOrder = -1;
  root.add(shadow);
  return { root, body, head, tail, legs, meshes, headZ: Gm.head.p[2] };
}

// Белая вспышка при попадании
export function setFlash(m, on) {
  for (const mesh of m.meshes) mesh.material = on ? FLASH : mesh.userData.mat;
}
