import { describe, expect, it } from 'vitest';
import { blockersOn, computeFloorPlan, entranceOf, hangWall, parseGallery, wallHasWindows, type Wall } from '../src';
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

  it('windows: an explicit choice wins, otherwise bare walls get them', () => {
    const { g } = setup((r) => { r.rooms[0].walls.south = { windows: false }; r.rooms[0].walls.north.windows = true; });
    const room = g.rooms[0];
    expect(wallHasWindows(g, room, 'south')).toBe(false); // bare, but closed
    expect(wallHasWindows(g, room, 'north')).toBe(true); // hung with art, but windowed
    expect(wallHasWindows(g, room, 'west')).toBe(true); // bare and undecided
    expect(wallHasWindows(g, room, 'east')).toBe(false); // has art
  });
});
