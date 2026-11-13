import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { doorsOn, WALL_SIDES, type FloorPlan, type LandscapeId } from '@vernissage/schema';
import { canvas, rng, shade, speckle, toTexture } from './textures';
import { buildSkyline } from './skyline';

/** Ground texture covering one repeat. */
function groundTexture(base: string, kind: 'grass' | 'sand', seed: number): THREE.Texture {
  const size = 512;
  const [c, ctx] = canvas(size);
  const r = rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 40; i++) {
    const x = r() * size, y = r() * size, rad = 30 + r() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, shade(base, (r() - 0.5) * (kind === 'grass' ? 0.12 : 0.08)));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = g;
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) ctx.fillRect(x - rad + dx, y - rad + dy, rad * 2, rad * 2);
  }
  ctx.globalAlpha = 1;
  if (kind === 'grass') {
    for (let i = 0; i < 9000; i++) {
      ctx.strokeStyle = shade(base, (r() - 0.4) * 0.16);
      ctx.globalAlpha = 0.25 + r() * 0.35;
      const x = r() * size, y = r() * size;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 5); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else speckle(ctx, size, base, 0.15, 14000, r);
  return toTexture(c);
}

function disc(radius: number, y: number, mat: THREE.Material, segments = 64) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(radius, segments), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  return m;
}

/** a sector of the compass to keep clear (the view of the city) */
type Avoid = { angle: number; half: number } | undefined;

function scatter(geo: THREE.BufferGeometry, mat: THREE.Material, n: number, cx: number, cz: number, r0: number, r1: number, seed: number,
  scale: (r: () => number) => THREE.Vector3, y = 0, avoid?: Avoid): THREE.InstancedMesh {
  const inst = new THREE.InstancedMesh(geo, mat, n);
  const r = rng(seed);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    let a = r() * Math.PI * 2;
    // fold angles inside the avoided sector out to the rest of the circle (same number of draws, so seeds stay in step)
    if (avoid) a = avoid.angle + avoid.half + (a / (Math.PI * 2)) * (Math.PI * 2 - 2 * avoid.half);
    const d = r0 + Math.sqrt(r()) * (r1 - r0);
    p.set(cx + Math.cos(a) * d, y, cz + Math.sin(a) * d);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI * 2);
    m.compose(p, q, scale(r));
    inst.setMatrixAt(i, m);
  }
  inst.instanceMatrix.needsUpdate = true;
  return inst;
}

/** leaves and needles whiten under snow */
interface Snowable { m: THREE.MeshStandardMaterial; base: THREE.Color; k: number }

function trees(snowy: Snowable[], cx: number, cz: number, r0: number, r1: number, n: number, seed: number, avoid?: Avoid) {
  const g = new THREE.Group();
  const flat = (geo: THREE.BufferGeometry) => (geo.index ? geo.toNonIndexed() : geo);
  const trunkGeo = new THREE.CylinderGeometry(0.1, 0.17, 2.4, 6).translate(0, 1.2, 0);
  // a maple-ish crown: three lumps
  const crownGeo = mergeGeometries([
    flat(new THREE.IcosahedronGeometry(1.35, 1)).translate(0, 3.4, 0),
    flat(new THREE.IcosahedronGeometry(1.0, 1)).translate(0.9, 2.9, 0.3),
    flat(new THREE.IcosahedronGeometry(0.95, 1)).translate(-0.8, 3.0, -0.4),
    flat(new THREE.IcosahedronGeometry(0.8, 1)).translate(0.1, 4.3, 0.1),
  ]);
  // a spruce: four tiers of skirts
  const pineGeo = mergeGeometries([0, 1, 2, 3].map((i) => flat(new THREE.ConeGeometry(1.5 - i * 0.32, 1.9, 8)).translate(0, 2.2 + i * 1.15, 0)));
  const trunk = new THREE.MeshStandardMaterial({ color: '#5f4530', roughness: 1 });
  const mk = (color: string, k: number) => { const m = new THREE.MeshStandardMaterial({ color, roughness: 0.95, flatShading: true }); snowy.push({ m, base: m.color.clone(), k }); return m; };
  const leaf = mk('#4f7d45', 0.55), pine = mk('#335c3c', 0.75);
  const size = (r: () => number) => { const s = 0.8 + r() * 1.0; return new THREE.Vector3(s, s * (0.9 + r() * 0.35), s); };
  // the same seed for trunks and crowns, so they line up
  g.add(scatter(trunkGeo, trunk, n, cx, cz, r0, r1, seed, size, 0, avoid));
  const crowns = scatter(crownGeo, leaf, n, cx, cz, r0, r1, seed, size, 0, avoid);
  const pines = scatter(pineGeo, pine, n, cx, cz, r0, r1, seed, size, 0, avoid);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < n; i++) (i % 5 < 2 ? crowns : pines).setMatrixAt(i, zero);
  crowns.instanceMatrix.needsUpdate = pines.instanceMatrix.needsUpdate = true;
  g.add(crowns, pines);
  return g;
}

