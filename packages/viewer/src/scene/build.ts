import * as THREE from 'three';
import {
  WALL_SIDES, WALL_THICKNESS, freeSegments, blockersOn, computeFloorPlan, doorsOn, entranceOf, hangWall, pointOnWall, roomPlants, wallHasWindows, collisionSegments,
  type ArtAsset, type Artwork, type FloorPlan, type HungWork, type Segment, type SiteData, type StyleDef, type WallFrame,
} from '@vernissage/schema';
import { floorTexture, lightPoolTexture, wallTexture, worldUV } from './textures';
import { labelTexture } from './labels';
import { buildPlants } from './environment';

export interface ArtworkInstance {
  id: string;
  art: Artwork;
  asset?: ArtAsset;
  roomId: string;
  hung: HungWork;
  group: THREE.Group;
  picture: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  pool: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  /** coloured rim shown when the work is hovered or selected */
  highlight: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  /** world-space centre of the picture */
  centre: THREE.Vector3;
  /** unit vector pointing out of the wall */
  normal: THREE.Vector3;
  /** where a visitor would stand to look at it */
  viewpoint: THREE.Vector3;
  /** spot light anchor on the ceiling */
  spotAnchor: THREE.Vector3;
  index: number;
}

export interface BuiltGallery {
  root: THREE.Group;
  plan: FloorPlan;
  segments: Segment[];
  /** meshes the third-person camera must not pass through */
  occluders: THREE.Object3D[];
  floors: THREE.Mesh[];
  artworks: ArtworkInstance[];
  warnings: string[];
  style: StyleDef;
  /** roof lanterns (world-space rectangles at ceiling height) */
  skylights: Skylight[];
  /** the horizontal direction most windows face; the scenery treats it as north */
  outlook: THREE.Vector3;
  /** the entry door: what to click, where to stand in front of it, and where it leads */
  entrance?: { meshes: THREE.Object3D[]; leaf: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>; inside: THREE.Vector3; normal: THREE.Vector3; url: string };
}

export interface Skylight { x: number; z: number; w: number; d: number; y: number }

const SILL = 0.75;
const WELL = 0.7;

/** a central glazed roof lantern along the room's long axis, or none for small rooms */
function lanternFor(room: { width: number; depth: number; height: number }, cx: number, cz: number): Skylight | undefined {
  const short = Math.min(room.width, room.depth);
  if (short < 5) return undefined;
  const across = Math.min(4, Math.max(1.4, short * 0.32));
  const along = Math.max(across, Math.max(room.width, room.depth) * 0.55);
  const wide = room.width >= room.depth;
  return { x: cx, z: cz, w: wide ? along : across, d: wide ? across : along, y: room.height };
}

const T = WALL_THICKNESS;

function rotY(w: { normal: { x: number; z: number } }) { return Math.atan2(w.normal.x, w.normal.z); }

