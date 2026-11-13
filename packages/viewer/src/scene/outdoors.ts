import * as THREE from 'three';
import { moonAge, type FloorPlan, type LandscapeId } from '@vernissage/schema';
import { buildLandscape, type Landscape } from './environment';
import { cloneState, lerpState, SkyDome, type SkyState } from './sky';
import { makeLake, type Lake } from './water';
import { Precipitation } from './weather';
import type { Quality } from './lighting';

const WATER_Y = -0.32;
const MIRROR: Record<Quality, false | number> = { low: false, medium: 512, high: 1024 };

/**
 * Everything outside the building, as a scene of its own: sky, lake, landscape, weather. It is drawn first and the
 * rooms are drawn over it, so the outdoors has its own light, mist and camera range, and none of it leaks indoors.
 */
export class Outdoors {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.4, 16000);
  /** the sky as drawn right now (it eases towards the target) */
  readonly state: SkyState;
  /** lightning: 0, or a brief flash up to 1 */
  flash = 0;
  private target: SkyState;
  private dome = new SkyDome();
  private hemi = new THREE.HemisphereLight();
  private sun = new THREE.DirectionalLight();
  private moonlight = new THREE.DirectionalLight('#9db4e8', 0);
  private fog = new THREE.Fog('#ffffff', 400, 9000);
  private lake!: Lake;
  private land: Landscape;
  private precip: Precipitation;
  private pmrem: THREE.PMREMGenerator;
  private envScene = new THREE.Scene();
  private envTarget?: THREE.WebGLRenderTarget;
  private envAge = 99;
  private envKey = '';
  private time = 0;
  private nextStrike = 6;
  private strike = -1;
  private centre: THREE.Vector3;
  private calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(private renderer: THREE.WebGLRenderer, plan: FloorPlan, readonly landscape: LandscapeId, private north: THREE.Vector3, initial: SkyState, quality: Quality) {
    this.state = cloneState(initial);
    this.target = cloneState(initial);
    const b = plan.bounds;
    this.centre = new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    this.scene.fog = this.fog;
    this.scene.add(this.dome.mesh, this.hemi, this.sun, this.sun.target, this.moonlight, this.moonlight.target);
    this.land = buildLandscape(plan, landscape, north);
    this.scene.add(this.land.group);
    this.precip = new Precipitation();
    this.scene.add(this.precip.group);
    this.setQuality(quality);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene.add(this.dome.twin());
  }

  setQuality(q: Quality) {
    if (this.lake) { this.scene.remove(this.lake.mesh); this.lake.dispose(); }
    this.lake = makeLake(WATER_Y, MIRROR[q]);
    this.lake.mesh.position.x = this.centre.x; this.lake.mesh.position.z = this.centre.z;
    this.scene.add(this.lake.mesh);
  }

  /** where the sky should go; `snap` skips the transition */
  set(target: SkyState, snap = false) {
    this.target = cloneState(target);
    if (snap) { lerpState(this.state, this.target, 1); this.envAge = 99; }
  }

  update(dt: number) {
    this.time += dt;
    const s = this.state;
    lerpState(s, this.target, 1 - Math.exp(-dt * 1.4));

    // lightning: now and then a double flash, softened; none for visitors who asked for less motion
    this.flash = 0;
    if (s.storm > 0.5 && !this.calm) {
      if (this.strike < 0 && this.time > this.nextStrike) { this.strike = 0; this.nextStrike = this.time + 7 + Math.random() * 14; }
      if (this.strike >= 0) {
        this.strike += dt;
        const p = this.strike;
        this.flash = Math.max(Math.exp(-p * 9), p > 0.22 ? Math.exp(-(p - 0.22) * 6) * 0.7 : 0) * 0.85;
        if (p > 1.2) this.strike = -1;
      }
    } else this.strike = -1;

    this.dome.apply(s, this.time, this.flash, moonAge(Date.now()));
    this.fog.color.copy(s.horizon);
    this.fog.near = s.fogNear; this.fog.far = s.fogFar;

    // light on the landscape: the sky all round, the sun (or the moon) from its place in the sky
    this.hemi.color.copy(s.zenith).lerp(s.horizon, 0.6).lerp(new THREE.Color('#ffffff'), 0.25);
    this.hemi.groundColor.copy(s.horizon).multiplyScalar(0.35);
    this.hemi.intensity = 0.1 + 1.1 * s.daylight + this.flash * 1.5;
    this.sun.color.copy(s.sunColor);
    this.sun.intensity = s.sunLight;
    this.sun.position.copy(this.centre).addScaledVector(s.sunDir, 500);
    this.sun.target.position.copy(this.centre);
    this.moonlight.intensity = s.moon * 0.22;
    this.moonlight.position.copy(this.centre).addScaledVector(s.moonDir, 500);
    this.moonlight.target.position.copy(this.centre);

    this.land.set(s.night, s.snow);
    this.land.update(this.time);
    this.lake.update(dt, s);
    // weather comes off the lake from the west-north-west
    const towards = new THREE.Vector3(-this.north.z, 0, this.north.x).multiplyScalar(0.9).addScaledVector(this.north, -0.4).normalize();
    this.precip.update(this.time, s, towards, this.renderer.domElement.height, this.camera.position);

    // the sky also lights the glass towers and the water: re-bake it into reflections when it has changed
    this.envAge += dt;
    const key = [s.zenith.getHexString(), s.horizon.getHexString(), s.cloudLit.getHexString(), s.cover.toFixed(2), s.sunDir.y.toFixed(2)].join();
    if (key !== this.envKey && this.envAge > 0.5) {
      this.envKey = key; this.envAge = 0;
      const old = this.envTarget;
      const exposure = this.renderer.toneMappingExposure;
      this.renderer.toneMappingExposure = 1;
      this.envTarget = this.pmrem.fromScene(this.envScene, 0, 0.1, 10);
      this.renderer.toneMappingExposure = exposure;
      this.scene.environment = this.envTarget.texture;
      this.scene.environmentIntensity = 0.9;
      old?.dispose();
    }
  }

  dispose() {
    this.envTarget?.dispose();
    this.pmrem.dispose();
    this.lake.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m === this.lake.mesh) return;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) { (mat as THREE.MeshStandardMaterial).map?.dispose(); (mat as THREE.MeshStandardMaterial).emissiveMap?.dispose(); mat.dispose(); }
    });
  }

  /** draw the outdoors as seen by the visitor's camera */
  render(view: THREE.PerspectiveCamera) {
    const c = this.camera;
    view.updateMatrixWorld();
    c.position.setFromMatrixPosition(view.matrixWorld);
    c.quaternion.setFromRotationMatrix(view.matrixWorld);
    if (c.fov !== view.fov || c.aspect !== view.aspect) { c.fov = view.fov; c.aspect = view.aspect; c.updateProjectionMatrix(); }
    this.dome.mesh.position.copy(c.position);
    this.renderer.toneMappingExposure = 1;
    this.renderer.render(this.scene, c);
  }
}