/** A band of land around the horizon whose top edge is a silhouette: a treeline, or a range of hills. */
function ridge(radius: number, height: number, rough: number, teeth: number, color: string, seed: number, avoid?: Avoid): THREE.Mesh {
  const seg = 360;
  const r = rng(seed);
  const waves = Array.from({ length: 7 }, (_, i) => ({ f: 2 + Math.floor(r() * (3 + i * 3)), p: r() * 6.28, a: 1 / (1 + i) }));
  const pos: number[] = [], idx: number[] = [];
  const start = avoid ? avoid.angle + avoid.half : 0, sweep = avoid ? Math.PI * 2 - 2 * avoid.half : Math.PI * 2;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, a = start + t * sweep;
    let hgt = 0;
    for (const w of waves) hgt += Math.sin(a * w.f + w.p) * w.a;
    // the band dips to the water at both ends of an open arc
    const ends = avoid ? Math.min(1, Math.min(t, 1 - t) * 14) : 1;
    const top = height * (1 - rough + rough * (0.5 + hgt * 0.22)) * ends + (teeth ? r() * teeth : 0);
    const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
    pos.push(x, -1, z, x, Math.max(0.2, top), z);
    if (i < seg) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide }));
}

export interface Landscape {
  group: THREE.Group;
  /** night 0..1 (city lights), snow 0..1 (white ground and trees) */
  set(night: number, snow: number): void;
  /** the hour on Toronto's clock (the ferry keeps a timetable) */
  setHour(hour: number): void;
  update(t: number): void;
}

/**
 * Scenery outside the building: it stands on a small grassy island in a lake, with a dock, woods on the far
 * shore and hills behind them. With "toronto" the city rises across the water to the north (`north` is the
 * horizontal direction the building's windows mostly face), and the shore behind and beside is low and wooded.
 */