export function buildGallery(data: SiteData, style: StyleDef, renderer: THREE.WebGLRenderer): BuiltGallery {
  const g = data.gallery;
  const plan = computeFloorPlan(g);
  const root = new THREE.Group();
  root.name = 'gallery';
  const occluders: THREE.Object3D[] = [];
  const floors: THREE.Mesh[] = [];
  const warnings: string[] = [];
  const skylights: Skylight[] = [];
  /** sum of outward window directions, weighted by width: where the view out is best */
  const outlook = new THREE.Vector3();
  const env = g.environment;
  const glassMat = new THREE.MeshStandardMaterial({ color: '#d4e6f0', transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0, depthWrite: false, side: THREE.DoubleSide });
  const barMat = new THREE.MeshStandardMaterial({ color: '#3b4046', roughness: 0.5, metalness: 0.5 });

  /** is this point outside every room and passage (so a window there looks outdoors)? */
  const outdoors = (x: number, z: number) =>
    !plan.rooms.some((r) => x > r.minX - T - 0.05 && x < r.maxX + T + 0.05 && z > r.minZ - T - 0.05 && z < r.maxZ + T + 0.05) &&
    !plan.passages.some((p) => x > p.minX - T && x < p.maxX + T && z > p.minZ - T && z < p.maxZ + T);

  const floorTex = floorTexture(style);
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex.map, roughness: style.floorRoughness, metalness: 0 });
  const ceilMat = new THREE.MeshStandardMaterial({ color: style.ceiling, roughness: 1 });
  const trimMat = new THREE.MeshStandardMaterial({ color: style.trim, roughness: 0.6 });
  const wallMats = new Map<string, { mat: THREE.MeshStandardMaterial; tile: number }>();
  const wallMat = (color: string) => {
    let m = wallMats.get(color);
    if (!m) { const t = wallTexture(style, color); m = { mat: new THREE.MeshStandardMaterial({ map: t.map, roughness: style.wallRoughness }), tile: t.tile }; wallMats.set(color, m); }
    return m;
  };

  const addBox = (w: number, h: number, d: number, pos: THREE.Vector3, ry: number, mat: THREE.Material, uvTile?: number, occl = false) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pos);
    m.rotation.y = ry;
    m.updateMatrix();
    if (uvTile) worldUV(geo, m.matrix, uvTile);
    m.matrixAutoUpdate = false;
    root.add(m);
    if (occl) occluders.push(m);
    return m;
  };

  const addPlane = (w: number, d: number, x: number, y: number, z: number, down: boolean, mat: THREE.Material, uvTile?: number) => {
    const geo = new THREE.PlaneGeometry(w, d);
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = down ? Math.PI / 2 : -Math.PI / 2;
    m.position.set(x, y, z);
    m.updateMatrix();
    if (uvTile) worldUV(geo, m.matrix, uvTile);
    m.matrixAutoUpdate = false;
    root.add(m);
    return m;
  };

  const entrance = entranceOf(g, plan);
  let door: BuiltGallery['entrance'];
  const artworksById = new Map(g.artworks.map((a) => [a.id, a]));
  const instances: ArtworkInstance[] = [];
  let artIndex = 0;

  for (const pr of plan.rooms) {
    const { room } = pr;
    const H = room.height;
    const { mat: wm, tile: wt } = wallMat(room.wallColor ?? style.wall);
    floors.push(addPlane(room.width, room.depth, pr.centre.x, 0, pr.centre.z, false, floorMat, floorTex.tile));
    const lantern = env.skylights ? lanternFor(room, pr.centre.x, pr.centre.z) : undefined;
    if (lantern) {
      skylights.push(lantern);
      buildLantern(root, room, pr.centre.x, pr.centre.z, lantern, ceilMat, glassMat, barMat);
    } else {
      const ceil = addPlane(room.width, room.depth, pr.centre.x, H, pr.centre.z, true, ceilMat);
      ceil.userData.ceiling = true;
    }

    for (const side of WALL_SIDES) {
      const w = pr.walls[side];
      const ry = rotY(w);
      const sideWall = room.walls[side];
      const sideMat = sideWall.color ? wallMat(sideWall.color) : { mat: wm, tile: wt };
      const doors = doorsOn(plan, room.id, side);
      // solid stretches + lintels; extend by T at both ends so outer corners close
      let cur = -T;
      const stretches: Array<[number, number]> = [];
      for (const d of doors) {
        const a = d.offset - d.width / 2, b = d.offset + d.width / 2;
        stretches.push([cur, a]);
        const lintelH = H - d.height;
        if (lintelH > 0.01) {
          const c = pointOnWall(w, d.offset, -T / 2);
          addBox(d.width, lintelH, T, new THREE.Vector3(c.x, d.height + lintelH / 2, c.z), ry, sideMat.mat, sideMat.tile, true).userData.wall = { roomId: room.id, side };
        }
        cur = b;
      }
      stretches.push([cur, w.length + T]);
      const piece = (a: number, b: number, y0: number, y1: number) => {
        if (b - a < 0.01 || y1 - y0 < 0.01) return;
        const c = pointOnWall(w, (a + b) / 2, -T / 2);
        // a click on the wall can tell which wall it is (the studio's preview opens it in the wall editor)
        addBox(b - a, y1 - y0, T, new THREE.Vector3(c.x, (y0 + y1) / 2, c.z), ry, sideMat.mat, sideMat.tile, true).userData.wall = { roomId: room.id, side };
      };
      const head = Math.min(H - 0.45, 2.9);
      const isEntrance = entrance?.roomId === room.id && entrance.wall === side;
      const glaze = wallHasWindows(g, room, side) && !isEntrance && head - SILL >= 1.2;
      for (const [a, b] of stretches) {
        if (b - a < 0.01) continue;
        // picture windows on bare outside walls, a pier at least 0.8 m wide at each end
        const ia0 = Math.max(0, a) + 0.8, ib0 = Math.min(w.length, b) - 0.8;
        const wins: Array<[number, number]> = [];
        if (glaze && ib0 - ia0 >= 1.2) {
          const n = Math.ceil((ib0 - ia0) / 3.2);
          const ww = (ib0 - ia0 - (n - 1) * 0.6) / n;
          for (let k = 0; k < n; k++) {
            const wa = ia0 + k * (ww + 0.6), wb = wa + ww;
            const o = pointOnWall(w, (wa + wb) / 2, -T - 1.5);
            if (outdoors(o.x, o.z)) wins.push([wa, wb]);
          }
        }
        let x0 = a;
        for (const [wa, wb] of wins) {
          piece(x0, wa, 0, H);
          piece(wa, wb, 0, SILL);
          piece(wa, wb, head, H);
          buildWindow(root, w, ry, wa, wb, SILL, head, glassMat, barMat, occluders);
          outlook.x -= w.normal.x * (wb - wa); outlook.z -= w.normal.z * (wb - wa);
          x0 = wb;
        }
        piece(x0, b, 0, H);
        const ia = Math.max(0, a), ib = Math.min(w.length, b);
        if (style.skirting && ib - ia > 0.01) {
          const s = pointOnWall(w, (ia + ib) / 2, 0.009);
          addBox(ib - ia, 0.12, 0.018, new THREE.Vector3(s.x, 0.06, s.z), ry, trimMat);
        }
        if (style.moulding && ib - ia > 0.01) {
          const s = pointOnWall(w, (ia + ib) / 2, 0.035);
          addBox(ib - ia, 0.16, 0.07, new THREE.Vector3(s.x, H - 0.08, s.z), ry, trimMat);
          const s2 = pointOnWall(w, (ia + ib) / 2, 0.012);
          addBox(ib - ia, 0.05, 0.024, new THREE.Vector3(s2.x, H - 0.55, s2.z), ry, trimMat);
        }
      }
      // door casings
      for (const d of doors) {
        for (const e of [d.offset - d.width / 2 - 0.04, d.offset + d.width / 2 + 0.04]) {
          const p = pointOnWall(w, e, 0.012);
          addBox(0.08, d.height + 0.04, 0.025, new THREE.Vector3(p.x, (d.height + 0.04) / 2, p.z), ry, trimMat);
        }
        const p = pointOnWall(w, d.offset, 0.012);
        addBox(d.width + 0.16, 0.08, 0.025, new THREE.Vector3(p.x, d.height + 0.04, p.z), ry, trimMat);
      }

      if (isEntrance && entrance) door = buildEntrance(root, w, ry, entrance.offset, entrance.width, entrance.height, g.entrance.url, style, trimMat);

      // artworks
      const res = hangWall({
        wall: sideWall,
        length: w.length,
        roomHeight: H,
        doors: blockersOn(g, plan, room.id, side),
        artworks: artworksById,
        aspect: (id) => { const a = data.assets[id]; return a ? a.width / a.height : undefined; },
        styleFrame: style.frame,
        ...g.display,
      });
      res.warnings.forEach((m) => warnings.push(`${room.name} / ${side}: ${m}`));
      for (const hw of res.works) {
        artIndex++;
        const art = artworksById.get(hw.artworkId)!;
        instances.push(buildArtwork(root, art, data.assets[art.id], hw, w, pr.room.id, room, style, renderer, artIndex));
      }
    }
  }

  // passages between rooms
  for (const p of plan.passages) {
    const len = p.axis === 'x' ? p.maxX - p.minX : p.maxZ - p.minZ;
    if (len < 0.01) continue;
    const cx = (p.minX + p.maxX) / 2, cz = (p.minZ + p.maxZ) / 2;
    const width = p.axis === 'x' ? p.maxZ - p.minZ : p.maxX - p.minX;
    const fw = p.axis === 'x' ? len + 0.02 : width;
    const fd = p.axis === 'x' ? width : len + 0.02;
    floors.push(addPlane(fw, fd, cx, 0.001, cz, false, floorMat, floorTex.tile));
    // The passage spans both rooms' wall thickness, where the walls' cut ends and the lintel underside already
    // form the reveal. Sides and ceiling only fill the gap between the outer faces; overlapping them with the
    // reveal puts two surfaces in one plane and they z-fight (flickering door frames).
    const gap = len - 2 * T;
    if (gap < 0.01) continue;
    const gw = p.axis === 'x' ? gap : width, gd = p.axis === 'x' ? width : gap;
    addPlane(gw, gd, cx, p.height, cz, true, ceilMat);
    const { mat } = wallMat(style.wall);
    for (const sgn of [-1, 1]) {
      if (p.axis === 'x') addBox(gap, p.height, T, new THREE.Vector3(cx, p.height / 2, cz + sgn * (width / 2 + T / 2)), 0, mat, 2, true);
      else addBox(T, p.height, gap, new THREE.Vector3(cx + sgn * (width / 2 + T / 2), p.height / 2, cz), 0, mat, 2, true);
    }
  }

  // placed by hand where a room has its own list, by the automatic rule elsewhere
  if (env.plants) root.add(buildPlants(roomPlants(g, plan, { aspect: (id) => { const a = data.assets[id]; return a ? a.width / a.height : undefined; }, styleFrame: style.frame }).values()));
  if (outlook.lengthSq() > 1e-6) outlook.normalize(); else outlook.set(0, 0, -1);

  return { root, plan, segments: collisionSegments(plan), occluders, floors, artworks: instances, warnings, style, skylights, outlook, entrance: door };
}

