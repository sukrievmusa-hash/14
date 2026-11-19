// Мир: холмистый рельеф, озёра, деревья, камни, еда (кусты и мясо).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const WATER_Y = -2.0;
export const MAP_R = 180;
const LAKES = [[55, -50, 32, 7], [-75, 65, 24, 6], [-20, -125, 20, 5.5], [110, 80, 18, 5]];

// Детерминированный генератор: у всех игроков одинаковая карта
function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; }

export function height(x, z) {
  let h = 2.0 * Math.sin(x * 0.031) * Math.cos(z * 0.027)
    + 1.1 * Math.sin(x * 0.083 + 1.3) * Math.sin(z * 0.071 + 0.4)
    + 0.4 * Math.sin((x + z) * 0.15);
  for (const [lx, lz, r, dep] of LAKES) {
    const d = Math.hypot(x - lx, z - lz);
    if (d < r) { const k = 1 - d / r; h -= dep * k * k * (3 - 2 * k); }
  }
  const d = Math.hypot(x, z);
  if (d > MAP_R - 15) h += (d - MAP_R + 15) ** 2 * 0.03;
  return h;
}
export const inWater = (x, z) => height(x, z) < WATER_Y - 0.4;

function colored(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    const R = rng(12345);
    this.vmat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

    // ----- Рельеф -----
    const SIZE = 440, SEG = 88;
    const tg = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG).rotateX(-Math.PI / 2);
    const pos = tg.attributes.position, col = new Float32Array(pos.count * 3);
    const c = new THREE.Color(), sand = new THREE.Color('#d9c58c'), g1 = new THREE.Color('#6aa648'),
      g2 = new THREE.Color('#4c8636'), rock = new THREE.Color('#8b8573'), mud = new THREE.Color('#9a8a5c');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = height(x, z);
      pos.setY(i, h);
      const d = Math.hypot(x, z);
      if (d > MAP_R - 5) c.copy(rock);
      else if (h < WATER_Y + 0.5) c.copy(sand);
      else if (h < WATER_Y + 1.1) c.copy(mud).lerp(g1, 0.4);
      else c.copy(g1).lerp(g2, 0.5 + 0.5 * Math.sin(x * 0.11) * Math.cos(z * 0.13));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    tg.computeVertexNormals();
    scene.add(new THREE.Mesh(tg, this.vmat));

    // ----- Вода -----
    const water = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: '#3b8fc4', transparent: true, opacity: 0.82 }));
    water.position.y = WATER_Y; scene.add(water);

    const landPoint = (minR = 0, maxR = MAP_R - 12) => {
      for (let t = 0; t < 40; t++) {
        const a = R() * Math.PI * 2, r = minR + Math.sqrt(R()) * (maxR - minR);
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (height(x, z) > WATER_Y + 0.7) return [x, z];
      }
      return [0, 0];
    };
    this.randLand = () => {
      for (let t = 0; t < 40; t++) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (MAP_R - 45);
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (height(x, z) > WATER_Y + 0.7) return [x, z];
      }
      return [0, 0];
    };

    // ----- Деревья (instanced = 3 вызова отрисовки на весь лес) -----
    const N = 230;
    const trunkM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.5, 3, 5),
      new THREE.MeshLambertMaterial({ color: '#6b4a2e', flatShading: true }), N);
    const leafMat = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true });
    const roundM = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.3, 0), leafMat, N);
    const pineM = new THREE.InstancedMesh(new THREE.ConeGeometry(2.2, 5.5, 6), leafMat, N);
    const o = new THREE.Object3D(), lc = new THREE.Color();
    let nr = 0, np = 0;
    this.trees = [];
    this.grid = new Map();
    for (let i = 0; i < N; i++) {
      const [x, z] = landPoint(14);
      const h = height(x, z), s = 0.8 + R() * 0.8;
      o.position.set(x, h + 1.4 * s, z); o.rotation.set(0, R() * 6, 0); o.scale.setScalar(s); o.updateMatrix();
      trunkM.setMatrixAt(i, o.matrix);
      const pine = R() < 0.4;
      o.position.y = h + (pine ? 5.2 : 4.2) * s; o.updateMatrix();
      lc.set(pine ? '#2f6b3a' : '#4f9a3c').offsetHSL((R() - 0.5) * 0.05, 0, (R() - 0.5) * 0.12);
      const crown = pine ? pineM : roundM, ci = pine ? np++ : nr++;
      crown.setMatrixAt(ci, o.matrix); crown.setColorAt(ci, lc);
      const t = { x, z, r: 0.6 * s, cr: 2.4 * s, i, crown, ci, mc: o.matrix.clone(), mt: new THREE.Matrix4(), hidden: false };
      trunkM.getMatrixAt(i, t.mt);
      this.trees.push(t);
      const k = this.key(x, z);
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(t);
    }
    roundM.count = nr; pineM.count = np;
    this.trunkM = trunkM; this.crowns = [roundM, pineM]; this.zeroM = new THREE.Matrix4().makeScale(0, 0, 0); this.hiddenTrees = new Set();
    for (const m of [trunkM, roundM, pineM]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; scene.add(m); }

    // ----- Камни -----
    const NR = 70;
    const rockM = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0),
      new THREE.MeshLambertMaterial({ color: '#9a9488', flatShading: true }), NR);
    for (let i = 0; i < NR; i++) {
      const [x, z] = landPoint(10);
      o.position.set(x, height(x, z) + 0.2, z); o.rotation.set(R() * 3, R() * 3, R() * 3);
      o.scale.set(0.6 + R() * 1.6, 0.5 + R() * 0.8, 0.6 + R() * 1.6); o.updateMatrix();
      rockM.setMatrixAt(i, o.matrix);
    }
    scene.add(rockM);

    // ----- Кусты с ягодами (еда травоядных) -----
    const bushParts = [colored(new THREE.IcosahedronGeometry(1, 0), '#3f8f3a')];
    for (let i = 0; i < 6; i++) {
      const a = i * 1.05, b = new THREE.BoxGeometry(0.25, 0.25, 0.25);
      b.translate(Math.cos(a) * 0.85, 0.2 + (i % 2) * 0.4, Math.sin(a) * 0.85);
      bushParts.push(colored(b, '#d6334a'));
    }
    this.NP = 70;
    this.bushM = new THREE.InstancedMesh(mergeGeometries(bushParts), this.vmat, this.NP);
    this.plants = [];
    for (let i = 0; i < this.NP; i++) { const p = { i, active: false, t: 0, x: 0, z: 0 }; this.plants.push(p); this.placePlant(p); }
    scene.add(this.bushM);

    // ----- Мясо (еда хищников) -----
    const meatGeo = mergeGeometries([
      colored(new THREE.BoxGeometry(1.6, 0.6, 1.0), '#a8323a'),
      colored(new THREE.BoxGeometry(1.2, 0.25, 0.8).translate(0, 0.4, 0), '#c9505a'),
      colored(new THREE.CylinderGeometry(0.12, 0.12, 2.4, 5).rotateZ(Math.PI / 2).translate(0, 0.3, 0.2), '#f1eadb'),
      colored(new THREE.CylinderGeometry(0.1, 0.1, 1.6, 5).rotateZ(Math.PI / 2).translate(0, 0.25, -0.3), '#f1eadb'),
    ]);
    this.meats = [];
    for (let i = 0; i < 30; i++) {
      const mesh = new THREE.Mesh(meatGeo, this.vmat); mesh.visible = false; scene.add(mesh);
      this.meats.push({ mesh, active: false, bites: 0, x: 0, z: 0, s: 1, natural: false, life: 0 });
    }
    this.naturalTimer = 0;
  }

  // Прячем деревья между камерой и игроком, чтобы не загораживали обзор
  clearView(cam, tx, tz) {
    const ax = cam.x, az = cam.z, dx = tx - ax, dz = tz - az, L2 = dx * dx + dz * dz || 1;
    const now = new Set();
    const steps = Math.ceil(Math.sqrt(L2) / 15) + 1;
    for (let k = 0; k <= steps; k++) {
      const px = ax + dx * k / steps, pz = az + dz * k / steps;
      const cx = Math.floor(px / 20), cz = Math.floor(pz / 20);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const list = this.grid.get((cx + i + 50) * 1000 + cz + j + 50); if (!list) continue;
        for (const t of list) {
          let u = ((t.x - ax) * dx + (t.z - az) * dz) / L2; u = Math.max(0, Math.min(1, u));
          const d = Math.hypot(ax + dx * u - t.x, az + dz * u - t.z);
          if (d < t.cr + 1.5) now.add(t);
        }
      }
    }
    let dirty = false;
    for (const t of this.hiddenTrees) if (!now.has(t)) { this.trunkM.setMatrixAt(t.i, t.mt); t.crown.setMatrixAt(t.ci, t.mc); dirty = true; }
    for (const t of now) if (!this.hiddenTrees.has(t)) { this.trunkM.setMatrixAt(t.i, this.zeroM); t.crown.setMatrixAt(t.ci, this.zeroM); dirty = true; }
    this.hiddenTrees = now;
    if (dirty) { this.trunkM.instanceMatrix.needsUpdate = true; for (const c of this.crowns) c.instanceMatrix.needsUpdate = true; }
  }

  key(x, z) { return (Math.floor(x / 20) + 50) * 1000 + Math.floor(z / 20) + 50; }

  // Деревья не дают пройти насквозь
  collide(p, r) {
    const cx = Math.floor(p.x / 20), cz = Math.floor(p.z / 20);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const list = this.grid.get((cx + i + 50) * 1000 + cz + j + 50);
      if (!list) continue;
      for (const t of list) {
        const dx = p.x - t.x, dz = p.z - t.z, d = Math.hypot(dx, dz), m = t.r + r * 0.6;
        if (d < m && d > 0.001) { p.x = t.x + dx / d * m; p.z = t.z + dz / d * m; }
      }
    }
  }

  placePlant(p) {
    const [x, z] = this.randLand();
    p.x = x; p.z = z; p.active = true;
    const o = new THREE.Object3D();
    o.position.set(x, height(x, z) + 0.5, z); o.rotation.y = Math.random() * 6; o.scale.setScalar(0.9 + Math.random() * 0.4); o.updateMatrix();
    this.bushM.setMatrixAt(p.i, o.matrix); this.bushM.instanceMatrix.needsUpdate = true;
  }
  hidePlant(p) {
    p.active = false; p.t = 25 + Math.random() * 15;
    const o = new THREE.Object3D(); o.scale.setScalar(0); o.updateMatrix();
    this.bushM.setMatrixAt(p.i, o.matrix); this.bushM.instanceMatrix.needsUpdate = true;
  }

  spawnMeat(x, z, s = 1, bites = 2, natural = false) {
    let m = this.meats.find(m => !m.active);
    if (!m) m = this.meats.find(m => m.natural) || this.meats[0];
    Object.assign(m, { active: true, x, z, s, bites, natural, life: natural ? 9999 : 120 });
    m.mesh.visible = true;
    m.mesh.position.set(x, height(x, z) + 0.2 * s, z);
    m.mesh.rotation.y = Math.random() * 6; m.mesh.scale.setScalar(s);
  }
  spawnCarcass(x, z, scale) { this.spawnMeat(x, z, 0.7 + scale * 0.9, 4, false); }

  update(dt) {
    for (const p of this.plants) if (!p.active && (p.t -= dt) <= 0) this.placePlant(p);
    this.naturalTimer -= dt;
    if (this.naturalTimer <= 0) {
      this.naturalTimer = 4;
      if (this.meats.filter(m => m.active && m.natural).length < 14) { const [x, z] = this.randLand(); this.spawnMeat(x, z, 1, 2, true); }
    }
    for (const m of this.meats) if (m.active && !m.natural && (m.life -= dt) <= 0) { m.active = false; m.mesh.visible = false; }
  }

  // Съесть ближайшую подходящую еду. Возвращает 'plant' | 'meat' | null
  tryEat(diet, x, z, r) {
    if (diet === 'herb') {
      for (const p of this.plants) if (p.active && Math.hypot(p.x - x, p.z - z) < r + 1.2) { this.hidePlant(p); return 'plant'; }
    } else {
      for (const m of this.meats) if (m.active && Math.hypot(m.x - x, m.z - z) < r + 1.2 * m.s) {
        if (--m.bites <= 0) { m.active = false; m.mesh.visible = false; }
        else m.mesh.scale.setScalar(m.s * (0.6 + 0.1 * m.bites));
        return 'meat';
      }
    }
    return null;
  }
}
