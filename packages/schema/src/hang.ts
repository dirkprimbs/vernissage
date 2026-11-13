import type { Artwork, Wall } from './model';
import type { DoorOpening } from './layout';
import { freeSegments } from './layout';
import { FRAMES, type FrameDef } from './presets';

export const EYE_LINE = 1.45;
/** wall label size at labelScale 1 (the card carries a short provenance line too) */
export const LABEL_W = 0.26;
export const LABEL_H = 0.2;
const LABEL_GAP = 0.12;
const MIN_GAP = 0.5;
const FLOOR_CLEAR = 0.5;
const CEIL_CLEAR = 0.35;

export interface HungWork {
  artworkId: string;
  /** centre of the picture along the wall (m from wall start) */
  offset: number;
  /** centre height of the picture */
  y: number;
  /** picture (image) size in metres */
  width: number;
  height: number;
  /** including mat and frame */
  outerW: number;
  outerH: number;
  frame: FrameDef;
  mat: number;
  label: { offset: number; y: number; w: number; h: number; position: 'right' | 'below' };
  /** < 1 when the work was shrunk to fit the room */
  fitScale: number;
}

export interface HangInput {
  wall: Wall;
  length: number;
  roomHeight: number;
  doors: DoorOpening[];
  artworks: Map<string, Artwork>;
  /** width / height of the image for works without dimensions */
  aspect: (id: string) => number | undefined;
  styleFrame: Exclude<Artwork['frame'], 'style'>;
  /** auto: size the works to suit the wall and how many hang on it; true (default here): real dimensions */
  sizing?: 'auto' | 'true';
  /** gallery-wide display scales (see gallery.display); all default to 1 */
  artScale?: number;
  frameScale?: number;
  labelScale?: number;
}

export interface HangResult {
  works: HungWork[];
  warnings: string[];
}

interface Item {
  art: Artwork;
  w: number; h: number;
  frame: FrameDef; mat: number;
  labelPos: 'right' | 'below';
  lw: number; lh: number;
  /** this work's own size factor (Placement.scale), already included in w and h */
  own: number;
  manualOffset?: number; manualY?: number;
}

function outer(it: Item, s: number) {
  const border = 2 * (it.frame.width + it.mat);
  return { ow: it.w * s + border, oh: it.h * s + border };
}

function footprint(it: Item, s: number) {
  return outer(it, s).ow + (it.labelPos === 'right' ? LABEL_GAP + it.lw : 0);
}

