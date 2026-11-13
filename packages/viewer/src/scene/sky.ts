import * as THREE from 'three';
import type { SunPosition, Weather } from '@vernissage/schema';

/** Everything the outdoor scene needs to draw one moment: sky colours, sun, clouds, haze and light levels. */
export interface SkyState {
  zenith: THREE.Color;
  horizon: THREE.Color;
  /** warm glow around the sun near the horizon */
  glowColor: THREE.Color;
  glow: number;
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  /** how clearly the sun's disc shows (0 behind overcast) */
  sunDisc: number;
  /** strength of direct sunlight on the landscape */
  sunLight: number;
  /** cloud cover 0..1 */
  cover: number;
  cloudLit: THREE.Color;
  cloudDark: THREE.Color;
  stars: number;
  moonDir: THREE.Vector3;
  moon: number;
  /** natural light level 0 (night) .. 1 (clear midday); drives the daylight scenario indoors */
  daylight: number;
  /** 0 by day .. 1 at night: city lights, lit windows */
  night: number;
  /** how much of the sky is lost in mist */
  haze: number;
  fogNear: number;
  fogFar: number;
  /** wind strength 0..1 (cloud drift, waves, slant of the rain) */
  wind: number;
  rain: number;
  snow: number;
  /** lightning allowed */
  storm: number;
}

const C = (hex: string) => new THREE.Color(hex);
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

interface Key { e: number; zenith: string; horizon: string; glowColor: string; glow: number; cloudLit: string; cloudDark: string }
/** sky colours by the sun's elevation in degrees */
const KEYS: Key[] = [
  { e: -18, zenith: '#02030a', horizon: '#080c1a', glowColor: '#ff7a3c', glow: 0, cloudLit: '#22212b', cloudDark: '#0b0c14' },
  { e: -7, zenith: '#081230', horizon: '#232c55', glowColor: '#ff6a3c', glow: 0.3, cloudLit: '#3b3d5a', cloudDark: '#14182c' },
  { e: -1.5, zenith: '#1c3672', horizon: '#e8946a', glowColor: '#ff7e36', glow: 1, cloudLit: '#ffab85', cloudDark: '#54466a' },
  { e: 4, zenith: '#2c5cab', horizon: '#f2c8a2', glowColor: '#ffae62', glow: 0.8, cloudLit: '#ffd8b8', cloudDark: '#7a6f88' },
  { e: 12, zenith: '#3470c2', horizon: '#cfe0ee', glowColor: '#fff0d2', glow: 0.35, cloudLit: '#ffffff', cloudDark: '#98a4b6' },
  { e: 35, zenith: '#2b68c0', horizon: '#bcd8f0', glowColor: '#ffffff', glow: 0.2, cloudLit: '#ffffff', cloudDark: '#a8b4c4' },
];

interface Wx { cover: number; grey: number; dim: number; disc: number; light: number; haze: number; near: number; far: number; wind: number; rain: number; snow: number; storm: number }
const WX: Record<Weather, Wx> = {
  clear: { cover: 0.38, grey: 0, dim: 1, disc: 1, light: 1, haze: 0, near: 150, far: 7500, wind: 0.25, rain: 0, snow: 0, storm: 0 },
  cloudy: { cover: 0.92, grey: 0.6, dim: 0.92, disc: 0.12, light: 0.7, haze: 0.1, near: 300, far: 7000, wind: 0.4, rain: 0, snow: 0, storm: 0 },
  rain: { cover: 1, grey: 0.88, dim: 0.72, disc: 0, light: 0.5, haze: 0.35, near: 40, far: 2500, wind: 0.6, rain: 0.6, snow: 0, storm: 0 },
  storm: { cover: 1, grey: 0.92, dim: 0.45, disc: 0, light: 0.33, haze: 0.4, near: 30, far: 2100, wind: 1, rain: 1, snow: 0, storm: 1 },
  snow: { cover: 1, grey: 0.92, dim: 1.05, disc: 0, light: 0.72, haze: 0.5, near: 30, far: 1900, wind: 0.35, rain: 0, snow: 1, storm: 0 },
  fog: { cover: 0.75, grey: 0.75, dim: 0.95, disc: 0.05, light: 0.6, haze: 0.92, near: 12, far: 1250, wind: 0.1, rain: 0, snow: 0, storm: 0 },
};

