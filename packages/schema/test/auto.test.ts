import { describe, expect, it } from 'vitest';
import { blockersOn, computeFloorPlan, entranceOf, hangWall, largestScale, parseGallery, windowedDoorWalls, wallHasWindows, type Wall } from '../src';
import { art, twoRooms } from './fixtures';

/** hang n works with the given aspect ratios on a clear wall, auto-sized */
function auto(aspects: number[], length = 12, scales: Array<number | undefined> = [], roomHeight = 4.6) {
  const arts = aspects.map((_, i) => ({ ...art(`w${i}`), dimensions: undefined }));
  const g = parseGallery({ title: 'T', artworks: arts, rooms: [{ id: 'r', name: 'R', walls: {} }] }).gallery!;
  const wall = { artworks: aspects.map((_, i) => ({ artwork: `w${i}`, scale: scales[i] })), hang: 'centred' } as Wall;
  return hangWall({
    wall, length, roomHeight, doors: [], artworks: new Map(g.artworks.map((a) => [a.id, a])),
    aspect: (id) => aspects[Number(id.slice(1))], styleFrame: 'thin-black', sizing: 'auto',
  });
}

describe('auto sizing', () => {
  it('makes few works large and many works smaller, without warnings', () => {
    const two = auto([0.75, 0.75]), eight = auto(Array(8).fill(0.75));
    expect(two.warnings).toEqual([]);
    expect(eight.warnings).toEqual([]);
    expect(two.works[0].height).toBeGreaterThan(1.3);
    expect(eight.works[0].height).toBeLessThan(two.works[0].height * 0.75);
    // nothing overlaps and everything stays on the wall
    const w = eight.works;
    for (let i = 1; i < w.length; i++) expect(w[i].offset - w[i].outerW / 2).toBeGreaterThan(w[i - 1].label.offset + w[i - 1].label.w / 2);
    expect(w[0].offset - w[0].outerW / 2).toBeGreaterThan(0);
    expect(w[7].label.offset + w[7].label.w / 2).toBeLessThan(12);
  });

  it('gives every shape the same area, so a panorama does not dwarf a portrait', () => {
    const { works } = auto([2.7, 0.75, 1.33]);
    const areas = works.map((w) => w.width * w.height);
    expect(areas[1]).toBeCloseTo(areas[0], 2);
    expect(areas[2]).toBeCloseTo(areas[0], 2);
    expect(works[0].width).toBeGreaterThan(works[1].width * 1.8);
    expect(works[0].height).toBeLessThan(works[1].height);
  });

  it('lets one work be made larger or smaller than the rest', () => {
    const { works } = auto([1, 1, 1], 12, [undefined, 1.5, 0.6]);
    expect(works[1].width / works[0].width).toBeCloseTo(1.5, 2);
    expect(works[2].width / works[0].width).toBeCloseTo(0.6, 2);
  });

  it('resizing one work leaves the others alone while the wall has room', () => {
    const before = auto([0.75, 0.75, 0.75], 12).works;
    const after = auto([0.75, 0.75, 0.75], 12, [undefined, 1.4, undefined]);
    expect(after.warnings).toEqual([]);
    expect(after.works[0].width).toBeCloseTo(before[0].width, 6);
    expect(after.works[2].width).toBeCloseTo(before[2].width, 6);
    expect(after.works[1].width).toBeCloseTo(before[1].width * 1.4, 6);
    const smaller = auto([0.75, 0.75, 0.75], 12, [0.5]);
    expect(smaller.works[1].width).toBeCloseTo(before[1].width, 6);
  });

  it('shrinks everything together, and says so, only when the wall is full', () => {
    const many = Array(7).fill(0.75);
    const base = auto(many, 12).works;
    // resized works first use up the generous spacing, and the others keep their size
    const roomy = auto(many, 12, [2.5, 2.5]);
    expect(roomy.squeezed).toBe(false);
    expect(roomy.works[3].width).toBeCloseTo(base[3].width, 6);
    const full = auto(many, 12, [2.5, 2.5, 2.5, 2.5, 2.5]);
    expect(full.squeezed).toBe(true);
    expect(full.warnings.join()).toMatch(/wall is full/);
    expect(full.works[6].width).toBeLessThan(base[6].width);
    expect(full.works[0].width / full.works[6].width).toBeCloseTo(2.5, 2);
    for (const w of [roomy.works, full.works])
      for (let i = 1; i < w.length; i++) expect(w[i].offset - w[i].outerW / 2).toBeGreaterThan(w[i - 1].label.offset + w[i - 1].label.w / 2);
  });

  it('finds how large one work can get without its neighbours giving way', () => {
    const many = Array(7).fill(0.75);
    const input = (scales: Array<number | undefined>) => {
      const arts = many.map((_, i) => ({ ...art(`w${i}`), dimensions: undefined }));
      const g = parseGallery({ title: 'T', artworks: arts, rooms: [{ id: 'r', name: 'R', walls: {} }] }).gallery!;
      return {
        wall: { artworks: many.map((_, i) => ({ artwork: `w${i}`, scale: scales[i] })), hang: 'centred' } as Wall, length: 12, roomHeight: 4.6, doors: [],
        artworks: new Map(g.artworks.map((a) => [a.id, a])), aspect: () => 0.75, styleFrame: 'thin-black' as const, sizing: 'auto' as const,
      };
    };
    const base = hangWall(input([])).works;
    // room to spare: the wanted size is granted
    expect(largestScale(input([]), 0, 1.5)).toBe(1.5);
    // more than fits: capped, and at the cap nobody else has changed
    const inp = input([2.5, 2.5]);
    const cap = largestScale(inp, 2, 2.5);
    expect(cap).toBeGreaterThanOrEqual(1);
    expect(cap).toBeLessThan(2.5);
    const at = hangWall(input([2.5, 2.5, cap]));
    expect(at.squeezed).toBe(false);
    expect(at.works[6].width).toBeCloseTo(base[6].width, 6);
    expect(hangWall(input([2.5, 2.5, cap + 0.05])).squeezed).toBe(true);
    // getting smaller is always allowed, and an overfull wall never lets a work grow
    expect(largestScale(inp, 0, 0.6)).toBe(0.6);
    expect(largestScale(input([2.5, 2.5, 2.5, 2.5, 2.5]), 5, 1.4)).toBe(1);
  });

  it('lets a work be put on either side of a door', () => {
    const arts = [0, 1, 2].map((i) => ({ ...art(`w${i}`), dimensions: undefined }));
    const g = parseGallery({ title: 'T', artworks: arts, rooms: [{ id: 'r', name: 'R', walls: {} }] }).gallery!;
    const door = { roomId: 'r', wall: 'east' as const, offset: 4.5, width: 1.8, height: 2.6 };
    const hang = (stretches: Array<number | undefined>) => hangWall({
      wall: { artworks: stretches.map((stretch, i) => ({ artwork: `w${i}`, stretch })), hang: 'centred' } as Wall, length: 9, roomHeight: 4.6, doors: [door],
      artworks: new Map(g.artworks.map((a) => [a.id, a])), aspect: () => 0.75, styleFrame: 'thin-black', sizing: 'auto',
    });
    // a lone work goes left of the door unless told otherwise
    expect(hang([undefined]).works[0]).toMatchObject({ stretch: 0 });
    expect(hang([undefined]).works[0].offset).toBeLessThan(4.5 - 0.9);
    const right = hang([1]).works[0];
    expect(right.stretch).toBe(1);
    expect(right.offset).toBeGreaterThan(4.5 + 0.9);
    // the same size on either side
    expect(right.width).toBeCloseTo(hang([0]).works[0].width, 6);
    // two works share the sides unless both are sent to one
    expect(hang([undefined, undefined]).works.map((w) => w.stretch)).toEqual([0, 1]);
    const both = hang([1, 1]).works;
    expect(both.map((w) => w.stretch)).toEqual([1, 1]);
    expect(both[0].offset).toBeLessThan(both[1].offset);
    expect(both[1].label.offset + both[1].label.w / 2).toBeLessThan(9);
    expect(hang([0, 0, 1]).works.map((w) => w.stretch)).toEqual([0, 0, 1]);
    // a side that no longer exists (the door is gone) falls back to the wall there is
    const noDoor = hangWall({
      wall: { artworks: [{ artwork: 'w0', stretch: 1 }], hang: 'centred' } as Wall, length: 9, roomHeight: 4.6, doors: [],
      artworks: new Map(g.artworks.map((a) => [a.id, a])), aspect: () => 0.75, styleFrame: 'thin-black', sizing: 'auto',
    });
    expect(noDoor.works[0].stretch).toBe(0);
    expect(noDoor.works[0].offset).toBeCloseTo(4.5, 0);
  });

  it('keeps a lone work a picture, not a mural, and respects low ceilings', () => {
    expect(auto([0.37], 20).works[0].height).toBeLessThanOrEqual(1.75 + 1e-6);
    expect(auto([3.5], 20).works[0].width).toBeLessThanOrEqual(3.4 + 1e-6);
    const low = auto([0.5], 12, [], 2.8).works[0];
    expect(low.y + low.outerH / 2).toBeLessThanOrEqual(2.8 - 0.35 + 1e-6);
  });
});

