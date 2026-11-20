// Визуальные эффекты: искры, пыль, пар, кольца, молнии, следы ударов, вспышки, снаряды.
// Всё заранее создано пулами (частицы — одним InstancedMesh), чтобы в бою ничего не создавалось и телефон не тормозил.
import * as THREE from 'three';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

class Particles {
  constructor(scene, n, geo, color, kind) {
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color }), n);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < n; i++) this.mesh.setMatrixAt(i, ZERO);
    scene.add(this.mesh);
    this.p = Array.from({ length: n }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 1, g: 0, drag: 0, r: 0 }));
    this.i = 0; this.kind = kind; this.alive = 0;
  }
  emit(x, y, z, vx, vy, vz, s, life, g, drag) {
    const p = this.p[this.i++ % this.p.length];
    if (p.life <= 0) this.alive++;
    Object.assign(p, { life, max: life, x, y, z, vx, vy, vz, s, g, drag, r: Math.random() * 6 });
  }
  update(dt) {
    if (!this.alive) return;
    const M = this.mesh; let alive = 0;
    for (let i = 0; i < this.p.length; i++) {
      const p = this.p[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { M.setMatrixAt(i, ZERO); continue; }
      alive++;
      const k = 1 - p.life / p.max, dr = Math.exp(-p.drag * dt);
      p.vx *= dr; p.vz *= dr; p.vy = p.vy * dr - p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      // пыль сначала растёт, потом тает; искры просто гаснут
      const sc = this.kind === 'dust' ? p.s * (0.5 + k * 1.1) * (1 - k * k) : p.s * (1 - k);
      p.r += dt * 4;
      _e.set(p.r, p.r * 0.7, 0); _q.setFromEuler(_e);
      M.setMatrixAt(i, _m.compose(_p.set(p.x, p.y, p.z), _q, _s.set(sc, sc, sc)));
    }
    this.alive = alive;
    M.instanceMatrix.needsUpdate = true;
  }
}

