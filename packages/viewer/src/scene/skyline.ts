import * as THREE from 'three';
import { rng, shade } from './textures';

/**
 * Toronto seen from the islands across the Inner Harbour, looking north: the CN Tower and the Rogers Centre,
 * the condo wall along the waterfront, the bank towers of the Financial District behind, and the towers of
 * Yonge Street fading into the distance. Built in real metres (x east, n north of the CN Tower's foot);
 * landmark heights are the published ones, their footprints and the rest of the city are approximations.
 */

/** distance from the viewer to the CN Tower, and how far east of the tower the view is centred */
const DIST = 1500, CENTRE_X = 400;
/** the harbour's edge lies this far south of the tower */
const SHORE_N = -440;
const BAY = 3.2, FLOOR = 3.8, CELLS = 8;

type Style = 'grid' | 'bands' | 'piers' | 'curtain' | 'balcony';
interface Kind { frame: string; glass: string; style: Style; metal: number; rough: number; lit: number; warm: number }
const KINDS = {
  blue: { frame: '#6f8496', glass: '#4a6680', style: 'curtain', metal: 0.75, rough: 0.16, lit: 0.15, warm: 0.6 },
  teal: { frame: '#6d8a88', glass: '#4b716f', style: 'curtain', metal: 0.75, rough: 0.16, lit: 0.15, warm: 0.6 },
  smoke: { frame: '#4f5861', glass: '#303a44', style: 'curtain', metal: 0.7, rough: 0.2, lit: 0.17, warm: 0.6 },
  silver: { frame: '#b4bcc2', glass: '#5d7286', style: 'grid', metal: 0.6, rough: 0.28, lit: 0.18, warm: 0.5 },
  white: { frame: '#e9e7e0', glass: '#48535e', style: 'piers', metal: 0.05, rough: 0.6, lit: 0.21, warm: 0.5 },
  black: { frame: '#16181c', glass: '#2a2622', style: 'piers', metal: 0.5, rough: 0.3, lit: 0.25, warm: 0.75 },
  red: { frame: '#8c4636', glass: '#3a2622', style: 'grid', metal: 0.2, rough: 0.45, lit: 0.18, warm: 0.7 },
  gold: { frame: '#b98b32', glass: '#d6a94a', style: 'curtain', metal: 0.9, rough: 0.18, lit: 0.11, warm: 0.9 },
  stone: { frame: '#b9b2a2', glass: '#3d4348', style: 'grid', metal: 0, rough: 0.8, lit: 0.20, warm: 0.8 },
  concrete: { frame: '#a9a9a4', glass: '#4b565f', style: 'bands', metal: 0, rough: 0.8, lit: 0.17, warm: 0.7 },
  condo: { frame: '#e4e6e6', glass: '#5d7a8e', style: 'balcony', metal: 0.3, rough: 0.35, lit: 0.21, warm: 0.8 },
  condoGrey: { frame: '#8e989f', glass: '#44607a', style: 'balcony', metal: 0.35, rough: 0.35, lit: 0.21, warm: 0.8 },
  condoDark: { frame: '#3d444b', glass: '#34495c', style: 'balcony', metal: 0.4, rough: 0.3, lit: 0.21, warm: 0.8 },
  brick: { frame: '#96705c', glass: '#2e2c2c', style: 'grid', metal: 0, rough: 0.9, lit: 0.20, warm: 0.85 },
} as const satisfies Record<string, Kind>;
type KindId = keyof typeof KINDS;

