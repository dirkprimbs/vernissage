import { describe, expect, it } from 'vitest';
import { PINBOARD, blockersOn, clampPin, computeFloorPlan, entranceOf, freeSegments, layoutPins, noteLines, parseGallery, pinShape, pinboardOf, turnedShape, wrapTilt, type PinItem } from '../src';

const photo = (id: string, format: 'mini' | 'square' | 'wide' = 'mini', extra: Record<string, unknown> = {}) => ({ id, kind: 'photo' as const, file: `assets/${id}.jpg`, format, ...extra });
const gallery = (pinboard: unknown, rooms = 1) => parseGallery({
  title: 'T', artworks: [],
  rooms: Array.from({ length: rooms }, (_, i) => ({ id: `r${i}`, name: `R${i}`, width: 12, depth: 9, height: 4.6, walls: { north: { windows: true } }, ...(i === rooms - 1 ? { pinboard } : {}) })),
}).gallery!;

describe('pinboard', () => {
  it('hangs beside the entry door and keeps art off its stretch of wall', () => {
    const g = gallery({ items: [] }), plan = computeFloorPlan(g);
    const e = entranceOf(g, plan)!, b = pinboardOf(g, plan, 'r0')!;
    expect(b.wall).toBe(e.wall);
    expect(b.width).toBe(PINBOARD.width);
    // beside the door, a hand's width away, and on the wall
    expect(Math.abs(b.offset - e.offset) - b.width / 2 - e.width / 2).toBeCloseTo(PINBOARD.gap, 6);
    expect(b.offset - b.width / 2).toBeGreaterThan(0);
    expect(b.offset + b.width / 2).toBeLessThan(plan.rooms[0].walls[b.wall].length);
    const blockers = blockersOn(g, plan, 'r0', b.wall);
    expect(blockers.some((d) => d.pinboard)).toBe(true);
    for (const [a, z] of freeSegments(plan.rooms[0].walls[b.wall].length, blockers)) expect(z <= b.offset - b.width / 2 || a >= b.offset + b.width / 2).toBe(true);
    // a room without one has none
    const bare = gallery(undefined);
    expect(pinboardOf(bare, computeFloorPlan(bare), 'r0')).toBeUndefined();
  });

  it('in a room without the entry door, hangs beside the doorway to the next room', () => {
    const g = gallery({ items: [] }, 2), plan = computeFloorPlan(g);
    const b = pinboardOf(g, plan, 'r1')!, door = plan.doors.find((d) => d.roomId === 'r1')!;
    expect(b.wall).toBe(door.wall);
    expect(Math.abs(b.offset - door.offset) - b.width / 2 - door.width / 2).toBeCloseTo(PINBOARD.gap, 6);
  });

  it('knows the three instant formats and keeps every card on the board', () => {
    const shapes = (['mini', 'square', 'wide'] as const).map((f) => pinShape(photo('p', f) as PinItem));
    expect(shapes.map((s) => Math.round((s.w / s.h) * 1000))).toEqual([Math.round((54 / 86) * 1000), Math.round((72 / 86) * 1000), Math.round((108 / 86) * 1000)]);
    // the picture windows: upright, square, landscape, with the wide border at the bottom
    expect(shapes.map((s) => Math.round((s.image!.w / s.image!.h) * 100))).toEqual([74, 100, 160]);
    for (const s of shapes) expect(s.h - (s.image!.y + s.image!.h)).toBeGreaterThan(s.image!.y * 2);
    const c = clampPin(5, -3, shapes[2], 2, 1.3);
    expect(c.x * 2 + shapes[2].w / 2).toBeLessThanOrEqual(2);
    expect(c.y * 1.3 - shapes[2].h / 2).toBeGreaterThanOrEqual(0);
  });

  it('lays cards out by itself, the same way every time, and honours places given by hand', () => {
    const board = gallery({ items: [...Array.from({ length: 14 }, (_, i) => photo(`p${i}`, (['mini', 'square', 'wide'] as const)[i % 3])), { id: 'n', kind: 'note', text: 'hi' }, photo('fixed', 'mini', { x: 0.5, y: 0.5, tilt: 0 })] }).rooms[0].pinboard!;
    const a = layoutPins(board, 2, 1.3), b = layoutPins(board, 2, 1.3);
    expect(a).toEqual(b);
    expect(a).toHaveLength(16);
    expect(a[15]).toEqual({ id: 'fixed', x: 0.5, y: 0.5, tilt: 0 });
    a.forEach((p, i) => {
      const s = pinShape(board.items[i]);
      expect(p.x * 2 - s.w / 2).toBeGreaterThanOrEqual(0); expect(p.x * 2 + s.w / 2).toBeLessThanOrEqual(2);
      expect(p.y * 1.3 - s.h / 2).toBeGreaterThanOrEqual(0); expect(p.y * 1.3 + s.h / 2).toBeLessThanOrEqual(1.3);
      expect(Math.abs(p.tilt)).toBeLessThanOrEqual(5);
    });
    // the first row does not pile up
    expect(a[1].x).toBeGreaterThan(a[0].x);
  });

  it('keeps a turned card on the board by its turned outline', () => {
    const wide = pinShape(photo('p', 'wide') as PinItem);
    const upright = turnedShape(wide, 90);
    expect(upright.w).toBeCloseTo(wide.h, 6);
    expect(upright.h).toBeCloseTo(wide.w, 6);
    expect(turnedShape(wide, 45).w).toBeGreaterThan(wide.w);
    expect([wrapTilt(190), wrapTilt(-185), wrapTilt(180), wrapTilt(5)]).toEqual([-170, 175, -180, 5]);
    // at the very top of the board, a card stood on end sits lower than one lying flat
    const board = gallery({ items: [photo('flat', 'wide', { x: 0.5, y: 0, tilt: 0 }), photo('up', 'wide', { x: 0.5, y: 0, tilt: 90 })] }).rooms[0].pinboard!;
    const [flat, up] = layoutPins(board, 2, 1.3);
    expect(up.tilt).toBe(90);
    expect(up.y).toBeGreaterThan(flat.y);
    expect(up.y * 1.3 - wide.w / 2).toBeGreaterThanOrEqual(0);
  });

  it('reduces a note to plain lines for the card on the board', () => {
    expect(noteLines('# Hello\n\nSee [my **blog**](https://example.org) and <https://x.org>\n- one\n* `two`')).toEqual([
      { text: 'Hello', heading: true }, { text: '', heading: false },
      { text: 'See my blog and https://x.org', heading: false }, { text: '• one', heading: false }, { text: '• two', heading: false },
    ]);
  });
});