/** direction (unit vector, world space) for a compass bearing and elevation, given which way north lies */
function compass(az: number, el: number, north: THREE.Vector3): THREE.Vector3 {
  const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
  const ex = -north.z, ez = north.x; // east: north turned a quarter clockwise, seen from above
  const hx = north.x * Math.cos(a) + ex * Math.sin(a), hz = north.z * Math.cos(a) + ez * Math.sin(a);
  return new THREE.Vector3(hx * Math.cos(e), Math.sin(e), hz * Math.cos(e)).normalize();
}

/** The look of the sky for a sun position and a weather. `north` is the horizontal direction of north in the scene. */
export function skyState(sun: SunPosition, weather: Weather, north: THREE.Vector3): SkyState {
  const e = sun.elevation;
  let i = 0;
  while (i < KEYS.length - 2 && e > KEYS[i + 1].e) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = Math.min(1, Math.max(0, (e - a.e) / (b.e - a.e)));
  const mix = (k: 'zenith' | 'horizon' | 'glowColor' | 'cloudLit' | 'cloudDark') => C(a[k]).lerp(C(b[k]), t);
  const w = WX[weather];
  const zenith = mix('zenith'), horizon = mix('horizon'), cloudLit = mix('cloudLit'), cloudDark = mix('cloudDark');
  const night = 1 - smooth(-8, 4, e);

  // overcast skies lose their colour: pull towards a grey of the same brightness
  const grey = (c: THREE.Color, k: number) => {
    const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    return c.lerp(new THREE.Color(l * 0.94, l * 0.97, l * 1.02), k);
  };
  if (w.grey) {
    // an overcast sky is about as bright overhead as at the horizon
    const flat = zenith.clone().lerp(horizon, 0.55);
    zenith.lerp(flat, w.grey * 0.8);
    horizon.lerp(flat, w.grey * 0.5);
    grey(zenith, w.grey); grey(horizon, w.grey); grey(cloudLit, w.grey * 0.9); grey(cloudDark, w.grey * 0.9);
  }
  // under cloud at night the city lights the sky a dull orange
  if (w.cover > 0.6 && night > 0) {
    cloudLit.lerp(C('#33271f'), night * 0.7);
    horizon.lerp(C('#2a211c'), night * 0.5 * w.grey);
  }
  for (const c of [zenith, horizon, cloudLit, cloudDark]) c.multiplyScalar(w.dim);
  if (weather === 'snow') cloudLit.lerp(horizon, 0.3);

  const up = smooth(-2, 10, e);
  return {
    zenith, horizon,
    glowColor: mix('glowColor'), glow: (a.glow + (b.glow - a.glow) * t) * (1 - w.grey * 0.85),
    sunDir: compass(sun.azimuth, sun.elevation, north),
    sunColor: C('#ff8f4f').lerp(C('#fff3e2'), smooth(0, 25, e)),
    sunDisc: w.disc * smooth(-1.5, 0.5, e),
    sunLight: 2.4 * up * w.disc * (0.35 + 0.65 * smooth(0, 20, e)),
    cover: w.cover, cloudLit, cloudDark,
    stars: (1 - smooth(-13, -4, e)) * (1 - w.cover * 0.95) * (1 - w.haze),
    // the moon stands in the south-east, clear of the skyline to the north
    moonDir: compass(118, 34, north),
    moon: (1 - smooth(-10, -3, e)) * (1 - Math.min(1, w.cover * 1.15)) * (1 - w.haze),
    daylight: smooth(-6, 10, e) * w.light, night,
    haze: w.haze, fogNear: w.near, fogFar: w.far * (1 - night * 0.25),
    wind: w.wind, rain: w.rain, snow: w.snow, storm: w.storm,
  };
}