export function buildLandscape(plan: FloorPlan, kind: LandscapeId, north: THREE.Vector3): Landscape {
  const g = new THREE.Group();
  g.name = 'landscape';
  const b = plan.bounds;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const R0 = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 2;
  const R = R0 + 9;
  const snowy: Snowable[] = [];
  const ground = (base: string, k: 'grass' | 'sand', tile: number, seed: number) => {
    const map = groundTexture(base, k, seed);
    map.repeat.set(tile, tile);
    return new THREE.MeshStandardMaterial({ map, roughness: 1 });
  };
  const at = <T extends THREE.Object3D>(m: T) => { m.position.x += cx; m.position.z += cz; return m; };
  const city = kind === 'toronto';
  const angle = Math.atan2(north.z, north.x);
  const avoid = city ? { angle, half: (78 * Math.PI) / 180 } : undefined;

  // the island: lawn, a sandy rim sloping into the water, a few boulders
  g.add(at(disc(R, -0.03, ground('#7f9c58', 'grass', R / 3, 3))));
  const beach = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.4, R + 5, 0.9, 72, 1, true), ground('#cdbb93', 'sand', 14, 4));
  beach.position.y = -0.47;
  g.add(at(beach));
  const snow = new THREE.MeshStandardMaterial({ color: '#f4f7fa', roughness: 0.9, transparent: true, opacity: 0, depthWrite: false });
  const snowCap = at(disc(R + 0.6, -0.015, snow));
  snowCap.renderOrder = 1; snowCap.visible = false;
  g.add(snowCap);
  const rockMat = new THREE.MeshStandardMaterial({ color: '#8a857c', roughness: 1, flatShading: true });
  snowy.push({ m: rockMat, base: rockMat.color.clone(), k: 0.5 });
  g.add(scatter(new THREE.DodecahedronGeometry(1, 0), rockMat, 26, cx, cz, R - 1, R + 3.5, 51, (r) => { const s = 0.3 + r() * 0.9; return new THREE.Vector3(s * (1 + r()), s * 0.6, s); }, -0.2));
  g.add(trees(snowy, cx, cz, R0 + 1.5, R - 1.5, 22, 21, avoid));

  // a wooden dock towards the view, with a rowing boat tied up
  const wood = new THREE.MeshStandardMaterial({ color: '#8a6a4a', roughness: 0.9 });
  snowy.push({ m: wood, base: wood.color.clone(), k: 0.6 });
  const dock = new THREE.Group();
  const len = 14;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(2, 0.12, len), wood); deck.position.set(0, 0.28, -len / 2); dock.add(deck);
  for (let i = 0; i < 5; i++) for (const sx of [-0.95, 0.95]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.6, 6), wood);
    post.position.set(sx, -0.2, -1 - i * 3.1); dock.add(post);
  }
  const boat = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#b8423a', roughness: 0.6, side: THREE.DoubleSide }));
  boat.scale.set(0.75, 0.5, 2.1); boat.position.set(1.9, 0.05, -len + 3);
  dock.add(boat);
  // the dock runs out along north, a little to one side so it does not sit in the middle of the view
  const side = new THREE.Vector3(-north.z, 0, north.x);
  dock.position.set(cx, 0, cz).addScaledVector(north, R - 1).addScaledVector(side, Math.min(9, R0 * 0.45));
  dock.rotation.y = Math.atan2(-north.x, -north.z);
  g.add(dock);

  // the far shores
  const woods = ridge(city ? 520 : 820, city ? 20 : 26, 0.35, 5, '#3f5f3f', 71, avoid);
  const woodsMat = woods.material as THREE.MeshStandardMaterial;
  snowy.push({ m: woodsMat, base: woodsMat.color.clone(), k: 0.45 });
  g.add(at(woods));
  if (!city) {
    const hillA = ridge(1300, 150, 0.75, 0, '#587a5c', 72), hillB = ridge(3200, 430, 0.8, 0, '#6a8580', 73);
    for (const h of [hillA, hillB]) { const m = h.material as THREE.MeshStandardMaterial; snowy.push({ m, base: m.color.clone(), k: 0.7 }); g.add(at(h)); }
    g.add(trees(snowy, cx, cz, 700, 815, 170, 23));
  }

  const skyline = city ? buildSkyline() : undefined;
  if (skyline) {
    skyline.group.position.set(cx, 0, cz);
    skyline.group.rotation.y = Math.atan2(-north.x, -north.z); // the city is modelled to the north (-z)
    g.add(skyline.group);
  }

  const white = new THREE.Color('#eef2f6');
  let snowNow = -1;
  return {
    group: g,
    set(night, s) {
      skyline?.set(night);
      if (Math.abs(s - snowNow) < 0.003) return;
      snowNow = s;
      snow.opacity = s * 0.95; snowCap.visible = s > 0.01;
      for (const e of snowy) e.m.color.copy(e.base).lerp(white, s * e.k);
    },
    setHour(h) { skyline?.setHour(h); },
    update(t) {
      skyline?.update(t);
      boat.position.y = 0.05 + Math.sin(t * 1.1) * 0.03; boat.rotation.z = Math.sin(t * 0.8) * 0.04;
    },
  };
}

