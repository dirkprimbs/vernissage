import { describe, expect, it } from 'vitest';
import { PANORAMA, WALL_SIDES, blockersOn, computeFloorPlan, hangWall, parseGallery, suggestRooms, type WorkShape } from '../src';

const works = (aspects: number[]): WorkShape[] => aspects.map((aspect, i) => ({ id: `p${i}`, aspect }));
const build = (shapes: WorkShape[]) => {
  const s = suggestRooms(shapes);
  const r = parseGallery({
    title: 'T', ...s,
    artworks: shapes.map((w) => ({ id: w.id, file: `assets/${w.id}.jpg`, title: w.id, artist: { name: 'A' }, provenance: [{ event: 'x' }] })),
  });
  return { g: r.gallery!, issues: r.issues };
};
const wallsOf = (g: ReturnType<typeof build>['g']) => g.rooms.flatMap((r) => WALL_SIDES.map((side) => ({ room: r, side, wall: r.walls[side] })));

describe('suggestRooms', () => {
  // the shapes of a real album: portraits, one panorama, one landscape, one very tall picture
  const album = [0.75, 0.75, 0.75, 0.75, 2.71, 1.33, 0.37, 0.67, 0.75, 0.75, 0.75, 0.75];

  it('hangs every work once, in order, in a valid gallery', () => {
    const { g, issues } = build(works(album));
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    const hung = wallsOf(g).flatMap((w) => w.wall.artworks.map((p) => p.artwork));
    expect([...hung].sort()).toEqual(album.map((_, i) => `p${i}`).sort());
    expect(g.rooms.length).toBeGreaterThanOrEqual(2);
    expect(g.rooms.length).toBeLessThanOrEqual(3);
  });

  it('gives a panorama a wall to itself', () => {
    const { g } = build(works(album));
    const wall = wallsOf(g).find((w) => w.wall.artworks.some((p) => p.artwork === 'p4'))!;
    expect(wall.wall.artworks).toHaveLength(1);
    expect(album[4]).toBeGreaterThan(PANORAMA);
  });

  it('gives each room one windowed wall and leaves it bare', () => {
    const { g } = build(works(album));
    for (const r of g.rooms) {
      const win = WALL_SIDES.filter((s) => r.walls[s].windows);
      expect(win).toHaveLength(1);
      expect(r.walls[win[0]].artworks).toEqual([]);
    }
    expect(g.rooms[0].walls.north.windows).toBe(true);
  });

  it('adds rooms as the album grows and nothing ends up crowded', () => {
    const many = works(Array.from({ length: 64 }, (_, i) => [0.75, 1.5, 1, 0.67, 2.4][i % 5]));
    const { g } = build(many);
    expect(g.rooms.length).toBeGreaterThan(4);
    const plan = computeFloorPlan(g);
    const byId = new Map(g.artworks.map((a) => [a.id, a]));
    for (const pr of plan.rooms) for (const side of WALL_SIDES) {
      const res = hangWall({
        wall: pr.room.walls[side], length: pr.walls[side].length, roomHeight: pr.room.height, doors: blockersOn(g, plan, pr.room.id, side),
        artworks: byId, aspect: (id) => many.find((w) => w.id === id)!.aspect, styleFrame: 'steel', ...g.display,
      });
      expect(res.warnings).toEqual([]);
      // with auto sizing nothing should have to shrink below a comfortable size
      for (const w of res.works) expect(Math.max(w.width, w.height)).toBeGreaterThan(0.6);
    }
  });

  it('a handful of works needs just the one room', () => {
    expect(build(works([0.75, 1.5, 0.75])).g.rooms).toHaveLength(1);
    expect(build([]).g.rooms).toHaveLength(1);
  });
});
