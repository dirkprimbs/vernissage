import * as THREE from 'three';
import type { SkyState } from './sky';

/** rain and snow fill a box this wide that travels with the visitor */
const BOX = 44;
const TOP = 15, FLOOR = -0.4;
const MAX_RAIN = 10000, MAX_SNOW = 8000;

const COMMON = /* glsl */ `
uniform float uTime, uSpeed;
uniform vec2 uWind;
uniform vec3 uCam;
attribute vec2 aXZ;
attribute float aPhase;
const float BOX = ${BOX.toFixed(1)}, TOP = ${TOP.toFixed(1)}, FLOOR = ${FLOOR.toFixed(1)};
// where this particle is now: it falls on the wind's slant, and the box of particles wraps around the camera
vec3 fall(float lift) {
  float H = TOP - FLOOR;
  float y = TOP - mod(uTime * uSpeed * (0.8 + 0.4 * fract(aPhase * 7.3)) + aPhase * H, H);
  vec2 xz = aXZ - uWind * (y - FLOOR);
  xz = uCam.xz + mod(xz - uCam.xz, BOX) - BOX * 0.5;
  return vec3(xz.x - uWind.x * lift, y + lift, xz.y - uWind.y * lift);
}`;

/**
 * Rain and snow. The particles surround the visitor, who is always indoors: the rooms are drawn over the outdoor
 * scene afterwards, so precipitation only ever shows through the windows and the roof lanterns.
 */
export class Precipitation {
  readonly group = new THREE.Group();
  private rain: THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private snow: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;

  constructor() {
    let seed = 11;
    const r = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const attrs = (n: number, copies: number) => {
      const xz = new Float32Array(n * copies * 2), phase = new Float32Array(n * copies);
      for (let i = 0; i < n; i++) {
        const x = r() * BOX, z = r() * BOX, p = r();
        for (let k = 0; k < copies; k++) { xz[(i * copies + k) * 2] = x; xz[(i * copies + k) * 2 + 1] = z; phase[i * copies + k] = p; }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * copies * 3), 3));
      g.setAttribute('aXZ', new THREE.BufferAttribute(xz, 2));
      g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
      return g;
    };
    const uniforms = (extra: Record<string, THREE.IUniform>) => ({
      uTime: { value: 0 }, uSpeed: { value: 1 }, uWind: { value: new THREE.Vector2() }, uCam: { value: new THREE.Vector3() },
      uColor: { value: new THREE.Color('#ffffff') }, uOpacity: { value: 0.5 }, ...extra,
    });

    // rain: one short streak per drop
    const rg = attrs(MAX_RAIN, 2);
    const end = new Float32Array(MAX_RAIN * 2);
    for (let i = 0; i < MAX_RAIN; i++) end[i * 2 + 1] = 1;
    rg.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.rain = new THREE.LineSegments(rg, new THREE.ShaderMaterial({
      uniforms: uniforms({ uLength: { value: 0.8 } }),
      vertexShader: COMMON + /* glsl */ `
        uniform float uLength;
        attribute float aEnd;
        varying float vFade;
        void main() {
          vec4 mv = modelViewMatrix * vec4(fall(aEnd * uLength), 1.0);
          // streaks fade towards their tails and with distance
          vFade = smoothstep(${(BOX / 2).toFixed(1)}, 4.0, -mv.z) * (0.25 + 0.75 * (1.0 - aEnd));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uOpacity; varying float vFade;
        void main() {
          gl_FragColor = vec4(uColor, uOpacity * vFade);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false,
    }));

    this.snow = new THREE.Points(attrs(MAX_SNOW, 1), new THREE.ShaderMaterial({
      uniforms: uniforms({ uScale: { value: 300 } }),
      vertexShader: COMMON + /* glsl */ `
        uniform float uScale;
        varying float vFade;
        void main() {
          vec3 p = fall(0.0);
          p.x += sin(uTime * 0.9 + aPhase * 40.0) * 0.25; p.z += cos(uTime * 0.7 + aPhase * 31.0) * 0.25;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vFade = smoothstep(${(BOX / 2).toFixed(1)}, 6.0, -mv.z);
          gl_PointSize = clamp(uScale * (0.03 + 0.03 * fract(aPhase * 13.0)) / -mv.z, 1.5, 16.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uOpacity; varying float vFade;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          gl_FragColor = vec4(uColor, uOpacity * vFade * smoothstep(0.5, 0.15, d));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false,
    }));
    for (const o of [this.rain, this.snow]) { o.frustumCulled = false; o.visible = false; o.renderOrder = 5; }
    this.group.add(this.rain, this.snow);
  }

  /** `towards`: the horizontal direction the wind blows to; `height`: the drawing buffer's height (snowflake size) */
  update(t: number, s: SkyState, towards: THREE.Vector3, height: number, camera: THREE.Vector3) {
    this.rain.visible = s.rain > 0.02;
    if (this.rain.visible) {
      const u = this.rain.material.uniforms;
      this.rain.geometry.setDrawRange(0, Math.floor(MAX_RAIN * Math.min(1, 0.35 + s.rain * 0.65)) * 2);
      u.uTime.value = t; u.uCam.value.copy(camera);
      u.uSpeed.value = 12 + s.wind * 5;
      (u.uWind.value as THREE.Vector2).set(towards.x, towards.z).multiplyScalar(0.06 + s.wind * 0.28);
      u.uLength.value = 0.6 + s.rain * 0.5;
      // pale streaks by day; at night they only catch a little light
      (u.uColor.value as THREE.Color).set('#ffffff').lerp(s.horizon, s.night * 0.6);
      u.uOpacity.value = (0.3 + 0.25 * s.rain) * (1 - s.night * 0.5);
    }
    this.snow.visible = s.snow > 0.02;
    if (this.snow.visible) {
      const u = this.snow.material.uniforms;
      this.snow.geometry.setDrawRange(0, Math.floor(MAX_SNOW * Math.min(1, s.snow)));
      u.uTime.value = t; u.uCam.value.copy(camera);
      u.uSpeed.value = 1.4;
      (u.uWind.value as THREE.Vector2).set(towards.x, towards.z).multiplyScalar(0.25 + s.wind * 0.5);
      (u.uColor.value as THREE.Color).set('#ffffff').lerp(s.horizon, s.night * 0.5);
      u.uOpacity.value = 0.92;
      u.uScale.value = height;
    }
  }
}
