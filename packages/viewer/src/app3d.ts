import * as THREE from 'three';
import {
  pointOnWall, resolveCollision, resolveLighting, roomAt,
  type LightingId, type SunPosition, type Weather, type PlacedRoom, type SiteData, type StyleDef,
} from '@vernissage/schema';
import { buildGallery, type ArtworkInstance, type BuiltGallery } from './scene/build';
import { Outdoors } from './scene/outdoors';
import { skyState } from './scene/sky';
import { LightingRig, type Quality } from './scene/lighting';
import { TeleportMarker } from './scene/teleport';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Input } from './controls';

export interface Gallery3DOptions {
  teleport: boolean;
  accent: string;
  /** circle the first room behind the entry screen */
  orbit: boolean;
}

export interface Gallery3DEvents {
  onRoom?: (room: PlacedRoom) => void;
  onNear?: (art: ArtworkInstance | undefined) => void;
  /** open the 2D focus (inspect) view */
  onOpen?: (artId: string) => void;
  /** open the wall label close-up */
  onLabel?: (artId: string) => void;
  /** the entry door was clicked from close by */
  onExit?: (url: string) => void;
  /** an artwork was selected (object menu) or deselected */
  onSelect?: (art: ArtworkInstance | undefined) => void;
  onTeleport?: () => void;
  onProgress?: (loaded: number, total: number) => void;
  onKey?: (key: string) => void;
}

const WALK = 1.7, RUN = 3.4;
/** the visitor: eye height and collision radius, in metres */
const EYE = 1.62, RADIUS = 0.28;
/** first-person field of view: normal, and fully zoomed in (about 4×) */
const FOV = 60, FOV_MIN = 15;