/** Ceiling with a rectangular opening, a short light well and a glazed top with bars. */
function buildLantern(root: THREE.Group, room: { width: number; depth: number; height: number }, cx: number, cz: number, l: Skylight,
  ceilMat: THREE.Material, glassMat: THREE.Material, barMat: THREE.Material) {
  const H = room.height;
  const shape = new THREE.Shape();
  shape.moveTo(-room.width / 2, -room.depth / 2); shape.lineTo(room.width / 2, -room.depth / 2);
  shape.lineTo(room.width / 2, room.depth / 2); shape.lineTo(-room.width / 2, room.depth / 2); shape.closePath();
  const hole = new THREE.Path();
  const hx = l.x - cx, hz = l.z - cz;
  hole.moveTo(hx - l.w / 2, hz - l.d / 2); hole.lineTo(hx - l.w / 2, hz + l.d / 2);
  hole.lineTo(hx + l.w / 2, hz + l.d / 2); hole.lineTo(hx + l.w / 2, hz - l.d / 2); hole.closePath();
  shape.holes.push(hole);
  const ceil = new THREE.Mesh(new THREE.ShapeGeometry(shape), ceilMat);
  ceil.rotation.x = Math.PI / 2; // local y becomes world z, face points down
  ceil.position.set(cx, H, cz);
  ceil.userData.ceiling = true;
  root.add(ceil);
  // well sides, facing inwards
  const sides: Array<[number, number, number, number]> = [
    [l.x, l.z - l.d / 2, l.w, 0], [l.x, l.z + l.d / 2, l.w, Math.PI],
    [l.x - l.w / 2, l.z, l.d, Math.PI / 2], [l.x + l.w / 2, l.z, l.d, -Math.PI / 2],
  ];
  for (const [x, z, len, ry] of sides) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, WELL), ceilMat);
    m.position.set(x, H + WELL / 2, z);
    m.rotation.y = ry;
    root.add(m);
  }
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(l.w, l.d), glassMat);
  glass.rotation.x = Math.PI / 2;
  glass.position.set(l.x, H + WELL, l.z);
  root.add(glass);
  // glazing bars: a ridge along the long axis and ribs across it about every metre
  const wide = l.w >= l.d;
  const long = wide ? l.w : l.d, short = wide ? l.d : l.w;
  const bar = (len: number, x: number, z: number, alongX: boolean) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : 0.05, 0.07, alongX ? 0.05 : len), barMat);
    b.position.set(x, H + WELL - 0.02, z);
    root.add(b);
  };
  bar(long, l.x, l.z, wide);
  const n = Math.max(2, Math.round(long / 1.0));
  for (let i = 1; i < n; i++) {
    const t = -long / 2 + (i * long) / n;
    bar(short, wide ? l.x + t : l.x, wide ? l.z : l.z + t, !wide);
  }
}