/** an 8 × 8 block of windows by day, and the same block at night with some of them lit */
function facade(k: Kind, seed: number): { map: THREE.Texture; night: THREE.Texture } {
  const S = 256, cell = S / CELLS;
  const day = document.createElement('canvas'), nite = document.createElement('canvas');
  day.width = day.height = nite.width = nite.height = S;
  const d = day.getContext('2d')!, n = nite.getContext('2d')!;
  const r = rng(seed);
  d.fillStyle = k.frame; d.fillRect(0, 0, S, S);
  n.fillStyle = '#000'; n.fillRect(0, 0, S, S);
  const pane = (x: number, y: number): [number, number, number, number] => {
    switch (k.style) {
      case 'grid': return [x + 5, y + 6, cell - 10, cell - 13];
      case 'bands': return [x, y + 7, cell, cell - 17];
      case 'piers': return [x + 7, y + 1, cell - 14, cell - 4];
      case 'balcony': return [x + 1, y + 1, cell - 2, cell - 8];
      default: return [x + 1, y + 2, cell - 2, cell - 4];
    }
  };
  for (let fy = 0; fy < CELLS; fy++) {
    const officeRow = r() < 0.07; // a whole floor with the lights left on
    for (let fx = 0; fx < CELLS; fx++) {
      const [x, y, w, h] = pane(fx * cell, fy * cell);
      d.fillStyle = shade(k.glass, (r() - 0.5) * 0.1);
      d.fillRect(x, y, w, h);
      // a paler strip near the top of each pane, as if it caught the sky
      d.fillStyle = 'rgba(255,255,255,0.07)'; d.fillRect(x, y, w, h * 0.35);
      if (k.style === 'balcony' && r() < 0.5) { d.fillStyle = 'rgba(255,255,255,0.25)'; d.fillRect(fx * cell, fy * cell + cell - 9, cell, 3); }
      if (r() < (officeRow ? 0.7 : k.lit)) {
        const warm = r() < k.warm;
        const b = 0.2 + r() * r() * 0.8;
        n.fillStyle = warm ? `rgba(255,${200 + Math.floor(r() * 30)},${130 + Math.floor(r() * 50)},${b})` : `rgba(${190 + Math.floor(r() * 40)},225,255,${b})`;
        n.fillRect(x + 1, y + 1, w - 2, h - 2);
      }
    }
  }
  const tex = (c: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { map: tex(day), night: tex(nite) };
}

export interface Skyline {
  group: THREE.Group;
  /** night 0..1 lights the windows and the tower */
  set(night: number): void;
  update(t: number): void;
}

interface TowerSpec {
  x: number; n: number; w: number; d?: number; h: number; kind: KindId;
  rot?: number; round?: boolean;
  /** setbacks: [from this fraction of the height, scale of the footprint] */
  tiers?: Array<[number, number]>;
  roof?: 'mech' | 'spire' | 'crown' | 'pyramid' | 'none';
  spire?: number; roofColor?: string; beacon?: boolean;
}

export function buildSkyline(): Skyline {
  const root = new THREE.Group();
  root.name = 'toronto-skyline';
  // local frame: x east, -z north, the viewer at the origin
  const city = new THREE.Group();
  city.position.set(-CENTRE_X, 0, -DIST);
  root.add(city);
  const r = rng(416);
  const lit: Array<{ m: THREE.MeshStandardMaterial; k: number }> = [];
  const beacons: Array<{ m: THREE.MeshBasicMaterial; phase: number }> = [];
  const textures = new Map<string, Array<{ map: THREE.Texture; night: THREE.Texture }>>();
  let seed = 1;

  const material = (kind: KindId, bays: number, floors: number): THREE.MeshStandardMaterial => {
    const k: Kind = KINDS[kind];
    let set = textures.get(kind);
    if (!set) { set = [facade(k, seed++ * 131), facade(k, seed++ * 131)]; textures.set(kind, set); }
    const t = set[Math.floor(r() * set.length)];
    const map = t.map.clone(), night = t.night.clone();
    for (const tx of [map, night]) {
      tx.repeat.set(Math.max(1, Math.round(bays)) / CELLS, Math.max(1, Math.round(floors)) / CELLS);
      tx.offset.set(Math.floor(r() * CELLS) / CELLS, Math.floor(r() * CELLS) / CELLS);
    }
    const m = new THREE.MeshStandardMaterial({ map, emissiveMap: night, emissive: '#ffffff', emissiveIntensity: 0, roughness: k.rough, metalness: k.metal, envMapIntensity: 1 });
    lit.push({ m, k: 0.75 + r() * 0.55 });
    return m;
  };
  const plain = (color: string, rough = 0.8, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  const glow = (color: string, k: number) => {
    const m = new THREE.MeshStandardMaterial({ color: '#30343a', emissive: color, emissiveIntensity: 0, roughness: 0.4 });
    lit.push({ m, k });
    return m;
  };
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, n: number, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, -n);
    m.rotation.y = ry;
    city.add(m);
    return m;
  };
  const beacon = (x: number, y: number, n: number, size = 2.2) => {
    const m = new THREE.MeshBasicMaterial({ color: '#ff2a1c', transparent: true, opacity: 0, fog: false });
    add(new THREE.SphereGeometry(size, 8, 6), m, x, y, n);
    beacons.push({ m, phase: r() * 6.28 });
  };

  const tower = (s: TowerSpec) => {
    const d = s.d ?? s.w, rot = s.rot ?? 0;
    const tiers: Array<[number, number]> = [[0, 1], ...(s.tiers ?? [])];
    tiers.forEach(([from, scale], i) => {
      const to = i + 1 < tiers.length ? tiers[i + 1][0] : 1;
      const h = (to - from) * s.h, w = s.w * scale, dd = d * scale;
      if (s.round) add(new THREE.CylinderGeometry(w / 2, w / 2, h, 28), material(s.kind, (Math.PI * w) / BAY, h / FLOOR), s.x, from * s.h + h / 2, s.n, rot);
      else add(new THREE.BoxGeometry(w, h, dd), material(s.kind, w / BAY, h / FLOOR), s.x, from * s.h + h / 2, s.n, rot);
    });
    const top = tiers[tiers.length - 1][1];
    const tw = s.w * top, td = d * top;
    const roof = s.roof ?? (r() < 0.6 ? 'mech' : 'none');
    if (roof === 'mech') add(new THREE.BoxGeometry(tw * 0.55, 5 + r() * 5, td * 0.55), plain(shade(KINDS[s.kind].frame, -0.12)), s.x, s.h + 3.5, s.n, rot);
    if (roof === 'crown') add(new THREE.BoxGeometry(tw * 0.92, 7, td * 0.92), glow('#fff2d0', 0.9), s.x, s.h + 3.5, s.n, rot);
    if (roof === 'pyramid') {
      const ph = Math.max(tw, td) * 0.55;
      add(new THREE.ConeGeometry(Math.hypot(tw, td) / 2, ph, 4), plain(s.roofColor ?? KINDS[s.kind].frame, 0.6, 0.2), s.x, s.h + ph / 2, s.n, rot + Math.PI / 4);
    }
    if (s.spire) {
      add(new THREE.CylinderGeometry(0.5, 1.6, s.spire, 6), plain('#c9ccd0', 0.4, 0.6), s.x, s.h + s.spire / 2, s.n);
      beacon(s.x, s.h + s.spire, s.n);
    } else if (s.beacon ?? s.h > 215) beacon(s.x, s.h + (roof === 'mech' ? 9 : 2), s.n);
  };

  // ------------------------------------------------------------------ the ground the city stands on
  const land = plain('#55604f', 1);
  add(new THREE.BoxGeometry(16000, 6, 9000), land, 0, -1.8, SHORE_N + 4500);
  add(new THREE.BoxGeometry(16000, 2.6, 6), plain('#8c8c86', 0.9), 0, 0.3, SHORE_N - 1); // the seawall
  // trees along the water's edge and in the parks behind it
  {
    const n = 420;
    const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: '#4a6b3c', roughness: 1, flatShading: true }), n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      const park = r() < 0.25;
      const x = park ? -900 + r() * 500 : -2600 + r() * 5400;
      const nn = SHORE_N + (park ? 20 + r() * 130 : 8 + r() * 28);
      const s = 5 + r() * 5;
      m.compose(new THREE.Vector3(x, 1 + s * 0.9, -nn), q, new THREE.Vector3(s, s * (1 + r() * 0.5), s));
      crowns.setMatrixAt(i, m);
    }
    city.add(crowns);
  }

  // ------------------------------------------------------------------ CN Tower, 553 m
  {
    const cn = new THREE.Group();
    cn.position.set(0, 0, 0);
    city.add(cn);
    const concrete = new THREE.MeshStandardMaterial({ color: '#cdc9be', roughness: 0.75, emissive: '#e02a3a', emissiveIntensity: 0 });
    lit.push({ m: concrete, k: 0.22 });
    const steel = plain('#e6e8ea', 0.4, 0.3);
    const P = (pts: Array<[number, number]>) => pts.map(([x, y]) => new THREE.Vector2(x, y));
    const lathe = (pts: Array<[number, number]>, seg: number, mat: THREE.Material, ry = 0) => { const m = new THREE.Mesh(new THREE.LatheGeometry(P(pts), seg), mat); m.rotation.y = ry; cn.add(m); };
    // the hexagonal core, flaring towards the ground
    lathe([[17, 0], [13, 60], [10.5, 140], [8.5, 230], [7, 335]], 6, concrete);
    // three legs: thin fins with the tower's concave sweep
    const fin = new THREE.Shape();
    fin.moveTo(0, 0); fin.lineTo(34, 0); fin.bezierCurveTo(22, 70, 12, 190, 8.2, 335); fin.lineTo(0, 335); fin.closePath();
    const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 7.5, bevelEnabled: false }).translate(0, 0, -3.75);
    for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(finGeo, concrete); m.rotation.y = (i * 2 * Math.PI) / 3 + 0.5; cn.add(m); }
    // main pod: the white radome ring, then the glazed decks, then the roof
    lathe([[7, 328], [12, 333], [18.5, 336], [20, 340], [18.5, 344], [15, 345.5]], 40, plain('#f0efe9', 0.5));
    const decks = new THREE.MeshStandardMaterial({ color: '#27313c', roughness: 0.15, metalness: 0.7, emissive: '#ffe2b0', emissiveIntensity: 0 });
    lit.push({ m: decks, k: 1.6 });
    lathe([[15, 345.5], [23.5, 346.5], [24.5, 351], [24, 357], [22.5, 358]], 40, decks);
    lathe([[22.5, 358], [19, 361.5], [11, 365], [6.2, 367]], 40, plain('#b9b7b0', 0.6));
    // upper shaft, SkyPod and the antenna mast
    lathe([[6.2, 367], [5.2, 400], [4.6, 441]], 12, concrete);
    lathe([[4.6, 441], [8, 444.5], [8, 451], [4.2, 455]], 24, decks);
    lathe([[3.4, 455], [3.1, 482], [2.2, 483], [2, 512], [1.3, 513], [1.1, 540], [0.5, 541], [0.4, 553]], 8, steel);
    beacon(0, 553, 0, 2.6); beacon(0, 458, 0, 2);
    // a ring of light under the pod
    const ring = new THREE.Mesh(new THREE.TorusGeometry(20.5, 0.9, 6, 48), glow('#ff4050', 2.2));
    ring.rotation.x = Math.PI / 2; ring.position.y = 335.5;
    cn.add(ring);
  }

  // ------------------------------------------------------------------ Rogers Centre
  {
    const x = -195, n = -25;
    add(new THREE.CylinderGeometry(108, 110, 34, 40), material('concrete', 100, 6), x, 17, n);
    const roof = new THREE.MeshStandardMaterial({ color: '#eceae4', roughness: 0.45, flatShading: true, emissive: '#9fb8ff', emissiveIntensity: 0 });
    lit.push({ m: roof, k: 0.12 });
    const dome = add(new THREE.SphereGeometry(106, 28, 7, 0, Math.PI * 2, 0, Math.PI / 2), roof, x, 34, n);
    dome.scale.y = 0.5;
    add(new THREE.BoxGeometry(150, 46, 40), material('concrete', 40, 11), x, 23, n + 118); // the hotel wing on the north side
  }

  // ------------------------------------------------------------------ landmarks (x east, n north, metres)
  const marks: TowerSpec[] = [
    // South Core and the waterfront wall
    { x: 300, n: -190, w: 34, h: 234, kind: 'condo', round: true, roof: 'crown' }, // ICE Condominiums
    { x: 352, n: -245, w: 32, h: 202, kind: 'condo', round: true, roof: 'crown' },
    { x: 150, n: -40, w: 44, d: 30, h: 160, kind: 'blue' }, // Delta
    { x: 250, n: -30, w: 46, d: 36, h: 150, kind: 'smoke' }, // Southcore Financial Centre
    { x: 330, n: -60, w: 44, d: 34, h: 130, kind: 'blue' },
    { x: 400, n: -110, w: 36, h: 147, kind: 'teal' },
    { x: 455, n: -55, w: 34, h: 186, kind: 'condoGrey' }, // Maple Leaf Square
    { x: 505, n: -95, w: 34, h: 174, kind: 'condoGrey' },
    { x: 432, n: -300, w: 30, d: 42, h: 224, kind: 'blue', rot: 0.5, tiers: [[0.9, 0.7]], roof: 'none' }, // Ten York
    { x: 545, n: -285, w: 50, d: 40, h: 160, kind: 'teal' }, // One York
    { x: 612, n: -170, w: 32, h: 237, kind: 'condo', tiers: [[0.93, 0.75]] }, // Harbour Plaza
    { x: 662, n: -205, w: 32, h: 228, kind: 'condo', tiers: [[0.93, 0.75]] },
    { x: 650, n: -335, w: 60, d: 40, h: 135, kind: 'blue' }, // WaterPark Place
    { x: 760, n: -330, w: 56, d: 36, h: 96, kind: 'teal' },
    { x: 850, n: -405, w: 34, d: 60, h: 125, kind: 'concrete' }, // Westin Harbour Castle
    { x: 905, n: -405, w: 34, d: 60, h: 115, kind: 'concrete' },
    { x: 905, n: -300, w: 36, h: 345, kind: 'smoke', tiers: [[0.6, 0.92], [0.86, 0.8]], roof: 'crown', beacon: true }, // Pinnacle One Yonge
    { x: 965, n: -345, w: 34, h: 263, kind: 'blue', tiers: [[0.8, 0.88]] },
    { x: 1010, n: -270, w: 32, h: 215, kind: 'condoGrey' },
    { x: 1065, n: -330, w: 32, h: 299, kind: 'condoDark', tiers: [[0.9, 0.8]], beacon: true }, // Sugar Wharf
    { x: 1120, n: -285, w: 32, h: 231, kind: 'condoDark' },
    { x: 1180, n: -340, w: 60, d: 40, h: 110, kind: 'blue' },
    // Union Station precinct
    { x: 700, n: 30, w: 46, d: 40, h: 238, kind: 'blue', tiers: [[0.5, 0.94]], roof: 'none' }, // CIBC Square
    { x: 745, n: 135, w: 46, d: 40, h: 241, kind: 'blue', tiers: [[0.5, 0.94]], roof: 'none' },
    { x: 560, n: 235, w: 70, d: 46, h: 96, kind: 'stone', tiers: [[0.62, 0.62], [0.86, 0.36]], roof: 'pyramid', roofColor: '#6f9a86', beacon: false }, // Fairmont Royal York
    { x: 470, n: 20, w: 40, h: 135, kind: 'teal' }, // Telus
    // Financial District
    { x: 685, n: 262, w: 52, h: 180, kind: 'gold', rot: Math.PI / 4, roof: 'none' }, // Royal Bank Plaza
    { x: 640, n: 305, w: 44, h: 112, kind: 'gold', rot: Math.PI / 4, roof: 'none' },
    { x: 772, n: 300, w: 46, h: 239, kind: 'silver', tiers: [[0.86, 0.82], [0.93, 0.6]], roof: 'none', spire: 22 }, // TD Canada Trust Tower
    { x: 832, n: 335, w: 44, h: 190, kind: 'silver', tiers: [[0.88, 0.8], [0.95, 0.55]], roof: 'none', spire: 18 }, // Bay Wellington Tower
    { x: 600, n: 440, w: 38, d: 76, h: 223, kind: 'black', roof: 'none' }, // TD Centre
    { x: 540, n: 395, w: 38, d: 60, h: 183, kind: 'black', roof: 'none' },
    { x: 650, n: 375, w: 36, d: 56, h: 154, kind: 'black', roof: 'none' },
    { x: 555, n: 505, w: 36, d: 56, h: 128, kind: 'black', roof: 'none' },
    { x: 805, n: 500, w: 44, d: 70, h: 239, kind: 'silver', roof: 'mech' }, // Commerce Court West
    { x: 622, n: 640, w: 60, h: 298, kind: 'white', roof: 'mech', beacon: true }, // First Canadian Place
    { x: 782, n: 660, w: 48, h: 275, kind: 'red', tiers: [[0.84, 0.86], [0.92, 0.7]], roof: 'none', beacon: true }, // Scotia Plaza
    { x: 615, n: 725, w: 30, h: 252, kind: 'smoke', tiers: [[0.9, 0.7]], roof: 'none', spire: 25 }, // St. Regis
    { x: 700, n: 785, w: 44, h: 218, kind: 'blue' }, // Bay Adelaide Centre
    { x: 760, n: 795, w: 42, h: 196, kind: 'blue' },
    { x: 885, n: 112, w: 30, d: 40, h: 205, kind: 'teal', tiers: [[0.8, 0.85], [0.92, 0.6]], roof: 'none' }, // L Tower
    // west of the core: the Entertainment District
    { x: 200, n: 300, w: 38, h: 210, kind: 'teal', tiers: [[0.88, 0.8]] }, // Ritz-Carlton
    { x: 262, n: 335, w: 46, h: 185, kind: 'blue' }, // RBC Centre
    { x: 330, n: 640, w: 34, h: 214, kind: 'smoke' }, // Shangri-La
    { x: 120, n: 560, w: 32, h: 157, kind: 'condoGrey' },
    { x: 60, n: 605, w: 30, h: 156, kind: 'condoDark' },
    { x: 20, n: 640, w: 30, h: 156, kind: 'condoDark' },
    { x: 390, n: 470, w: 50, d: 40, h: 148, kind: 'concrete' },
    // CityPlace's tallest, west of the dome
    { x: -335, n: -65, w: 32, h: 231, kind: 'condo', tiers: [[0.92, 0.8]] }, // Concord Canada House
    { x: -390, n: -110, w: 32, h: 213, kind: 'condo', tiers: [[0.92, 0.8]] },
    // up Yonge Street, far behind
    { x: 760, n: 1900, w: 40, h: 272, kind: 'smoke', tiers: [[0.85, 0.8]] }, // Aura
    { x: 1010, n: 3100, w: 34, h: 257, kind: 'condo' }, // One Bloor
    { x: 950, n: 3140, w: 36, h: 308, kind: 'smoke', beacon: true }, // The One
  ];
  marks.forEach(tower);
  // low buildings every Torontonian would miss
  add(new THREE.BoxGeometry(130, 38, 110), material('silver', 40, 5), 525, 19, 45); // Scotiabank Arena
  add(new THREE.BoxGeometry(230, 26, 60), material('stone', 60, 4), 610, 13, 150); // Union Station
  add(new THREE.BoxGeometry(150, 34, 46), material('brick', 46, 8), 505, 17, SHORE_N + 38); // Queen's Quay Terminal

  // ------------------------------------------------------------------ the rest of the city, seeded
  const taken = marks.map((m) => ({ x: m.x, n: m.n, rad: Math.max(m.w, m.d ?? m.w) * 0.75 }));
  taken.push({ x: 0, n: 0, rad: 60 }, { x: -195, n: -25, rad: 135 }, { x: 525, n: 45, rad: 80 }, { x: 610, n: 150, rad: 110 });
  const district = (x0: number, x1: number, n0: number, n1: number, pitch: number, fill: number, hMin: number, hMax: number, kinds: KindId[], skew = 1.6) => {
    for (let x = x0; x < x1; x += pitch) for (let n = n0; n < n1; n += pitch) {
      if (r() > fill) continue;
      const px = x + (r() - 0.5) * pitch * 0.6, pn = n + (r() - 0.5) * pitch * 0.6;
      const w = 22 + r() * 16, d = 22 + r() * 16;
      if (taken.some((t) => Math.hypot(t.x - px, t.n - pn) < t.rad + Math.max(w, d) * 0.6)) continue;
      taken.push({ x: px, n: pn, rad: Math.max(w, d) * 0.6 });
      const h = hMin + Math.pow(r(), skew) * (hMax - hMin);
      const kind = kinds[Math.floor(r() * kinds.length)];
      const style = r();
      tower({
        x: px, n: pn, w, d, h, kind, rot: r() < 0.15 ? (r() - 0.5) * 0.6 : 0,
        round: style > 0.94,
        tiers: style < 0.3 ? [[0.86 + r() * 0.08, 0.72]] : style < 0.4 ? [[0.12, 0.7]] : undefined, // penthouse setback, or a tower on a podium
        roof: r() < 0.12 ? 'crown' : undefined,
      });
    }
  };
  const condos: KindId[] = ['condo', 'condo', 'condoGrey', 'condoDark', 'blue', 'teal'];
  const offices: KindId[] = ['blue', 'smoke', 'silver', 'teal', 'concrete', 'stone'];
  district(-1050, -340, SHORE_N + 150, 120, 62, 0.8, 95, 185, condos); // CityPlace
  district(-1900, -1080, SHORE_N + 70, 350, 75, 0.55, 45, 135, [...condos, 'brick']); // Fort York, Bathurst Quay
  district(-3200, -1950, SHORE_N + 120, 600, 90, 0.5, 35, 120, [...condos, 'brick'], 2); // Liberty Village
  district(-330, 140, SHORE_N + 60, -150, 60, 0.6, 16, 46, [...condos, 'brick'], 2); // Harbourfront: low, so the dome shows over it
  district(120, 1250, SHORE_N + 60, -60, 58, 0.5, 70, 190, condos); // the waterfront wall
  district(0, 480, 60, 900, 70, 0.7, 80, 190, [...condos, ...offices]); // Entertainment District
  district(460, 980, 180, 1000, 62, 0.75, 90, 200, offices); // Financial District infill
  district(980, 1500, -150, 900, 70, 0.6, 60, 170, [...condos, 'brick', 'stone']); // St. Lawrence
  district(1240, 2400, SHORE_N + 60, 250, 75, 0.6, 40, 150, condos); // East Bayfront, Distillery
  district(2400, 3600, SHORE_N + 300, 700, 110, 0.4, 25, 90, [...condos, 'brick'], 2.2); // Port Lands edge
  district(450, 1150, 1050, 2600, 95, 0.55, 80, 230, [...condos, ...offices]); // Yonge and Bay, north of Queen
  district(-900, 400, 950, 2400, 120, 0.4, 40, 150, [...condos, 'brick', 'concrete'], 2); // Queen West, the hospitals, U of T
  district(600, 1350, 2700, 3500, 90, 0.6, 90, 220, condos); // Yonge and Bloor
  district(700, 1300, 5200, 6400, 150, 0.5, 80, 190, condos, 2); // Yonge and Eglinton, on a clear day

  // ------------------------------------------------------------------ on the water
  const boats: Array<{ o: THREE.Object3D; x0: number; n0: number; span: number; speed: number; phase: number }> = [];
  {
    const hull = plain('#f4f4f0', 0.5), dark = plain('#2c3a48', 0.6), sail = new THREE.MeshStandardMaterial({ color: '#fbfaf5', roughness: 0.9, side: THREE.DoubleSide });
    const ferry = new THREE.Group();
    const part = (g: THREE.BufferGeometry, m: THREE.Material, y: number, p: THREE.Group, x = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, 0); p.add(o); };
    part(new THREE.BoxGeometry(38, 3, 10), dark, 1.2, ferry);
    part(new THREE.BoxGeometry(34, 3.2, 9), hull, 4.2, ferry);
    part(new THREE.BoxGeometry(22, 2.6, 7.5), hull, 7, ferry);
    part(new THREE.CylinderGeometry(0.9, 1.1, 4, 8), dark, 10, ferry, -3);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(33.5, 1.3, 9.1), glow('#ffe7b8', 1.4));
    cabin.position.y = 4.6; ferry.add(cabin);
    city.add(ferry);
    boats.push({ o: ferry, x0: 560, n0: SHORE_N - 420, span: 380, speed: 0.012, phase: 0 });
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Group();
      part(new THREE.BoxGeometry(9, 1.2, 2.6), hull, 0.5, b);
      const tri = new THREE.Shape(); tri.moveTo(0, 0); tri.lineTo(4.6, 0); tri.lineTo(0, 12); tri.closePath();
      const s = new THREE.Mesh(new THREE.ShapeGeometry(tri), sail); s.position.set(-0.4, 1.4, 0); b.add(s);
      const jib = new THREE.Mesh(new THREE.ShapeGeometry(tri), sail); jib.scale.set(-0.7, 0.8, 1); jib.position.set(-0.8, 1.4, 0); b.add(jib);
      part(new THREE.CylinderGeometry(0.1, 0.1, 13, 5), dark, 7.5, b, -0.5);
      b.rotation.y = r() * Math.PI;
      city.add(b);
      boats.push({ o: b, x0: -900 + r() * 2400, n0: SHORE_N - 150 - r() * 650, span: 60 + r() * 160, speed: 0.01 + r() * 0.02, phase: r() * 6.28 });
    }
  }

  let nightNow = -1;
  return {
    group: root,
    set(night) {
      if (Math.abs(night - nightNow) < 0.004) return;
      nightNow = night;
      // windows come on through dusk; office lights first
      const on = Math.min(1, night * 1.25);
      for (const e of lit) e.m.emissiveIntensity = on * e.k;
    },
    update(t) {
      for (const b of beacons) b.m.opacity = nightNow > 0.25 ? 0.25 + 0.75 * Math.max(0, Math.sin(t * 1.6 + b.phase)) ** 3 : 0;
      for (const b of boats) {
        const a = t * b.speed * Math.PI * 2 + b.phase;
        b.o.position.set(b.x0 + Math.sin(a) * b.span, Math.sin(t * 0.9 + b.phase) * 0.12 - 0.25, -(b.n0 + Math.sin(a * 0.5) * b.span * 0.15));
        if (b === boats[0]) b.o.rotation.y = Math.cos(a) > 0 ? 0 : Math.PI;
      }
    },
  };
}
