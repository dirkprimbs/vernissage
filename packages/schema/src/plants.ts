import type { Artwork, Gallery } from './model';
import { WALL_SIDES } from './model';
import { blockersOn, doorsOn, entranceOf, freeSegments, pinboardOf, pointOnWall, wallHasWindows, type FloorPlan, type PlacedRoom } from './layout';
import { hangWall } from './hang';

/** a potted plant on the floor: world position in metres and its size (1 = about 1.3 m tall) */
export interface PlantSpot { x: number; z: number; scale: number }
/** what hangs on a room's walls, for keeping plants out of its way: a point on the wall and how far it reaches either side */
export interface WallObject { x: number; z: number; reach: number }
/** a stretch of closed wall with nothing on it: its middle, a little out from the wall, and its length */
export interface EmptyStretch { x: number; z: number; length: number }

/** automatic plants in one room keep at least this far apart, in metres */
export const PLANT_SPACING = 2.6;
/** the size a plant has in a room of this height unless it was given one */
export const plantSize = (roomHeight: number) => Math.min(1.25, roomHeight / 3.6);

/**
 * Where plants go in a room by themselves: the corners that are next to neither a doorway nor an artwork, and
 * the middle of every bare stretch of wall (a larger plant on a longer stretch), unless a plant of this room
 * already stands close by. Only this room's own walls count: what hangs next door is behind a wall.
 */
export function autoPlants(plan: FloorPlan, pr: PlacedRoom, hung: WallObject[], empty: EmptyStretch[]): PlantSpot[] {
  const { room, centre } = pr;
  const out: PlantSpot[] = [];
  const hw = room.width / 2 - 0.55, hd = room.depth / 2 - 0.55;
  const doorNear = (x: number, z: number) => WALL_SIDES.some((side) => doorsOn(plan, room.id, side).some((d) => {
    const p = pointOnWall(pr.walls[side], d.offset);
    return Math.hypot(p.x - x, p.z - z) < d.width / 2 + 1.0;
  }));
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const x = centre.x + sx * hw, z = centre.z + sz * hd;
    // a plant needs about a metre clear of any picture or label, or it crowds it
    if (doorNear(x, z) || hung.some((o) => Math.hypot(o.x - x, o.z - z) < o.reach + 1.1)) continue;
    out.push({ x, z, scale: plantSize(room.height) });
  }
  for (const e of empty) {
    // not beside a plant that is already there (the one in the corner next to it): two together look like a mistake
    if (out.some((o) => Math.hypot(o.x - e.x, o.z - e.z) < PLANT_SPACING)) continue;
    out.push({ x: e.x, z: e.z, scale: Math.min(1.6, 1.05 + e.length * 0.07) });
  }
  return out;
}

export interface PlantInput {
  /** width / height of the image for works without dimensions */
  aspect: (id: string) => number | undefined;
  styleFrame: Exclude<Artwork['frame'], 'style'>;
}

/** The automatic plants of one room, worked out from what hangs on its walls. */
export function autoPlantsFor(g: Gallery, plan: FloorPlan, roomId: string, inp: PlantInput): PlantSpot[] {
  const pr = plan.rooms.find((r) => r.room.id === roomId);
  if (!pr) return [];
  const artworks = new Map(g.artworks.map((a) => [a.id, a]));
  const hung: WallObject[] = [], empty: EmptyStretch[] = [];
  for (const side of WALL_SIDES) {
    const w = pr.walls[side];
    const doors = blockersOn(g, plan, roomId, side);
    const res = hangWall({ wall: pr.room.walls[side], length: w.length, roomHeight: pr.room.height, doors, artworks, aspect: inp.aspect, styleFrame: inp.styleFrame, ...g.display });
    // each work reaches half its framed width either side of its centre, and its label a little further
    for (const hw of res.works) hung.push({ ...pointOnWall(w, hw.offset), reach: Math.max(hw.outerW / 2, Math.abs(hw.label.offset - hw.offset) + hw.label.w / 2) });
    // stretches of this wall between doors with nothing hung on them (a windowed wall is not bare: it has its view)
    if (!wallHasWindows(g, pr.room, side)) {
      for (const [a, b] of freeSegments(w.length, doors)) {
        const used = res.works.some((hw) => hw.offset + hw.outerW / 2 > a && hw.offset - hw.outerW / 2 < b);
        if (!used && b - a >= 2.2) empty.push({ ...pointOnWall(w, (a + b) / 2, 0.5), length: b - a });
      }
    }
  }
  const e = entranceOf(g, plan);
  if (e && e.roomId === roomId) hung.push({ ...pointOnWall(pr.walls[e.wall], e.offset), reach: 0.7 });
  const board = pinboardOf(g, plan, roomId);
  if (board) hung.push({ ...pointOnWall(pr.walls[board.wall], board.offset), reach: board.width / 2 });
  return autoPlants(plan, pr, hung, empty);
}

/**
 * The plants of every room: the ones placed by hand where a room has its own list (`room.plants`, measured from
 * the room's centre), the automatic ones elsewhere. None at all when the gallery has plants switched off.
 */
export function roomPlants(g: Gallery, plan: FloorPlan, inp: PlantInput): Map<string, PlantSpot[]> {
  const out = new Map<string, PlantSpot[]>();
  if (!g.environment.plants) return out;
  for (const pr of plan.rooms) {
    const own = pr.room.plants;
    out.set(pr.room.id, own
      ? own.map((p) => ({ x: pr.centre.x + p.x, z: pr.centre.z + p.z, scale: p.size ?? plantSize(pr.room.height) }))
      : autoPlantsFor(g, plan, pr.room.id, inp));
  }
  return out;
}