describe('entry door and windows', () => {
  const setup = (mut?: (g: any) => void) => {
    const raw: any = twoRooms();
    mut?.(raw);
    const g = parseGallery(raw).gallery!;
    return { g, plan: computeFloorPlan(g) };
  };

  it('puts the door on the south wall of the first room and keeps art clear of it', () => {
    const { g, plan } = setup((r) => { r.rooms[0].walls.south = { artworks: [{ artwork: 'c' }] }; r.rooms[0].walls.east = {}; });
    const e = entranceOf(g, plan)!;
    expect([e.roomId, e.wall]).toEqual(['r1', 'south']);
    expect(e.offset).toBeCloseTo(5);
    const blockers = blockersOn(g, plan, 'r1', 'south');
    expect(blockers).toHaveLength(1);
    const { works } = hangWall({
      wall: g.rooms[0].walls.south, length: 10, roomHeight: 4, doors: blockers,
      artworks: new Map(g.artworks.map((a) => [a.id, a])), aspect: () => 0.75, styleFrame: 'thin-black', sizing: 'auto',
    });
    const w = works[0];
    expect(w.offset + w.outerW / 2 < e.offset - e.width / 2 || w.offset - w.outerW / 2 > e.offset + e.width / 2).toBe(true);
  });

  it('avoids windowed walls and doorways, honours an explicit wall, and can be switched off', () => {
    // r1's east wall has the doorway to r2; make south the window wall
    const { g, plan } = setup((r) => { r.rooms[0].walls.south = { windows: true }; });
    expect(entranceOf(g, plan)!.wall).toBe('west');
    const chosen = setup((r) => { r.entrance = { wall: 'north' }; });
    expect(entranceOf(chosen.g, chosen.plan)!.wall).toBe('north');
    const off = setup((r) => { r.entrance = { enabled: false }; });
    expect(entranceOf(off.g, off.plan)).toBeUndefined();
    expect(blockersOn(off.g, off.plan, 'r1', 'south')).toEqual([]);
  });

  it('finds the window walls of a room that carry a doorway', () => {
    const room = (id: string, x: number, z: number) => ({ id, name: id, width: 12, depth: 9, position: { x, z }, walls: { north: { windows: true }, east: { windows: true } } });
    // b sits south of a: their doorway is in b's north wall, which is marked as a window wall
    const g = parseGallery({ title: 'T', layout: { mode: 'custom' }, artworks: [], rooms: [room('a', 0, 0), room('b', 0, 9.4)] }).gallery!;
    const plan = computeFloorPlan(g);
    expect(windowedDoorWalls(g, plan, 'b')).toEqual(['north']);
    // a's doorway is in its south wall, which has no windows; its window walls face outdoors
    expect(windowedDoorWalls(g, plan, 'a')).toEqual([]);
  });

  it('windows: an explicit choice wins, otherwise bare walls get them', () => {
    const { g } = setup((r) => { r.rooms[0].walls.south = { windows: false }; r.rooms[0].walls.north.windows = true; });
    const room = g.rooms[0];
    expect(wallHasWindows(g, room, 'south')).toBe(false); // bare, but closed
    expect(wallHasWindows(g, room, 'north')).toBe(true); // hung with art, but windowed
    expect(wallHasWindows(g, room, 'west')).toBe(true); // bare and undecided
    expect(wallHasWindows(g, room, 'east')).toBe(false); // has art
  });
});
