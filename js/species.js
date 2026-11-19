// Виды динозавров: характеристики + low-poly модели, собранные из простых фигур.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const MAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color();

// Деталь: геометрия + цвет + позиция + поворот
function P(geo, color, pos = [0, 0, 0], rot = [0, 0, 0]) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  _e.set(rot[0], rot[1], rot[2]); _q.setFromEuler(_e); _v.set(pos[0], pos[1], pos[2]);
  _m.compose(_v, _q, _s); g.applyMatrix4(_m);
  _c.set(color);
  const n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 6) => new THREE.CylinderGeometry(rt, rb, h, s);
const cone = (r, h, s = 5) => new THREE.ConeGeometry(r, h, s);
const PI = Math.PI;

// Хвост: конус, тонкий конец смотрит назад (-Z)
const tailGeo = (base, len, color) => P(cyl(0.05, base, len, 6), color, [0, 0, -len / 2], [-PI / 2, 0, 0]);

// ---------- Двуногие (Рекс, Раптор, Спинозавр) ----------
function biped(p, extra) {
  const { L, bw, bh, bl, neck, hw, hh, hl, tl, arm, c } = p;
  const ty = L + bh * 0.3;
  const torso = [
    P(box(bw, bh, bl), c.main, [0, ty, 0], [-0.08, 0, 0]),
    P(box(bw * 0.8, bh * 0.35, bl * 0.75), c.belly, [0, ty - bh * 0.38, 0.05]),
    P(box(bw * 0.3, bh * 0.15, bl * 0.9), c.dark, [0, ty + bh * 0.5, -0.05]),
    P(box(bw * 0.55, bh * 0.6, neck + 0.3), c.main, [0, ty + bh * 0.25, bl / 2 + neck * 0.35], [-0.5, 0, 0]),
  ];
  for (const s of [-1, 1]) torso.push(P(box(bw * 0.14, bw * 0.14, arm), c.dark, [s * bw * 0.45, ty - bh * 0.1, bl * 0.45], [0.7, 0, 0]));
  const head = {
    p: [0, ty + bh * 0.42, bl / 2 + neck * 0.75],
    parts: [
      P(box(hw, hh * 0.75, hl), c.main, [0, hh * 0.12, hl * 0.45]),
      P(box(hw * 0.85, hh * 0.3, hl * 0.9), c.belly, [0, -hh * 0.42, hl * 0.45]),
      P(box(hw * 0.7, hh * 0.1, hl * 0.8), '#f4efe0', [0, -hh * 0.24, hl * 0.5]),
      P(box(hw * 0.16, hw * 0.16, hw * 0.16), c.eye, [hw / 2, hh * 0.3, hl * 0.72]),
      P(box(hw * 0.16, hw * 0.16, hw * 0.16), c.eye, [-hw / 2, hh * 0.3, hl * 0.72]),
    ],
  };
  const tail = { p: [0, ty + bh * 0.05, -bl / 2 + 0.1], parts: [tailGeo(bh * 0.42, tl, c.main)] };
  const legs = [];
  for (const [s, ph] of [[-1, 0], [1, PI]]) {
    legs.push({
      p: [s * bw * 0.38, L, -bl * 0.05], ph,
      parts: [
        P(box(bw * 0.34, L * 0.6, bl * 0.38), c.main, [0, -L * 0.22, 0.05]),
        P(box(bw * 0.2, L * 0.55, bw * 0.22), c.dark, [0, -L * 0.65, -0.08]),
        P(box(bw * 0.32, L * 0.1, bl * 0.25), c.dark, [0, -L * 0.95, bl * 0.08]),
      ],
    });
  }
  extra && extra({ torso, head, tail, legs, ty });
  return { torso, head, tail, legs };
}

// ---------- Четвероногие (Трицератопс, Стегозавр) ----------
function quad(p, extra) {
  const { L, bw, bh, bl, hw, hh, hl, tl, c } = p;
  const ty = L + bh * 0.4;
  const torso = [
    P(box(bw, bh, bl), c.main, [0, ty, 0]),
    P(box(bw * 0.85, bh * 0.3, bl * 0.8), c.belly, [0, ty - bh * 0.4, 0]),
  ];
  const head = { p: p.headP(ty), parts: [P(box(hw, hh, hl), c.main, [0, 0, hl * 0.45])] };
  for (const s of [-1, 1]) head.parts.push(P(box(hw * 0.14, hw * 0.14, hw * 0.14), c.eye, [s * hw / 2, hh * 0.2, hl * 0.55]));
  const tail = { p: [0, ty + bh * 0.1, -bl / 2 + 0.1], parts: [tailGeo(bh * 0.33, tl, c.main)] };
  const legs = [];
  for (const [x, z, ph] of [[-1, 1, 0], [1, 1, PI], [-1, -1, PI], [1, -1, 0]]) {
    legs.push({
      p: [x * bw * 0.36, L, z * bl * 0.32], ph,
      parts: [
        P(box(bw * 0.26, L * 0.62, bw * 0.28), c.main, [0, -L * 0.22, 0]),
        P(box(bw * 0.21, L * 0.55, bw * 0.23), c.dark, [0, -L * 0.68, 0]),
        P(box(bw * 0.27, L * 0.12, bw * 0.32), c.dark, [0, -L * 0.95, 0.05]),
      ],
    });
  }
  extra && extra({ torso, head, tail, legs, ty });
  return { torso, head, tail, legs };
}

