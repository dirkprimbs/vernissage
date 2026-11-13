import * as THREE from 'three';
import type { Artwork, StyleDef } from '@vernissage/schema';
import { formatDimensions } from '../data';

const W = 832, H = 640; // matches the 0.26 × 0.20 m card (LABEL_W × LABEL_H)

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    let last = cut[maxLines - 1];
    while (ctx.measureText(last + '…').width > maxW && last.length) last = last.slice(0, -1);
    cut[maxLines - 1] = last + '…';
    return cut;
  }
  return lines;
}

/** Museum wall label ("tombstone") rendered to a texture. */
export function labelTexture(art: Artwork, style: StyleDef, index: number, renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = style.labelBackground;
  ctx.fillRect(0, 0, W, H);
  const serif = style.labelFont === 'serif';
  const family = serif ? '"Iowan Old Style", "Palatino Linotype", Georgia, serif' : '"Helvetica Neue", Helvetica, Arial, sans-serif';
  ctx.fillStyle = style.labelText;
  ctx.textBaseline = 'top';
  const pad = 56;
  const maxW = W - pad * 2;
  let y = pad - 4;

  ctx.font = `600 44px ${family}`;
  for (const l of wrap(ctx, art.artist.name, maxW, 1)) { ctx.fillText(l, pad, y); y += 52; }
  const life = [art.artist.nationality, art.artist.life].filter(Boolean).join(', ');
  if (life) { ctx.font = `400 30px ${family}`; ctx.globalAlpha = 0.75; ctx.fillText(life, pad, y); ctx.globalAlpha = 1; y += 44; }
  y += 14;
  ctx.font = `italic 500 40px ${family}`;
  const titleLines = wrap(ctx, art.title + (art.date ? ',' : ''), maxW, 2);
  titleLines.forEach((l) => { ctx.fillText(l, pad, y); y += 48; });
  if (art.date) { ctx.font = `400 34px ${family}`; ctx.fillText(art.date, pad, y); y += 46; }
  y += 8;
  ctx.font = `400 28px ${family}`;
  ctx.globalAlpha = 0.85;
  const rest = [art.medium, formatDimensions(art.dimensions)].filter(Boolean) as string[];
  for (const t of rest) for (const l of wrap(ctx, t, maxW, 2)) { if (y > H - 90) break; ctx.fillText(l, pad, y); y += 36; }
  const credit = art.credit ?? art.collection;
  if (credit && y < H - 170) {
    ctx.font = `400 24px ${family}`;
    ctx.globalAlpha = 0.6;
    for (const l of wrap(ctx, credit, maxW, 2)) { if (y > H - 150) break; ctx.fillText(l, pad, y + 8); y += 30; }
  }
  // provenance in one breath: first and latest owners; the full history is one click away
  const prov = art.provenance;
  if (prov.length && y < H - 110) {
    y += 22;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(pad, y, 60, 3);
    y += 16;
    ctx.globalAlpha = 0.6;
    ctx.font = `700 20px ${family}`;
    ctx.fillText('PROVENANCE', pad, y);
    y += 30;
    ctx.globalAlpha = 0.8;
    ctx.font = `400 24px ${family}`;
    const step = (e: (typeof prov)[number]) => (e.date ? `${e.date}: ` : '') + e.event;
    const text = prov.length === 1 ? step(prov[0]) : `${step(prov[0])} … ${step(prov[prov.length - 1])}`;
    for (const l of wrap(ctx, text, maxW - 40, 2)) { if (y > H - 52) break; ctx.fillText(l, pad, y); y += 30; }
  }
  ctx.globalAlpha = 0.5;
  ctx.font = `600 22px ${family}`;
  ctx.textAlign = 'right';
  ctx.fillText(String(index).padStart(2, '0'), W - pad + 20, H - 44);
  ctx.globalAlpha = 1;

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
