// Tools for recording the demo video: a screen recorder for an offscreen Electron window, captions and title
// cards drawn in the page, and a visible cursor that moves, clicks and drags like a person would.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const font = (weight) => readFileSync(fileURLToPath(new URL(`../../node_modules/@fontsource/poppins/files/poppins-latin-${weight}-normal.woff2`, import.meta.url))).toString('base64');

/** Record a window's picture into an mp4 at a steady frame rate, until stop() is called. */
export function recorder(win, file, fps = 30) {
  const wc = win.webContents;
  wc.setFrameRate(fps);
  let last, size, ff, written = 0, t0 = 0, timer;
  const onPaint = (_e, _dirty, image) => { size ??= image.getSize(); last = image.toBitmap(); };
  wc.on('paint', onPaint);
  return {
    async start() {
      wc.invalidate();
      while (!last) await sleep(30);
      ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${size.width}x${size.height}`, '-r', String(fps), '-i', '-',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', '-vf', 'scale=1920:1080:flags=lanczos', file], { stdio: ['pipe', 'inherit', 'inherit'] });
      t0 = Date.now();
      // as many frames as the clock asks for: a slow moment repeats the last picture instead of shortening the film
      timer = setInterval(() => { const due = Math.floor(((Date.now() - t0) / 1000) * fps); while (written < due) { ff.stdin.write(last); written++; } }, 1000 / fps / 2);
    },
    seconds: () => written / fps,
    async stop() {
      clearInterval(timer);
      wc.off('paint', onPaint);
      await new Promise((r) => { ff.on('close', r); ff.stdin.end(); });
      return written / fps;
    },
  };
}

/** a page shown enlarged (the studio's small type reads better at 120 %): its zoom factor */
const zooms = new WeakMap();
const zoomOf = (wc) => zooms.get(wc) ?? 1;

/** Put the caption layer and the cursor into a page. `zoom`: show the page enlarged by this factor. */
export async function overlay(wc, { captionAt = 'left', zoom = 1 } = {}) {
  zooms.set(wc, zoom);
  wc.setZoomFactor(zoom);
  await wc.insertCSS(`
    /* the layer keeps its own size whatever the page's zoom: one of its pixels is one pixel of the film */
    #demo-layer { zoom: ${1 / zoom}; }
    @font-face { font-family: 'DemoSans'; font-weight: 400; src: url(data:font/woff2;base64,${font(400)}) format('woff2'); }
    @font-face { font-family: 'DemoSans'; font-weight: 600; src: url(data:font/woff2;base64,${font(600)}) format('woff2'); }
    #demo-layer, #demo-layer * { box-sizing: border-box; font-family: 'DemoSans', system-ui, sans-serif; }
    /* a popover, so that it can be brought in front of a dialog the page opens (see raise) */
    #demo-layer { position: fixed; inset: 0; width: auto; height: auto; margin: 0; padding: 0; border: 0; background: none; color: inherit; overflow: visible; z-index: 2147483000; pointer-events: none; }
    #demo-cap { position: absolute; bottom: 132px; ${captionAt === 'right' ? 'right: 44px;' : captionAt === 'center' ? 'left: 50%; margin-left: -400px; width: 800px;' : 'left: 44px;'} max-width: 800px; padding: 18px 26px 19px 30px;
      background: rgba(16, 17, 21, .86); border: 1px solid rgba(255, 255, 255, .14); border-radius: 18px; color: #fff; box-shadow: 0 18px 50px rgba(0, 0, 0, .35);
      opacity: 0; transform: translateY(14px); transition: opacity .5s ease, transform .5s cubic-bezier(.2, .8, .3, 1); }
    #demo-cap::before { content: ''; position: absolute; left: 12px; top: 18px; bottom: 18px; width: 4px; border-radius: 2px; background: #ff8a1f; }
    #demo-cap.on { opacity: 1; transform: none; }
    #demo-cap b { display: block; font-weight: 600; font-size: 31px; line-height: 1.22; letter-spacing: -.01em; }
    #demo-cap span { display: block; margin-top: 5px; font-weight: 400; font-size: 21px; line-height: 1.35; color: rgba(255, 255, 255, .74); }
    #demo-title { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 18px; text-align: center; background: #101115; color: #fff; opacity: 0; transition: opacity .7s ease; }
    #demo-title.on { opacity: 1; }
    #demo-title.veil { background: rgba(16, 17, 21, .72); backdrop-filter: blur(14px); }
    #demo-title small { font-weight: 600; font-size: 22px; letter-spacing: .28em; text-transform: uppercase; color: #ff8a1f; }
    #demo-title h1 { margin: 0; font-weight: 600; font-size: 92px; line-height: 1.04; letter-spacing: -.025em; }
    #demo-title p { margin: 0; max-width: 1100px; font-weight: 400; font-size: 34px; line-height: 1.35; color: rgba(255, 255, 255, .78); }
    #demo-title .row { display: flex; gap: 14px; margin-top: 10px; }
    #demo-title .row i { font-style: normal; font-weight: 600; font-size: 22px; padding: 9px 20px; border-radius: 999px; border: 1px solid rgba(255, 255, 255, .25); color: rgba(255, 255, 255, .9); }
    #demo-title > * { opacity: 0; transform: translateY(16px); transition: opacity .7s ease .15s, transform .8s cubic-bezier(.2, .8, .3, 1) .15s; }
    #demo-title.on > * { opacity: 1; transform: none; }
    #demo-title.on > :nth-child(2) { transition-delay: .3s; } #demo-title.on > :nth-child(3) { transition-delay: .5s; } #demo-title.on > :nth-child(4) { transition-delay: .7s; }
    #demo-cur { position: absolute; left: 0; top: 0; width: 34px; height: 34px; margin: -3px 0 0 -5px; filter: drop-shadow(0 3px 5px rgba(0, 0, 0, .45)); opacity: 0; transition: opacity .3s; will-change: transform; }
    #demo-cur.on { opacity: 1; }
    #demo-ring { position: absolute; left: 0; top: 0; width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 50%; border: 3px solid #ff8a1f; opacity: 0; }
    #demo-ring.go { animation: demo-ring .55s ease-out; }
    @keyframes demo-ring { from { opacity: .95; scale: .25; } to { opacity: 0; scale: 1.15; } }
  `);
  await wc.executeJavaScript(`(() => {
    document.getElementById('demo-layer')?.remove();
    const l = document.createElement('div'); l.id = 'demo-layer';
    l.innerHTML = '<div id="demo-cap"><b></b><span></span></div><div id="demo-title"></div><div id="demo-ring"></div>' +
      '<svg id="demo-cur" viewBox="0 0 34 34"><path d="M6 4 L6 27 L12.2 21.4 L16.4 30.6 L20.4 28.8 L16.3 19.8 L24.6 19.8 Z" fill="#fff" stroke="#111" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    l.popover = 'manual';
    document.documentElement.append(l);
    l.showPopover();
  })()`);
}

const js = (wc, code) => wc.executeJavaScript(code);

/** Bring the captions and the cursor in front of a dialog the page has just opened. */
export const raise = (wc) => js(wc, `(() => { const l = document.getElementById('demo-layer'); l.hidePopover(); l.showPopover(); })()`);

/** Show a caption (a headline, and optionally a quieter second line). */
export async function caption(wc, text, sub = '') {
  await js(wc, `(async () => {
    const c = document.getElementById('demo-cap');
    if (c.classList.contains('on')) { c.classList.remove('on'); await new Promise((r) => setTimeout(r, 420)); }
    c.querySelector('b').textContent = ${JSON.stringify(text)};
    const s = c.querySelector('span'); s.textContent = ${JSON.stringify(sub)}; s.style.display = ${JSON.stringify(sub)} ? '' : 'none';
    c.getBoundingClientRect(); c.classList.add('on');
  })()`);
}
export const captionOff = (wc) => js(wc, `document.getElementById('demo-cap').classList.remove('on')`);

/** A title card. `veil`: let the page show through, blurred. Returns once it is fully shown. */
export async function title(wc, { kicker = '', title: head, text = '', chips = [] }, veil = false) {
  await js(wc, `(() => {
    const t = document.getElementById('demo-title');
    t.className = ${veil} ? 'veil' : '';
    t.innerHTML = ${JSON.stringify(`${kicker ? `<small>${kicker}</small>` : ''}<h1>${head}</h1>${text ? `<p>${text}</p>` : ''}${chips.length ? `<div class="row">${chips.map((c) => `<i>${c}</i>`).join('')}</div>` : ''}`)};
    t.getBoundingClientRect(); t.classList.add('on');
  })()`);
  await sleep(900);
}
export async function titleOff(wc) { await js(wc, `document.getElementById('demo-title').classList.remove('on')`); await sleep(750); }

// ---- the cursor: drawn in the page, with real mouse events sent along its way ----
const pos = new WeakMap();
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const cursorAt = (wc, x, y) => { pos.set(wc, { x, y }); return place(wc, x, y); };
export const ripple = (wc, x, y) => ring(wc, x, y);
export const lastCursor = (wc) => pos.get(wc) ?? { x: 960, y: 620 };
export { ease };
const place = (wc, x, y) => js(wc, `(() => { const c = document.getElementById('demo-cur'); if (c) { c.classList.add('on'); c.style.transform = 'translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)'; } })()`);

/** Move the cursor to a point, along a slightly curved path. `buttons`: hold the left button on the way (a drag). */
export async function moveTo(wc, x, y, ms = 800, held = false) {
  const from = pos.get(wc) ?? { x: 960, y: 620 };
  const bend = held ? 0 : Math.min(60, Math.hypot(x - from.x, y - from.y) * 0.12);
  const t0 = Date.now();
  for (;;) {
    const k = Math.min(1, (Date.now() - t0) / ms), e = ease(k);
    const px = from.x + (x - from.x) * e, py = from.y + (y - from.y) * e - Math.sin(Math.PI * e) * bend;
    wc.sendInputEvent({ type: 'mouseMove', x: Math.round(px), y: Math.round(py), ...(held ? { button: 'left', modifiers: ['leftButtonDown'] } : {}) });
    await place(wc, px, py);
    if (k >= 1) break;
    await sleep(16);
  }
  pos.set(wc, { x, y });
}
export const hideCursor = (wc) => js(wc, `document.getElementById('demo-cur')?.classList.remove('on')`);

const ring = (wc, x, y) => js(wc, `(() => { const r = document.getElementById('demo-ring'); r.style.transform = 'translate(${x}px, ${y}px)'; r.classList.remove('go'); r.getBoundingClientRect(); r.classList.add('go'); })()`);

/** Click at a point (moving there first). */
export async function clickAt(wc, x, y, ms = 800) {
  await moveTo(wc, x, y, ms);
  await sleep(140);
  void ring(wc, x, y);
  wc.sendInputEvent({ type: 'mouseDown', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  await sleep(70);
  wc.sendInputEvent({ type: 'mouseUp', x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
  await sleep(120);
}

/** Press, move, release: looking around in the gallery, or carrying something. */
export async function drag(wc, x1, y1, x2, y2, ms = 1400, { wheel = 0 } = {}) {
  await moveTo(wc, x1, y1, 700);
  await sleep(120);
  wc.sendInputEvent({ type: 'mouseDown', x: Math.round(x1), y: Math.round(y1), button: 'left', clickCount: 1 });
  await sleep(120);
  if (wheel) {
    // turn what is held, a notch at a time
    for (let i = 0; i < Math.abs(wheel); i++) { wc.sendInputEvent({ type: 'mouseWheel', x: Math.round(x1), y: Math.round(y1), deltaX: 0, deltaY: wheel > 0 ? -100 : 100, canScroll: true }); await sleep(90); }
    await sleep(200);
  }
  await moveTo(wc, x2, y2, ms, true);
  await sleep(140);
  wc.sendInputEvent({ type: 'mouseUp', x: Math.round(x2), y: Math.round(y2), button: 'left', clickCount: 1 });
  await sleep(120);
}

/** The middle of an element in the page, found by a snippet that returns the element. */
export async function centre(wc, find) {
  const r = await js(wc, `(() => { const el = (${find})(); if (!el) return null; el.scrollIntoView?.({ block: 'nearest' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height }; })()`);
  if (!r) throw new Error(`not found: ${find}`);
  const z = zoomOf(wc);
  return { x: r.x * z, y: r.y * z, w: r.w * z, h: r.h * z };
}
/** Click an element found by a snippet, e.g. byText('button', /^Walls/). */
export async function click(wc, find, ms = 800, dx = 0, dy = 0) { const c = await centre(wc, find); await clickAt(wc, c.x + dx, c.y + dy, ms); return c; }
export const byText = (sel, re) => `() => [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => ${re}.test(e.textContent.trim()) && e.getClientRects().length)`;
export const bySel = (sel) => `() => document.querySelector(${JSON.stringify(sel)})`;

/** Scroll an element into the middle of its pane, smoothly, and wait until it is there. */
export async function reveal(wc, find, block = 'center') {
  await js(wc, `(${find})()?.scrollIntoView({ behavior: 'smooth', block: ${JSON.stringify(block)} })`);
  await sleep(750);
}
/** Type into the focused field, a key at a time. */
export async function type(wc, find, text, perKey = 45) {
  for (const ch of text) {
    await js(wc, `(() => { const el = (${find})(); el.value += ${JSON.stringify(ch)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(perKey + Math.random() * 40);
  }
}
/** Show a click without sending one (for buttons that would open a system dialog). */
export async function pretendClick(wc, find, ms = 800) { const c = await centre(wc, find); await moveTo(wc, c.x, c.y, ms); await sleep(140); await ring(wc, c.x, c.y); await sleep(250); }

/** Hold a key for a while (walking). */
export async function hold(wc, keyCode, ms) {
  wc.sendInputEvent({ type: 'keyDown', keyCode });
  await sleep(ms);
  wc.sendInputEvent({ type: 'keyUp', keyCode });
}
/** Save the current picture: for checking a scene while writing it. */
export async function snap(win, file) { const { writeFileSync } = await import('node:fs'); writeFileSync(file, (await win.webContents.capturePage()).toJPEG(80)); }
