import { describe, expect, it } from 'vitest';
import { parseGallery, computeFloorPlan, hangWall, doorsOn, EYE_LINE, type Wall } from '../src';
import { twoRooms, art } from './fixtures';

function setup(mut?: (g: any) => void) {
  const g: any = twoRooms();
  mut?.(g);
  const gal = parseGallery(g).gallery!;
  const plan = computeFloorPlan(gal);
  const artworks = new Map(gal.artworks.map((a) => [a.id, a]));
  const hang = (roomIdx: number, side: 'north' | 'east' | 'south' | 'west', wall?: Partial<Wall>, scales: { artScale?: number; frameScale?: number; labelScale?: number } = {}) => {
    const pr = plan.rooms[roomIdx];
    return hangWall({
      wall: { ...pr.room.walls[side], ...wall } as Wall,
      length: pr.walls[side].length,
      roomHeight: pr.room.height,
      doors: doorsOn(plan, pr.room.id, side),
      artworks,
      aspect: () => 1.5,
      styleFrame: 'thin-black',
      ...scales,
    });
  };
  return { hang, gal };
}

describe('hangWall', () => {
  it('hangs at eye level, true scale, evenly spaced, no overlap', () => {
    const { hang } = setup();
    const { works, warnings } = hang(0, 'north');
    expect(warnings).toEqual([]);
    expect(works).toHaveLength(2);
    expect(works[0].y).toBeCloseTo(EYE_LINE);
    expect(works[0].width).toBeCloseTo(0.6);
    expect(works[0].offset).toBeLessThan(works[1].offset);
    expect(works[0].label.offset + works[0].label.w / 2).toBeLessThan(works[1].offset - works[1].outerW / 2);
    // symmetric about the wall centre
    expect((works[0].offset + works[1].label.offset) / 2).toBeCloseTo(5, 0);
  });

  it('applies the display scales to works, frames and labels', () => {
    const { hang } = setup();
    const base = hang(0, 'north').works[0];
    const big = hang(0, 'north', undefined, { artScale: 1.2, frameScale: 2, labelScale: 1.5 }).works[0];
    expect(big.width).toBeCloseTo(base.width * 1.2);
    expect(big.frame.width).toBeCloseTo(base.frame.width * 2);
    expect(big.mat).toBeCloseTo(base.mat * 1.5);
    expect(big.label.w).toBeCloseTo(base.label.w * 1.5);
    expect(big.label.h).toBeCloseTo(base.label.h * 1.5);
  });

  it('avoids doors', () => {
    const { hang } = setup((g) => { g.rooms[0].walls.east.artworks = ['a', 'b', 'c'].map((artwork) => ({ artwork })); g.rooms[0].walls.north.artworks = []; });
    const { works } = hang(0, 'east');
    for (const w of works) {
      const left = w.offset - w.outerW / 2, right = w.label.offset + w.label.w / 2;
      expect(right < 4 - 0.9 || left > 4 + 0.9).toBe(true);
    }
  });

  it('shrinks works that do not fit and says so', () => {
    const { hang } = setup();
    const { works, warnings } = hang(1, 'west');
    expect(works[0].fitScale).toBeLessThan(1);
    expect(warnings[0]).toMatch(/% of real size/);
    expect(works[0].y + works[0].outerH / 2).toBeLessThanOrEqual(4);
  });

  it('salon stacks works vertically', () => {
    const { hang } = setup((g) => {
      for (let i = 0; i < 6; i++) g.artworks.push(art(`s${i}`, 40, 50));
      g.rooms[0].walls.south = { hang: 'salon', artworks: [0, 1, 2, 3, 4, 5].map((i) => ({ artwork: `s${i}` })) };
    });
    const { works } = hang(0, 'south');
    const xs = new Set(works.map((w) => w.offset.toFixed(2)));
    expect(xs.size).toBeLessThan(6);
  });

  it('honours manual offsets', () => {
    const { hang } = setup((g) => { g.rooms[0].walls.north.artworks[0].offset = 2; });
    expect(hang(0, 'north').works[0].offset).toBe(2);
  });
});
