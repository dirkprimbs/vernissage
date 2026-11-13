import { describe, expect, it } from 'vitest';
import { parseGallery, computeFloorPlan, collisionSegments, resolveCollision, freeSegments, roomAt } from '../src';
import { WALL_THICKNESS } from '../src';
import { twoRooms } from './fixtures';

const plan = (mut?: (g: any) => void) => {
  const g: any = twoRooms();
  mut?.(g);
  return computeFloorPlan(parseGallery(g).gallery!);
};

describe('floor plan', () => {
  it('places linear rooms side by side and connects them', () => {
    const p = plan();
    // two wall thicknesses: each room's wall stands outside its own interior, and overlapping walls z-fight in doorways
    expect(p.rooms[1].minX - p.rooms[0].maxX).toBeCloseTo(2 * WALL_THICKNESS);
    expect(p.doors).toHaveLength(2);
    expect(p.doors.map((d) => `${d.roomId}:${d.wall}`).sort()).toEqual(['r1:east', 'r2:west']);
    expect(p.passages).toHaveLength(1);
    // doors line up in world space
    const east = p.doors.find((d) => d.wall === 'east')!;
    const west = p.doors.find((d) => d.wall === 'west')!;
    const zEast = p.rooms[0].walls.east.start.z + east.offset;
    const zWest = p.rooms[1].walls.west.start.z - west.offset;
    expect(zEast).toBeCloseTo(zWest);
  });

  it('builds a serpentine grid with consecutive rooms connected', () => {
    const p = plan((g) => {
      g.layout = { mode: 'grid', columns: 2 };
      g.rooms.push({ id: 'r3', name: 'Three' }, { id: 'r4', name: 'Four' });
    });
    expect(p.rooms[2].centre.x).toBeCloseTo(p.rooms[1].centre.x); // r3 below r2
    expect(p.passages).toHaveLength(3);
  });

  it('respects explicit doorways', () => {
    const p = plan((g) => { g.rooms[0].doorways = [{ wall: 'south', offset: 5 }]; });
    expect(p.doors.filter((d) => d.roomId === 'r1')).toEqual([expect.objectContaining({ wall: 'south', offset: 5 })]);
  });

  it('free segments skip doors', () => {
    expect(freeSegments(10, [{ roomId: 'x', wall: 'north', offset: 5, width: 2, height: 2.5 }], 0)).toEqual([[0, 4], [6, 10]]);
  });
});

describe('collision', () => {
  it('keeps the visitor inside walls but lets them through doors', () => {
    const p = plan();
    const segs = collisionSegments(p);
    const east = p.rooms[0].maxX;
    // pushing into a solid part of the east wall
    const blocked = resolveCollision({ x: east - 0.1, z: p.rooms[0].minZ + 0.6 }, 0.3, segs);
    expect(blocked.x).toBeLessThanOrEqual(east - 0.29);
    // in the doorway centre there is no wall
    const door = resolveCollision({ x: east + 0.15, z: 0 }, 0.3, segs);
    expect(door.x).toBeCloseTo(east + 0.15);
    expect(roomAt(p, { x: p.rooms[1].centre.x, z: 0 })?.room.id).toBe('r2');
  });
});