// ---------- Виды ----------
// hp/dmg — для взрослого; spd/run — скорость шага/бега; reach — дальность укуса от центра;
// r — радиус тела; h — высота для подписи; cam — размер для камеры.
export const SPECIES = {
  rex: {
    name: 'Тираннозавр', diet: 'carn', hp: 1200, dmg: 150, spd: 6.5, run: 10.5, cd: 1.2,
    reach: 4.6, r: 1.8, h: 4.8, cam: 1.0, color: '#5f7f3b',
    special: { type: 'heavy', name: 'Сокрушающий укус', mult: 2.5, cd: 8 },
    desc: 'Король хищников. Медленный, но один укус решает всё.',
    model: () => biped({
      L: 2.2, bw: 1.4, bh: 1.6, bl: 3.0, neck: 0.8, hw: 1.0, hh: 1.1, hl: 1.7, tl: 3.8, arm: 0.55,
      c: { main: '#5f7f3b', dark: '#3b5226', belly: '#d8c89a', eye: '#f2c230' },
    }, ({ torso, ty }) => {
      for (let i = 0; i < 4; i++) torso.push(P(box(1.42, 0.1, 0.18), '#3b5226', [0, ty + 0.55 - i * 0.05, 0.9 - i * 0.6]));
    }),
  },
  raptor: {
    name: 'Велоцираптор', diet: 'carn', hp: 380, dmg: 48, spd: 9, run: 15, cd: 0.5,
    reach: 2.7, r: 0.8, h: 2.3, cam: 0.55, color: '#b0703f',
    special: { type: 'dash', name: 'Прыжок', mult: 2.2, cd: 4, speed: 30, dur: 0.35 },
    desc: 'Быстрый и вёрткий. Кусает часто, прыгает на добычу.',
    model: () => biped({
      L: 1.15, bw: 0.55, bh: 0.62, bl: 1.35, neck: 0.65, hw: 0.42, hh: 0.45, hl: 0.9, tl: 2.0, arm: 0.7,
      c: { main: '#b0703f', dark: '#5e3820', belly: '#ead7b0', eye: '#ffde3b' },
    }, ({ torso, head, tail, ty }) => {
      const a = '#2f6fbf';
      head.parts.push(P(box(0.06, 0.28, 0.55), a, [0, 0.42, 0.3]));
      for (const s of [-1, 1]) torso.push(P(box(0.05, 0.3, 0.6), a, [s * 0.3, ty - 0.2, 0.75], [0.7, 0, 0]));
      tail.parts.push(P(box(0.4, 0.06, 0.7), a, [0, 0.05, -1.7]));
      torso.push(P(box(0.3, 0.12, 1.1), a, [0, ty + 0.33, -0.1]));
    }),
  },
  spino: {
    name: 'Спинозавр', diet: 'carn', hp: 1000, dmg: 120, spd: 7, run: 11, cd: 1.0,
    reach: 5.2, r: 1.9, h: 5.6, cam: 1.05, color: '#5f8a91',
    special: { type: 'area', name: 'Удар хвостом', mult: 1.5, cd: 7, radius: 6.5 },
    desc: 'Огромный парус и длинная пасть. Бьёт хвостом всех вокруг.',
    model: () => biped({
      L: 2.0, bw: 1.15, bh: 1.4, bl: 3.4, neck: 1.0, hw: 0.6, hh: 0.6, hl: 2.1, tl: 4.2, arm: 0.9,
      c: { main: '#5f8a91', dark: '#3d5a5f', belly: '#cfc6a6', eye: '#ffcf33' },
    }, ({ torso, head, ty }) => {
      const n = 7, top = ty + 0.7;
      for (let i = 0; i < n; i++) {
        const hh = 2.1 * Math.sin(PI * (i + 0.5) / n) + 0.2;
        torso.push(P(box(0.1, hh, 3.4 / n + 0.02), i % 2 ? '#c4532f' : '#d9733f', [0, top + hh / 2 - 0.1, 1.6 - (i + 0.5) * 3.4 / n]));
      }
      head.parts.push(P(box(0.12, 0.25, 0.6), '#c4532f', [0, 0.45, 0.5]));
    }),
  },
  trike: {
    name: 'Трицератопс', diet: 'herb', hp: 1300, dmg: 110, spd: 6.5, run: 10, cd: 1.2,
    reach: 4.2, r: 1.9, h: 3.8, cam: 0.9, color: '#8a7650',
    special: { type: 'dash', name: 'Таран', mult: 2.3, cd: 7, speed: 22, dur: 0.55 },
    desc: 'Танк с тремя рогами. Разгоняется и таранит.',
    model: () => quad({
      L: 1.3, bw: 1.9, bh: 1.7, bl: 3.4, hw: 1.1, hh: 0.95, hl: 1.4, tl: 2.2,
      headP: ty => [0, ty - 0.1, 1.6],
      c: { main: '#8a7650', dark: '#5a4a30', belly: '#d9caa0', eye: '#222' },
    }, ({ head }) => {
      const horn = '#efe6cf';
      head.parts.push(P(box(2.3, 1.9, 0.2), '#c0603a', [0, 0.75, -0.05], [-0.45, 0, 0]));
      head.parts.push(P(box(1.9, 1.5, 0.22), '#e08a4a', [0, 0.75, 0.05], [-0.45, 0, 0]));
      head.parts.push(P(cone(0.3, 0.6, 4), '#5a4a30', [0, -0.25, 1.55], [PI / 2 + 0.3, 0, 0]));
      for (const s of [-1, 1]) head.parts.push(P(cone(0.15, 1.6, 5), horn, [s * 0.35, 0.95, 0.9], [1.0, 0, 0]));
      head.parts.push(P(cone(0.12, 0.5, 5), horn, [0, 0.4, 1.35], [0.6, 0, 0]));
    }),
  },
  stego: {
    name: 'Стегозавр', diet: 'herb', hp: 1100, dmg: 130, spd: 5.5, run: 8.5, cd: 1.3,
    reach: 3.8, r: 1.9, h: 4.6, cam: 0.9, color: '#7b8b4c',
    special: { type: 'area', name: 'Шипы хвоста', mult: 1.9, cd: 7, radius: 6.5 },
    desc: 'Пластины на спине и смертельные шипы на хвосте.',
    model: () => quad({
      L: 1.35, bw: 1.5, bh: 1.8, bl: 3.4, hw: 0.5, hh: 0.45, hl: 0.95, tl: 3.2,
      headP: ty => [0, ty - 0.7, 2.3],
      c: { main: '#7b8b4c', dark: '#4d5a2c', belly: '#dccf9e', eye: '#222' },
    }, ({ torso, tail, ty }) => {
      torso.push(P(box(0.6, 0.6, 1.0), '#7b8b4c', [0, ty - 0.45, 1.95], [0.3, 0, 0]));
      const n = 7;
      for (let i = 0; i < n; i++) {
        const k = Math.sin(PI * (i + 0.5) / n), h = 0.5 + 1.1 * k, s = i % 2 ? 1 : -1;
        torso.push(P(box(0.1, h, h * 0.9), i % 2 ? '#c8603a' : '#de7f45', [s * 0.18, ty + 0.9 + h / 2 - 0.15, 1.5 - i * 0.5], [0, 0, -s * 0.18]));
      }
      for (const s of [-1, 1]) for (const z of [-2.6, -2.95]) {
        tail.parts.push(P(cone(0.1, 0.9, 4), '#efe6cf', [s * 0.4, 0.25, z], [0, 0, -s * 1.1]));
      }
    }),
  },
};
export const SP_KEYS = Object.keys(SPECIES);

