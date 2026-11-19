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

// Сегментированный железный хвост с шарнирами. Потом делится на основание и кончик — кончик гнётся отдельно, как хлыст.
function mechTail(base, len, c, n = 4) {
  const parts = [], seg = len / n;
  for (let i = 0; i < n; i++) {
    const k = 1 - i * 0.2, y = -i * base * 0.12, z = -(i + 0.5) * seg;
    parts.push(P(box(base * 1.6 * k, base * 1.4 * k, seg * 0.86), i % 2 ? c.dark : c.main, [0, y, z]));
    parts.push(P(box(base * 0.5 * k, base * 0.25, seg * 0.66), c.armor, [0, base * 0.72 * k + y, z]));
    parts.push(P(box(base * 1.7 * k, base * 0.18, seg * 0.3), c.armor, [0, y - base * 0.35 * k, z]));
    parts.push(cylX(base * 0.36 * k, base * 1.75 * k, c.dark, [0, y, -i * seg - 0.02]));
  }
  parts.push(G(box(base * 0.35, base * 0.35, seg * 0.4), c.glow, [0, -n * base * 0.12, -len - seg * 0.1]));
  return parts;
}

// Нога: бедро (до колена) + голень со ступнёй. Деление по высоте колена.
function legParts(L, w, d, c, toes) {
  const parts = [
    P(box(w * 0.9, L * 0.5, d), c.main, [0, -L * 0.23, 0.04]),
    P(box(w * 0.96, L * 0.12, d * 0.8), c.armor, [0, -L * 0.06, 0.05]),
    P(box(w * 0.5, L * 0.3, d * 0.3), c.dark, [0, -L * 0.3, -d * 0.45]),
    cylX(w * 0.36, w * 1.05, c.dark, [0, -L * 0.5, 0]),
    P(box(w * 0.55, L * 0.42, w * 0.58), c.dark, [0, -L * 0.71, -0.04]),
    P(cyl(w * 0.1, w * 0.1, L * 0.36, 5), c.light, [0, -L * 0.7, -d * 0.42]),
    P(box(w * 0.66, L * 0.07, d * 0.55), c.armor, [0, -L * 0.62, 0.02]),
    P(box(w * 0.92, L * 0.1, d * 0.7), c.main, [0, -L * 0.95, d * 0.14]),
  ];
  if (toes) for (const s of [-1, 0, 1]) parts.push(P(cone(w * 0.12, d * 0.35, 4), c.light, [s * w * 0.3, -L * 0.96, d * 0.55], [PI / 2, 0, 0]));
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
    // тазовый узел, к которому крепятся ноги
    cylX(bw * 0.2, bw * 1.0, c.dark, [0, L + 0.02, -bl * 0.05]),
  ];
  for (let i = 0; i < 3; i++) torso.push(P(box(bw * 0.22, bh * 0.16, bl * 0.18), c.armor, [0, ty + bh * 0.53 - i * 0.03, bl * 0.25 - i * bl * 0.25]));
  for (let i = 0; i < 3; i++) {
    const k = (i + 0.5) / 3;
    torso.push(P(box(bw * (0.55 - i * 0.05), bh * 0.5, neck * 0.42), i % 2 ? c.dark : c.main,
      [0, ty + bh * (0.2 + 0.25 * k), bl / 2 + neck * 0.8 * k], [-0.5, 0, 0]));
  }
  if (p.exhaust) for (const s of [-1, 1]) {
    torso.push(P(cyl(bw * 0.09, bw * 0.11, bh * 0.6, 6), c.dark, [s * bw * 0.28, ty + bh * 0.55, -bl * 0.3], [-0.35, 0, 0]));
    torso.push(G(cyl(bw * 0.07, bw * 0.07, 0.06, 6), c.glow, [s * bw * 0.28, ty + bh * 0.84, -bl * 0.4], [-0.35, 0, 0]));
  }
  // руки-манипуляторы: отдельные детали, плечо — шарнир
  const arms = [];
  for (const s of [-1, 1]) {
    const w = bw * 0.16;
    const parts = [
      cylX(w * 0.8, w * 1.3, c.dark, [0, 0, 0]),
      P(box(w, w, arm), c.main, [0, -arm * 0.39, arm * 0.31], [0.9, 0, 0]),
      P(box(w * 1.25, w * 0.6, arm * 0.5), c.light, [0, -arm * 0.88, arm * 0.66], [1.4, 0, 0]),
    ];
    for (const f of [-1, 1]) parts.push(P(cone(w * 0.32, arm * 0.4, 4), c.light, [f * w * 0.35, -arm * 1.18, arm * 0.74], [2.36, 0, 0]));
    if (p.blades) parts.push(G(box(w * 0.18, arm * 0.75, w * 0.5), c.glow, [s * w * 0.62, -arm * 0.75, arm * 0.55], [0.5, 0, 0]));
    arms.push({ p: [s * bw * 0.5, ty - bh * 0.05, bl * 0.4], side: s, parts });
  }
  // голова и отдельная челюсть (открывается при укусе, внутри — зубы)
  const head = {
    p: [0, ty + bh * 0.42, bl / 2 + neck * 0.75],
    parts: [
      P(box(hw, hh * 0.72, hl), c.main, [0, hh * 0.12, hl * 0.45]),
      P(box(hw * 1.04, hh * 0.18, hl * 0.6), c.armor, [0, hh * 0.5, hl * 0.35]),
      G(box(hw * 1.06, hh * 0.13, hl * 0.22), c.glow, [0, hh * 0.3, hl * 0.66]),
      G(box(hw * 0.6, hh * 0.05, hl * 0.6), c.glow, [0, -hh * 0.25, hl * 0.42]),
    ],
  };
  for (let i = 0; i < 4; i++) for (const s of [-1, 1])
    head.parts.push(P(cone(hw * 0.07, hh * 0.2, 4), c.light, [s * hw * 0.34, -hh * 0.33, hl * (0.3 + i * 0.2)], [PI, 0, 0]));
  const jaw = { p: [0, -hh * 0.22, hl * 0.04], parts: [
    P(box(hw * 0.86, hh * 0.3, hl * 0.92), c.dark, [0, -hh * 0.2, hl * 0.44]),
    P(box(hw * 0.9, hh * 0.08, hl * 0.5), c.armor, [0, -hh * 0.36, hl * 0.3]),
  ] };
  for (let i = 0; i < 4; i++) for (const s of [-1, 1])
    jaw.parts.push(P(cone(hw * 0.065, hh * 0.18, 4), c.light, [s * hw * 0.32, -hh * 0.0, hl * (0.2 + i * 0.2)]));
  const tail = { p: [0, ty + bh * 0.05, -bl / 2 + 0.1], parts: mechTail(bh * 0.4, tl, c), split: -tl / 2 };
  const legs = [];
  for (const [s, ph] of [[-1, 0], [1, PI]])
    legs.push({ p: [s * bw * 0.4, L, -bl * 0.05], ph, knee: -L * 0.5, parts: legParts(L, bw * 0.4, bl * 0.36, c, true) });
  extra && extra({ torso, head, jaw, tail, legs, arms, ty, p });
  return { torso, head, jaw, tail, legs, arms };
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
  for (const z of [-1, 1]) torso.push(cylX(bw * 0.14, bw * 0.95, c.dark, [0, L + 0.05, z * bl * 0.32]));
  const head = { p: p.headP(ty), parts: [
    P(box(hw, hh * 0.8, hl), c.main, [0, hh * 0.1, hl * 0.45]),
    G(box(hw * 1.06, hh * 0.14, hl * 0.2), c.glow, [0, hh * 0.18, hl * 0.62]),
  ] };
  const jaw = { p: [0, -hh * 0.3, hl * 0.05], parts: [
    P(box(hw * 0.8, hh * 0.3, hl * 0.82), c.dark, [0, -hh * 0.12, hl * 0.42]),
  ] };
  const tail = { p: [0, ty + bh * 0.1, -bl / 2 + 0.1], parts: mechTail(bh * 0.32, tl, c), split: -tl / 2 };
  const legs = [];
  for (const [x, z, ph] of [[-1, 1, 0], [1, 1, PI], [-1, -1, PI], [1, -1, 0]])
    legs.push({ p: [x * bw * 0.38, L, z * bl * 0.32], ph, knee: -L * 0.5, parts: legParts(L, bw * 0.3, bw * 0.32, c, false) });
  extra && extra({ torso, head, jaw, tail, legs, ty });
  return { torso, head, jaw, tail, legs, arms: [] };
}