export function cloneState(s: SkyState): SkyState {
  const o = { ...s } as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(s)) if (v instanceof THREE.Color || v instanceof THREE.Vector3) o[k] = v.clone();
  return o as unknown as SkyState;
}

/** Move `cur` a fraction k of the way to `to` (colours, directions and numbers alike). */
export function lerpState(cur: SkyState, to: SkyState, k: number) {
  const c = cur as unknown as Record<string, unknown>, t = to as unknown as Record<string, unknown>;
  for (const key of Object.keys(c)) {
    const v = c[key], w = t[key];
    if (v instanceof THREE.Color) v.lerp(w as THREE.Color, k);
    else if (v instanceof THREE.Vector3) v.lerp(w as THREE.Vector3, k).normalize();
    else if (typeof v === 'number') c[key] = v + ((w as number) - v) * k;
  }
}

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always at the far plane, whatever the dome's size
}`;

const FRAG = /* glsl */ `
uniform vec3 uZenith, uHorizon, uGlowColor, uSunDir, uSunColor, uCloudLit, uCloudDark, uMoonDir;
uniform float uGlow, uSunDisc, uCover, uStars, uMoon, uMoonAge, uHaze, uTime, uFlash, uWind;
varying vec3 vDir;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return s / 0.97;
}

void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  float low = pow(1.0 - h, 3.0);
  vec3 col = mix(uZenith, uHorizon, low);
  float sd = max(dot(d, uSunDir), 0.0);
  // warm band around the sun, strongest along the horizon
  col += uGlowColor * uGlow * (pow(sd, 5.0) * (0.25 + 0.75 * low) + pow(sd, 40.0) * 0.6);

  if (uStars > 0.01 && d.y > 0.0) {
    vec2 sp = d.xz / (d.y + 0.4) * 190.0;
    vec2 cell = floor(sp);
    float r = hash(cell);
    vec2 f = fract(sp) - 0.5 - (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.6;
    float tw = 0.7 + 0.3 * sin(uTime * 1.7 + r * 60.0);
    float star = step(0.962, r) * smoothstep(0.16, 0.0, length(f)) * tw * (0.4 + 0.6 * hash(cell + 1.3));
    col += vec3(0.9, 0.95, 1.0) * star * uStars * smoothstep(0.0, 0.2, d.y);
  }

  if (uMoon > 0.01) {
    const float R = 0.026; // a little larger than life, as painters do
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), uMoonDir));
    vec3 upv = cross(uMoonDir, right);
    vec2 m = vec2(dot(d, right), dot(d, upv)) / R;
    float md = dot(d, uMoonDir);
    float rr = dot(m, m);
    if (md > 0.0 && rr < 1.0) {
      vec3 n = vec3(m, sqrt(1.0 - rr));
      float a = uMoonAge * 6.2831853;
      float lit = smoothstep(-0.04, 0.12, dot(n, vec3(sin(a), 0.0, -cos(a))));
      float mare = 0.86 + 0.14 * noise(m * 2.6 + 4.0);
      vec3 moon = vec3(0.96, 0.95, 0.88) * mare * (0.035 + lit) * 1.5;
      col = mix(col, moon, smoothstep(1.0, 0.92, rr) * uMoon);
    }
    col += vec3(0.5, 0.6, 0.85) * pow(max(md, 0.0), 300.0) * 0.25 * uMoon;
  }

  // the sun: a small bright disc and its halo
  col += uSunColor * uSunDisc * (smoothstep(0.99955, 0.9998, dot(d, uSunDir)) * 6.0 + pow(sd, 700.0) * 0.9);

  // clouds: a noise field on a plane overhead, drifting with the wind
  if (d.y > -0.01) {
    vec2 uv = d.xz / (d.y + 0.13);
    vec2 p = uv * 0.62 + vec2(uTime * 0.006, uTime * 0.0025) * (0.4 + uWind * 2.2);
    float n = fbm(p) * 0.78 + fbm(p * 2.9 + 31.7 - uTime * 0.004) * 0.22;
    float th = mix(0.74, 0.16, uCover);
    float dens = smoothstep(th, th + 0.2, n);
    float thick = smoothstep(th + 0.06, th + 0.5, n);
    // light comes from the sun's side: compare with the field a step towards it
    float toward = fbm(p + normalize(uSunDir.xz + 1e-4) * 0.16) * 0.78 + 0.11;
    float shade = clamp(0.5 + (n - toward) * 3.2, 0.0, 1.0);
    vec3 cc = mix(uCloudLit, uCloudDark, clamp(thick * 0.75 + shade * 0.35, 0.0, 1.0));
    cc += uSunColor * uSunDisc * pow(sd, 10.0) * 0.35 * (1.0 - thick);
    cc += vec3(0.75, 0.8, 1.0) * uFlash * (0.25 + 0.75 * noise(p * 1.7 + floor(uTime * 9.0)));
    cc = mix(cc, uHorizon, pow(1.0 - h, 7.0) * 0.85);
    col = mix(col, cc, dens * smoothstep(-0.01, 0.07, d.y));
  }

  // mist swallows the lower sky first
  col = mix(col, uHorizon, uHaze * (1.0 - 0.55 * smoothstep(0.0, 0.9, h)));
  if (d.y < 0.0) col = mix(uHorizon, uHorizon * 0.55, clamp(-d.y * 5.0, 0.0, 1.0));
  col += vec3(0.5, 0.55, 0.7) * uFlash * 0.12;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** The sky itself: one shader on a dome that travels with the camera. */
