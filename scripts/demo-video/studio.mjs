// Part 2 of the demo video: the studio. It is run by the studio itself through its capture hook:
//   VERNISSAGE_CAPTURE=scripts/demo-video/studio.mjs VERNISSAGE_SIZE=1920x1080 DEMO_PROJECT=<folder> DEMO_OUT=<out.mp4> electron packages/studio
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { byText, bySel, caption, captionOff, centre, click, clickAt, cursorAt, drag, ease, hideCursor, moveTo, overlay, pretendClick, raise, recorder, reveal, ripple, sleep, snap, title, titleOff, type } from './lib.mjs';

const project = process.env.DEMO_PROJECT, out = process.env.DEMO_OUT;
const dry = !!process.env.DEMO_DRY, until = process.env.DEMO_UNTIL;
const shots = join(dirname(out), 'shots'); mkdirSync(shots, { recursive: true });

export default async function ({ win, app }) {
  const wc = win.webContents;
  const js = (code) => wc.executeJavaScript(code);
  wc.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) console.log('[page]', e.message); });
  await sleep(2500);
  const Z = 1.2;
  await overlay(wc, { captionAt: 'right', zoom: Z });
  await js(`window.addEventListener('error', (e) => console.error('STACK ' + (e.error?.stack ?? e.message)))`);
  // the album's address stays private; the folder names of this computer are of no interest
  await wc.insertCSS('.album-picker .row input { filter: blur(9px); } .report .muted.small, .report h3, .report ul { display: none; }');

  /** the live preview: its frame, and where a point of its 3D room is on the screen */
  const preview = () => wc.mainFrame.frames.find((f) => f.url.includes('/preview/'));
  const inPreview = async (expr) => {
    const box = await js(`(() => { const r = document.querySelector('iframe').getBoundingClientRect(); return { x: r.left, y: r.top }; })()`);
    const p = await preview().executeJavaScript(`(() => { const g = window.__vernissage.g3d; const v = (${expr})(g); if (!v) return null; g.camera.updateMatrixWorld(); const q = v.clone().project(g.camera); return { x: (q.x + 1) / 2 * innerWidth, y: (1 - q.y) / 2 * innerHeight }; })()`);
    return p && { x: (box.x + p.x) * Z, y: (box.y + p.y) * Z, ix: p.x, iy: p.y };
  };
  // Mouse input sent to the window does not reach the preview's frame, so the preview is handled from inside:
  // the cursor is drawn where it would be, and the pointer events are raised on the preview's own canvas.
  const pv = (code) => preview().executeJavaScript(code);
  const pvEvent = (kind, ix, iy, down) => pv(`(() => { const c = document.querySelector('canvas.gl'); c.setPointerCapture = () => {}; c.dispatchEvent(new PointerEvent('${kind}', { bubbles: true, clientX: ${ix}, clientY: ${iy}, pointerId: 9, button: 0, buttons: ${down ? 1 : 0}, pointerType: 'mouse' })); })()`);
  const outer = async (ix, iy) => { const b = await js(`(() => { const r = document.querySelector('iframe').getBoundingClientRect(); return { x: r.left, y: r.top }; })()`); return { x: (b.x + ix) * Z, y: (b.y + iy) * Z }; };
  async function pvClick(ix, iy, ms = 900) {
    const o = await outer(ix, iy);
    await moveTo(wc, o.x, o.y, ms);
    await sleep(140);
    void ripple(wc, o.x, o.y);
    await pvEvent('pointerdown', ix, iy, true);
    await sleep(70);
    await pvEvent('pointerup', ix, iy, false);
    await sleep(150);
  }
  async function pvDrag(ix1, iy1, ix2, iy2, ms = 2200) {
    const a = await outer(ix1, iy1), b = await outer(ix2, iy2);
    await moveTo(wc, a.x, a.y, 800);
    await sleep(120);
    await pvEvent('pointerdown', ix1, iy1, true);
    const t0 = Date.now();
    for (;;) {
      const k = Math.min(1, (Date.now() - t0) / ms), e = ease(k);
      await cursorAt(wc, a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e);
      await pvEvent('pointermove', ix1 + (ix2 - ix1) * e, iy1 + (iy2 - iy1) * e, true);
      if (k >= 1) break;
      await sleep(16);
    }
    await pvEvent('pointerup', ix2, iy2, false);
    await sleep(120);
  }
  /** stand somewhere in the preview and look a certain way (the turn is shown) */
  const pvStand = async (x, z, yaw) => { await pv(`(() => { const g = window.__vernissage.g3d; g.select(undefined); g.teleportTo(${x}, ${z}); g.targetYaw = ${yaw}; })()`); await sleep(900); };
  const previewReady = async () => { for (let i = 0; i < 60; i++) { try { if (await preview()?.executeJavaScript(`!!window.__vernissage?.g3d`)) break; } catch { /* not there yet */ } await sleep(250); }
    // the captions sit where the gallery puts its own short notices
    await preview().executeJavaScript(`document.head.append(Object.assign(document.createElement('style'), { textContent: '.notifications { display: none !important; }' }))`);
    await sleep(2600);
  };
  const nav = (name) => click(wc, byText('button', new RegExp(`^${name}`)), 800);

  const rec = dry ? null : recorder(win, out);
  let n = 0;
  const scene = async (name, f) => {
    if (scene.done) return;
    console.log(`scene ${name}${rec ? ` @ ${rec.seconds().toFixed(1)}s` : ''}`);
    try { await f(); } catch (e) { console.log(`   !! ${name}: ${e.message}`); }
    await snap(win, join(shots, `s${String(++n).padStart(2, '0')}-${name}.jpg`));
    if (until === name) scene.done = true;
  };

  // the film opens on the title card
  await title(wc, { kicker: 'Vernissage Studio', title: 'Build it yourself.<br>No code.', text: 'A desktop app for Windows, macOS and Linux.' });
  await rec?.start();

  await scene('title', async () => {
    await sleep(4200);
    await titleOff(wc);
  });

  await scene('start', async () => {
    await caption(wc, 'Start from scratch, an album or a demo', 'A Google Photos album becomes a gallery in one step.');
    const a = await centre(wc, bySel('input[aria-label^="Link of a shared"]'));
    await moveTo(wc, a.x, a.y, 1200);
    await sleep(1800);
    await pretendClick(wc, byText('button', /^Open project folder/), 1000);
    wc.send('menu', `open:${project}`);
    await sleep(1200);
  });

  await scene('overview', async () => {
    await caption(wc, 'Edit on the left, walk it on the right', 'The preview is the real gallery, live.');
    // the preview takes a while to load the full-size pictures: that wait is cut from the film
    const a = rec?.seconds() ?? 0;
    await previewReady();
    if (rec) console.log(`CUT ${(a + 1.2).toFixed(2)} ${(rec.seconds() - 1.6).toFixed(2)}`);
    await pvDrag(560, 300, 250, 315, 2600);
    await sleep(300);
    await pvDrag(250, 315, 520, 300, 2200);
    await sleep(500);
  });

  await scene('artworks', async () => {
    await nav('Artworks');
    await caption(wc, 'Add pictures, write their labels');
    await sleep(700);
    for (const i of [4, 9, 0]) { await click(wc, `() => document.querySelectorAll('.lib-strip button')[${i}]`, 650); await sleep(650); }
    await click(wc, byText('button', /^Show in preview/), 800);
    await sleep(1800);
    const area = bySel('.lib-card textarea');
    await click(wc, area, 800);
    await type(wc, area, 'A wet January night on Queen Street.');
    await sleep(1600);
  });

  await scene('album', async () => {
    await caption(wc, 'Pull new photos from your album', 'Tick what you want. Nothing you edited is touched.');
    await click(wc, byText('button', /Add from Photos album/), 900);
    await sleep(350);
    await raise(wc); // the dialog opened in front of the caption
    for (let i = 0; i < 60 && !(await js(`!!document.querySelector('.ap-grid li')`)); i++) await sleep(250);
    await sleep(1200);
    const g = await centre(wc, bySel('.ap-grid'));
    await moveTo(wc, g.x - 180, g.y - 60, 900);
    await sleep(500);
    await moveTo(wc, g.x + 160, g.y + 40, 1100);
    await sleep(1300);
    await click(wc, byText('.album-picker button', /^Cancel/), 800);
    await sleep(500);
  });

  await scene('walls', async () => {
    await nav('Walls');
    await caption(wc, 'Hang the works', 'Sized and spaced to suit each wall. Fine-tune by hand.');
    await sleep(600);
    await pvStand(1.2, -0.6, Math.PI / 2); // both pictures of the west wall in view
    await reveal(wc, bySel('[data-side="west"]'), 'start');
    await sleep(700);
    const s = await centre(wc, bySel('[data-side="west"] input[type=range]'));
    await drag(wc, s.x - 4, s.y, s.x + 34, s.y, 1500);
    await sleep(1400);
    await drag(wc, s.x + 34, s.y, s.x + 10, s.y, 1100);
    await sleep(900);
    await click(wc, bySel('[data-side="west"] [aria-label="Move right"]'), 800);
    await sleep(1800);
  });

  await scene('click-to-edit', async () => {
    await caption(wc, 'Click in the preview to edit it', 'A picture opens its label, a wall opens its hanging.');
    const p = await inPreview(`(g) => g.built.artworks.find((a) => a.id === 'p2193206-nik')?.picture.getWorldPosition(new (g.camera.position.constructor)())`);
    await pvClick(p.ix, p.iy, 1100);
    await sleep(2400);
    // and a bare piece of the wall, above the pictures
    const w = await inPreview(`(g) => new (g.camera.position.constructor)(-6, 3.7, -0.4)`);
    await pvClick(w.ix, w.iy, 1000);
    await sleep(2400);
  });

  await scene('rooms', async () => {
    await nav('Rooms');
    await caption(wc, 'Lay out the rooms', 'Drag them on the floor plan. Doorways appear where rooms meet.');
    await sleep(900);
    await click(wc, byText('button', /^\+ Add room/), 900);
    await sleep(1300);
    const r = await centre(wc, `() => [...document.querySelectorAll('.plan g.room')].pop()`);
    await drag(wc, r.x, r.y, r.x - 150, r.y - 120, 2200);
    await sleep(1500);
  });

  await scene('details', async () => {
    await click(wc, `() => document.querySelector('.plan g.room')`, 800);
    await pvStand(2.2, -2.9, Math.PI - 0.38); // looking back at the door, the pinboard beside it and the floor between
    await caption(wc, 'Add the details', 'A pinboard with photos and notes, plants where you want them.');
    await reveal(wc, bySel('.pin-head'), 'start');
    await sleep(1800);
    await reveal(wc, bySel('.plants-plan'));
    const f = await centre(wc, bySel('.plants-plan .floor'));
    await clickAt(wc, f.x - 62, f.y + 22, 900);
    await sleep(900);
    await clickAt(wc, f.x + 14, f.y + 58, 800);
    await sleep(1500);
  });

  await scene('light', async () => {
    await nav('Gallery');
    await pvStand(2.5, 1.2, Math.PI / 2 + 0.35);
    await caption(wc, 'Set the mood', 'Five kinds of light, from daylight to a night tour.');
    await reveal(wc, bySel('.style-card'));
    for (const name of ['Evening spots', 'Chiaroscuro', 'Daylight']) {
      await click(wc, `() => [...document.querySelectorAll('.style-card')].find((c) => c.querySelector('strong')?.textContent.trim() === '${name}')`, 800);
      await sleep(2300);
    }
  });

  await scene('build', async () => {
    await nav('Build');
    await caption(wc, 'One click builds the website', 'Plain files. Upload them to any web host.');
    // show a tidy folder name instead of this computer's
    await js(`(() => { const i = document.querySelector('input[readonly]'); if (i) i.value = '~/Sites/toronto-gallery'; })()`);
    await sleep(1400);
    await click(wc, byText('button', /^(Save and build|Build website)/), 900);
    for (let i = 0; i < 120 && !(await js(`!!document.querySelector('.report')`)); i++) { await js(`(() => { const i = document.querySelector('input[readonly]'); if (i && !i.value.startsWith('~')) i.value = '~/Sites/toronto-gallery'; })()`); await sleep(150); }
    await js(`(() => { const i = document.querySelector('input[readonly]'); if (i) i.value = '~/Sites/toronto-gallery'; })()`);
    await sleep(3200);
  });

  await scene('end', async () => {
    await captionOff(wc);
    await hideCursor(wc);
    await title(wc, { kicker: 'Free and open source', title: 'Vernissage', text: 'github.com/dirkprimbs/vernissage', chips: ['Windows', 'macOS', 'Linux'] });
    await sleep(5200);
  });

  const secs = await rec?.stop();
  console.log(rec ? `recorded ${secs.toFixed(1)} s → ${out}` : 'dry run done');
  app.exit(0);
}
