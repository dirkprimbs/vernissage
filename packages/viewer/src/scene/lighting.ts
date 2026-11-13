import * as THREE from 'three';
import { LIGHTING, roomAt, type LightingDef } from '@vernissage/schema';
import type { BuiltGallery, ArtworkInstance } from './build';
import type { SkyState } from './sky';
import { lightPoolTexture } from './textures';

export type Quality = 'low' | 'medium' | 'high';
const POOL_SIZE: Record<Quality, number> = { low: 0, medium: 8, high: 14 };
/** scale from preset "spot" units to candela */
const SPOT_CD = 14;

const WHITE = new THREE.Color('#ffffff'), TMP = new THREE.Color(), TMPV = new THREE.Vector3();

interface PooledSpot { light: THREE.SpotLight; target?: ArtworkInstance; level: number }

/**
 * Owns all lights and ceiling fixtures. Real spot lights are a small pool re-assigned to the works nearest the visitor;
 * every work also has a cheap additive "light pool" decal and a little emissive lift so distant art still reads.
 */
export class LightingRig {
  readonly group = new THREE.Group();
  private fixtures = new THREE.Group();
  private hemi = new THREE.HemisphereLight();
  private ambient = new THREE.AmbientLight();
  private sun = new THREE.DirectionalLight();
  private torch = new THREE.SpotLight('#fff1d6', 0, 12, 0.5, 0.85, 1.6);
  private spots: PooledSpot[] = [];
  def!: LightingDef;
  /** tone-mapping exposure for the rooms (the outdoors is drawn at 1) */
  exposure = 1;
  /** the scenario as it is right now: the daylight scenario slides towards the evening one as it gets dark outside */
  private eff = { ambient: 0.5, spot: 1, spotColor: new THREE.Color('#ffffff'), angle: 0.5 };
  private patches: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  private lenses: THREE.MeshStandardMaterial[] = [];

  constructor(private gallery: BuiltGallery, private scene: THREE.Scene, quality: Quality) {
    this.group.add(this.hemi, this.ambient, this.sun, this.sun.target, this.fixtures);
    this.group.name = 'lighting';
    this.setQuality(quality);
  }

  setQuality(q: Quality) {
    for (const s of this.spots) { this.group.remove(s.light, s.light.target); s.light.dispose(); }
    this.spots = [];
    for (let i = 0; i < POOL_SIZE[q]; i++) {
      const light = new THREE.SpotLight('#ffffff', 0, 9, 0.4, 0.6, 1.4);
      this.group.add(light, light.target);
      this.spots.push({ light, level: 0 });
    }
    if (this.def) this.apply(this.def);
  }

  attachTorch(parent: THREE.Object3D) {
    parent.add(this.torch, this.torch.target);
    this.torch.position.set(0.25, 1.45, 0.1);
    this.torch.target.position.set(0, 1.2, 3);
  }

  apply(def: LightingDef) {
    this.def = def;
    this.torch.intensity = def.torch ? 5 : 0;
    for (const a of this.gallery.artworks) {
      if (a.picture.material.map) a.picture.material.emissiveMap = a.picture.material.map;
      a.picture.material.needsUpdate = true;
    }
    this.buildFixtures(def);
    this.spots.forEach((s) => { s.target = undefined; s.level = 0; s.light.intensity = 0; });
  }