export function hangWall(inp: HangInput): HangResult {
  const warnings: string[] = [];
  const items: Item[] = [];
  for (const p of inp.wall.artworks) {
    const art = inp.artworks.get(p.artwork);
    if (!art) continue;
    let w: number, h: number;
    const auto = inp.sizing === 'auto';
    if (auto) {
      // every work starts with the same area (one square metre), whatever its shape: a panorama is wide and low,
      // a portrait narrow and tall, and neither dwarfs the other. The wall then scales them all together.
      const a = inp.aspect(art.id) ?? (art.dimensions ? art.dimensions.width / art.dimensions.height : 0.75);
      w = Math.sqrt(a); h = 1 / Math.sqrt(a);
    } else if (art.dimensions) { w = art.dimensions.width / 100; h = art.dimensions.height / 100; }
    else { const a = inp.aspect(art.id) ?? 0.75; h = a >= 1 ? 0.7 / a : 0.8; w = h * a; }
    const sc = (p.scale ?? 1) * (auto ? 1 : inp.artScale ?? 1);
    const fs = inp.frameScale ?? 1;
    const base = FRAMES[art.frame === 'style' ? inp.styleFrame : art.frame];
    const frame: FrameDef = { ...base, width: base.width * fs, depth: base.depth * Math.sqrt(fs) };
    // mats grow half as fast as mouldings so they don't swamp small works
    const baseMat = art.mat === false ? 0 : art.mat === true ? Math.max(base.mat, 0.05) : base.mat;
    const mat = baseMat * (1 + (fs - 1) / 2);
    const ls = inp.labelScale ?? 1;
    items.push({ art, w: w * sc, h: h * sc, frame, mat, labelPos: art.label, lw: LABEL_W * ls, lh: LABEL_H * ls, own: p.scale ?? 1, manualOffset: p.offset, manualY: p.height });
  }
  if (!items.length) return { works: [], warnings };

  const segs = freeSegments(inp.length, inp.doors);
  if (!segs.length) return { works: [], warnings: ['wall has no free space'] };
  const maxH = inp.roomHeight - FLOOR_CLEAR - CEIL_CLEAR;
  const longest = Math.max(...segs.map(([a, b]) => b - a));

  // per-item fit: no work may be taller than the wall allows or wider than the longest free stretch
  let fit: number[];
  if (inp.sizing === 'auto') {
    const r = autoFit(items, segs, maxH, inp.wall.hang);
    fit = r.k;
    if (r.squeezed) warnings.push(`the wall is full: all works shown at ${Math.round(r.squeezed * 100)}% to fit`);
  } else fit = items.map((it) => {
    const { oh } = outer(it, 1);
    let s = 1;
    if (oh > maxH) s = Math.min(s, (maxH - 2 * (it.frame.width + it.mat)) / it.h);
    const fp = footprint(it, s);
    if (fp > longest - 2 * MIN_GAP) s = Math.min(s, (longest - 2 * MIN_GAP - (fp - it.w * s)) / it.w);
    return Math.max(0.1, s);
  });
  if (inp.sizing !== 'auto') fit.forEach((s, i) => { if (s < 0.999) warnings.push(`"${items[i].art.title}" shown at ${Math.round(s * 100)}% of real size to fit the wall`); });

  let placed: HungWork[];
  if (inp.wall.hang === 'salon') placed = hangSalon(items, fit, segs, inp.roomHeight, warnings);
  else if (inp.wall.hang === 'grid') placed = hangGrid(items, fit, segs, inp.roomHeight, warnings, inp.artScale ?? 1);
  else placed = hangCentred(items, fit, segs, inp.roomHeight, warnings);

  // manual overrides
  placed.forEach((hw, i) => {
    const it = items[i];
    if (it.manualOffset !== undefined) { const d = it.manualOffset - hw.offset; hw.offset += d; hw.label.offset += d; }
    if (it.manualY !== undefined) { const d = it.manualY - hw.y; hw.y += d; hw.label.y += d; }
  });
  return { works: placed, warnings };
}

/** largest picture height and width auto sizing will choose, in metres */
const AUTO_MAX_H = 1.75, AUTO_MAX_W = 3.4;
/** the common scale never goes above this: a lone work on a long wall stays a picture, not a mural */
const AUTO_MAX_K = 1.3;

/** Would these block widths fit the free stretches with a gap between them (the same greedy fill as distribute)? */
function fitsStretches(widths: number[], segs: Array<[number, number]>, gap: number): boolean {
  let si = 0, used = gap;
  for (const w of widths) {
    while (used + w + gap > segs[si][1] - segs[si][0] + 1e-6) {
      if (++si >= segs.length) return false;
      used = gap;
    }
    used += w + gap;
  }
  return true;
}

/**
 * Auto sizing: one common scale for the wall, as large as fits. Few works on a long wall come out large and
 * well apart; many works shrink and close up. Each work's own scale (Placement.scale) is already in its size.
 */
/**
 * Auto sizing: one common scale for the wall. It is chosen as if every work were at its normal size, so making
 * one work larger or smaller leaves the others as they are. Only if the works no longer fit the wall does
 * everything shrink together; `squeezed` then says by how much.
 */
