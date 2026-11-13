import type { Gallery, Room, WallSide } from './model';
import { WALL_SIDES } from './model';

export const WALL_THICKNESS = 0.2;
export const DOOR_WIDTH = 1.8;
export const DOOR_HEIGHT = 2.6;

export interface Vec2 { x: number; z: number }

/** A wall in world space. "along" runs left→right as seen by a visitor facing the wall from inside the room. */
export interface WallFrame {
  side: WallSide;
  start: Vec2;
  along: Vec2;
  /** points into the room */
  normal: Vec2;
  length: number;
}

export interface PlacedRoom {
  room: Room;
  index: number;
  centre: Vec2;
  /** axis-aligned bounds (interior) */
  minX: number; maxX: number; minZ: number; maxZ: number;
  walls: Record<WallSide, WallFrame>;
}

export interface DoorOpening {
  roomId: string;
  wall: WallSide;
  /** centre along the wall (metres from wall start) */
  offset: number;
  width: number;
  height: number;
  /** id of the room on the other side (if any) */
  to?: string;
}

/** A short passage that bridges the gap between two facing doorways. */
export interface Passage {
  from: string;
  to: string;
  /** world-space rectangle of passage floor */
  minX: number; maxX: number; minZ: number; maxZ: number;
  axis: 'x' | 'z';
  height: number;
}