  /**
   * Bring the room light in line with the sky. Every scenario gets the sun's direction and a little of its light;
   * the daylight scenario is natural light, so it dims and warms with the sky and hands over to the spotlights at night.
   */
  setOutside(sky: SkyState, flash: number) {
    const def = this.def;
    const natural = def.id === 'daylight';
    const night = LIGHTING['evening-spots'];
    const D = natural ? sky.daylight : 1;
    const mix = (dark: number, bright: number) => dark + (bright - dark) * D;
    const e = this.eff;
    if (natural) {
      const tint = sky.zenith.clone().lerp(sky.horizon, 0.5).lerp(WHITE, 0.55);
      this.hemi.color.set(night.hemi.sky).lerp(tint, Math.min(1, D * 1.5));
      this.hemi.groundColor.set(night.hemi.ground).lerp(TMP.set(def.hemi.ground), D);
      this.hemi.intensity = mix(night.hemi.intensity, def.hemi.intensity) + flash * 0.9;
      e.ambient = mix(night.ambient, def.ambient);
      e.spot = mix(night.spot.intensity, def.spot.intensity);
      e.spotColor.set(night.spot.color).lerp(TMP.set(def.spot.color), D);
      e.angle = mix(night.spot.angle, def.spot.angle);
      this.exposure = mix(night.exposure, def.exposure);
    } else {
      this.hemi.color.set(def.hemi.sky);
      this.hemi.groundColor.set(def.hemi.ground);
      this.hemi.intensity = def.hemi.intensity + flash * 0.25;
      e.ambient = def.ambient; e.spot = def.spot.intensity; e.spotColor.set(def.spot.color); e.angle = def.spot.angle;
      this.exposure = def.exposure;
    }
    this.ambient.intensity = e.ambient;
    // sunlight reaching into the rooms: full in the daylight scenario, a trace in the artificial ones
    const sunI = (sky.sunLight / 2.4) * (natural ? def.sun?.intensity ?? 1.4 : 0.3);
    this.sun.visible = sunI > 0.01;
    this.sun.color.copy(sky.sunColor);
    this.sun.intensity = sunI;
    const b = this.gallery.plan.bounds;
    TMPV.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    this.sun.position.copy(TMPV).addScaledVector(sky.sunDir, 40);
    this.sun.target.position.copy(TMPV);
    // dark rooms must not be lifted by the reflection environment
    this.scene.environmentIntensity = Math.min(0.35, e.ambient * 0.6 + this.hemi.intensity * 0.12);

    for (const s of this.spots) { s.light.color.copy(e.spotColor); s.light.penumbra = def.spot.penumbra; }
    const lift = Math.max(0, 0.22 - e.ambient * 0.25) * e.spot;
    for (const a of this.gallery.artworks) {
      const tweak = a.art.spotlight?.intensity ?? 1;
      if (a.art.spotlight?.color) { a.pool.material.color.set(a.art.spotlight.color); a.picture.material.emissive.set(a.art.spotlight.color); }
      else { a.pool.material.color.copy(e.spotColor); a.picture.material.emissive.copy(e.spotColor); }
      // pools read strongly in dark rooms and are barely there in daylight
      a.pool.userData.base = Math.min(0.55, 0.06 + e.spot * 0.12 * (1 - Math.min(1, e.ambient * 1.4))) * tweak;
      a.picture.material.emissiveIntensity = lift * tweak;
    }
    // daylight falling through the roof lanterns onto the floor
    const patch = (0.08 + 0.26 * sky.sunDisc) * sky.daylight * (natural ? 1 : 0.5) + flash * 0.2;
    for (const p of this.patches) { p.material.opacity = patch; p.material.color.copy(sky.sunColor).lerp(WHITE, 0.4); p.visible = patch > 0.004; }
    // the spotlights' lenses glow once they are doing the work
    for (const l of this.lenses) { l.emissive.copy(e.spotColor); l.emissiveIntensity = natural ? 2 * (1 - D * 0.85) : 2; }
  }