const POT_COLORS = ['#c9734f', '#efece6', '#4a4f55'];

/** A potted plant (pot + leafy clusters), about 1.3 m tall. */
function plant(seed: number): THREE.Group {
  const r = rng(seed);
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.42, 16), new THREE.MeshStandardMaterial({ color: POT_COLORS[seed % POT_COLORS.length], roughness: 0.8 }));
  pot.position.y = 0.21;
  g.add(pot);
  const soil = new THREE.Mesh(new THREE.CircleGeometry(0.2, 16), new THREE.MeshStandardMaterial({ color: '#3b2b1f', roughness: 1 }));
  soil.rotation.x = -Math.PI / 2; soil.position.y = 0.4;
  g.add(soil);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.025, 0.7, 6), new THREE.MeshStandardMaterial({ color: '#5a4a32', roughness: 1 }));
  stem.position.y = 0.75;
  g.add(stem);
  const leafMat = new THREE.MeshStandardMaterial({ color: '#3f7a46', roughness: 0.85, flatShading: true });
  const leafMat2 = new THREE.MeshStandardMaterial({ color: '#58955a', roughness: 0.85, flatShading: true });
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22 + r() * 0.12, 0), i % 2 ? leafMat : leafMat2);
    const a = r() * Math.PI * 2, d = 0.08 + r() * 0.16;
    leaf.position.set(Math.cos(a) * d, 0.75 + r() * 0.55, Math.sin(a) * d);
    leaf.scale.set(1, 0.8 + r() * 0.5, 1);
    leaf.rotation.set(r(), r(), r());
    g.add(leaf);
  }
  return g;
}

/** what hangs on the walls, for keeping plants out of its way: a point on the wall and how far it reaches either side */
export interface WallObject { x: number; z: number; reach: number }
/** a stretch of closed wall with nothing on it: its middle, a little out from the wall, and its length */
export interface EmptyStretch { x: number; z: number; length: number }

/** Plants in room corners that are next to neither a doorway nor an artwork. */
export function buildPlants(plan: FloorPlan, hung: WallObject[] = [], empty: EmptyStretch[] = []): THREE.Group {
  const g = new THREE.Group();
  g.name = 'plants';
  let seed = 1;
  for (const pr of plan.rooms) {
    const { room, centre } = pr;
    const hw = room.width / 2 - 0.55, hd = room.depth / 2 - 0.55;
    const doorNear = (x: number, z: number) => WALL_SIDES.some((side) => doorsOn(plan, room.id, side).some((d) => {
      const w = pr.walls[side];
      const px = w.start.x + w.along.x * d.offset, pz = w.start.z + w.along.z * d.offset;
      return Math.hypot(px - x, pz - z) < d.width / 2 + 1.0;
    }));
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = centre.x + sx * hw, z = centre.z + sz * hd;
      // a plant needs about a metre clear of any picture or label, or it crowds it
      if (doorNear(x, z) || hung.some((o) => Math.hypot(o.x - x, o.z - z) < o.reach + 1.1)) continue;
      const p = plant(seed++);
      p.position.set(x, 0, z);
      p.scale.setScalar(Math.min(1.25, room.height / 3.6));
      g.add(p);
    }
  }
  // a bare stretch of wall gets a plant in its middle; a long one gets a larger plant
  for (const e of empty) {
    const p = plant(seed++);
    p.position.set(e.x, 0, e.z);
    p.scale.setScalar(Math.min(1.6, 1.05 + e.length * 0.07));
    g.add(p);
  }
  return g;
}