/** The entry door: a closed leaf in a casing on the wall, with a small sign naming where it leads. */
function buildEntrance(root: THREE.Group, w: WallFrame, ry: number, offset: number, width: number, height: number, url: string, style: StyleDef, trimMat: THREE.Material): NonNullable<BuiltGallery['entrance']> {
  const g = new THREE.Group();
  const base = pointOnWall(w, offset, 0);
  g.position.set(base.x, 0, base.z);
  g.rotation.y = ry;
  root.add(g);
  const meshes: THREE.Object3D[] = [];
  const box = (bw: number, bh: number, bd: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat);
    m.position.set(x, y, z);
    m.userData.entrance = true;
    g.add(m);
    meshes.push(m);
    return m;
  };
  const leafMat = new THREE.MeshStandardMaterial({ color: '#2b2f33', roughness: 0.45, metalness: 0.35, emissive: style.ui.accent, emissiveIntensity: 0 });
  const metal = new THREE.MeshStandardMaterial({ color: '#c9ccd0', roughness: 0.3, metalness: 0.9 });
  const leaf = box(width, height, 0.05, 0, height / 2, 0.03, leafMat) as unknown as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  // recessed panels, a kick plate, a lever handle
  const panel = new THREE.MeshStandardMaterial({ color: '#23272b', roughness: 0.5, metalness: 0.3 });
  box(width * 0.72, height * 0.36, 0.012, 0, height * 0.72, 0.058, panel);
  box(width * 0.72, height * 0.3, 0.012, 0, height * 0.3, 0.058, panel);
  box(width, 0.22, 0.008, 0, 0.11, 0.058, metal);
  box(0.03, 0.14, 0.02, width / 2 - 0.12, 1.05, 0.065, metal);
  box(0.14, 0.022, 0.022, width / 2 - 0.18, 1.07, 0.09, metal);
  // casing
  const c = 0.09;
  box(c, height + c, 0.07, -width / 2 - c / 2, (height + c) / 2, 0.035, trimMat);
  box(c, height + c, 0.07, width / 2 + c / 2, (height + c) / 2, 0.035, trimMat);
  box(width + 2 * c, c, 0.07, 0, height + c / 2, 0.035, trimMat);
  // an illuminated exit sign over the door with the host it leads to
  let host = url;
  try { host = new URL(url).host.replace(/^www\./, ''); } catch { /* keep the text as given */ }
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#12351f'; ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = '#e9fff0';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let size = 60;
  const text = `${host}  →`;
  do { ctx.font = `600 ${size}px "Poppins", "Helvetica Neue", Arial, sans-serif`; size -= 4; } while (ctx.measureText(text).width > 470 && size > 20);
  ctx.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.18, 0.04),
    [0, 1, 2, 3, 4, 5].map((i) => (i === 4 ? new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.9, roughness: 0.6 }) : new THREE.MeshStandardMaterial({ color: '#1c1f22', roughness: 0.6 }))));
  sign.position.set(0, height + c + 0.2, 0.03);
  sign.userData.entrance = true;
  g.add(sign);
  meshes.push(sign);
  g.updateMatrixWorld(true);
  const normal = new THREE.Vector3(w.normal.x, 0, w.normal.z);
  return { meshes, leaf, inside: new THREE.Vector3(base.x, 0, base.z).addScaledVector(normal, 1.6), normal, url };
}