function autoFit(items: Item[], segs: Array<[number, number]>, maxH: number, hang: Wall['hang']): { k: number[]; squeezed?: number } {
  const rows = hang === 'salon' ? Math.min(3, items.length) : hang === 'grid' && items.length > 4 ? 2 : 1;
  const longest = Math.max(...segs.map(([a, b]) => b - a));
  /** do these works fit the wall at scale k? `limits`: also keep each work within the comfortable maximum */
  const ok = (list: Item[], k: number, limits: boolean) => {
    for (const it of list) {
      const { ow, oh } = outer(it, k);
      if (limits && (it.h * k > AUTO_MAX_H || it.w * k > AUTO_MAX_W)) return false;
      if (oh * rows + 0.15 * (rows - 1) > maxH || ow > longest - 2 * MIN_GAP) return false;
    }
    // stacked hangs put several works in one column: count columns, not works
    const widths: number[] = [];
    for (let i = 0; i < list.length; i += rows) widths.push(Math.max(...list.slice(i, i + rows).map((it) => footprint(it, k))));
    return fitsStretches(widths, segs, MIN_GAP + 0.35 * k);
  };
  const largest = (list: Item[], hi: number, limits: boolean) => {
    if (ok(list, hi, limits)) return hi;
    let lo = 0.05;
    for (let i = 0; i < 26; i++) { const mid = (lo + hi) / 2; if (ok(list, mid, limits)) lo = mid; else hi = mid; }
    return lo;
  };
  // the wall's scale with everything at its normal size
  const normal = items.map((it) => ({ ...it, w: it.w / it.own, h: it.h / it.own }));
  const k = largest(normal, AUTO_MAX_K, true);
  if (ok(items, k, false)) return { k: items.map(() => k) };
  // the resized works do not fit: shrink all of them together, just enough
  const fitted = largest(items, k, false);
  return { k: items.map(() => fitted), squeezed: fitted / k };
}

function makeWork(it: Item, s: number, cx: number, cy: number, roomHeight: number): HungWork {
  const { ow, oh } = outer(it, s);
  const bottom = cy - oh / 2;
  let position = it.labelPos;
  const LW = it.lw, LH = it.lh;
  if (position === 'below' && bottom - LABEL_GAP - LH < 0.35) position = 'right';
  const label =
    position === 'right'
      ? { offset: cx + ow / 2 + LABEL_GAP + LW / 2, y: Math.min(Math.max(bottom + LH / 2 + 0.05, 1.05), 1.45, roomHeight - 0.5), w: LW, h: LH, position }
      : { offset: cx, y: bottom - LABEL_GAP - LH / 2, w: LW, h: LH, position };
  return { artworkId: it.art.id, offset: cx, y: cy, width: it.w * s, height: it.h * s, outerW: ow, outerH: oh, frame: it.frame, mat: it.mat, label, fitScale: s };
}

function clampY(y: number, oh: number, roomHeight: number) {
  return Math.min(Math.max(y, FLOOR_CLEAR + oh / 2), roomHeight - CEIL_CLEAR - oh / 2);
}

/** Distribute "blocks" with widths over the free segments, evenly spaced. Returns centre offsets of each block. */
function distribute(widths: number[], segs: Array<[number, number]>, warnings: string[]): { centres: number[]; scale: number } {
  const total = segs.reduce((s, [a, b]) => s + (b - a), 0);
  const need = widths.reduce((a, b) => a + b, 0) + MIN_GAP * (widths.length + segs.length);
  let scale = 1;
  if (need > total) {
    scale = Math.max(0.2, (total - MIN_GAP * (widths.length + segs.length)) / widths.reduce((a, b) => a + b, 0));
    warnings.push(`wall is crowded: works scaled to ${Math.round(scale * 100)}%`);
  }
  const ws = widths.map((w) => w * scale);
  // greedy assignment, proportional to segment length
  const groups: number[][] = segs.map(() => []);
  let si = 0, used = MIN_GAP;
  ws.forEach((w, i) => {
    while (si < segs.length - 1 && used + w + MIN_GAP > segs[si][1] - segs[si][0] + 1e-6) { si++; used = MIN_GAP; }
    groups[si].push(i);
    used += w + MIN_GAP;
  });
  // if everything ended in the first segment and there are two segments (door in middle), balance
  if (segs.length === 2 && groups[1].length === 0 && groups[0].length > 1) {
    const half = Math.ceil(groups[0].length / 2);
    const len1 = segs[1][1] - segs[1][0];
    const moved = groups[0].slice(half);
    if (moved.reduce((s, i) => s + ws[i] + MIN_GAP, MIN_GAP) <= len1) { groups[1] = moved; groups[0] = groups[0].slice(0, half); }
  }
  const centres: number[] = Array(ws.length).fill(0);
  groups.forEach((g, k) => {
    if (!g.length) return;
    const [a, b] = segs[k];
    const sum = g.reduce((s, i) => s + ws[i], 0);
    const gap = Math.max(0, (b - a - sum) / (g.length + 1));
    let x = a + gap;
    for (const i of g) { centres[i] = x + ws[i] / 2; x += ws[i] + gap; }
  });
  return { centres, scale };
}