export function createFx(scene, camera, height) {
  const cube = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  const spark = new Particles(scene, 90, cube, 0xffc23a, 'spark');
  const dustP = new Particles(scene, 90, new THREE.BoxGeometry(0.5, 0.5, 0.5), 0x9a8f78, 'dust');
  const steamP = new Particles(scene, 40, new THREE.BoxGeometry(0.5, 0.5, 0.5), 0xe8eef2, 'dust');
  const ground = (x, y, z) => Math.max(y, height(x, z) + 0.2);

  // Молнии: отрезки одним InstancedMesh с цветом на каждый отрезок
  const boltGeo = new THREE.BoxGeometry(0.14, 0.14, 1).translate(0, 0, 0.5);
  const NB = 72, boltM = new THREE.InstancedMesh(boltGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), NB);
  boltM.frustumCulled = false;
  const boltL = new Float32Array(NB); let boltI = 0, boltAlive = 0;
  const _c = new THREE.Color();
  for (let i = 0; i < NB; i++) { boltM.setMatrixAt(i, ZERO); boltM.setColorAt(i, _c.set(0xffffff)); }
  scene.add(boltM);
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _z = new THREE.Vector3(0, 0, 1);

  // Кольца-волны
  const ringGeo = new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2);
  const rings = [];
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    m.visible = false; scene.add(m); rings.push({ m, life: 0, max: 0.45, R: 1 });
  }
  let ringI = 0;

  // Следы ударов: светящаяся дуга (как след клинка/хвоста)
  const arcGeos = {};
  const arcGeo = len => arcGeos[len] || (arcGeos[len] = new THREE.RingGeometry(0.72, 1, 24, 1, 0, len).rotateX(-Math.PI / 2));
  const slashes = [];
  for (let i = 0; i < 10; i++) {
    const holder = new THREE.Object3D();
    const m = new THREE.Mesh(arcGeo(2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    holder.add(m); holder.visible = false; scene.add(holder);
    slashes.push({ holder, m, life: 0, max: 0.22, R: 1 });
  }
  let slashI = 0;

  // Вспышки попаданий
  const flashGeo = new THREE.IcosahedronGeometry(1, 0);
  const flashes = [];
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(flashGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.visible = false; scene.add(m); flashes.push({ m, life: 0, max: 0.14, s: 1 });
  }
  let flashI = 0;

  // Снаряды: шипы и ракеты летят по дуге и наводятся на цель
  const projGeo = new THREE.ConeGeometry(0.16, 0.9, 5).rotateX(Math.PI / 2);
  const projMats = {};
  const projs = [];
  for (let i = 0; i < 28; i++) { const m = new THREE.Mesh(projGeo); m.visible = false; scene.add(m); projs.push({ m, t: 0, T: 1, on: false }); }
  let projI = 0;

  const fx = {
    sparks(x, y, z, s = 1, n = 8, up = 1) {
      y = ground(x, y, z);
      for (let i = 0; i < n; i++) spark.emit(x, y, z, (Math.random() - 0.5) * 10 * s, (2 + Math.random() * 7) * s * up, (Math.random() - 0.5) * 10 * s, s * (0.6 + Math.random() * 0.6), 0.45 + Math.random() * 0.2, 22, 0.5);
    },
    // клуб пыли у земли (шаг, приземление, удар)
    dust(x, y, z, s = 1, n = 4, spread = 1) {
      y = ground(x, y, z) - 0.1;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.28, v = (1 + Math.random() * 2) * spread;
        dustP.emit(x + Math.sin(a) * 0.3 * s, y, z + Math.cos(a) * 0.3 * s, Math.sin(a) * v, 0.8 + Math.random() * 1.2, Math.cos(a) * v, s * (0.6 + Math.random() * 0.5), 0.5 + Math.random() * 0.35, -0.5, 3);
      }
    },
    // волна пыли по кругу (топот, землетрясение)
    dustRing(x, z, R, n = 14, s = 1) {
      const y = height(x, z);
      for (let i = 0; i < n; i++) {
        const a = i / n * 6.28 + Math.random() * 0.3;
        dustP.emit(x + Math.sin(a) * R * 0.3, y, z + Math.cos(a) * R * 0.3, Math.sin(a) * R * 2.2, 1 + Math.random() * 2, Math.cos(a) * R * 2.2, s * (0.8 + Math.random() * 0.6), 0.55 + Math.random() * 0.3, 0, 3.5);
      }
    },
    steam(x, y, z, s = 1, n = 3, vy = 3) {
      for (let i = 0; i < n; i++) steamP.emit(x, y, z, (Math.random() - 0.5) * 1.5, vy * (0.7 + Math.random() * 0.6), (Math.random() - 0.5) * 1.5, s * (0.5 + Math.random() * 0.5), 0.6 + Math.random() * 0.3, -1, 1.5);
    },
    ring(x, y, z, R, color, dur = 0.45) {
      const r = rings[ringI++ % rings.length];
      r.life = r.max = dur; r.R = R; r.m.visible = true; r.m.position.set(x, Math.max(y, height(x, z)) + 0.35, z); r.m.material.color.set(color);
    },
    bolt(x1, y1, z1, x2, y2, z2, color = '#7af6ff', segs = 3, jag = 0.7) {
      _c.set(color);
      let px = x1, py = y1, pz = z1;
      for (let i = 1; i <= segs; i++) {
        const k = i / segs, j = i < segs ? jag : 0;
        const nx = x1 + (x2 - x1) * k + (Math.random() - 0.5) * j, ny = y1 + (y2 - y1) * k + (Math.random() - 0.5) * j, nz = z1 + (z2 - z1) * k + (Math.random() - 0.5) * j;
        const idx = boltI++ % NB;
        _a.set(nx - px, ny - py, nz - pz); const len = Math.max(0.05, _a.length()); _a.normalize();
        _q.setFromUnitVectors(_z, _a);
        boltM.setMatrixAt(idx, _m.compose(_p.set(px, py, pz), _q, _s.set(1, 1, len)));
        boltM.setColorAt(idx, _c);
        boltL[idx] = 0.16; boltAlive++;
        px = nx; py = ny; pz = nz;
      }
      boltM.instanceMatrix.needsUpdate = true; if (boltM.instanceColor) boltM.instanceColor.needsUpdate = true;
    },
    // След удара: дуга радиуса R вокруг точки. yaw — куда смотрит робот, back — дуга сзади,
    // roll — наклон плоскости дуги (0 — горизонтально, ±π/2 — вертикально).
    slash(x, y, z, yaw, roll, R, len, color, back = false) {
      const S = slashes[slashI++ % slashes.length];
      const L = Math.round(len * 4) / 4;
      S.m.geometry = arcGeo(L);
      S.m.rotation.set(0, (back ? Math.PI / 2 : -Math.PI / 2) - L / 2, 0);
      S.holder.position.set(x, y, z);
      S.holder.rotation.set(0, yaw, roll, 'YZX');
      S.m.material.color.set(color);
      S.life = S.max; S.R = R; S.holder.visible = true;
    },
    flash(x, y, z, s = 1, color = '#ffffff') {
      const F = flashes[flashI++ % flashes.length];
      F.life = F.max; F.s = s; F.m.visible = true; F.m.position.set(x, y, z); F.m.material.color.set(color);
    },
    // Снаряд: from → цель (функция, возвращающая точку), по дуге с подъёмом arc; onHit — по прилёту
    proj(o) {
      const P = projs[projI++ % projs.length];
      const c = o.color || '#ffb03a';
      P.m.material = projMats[c] || (projMats[c] = new THREE.MeshBasicMaterial({ color: c }));
      Object.assign(P, { t: 0, T: o.T || 0.35, on: true, x0: o.x, y0: o.y, z0: o.z, arc: o.arc || 0, to: o.to, onHit: o.onHit, smoke: !!o.smoke, sc: o.s || 1, side: o.side || 0 });
      P.m.visible = true; P.m.position.set(o.x, o.y, o.z); P.m.scale.setScalar(P.sc);
    },
    update(dt) {
      spark.update(dt); dustP.update(dt); steamP.update(dt);
      if (boltAlive) {
        let a = 0;
        for (let i = 0; i < NB; i++) if (boltL[i] > 0) { boltL[i] -= dt; if (boltL[i] <= 0) boltM.setMatrixAt(i, ZERO); else a++; }
        boltAlive = a; boltM.instanceMatrix.needsUpdate = true;
      }
      for (const r of rings) {
        if (r.life <= 0) continue;
        r.life -= dt; const k = 1 - r.life / r.max;
        r.m.scale.setScalar(0.3 * r.R + k * r.R); r.m.material.opacity = 1 - k;
        if (r.life <= 0) r.m.visible = false;
      }
      for (const S of slashes) {
        if (S.life <= 0) continue;
        S.life -= dt; const k = 1 - S.life / S.max;
        S.m.scale.setScalar(S.R * (0.88 + k * 0.18)); S.m.material.opacity = 0.9 * (1 - k * k);
        if (S.life <= 0) S.holder.visible = false;
      }
      for (const F of flashes) {
        if (F.life <= 0) continue;
        F.life -= dt; const k = 1 - F.life / F.max;
        F.m.scale.setScalar(F.s * (0.4 + k * 1.2)); F.m.material.opacity = 1 - k;
        if (F.life <= 0) F.m.visible = false;
      }
      for (const P of projs) {
        if (!P.on) continue;
        P.t += dt; const u = Math.min(1, P.t / P.T);
        const tgt = P.to();
        // квадратичная кривая: старт → контрольная точка (выше и вбок) → цель
        const cx = (P.x0 + tgt[0]) / 2 + P.side, cy = Math.max(P.y0, tgt[1]) + P.arc, cz = (P.z0 + tgt[2]) / 2 + P.side * 0.5;
        const a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
        const nx = a * P.x0 + b * cx + c * tgt[0], ny = a * P.y0 + b * cy + c * tgt[1], nz = a * P.z0 + b * cz + c * tgt[2];
        _b.set(nx, ny, nz);
        if (_b.distanceToSquared(P.m.position) > 1e-6) P.m.lookAt(_b);
        P.m.position.copy(_b);
        if (P.smoke && Math.random() < 0.7) steamP.emit(nx, ny, nz, 0, 0.3, 0, 0.35, 0.35, -0.5, 2);
        if (u >= 1) { P.on = false; P.m.visible = false; P.onHit && P.onHit(); }
      }
    },
  };
  return fx;
}