/** Glass and a slim frame in a wall opening between offsets a and b. */
function buildWindow(root: THREE.Group, w: WallFrame, ry: number, a: number, b: number, y0: number, y1: number,
  glassMat: THREE.Material, barMat: THREE.Material, occluders: THREE.Object3D[]) {
  const c = pointOnWall(w, (a + b) / 2, -T / 2);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(b - a, y1 - y0), glassMat);
  glass.position.set(c.x, (y0 + y1) / 2, c.z);
  glass.rotation.y = ry;
  root.add(glass);
  occluders.push(glass);
  const add = (bw: number, bh: number, off: number, y: number) => {
    const p = pointOnWall(w, off, -T / 2);
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.06), barMat);
    m.position.set(p.x, y, p.z);
    m.rotation.y = ry;
    root.add(m);
  };
  const fw = 0.05;
  add(b - a, fw, (a + b) / 2, y0 + fw / 2);
  add(b - a, fw, (a + b) / 2, y1 - fw / 2);
  add(fw, y1 - y0, a + fw / 2, (y0 + y1) / 2);
  add(fw, y1 - y0, b - fw / 2, (y0 + y1) / 2);
  if (b - a > 1.6) add(fw * 0.8, y1 - y0, (a + b) / 2, (y0 + y1) / 2);
  // a transom bar at door height makes tall windows read as windows rather than openings
  if (y1 - y0 > 1.8) add(b - a, fw * 0.8, (a + b) / 2, y0 + (y1 - y0) * 0.72);
}