// ---------- Рост ----------
export const STAGES = ['Детёныш', 'Подросток', 'Молодой', 'Взрослый', 'Прайм'];
export const stageIndex = g => (g >= 1 ? 4 : Math.min(3, Math.floor(g * 4)));
export const growthScale = g => (0.32 + 0.68 * Math.min(g, 1)) * (g >= 1 ? 1.08 : 1);
export const statMul = g => (0.22 + 0.78 * Math.min(g, 1)) * (g >= 1 ? 1.15 : 1);

// ---------- Сборка модели ----------
const cache = {};
const shadowGeo = new THREE.CircleGeometry(1, 12).rotateX(-PI / 2);
const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false });

function geos(key) {
  if (cache[key]) return cache[key];
  const d = SPECIES[key].model();
  const m = arr => mergeGeometries(arr);
  return (cache[key] = {
    torso: m(d.torso),
    head: { p: d.head.p, g: m(d.head.parts) },
    tail: { p: d.tail.p, g: m(d.tail.parts) },
    legs: d.legs.map(l => ({ p: l.p, ph: l.ph, g: m(l.parts) })),
  });
}

export function buildDino(key) {
  const G = geos(key), S = SPECIES[key];
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  body.add(new THREE.Mesh(G.torso, MAT));
  const head = new THREE.Group(); head.position.set(...G.head.p); head.add(new THREE.Mesh(G.head.g, MAT)); body.add(head);
  const tail = new THREE.Group(); tail.position.set(...G.tail.p); tail.add(new THREE.Mesh(G.tail.g, MAT)); body.add(tail);
  const legs = G.legs.map(l => {
    const pv = new THREE.Group(); pv.position.set(...l.p); pv.add(new THREE.Mesh(l.g, MAT)); root.add(pv);
    return { pivot: pv, ph: l.ph };
  });
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.scale.setScalar(S.r * 1.3); shadow.position.y = 0.08; shadow.renderOrder = -1;
  root.add(shadow);
  return { root, body, head, tail, legs, headZ: G.head.p[2] };
}
