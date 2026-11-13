import type { GalleryInput, WallSide } from './model';
import { parseGallery } from './model';
import { blockersOn, computeFloorPlan, freeSegments, type FloorPlan, type PlacedRoom } from './layout';

/** The room a new gallery starts with: three closed walls for art and a windowed north wall onto the view. */
export function starterRoom(id: string, name: string) {
  return {
    id, name, width: 12, depth: 9, height: 4.6,
    walls: {
      north: { artworks: [] as Array<{ artwork: string }>, hang: 'centred' as const, windows: true },
      east: { artworks: [] as Array<{ artwork: string }>, hang: 'centred' as const, windows: false },
      south: { artworks: [] as Array<{ artwork: string }>, hang: 'centred' as const, windows: false },
      west: { artworks: [] as Array<{ artwork: string }>, hang: 'centred' as const, windows: false },
    },
  };
}

export interface WorkShape { id: string; /** width / height */ aspect: number }

/** a work this wide gets a stretch of wall to itself */
export const PANORAMA = 2.2;
/** wall a panorama needs, and wall one ordinary upright work needs, in metres */
const PANORAMA_WALL = 4.4, UNIT_WALL = 2.3;

/** how much wall a work asks for, in units of one upright picture */
export function wallUnits(aspect: number): number {
  if (aspect >= 1.15) return 1.6;
  if (aspect > 0.85) return 1.3;
  if (aspect < 0.5) return 0.8;
  return 1;
}

/** does the wall look outdoors (no other room beyond it)? */
function facesOutdoors(plan: FloorPlan, pr: PlacedRoom, side: WallSide): boolean {
  const w = pr.walls[side];
  const x = w.start.x + w.along.x * (w.length / 2) - w.normal.x * 1.5, z = w.start.z + w.along.z * (w.length / 2) - w.normal.z * 1.5;
  return !plan.rooms.some((r) => x > r.minX - 0.5 && x < r.maxX + 0.5 && z > r.minZ - 0.5 && z < r.maxZ + 0.5);
}

/** rooms in a row up to four, then two rows, then more rows of ten */
function shell(n: number): GalleryInput {
  const rooms = Array.from({ length: n }, (_, i) => starterRoom(`room-${i + 1}`, `Room ${i + 1}`));
  return { title: 'x', layout: n <= 4 ? { mode: 'linear' } : { mode: 'grid', columns: Math.min(10, Math.ceil(n / 2)) }, rooms };
}

/**
 * Suggest rooms for a set of works and hang them in order. The number of rooms follows the number and shapes of
 * the works; a panorama always gets a stretch of wall to itself, so no smaller pictures compete with it.
 * Returns the `layout` and `rooms` of a gallery.
 */
export function suggestRooms(works: WorkShape[]): Pick<GalleryInput, 'layout' | 'rooms'> {
  for (let n = 1; n <= 60; n++) {
    for (const even of [true, false]) {
      const input = shell(n);
      const g = parseGallery(input).gallery!;
      let plan = computeFloorPlan(g);
      // the window wall: north where that is an outside wall without a doorway, otherwise the next best
      plan.rooms.forEach((pr, i) => {
        const free = (s: WallSide) => facesOutdoors(plan, pr, s) && !plan.doors.some((d) => d.roomId === pr.room.id && d.wall === s);
        const win = (['north', 'south', 'east', 'west'] as WallSide[]).find(free); // a room boxed in by others has none
        for (const s of ['north', 'east', 'south', 'west'] as WallSide[]) { g.rooms[i].walls[s].windows = s === win; input.rooms[i].walls![s]!.windows = s === win; }
      });
      plan = computeFloorPlan(g);
      // every stretch of wall art can hang on, in walking order
      const stretches: Array<{ room: number; side: WallSide; len: number; cap: number; ids: string[]; units: number; pano: boolean }> = [];
      plan.rooms.forEach((pr, i) => {
        for (const side of ['west', 'north', 'east', 'south'] as WallSide[]) {
          if (g.rooms[i].walls[side].windows) continue;
          for (const [a, b] of freeSegments(pr.walls[side].length, blockersOn(g, plan, pr.room.id, side))) {
            const len = b - a;
            if (len >= 1.8) stretches.push({ room: i, side, len, cap: (len - 0.6) / UNIT_WALL, ids: [], units: 0, pano: false });
          }
        }
      });
      const total = works.reduce((s, w) => s + (w.aspect >= PANORAMA ? 0 : wallUnits(w.aspect)), 0);
      const panos = works.filter((w) => w.aspect >= PANORAMA).length;
      const room = stretches.filter((s) => s.len >= PANORAMA_WALL).length;
      if (panos > room) break; // not enough long walls: more rooms
      const capacity = stretches.reduce((s, x) => s + x.cap, 0);
      // "even" spreads the works over all the rooms instead of filling the first ones to the brim
      const fill = even ? Math.min(1, (total / Math.max(0.01, capacity - panos * 2)) * 1.12) : 1;
      const sameWall = (s: (typeof stretches)[number]) => stretches.filter((x) => x.room === s.room && x.side === s.side);
      let si = 0, ok = true;
      const limit = (x: (typeof stretches)[number]) => Math.max(1, x.cap * fill) + 1e-6;
      for (const w of works) {
        const u = wallUnits(w.aspect);
        if (w.aspect >= PANORAMA) {
          // a panorama takes a whole empty wall: the next one from here on, or failing that an earlier one.
          // The other works carry on where they were, so walls before it still fill up.
          const fits = (x: (typeof stretches)[number]) => x.len >= PANORAMA_WALL && sameWall(x).every((y) => !y.ids.length && !y.pano);
          const s = stretches.slice(si).find(fits) ?? stretches.find(fits);
          if (!s) { ok = false; break; }
          s.ids.push(w.id);
          for (const x of sameWall(s)) x.pano = true;
          continue;
        }
        // an empty stretch takes any one work; after that it fills up to its share
        while (si < stretches.length && (stretches[si].pano || (stretches[si].ids.length > 0 && stretches[si].units + u > limit(stretches[si])))) si++;
        if (si >= stretches.length) { ok = false; break; }
        stretches[si].ids.push(w.id); stretches[si].units += u;
      }
      if (!ok) continue;
      for (const s of stretches) for (const id of s.ids) input.rooms[s.room].walls![s.side]!.artworks!.push({ artwork: id });
      return { layout: input.layout, rooms: input.rooms };
    }
  }
  throw new Error('Could not lay out this many works');
}
