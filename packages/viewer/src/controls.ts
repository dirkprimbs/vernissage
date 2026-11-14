import { h } from './dom';

/** Collects keyboard, mouse, wheel and touch input for the 3D view. */
export class Input {
  keys = new Set<string>();
  /** accumulated look deltas in pixels since last frame */
  lookDX = 0;
  lookDY = 0;
  zoom = 0;
  /** -1..1 joystick vector (touch) */
  stick = { x: 0, y: 0 };
  onTap?: (x: number, y: number) => void;
  /** right mouse button / long press: aim a teleport */
  onAim?: (phase: 'start' | 'move' | 'end' | 'cancel', x: number, y: number) => void;
  onKey?: (key: string, e: KeyboardEvent) => void;
  /** a press that may pick something up (a card on a pinboard): return true to take the drag away from looking around */
  onGrab?: (x: number, y: number) => boolean;
  onGrabMove?: (x: number, y: number) => void;
  /** the wheel turned while something is held: one step either way */
  onGrabTurn?: (step: number) => void;
  /** `tap`: the pointer hardly moved, so it was a click on the thing rather than a move */
  onGrabEnd?: (x: number, y: number, tap: boolean) => void;
  /** middle (wheel) button pressed */
  onMiddle?: () => void;
  enabled = true;
  private dragging = false;
  private dragDist = 0;
  private last = { x: 0, y: 0 };
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private stickEl?: HTMLElement;
  private aiming = -1;
  private grabbing = -1;
  private grabDist = 0;
  private longPress = 0;
  private abort = new AbortController();

  constructor(private el: HTMLElement) {
    const sig = { signal: this.abort.signal };
    window.addEventListener('keydown', (e) => {
      if (!this.enabled || (e.target as HTMLElement)?.closest?.('input,textarea,select')) return;
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
      if (!this.keys.has(k)) this.onKey?.(k, e);
      this.keys.add(k);
      if (e.shiftKey) this.keys.add('shift');
    }, sig);
    window.addEventListener('keyup', (e) => { this.keys.delete(e.key.toLowerCase()); if (!e.shiftKey) this.keys.delete('shift'); }, sig);
    window.addEventListener('blur', () => this.keys.clear(), sig);

    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      // wheel press: reset zoom (no capture or drag for the middle button)
      if (e.button === 1) { e.preventDefault(); this.onMiddle?.(); return; }
      el.setPointerCapture(e.pointerId);
      if (e.button === 2 && this.onAim) {
        this.aiming = e.pointerId;
        this.onAim('start', e.clientX, e.clientY);
        return;
      }
      if (e.button === 0 && this.pointers.size === 0 && this.onGrab?.(e.clientX, e.clientY)) {
        this.grabbing = e.pointerId;
        this.grabDist = 0;
        this.last = { x: e.clientX, y: e.clientY };
        return;
      }
      if (e.pointerType === 'touch' && this.onAim) {
        clearTimeout(this.longPress);
        const x = e.clientX, y = e.clientY;
        this.longPress = window.setTimeout(() => {
          if (this.pointers.size === 1 && this.dragDist < 8) { this.aiming = e.pointerId; this.dragging = false; this.onAim?.('start', x, y); }
        }, 450);
      }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.dragging = true;
      this.dragDist = 0;
      this.last = { x: e.clientX, y: e.clientY };
      if (this.pointers.size === 2) this.pinch = this.pinchDist();
    }, sig);
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.aiming) { this.onAim?.('move', e.clientX, e.clientY); return; }
      if (e.pointerId === this.grabbing) {
        this.grabDist += Math.abs(e.clientX - this.last.x) + Math.abs(e.clientY - this.last.y);
        this.last = { x: e.clientX, y: e.clientY };
        if (this.grabDist >= 6) this.onGrabMove?.(e.clientX, e.clientY);
        return;
      }
      if (!this.dragging || !this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const d = this.pinchDist();
        this.zoom -= (d - this.pinch) * 0.01;
        this.pinch = d;
        this.dragDist += 10;
        return;
      }
      const dx = e.clientX - this.last.x, dy = e.clientY - this.last.y;
      this.dragDist += Math.abs(dx) + Math.abs(dy);
      this.lookDX += dx; this.lookDY += dy;
      this.last = { x: e.clientX, y: e.clientY };
    }, sig);
    const up = (e: PointerEvent) => {
      clearTimeout(this.longPress);
      if (e.pointerId === this.grabbing) {
        this.grabbing = -1;
        this.onGrabEnd?.(e.clientX, e.clientY, this.grabDist < 6 && e.type !== 'pointercancel');
        return;
      }
      if (e.pointerId === this.aiming) {
        this.aiming = -1;
        this.pointers.delete(e.pointerId);
        this.dragging = this.pointers.size > 0;
        this.onAim?.(e.type === 'pointercancel' ? 'cancel' : 'end', e.clientX, e.clientY);
        return;
      }
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 0) {
        this.dragging = false;
        if (this.dragDist < 6 && this.enabled) this.onTap?.(e.clientX, e.clientY);
      }
    };
    el.addEventListener('pointerup', up, sig);
    el.addEventListener('pointercancel', (e) => { if (e.pointerId === this.aiming || e.pointerId === this.grabbing) { up(e); return; } clearTimeout(this.longPress); this.pointers.delete(e.pointerId); this.dragging = this.pointers.size > 0; }, sig);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      // while a card is held the wheel turns it; that also makes the press a move, not a click
      if (this.grabbing !== -1) { this.grabDist = Math.max(this.grabDist, 6); this.onGrabTurn?.(Math.sign(e.deltaY)); return; }
      this.zoom += Math.sign(e.deltaY) * 0.5;
    }, { passive: false, signal: this.abort.signal });
    el.addEventListener('contextmenu', (e) => e.preventDefault(), sig);
    // keep the browser's middle-click autoscroll / paste off the canvas
    el.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); }, sig);
    el.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); }, sig);

    if (matchMedia('(pointer: coarse)').matches) this.makeStick();
  }

  private pinchDist() {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private makeStick() {
    const knob = h('div', { class: 'stick-knob' });
    const pad = h('div', { class: 'stick', 'aria-hidden': 'true' }, knob);
    document.body.append(pad);
    this.stickEl = pad;
    let id = -1, cx = 0, cy = 0;
    const R = 50;
    pad.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      id = e.pointerId;
      pad.setPointerCapture(id);
      const r = pad.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.stick = { x: dx / R, y: -dy / R };
    });
    const end = () => { id = -1; knob.style.transform = ''; this.stick = { x: 0, y: 0 }; };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
  }

  /** forward/right movement intent from keys and stick, each -1..1 */
  move(): { f: number; r: number; run: boolean } {
    const k = this.keys;
    let f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    let r = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0);
    if (this.stick.x || this.stick.y) { f = this.stick.y; r = this.stick.x; }
    return { f, r, run: k.has('shift') || Math.hypot(this.stick.x, this.stick.y) > 0.95 };
  }

  consumeLook() { const d = { x: this.lookDX, y: this.lookDY }; this.lookDX = this.lookDY = 0; return d; }
  consumeZoom() { const z = this.zoom; this.zoom = 0; return z; }
  showStick(v: boolean) { if (this.stickEl) this.stickEl.style.display = v ? '' : 'none'; }

  dispose() { this.abort.abort(); this.stickEl?.remove(); }
}