  private buildFixtures(def: LightingDef) {
    for (const c of [...this.fixtures.children]) { this.fixtures.remove(c); (c as THREE.Mesh).geometry?.dispose(); }
    this.patches = []; this.lenses = [];
    // the daylight scenario has spotlights too: they take over when it gets dark outside
    const track = def.ceiling === 'track' || def.id === 'daylight';
    const glow = (color: string, intensity: number) => new THREE.MeshStandardMaterial({ color: '#000000', emissive: color, emissiveIntensity: intensity, roughness: 1 });
    const dark = new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.5, metalness: 0.6 });
    for (const pr of this.gallery.plan.rooms) {
      const { room, centre } = pr;
      const H = room.height;
      // real roof lanterns replace the old painted skylights
      if (def.skylights && !this.gallery.skylights.length) {
        const nx = Math.max(1, Math.round(room.width / 5)), nz = Math.max(1, Math.round(room.depth / 5));
        const sw = (room.width / nx) * 0.55, sd = (room.depth / nz) * 0.55;
        for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
          const x = centre.x - room.width / 2 + (i + 0.5) * (room.width / nx);
          const z = centre.z - room.depth / 2 + (j + 0.5) * (room.depth / nz);
          const sky = new THREE.Mesh(new THREE.PlaneGeometry(sw, sd), glow(def.background, def.sun ? 1.6 : 0.6));
          sky.rotation.x = Math.PI / 2;
          sky.position.set(x, H - 0.005, z);
          this.fixtures.add(sky);
          // light-well frame
          const well = new THREE.Mesh(new THREE.BoxGeometry(sw + 0.1, 0.25, sd + 0.1), new THREE.MeshStandardMaterial({ color: this.gallery.style.ceiling, side: THREE.BackSide }));
          well.position.set(x, H - 0.12, z);
          this.fixtures.add(well);
        }
      }
      if (def.ceiling === 'panels') {
        const nx = Math.max(1, Math.round(room.width / 3.5)), nz = Math.max(1, Math.round(room.depth / 3.5));
        for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
          const x = centre.x - room.width / 2 + (i + 0.5) * (room.width / nx), z = centre.z - room.depth / 2 + (j + 0.5) * (room.depth / nz);
          // keep panels clear of the roof lantern
          if (this.gallery.skylights.some((l) => Math.abs(x - l.x) < l.w / 2 + 0.9 && Math.abs(z - l.z) < l.d / 2 + 0.9)) continue;
          const p = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), glow('#ffffff', def.panelGlow));
          p.rotation.x = Math.PI / 2;
          p.position.set(x, H - 0.01, z);
          this.fixtures.add(p);
        }
      }
      if (track) {
        // one rail parallel to each wall, 1.4 m in
        const inset = 1.4;
        const rails: Array<[number, number, number, number]> = [
          [centre.x, centre.z - room.depth / 2 + inset, room.width - 2 * inset, 0],
          [centre.x, centre.z + room.depth / 2 - inset, room.width - 2 * inset, 0],
          [centre.x - room.width / 2 + inset, centre.z, room.depth - 2 * inset, Math.PI / 2],
          [centre.x + room.width / 2 - inset, centre.z, room.depth - 2 * inset, Math.PI / 2],
        ];
        for (const [x, z, len, ry] of rails) {
          if (len <= 0) continue;
          const r = new THREE.Mesh(new THREE.BoxGeometry(len, 0.04, 0.05), dark);
          r.position.set(x, H - 0.03, z);
          r.rotation.y = ry;
          this.fixtures.add(r);
        }
      }
    }
    for (const l of this.gallery.skylights) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(l.w * 1.7, l.d * 1.7),
        new THREE.MeshBasicMaterial({ map: lightPoolTexture(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(l.x, 0.004, l.z);
      m.renderOrder = 1;
      this.fixtures.add(m);
      this.patches.push(m);
    }
    if (track) {
      for (const a of this.gallery.artworks) {
        const head = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.16, 12), dark);
        head.position.copy(a.spotAnchor).add(new THREE.Vector3(0, -0.12, 0));
        head.lookAt(a.centre);
        head.rotateX(Math.PI / 2);
        this.fixtures.add(head);
        const lensMat = glow(def.spot.color, 2);
        this.lenses.push(lensMat);
        const lens = new THREE.Mesh(new THREE.CircleGeometry(0.04, 12), lensMat);
        lens.position.copy(head.position).add(a.centre.clone().sub(head.position).normalize().multiplyScalar(0.081));
        lens.lookAt(a.centre);
        this.fixtures.add(lens);
      }
    }
  }

  /**
   * Re-assign the real spotlights, fading them in and out. They go to the works in the visitor's own room first,
   * nearest first, then to neighbouring rooms. A work without a real light still gets a painted pool of light on
   * the wall of about the same strength, so no picture ever looks as if its lamp were off.
   */
  update(visitor: THREE.Vector3, dt: number) {
    if (!this.def) return;
    const here = roomAt(this.gallery.plan, { x: visitor.x, z: visitor.z })?.room.id;
    const want = [...this.gallery.artworks]
      .map((a) => ({ a, d: a.centre.distanceToSquared(visitor) + (here && a.roomId !== here ? 1e4 : 0) }))
      .sort((x, y) => x.d - y.d)
      .slice(0, this.spots.length)
      .map((x) => x.a);
    const assigned = new Set(this.spots.map((s) => s.target).filter(Boolean));
    // lights whose target is no longer wanted fade out and become free
    for (const s of this.spots) if (s.target && !want.includes(s.target) && s.level <= 0.01) s.target = undefined;
    for (const a of want) {
      if (assigned.has(a)) continue;
      const free = this.spots.find((s) => !s.target);
      if (!free) break;
      free.target = a;
      free.level = 0;
      free.light.position.copy(a.spotAnchor);
      free.light.target.position.copy(a.centre);
      free.light.target.updateMatrixWorld();
      assigned.add(a);
    }
    const k = Math.min(1, dt * 3);
    for (const s of this.spots) {
      const goal = s.target && want.includes(s.target) ? 1 : 0;
      s.level += (goal - s.level) * k;
      const tweak = s.target?.art.spotlight?.intensity ?? 1;
      const size = s.target ? Math.max(s.target.hung.outerW, s.target.hung.outerH) : 1;
      const dist = s.target ? s.target.spotAnchor.distanceTo(s.target.centre) : 3;
      s.light.angle = Math.min(0.9, Math.max(this.eff.angle, Math.atan((size * 0.75) / dist)));
      s.light.intensity = this.eff.spot * SPOT_CD * s.level * tweak;
    }
    const lit = new Map<ArtworkInstance, number>();
    for (const s of this.spots) if (s.target) lit.set(s.target, Math.max(lit.get(s.target) ?? 0, s.level));
    const stand = Math.min(0.5, this.eff.spot * 0.3);
    for (const a of this.gallery.artworks) {
      const tweak = a.art.spotlight?.intensity ?? 1;
      a.pool.material.opacity = Math.min(0.75, (a.pool.userData.base ?? 0.1) + (1 - (lit.get(a) ?? 0)) * stand * tweak);
    }
  }
}
