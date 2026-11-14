import type { PinItem, Pinboard } from './model';

/** An instant photo on the board, in metres: three times the size of the real thing, so it reads from across a room. */
export interface PinShape {
  /** the whole card */
  w: number; h: number;
  /** the picture inside a photo card: its box, measured from the card's top left */
  image?: { x: number; y: number; w: number; h: number };
}
const S = 3 / 1000; // real millimetres to board metres
/** Instax mini, square and wide: card and picture sizes in millimetres */
const INSTAX = {
  mini: { w: 54, h: 86, iw: 46, ih: 62 },
  square: { w: 72, h: 86, iw: 62, ih: 62 },
  wide: { w: 108, h: 86, iw: 99, ih: 62 },
} as const;
/** a paper note is a square of this size */
export const NOTE_SIZE = 0.26;

export function pinShape(item: PinItem): PinShape {
  if (item.kind === 'note') return { w: NOTE_SIZE, h: NOTE_SIZE };
  const f = INSTAX[item.format];
  // the picture sits in the middle of the width and close to the top; the wide border is at the bottom
  return { w: f.w * S, h: f.h * S, image: { x: ((f.w - f.iw) / 2) * S, y: 6 * S, w: f.iw * S, h: f.ih * S } };
}

/** The room a card takes up when it is turned by `tilt` degrees: the box around the turned card. */
export function turnedShape(shape: PinShape, tilt: number): PinShape {
  const a = (tilt * Math.PI) / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  return { w: shape.w * c + shape.h * s, h: shape.w * s + shape.h * c };
}
/** an angle brought into -180…180 degrees */
export const wrapTilt = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

/** Keep a card of this shape on a board of this size: its centre as fractions of the board. */
export function clampPin(x: number, y: number, shape: PinShape, boardW: number, boardH: number): { x: number; y: number } {
  const mx = Math.min(0.5, (shape.w / 2 + 0.02) / boardW), my = Math.min(0.5, (shape.h / 2 + 0.02) / boardH);
  return { x: Math.min(1 - mx, Math.max(mx, x)), y: Math.min(1 - my, Math.max(my, y)) };
}

export interface PlacedPin { id: string; x: number; y: number; tilt: number }

/**
 * Where everything on a board sits: the places given by hand, and for the rest rows from the top left, each
 * card a little off its spot and a little askew (the same way every time), as if pinned up by hand.
 */
export function layoutPins(board: Pinboard, boardW: number, boardH: number): PlacedPin[] {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const gap = 0.05, margin = 0.07;
  let cx = margin, cy = margin, rowH = 0;
  return board.items.map((item) => {
    const s = pinShape(item);
    const jx = (rnd() - 0.5) * 0.03, jy = (rnd() - 0.5) * 0.03, tilt = Math.round((rnd() - 0.5) * 9 * 10) / 10;
    if (cx + s.w > boardW - margin && cx > margin) { cx = margin; cy += rowH + gap; rowH = 0; }
    // a full board starts over from the top, overlapping what is there
    if (cy + s.h > boardH - margin && cy > margin) { cy = margin + 0.04; cx = margin + 0.05; rowH = 0; }
    const auto = clampPin((cx + s.w / 2 + jx) / boardW, (cy + s.h / 2 + jy) / boardH, s, boardW, boardH);
    cx += s.w + gap; rowH = Math.max(rowH, s.h);
    const turn = item.tilt ?? tilt;
    // a card turned by hand needs the room of its turned outline
    const at = item.x !== undefined && item.y !== undefined ? clampPin(item.x, item.y, turnedShape(s, turn), boardW, boardH) : item.tilt !== undefined ? clampPin(auto.x, auto.y, turnedShape(s, turn), boardW, boardH) : auto;
    return { id: item.id, x: at.x, y: at.y, tilt: turn };
  });
}

/** the key of a pinboard photo's files in the site's assets */
export const pinAssetKey = (roomId: string, itemId: string) => `pin:${roomId}:${itemId}`;

/** A note's Markdown as plain lines for the small card on the board: headings and list items marked, links reduced to their text. */
export function noteLines(text: string): Array<{ text: string; heading: boolean }> {
  return text.split(/\r?\n/).map((raw) => {
    const heading = /^\s*#{1,6}\s+/.test(raw);
    const line = raw
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/^\s*[-*+]\s+/, '• ')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<(https?:[^>]+)>/g, '$1')
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(\*|_)(.+?)\1/g, '$2')
      .replace(/`([^`]+)`/g, '$1')
      .trimEnd();
    return { text: line, heading };
  }).filter((l, i, all) => l.text || (i > 0 && all[i - 1].text));
}
