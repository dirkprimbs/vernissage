import * as THREE from 'three';
import { clampPin, layoutPins, noteLines, pinAssetKey, pinShape, pointOnWall, turnedShape, wrapTilt, type NoteColor, type PinItem, type PinShape, type PlacedPinboard, type PlacedRoom, type SiteData } from '@vernissage/schema';
import { rng } from './textures';

/** handwriting for captions and notes; the first face that the visitor's system has is used */
export const HAND = `'Caveat', 'Segoe Print', 'Bradley Hand', 'Chalkboard SE', 'Comic Sans MS', cursive`;
export const NOTE_PAPER: Record<NoteColor, string> = { yellow: '#fbe98a', pink: '#f9c0d3', blue: '#bfe0f6', green: '#cdeab4', white: '#fbfaf5' };
const PX = 1500; // canvas pixels per metre of card

export interface PinInstance {
  id: string;
  item: PinItem;
  shape: PinShape;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  /** centre on the board as fractions (0 0 = top left) */
  x: number; y: number;
  /** how far the card is turned, in degrees clockwise */
  tilt: number;
}
export interface BuiltPinboard {
  roomId: string;
  width: number; height: number;
  group: THREE.Group;
  /** the cork: what a dragged card slides over */
  cork: THREE.Mesh;
  pins: PinInstance[];
  /** put a card somewhere on the board (kept inside it) and bring it to the front */
  place(pin: PinInstance, x: number, y: number): void;
  /** turn a card by so many degrees (clockwise); it stays on the board */
  turn(pin: PinInstance, by: number): void;
  /** the topmost of the other cards that this card lies over, if any */
  under(pin: PinInstance): PinInstance | undefined;
}

function corkTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d')!, r = rng(31);
  ctx.fillStyle = '#b98a57';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = ['#a67744', '#c79a66', '#8f6538', '#d3ab7a'][Math.floor(r() * 4)];
    ctx.globalAlpha = 0.25 + r() * 0.4;
    const s = 1 + r() * 4;
    ctx.beginPath(); ctx.ellipse(r() * 512, r() * 512, s, s * (0.5 + r() * 0.6), r() * Math.PI, 0, Math.PI * 2); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** break text into lines no wider than `max` */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > max) { out.push(line); line = word; } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/** An instant photo: white card, the picture cropped to its window, a line of handwriting on the wide border. */
function photoTexture(item: Extract<PinItem, { kind: 'photo' }>, shape: PinShape, url: string | undefined, placeholder: string, onChange: () => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = Math.round(shape.w * PX); c.height = Math.round(shape.h * PX);
  const ctx = c.getContext('2d')!, tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const im = shape.image!, box = { x: im.x * PX, y: im.y * PX, w: im.w * PX, h: im.h * PX };
  const draw = (img?: HTMLImageElement) => {
    ctx.fillStyle = '#f7f5ef';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = placeholder;
    ctx.fillRect(box.x, box.y, box.w, box.h);
    if (img) {
      // fill the window, cropping the picture's longer side evenly
      const k = Math.max(box.w / img.naturalWidth, box.h / img.naturalHeight);
      const sw = box.w / k, sh = box.h / k;
      ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, box.x, box.y, box.w, box.h);
    }
    ctx.strokeStyle = 'rgba(0,0,0,.12)';
    ctx.lineWidth = 2;
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.strokeRect(1, 1, c.width - 2, c.height - 2);
    if (item.caption) {
      const top = box.y + box.h, room = c.height - top;
      let size = Math.round(room * 0.46);
      ctx.fillStyle = '#26303f';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // one line if it fits at a readable size, otherwise two smaller ones
      ctx.font = `600 ${size}px ${HAND}`;
      let lines = [item.caption];
      if (ctx.measureText(item.caption).width > box.w) { size = Math.round(room * 0.34); ctx.font = `600 ${size}px ${HAND}`; lines = wrap(ctx, item.caption, box.w).slice(0, 2); }
      lines.forEach((l, i) => ctx.fillText(l, c.width / 2, top + room / 2 + (i - (lines.length - 1) / 2) * size * 1.02, box.w + 10));
    }
    tex.needsUpdate = true;
    onChange();
  };
  draw();
  if (url) { const img = new Image(); img.onload = () => draw(img); img.src = url; }
  // the handwriting face may arrive after the first drawing
  void document.fonts?.load(`600 40px ${HAND}`).then(() => draw(undefined)).catch(() => {});
  return tex;
}

/** A paper note with its text in handwriting; long notes end in an ellipsis (the close-up shows everything). */
function noteTexture(item: Extract<PinItem, { kind: 'note' }>, shape: PinShape, onChange: () => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = Math.round(shape.w * PX); c.height = Math.round(shape.h * PX);
  const ctx = c.getContext('2d')!, tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const draw = () => {
    ctx.fillStyle = NOTE_PAPER[item.color];
    ctx.fillRect(0, 0, c.width, c.height);
    const g = ctx.createLinearGradient(0, c.height * 0.8, 0, c.height);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.07)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
    const pad = c.width * 0.09, max = c.width - 2 * pad;
    ctx.fillStyle = '#26303f';
    ctx.textBaseline = 'top';
    let y = pad * 1.5;
    const size = Math.round(c.width * 0.105);
    outer: for (const l of noteLines(item.text)) {
      const fs = l.heading ? Math.round(size * 1.25) : size;
      ctx.font = `${l.heading ? 700 : 500} ${fs}px ${HAND}`;
      const rows = l.text ? wrap(ctx, l.text, max) : [''];
      for (const row of rows) {
        if (y + fs * 2 > c.height - pad) { ctx.fillText('…', pad, y); break outer; }
        ctx.fillText(row, pad, y, max);
        y += fs * 1.08;
      }
    }
    tex.needsUpdate = true;
    onChange();
  };
  draw();
  void document.fonts?.load(`500 40px ${HAND}`).then(draw).catch(() => {});
  return tex;
}

