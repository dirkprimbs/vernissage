import { describe, expect, it } from 'vitest';
import { computeFloorPlan, connected, parseGallery, planIssues, roomGap, settleRooms, snapRoom, type Gallery } from '../src';

/** three rooms placed by hand, each 0.4 m (two walls) from the next: A at the origin, B to its east, C to the east of B */
function three(over: (g: any) => void = () => {}): Gallery {
  const raw: any = {
    title: 'T', layout: { mode: 'custom' },
    rooms: [
      { id: 'a', name: 'A', width: 10, depth: 8, position: { x: 0, z: 0 } },
      { id: 'b', name: 'B', width: 8, depth: 8, position: { x: 9.4, z: 0 } },
      { id: 'c', name: 'C', width: 6, depth: 6, position: { x: 16.8, z: 0 } },
    ],
  };
  over(raw);
  return parseGallery(raw).gallery!;
}
const box = (g: Gallery, i: number) => { const r = g.rooms[i]; return { minX: r.position!.x - r.width / 2, maxX: r.position!.x + r.width / 2, minZ: r.position!.z - r.depth / 2, maxZ: r.position!.z + r.depth / 2 }; };
const withPos = (g: Gallery, i: number, p: { x: number; z: number }) => ({ ...g, rooms: g.rooms.map((r, k) => (k === i ? { ...r, position: p } : r)) });

describe('rooms placed by hand', () => {
  it('connects touching rooms and never builds a corridor across open ground', () => {
    const g = three();
    expect(computeFloorPlan(g).passages).toHaveLength(2);
    const apart = withPos(g, 2, { x: 20, z: 0 }); // 3.2 m from B
    const plan = computeFloorPlan(apart);
    expect(plan.passages).toHaveLength(1);
    expect(connected(plan)).toBe(false);
    expect(planIssues(apart).map((i) => i.severity)).toEqual(['warning']);
  });

  it('connects touching rooms even when they are not consecutive in the tour', () => {
    // C tucked under A instead of beside B
    const g = withPos(three(), 2, { x: 0, z: 4 + 0.4 + 3 });
    expect(computeFloorPlan(g).doors.some((d) => d.roomId === 'a' && d.to === 'c')).toBe(true);
    expect(connected(computeFloorPlan(g))).toBe(true);
  });

  it('flags rooms that run into each other', () => {
    const issues = planIssues(withPos(three(), 1, { x: 6, z: 0 }));
    expect(issues.some((i) => i.severity === 'error' && i.path === 'rooms.1.position')).toBe(true);
  });
});

describe('snapRoom', () => {
  it('docks a room dragged into another against its side instead', () => {
    const g = three();
    const at = snapRoom(g, 'c', { x: 2, z: 1 })!; // right inside A
    const placed = withPos(g, 2, at);
    expect(planIssues(placed)).toEqual([]);
    expect(connected(computeFloorPlan(placed))).toBe(true);
  });

  it('pulls a room dragged far away back against its nearest neighbour', () => {
    const g = three();
    const at = snapRoom(g, 'c', { x: 40, z: 0.3 })!;
    const placed = withPos(g, 2, at);
    const c = box(placed, 2), b = box(placed, 1);
    expect(c.minX - b.maxX).toBeCloseTo(roomGap(g), 6); // flush with B, the gap apart
    expect(at.z).toBe(0); // and drawn to line up with it
    expect(planIssues(placed)).toEqual([]);
  });

  it('slides along a side and keeps enough shared wall for a doorway', () => {
    const g = three();
    const at = snapRoom(g, 'c', { x: 16.8, z: 6 })!; // dragged south along B's east side, past where a doorway still fits
    const c = box(withPos(g, 2, at), 2), b = box(g, 1);
    // docked on B's east side, slid as far south as a doorway allows
    expect(c.minX - b.maxX).toBeCloseTo(roomGap(g), 6);
    const shared = Math.min(c.maxZ, b.maxZ) - Math.max(c.minZ, b.minZ);
    expect(shared).toBeGreaterThanOrEqual(2.4 - 1e-6); // room for a doorway
    expect(shared).toBeLessThan(2.75); // and no further back than the next quarter-metre step
    expect(computeFloorPlan(withPos(g, 2, at)).doors.some((d) => d.roomId === 'b' && d.to === 'c')).toBe(true);
  });

  it('will not strand another room: B cannot leave while C hangs on it', () => {
    const g = three();
    const at = snapRoom(g, 'b', { x: 0, z: -30 })!; // towards the north of A
    const placed = withPos(g, 1, at);
    expect(connected(computeFloorPlan(placed))).toBe(true);
    expect(planIssues(placed)).toEqual([]);
  });
});

describe('settleRooms', () => {
  it('pushes the next room along when a room grows into it, and pulls it back when it shrinks', () => {
    const grown = three((r) => { r.rooms[0].width = 14; });
    const next = settleRooms(grown)!;
    const placed = { ...grown, rooms: grown.rooms.map((r, i) => ({ ...r, position: next[i] })) };
    expect(planIssues(placed)).toEqual([]);
    expect(box(placed, 1).minX - box(placed, 0).maxX).toBeCloseTo(roomGap(grown), 6);
    const shrunk = three((r) => { r.rooms[0].width = 6; });
    const back = settleRooms(shrunk)!;
    const placed2 = { ...shrunk, rooms: shrunk.rooms.map((r, i) => ({ ...r, position: back[i] })) };
    expect(planIssues(placed2)).toEqual([]);
    expect(connected(computeFloorPlan(placed2))).toBe(true);
  });

  it('leaves a good arrangement alone, and the automatic arrangements entirely', () => {
    expect(settleRooms(three())).toBeUndefined();
    expect(settleRooms(three((r) => { r.layout = { mode: 'linear' }; }))).toBeUndefined();
  });
});
