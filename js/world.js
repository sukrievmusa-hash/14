// Мир: холмы, река, озёра, леса, папоротники (еда травоядных), туши (еда хищников).
// Карта одинаковая у всех игроков: всё строится из формул и генератора с фиксированным зерном.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const WATER_Y = 0;
export const MAP_R = 260;
const LAKES = [[95, -105, 34, 3.4], [-120, 95, 28, 3.0], [-35, 150, 18, 2.4], [150, 120, 22, 2.8], [-160, -140, 20, 2.6]];
const RIVER = [[-270, -40], [-190, -10], [-120, -55], [-50, -30], [10, 10], [60, -10], [95, -105]];
const RIVER2 = [[60, -10], [110, 40], [150, 120]];
const RW = 8;

function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; }
const sm = k => k * k * (3 - 2 * k);
function segDist(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz;
  let u = ((x - a[0]) * dx + (z - a[1]) * dz) / L2; u = u < 0 ? 0 : u > 1 ? 1 : u;
  return Math.hypot(x - a[0] - dx * u, z - a[1] - dz * u);
}
function lineDist(x, z, L) { let d = 1e9; for (let i = 0; i < L.length - 1; i++) d = Math.min(d, segDist(x, z, L[i], L[i + 1])); return d; }

export function height(x, z) {
  let h = 3.4 + 2.6 * Math.sin(x * 0.018) * Math.cos(z * 0.015)
    + 1.4 * Math.sin(x * 0.05 + 1.3) * Math.sin(z * 0.043 + 0.4)
    + 0.5 * Math.sin((x + z) * 0.11) + 0.3 * Math.sin(x * 0.23 - z * 0.19);
  const hill = Math.sin(x * 0.012 + 2.0) * Math.cos(z * 0.0105 - 1.0);
  if (hill > 0) h += 11 * hill * hill;
  const rd = Math.min(lineDist(x, z, RIVER), lineDist(x, z, RIVER2) * 1.15);
  if (rd < RW * 2.2) { const k = sm(1 - rd / (RW * 2.2)); h -= (h + 1.9) * k; }
  for (const [lx, lz, r, dep] of LAKES) {
    const d = Math.hypot(x - lx, z - lz);
    if (d < r) { const k = sm(1 - d / r); h -= (h + dep) * k; }
  }
  const d = Math.hypot(x, z);
  if (d > MAP_R - 30) h += (d - MAP_R + 30) ** 2 * 0.045;
  return h;
}
export const depthAt = (x, z) => WATER_Y - height(x, z);
// густота леса
const forestK = (x, z) => Math.sin(x * 0.021 + 1) * Math.cos(z * 0.017) + 0.55 * Math.sin(x * 0.061) * Math.sin(z * 0.052 + 2);

function colored(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g.attributes.uv) g.deleteAttribute('uv');
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const s = Math.sin(i * 7.31) * 0.5; a[i * 3] = c.r * (1 + s * 0.08); a[i * 3 + 1] = c.g * (1 + s * 0.08); a[i * 3 + 2] = c.b * (1 + s * 0.08); }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const CELL = 20, key = (x, z) => (Math.floor(x / CELL) + 100) * 1000 + Math.floor(z / CELL) + 100;