export class Gallery3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.05, 300);
  built: BuiltGallery;
  lighting: LightingRig;
  /** sky, lake, landscape and weather: a scene of its own, drawn behind the rooms */
  outdoors: Outdoors;
  /** artwork images already loaded, by URL: a rebuild reuses them instead of loading again */
  private texCache = new Map<string, THREE.Texture>();
  private quality: Quality;
  private lightingId: LightingId;
  readonly input: Input;
  /** the visitor's position on the floor; it also carries the night-tour torch */
  private body = new THREE.Object3D();
  private yaw = 0;
  private pitch = 0;
  /** first-person zoom: the field of view eases towards this */
  private fovTarget = FOV;
  private vel = new THREE.Vector3();
  private path: THREE.Vector3[] = [];
  private arriveArt?: ArtworkInstance;
  private stuck = 0;
  private room?: PlacedRoom;
  private near?: ArtworkInstance;
  private clock = new THREE.Timer();
  private ray = new THREE.Raycaster();
  private pictures: THREE.Object3D[];
  private running = false;
  private pendingTex: ArtworkInstance[] = [];
  private loadingTex = 0;
  private loadedTex = 0;
  private texLoader = new THREE.TextureLoader();
  private resizeObs: ResizeObserver;
  private nearTimer = 0;
  private hovered?: ArtworkInstance;
  private selected?: ArtworkInstance;
  private lobby = false;
  private lobbyT = 0;
  private marker: TeleportMarker;
  private aimTarget?: THREE.Vector3;

  constructor(private container: HTMLElement, private data: SiteData, private style: StyleDef, quality: Quality, outside: { sun: SunPosition; weather: Weather; hour: number }, private opts: Gallery3DOptions, private ev: Gallery3DEvents = {}) {
    this.quality = quality;
    this.lightingId = data.gallery.lighting.scenario;
    this.renderer = new THREE.WebGLRenderer({ antialias: quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.setPixelRatio(quality);
    this.renderer.domElement.className = 'gl';
    container.append(this.renderer.domElement);

    // soft studio reflections so gilt and steel frames read as metal
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();

    this.built = buildGallery(data, style, this.renderer);
    this.scene.add(this.built.root);
    this.pictures = [...this.built.artworks.flatMap((a) => [a.picture, ...a.group.children.filter((c) => c.userData.artworkId)]), ...(this.built.entrance?.meshes ?? [])];

    this.lighting = new LightingRig(this.built, this.scene, quality);
    this.scene.add(this.lighting.group);
    this.lighting.apply(resolveLighting(data.gallery.lighting.scenario, data.gallery.lighting.overrides));

    // the outdoors is drawn first and the rooms over it, so the renderer must not clear in between
    this.renderer.autoClear = false;
    this.outdoors = new Outdoors(this.renderer, this.built.plan, data.gallery.environment.landscape, this.built.outlook,
      skyState(outside.sun, outside.weather, this.built.outlook), quality);
    this.outdoors.setHour(outside.hour);

    this.scene.add(this.body);
    this.marker = new TeleportMarker(opts.accent);
    this.scene.add(this.marker.group);
    this.lighting.attachTorch(this.body);
    this.spawn();

    this.input = new Input(this.renderer.domElement);
    this.input.onTap = (x, y) => this.tap(x, y);
    this.input.onKey = (k, e) => this.key(k, e);
    this.input.onMiddle = () => this.resetZoom();
    if (opts.teleport) this.input.onAim = (phase, x, y) => this.aim(phase, x, y);
    this.renderer.domElement.addEventListener('pointermove', (e) => this.hover(e));

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    this.queueTextures();
  }

  private setPixelRatio(q: Quality) {
    const cap = q === 'low' ? 1 : q === 'medium' ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
  }

  setQuality(q: Quality) { this.quality = q; this.setPixelRatio(q); this.lighting.setQuality(q); this.outdoors.setQuality(q); this.resize(); }
  /** the sun's place and the weather outside; the sky eases over unless `snap` */
  setOutside(sun: SunPosition, weather: Weather, snap = false, hour?: number) {
    this.outdoors.set(skyState(sun, weather, this.built.outlook), snap);
    if (hour !== undefined) this.outdoors.setHour(hour);
  }
  setLighting(id: LightingId) { this.lightingId = id; this.lighting.apply(resolveLighting(id, id === this.data.gallery.lighting.scenario ? this.data.gallery.lighting.overrides : {})); }
  get selectedArtwork() { return this.selected; }

  /** entry-screen mode: the camera slowly circles the first room, input is off */
  setLobby(on: boolean) {
    this.lobby = on;
    this.input.enabled = !on && this.running;
    if (!on) this.lobbyT = 0;
  }

  /** highlight an artwork and tell the UI (object menu); optionally go to it */
  select(id: string | undefined, go: 'walk' | 'teleport' | 'none' = 'none') {
    const a = id ? this.built.artworks.find((x) => x.id === id) : undefined;
    if (this.selected && this.selected !== this.hovered) this.selected.highlight.visible = false;
    this.selected = a;
    if (a) {
      a.highlight.visible = true;
      if (go === 'teleport') this.teleportToArtwork(a.id);
      else if (go === 'walk' && a.viewpoint.distanceTo(this.position) > 0.6) this.walkTo(a.viewpoint, a);
    }
    this.ev.onSelect?.(a);
  }
  /** back to the normal field of view */
  resetZoom() { this.fovTarget = FOV; }
  get zoomed() { return this.fovTarget < FOV - 0.5; }
  get nearArtwork() { return this.near; }
  get currentRoom() { return this.room; }
  get position() { return this.body.position; }
  get heading() { return this.yaw; }

  private spawn() {
    const first = this.built.plan.rooms[0];
    const e = this.built.entrance;
    if (e) {
      // just inside the entry door, looking into the room
      this.body.position.copy(e.inside);
      this.yaw = Math.atan2(e.normal.x, e.normal.z) + Math.PI;
      return;
    }
    this.body.position.set(first.centre.x, 0, first.centre.z + Math.min(1, first.room.depth * 0.1));
    this.yaw = 0; // facing -z (north)
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.input.enabled = !this.lobby;
    this.clock.update();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  stop() {
    this.running = false;
    this.input.enabled = false;
    this.input.keys.clear();
    this.renderer.setAnimationLoop(null);
  }

  dispose() {
    this.stop();
    this.input.dispose();
    this.resizeObs.disconnect();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) { (mat as THREE.MeshStandardMaterial).map?.dispose(); mat.dispose(); }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize() {
    const w = this.container.clientWidth, hgt = this.container.clientHeight;
    if (!w || !hgt) return;
    this.renderer.setSize(w, hgt, false);
    this.camera.aspect = w / hgt;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Rebuild the rooms from `this.data` (changed in place by the caller) without reloading the page: the visitor
   * keeps their position and view, loaded images are reused, and the outdoors is rebuilt only if the scenery or
   * the building's footprint changed. Used by the studio's live preview.
   */
  rebuild(style: StyleDef) {
    this.style = style;
    const oldBuilt = this.built;
    const sel = this.selected?.id;
    const keepTex = new Set(this.texCache.values());
    const free = (root: THREE.Object3D) => root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        for (const t of [(mat as THREE.MeshStandardMaterial).map, (mat as THREE.MeshStandardMaterial).emissiveMap]) if (t && !keepTex.has(t)) t.dispose();
        mat.dispose();
      }
    });

    this.scene.remove(oldBuilt.root);
    free(oldBuilt.root);
    this.built = buildGallery(this.data, style, this.renderer);
    this.scene.add(this.built.root);
    this.pictures = [...this.built.artworks.flatMap((a) => [a.picture, ...a.group.children.filter((c) => c.userData.artworkId)]), ...(this.built.entrance?.meshes ?? [])];

    // a fresh light rig for the new rooms; the torch moves over to it
    this.scene.remove(this.lighting.group);
    this.lighting.detachTorch(this.body);
    free(this.lighting.group);
    const scenario = this.data.gallery.lighting.scenario;
    this.lighting = new LightingRig(this.built, this.scene, this.quality);
    this.scene.add(this.lighting.group);
    this.lighting.apply(resolveLighting(this.lightingId, this.lightingId === scenario ? this.data.gallery.lighting.overrides : {}));
    this.lighting.attachTorch(this.body);

    const a = oldBuilt.plan.bounds, b = this.built.plan.bounds;
    const moved = [a.minX - b.minX, a.maxX - b.maxX, a.minZ - b.minZ, a.maxZ - b.maxZ].some((d) => Math.abs(d) > 0.01);
    if (moved || this.outdoors.landscape !== this.data.gallery.environment.landscape || oldBuilt.outlook.distanceTo(this.built.outlook) > 0.01) {
      const sky = this.outdoors.state;
      this.outdoors.dispose();
      const hour = this.outdoors.hour;
      this.outdoors = new Outdoors(this.renderer, this.built.plan, this.data.gallery.environment.landscape, this.built.outlook, sky, this.quality);
      this.outdoors.setHour(hour);
    }

    // stay where we are if that is still inside a room; otherwise start over at the entrance
    this.path = []; this.arriveArt = undefined; this.hovered = undefined; this.near = undefined;
    this.selected = undefined;
    if (!roomAt(this.built.plan, this.position)) this.spawn();
    else { const p = resolveCollision({ x: this.position.x, z: this.position.z }, RADIUS, this.built.segments); this.position.set(p.x, 0, p.z); }
    // the same room under its new shape: no "Entered …" notice for a room the visitor never left
    const same = this.room && this.built.plan.rooms.find((r) => r.room.id === this.room!.room.id);
    this.room = same && roomAt(this.built.plan, this.position)?.room.id === same.room.id ? same : undefined;
    if (sel && this.built.artworks.some((x) => x.id === sel)) this.select(sel);
    else this.ev.onSelect?.(undefined);
    this.ev.onNear?.(undefined);
    this.pendingTex = [];
    this.queueTextures();
    if (!this.running) this.renderOnce();
  }

  // ---------- texture streaming ----------
  private queueTextures() {
    const p = this.body.position;
    for (const a of this.built.artworks) { const t = a.asset && this.texCache.get(a.asset.texture); if (t) this.applyTexture(a, t); }
    this.pendingTex = [...this.built.artworks].filter((a) => a.asset && !this.texCache.has(a.asset.texture)).sort((a, b) => a.centre.distanceToSquared(p) - b.centre.distanceToSquared(p));
    this.ev.onProgress?.(0, this.pendingTex.length);
    for (let i = 0; i < 4; i++) this.nextTexture();
  }

  private applyTexture(a: ArtworkInstance, tex: THREE.Texture) {
    const m = a.picture.material;
    m.map = tex;
    m.emissiveMap = tex;
    m.color.set('#ffffff');
    m.needsUpdate = true;
  }

  private nextTexture() {
    const a = this.pendingTex.shift();
    if (!a) return;
    this.loadingTex++;
    const url = a.asset!.texture;
    this.texLoader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        this.texCache.set(url, tex);
        // the gallery may have been rebuilt while this was loading: dress whatever now shows this image
        for (const x of this.built.artworks) if (x.asset?.texture === url) this.applyTexture(x, tex);
        this.done();
      },
      undefined,
      () => this.done(),
    );
  }

  private done() {
    this.loadingTex--;
    this.loadedTex++;
    this.ev.onProgress?.(this.loadedTex, this.built.artworks.filter((a) => a.asset).length);
    this.nextTexture();
  }

  // ---------- navigation ----------
  teleportToArtwork(id: string) {
    this.resetZoom();
    const a = this.built.artworks.find((x) => x.id === id);
    if (!a) return false;
    this.path = [];
    this.body.position.copy(a.viewpoint);
    this.faceArt(a, true);
    return true;
  }

  teleportToRoom(id: string) {
    this.resetZoom();
    const r = this.built.plan.rooms.find((x) => x.room.id === id);
    if (!r) return false;
    this.path = [];
    this.body.position.set(r.centre.x, 0, r.centre.z + r.room.depth * 0.2);
    this.yaw = 0;
    return true;
  }

  /** walk (with door routing) to a world point; optionally face an artwork on arrival */
  walkTo(target: THREE.Vector3, art?: ArtworkInstance) {
    this.resetZoom();
    const plan = this.built.plan;
    const from = roomAt(plan, this.position) ?? this.room;
    const to = roomAt(plan, target);
    const pts: THREE.Vector3[] = [];
    if (from && to && from.room.id !== to.room.id) {
      const route = this.route(from.room.id, to.room.id);
      for (let i = 0; i + 1 < route.length; i++) {
        const a = plan.doors.find((d) => d.roomId === route[i] && d.to === route[i + 1]);
        const b = plan.doors.find((d) => d.roomId === route[i + 1] && d.to === route[i]);
        const ra = plan.rooms.find((r) => r.room.id === route[i])!, rb = plan.rooms.find((r) => r.room.id === route[i + 1])!;
        if (a) { const p = pointOnWall(ra.walls[a.wall], a.offset, 0.7); pts.push(new THREE.Vector3(p.x, 0, p.z)); }
        if (b) { const p = pointOnWall(rb.walls[b.wall], b.offset, 0.7); pts.push(new THREE.Vector3(p.x, 0, p.z)); }
      }
    }
    pts.push(target.clone().setY(0));
    this.path = pts;
    this.arriveArt = art;
    this.stuck = 0;
  }

  walkToArtwork(id: string) {
    const a = this.built.artworks.find((x) => x.id === id);
    if (a) this.walkTo(a.viewpoint, a);
  }

  walkToRoom(id: string) {
    const r = this.built.plan.rooms.find((x) => x.room.id === id);
    if (r) this.walkTo(new THREE.Vector3(r.centre.x, 0, r.centre.z));
  }

  private route(a: string, b: string): string[] {
    const prev = new Map<string, string>([[a, '']]);
    const q = [a];
    while (q.length) {
      const cur = q.shift()!;
      if (cur === b) break;
      for (const d of this.built.plan.doors) if (d.roomId === cur && d.to && !prev.has(d.to)) { prev.set(d.to, cur); q.push(d.to); }
    }
    if (!prev.has(b)) return [a, b];
    const out = [b];
    while (out[0] !== a) out.unshift(prev.get(out[0])!);
    return out;
  }

  private faceArt(a: ArtworkInstance, snap = false) {
    const yaw = Math.atan2(a.normal.x, a.normal.z);
    if (snap) { this.yaw = yaw; this.pitch = 0.02; }
    this.targetYaw = yaw;
  }
  private targetYaw?: number;

  // ---------- input ----------
  private pick(x: number, y: number): { art?: ArtworkInstance; label?: boolean; door?: boolean; floor?: THREE.Vector3 } {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hits = this.ray.intersectObjects([...this.pictures, ...this.built.floors, ...this.built.occluders], false);
    const hit = hits[0];
    if (!hit) return {};
    if (hit.object.userData.entrance) return { door: true };
    const id = hit.object.userData.artworkId as string | undefined;
    if (id) return { art: this.built.artworks.find((a) => a.id === id), label: !!hit.object.userData.label };
    if (this.built.floors.includes(hit.object as THREE.Mesh)) return { floor: hit.point };
    return {};
  }

  private tap(x: number, y: number) {
    const { art, label, door, floor } = this.pick(x, y);
    const e = this.built.entrance;
    if (door && e) {
      // from across the room the first click walks to the door; from close by it opens
      if (e.inside.distanceTo(this.position) > 2.6) { this.walkTo(e.inside); this.targetYaw = Math.atan2(e.normal.x, e.normal.z); }
      else this.ev.onExit?.(e.url);
    } else if (art && label) {
      this.select(art.id, 'none');
      this.ev.onLabel?.(art.id);
    } else if (art) {
      const close = art.viewpoint.distanceTo(this.position) < 2.2 || art.centre.distanceTo(this.camera.position) < 4.5;
      this.select(art.id, close ? 'none' : 'walk');
    } else {
      if (this.selected) this.select(undefined);
      if (floor) this.walkTo(floor);
    }
  }

  private setHover(a: ArtworkInstance | undefined) {
    if (a === this.hovered) return;
    if (this.hovered && this.hovered !== this.selected) this.hovered.highlight.visible = false;
    this.hovered = a;
    if (a) a.highlight.visible = true;
  }

  private hover(e: PointerEvent) {
    if (e.buttons || this.lobby) return;
    const { art, label, door } = this.pick(e.clientX, e.clientY);
    this.setHover(art);
    const ent = this.built.entrance;
    if (ent) ent.leaf.material.emissiveIntensity = door ? 0.35 : 0;
    this.renderer.domElement.style.cursor = art ? (label ? 'zoom-in' : 'pointer') : door ? 'pointer' : '';
    this.renderer.domElement.title = art ? (label ? `Read the label: ${art.art.title}` : `${art.art.title} — ${art.art.artist.name}`) : door && ent ? `Leave through the door: ${ent.url}` : '';
  }

  private key(k: string, e: KeyboardEvent) {
    if (k === 'q' || k === 'e') {
      // snap turn by 45°
      const base = this.targetYaw ?? this.yaw;
      this.targetYaw = base + (k === 'q' ? 1 : -1) * (Math.PI / 4);
    } else if (k === ' ' || k === 'tab') {
      const a = this.hovered ?? this.near;
      if (a) { e.preventDefault(); this.select(this.selected === a ? undefined : a.id); }
    } else if (k === 'enter') {
      const a = this.selected ?? this.near;
      if (a) this.ev.onOpen?.(a.id);
    } else if (k === 'l') {
      const a = this.selected ?? this.hovered ?? this.near;
      if (a) this.ev.onLabel?.(a.id);
    } else if (k === 'escape' && this.zoomed) this.resetZoom();
    else if (k === 'escape' && this.selected) this.select(undefined);
    this.ev.onKey?.(k);
  }

  /** is a straight hop from here to p free of walls? */
  private clearLine(p: THREE.Vector3): boolean {
    const a = this.position;
    for (const s of this.built.segments) {
      const d1x = p.x - a.x, d1z = p.z - a.z, d2x = s.b.x - s.a.x, d2z = s.b.z - s.a.z;
      const den = d1x * d2z - d1z * d2x;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((s.a.x - a.x) * d2z - (s.a.z - a.z) * d2x) / den;
      const u = ((s.a.x - a.x) * d1z - (s.a.z - a.z) * d1x) / den;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) return false;
    }
    return true;
  }

  private aim(phase: 'start' | 'move' | 'end' | 'cancel', x: number, y: number) {
    if (phase === 'cancel') { this.marker.hide(); this.aimTarget = undefined; return; }
    if (phase === 'end') {
      const t = this.aimTarget;
      this.marker.hide();
      this.aimTarget = undefined;
      if (t && this.marker.valid) {
        const fixed = resolveCollision({ x: t.x, z: t.z }, RADIUS, this.built.segments);
        this.path = [];
        this.vel.set(0, 0, 0);
        this.position.set(fixed.x, 0, fixed.z);
        this.resetZoom();
        this.ev.onTeleport?.();
      }
      return;
    }
    const { floor } = this.pick(x, y);
    const hand = this.position.clone().add(new THREE.Vector3(0, EYE - 0.45, 0));
    if (!floor) { this.aimTarget = undefined; this.marker.hide(); return; }
    const valid = floor.distanceTo(this.position) < 12 && this.clearLine(floor);
    this.aimTarget = floor;
    this.marker.aim(hand, floor.clone().setY(0.01), valid);
  }

  // ---------- frame ----------
  private frame() {
    this.clock.update();
    const dt = Math.min(0.1, this.clock.getDelta());
    const t = this.clock.getElapsed();
    const pos = this.body.position;
    this.marker.update(dt);
    if (this.lobby) { this.lobbyFrame(dt); return; }

    // look
    const look = this.input.consumeLook();
    // looking around slows down while zoomed in, so the view doesn't jump
    const sens = this.camera.fov / FOV;
    this.yaw -= look.x * 0.005 * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch - look.y * 0.004 * sens, -1.1, 1.1);
    if (look.x || look.y) this.targetYaw = undefined;
    const zoom = this.input.consumeZoom();
    // the wheel zooms the view like binoculars
    if (zoom) this.fovTarget = THREE.MathUtils.clamp(this.fovTarget * Math.pow(1.3, zoom), FOV_MIN, FOV);
    if (Math.abs(this.camera.fov - this.fovTarget) > 0.01) {
      this.camera.fov += (this.fovTarget - this.camera.fov) * Math.min(1, dt * 12);
      this.camera.updateProjectionMatrix();
    }
    const k = this.input.keys;
    const turn = (k.has('arrowleft') ? 1 : 0) - (k.has('arrowright') ? 1 : 0);
    if (turn) { this.yaw += turn * dt * 1.8; this.targetYaw = undefined; }
    if (this.targetYaw !== undefined) {
      const d = Math.atan2(Math.sin(this.targetYaw - this.yaw), Math.cos(this.targetYaw - this.yaw));
      this.yaw += d * Math.min(1, dt * 9);
      if (Math.abs(d) < 0.002) { this.yaw = this.targetYaw; this.targetYaw = undefined; }
    }

    // move
    const mv = this.input.move();
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const want = new THREE.Vector3();
    if (mv.f || mv.r) {
      this.path = [];
      this.arriveArt = undefined;
      want.addScaledVector(fwd, mv.f).addScaledVector(right, mv.r);
      if (want.lengthSq() > 1) want.normalize();
      want.multiplyScalar(mv.run ? RUN : WALK);
    } else if (this.path.length) {
      const next = this.path[0];
      const to = next.clone().sub(pos).setY(0);
      const d = to.length();
      if (d < (this.path.length > 1 ? 0.35 : 0.08)) {
        this.path.shift();
        if (!this.path.length && this.arriveArt) { this.faceArt(this.arriveArt); this.arriveArt = undefined; }
      } else want.copy(to.normalize().multiplyScalar(Math.min(this.path.length > 1 ? RUN * 0.8 : WALK * 1.3, d * 3 + 0.4)));
    }
    this.vel.lerp(want, Math.min(1, dt * 10));
    const before = pos.clone();
    const next = pos.clone().addScaledVector(this.vel, dt);
    const fixed = resolveCollision({ x: next.x, z: next.z }, RADIUS, this.built.segments);
    pos.set(fixed.x, 0, fixed.z);
    const speed = pos.distanceTo(before) / Math.max(dt, 1e-4);
    this.body.rotation.y = this.yaw + Math.PI; // the torch points where the visitor looks
    if (this.path.length && speed < 0.05 && want.lengthSq() > 0.01) { if ((this.stuck += dt) > 0.8) { this.path = []; this.arriveArt = undefined; } }
    else this.stuck = 0;

    // camera
    this.camera.position.set(pos.x, EYE, pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

    // room + nearby artwork
    const r = roomAt(this.built.plan, pos);
    if (r && r !== this.room) { this.room = r; this.ev.onRoom?.(r); }
    if ((this.nearTimer += dt) > 0.15) {
      this.nearTimer = 0;
      let best: ArtworkInstance | undefined, bestScore = Infinity;
      const look = fwd;
      for (const a of this.built.artworks) {
        const to = a.centre.clone().sub(pos).setY(0);
        const d = to.length();
        if (d > Math.max(3.2, a.hung.outerW * 1.4)) continue;
        if (to.dot(a.normal) > 0) continue; // behind the wall plane
        const facingScore = 1 - to.normalize().dot(look);
        const score = d + facingScore * 2.5;
        if (score < bestScore && facingScore < 1.1) { bestScore = score; best = a; }
      }
      if (best !== this.near) { this.near = best; this.ev.onNear?.(best); }
    }

    this.lighting.update(pos, dt);
    this.draw(dt);
  }

  private lobbyFrame(dt: number) {
    this.lobbyT += this.opts.orbit ? dt : 0;
    const first = this.built.plan.rooms[0];
    const R = Math.min(first.room.width, first.room.depth) * 0.36;
    const a = this.lobbyT * 0.07 + 0.6;
    this.camera.position.set(first.centre.x + Math.sin(a) * R, Math.min(first.room.height - 0.4, 2.3), first.centre.z + Math.cos(a) * R);
    this.camera.lookAt(first.centre.x, 1.5, first.centre.z);
    this.lighting.update(this.camera.position, dt);
    this.draw(dt);
  }

  /** render a single frame (e.g. when paused behind an overlay) */
  renderOnce() { this.draw(0); }

  /** outdoors first, then the rooms over it with a fresh depth buffer (the visitor is always indoors) */
  private draw(dt: number) {
    this.outdoors.update(dt);
    this.lighting.setOutside(this.outdoors.state, this.outdoors.flash);
    this.renderer.clear();
    this.outdoors.render(this.camera);
    this.renderer.clearDepth();
    this.renderer.toneMappingExposure = this.lighting.exposure;
    this.renderer.render(this.scene, this.camera);
  }
}