function hangCentred(items: Item[], fit: number[], segs: Array<[number, number]>, H: number, warnings: string[]): HungWork[] {
  const widths = items.map((it, i) => footprint(it, fit[i]));
  const { centres, scale } = distribute(widths, segs, warnings);
  return items.map((it, i) => {
    const s = fit[i] * scale;
    const { ow, oh } = outer(it, s);
    const fp = footprint(it, s);
    const cx = centres[i] - fp / 2 + ow / 2;
    return makeWork(it, s, cx, clampY(EYE_LINE, oh, H), H);
  });
}

function hangSalon(items: Item[], fit: number[], segs: Array<[number, number]>, H: number, warnings: string[]): HungWork[] {
  // pair works into columns of up to 3 when they fit vertically
  const avail = H - FLOOR_CLEAR - CEIL_CLEAR;
  const cols: number[][] = [];
  let cur: number[] = [], curH = 0;
  items.forEach((it, i) => {
    const { oh } = outer(it, fit[i]);
    if (cur.length && (cur.length >= 3 || curH + 0.15 + oh > avail)) { cols.push(cur); cur = []; curH = 0; }
    cur.push(i); curH += (cur.length > 1 ? 0.15 : 0) + oh;
  });
  if (cur.length) cols.push(cur);
  const colW = cols.map((c) => Math.max(...c.map((i) => footprint(items[i], fit[i]))));
  const { centres, scale } = distribute(colW, segs, warnings);
  const out: HungWork[] = [];
  cols.forEach((c, ci) => {
    const hs = c.map((i) => outer(items[i], fit[i] * scale).oh);
    const total = hs.reduce((a, b) => a + b, 0) + 0.15 * (c.length - 1);
    let top = Math.min(H - CEIL_CLEAR, Math.max(1.6 + total / 2, FLOOR_CLEAR + total));
    c.forEach((i, k) => {
      const s = fit[i] * scale;
      const { ow } = outer(items[i], s);
      const fp = footprint(items[i], s);
      const cx = centres[ci] - colW[ci] * scale / 2 + (colW[ci] * scale - fp) / 2 + ow / 2;
      const cy = top - hs[k] / 2;
      top -= hs[k] + 0.15;
      const hw = makeWork({ ...items[i], labelPos: 'right' }, s, cx, cy, H);
      hw.label.y = cy - hs[k] / 2 + hw.label.h / 2;
      out[i] = hw;
    });
  });
  return out;
}

function hangGrid(items: Item[], fit: number[], segs: Array<[number, number]>, H: number, warnings: string[], artScale = 1): HungWork[] {
  const avail = H - FLOOR_CLEAR - CEIL_CLEAR;
  const rows = items.length > 4 && avail > 2.2 ? 2 : 1;
  const cellH = Math.min(rows === 2 ? (avail - 0.3) / 2 : 0.9 * artScale, 0.9 * artScale);
  // normalise all works to the same picture height (classic portfolio grid)
  const norm = items.map((it, i) => Math.min(fit[i], (cellH - 2 * (it.frame.width + it.mat)) / it.h));
  const perRow = Math.ceil(items.length / rows);
  const out: HungWork[] = [];
  for (let r = 0; r < rows; r++) {
    const idx = items.map((_, i) => i).slice(r * perRow, (r + 1) * perRow);
    const { centres, scale } = distribute(idx.map((i) => footprint(items[i], norm[i])), segs, warnings);
    const cy = rows === 1 ? EYE_LINE : EYE_LINE + (r === 0 ? 1 : -1) * (cellH / 2 + 0.15);
    idx.forEach((i, k) => {
      const s = norm[i] * scale;
      const { ow, oh } = outer(items[i], s);
      const fp = footprint(items[i], s);
      const hw = makeWork({ ...items[i], labelPos: 'right' }, s, centres[k] - fp / 2 + ow / 2, clampY(cy, oh, H), H);
      hw.label.y = hw.y - oh / 2 + hw.label.h / 2;
      out[i] = hw;
    });
  }
  return out;
}