export class World {
  constructor(scene) {
    this.scene = scene;
    const R = rng(777);
    this.vmat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const o = new THREE.Object3D(), col = new THREE.Color();

    // ----- Рельеф -----
    const SIZE = 600, SEG = 120;
    const tg = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG).rotateX(-Math.PI / 2);
    const pos = tg.attributes.position, carr = new Float32Array(pos.count * 3);
    const sand = new THREE.Color('#cdb784'), mud = new THREE.Color('#7d6e46'), g1 = new THREE.Color('#5f9440'),
      g2 = new THREE.Color('#41722f'), dry = new THREE.Color('#9a9a52'), rock = new THREE.Color('#857d6c'), forest = new THREE.Color('#3b5f2a');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = height(x, z);
      pos.setY(i, h);
      const d = Math.hypot(x, z), f = forestK(x, z);
      if (d > MAP_R - 12 || h > 13) col.copy(rock).lerp(g2, d > MAP_R - 12 ? 0 : 0.2);
      else if (h < WATER_Y + 0.5) col.copy(sand).lerp(mud, h < WATER_Y - 0.5 ? 0.6 : 0);
      else if (h < WATER_Y + 1.2) col.copy(mud).lerp(g1, 0.5);
      else {
        col.copy(g1).lerp(g2, 0.5 + 0.5 * Math.sin(x * 0.11) * Math.cos(z * 0.13));
        if (f > 0.3) col.lerp(forest, Math.min(1, (f - 0.3) * 2));
        else if (h > 9) col.lerp(dry, Math.min(1, (h - 9) / 5));
      }
      carr[i * 3] = col.r; carr[i * 3 + 1] = col.g; carr[i * 3 + 2] = col.b;
    }
    tg.setAttribute('color', new THREE.BufferAttribute(carr, 3));
    tg.computeVertexNormals();
    this.ground = new THREE.Mesh(tg, this.vmat);
    scene.add(this.ground);

    // ----- Вода -----
    this.waterMat = new THREE.MeshLambertMaterial({ color: '#3a86b0', transparent: true, opacity: 0.8 });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE).rotateX(-Math.PI / 2), this.waterMat);
    water.position.y = WATER_Y; scene.add(water);

    const land = (minH = WATER_Y + 0.8, maxR = MAP_R - 32) => {
      for (let t = 0; t < 60; t++) {
        const a = R() * Math.PI * 2, r = Math.sqrt(R()) * maxR, x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (height(x, z) > minH) return [x, z];
      }
      return [0, 0];
    };
    this.grid = new Map();
    const addGrid = t => { const k = key(t.x, t.z); if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(t); };

    // ----- Деревья: хвойные, лиственные, саговники. Каждый тип — один вызов отрисовки -----
    const N = 760;
    const leaf = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true });
    const trunkM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.5, 4, 5).translate(0, 2, 0), new THREE.MeshLambertMaterial({ color: '#5e4128', flatShading: true }), N);
    const pineG = mergeGeometries([new THREE.ConeGeometry(2.6, 4.2, 7).translate(0, 4.6, 0), new THREE.ConeGeometry(2.0, 3.6, 7).translate(0, 6.8, 0), new THREE.ConeGeometry(1.3, 3, 7).translate(0, 8.8, 0)]);
    const roundG = mergeGeometries([new THREE.IcosahedronGeometry(2.6, 0).translate(0, 5.6, 0), new THREE.IcosahedronGeometry(1.9, 0).translate(1.4, 6.6, 0.5), new THREE.IcosahedronGeometry(1.7, 0).translate(-1.2, 6.3, -0.8)]);
    const cycG = (() => { const parts = []; for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; parts.push(new THREE.ConeGeometry(0.45, 3.4, 4).rotateZ(Math.PI / 2 + 0.5).rotateY(a).translate(Math.cos(a) * 1.4, 3.8, -Math.sin(a) * 1.4)); } return mergeGeometries(parts.map(p => p.index ? p.toNonIndexed() : p)); })();
    const crowns = [new THREE.InstancedMesh(pineG, leaf, N), new THREE.InstancedMesh(roundG, leaf, N), new THREE.InstancedMesh(cycG, leaf, N)];
    const cnt = [0, 0, 0];
    this.trees = [];
    for (let i = 0; i < N; i++) {
      let x, z, ok = false;
      for (let t = 0; t < 30 && !ok; t++) {
        [x, z] = land(WATER_Y + 1.2, MAP_R - 22);
        const f = forestK(x, z);
        ok = R() < (f > 0.3 ? 0.95 : f > 0 ? 0.25 : 0.06);
      }
      const h = height(x, z), s = 0.75 + R() * 0.8, f = forestK(x, z);
      const type = h > 9 || f > 0.8 ? 0 : R() < 0.22 ? 2 : R() < 0.45 ? 0 : 1;
      o.position.set(x, h - 0.2, z); o.rotation.set(0, R() * 6, 0); o.scale.set(s, s * (type === 2 ? 0.55 : 1), s); o.updateMatrix();
      trunkM.setMatrixAt(i, o.matrix);
      o.scale.set(s, s, s); o.updateMatrix();
      col.set(['#2e5d34', '#4c8a35', '#5d8a2a'][type]).offsetHSL((R() - 0.5) * 0.04, 0, (R() - 0.5) * 0.12);
      const ci = cnt[type]++;
      crowns[type].setMatrixAt(ci, o.matrix); crowns[type].setColorAt(ci, col);
      const t = { x, z, r: 0.45 * s, cr: 2.6 * s, i, crown: crowns[type], ci, mc: o.matrix.clone(), mt: new THREE.Matrix4() };
      trunkM.getMatrixAt(i, t.mt);
      this.trees.push(t); addGrid(t);
    }
    crowns.forEach((c, k) => { c.count = cnt[k]; });
    this.trunkM = trunkM; this.crowns = crowns; this.zeroM = new THREE.Matrix4().makeScale(0, 0, 0); this.hidden = new Set();
    for (const m of [trunkM, ...crowns]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; scene.add(m); }

    // ----- Камни -----
    const NR = 150;
    const rockM = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: '#8f897b', flatShading: true }), NR);
    this.rocks = [];
    for (let i = 0; i < NR; i++) {
      const [x, z] = land(WATER_Y - 1);
      const s = 0.5 + R() * R() * 3.2;
      o.position.set(x, height(x, z) + 0.1, z); o.rotation.set(R() * 3, R() * 3, R() * 3);
      o.scale.set(s * (0.8 + R() * 0.6), s * (0.5 + R() * 0.5), s * (0.8 + R() * 0.6)); o.updateMatrix();
      rockM.setMatrixAt(i, o.matrix);
      if (s > 1.3) { const t = { x, z, r: s * 0.8, rock: true }; this.rocks.push(t); addGrid(t); }
    }
    scene.add(rockM);

    // ----- Трава (только украшение) -----
    const NG = 1600;
    const grassG = mergeGeometries([0, 1, 2].map(i => new THREE.ConeGeometry(0.12, 0.9, 3).translate(Math.cos(i * 2.1) * 0.18, 0.4, Math.sin(i * 2.1) * 0.18).rotateZ((i - 1) * 0.25)).map(g => g.toNonIndexed()));
    const grassM = new THREE.InstancedMesh(grassG, new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), NG);
    for (let i = 0; i < NG; i++) {
      const [x, z] = land(WATER_Y + 0.6);
      const s = 0.7 + R() * 0.9;
      o.position.set(x, height(x, z), z); o.rotation.set(0, R() * 6, 0); o.scale.setScalar(s); o.updateMatrix();
      grassM.setMatrixAt(i, o.matrix);
      grassM.setColorAt(i, col.set('#6f9e3e').offsetHSL((R() - 0.5) * 0.06, 0, (R() - 0.5) * 0.15));
    }
    scene.add(grassM);

    // ----- Папоротники и кусты: еда травоядных. Съеденные отрастают -----
    const NP = 340;
    const fernParts = [];
    for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; fernParts.push(colored(new THREE.ConeGeometry(0.35, 1.9, 3).scale(1, 1, 0.25).rotateX(-1.0).rotateY(a).translate(Math.sin(a) * 0.6, 0.55, Math.cos(a) * 0.6), i % 2 ? '#4f9a32' : '#6ab43c')); }
    fernParts.push(colored(new THREE.IcosahedronGeometry(0.5, 0).translate(0, 0.3, 0), '#3c7a2a'));
    for (let i = 0; i < 6; i++) fernParts.push(colored(new THREE.IcosahedronGeometry(0.13, 0).translate(Math.cos(i) * 0.5, 0.75 + (i % 2) * 0.15, Math.sin(i) * 0.5), '#c9472f'));
    this.fernM = new THREE.InstancedMesh(mergeGeometries(fernParts), this.vmat, NP);
    this.plants = [];
    this.pgrid = new Map();
    for (let i = 0; i < NP; i++) {
      let x, z;
      for (let t = 0; t < 20; t++) { [x, z] = land(WATER_Y + 0.7, MAP_R - 30); if (R() < (forestK(x, z) > -0.2 ? 0.8 : 0.35)) break; }
      const p = { i, x, z, food: 1, s: 1.1 + R() * 0.9, rot: R() * 6 };
      this.plants.push(p);
      const k = key(x, z); if (!this.pgrid.has(k)) this.pgrid.set(k, []); this.pgrid.get(k).push(p);
      this.drawPlant(p);
    }
    scene.add(this.fernM);

    // ----- Туши -----
    const meat = [
      colored(new THREE.IcosahedronGeometry(1, 1).scale(0.75, 0.42, 1.25).translate(0, 0.25, 0), '#8a3428'),
      colored(new THREE.IcosahedronGeometry(1, 0).scale(0.5, 0.3, 0.6).translate(0.3, 0.35, 0.4), '#a8463a'),
    ];
    for (let i = 0; i < 5; i++) meat.push(colored(new THREE.TorusGeometry(0.55, 0.05, 4, 8, Math.PI).rotateY(Math.PI / 2).translate(0, 0.35, -0.6 + i * 0.3), '#eae0c8'));
    meat.push(colored(new THREE.CylinderGeometry(0.06, 0.06, 1.8, 5).rotateX(Math.PI / 2).translate(0, 0.62, 0), '#eae0c8'));
    const carcG = mergeGeometries(meat);
    this.carcasses = [];
    for (let i = 0; i < 40; i++) {
      const mesh = new THREE.Mesh(carcG, this.vmat); mesh.visible = false; scene.add(mesh);
      this.carcasses.push({ mesh, active: false, x: 0, z: 0, meat: 0, max: 1, size: 1, life: 0, sp: '' });
    }
    this.mapCanvas = null;
  }

  drawPlant(p) {
    const k = 0.25 + 0.75 * p.food;
    const o = this._o || (this._o = new THREE.Object3D());
    o.position.set(p.x, height(p.x, p.z) - 0.05, p.z); o.rotation.set(0, p.rot, 0); o.scale.set(p.s * k, p.s * k * k, p.s * k); o.updateMatrix();
    this.fernM.setMatrixAt(p.i, o.matrix); this.fernM.instanceMatrix.needsUpdate = true;
  }

  // ---------- Поиск ----------
  near(gridMap, x, z, R, filter) {
    const out = [], c = Math.ceil(R / CELL);
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let i = -c; i <= c; i++) for (let j = -c; j <= c; j++) {
      const list = gridMap.get((cx + i + 100) * 1000 + cz + j + 100); if (!list) continue;
      for (const t of list) if (Math.hypot(t.x - x, t.z - z) < R && (!filter || filter(t))) out.push(t);
    }
    return out;
  }
  nearestPlant(x, z, R) {
    let best = null, bd = R;
    for (const p of this.near(this.pgrid, x, z, R, p => p.food > 0.05)) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  nearestCarcass(x, z, R) {
    let best = null, bd = R;
    for (const c of this.carcasses) if (c.active && c.meat > 0) { const d = Math.hypot(c.x - x, c.z - z) - c.size * 0.8; if (d < bd) { bd = d; best = c; } }
    return best;
  }
  // точка воды рядом (берём кольцо точек вокруг)
  waterNear(x, z, R) {
    if (depthAt(x, z) > 0.15) return [x, z];
    let best = null, bd = 1e9;
    for (let r = R * 0.35; r <= R; r += R * 0.33) for (let a = 0; a < 12; a++) {
      const px = x + Math.cos(a / 12 * Math.PI * 2) * r, pz = z + Math.sin(a / 12 * Math.PI * 2) * r;
      if (depthAt(px, pz) > 0.15 && r < bd) { bd = r; best = [px, pz]; }
    }
    return best;
  }
  // ближайшая вода для нюха: ищем по спирали дальше
  findWater(x, z, maxR = 160) {
    for (let r = 6; r <= maxR; r += 6) for (let a = 0; a < 24; a++) {
      const px = x + Math.cos(a / 24 * Math.PI * 2) * r, pz = z + Math.sin(a / 24 * Math.PI * 2) * r;
      if (depthAt(px, pz) > 0.3) return [px, pz];
    }
    return null;
  }

  eatPlant(p, amt) { p.food = Math.max(0, p.food - amt); this.drawPlant(p); }

  spawnCarcass(x, z, size, meat, sp) {
    let c = this.carcasses.find(c => !c.active) || this.carcasses.reduce((a, b) => (a.life < b.life ? a : b));
    Object.assign(c, { active: true, x, z, size, meat, max: meat, life: 420, sp });
    c.mesh.visible = true;
    c.mesh.position.set(x, height(x, z) - 0.05 * size, z);
    c.mesh.rotation.set(0, Math.random() * 6, 0);
    c.mesh.scale.setScalar(size);
    return c;
  }
  eatCarcass(c, amt) {
    c.meat = Math.max(0, c.meat - amt);
    const k = 0.35 + 0.65 * c.meat / c.max;
    c.mesh.scale.set(c.size * (0.6 + 0.4 * k), c.size * k, c.size * (0.7 + 0.3 * k));
    if (c.meat <= 0.01) { c.active = false; c.mesh.visible = false; }
  }

  // ---------- Столкновения ----------
  collide(p, r) {
    const cx = Math.floor(p.x / CELL), cz = Math.floor(p.z / CELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const list = this.grid.get((cx + i + 100) * 1000 + cz + j + 100); if (!list) continue;
      for (const t of list) {
        const dx = p.x - t.x, dz = p.z - t.z, d = Math.hypot(dx, dz), m = t.r + r * 0.5;
        if (d < m && d > 0.001) { p.x = t.x + dx / d * m; p.z = t.z + dz / d * m; }
      }
    }
    const d = Math.hypot(p.x, p.z);
    if (d > MAP_R - 18) { p.x *= (MAP_R - 18) / d; p.z *= (MAP_R - 18) / d; }
  }

  // Прячем деревья между камерой и игроком
  clearView(cam, tx, tz, extra = 0) {
    const ax = cam.x, az = cam.z, dx = tx - ax, dz = tz - az, L2 = dx * dx + dz * dz || 1;
    const now = new Set(), steps = Math.ceil(Math.sqrt(L2) / 12) + 1;
    for (let k = 0; k <= steps; k++) {
      const px = ax + dx * k / steps, pz = az + dz * k / steps;
      const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const list = this.grid.get((cx + i + 100) * 1000 + cz + j + 100); if (!list) continue;
        for (const t of list) {
          if (t.rock) continue;
          let u = ((t.x - ax) * dx + (t.z - az) * dz) / L2; u = Math.max(0, Math.min(1.05, u));
          if (Math.hypot(ax + dx * u - t.x, az + dz * u - t.z) < t.cr + 1 + extra) now.add(t);
        }
      }
    }
    let dirty = false;
    for (const t of this.hidden) if (!now.has(t)) { this.trunkM.setMatrixAt(t.i, t.mt); t.crown.setMatrixAt(t.ci, t.mc); dirty = true; }
    for (const t of now) if (!this.hidden.has(t)) { this.trunkM.setMatrixAt(t.i, this.zeroM); t.crown.setMatrixAt(t.ci, this.zeroM); dirty = true; }
    this.hidden = now;
    if (dirty) { this.trunkM.instanceMatrix.needsUpdate = true; for (const c of this.crowns) c.instanceMatrix.needsUpdate = true; }
  }

  update(dt) {
    // папоротники отрастают (около 3 минут с нуля)
    this._pt = (this._pt || 0) + dt;
    if (this._pt > 1) {
      for (const p of this.plants) if (p.food < 1) { p.food = Math.min(1, p.food + this._pt / 180); this.drawPlant(p); }
      this._pt = 0;
    }
    for (const c of this.carcasses) if (c.active && (c.life -= dt) <= 0) { c.active = false; c.mesh.visible = false; }
  }

  // Картинка карты для экрана «Карта»
  mapImage(N = 220) {
    if (this.mapCanvas) return this.mapCanvas;
    const cv = document.createElement('canvas'); cv.width = cv.height = N;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(N, N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = (i / N - 0.5) * 2 * MAP_R, z = (j / N - 0.5) * 2 * MAP_R, h = height(x, z), k = (j * N + i) * 4;
      let c;
      if (Math.hypot(x, z) > MAP_R - 14) c = [70, 64, 56];
      else if (h < WATER_Y) c = [58, 120, 170];
      else if (h < WATER_Y + 0.6) c = [200, 184, 130];
      else if (forestK(x, z) > 0.3) c = [52, 92, 44];
      else { const t = Math.min(1, h / 16); c = [92 + 70 * t, 140 + 10 * t, 70 + 40 * t]; }
      img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return (this.mapCanvas = cv);
  }
}