// ---------- Виды ----------
// hp/dmg — для взрослого; spd/run — шаг/бег; reach — дальность удара от центра; r — радиус корпуса;
// h — высота для подписи; cam — размер для камеры; turn — скорость разворота; accel — разгон;
// weight — «вес» шага (звук, пыль, толчок); ride — где на спине сидит раптор [смещение назад, высота].
// front — серия ударов вперёд, rear — удары назад (включаются сами, когда враг сзади).
// area удара: front — ближайший впереди, cleave — все впереди, rear — все сзади, around — все вокруг, spot — пятно впереди, proj — снаряды.
export const SPECIES = {
  rex: {
    name: 'Мега-Рекс', diet: 'carn', hp: 1200, dmg: 135, spd: 6, run: 9.5,
    reach: 4.6, r: 1.8, h: 4.8, cam: 1.0, color: '#b8372c', glow: '#ff4a2a',
    turn: 3.2, accel: 2.6, weight: 1, ride: [-0.7, 3.35], rate: { def: 1200, dps: 124 },
    front: [
      { anim: 'bite', name: 'Гидро-укус', area: 'front', dmg: 1.0, cd: 1.0, lunge: 4, snd: 'crunch' },
      { anim: 'slap', name: 'Удар манипулятором', area: 'cleave', cone: 1.2, reach: 0.95, dmg: 0.75, cd: 0.85, fx: { kb: 3 }, snd: 'clank' },
      { anim: 'ram', name: 'Таран головой', area: 'front', cone: 0.9, reach: 1.1, dmg: 1.35, cd: 1.6, lunge: 15, fx: { kb: 6 }, snd: 'thud', stop: 0.08 },
    ],
    rear: [
      { anim: 'tailwhip', name: 'Хвост с разворота', area: 'rear', arc: 1.9, reach: 1.05, dmg: 1.0, cd: 1.2, fx: { kb: 5 }, snd: 'thud', stop: 0.06 },
    ],
    special: { type: 'clamp', anim: 'clamp', name: 'Мёртвая хватка', info: 'Вцепляется челюстями на 1.4 сек: враг обездвижен, Рекс трясёт и грызёт его', mult: 0.5, cd: 8, dur: 1.4, tick: 0.45, tickMult: 0.6 },
    ult: { type: 'buff', anim: 'roar', name: 'Форсаж реактора', info: 'Рёв и пар из труб: 5 сек урон +30%, удары чаще, скорость +15%', cd: 30, dur: 5 },
    passive: { name: 'Разгон реактора', info: 'Ниже 40% брони: урон +35%, удары на 25% чаще' },
    ai: 'brawler', aiInfo: 'Штурмовик: тяжёлый и неповоротливый, давит напролом, не отступает',
    desc: 'Тяжёлый штурмовой робот с гидравлическими челюстями. Медленно разворачивается, но если вцепился — не отпустит.',
    model: () => biped({
      L: 2.2, bw: 1.4, bh: 1.6, bl: 3.0, neck: 0.8, hw: 1.0, hh: 1.1, hl: 1.7, tl: 3.8, arm: 0.6, exhaust: true,
      c: { main: '#8a9099', armor: '#b8372c', dark: '#33373e', light: '#d7dbe0', glow: '#ff4a2a' },
    }),
  },
  raptor: {
    name: 'Раптор-Дрон', diet: 'carn', hp: 850, dmg: 48, spd: 10, run: 17,
    reach: 2.7, r: 0.8, h: 2.3, cam: 0.55, color: '#1f8fd6', glow: '#3ff2ff',
    turn: 11, accel: 9, weight: 0.35, ride: [-0.2, 1.55], rate: { def: 1060, dps: 132 },
    front: [
      { anim: 'clawR', side: -1, name: 'Клинок справа', area: 'front', cone: 1.2, dmg: 1.0, cd: 0.42, lunge: 5, snd: 'slash' },
      { anim: 'clawL', side: 1, name: 'Клинок слева', area: 'front', cone: 1.2, dmg: 1.0, cd: 0.42, lunge: 5, snd: 'slash' },
      { anim: 'kick', name: 'Серп-пинок', area: 'front', reach: 1.2, dmg: 1.6, cd: 0.75, lunge: 10, fx: { kb: 4 }, snd: 'slash', stop: 0.06 },
    ],
    rear: [
      { anim: 'tailflick', name: 'Хвост-плеть', area: 'rear', arc: 1.8, reach: 1.0, dmg: 0.9, cd: 0.55, fx: { sl: 0.6 }, snd: 'whip' },
    ],
    special: { type: 'leap', anim: 'leap', name: 'Прыжок-захват', info: 'Прыгает дугой на врага, садится ему на спину и 2.5 сек рубит клинками', mult: 1.5, cd: 7, range: 13, flight: 0.5, latch: 2.5, tick: 0.4, tickMult: 1.2, fx: { sl: 0.6 } },
    ult: { type: 'barrage', anim: 'launch', name: 'Залп микро-ракет', info: '6 самонаводящихся ракет вылетают из спины по ближайшим врагам', cd: 22, count: 6, range: 16, dmg: 0.9 },
    passive: { name: 'Реактивное уклонение', info: '20% шанс увернуться от любого удара' },
    ai: 'skirmisher', aiInfo: 'Налётчик: выбирает раненых, прыгает на спину, потом отскакивает по кругу',
    desc: 'Лёгкий скоростной дрон. Хрупкий, но быстрый — прыгает на врага и рубит его сверху.',
    model: () => biped({
      L: 1.15, bw: 0.55, bh: 0.62, bl: 1.35, neck: 0.65, hw: 0.42, hh: 0.45, hl: 0.9, tl: 2.0, arm: 0.7, blades: true,
      c: { main: '#a9b3bd', armor: '#1f8fd6', dark: '#2c3138', light: '#e4e8ec', glow: '#3ff2ff' },
    }, ({ torso, head, ty }) => {
      head.parts.push(P(box(0.06, 0.3, 0.5), '#1f8fd6', [0, 0.45, 0.25]));
      for (const s of [-1, 1]) {
        torso.push(P(cyl(0.09, 0.12, 0.45, 6), '#2c3138', [s * 0.18, ty + 0.3, -0.55], [-PI / 2 + 0.3, 0, 0]));
        torso.push(G(cyl(0.07, 0.07, 0.04, 6), '#3ff2ff', [s * 0.18, ty + 0.24, -0.78], [-PI / 2 + 0.3, 0, 0]));
        torso.push(P(box(0.12, 0.12, 0.42), '#1f8fd6', [s * 0.2, ty + 0.38, -0.1])); // пусковые трубы ракет
        torso.push(G(box(0.08, 0.08, 0.04), '#ffb03a', [s * 0.2, ty + 0.38, 0.12]));
      }
    }),
  },
  spino: {
    name: 'Спино-Крейсер', diet: 'carn', hp: 1050, dmg: 125, spd: 7.5, run: 12,
    reach: 5.2, r: 1.9, h: 5.6, cam: 1.05, color: '#2b5d9a', glow: '#59a8ff',
    turn: 5.5, accel: 5, weight: 0.85, ride: [-2.05, 2.75], rate: { def: 1080, dps: 140 },
    front: [
      { anim: 'bite', name: 'Клыки-резаки', area: 'front', reach: 0.95, dmg: 1.0, cd: 0.9, lunge: 4, snd: 'crunch' },
      { anim: 'claws2', name: 'Двойной удар когтями', area: 'cleave', cone: 0.8, reach: 0.85, dmg: 1.0, cd: 1.1, snd: 'slash' },
      { anim: 'shock', name: 'Электро-вспышка', area: 'around', reach: 0.85, dmg: 0.9, cd: 1.2, fx: { sl: 1.2 }, snd: 'zap' },
    ],
    rear: [
      { anim: 'saw', name: 'Хвост-пила', area: 'rear', arc: 2.2, reach: 0.95, dmg: 0.5, ticks: 3, cd: 1.3, fx: { sl: 0.5 }, snd: 'saw' },
    ],
    special: { type: 'bolt', anim: 'charge', name: 'Разряд-дуга', info: 'Парус заряжается, молния бьёт на 14 м ×2 и перескакивает на второго врага', mult: 2.0, cd: 7, range: 14, fx: { sl: 2 } },
    ult: { type: 'storm', anim: 'storm', name: 'Грозовая буря', info: '2 сек: 5 молний с неба бьют по врагам в 14 м', cd: 25, dur: 2, strikes: 5, range: 14, dmg: 0.6, fx: { sl: 1 } },
    passive: { name: 'Водяное охлаждение', info: 'В воде не замедляется и быстро чинит броню' },
    ai: 'circler', aiInfo: 'Дуэлянт: кусает и рвёт когтями, разворачивается пилой к врагу, издали бьёт молнией',
    desc: 'Крейсер с электрическим парусом и дисковой пилой на хвосте.',
    model: () => biped({
      L: 2.0, bw: 1.15, bh: 1.4, bl: 3.4, neck: 1.0, hw: 0.6, hh: 0.6, hl: 2.1, tl: 4.2, arm: 0.95,
      c: { main: '#6b7784', armor: '#2b5d9a', dark: '#262b33', light: '#c9d0d8', glow: '#59a8ff' },
    }, ({ torso, tail, ty }) => {
      // дисковая пила на конце хвоста — отдельная деталь, крутится
      const R = 1.05, sp = [0, -0.55, -4.75], parts = [];
      tail.parts.push(P(cyl(0.16, 0.16, 0.8, 6), '#262b33', [0, -0.55, -4.25], [PI / 2, 0, 0]));
      tail.parts.push(cylX(0.22, 0.5, '#2b5d9a', [0, -0.55, -4.75]));
      parts.push(P(cyl(R, R, 0.1, 12), '#c9d0d8', [0, 0, 0], [0, 0, PI / 2]));
      parts.push(G(cyl(R * 0.5, R * 0.5, 0.14, 12), '#59a8ff', [0, 0, 0], [0, 0, PI / 2]));
      for (let i = 0; i < 10; i++) {
        const a = i * PI * 2 / 10;
        parts.push(P(cone(0.2, 0.42, 4), '#e8edf2', [0, Math.cos(a) * (R + 0.1), Math.sin(a) * (R + 0.1)], [a, 0, 0]));
      }
      tail.saw = { p: sp, parts };
      const n = 7, top = ty + 0.7;
      for (let i = 0; i < n; i++) {
        const h = 2.1 * Math.sin(PI * (i + 0.5) / n) + 0.2, z = 1.6 - (i + 0.5) * 3.4 / n;
        torso.push(P(box(0.1, h, 3.4 / n - 0.06), i % 2 ? '#2b5d9a' : '#3a73b8', [0, top + h / 2 - 0.1, z]));
        torso.push(G(box(0.14, 0.1, 3.4 / n - 0.1), '#59a8ff', [0, top + h - 0.12, z]));
      }
    }),
  },
  trike: {
    name: 'Трицера-Танк', diet: 'herb', hp: 1050, dmg: 105, spd: 6, run: 9.5,
    reach: 4.2, r: 1.9, h: 3.8, cam: 0.9, color: '#d07a2a', glow: '#ffb22e',
    turn: 2.6, accel: 2.2, weight: 1, ride: [-0.7, 2.8], rate: { def: 1420, dps: 104 },
    front: [
      { anim: 'gore', name: 'Бур-таран', area: 'front', dmg: 1.0, cd: 1.2, lunge: 4, fx: { kb: 4 }, snd: 'thud' },
      { anim: 'hornswipe', name: 'Удар рогом вбок', area: 'cleave', cone: 1.3, dmg: 0.8, cd: 1.0, fx: { kb: 2, sl: 1 }, snd: 'clank' },
      { anim: 'rearstomp', name: 'Топот на дыбах', area: 'spot', at: 0.75, rad: 3.6, dmg: 1.2, cd: 1.7, fx: { kb: 5, sl: 1 }, snd: 'thud', stop: 0.08 },
    ],
    rear: [
      { anim: 'tailside', name: 'Хвостовой удар', area: 'rear', arc: 1.6, reach: 0.85, dmg: 0.8, cd: 1.0, fx: { kb: 3 }, snd: 'whip' },
    ],
    special: { type: 'dash', anim: 'paw', name: 'Турбо-таран', info: 'Роет землю, разгоняется и сносит всех на пути: отбрасывает и оглушает', mult: 2.0, cd: 7, speed: 22, dur: 0.55, range: 12, fx: { kb: 9, s: 0.6 } },
    ult: { type: 'stomp', anim: 'quake', name: 'Землетрясение', info: 'Встаёт на дыбы и бьёт о землю: урон всем в 9 м, отбрасывает и замедляет', cd: 25, radius: 9, dmg: 1.4, fx: { kb: 6, sl: 2 } },
    passive: { name: 'Фронтальная броня', info: '−40% урона от ударов спереди' },
    ai: 'rammer', aiInfo: 'Таран: пасётся, но чужого в 12 м разгоняет и таранит с дистанции',
    desc: 'Бронированный танк с тремя бурами. Очень неповоротлив — зато спереди почти неуязвим.',
    model: () => quad({
      L: 1.3, bw: 1.9, bh: 1.7, bl: 3.4, hw: 1.1, hh: 0.95, hl: 1.4, tl: 2.2,
      headP: ty => [0, ty - 0.1, 1.6],
      c: { main: '#9c8e74', armor: '#d07a2a', dark: '#3a3631', light: '#e0d6c2', glow: '#ffb22e' },
    }, ({ head }) => {
      head.parts.push(P(box(2.3, 1.9, 0.2), '#d07a2a', [0, 0.75, -0.05], [-0.45, 0, 0]));
      head.parts.push(P(box(2.0, 1.6, 0.22), '#3a3631', [0, 0.75, 0.05], [-0.45, 0, 0]));
      head.parts.push(G(box(2.34, 0.12, 0.24), '#ffb22e', [0, 1.6, -0.45], [-0.45, 0, 0]));
      head.parts.push(P(cone(0.3, 0.6, 4), '#3a3631', [0, -0.1, 1.55], [PI / 2 + 0.3, 0, 0]));
      for (const s of [-1, 1]) head.parts.push(P(cone(0.16, 1.6, 6), '#d7dbe0', [s * 0.35, 0.95, 0.9], [1.0, 0, 0]));
      head.parts.push(P(cone(0.13, 0.5, 6), '#d7dbe0', [0, 0.4, 1.35], [0.6, 0, 0]));
    }),
  },
  stego: {
    name: 'Стего-Бастион', diet: 'herb', hp: 1100, dmg: 170, spd: 5, run: 7.5,
    reach: 5.2, r: 1.9, h: 4.6, cam: 0.9, color: '#4f7a3a', glow: '#66ff7a',
    turn: 2.4, accel: 2, weight: 0.95, ride: [-2.1, 2.65], rate: { def: 1450, dps: 100 },
    front: [
      { anim: 'spikes', name: 'Залп шипов', area: 'proj', count: 3, range: 9, cone: 0.7, dmg: 0.45, cd: 1.4, fx: { sl: 0.5 }, color: '#66ff7a', snd: 'shoot' },
      { anim: 'bash', name: 'Толчок пластинами', area: 'cleave', cone: 1.2, reach: 0.75, dmg: 0.7, cd: 1.1, lunge: 6, fx: { kb: 4 }, snd: 'thud' },
    ],
    rear: [
      { anim: 'tailslam', name: 'Хвост-молот', area: 'rear', arc: 1.2, dmg: 1.0, cd: 1.6, fx: { kb: 5 }, snd: 'thud', stop: 0.08 },
      { anim: 'tailside', name: 'Боковой хлёст', area: 'rear', arc: 2.0, reach: 0.9, dmg: 0.8, cd: 1.0, fx: { kb: 3 }, snd: 'whip' },
    ],
    special: { type: 'area', anim: 'quills', name: 'Шипы во все стороны', info: 'Пригибается и выстреливает шипы по кругу, отбрасывает', mult: 1.2, cd: 8, radius: 6.5, fx: { kb: 5 } },
    ult: { type: 'fortress', anim: 'fortress', name: 'Крепость', info: '7 сек: урон −55%, шипы возвращают 30%', cd: 28, dur: 7 },
    passive: { name: 'Шипы-контрудар', info: 'Возвращает 15% полученного урона обидчику' },
    ai: 'bastion', aiInfo: 'Бастион: держит точку, поворачивается к врагу задом и бьёт хвостом',
    desc: 'Крепость на ногах. Самый неповоротливый: главное оружие — хвост-молот сзади.',
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
      tail.parts.push(P(box(0.9, 0.9, 0.9), '#2f3430', [0, 0.1, -3.45]));
      tail.parts.push(G(box(0.5, 0.5, 0.5), '#66ff7a', [0, 0.1, -3.45]));
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) tail.parts.push(P(cone(0.18, 0.9, 5), '#d4d9cf', [dx * 0.65, 0.1 + dy * 0.65, -3.45], [dy * 1.57, 0, -dx * 1.57]));
      for (const s of [-1, 1]) for (const z of [-2.6, -2.95]) {
        tail.parts.push(P(cone(0.11, 0.9, 5), '#d4d9cf', [s * 0.4, 0.15, z], [0, 0, -s * 1.1]));
      }
    }),
  },
};
export const SP_KEYS = Object.keys(SPECIES);
for (const S of Object.values(SPECIES)) S.all = S.front.concat(S.rear); // общий номер удара для сети

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
  if (!parts.length) return null;
  const metal = parts.filter(g => !g.userData.glow), glow = parts.filter(g => g.userData.glow);
  if (!metal.length) return { geo: mergeGeometries(glow), glowOnly: true };
  const a = mergeGeometries(metal);
  if (!glow.length) return { geo: a, glow: false };
  return { geo: mergeGeometries([a, mergeGeometries(glow)], true), glow: true };
}
const center = (g, axis) => { g.computeBoundingBox(); return (g.boundingBox.min[axis] + g.boundingBox.max[axis]) / 2; };
function geos(key) {
  if (cache[key]) return cache[key];
  const d = SPECIES[key].model();
  const split = d.tail.split;
  const base = [], tip = [];
  for (const g of d.tail.parts) (center(g, 'z') < split ? tip : base).push(g);
  for (const g of tip) g.translate(0, 0, -split);
  const legs = d.legs.map(l => {
    const up = [], lo = [];
    for (const g of l.parts) (center(g, 'y') < l.knee - 1e-3 ? lo : up).push(g);
    for (const g of lo) g.translate(0, -l.knee, 0);
    return { p: l.p, ph: l.ph, knee: l.knee, upper: mergeSplit(up), lower: mergeSplit(lo) };
  });
  return (cache[key] = {
    torso: mergeSplit(d.torso),
    head: { p: d.head.p, g: mergeSplit(d.head.parts) },
    jaw: { p: d.jaw.p, g: mergeSplit(d.jaw.parts) },
    tail: { p: d.tail.p, g: mergeSplit(base) },
    tip: { p: [0, 0, split], g: mergeSplit(tip) },
    saw: d.tail.saw ? { p: [d.tail.saw.p[0], d.tail.saw.p[1], d.tail.saw.p[2] - split], g: mergeSplit(d.tail.saw.parts) } : null,
    arms: d.arms.map(a => ({ p: a.p, side: a.side, g: mergeSplit(a.parts) })),
    legs,
  });
}