export class SkyDome {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private u: Record<string, THREE.IUniform>;

  constructor() {
    this.u = {
      uZenith: { value: C('#2b68c0') }, uHorizon: { value: C('#bcd8f0') }, uGlowColor: { value: C('#ffffff') }, uGlow: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: C('#ffffff') }, uSunDisc: { value: 1 },
      uCover: { value: 0.3 }, uCloudLit: { value: C('#ffffff') }, uCloudDark: { value: C('#a8b4c4') },
      uStars: { value: 0 }, uMoonDir: { value: new THREE.Vector3(0, 1, 0) }, uMoon: { value: 0 }, uMoonAge: { value: 0.5 },
      uHaze: { value: 0 }, uTime: { value: 0 }, uFlash: { value: 0 }, uWind: { value: 0.25 },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
    // large enough that the lake's mirrored camera, a few metres below the visitor, is inside it too
    this.mesh.scale.setScalar(6000);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  /** a second dome sharing the material, for baking the sky into reflections */
  twin(): THREE.Mesh { const m = new THREE.Mesh(this.mesh.geometry, this.mesh.material); m.frustumCulled = false; return m; }

  apply(s: SkyState, time: number, flash: number, moonAge: number) {
    const u = this.u;
    u.uZenith.value.copy(s.zenith); u.uHorizon.value.copy(s.horizon); u.uGlowColor.value.copy(s.glowColor); u.uGlow.value = s.glow;
    u.uSunDir.value.copy(s.sunDir); u.uSunColor.value.copy(s.sunColor); u.uSunDisc.value = s.sunDisc;
    u.uCover.value = s.cover; u.uCloudLit.value.copy(s.cloudLit); u.uCloudDark.value.copy(s.cloudDark);
    u.uStars.value = s.stars; u.uMoonDir.value.copy(s.moonDir); u.uMoon.value = s.moon; u.uMoonAge.value = moonAge;
    u.uHaze.value = s.haze; u.uTime.value = time; u.uFlash.value = flash; u.uWind.value = s.wind;
  }
}
