import * as THREE from 'three';
import { Water } from 'three/examples/jsm/objects/Water.js';
import type { SkyState } from './sky';

/** A tileable ripple normal map: a sum of sine waves with whole-number frequencies, so the edges meet. */
function rippleNormals(size = 256): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  let seed = 7;
  const r = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const waves = Array.from({ length: 22 }, (_, i) => {
    const k = 1 + Math.floor(r() * (i < 6 ? 3 : 9));
    const a = r() * Math.PI * 2;
    return { kx: Math.round(Math.cos(a) * k), ky: Math.round(Math.sin(a) * k) || 1, ph: r() * Math.PI * 2, amp: (0.5 + r()) / (k * 1.3) };
  });
  const TAU = Math.PI * 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let dx = 0, dy = 0;
    for (const w of waves) {
      const cs = Math.cos(TAU * (w.kx * x + w.ky * y) / size + w.ph) * w.amp;
      dx += cs * w.kx; dy += cs * w.ky;
    }
    const nx = -dx * 0.16, ny = -dy * 0.16, l = Math.hypot(nx, ny, 1);
    const i = (y * size + x) * 4;
    img.data[i] = (nx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export interface Lake {
  mesh: THREE.Mesh;
  update(dt: number, s: SkyState): void;
  dispose(): void;
}

const DAY = new THREE.Color('#1b4a5e'), NIGHT = new THREE.Color('#04080f'), GREY = new THREE.Color('#3c4a52');

/**
 * The lake. With `mirror` it is a real planar reflection (the skyline, the trees and the sky upside down,
 * broken up by ripples); without, a plain glossy surface for slow devices.
 */
export function makeLake(y: number, mirror: false | number): Lake {
  const geo = new THREE.PlaneGeometry(24000, 24000);
  const tint = new THREE.Color();
  const colour = (s: SkyState) => tint.copy(DAY).lerp(GREY, Math.min(1, s.cover * s.cover * 0.8)).lerp(NIGHT, s.night);
  if (!mirror) {
    const mat = new THREE.MeshStandardMaterial({ color: DAY, roughness: 0.12, metalness: 0.5 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = y;
    return { mesh, update: (_dt, s) => { mat.color.copy(colour(s)); }, dispose: () => { geo.dispose(); mat.dispose(); } };
  }
  const normals = rippleNormals();
  const water = new Water(geo, {
    textureWidth: mirror, textureHeight: mirror, waterNormals: normals,
    sunDirection: new THREE.Vector3(0, 1, 0), sunColor: 0xffffff, waterColor: DAY.getHex(), distortionScale: 1.2, fog: true,
  });
  water.rotation.x = -Math.PI / 2; water.position.y = y;
  const u = (water.material as THREE.ShaderMaterial).uniforms;
  u.size.value = 9;
  return {
    mesh: water,
    update(dt, s) {
      u.time.value += dt * (0.25 + s.wind * 0.9);
      u.sunDirection.value.copy(s.sunDir);
      (u.sunColor.value as THREE.Color).copy(s.sunColor).multiplyScalar(Math.min(1, s.sunLight * 0.6));
      (u.waterColor.value as THREE.Color).copy(colour(s));
      u.distortionScale.value = 0.9 + s.wind * 2.2;
    },
    dispose() { geo.dispose(); normals.dispose(); (water.material as THREE.Material).dispose(); },
  };
}