export function buildDino(key) {
  const Gm = geos(key), S = SPECIES[key];
  const meshes = [];
  const mk = g => {
    const m = new THREE.Mesh(g.geo, g.glowOnly ? GLOW : g.glow ? [METAL, GLOW] : METAL);
    m.userData.mat = m.material; meshes.push(m); return m;
  };
  const grp = (parent, p, g, order) => { const o = new THREE.Group(); o.position.set(...p); if (order) o.rotation.order = order; if (g) o.add(mk(g)); parent.add(o); return o; };
  const root = new THREE.Group(), body = new THREE.Group();
  body.rotation.order = 'YXZ';
  root.add(body);
  body.add(mk(Gm.torso));
  const head = grp(body, Gm.head.p, Gm.head.g, 'YXZ');
  const jaw = grp(head, Gm.jaw.p, Gm.jaw.g);
  const tail = grp(body, Gm.tail.p, Gm.tail.g, 'YXZ');
  const tip = grp(tail, Gm.tip.p, Gm.tip.g, 'YXZ');
  const saw = Gm.saw ? grp(tip, Gm.saw.p, Gm.saw.g) : null;
  const arms = Gm.arms.map(a => ({ pivot: grp(body, a.p, a.g, 'ZXY'), side: a.side }));
  const legs = Gm.legs.map(l => {
    const pv = grp(root, l.p, l.upper, 'YXZ');
    const kn = grp(pv, [0, l.knee, 0], l.lower);
    return { pivot: pv, knee: kn, ph: l.ph, base: l.p, side: Math.sign(l.p[0]), front: l.p[2] > 0.01, n: undefined };
  });
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.scale.setScalar(S.r * 1.3); shadow.position.y = 0.08; shadow.renderOrder = -1;
  root.add(shadow);
  const zs = legs.map(l => l.base[2]);
  return {
    root, body, head, jaw, tail, tip, saw, arms, legs, meshes,
    headP: Gm.head.p.slice(), hipH: legs[0].base[1], frontZ: Math.max(...zs), hindZ: Math.min(...zs), quad: legs.length > 2,
  };
}

// Белая вспышка при попадании
export function setFlash(m, on) {
  for (const mesh of m.meshes) mesh.material = on ? FLASH : mesh.userData.mat;
}