const MAT_COLOR = '#f3f0e8';

function buildArtwork(
  root: THREE.Group, art: Artwork, asset: ArtAsset | undefined, hw: HungWork, w: WallFrame, roomId: string,
  room: { width: number; depth: number; height: number }, style: StyleDef, renderer: THREE.WebGLRenderer, index: number,
): ArtworkInstance {
  const group = new THREE.Group();
  group.name = `art:${art.id}`;
  const base = pointOnWall(w, hw.offset, 0);
  group.position.set(base.x, hw.y, base.z);
  group.rotation.y = rotY(w);
  root.add(group);

  const f = hw.frame;
  const float = f.id === 'float';
  const noFrame = f.id === 'none';
  const depth = noFrame ? 0.03 : float ? 0.05 : f.depth;
  const innerW = hw.width + 2 * hw.mat, innerH = hw.height + 2 * hw.mat;

  const placeholder = new THREE.Color(asset?.color ?? '#888888');
  const picture = new THREE.Mesh(
    new THREE.PlaneGeometry(hw.width, hw.height),
    new THREE.MeshStandardMaterial({ color: placeholder, roughness: 0.82, metalness: 0 }),
  );
  picture.position.z = depth + 0.001;
  picture.userData.artworkId = art.id;
  group.add(picture);

  if (noFrame || float) {
    // stretcher / float block behind the picture
    const back = new THREE.Mesh(new THREE.BoxGeometry(hw.width * (float ? 0.96 : 1), hw.height * (float ? 0.96 : 1), depth), new THREE.MeshStandardMaterial({ color: float ? '#202020' : '#3a342c', roughness: 0.9 }));
    back.position.z = depth / 2;
    group.add(back);
    if (float) {
      const shadowBox = new THREE.Mesh(new THREE.PlaneGeometry(hw.width + 0.04, hw.height + 0.04), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.25, depthWrite: false }));
      shadowBox.position.set(0.012, -0.015, 0.002);
      group.add(shadowBox);
    }
  } else {
    if (hw.mat > 0) {
      const mat = new THREE.Mesh(new THREE.PlaneGeometry(innerW, innerH), new THREE.MeshStandardMaterial({ color: MAT_COLOR, roughness: 0.95 }));
      mat.position.z = depth - 0.004;
      group.add(mat);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(innerW, innerH, depth - 0.006), new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 1 }));
    back.position.z = (depth - 0.006) / 2;
    group.add(back);
    const fm = new THREE.MeshStandardMaterial({ color: f.color, metalness: f.metalness, roughness: f.roughness });
    const bar = (bw: number, bh: number, x: number, y: number, d = depth, z = depth / 2, m: THREE.Material = fm) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, d), m);
      b.position.set(x, y, z);
      group.add(b);
    };
    const fw = f.width;
    bar(innerW + 2 * fw, fw, 0, innerH / 2 + fw / 2);
    bar(innerW + 2 * fw, fw, 0, -innerH / 2 - fw / 2);
    bar(fw, innerH, -innerW / 2 - fw / 2, 0);
    bar(fw, innerH, innerW / 2 + fw / 2, 0);
    if (f.ornate) {
      // stepped profile: raised outer lip and a darker inner sight edge
      const lip = new THREE.MeshStandardMaterial({ color: new THREE.Color(f.color).offsetHSL(0, 0.05, 0.04), metalness: 0.9, roughness: 0.3 });
      const sight = new THREE.MeshStandardMaterial({ color: new THREE.Color(f.color).offsetHSL(0, -0.1, -0.18), metalness: 0.7, roughness: 0.45 });
      const lw = fw * 0.28, zl = depth + 0.008;
      bar(innerW + 2 * fw, lw, 0, innerH / 2 + fw - lw / 2, 0.016, zl, lip);
      bar(innerW + 2 * fw, lw, 0, -innerH / 2 - fw + lw / 2, 0.016, zl, lip);
      bar(lw, innerH + 2 * fw - 2 * lw, -innerW / 2 - fw + lw / 2, 0, 0.016, zl, lip);
      bar(lw, innerH + 2 * fw - 2 * lw, innerW / 2 + fw - lw / 2, 0, 0.016, zl, lip);
      const sw = fw * 0.18;
      bar(innerW + 2 * sw, sw, 0, innerH / 2 + sw / 2, 0.012, depth + 0.004, sight);
      bar(innerW + 2 * sw, sw, 0, -innerH / 2 - sw / 2, 0.012, depth + 0.004, sight);
      bar(sw, innerH, -innerW / 2 - sw / 2, 0, 0.012, depth + 0.004, sight);
      bar(sw, innerH, innerW / 2 + sw / 2, 0, 0.012, depth + 0.004, sight);
    }
  }

  // light pool on the wall
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.max(hw.outerW * 1.7, 1.1), Math.max(hw.outerH * 1.8, 1.3)),
    new THREE.MeshBasicMaterial({ map: lightPoolTexture(), transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  pool.position.set(0, hw.outerH * 0.12, 0.003);
  pool.renderOrder = 1;
  group.add(pool);

  // hover / selection rim just behind the frame
  const highlight = new THREE.Mesh(
    new THREE.PlaneGeometry(hw.outerW + 0.07, hw.outerH + 0.07),
    new THREE.MeshBasicMaterial({ color: style.ui.accent, transparent: true, opacity: 0.95, depthWrite: false }),
  );
  highlight.position.z = 0.004;
  highlight.visible = false;
  group.add(highlight);

  // label card
  const lx = hw.label.offset - hw.offset, ly = hw.label.y - hw.y;
  const card = new THREE.Mesh(
    new THREE.BoxGeometry(hw.label.w, hw.label.h, 0.006),
    [null, null, null, null, null, null].map((_, i) =>
      i === 4 ? new THREE.MeshStandardMaterial({ map: labelTexture(art, style, index, renderer), roughness: 0.7 }) : new THREE.MeshStandardMaterial({ color: style.labelBackground, roughness: 0.7 }),
    ),
  );
  card.position.set(lx, ly, 0.003);
  card.userData.artworkId = art.id;
  card.userData.label = true;
  group.add(card);

  group.updateMatrixWorld(true);
  const centre = picture.getWorldPosition(new THREE.Vector3());
  const normal = new THREE.Vector3(w.normal.x, 0, w.normal.z);
  const halfExtent = (w.side === 'north' || w.side === 'south' ? room.depth : room.width) - 0.6;
  const dist = Math.min(Math.max(1.5, hw.outerH * 1.3, hw.outerW * 0.9), halfExtent, 4.5);
  const viewpoint = new THREE.Vector3(base.x + w.normal.x * dist, 0, base.z + w.normal.z * dist);
  const spotAnchor = new THREE.Vector3(base.x + w.normal.x * 1.4, room.height - 0.12, base.z + w.normal.z * 1.4);

  return { id: art.id, art, asset, roomId, hung: hw, group, picture, pool, highlight, centre, normal, viewpoint, spotAnchor, index };
}