export interface FloorPlan {
  rooms: PlacedRoom[];
  doors: DoorOpening[];
  passages: Passage[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export function wallFrames(room: Room, c: Vec2): Record<WallSide, WallFrame> {
  const hw = room.width / 2, hd = room.depth / 2;
  return {
    north: { side: 'north', start: { x: c.x - hw, z: c.z - hd }, along: { x: 1, z: 0 }, normal: { x: 0, z: 1 }, length: room.width },
    east: { side: 'east', start: { x: c.x + hw, z: c.z - hd }, along: { x: 0, z: 1 }, normal: { x: -1, z: 0 }, length: room.depth },
    south: { side: 'south', start: { x: c.x + hw, z: c.z + hd }, along: { x: -1, z: 0 }, normal: { x: 0, z: -1 }, length: room.width },
    west: { side: 'west', start: { x: c.x - hw, z: c.z + hd }, along: { x: 0, z: -1 }, normal: { x: 1, z: 0 }, length: room.depth },
  };
}

export function pointOnWall(w: WallFrame, offset: number, inset = 0): Vec2 {
  return { x: w.start.x + w.along.x * offset + w.normal.x * inset, z: w.start.z + w.along.z * offset + w.normal.z * inset };
}

/** offset along a wall for a world coordinate on that wall's axis */
export function offsetOnWall(w: WallFrame, p: Vec2): number {
  return (p.x - w.start.x) * w.along.x + (p.z - w.start.z) * w.along.z;
}

function roomCentres(g: Pick<Gallery, 'rooms' | 'layout'>): Vec2[] {
  const { rooms, layout } = g;
  // each room has its own wall, so neighbours need two wall thicknesses between them or the walls interpenetrate
  const gap = Math.max(layout.gap, 2 * WALL_THICKNESS);
  if (layout.mode === 'custom') return rooms.map((r) => r.position ?? { x: 0, z: 0 });
  if (layout.mode === 'linear') {
    const out: Vec2[] = [];
    let x = 0;
    rooms.forEach((r, i) => {
      if (i > 0) x += rooms[i - 1].width / 2 + gap + r.width / 2;
      out.push({ x, z: 0 });
    });
    return out;
  }
  // grid: row-major, serpentine so that consecutive rooms stay adjacent
  const cols = Math.max(1, Math.min(layout.columns, rooms.length));
  const nRows = Math.ceil(rooms.length / cols);
  const cellOf = (i: number) => {
    const row = Math.floor(i / cols);
    const k = i % cols;
    return { row, col: row % 2 === 0 ? k : cols - 1 - k };
  };
  const colW = Array(cols).fill(0) as number[];
  const rowD = Array(nRows).fill(0) as number[];
  rooms.forEach((r, i) => {
    const { row, col } = cellOf(i);
    colW[col] = Math.max(colW[col], r.width);
    rowD[row] = Math.max(rowD[row], r.depth);
  });
  const colX: number[] = [];
  let acc = 0;
  colW.forEach((w, i) => { colX.push(acc + w / 2); acc += w + gap; });
  const rowZ: number[] = [];
  acc = 0;
  rowD.forEach((d, i) => { rowZ.push(acc + d / 2); acc += d + gap; });
  return rooms.map((_, i) => { const { row, col } = cellOf(i); return { x: colX[col], z: rowZ[row] }; });
}

const OPPOSITE: Record<WallSide, WallSide> = { north: 'south', south: 'north', east: 'west', west: 'east' };

export function computeFloorPlan(g: Pick<Gallery, 'rooms' | 'layout'>): FloorPlan {
  const centres = roomCentres(g);
  const rooms: PlacedRoom[] = g.rooms.map((room, index) => {
    const c = centres[index];
    return {
      room, index, centre: c,
      minX: c.x - room.width / 2, maxX: c.x + room.width / 2, minZ: c.z - room.depth / 2, maxZ: c.z + room.depth / 2,
      walls: wallFrames(room, c),
    };
  });

  const doors: DoorOpening[] = [];
  const passages: Passage[] = [];
  const doorHeight = (a: Room, b?: Room) => Math.min(DOOR_HEIGHT, a.height - 0.4, b ? b.height - 0.4 : Infinity);

  // explicit doorways
  rooms.forEach((pr) => {
    pr.room.doorways?.forEach((d) => doors.push({ roomId: pr.room.id, wall: d.wall, offset: d.offset, width: d.width, height: doorHeight(pr.room) }));
  });

  // automatic connections: for each wall, the nearest facing room with enough overlap
  const MAX_GAP = 8;
  const linked = new Set<string>();
  for (const a of rooms) {
    if (a.room.doorways) continue;
    for (const side of WALL_SIDES) {
      let best: { b: PlacedRoom; gap: number; lo: number; hi: number } | undefined;
      for (const b of rooms) {
        if (b === a || b.room.doorways) continue;
        let gap: number, lo: number, hi: number;
        if (side === 'east' || side === 'west') {
          gap = side === 'east' ? b.minX - a.maxX : a.minX - b.maxX;
          lo = Math.max(a.minZ, b.minZ); hi = Math.min(a.maxZ, b.maxZ);
        } else {
          gap = side === 'south' ? b.minZ - a.maxZ : a.minZ - b.maxZ;
          lo = Math.max(a.minX, b.minX); hi = Math.min(a.maxX, b.maxX);
        }
        if (gap < -1e-6 || gap > MAX_GAP || hi - lo < DOOR_WIDTH + 0.6) continue;
        if (!best || gap < best.gap) best = { b, gap, lo, hi };
      }
      if (!best) continue;
      const key = [a.room.id, best.b.room.id].sort().join('|');
      if (linked.has(key)) continue;
      // only connect rooms consecutive in tour order, plus linear neighbours; avoids a maze of doors in grids
      const consecutive = Math.abs(a.index - best.b.index) === 1;
      if (!consecutive) continue;
      linked.add(key);
      const mid = (best.lo + best.hi) / 2;
      const width = Math.min(DOOR_WIDTH, best.hi - best.lo - 0.6);
      const h = doorHeight(a.room, best.b.room);
      const wa = a.walls[side];
      const wb = best.b.walls[OPPOSITE[side]];
      const pt: Vec2 = side === 'east' || side === 'west' ? { x: wa.start.x, z: mid } : { x: mid, z: wa.start.z };
      const ptB: Vec2 = side === 'east' || side === 'west' ? { x: wb.start.x, z: mid } : { x: mid, z: wb.start.z };
      doors.push({ roomId: a.room.id, wall: side, offset: offsetOnWall(wa, pt), width, height: h, to: best.b.room.id });
      doors.push({ roomId: best.b.room.id, wall: OPPOSITE[side], offset: offsetOnWall(wb, ptB), width, height: h, to: a.room.id });
      if (side === 'east' || side === 'west') {
        const x0 = Math.min(wa.start.x, wb.start.x), x1 = Math.max(wa.start.x, wb.start.x);
        passages.push({ from: a.room.id, to: best.b.room.id, minX: x0, maxX: x1, minZ: mid - width / 2, maxZ: mid + width / 2, axis: 'x', height: h });
      } else {
        const z0 = Math.min(wa.start.z, wb.start.z), z1 = Math.max(wa.start.z, wb.start.z);
        passages.push({ from: a.room.id, to: best.b.room.id, minX: mid - width / 2, maxX: mid + width / 2, minZ: z0, maxZ: z1, axis: 'z', height: h });
      }
    }
  }

  const bounds = rooms.reduce(
    (b, r) => ({ minX: Math.min(b.minX, r.minX), maxX: Math.max(b.maxX, r.maxX), minZ: Math.min(b.minZ, r.minZ), maxZ: Math.max(b.maxZ, r.maxZ) }),
    { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
  );
  return { rooms, doors, passages, bounds };
}

export function doorsOn(plan: FloorPlan, roomId: string, side: WallSide): DoorOpening[] {
  return plan.doors.filter((d) => d.roomId === roomId && d.wall === side).sort((a, b) => a.offset - b.offset);
}

/** Free intervals along a wall after removing door openings (with a margin). */
export function freeSegments(length: number, doors: DoorOpening[], margin = 0.35): Array<[number, number]> {
  const segs: Array<[number, number]> = [];
  let cur = 0;
  for (const d of doors) {
    const a = d.offset - d.width / 2 - margin;
    const b = d.offset + d.width / 2 + margin;
    if (a > cur) segs.push([cur, a]);
    cur = Math.max(cur, b);
  }
  if (cur < length) segs.push([cur, length]);
  return segs.filter(([a, b]) => b - a > 0.3);
}

/** Wall line segments (world space) for collision, with door gaps removed. */
export interface Segment { a: Vec2; b: Vec2 }

export function collisionSegments(plan: FloorPlan): Segment[] {
  const segs: Segment[] = [];
  for (const pr of plan.rooms) {
    for (const side of WALL_SIDES) {
      const w = pr.walls[side];
      const doors = doorsOn(plan, pr.room.id, side);
      let cur = 0;
      const push = (a: number, b: number) => { if (b - a > 1e-3) segs.push({ a: pointOnWall(w, a), b: pointOnWall(w, b) }); };
      for (const d of doors) { push(cur, d.offset - d.width / 2); cur = d.offset + d.width / 2; }
      push(cur, w.length);
    }
  }
  for (const p of plan.passages) {
    if (p.axis === 'x') {
      segs.push({ a: { x: p.minX, z: p.minZ }, b: { x: p.maxX, z: p.minZ } });
      segs.push({ a: { x: p.minX, z: p.maxZ }, b: { x: p.maxX, z: p.maxZ } });
    } else {
      segs.push({ a: { x: p.minX, z: p.minZ }, b: { x: p.minX, z: p.maxZ } });
      segs.push({ a: { x: p.maxX, z: p.minZ }, b: { x: p.maxX, z: p.maxZ } });
    }
  }
  return segs;
}

/** Push a circle of radius r at p out of all segments. Returns the corrected position. */
export function resolveCollision(p: Vec2, r: number, segs: Segment[]): Vec2 {
  let { x, z } = p;
  for (let iter = 0; iter < 3; iter++) {
    for (const s of segs) {
      const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z;
      const len2 = dx * dx + dz * dz;
      let t = len2 > 0 ? ((x - s.a.x) * dx + (z - s.a.z) * dz) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const cx = s.a.x + dx * t, cz = s.a.z + dz * t;
      const ex = x - cx, ez = z - cz;
      const d2 = ex * ex + ez * ez;
      if (d2 < r * r) {
        const d = Math.sqrt(d2) || 1e-6;
        const push = r - d;
        x += (ex / d) * push; z += (ez / d) * push;
      }
    }
  }
  return { x, z };
}

export function roomAt(plan: FloorPlan, p: Vec2): PlacedRoom | undefined {
  return plan.rooms.find((r) => p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ);
}

export const ENTRANCE_WIDTH = 1.1;
export const ENTRANCE_HEIGHT = 2.25;

/** Does this wall get picture windows? An explicit choice wins; otherwise bare walls do when the gallery has windows on. */
export function wallHasWindows(g: Pick<Gallery, 'environment'>, room: Room, side: WallSide): boolean {
  const w = room.walls[side];
  return w.windows ?? (g.environment.windows && w.artworks.length === 0);
}

/**
 * Where the entry door is: on a wall of the first room. Unless a wall was chosen, it is the first of south, west,
 * east, north that has neither windows nor a doorway to another room. Returned as an opening so that hanging avoids it.
 */
export function entranceOf(g: Pick<Gallery, 'entrance' | 'environment' | 'rooms'>, plan: FloorPlan): DoorOpening | undefined {
  if (!g.entrance.enabled || !plan.rooms.length) return undefined;
  const pr = plan.rooms[0];
  const clear = (side: WallSide) => !doorsOn(plan, pr.room.id, side).length;
  const order: WallSide[] = ['south', 'west', 'east', 'north'];
  const side = g.entrance.wall
    ?? order.find((s) => clear(s) && pr.room.walls[s].windows !== true)
    ?? order.find(clear) ?? 'south';
  const len = pr.walls[side].length;
  // the middle of the longest stretch of wall without a doorway
  const segs = freeSegments(len, doorsOn(plan, pr.room.id, side));
  const [a, b] = segs.sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]))[0] ?? [0, len];
  return { roomId: pr.room.id, wall: side, offset: (a + b) / 2, width: ENTRANCE_WIDTH, height: ENTRANCE_HEIGHT };
}

/** Everything on a wall that artworks must keep clear of: doorways to other rooms and the entry door. */
export function blockersOn(g: Pick<Gallery, 'entrance' | 'environment' | 'rooms'>, plan: FloorPlan, roomId: string, side: WallSide): DoorOpening[] {
  const e = entranceOf(g, plan);
  const doors = doorsOn(plan, roomId, side);
  return e && e.roomId === roomId && e.wall === side ? [...doors, e].sort((x, y) => x.offset - y.offset) : doors;
}
