import * as THREE from 'three';

/** Parabolic pointer arc and landing ring for teleporting. */
export class TeleportMarker {
  readonly group = new THREE.Group();
  private line: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>;
  private ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private disc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private readonly N = 40;
  private t = 0;
  valid = false;

  constructor(private color: string) {
    this.line = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(), new THREE.Vector3(0, 0.01, 0)), 2, 0.012, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthTest: false }));
    this.line.renderOrder = 7;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.4, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }));
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(0.32, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false }));
    for (const m of [this.ring, this.disc]) { m.rotation.x = -Math.PI / 2; m.renderOrder = 7; }
    this.ring.position.y = 0.012;
    this.disc.position.y = 0.011;
    this.group.add(this.line, this.ring, this.disc);
    this.group.visible = false;
  }

  setColor(color: string) { this.color = color; this.line.material.color.set(color); this.ring.material.color.set(color); this.disc.material.color.set(color); }

  aim(from: THREE.Vector3, to: THREE.Vector3, valid: boolean) {
    this.valid = valid;
    this.group.visible = true;
    const d = from.distanceTo(to);
    const apex = Math.max(0.4, d * 0.28);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < this.N; i++) {
      const k = i / (this.N - 1);
      pts.push(new THREE.Vector3(THREE.MathUtils.lerp(from.x, to.x, k), THREE.MathUtils.lerp(from.y, to.y, k) + Math.sin(Math.PI * k) * apex, THREE.MathUtils.lerp(from.z, to.z, k)));
    }
    this.line.geometry.dispose();
    this.line.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), this.N, 0.012, 6);
    this.line.material.color.set(valid ? this.color : '#f5325c');
    this.ring.position.x = this.disc.position.x = to.x;
    this.ring.position.z = this.disc.position.z = to.z;
    this.ring.visible = this.disc.visible = valid;
  }

  hide() { this.group.visible = false; }

  update(dt: number) {
    if (!this.group.visible) return;
    this.t += dt;
    const s = 1 + Math.sin(this.t * 6) * 0.06;
    this.ring.scale.set(s, s, 1);
  }
}
