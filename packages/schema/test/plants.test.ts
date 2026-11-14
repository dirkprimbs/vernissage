import { describe, expect, it } from 'vitest';
import { PLANT_SPACING, autoPlants, computeFloorPlan, parseGallery, plantSize, roomPlants } from '../src';
import { art } from './fixtures';

const inp = { aspect: () => 0.75, styleFrame: 'thin-black' as const };
const room = (id: string, x: number, extra: Record<string, unknown> = {}) => ({ id, name: id, width: 12, depth: 9, height: 4.6, position: { x, z: 0 }, walls: { north: { windows: true } }, ...extra });

describe('plants', () => {
  it('automatic: free corners, and no wall plant beside another plant', () => {
    const g = parseGallery({ title: 'T', artworks: [], rooms: [{ id: 'r', name: 'R', width: 12, depth: 9, walls: {} }] }).gallery!;
    const plan = computeFloorPlan(g), pr = plan.rooms[0], c = pr.centre;
    expect(autoPlants(plan, pr, [], [])).toHaveLength(4);
    const corner = { x: c.x + 6 - 0.55, z: c.z + 4.5 - 0.55 };
    const plants = autoPlants(plan, pr, [], [
      { x: corner.x - 1.2, z: corner.z, length: 3.2 }, // a short bare stretch ending at the corner: its plant would pair up with the corner's
      { x: c.x, z: c.z - 4, length: 9 }, // the middle of a long bare wall
    ]);
    expect(plants).toHaveLength(5);
    for (let i = 0; i < plants.length; i++) for (let j = i + 1; j < plants.length; j++)
      expect(Math.hypot(plants[i].x - plants[j].x, plants[i].z - plants[j].z)).toBeGreaterThanOrEqual(PLANT_SPACING);
  });

  it('automatic: a room is judged by its own walls, not by what stands or hangs next door', () => {
    const alone = parseGallery({ title: 'T', layout: { mode: 'custom' }, artworks: [art('a')], rooms: [room('b', 12.4)] }).gallery!;
    // the same room with a neighbour to the west whose east wall carries a work and whose corners have plants
    const both = parseGallery({ title: 'T', layout: { mode: 'custom' }, artworks: [art('a')], rooms: [room('a', 0, { walls: { north: { windows: true }, east: { artworks: [{ artwork: 'a' }] } } }), room('b', 12.4)] }).gallery!;
    const mine = (g: typeof both) => roomPlants(g, computeFloorPlan(g), inp).get('b')!.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`);
    const withNeighbour = mine(both), single = mine(alone);
    // the doorway to the neighbour takes nothing but the plants beside it: everything else is as in the room alone
    expect(withNeighbour.length).toBeGreaterThan(0);
    for (const p of withNeighbour) expect(single).toContain(p);
    // the east side of the room, away from the neighbour, is untouched by it
    expect(withNeighbour.filter((p) => parseFloat(p) > 12.4)).toEqual(single.filter((p) => parseFloat(p) > 12.4));
  });

  it('by hand: a room with its own list gets exactly those, measured from its centre', () => {
    const g = parseGallery({ title: 'T', layout: { mode: 'custom' }, artworks: [], rooms: [room('a', 0), room('b', 12.4, { plants: [{ x: 1, z: -2 }, { x: -3, z: 3, size: 1.8 }] }), room('c', 24.8, { plants: [] })] }).gallery!;
    const plants = roomPlants(g, computeFloorPlan(g), inp);
    expect(plants.get('b')).toEqual([{ x: 13.4, z: -2, scale: plantSize(4.6) }, { x: 9.4, z: 3, scale: 1.8 }]);
    expect(plants.get('c')).toEqual([]); // an empty list: a room cleared of plants
    expect(plants.get('a')!.length).toBeGreaterThan(0); // still automatic
    const off = parseGallery({ title: 'T', artworks: [], environment: { plants: false }, rooms: [room('a', 0, { plants: [{ x: 0, z: 0 }] })] }).gallery!;
    expect(roomPlants(off, computeFloorPlan(off), inp).size).toBe(0);
  });
});