const PIN_COLORS = ['#d8473d', '#2f80ed', '#e6b450', '#3fa86b', '#8e5bd0'];

/**
 * A cork board on the wall with instant photos and notes pinned to it. `saved` gives a visitor's own places for
 * the cards (by id), which win over the gallery's.
 */
export function buildPinboard(root: THREE.Group, pr: PlacedRoom, at: PlacedPinboard, data: SiteData, saved: Record<string, [number, number, number?, number?]> = {}, onChange: () => void = () => {}): BuiltPinboard {
  const board = pr.room.pinboard!;
  const w = pr.walls[at.wall];
  const group = new THREE.Group();
  group.name = `pinboard:${pr.room.id}`;
  const base = pointOnWall(w, at.offset, 0);
  group.position.set(base.x, at.y, base.z);
  group.rotation.y = Math.atan2(w.normal.x, w.normal.z);
  root.add(group);

  const W = at.width, H = at.height, D = 0.028, F = 0.045;
  const tex = corkTexture();
  tex.repeat.set(W / 0.9, H / 0.9);
  const cork = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  cork.position.z = D / 2;
  cork.userData.pinboard = pr.room.id;
  group.add(cork);
  const wood = new THREE.MeshStandardMaterial({ color: '#7a5a3a', roughness: 0.7 });
  for (const [bw, bh, x, y] of [[W + 2 * F, F, 0, H / 2 + F / 2], [W + 2 * F, F, 0, -H / 2 - F / 2], [F, H, -W / 2 - F / 2, 0], [F, H, W / 2 + F / 2, 0]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, D + 0.012), wood);
    bar.position.set(x, y, (D + 0.012) / 2);
    bar.userData.pinboard = pr.room.id;
    group.add(bar);
  }

  const pins: PinInstance[] = [];
  // each card lies a hair above the one under it; `stack` lists them from the bottom up
  const lift = (i: number) => D + 0.004 + (i + 1) * 0.0012;
  let stack: PinInstance[] = [];
  // seen from the room, turning clockwise is a negative turn about the axis that points out of the board
  const local = (p: PinInstance) => { p.mesh.position.x = (p.x - 0.5) * W; p.mesh.position.y = (0.5 - p.y) * H; p.mesh.rotation.z = -THREE.MathUtils.degToRad(p.tilt); };
  const placed = layoutPins(board, W, H);
  board.items.forEach((item, i) => {
    const shape = pinShape(item);
    const asset = item.kind === 'photo' ? data.assets[pinAssetKey(pr.room.id, item.id)] : undefined;
    const map = item.kind === 'photo' ? photoTexture(item, shape, asset?.texture, asset?.color ?? '#9a9a9a', onChange) : noteTexture(item, shape, onChange);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(shape.w, shape.h), new THREE.MeshStandardMaterial({ map, roughness: 0.75, emissive: '#ffffff', emissiveMap: map, emissiveIntensity: 0.12 }));
    mesh.userData.pin = { roomId: pr.room.id, id: item.id };
    // a round-headed pin near the top edge
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.011, 12, 8), new THREE.MeshStandardMaterial({ color: PIN_COLORS[i % PIN_COLORS.length], roughness: 0.35 }));
    // nearly flat, so that it never pokes through a card lying on top of this one
    head.scale.z = 0.04;
    head.position.set(0, shape.h / 2 - 0.022, 0.0005);
    mesh.add(head);
    const s = saved[item.id];
    const tilt = s?.[2] ?? placed[i].tilt;
    const xy = s ? clampPin(s[0], s[1], turnedShape(shape, tilt), W, H) : placed[i];
    const pin: PinInstance = { id: item.id, item, shape, mesh, x: xy.x, y: xy.y, tilt };
    local(pin);
    group.add(mesh);
    pins.push(pin);
  });
  // what lies on top: the cards in their order on the board (later ones over earlier ones), and above those the
  // cards this visitor has handled, the last one handled on top
  const touched = (p: PinInstance) => saved[p.id]?.[3] ?? -1;
  stack = [...pins].sort((a, b) => touched(a) - touched(b));
  stack.forEach((p, i) => { p.mesh.position.z = lift(i); });

  return {
    roomId: pr.room.id, width: W, height: H, group, cork, pins,
    place(pin, x, y) {
      const c = clampPin(x, y, turnedShape(pin.shape, pin.tilt), W, H);
      pin.x = c.x; pin.y = c.y;
      local(pin);
      // to the top of the pile, and no higher: the others close the gap it leaves, so a card that is dragged
      // (placed again at every step) does not rise off the board
      stack = [...stack.filter((p) => p !== pin), pin];
      stack.forEach((p, i) => { p.mesh.position.z = lift(i); });
    },
    under(pin) {
      // by the cards' outlines (the box around a turned card), in metres on the board
      const box = (p: PinInstance) => { const s = turnedShape(p.shape, p.tilt); return { x0: p.x * W - s.w / 2, x1: p.x * W + s.w / 2, y0: p.y * H - s.h / 2, y1: p.y * H + s.h / 2 }; };
      const a = box(pin);
      return pins
        .filter((p) => { if (p === pin) return false; const b = box(p); return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0; })
        .sort((p, q) => q.mesh.position.z - p.mesh.position.z)[0];
    },
    turn(pin, by) {
      pin.tilt = wrapTilt(pin.tilt + by);
      // a turned card reaches further: keep its corners on the board
      this.place(pin, pin.x, pin.y);
    },
  };
}
