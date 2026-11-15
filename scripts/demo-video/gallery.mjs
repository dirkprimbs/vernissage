// Part 1 of the demo video: a visit to the gallery. Run with Electron:
//   electron scripts/demo-video/gallery.mjs <built-site-folder> <out.mp4> [--dry] [--until=<scene>]
import { app, BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { byText, bySel, caption, captionOff, centre, click, clickAt, drag, hideCursor, hold, moveTo, overlay, recorder, sleep, snap, title, titleOff } from './lib.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flag = (n) => process.argv.find((a) => a.startsWith(`--${n}`));
const [site, out] = args;
const dry = !!flag('dry'), until = flag('until')?.split('=')[1];
const shots = join(dirname(out), 'shots'); mkdirSync(shots, { recursive: true });
const PORT = 8821;
app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.whenReady().then(async () => {
  const cli = fileURLToPath(new URL('../../packages/generator/dist/cli.js', import.meta.url));
  const server = spawn('node', [cli, 'serve', site, '--port', String(PORT)]);
  await sleep(700);
  const win = new BrowserWindow({ show: false, width: 1920, height: 1080, useContentSize: true, webPreferences: { offscreen: true } });
  const wc = win.webContents;
  const js = (code) => wc.executeJavaScript(code);
  wc.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) console.log('[page]', e.message); });
  await wc.loadURL(`http://127.0.0.1:${PORT}/?capture`);
  await overlay(wc);
  // the captions sit where the gallery puts its own short notices
  await wc.insertCSS('.notifications { display: none !important; }');
  // everything loaded: the entry card is up and the pictures are on the walls
  await js(`new Promise((r) => { const t = setInterval(() => { if (document.querySelector('.entry-card') && window.__vernissage?.g3d) { clearInterval(t); r(); } }, 200); })`);
  await sleep(6000);

  const rec = dry ? null : recorder(win, out);
  let n = 0;
  const scene = async (name, f) => {
    if (scene.done) return;
    console.log(`scene ${name}${rec ? ` @ ${rec.seconds().toFixed(1)}s` : ''}`);
    await f();
    await snap(win, join(shots, `g${String(++n).padStart(2, '0')}-${name}.jpg`));
    if (until === name) scene.done = true;
  };
  /** where something in the 3D room is on the screen */
  const screen = (expr) => js(`(() => { const g = window.__vernissage.g3d; const v = (${expr})(g); if (!v) return null; g.camera.updateMatrixWorld(); const p = v.clone().project(g.camera); return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight, z: p.z }; })()`);
  const artAt = (id) => screen(`(g) => g.built.artworks.find((a) => a.id === ${JSON.stringify(id)})?.picture.getWorldPosition(new (g.camera.position.constructor)())`);
  const labelAt = (id) => screen(`(g) => g.built.artworks.find((a) => a.id === ${JSON.stringify(id)})?.group.children.find((c) => c.userData.label)?.getWorldPosition(new (g.camera.position.constructor)())`);
  const pinAt = (id) => screen(`(g) => g.built.pinboards[0]?.pins.find((p) => p.id === ${JSON.stringify(id)})?.mesh.getWorldPosition(new (g.camera.position.constructor)())`);
  /** a spot of the floor plan on the little map */
  const mapAt = (x, z) => js(`(() => { const c = document.querySelector('.minimap'), m = c._m, r = c.getBoundingClientRect(); return { x: r.left + (${x} * m.s + m.ox) * r.width / c.width, y: r.top + (${z} * m.s + m.oz) * r.height / c.height }; })()`);
  const turnTo = (yaw) => js(`window.__vernissage.g3d.targetYaw = ${yaw}`);
  /** wait until the visitor has arrived and stopped turning */
  const settled = async (max = 9000) => { const t = Date.now(); await sleep(250); while (Date.now() - t < max && await js(`(() => { const g = window.__vernissage.g3d; return g.path.length > 0 || g.targetYaw !== undefined; })()`)) await sleep(100); };
  const where = async (tag) => console.log('  ', tag, await js(`(() => { const g = window.__vernissage.g3d; return JSON.stringify({ x: +g.position.x.toFixed(2), z: +g.position.z.toFixed(2), yaw: +g.heading.toFixed(2), sel: g.selected?.id, path: g.path.length }); })()`));

  // the film opens on the title card, the gallery turning slowly behind it
  await title(wc, { kicker: 'Vernissage', title: 'Your pictures in a gallery<br>you can walk through', text: 'A 3D exhibition that is simply a website.' }, true);
  await rec?.start();

  await scene('title', async () => {
    await sleep(4600);
    await titleOff(wc);
  });

  await scene('lobby', async () => {
    await caption(wc, 'It opens in the browser', 'Nothing to install, no account.');
    await sleep(2600);
    await click(wc, byText('.entry-card button', /Join gallery/), 1100);
    await sleep(1600);
  });

  const floorAt = (x, z) => screen(`(g) => new (g.camera.position.constructor)(${x}, 0, ${z})`);

  await scene('walk', async () => {
    await turnTo(0); // into the room, towards the windows
    await settled();
    await caption(wc, 'Walk through the rooms', 'Drag to look around. Click the floor, or use W A S D, to move.');
    await drag(wc, 1250, 520, 800, 545, 2600);
    await sleep(300);
    await drag(wc, 760, 545, 1330, 525, 3000);
    await sleep(300);
    await turnTo(0);
    await settled();
    const f = await floorAt(0.6, -0.4);
    await clickAt(wc, f.x, f.y, 1000);
    await settled();
    await where('at the centre');
    await sleep(500);
  });

  await scene('approach', async () => {
    await caption(wc, 'Click a picture to walk up to it');
    await turnTo(Math.PI / 2 - 0.25); // towards the west wall
    await settled();
    const p = await artAt('p2193206-nik');
    console.log('   art at', p);
    await clickAt(wc, p.x, p.y, 1100);
    await settled();
    await where('arrived');
    await sleep(1800);
  });

  await scene('label', async () => {
    await caption(wc, 'Every work has its wall label', 'Title, date, medium and its story.');
    const p = await labelAt('p2193206-nik');
    await clickAt(wc, p.x, p.y, 900);
    await sleep(3800);
    await click(wc, bySel('.label-tools button:last-child'), 700);
    await sleep(700);
    await where('label closed');
    await snap(win, join(shots, 'debug-after-label.jpg'));
  });

  await scene('inspect', async () => {
    await caption(wc, 'Look closer', 'Each picture opens full screen.');
    await click(wc, byText('.om-btn', /Inspect/), 900);
    await sleep(4200);
    await click(wc, `() => document.querySelector('.focus-bar [aria-label^="Close"]')`, 800);
    await sleep(900);
  });

  await scene('map', async () => {
    await click(wc, bySel('.om-close'), 700); // put the picture's menu away
    await sleep(300);
    await caption(wc, 'Jump anywhere with the map');
    const m = await mapAt(12.4, 9.4 + 1.5);
    await clickAt(wc, m.x, m.y, 1200);
    await sleep(900);
    await drag(wc, 1250, 560, 620, 560, 3000);
    await sleep(600);
  });

  await scene('light', async () => {
    const m = await mapAt(12.4, 2.4);
    await clickAt(wc, m.x, m.y, 900);
    await turnTo(0);
    await sleep(1400);
    await caption(wc, 'Outside, it is Toronto right now', 'Real time of day and weather — or choose your own.');
    await click(wc, byText('.tb-btn, .toolbar button', /^Light$/), 900);
    await sleep(900);
    for (const [group, name, wait] of [['Time of day', 'Dusk', 2700], ['Time of day', 'Night', 2700], ['Weather', 'Snow', 3200], ['Time of day', 'Day', 1100], ['Weather', 'Clear', 900]]) {
      await click(wc, `() => [...document.querySelectorAll('.chips[aria-label="${group}"] button')].find((b) => b.textContent.trim() === '${name}')`, 700);
      await sleep(wait);
    }
    await clickAt(wc, 420, 420, 700); // close the menu
    await sleep(500);
  });

  await scene('pinboard', async () => {
    // stand in front of the board in the first room
    const b = await js(`(() => { const g = window.__vernissage.g3d, p = g.built.pinboards[0]; const v = p.group.getWorldPosition(new (g.camera.position.constructor)()); const n = new (g.camera.position.constructor)(0, 0, 1).transformDirection(p.group.matrixWorld); return { x: v.x + n.x * 2.1, z: v.z + n.z * 2.1, yaw: Math.atan2(n.x, n.z), ids: p.pins.map((q) => [q.id, q.item.kind]) }; })()`);
    const m = await mapAt(b.x, b.z);
    await clickAt(wc, m.x, m.y, 1000);
    await turnTo(b.yaw);
    await sleep(1500);
    await caption(wc, 'A pinboard by the door', 'Snapshots and notes. Visitors can move and turn them.');
    await sleep(1400);
    const photos = b.ids.filter(([, k]) => k === 'photo').map(([id]) => id), notes = b.ids.filter(([, k]) => k === 'note').map(([id]) => id);
    const a = await pinAt(photos[1] ?? photos[0]);
    await drag(wc, a.x, a.y, a.x + 150, a.y + 110, 1500, { wheel: 3 });
    await sleep(500);
    const c = await pinAt(photos[3] ?? photos[0]);
    await drag(wc, c.x, c.y, c.x - 120, c.y - 60, 1300);
    await sleep(500);
    const nt = await pinAt(notes[0]);
    await clickAt(wc, nt.x, nt.y, 900);
    await sleep(3400);
    await click(wc, bySel('.pin-close'), 700);
    await sleep(600);
  });

  await scene('portfolio', async () => {
    await caption(wc, 'Or browse it all as a portfolio');
    await click(wc, byText('.tb-btn, .toolbar button', /^Portfolio$/), 900);
    await sleep(1800);
    for (let i = 0; i < 14; i++) { wc.sendInputEvent({ type: 'mouseWheel', x: 960, y: 600, deltaX: 0, deltaY: -40, canScroll: true }); await sleep(90); }
    await sleep(1800);
    await captionOff(wc);
    await hideCursor(wc);
    await sleep(700);
  });

  const secs = await rec?.stop();
  console.log(rec ? `recorded ${secs.toFixed(1)} s → ${out}` : 'dry run done');
  server.kill();
  app.quit();
});
