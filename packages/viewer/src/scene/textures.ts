import * as THREE from 'three';
import type { StyleDef } from '@vernissage/schema';

/** Deterministic PRNG so procedural textures look the same on every visit. */
export function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}

/** Lighten/darken in sRGB (perceptual) space; linear-space offsets clip dark colours to black. */
export function shade(hex: string, f: number): string {
  const c = new THREE.Color(hex);
  const hsl = c.getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + f)), THREE.SRGBColorSpace);
  return '#' + c.getHexString();
}

export function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

export function speckle(ctx: CanvasRenderingContext2D, size: number, base: string, amount: number, n: number, r: () => number) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = shade(base, (r() - 0.5) * amount);
    ctx.globalAlpha = 0.08 + r() * 0.12;
    const s = 1 + r() * 3;
    ctx.fillRect(r() * size, r() * size, s, s);
  }
  ctx.globalAlpha = 1;
}

export function toTexture(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Floor texture covering `tile` metres per repeat. */
export function floorTexture(style: StyleDef): { map: THREE.Texture; tile: number } {
  const size = 1024;
  const [c, ctx] = canvas(size);
  const r = rng(7);
  const base = style.floor;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  switch (style.floorPattern) {
    case 'parquet': {
      // herringbone-like alternating blocks, 4m tile
      const n = 12, bw = size / n;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        ctx.fillStyle = shade(base, (r() - 0.5) * 0.06);
        const horiz = (x + y) % 2 === 0;
        ctx.fillRect(x * bw + 1, y * bw + 1, bw - 2, bw - 2);
        ctx.strokeStyle = shade(base, -0.05);
        ctx.lineWidth = 1;
        for (let k = 1; k < 4; k++) {
          ctx.beginPath();
          if (horiz) { ctx.moveTo(x * bw, y * bw + (k * bw) / 4); ctx.lineTo(x * bw + bw, y * bw + (k * bw) / 4); }
          else { ctx.moveTo(x * bw + (k * bw) / 4, y * bw); ctx.lineTo(x * bw + (k * bw) / 4, y * bw + bw); }
          ctx.stroke();
        }
      }
      speckle(ctx, size, base, 0.1, 9000, r);
      return { map: toTexture(c), tile: 6 };
    }
    case 'planks': {
      const rows = 12, ph = size / rows;
      for (let y = 0; y < rows; y++) {
        let x = -r() * size * 0.5;
        while (x < size) {
          const len = size * (0.35 + r() * 0.4);
          ctx.fillStyle = shade(base, (r() - 0.5) * 0.06);
          ctx.fillRect(x, y * ph, len - 2, ph - 2);
          // grain
          ctx.strokeStyle = shade(base, -0.06);
          ctx.globalAlpha = 0.35;
          for (let g = 0; g < 5; g++) {
            ctx.beginPath();
            const gy = y * ph + r() * ph;
            ctx.moveTo(x, gy);
            ctx.bezierCurveTo(x + len * 0.3, gy + (r() - 0.5) * 6, x + len * 0.6, gy + (r() - 0.5) * 6, x + len, gy);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
          x += len;
        }
      }
      return { map: toTexture(c), tile: 4 };
    }
    case 'stone': {
      const n = 4, s = size / n;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        ctx.fillStyle = shade(base, (r() - 0.5) * 0.06);
        ctx.fillRect(x * s + 2, y * s + 2, s - 4, s - 4);
      }
      speckle(ctx, size, base, 0.3, 20000, r);
      return { map: toTexture(c), tile: 4 };
    }
    case 'concrete': {
      for (let i = 0; i < 60; i++) {
        const cx = r() * size, cy = r() * size;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 80 + r() * 200);
        const hex = shade(base, (r() - 0.5) * 0.08);
        const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',');
        g.addColorStop(0, `rgba(${rgb},0.8)`);
        g.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
      }
      speckle(ctx, size, base, 0.12, 20000, r);
      // expansion joints
      ctx.strokeStyle = shade(base, -0.08);
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, size - 2, size - 2);
      return { map: toTexture(c), tile: 6 };
    }
    default:
      speckle(ctx, size, base, 0.1, 4000, r);
      return { map: toTexture(c), tile: 4 };
  }
}

/** Subtle wall surface; damask for the salon, board-formed concrete for the loft. */
export function wallTexture(style: StyleDef, color: string): { map: THREE.Texture; tile: number } {
  const size = 512;
  const [c, ctx] = canvas(size);
  const r = rng(11);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
  if (style.id === 'classical-salon') {
    ctx.fillStyle = shade(color, 0.035);
    const motif = (cx: number, cy: number, s: number) => {
      ctx.beginPath();
      ctx.moveTo(cx, cy - s);
      ctx.bezierCurveTo(cx + s * 0.8, cy - s * 0.4, cx + s * 0.6, cy + s * 0.5, cx, cy + s);
      ctx.bezierCurveTo(cx - s * 0.6, cy + s * 0.5, cx - s * 0.8, cy - s * 0.4, cx, cy - s);
      ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy, s * 0.18, 0, Math.PI * 2); ctx.fillStyle = shade(color, -0.03); ctx.fill(); ctx.fillStyle = shade(color, 0.035);
    };
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) motif(x * 128 + (y % 2) * 64 + 32, y * 128 + 64, 40);
    speckle(ctx, size, color, 0.1, 3000, r);
    return { map: toTexture(c), tile: 1.2 };
  }
  if (style.id === 'industrial-loft') {
    for (let y = 0; y < 4; y++) {
      ctx.fillStyle = shade(color, (r() - 0.5) * 0.05);
      ctx.fillRect(0, y * 128, size, 126);
      ctx.fillStyle = shade(color, -0.1);
      for (const hx of [64, 448]) { ctx.beginPath(); ctx.arc(hx, y * 128 + 64, 5, 0, Math.PI * 2); ctx.fill(); }
    }
    speckle(ctx, size, color, 0.3, 14000, r);
    return { map: toTexture(c), tile: 2.4 };
  }
  speckle(ctx, size, color, 0.05, 2500, r);
  return { map: toTexture(c), tile: 2 };
}

/** Soft elliptical pool of light, used as an additive wall decal around artworks. */
let poolTex: THREE.Texture | undefined;
export function lightPoolTexture(): THREE.Texture {
  if (poolTex) return poolTex;
  const [c, ctx] = canvas(256);
  const g = ctx.createRadialGradient(128, 110, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  poolTex = new THREE.CanvasTexture(c);
  return poolTex;
}

export function worldUV(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, tile: number) {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  const nm = new THREE.Matrix3().getNormalMatrix(matrix);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    n.fromBufferAttribute(nor, i).applyMatrix3(nm);
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    if (ay >= ax && ay >= az) uv.setXY(i, v.x / tile, v.z / tile);
    else if (ax >= az) uv.setXY(i, v.z / tile, v.y / tile);
    else uv.setXY(i, v.x / tile, v.y / tile);
  }
  uv.needsUpdate = true;
}
