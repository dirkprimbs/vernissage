import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { copyFile, cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { migrate, parseGallery, resolveStyle, SCHEMA_VERSION, starterRoom, type ArtAsset, type SiteData, type StyleDef } from '@vernissage/schema';
import { BuildError, buildSite, importAlbum, renderIndexHtml } from '@vernissage/generator';

const here = dirname(fileURLToPath(import.meta.url));
const packaged = app.isPackaged;
const repoRoot = resolve(here, '../../..');
const viewerDir = packaged ? join(process.resourcesPath, 'viewer') : join(repoRoot, 'packages/viewer/dist');
const demosDir = packaged ? join(process.resourcesPath, 'demos') : join(repoRoot, 'demos');

export const DEMOS = [
  { id: 'davinci', name: 'Leonardo da Vinci', description: 'Fifteen paintings and drawings in three salon rooms' },
  { id: 'loc-photographs', name: 'American Photographs', description: 'Library of Congress photographs, 1863–1943' },
  { id: 'svg-masterpieces', name: 'Masterpieces in Vector', description: 'SVG traces of famous paintings and photographs' },
];

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
};
const IMAGE_EXT = /\.(jpe?g|png|svg)$/i;

let win: BrowserWindow | undefined;
let projectDir: string | undefined;
let previewData: SiteData | undefined;
let previewServer: Server | undefined;
let previewPort = 0;
const siteServers = new Map<string, number>();

// ---------- settings ----------
interface Settings { recent: string[]; outDirs: Record<string, string> }
const settingsFile = () => join(app.getPath('userData'), 'settings.json');
async function loadSettings(): Promise<Settings> {
  try { return { recent: [], outDirs: {}, ...JSON.parse(await readFile(settingsFile(), 'utf8')) }; } catch { return { recent: [], outDirs: {} }; }
}
async function saveSettings(s: Settings) { await mkdir(dirname(settingsFile()), { recursive: true }); await writeFile(settingsFile(), JSON.stringify(s, null, 2)); }
let noRemember = false;
async function remember(dir: string) {
  if (noRemember) return;
  const s = await loadSettings();
  s.recent = [dir, ...s.recent.filter((d) => d !== dir)].slice(0, 8);
  await saveSettings(s);
}

// ---------- helpers ----------
function inside(parent: string, child: string) {
  const rel = relative(parent, child);
  return !!rel && !rel.startsWith('..') && !rel.startsWith(sep) && rel !== '..';
}

function slug(s: string) {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'artwork';
}

function titleFromFile(f: string) {
  const t = basename(f, extname(f)).replace(/[-_]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const metaCache = new Map<string, { width: number; height: number; color: string }>();
const rasterCache = new Map<string, Buffer>();
async function imageMeta(abs: string) {
  const st = statSync(abs);
  const key = `${abs}:${st.mtimeMs}`;
  const hit = metaCache.get(key);
  if (hit) return hit;
  const img = sharp(abs, { limitInputPixels: 1e9 });
  const m = await img.metadata();
  const { dominant: d } = await img.stats();
  const rotated = (m.orientation ?? 1) >= 5;
  const meta = {
    width: (rotated ? m.height : m.width) ?? 1, height: (rotated ? m.width : m.height) ?? 1,
    color: '#' + [d.r, d.g, d.b].map((v) => v.toString(16).padStart(2, '0')).join(''),
  };
  metaCache.set(key, meta);
  return meta;
}

async function readProject(dir: string) {
  const file = join(dir, 'gallery.json');
  if (!existsSync(file)) throw new Error('This folder has no gallery.json. Choose a Vernissage project folder.');
  const raw = migrate(JSON.parse(await readFile(file, 'utf8')));
  const parsed = parseGallery(raw);
  projectDir = dir;
  await remember(dir);
  const s = await loadSettings();
  win?.setTitle(`${parsed.gallery?.title ?? basename(dir)} — Vernissage Studio`);
  return { dir, gallery: parsed.gallery ?? raw, issues: parsed.issues, outDir: s.outDirs[dir] };
}

/** A new gallery: one tall room with three closed walls and a windowed wall onto Toronto, and an entry door. */
function emptyProject(title: string) {
  return {
    schemaVersion: SCHEMA_VERSION,
    title,
    subtitle: '',
    style: { preset: 'industrial-loft', overrides: {} },
    lighting: { scenario: 'daylight', overrides: {}, allowVisitorChoice: true },
    layout: { mode: 'linear', columns: 2, gap: 0.4 },
    focus: { defaultLayout: 'immersive' },
    environment: { landscape: 'toronto' },
    entrance: { enabled: true, url: 'https://primbs.ca' },
    artworks: [],
    rooms: [starterRoom('room-1', 'Room 1')],
  };
}

/**
 * Ask for the folder of a new project. An empty or new folder is used as it is. A folder with files in it can be
 * used too, after an explicit confirmation that everything in it will be deleted. Folders that are obviously not
 * project folders (the home folder, Documents, Desktop, a drive's root, …) are refused outright.
 */
async function chooseProjectFolder(title: string): Promise<string | undefined> {
  const r = await dialog.showOpenDialog(win!, { title, properties: ['openDirectory', 'createDirectory', 'promptToCreate'] });
  if (r.canceled || !r.filePaths[0]) return;
  const dir = resolve(r.filePaths[0]);
  await mkdir(dir, { recursive: true });
  const entries = await readdir(dir);
  if (!entries.length) return dir;
  const home = resolve(homedir());
  const special = (['documents', 'desktop', 'downloads', 'pictures', 'music', 'videos'] as const).map((n) => { try { return resolve(app.getPath(n)); } catch { return ''; } });
  if (dir === home || inside(dir, home) || dirname(dir) === dir || special.includes(dir) || inside(dir, repoRoot) || dir === repoRoot)
    throw new Error(`“${dir}” holds more than a project could. Choose or create a folder just for this gallery.`);
  const shown = entries.slice(0, 6).join(', ') + (entries.length > 6 ? `, … (${entries.length} items)` : '');
  const answer = await dialog.showMessageBox(win!, {
    type: 'warning',
    title: 'This folder is not empty',
    message: `Delete everything in “${basename(dir)}” and use it for the new gallery?`,
    detail: `${dir}\n\nIt contains: ${shown}\n\nAll of it, including subfolders, will be permanently deleted. This cannot be undone.`,
    buttons: ['Cancel', 'Delete contents and use this folder'],
    defaultId: 0, cancelId: 0, noLink: true,
  });
  if (answer.response !== 1) return;
  for (const e of entries) await rm(join(dir, e), { recursive: true, force: true });
  return dir;
}

// ---------- preview server ----------
function send(res: import('node:http').ServerResponse, file: string) {
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
}

async function startPreviewServer() {
  previewServer = createServer(async (req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (url === '/preview/' || url === '/preview/index.html') {
      if (!previewData) { res.writeHead(503).end('No project open'); return; }
      const template = await readFile(join(viewerDir, 'index.html'), 'utf8');
      const style = resolveStyle(previewData.gallery.style.preset, previewData.gallery.style.overrides as Partial<StyleDef>);
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
      res.end(renderIndexHtml(template, previewData, style));
      return;
    }
    if (url.startsWith('/preview/app/')) { const p = normalize(join(viewerDir, url.slice('/preview/'.length))); if (p.startsWith(viewerDir)) return send(res, p); }
    if (url.startsWith('/preview/raster/') && projectDir) {
      // SVGs without width/height have no intrinsic size, which WebGL can't use; rasterise them for 3D textures
      const p = normalize(join(projectDir, url.slice('/preview/raster/'.length)));
      if (inside(projectDir, p) && /\.svg$/i.test(p) && existsSync(p)) {
        const key = `${p}:${statSync(p).mtimeMs}`;
        let png = rasterCache.get(key);
        if (!png) {
          const m = await imageMeta(p);
          const density = Math.min(2400, Math.max(10, (72 * 2048) / Math.max(m.width, m.height)));
          png = await sharp(p, { density }).resize(2048, 2048, { fit: 'inside' }).flatten({ background: '#ffffff' }).png().toBuffer();
          rasterCache.set(key, png);
        }
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
        res.end(png);
        return;
      }
    }
    if (url.startsWith('/preview/project/') && projectDir) {
      const p = normalize(join(projectDir, url.slice('/preview/project/'.length)));
      if (inside(projectDir, p) && IMAGE_EXT.test(p)) return send(res, p);
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => previewServer!.listen(0, '127.0.0.1', () => r()));
  previewPort = (previewServer.address() as { port: number }).port;
}

async function serveSite(dir: string): Promise<string> {
  let port = siteServers.get(dir);
  if (!port) {
    const srv = createServer((req, res) => {
      const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
      let p = normalize(join(dir, url));
      if (p !== dir && !inside(dir, p)) { res.writeHead(403).end(); return; }
      if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
      send(res, p);
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    port = (srv.address() as { port: number }).port;
    siteServers.set(dir, port);
  }
  return `http://127.0.0.1:${port}/`;
}

// ---------- IPC ----------
function handle(channel: string, fn: (...args: any[]) => unknown) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, value: await fn(...args) }; }
    catch (e) {
      const issues = e instanceof BuildError ? e.issues : undefined;
      return { ok: false, error: (e as Error).message, issues };
    }
  });
}

function registerIpc() {
  handle('app:info', async () => ({ demos: DEMOS, recent: (await loadSettings()).recent.filter((d) => existsSync(join(d, 'gallery.json'))), previewBase: `http://127.0.0.1:${previewPort}` }));

  handle('project:open', async (dir?: string) => {
    if (!dir) {
      const r = await dialog.showOpenDialog(win!, { title: 'Open a Vernissage project', properties: ['openDirectory'] });
      if (r.canceled || !r.filePaths[0]) return null;
      dir = r.filePaths[0];
    }
    return readProject(dir);
  });

  handle('project:new', async (title: string) => {
    const dir = await chooseProjectFolder('Choose a folder for the new gallery');
    if (!dir) return null;
    await mkdir(join(dir, 'assets'), { recursive: true });
    await writeFile(join(dir, 'gallery.json'), JSON.stringify(emptyProject(title || 'My Gallery'), null, 2) + '\n');
    await writeFile(join(dir, '.gitignore'), '.cache/\n');
    return readProject(dir);
  });

  handle('project:fromDemo', async (id: string) => {
    if (!DEMOS.some((d) => d.id === id)) throw new Error('Unknown demo');
    const src = join(demosDir, id);
    const dir = await chooseProjectFolder(`Choose a folder for your copy of the ${id} demo`);
    if (!dir) return null;
    await cp(src, dir, { recursive: true, filter: (s) => !/[\\/]\.(cache|originals)([\\/]|$)/.test(s) });
    return readProject(dir);
  });

  handle('project:fromAlbum', async (url: string) => {
    if (!/^https:\/\/(photos\.app\.goo\.gl|photos\.google\.com)\//.test((url ?? '').trim())) throw new Error('Paste the link of a shared Google Photos album first.');
    const dir = await chooseProjectFolder('Choose a folder for the new gallery');
    if (!dir) return null;
    const r = await importAlbum(url, dir, { onProgress: (step, done, total) => win?.webContents.send('import:progress', { step, done, total }) });
    const p = await readProject(dir);
    return { ...p, notes: r.skipped };
  });

  handle('project:save', async (gallery: unknown) => {
    if (!projectDir) throw new Error('No project open');
    const file = join(projectDir, 'gallery.json');
    const tmp = file + '.tmp';
    await writeFile(tmp, JSON.stringify(gallery, null, 2) + '\n');
    await rename(tmp, file);
    win?.setTitle(`${(gallery as { title?: string }).title ?? basename(projectDir)} — Vernissage Studio`);
    return true;
  });

  handle('assets:import', async (paths?: string[]) => {
    if (!projectDir) throw new Error('No project open');
    if (!paths?.length) {
      const r = await dialog.showOpenDialog(win!, { title: 'Add artworks', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'svg'] }] });
      if (r.canceled) return [];
      paths = r.filePaths;
    }
    const assets = join(projectDir, 'assets');
    await mkdir(assets, { recursive: true });
    const out = [];
    for (const p of paths) {
      if (!IMAGE_EXT.test(p) || !existsSync(p) || !statSync(p).isFile()) continue;
      const ext = extname(p).toLowerCase().replace('.jpeg', '.jpg');
      let name = slug(basename(p, extname(p)));
      let dest = join(assets, name + ext);
      if (resolve(p) !== dest) {
        for (let i = 2; existsSync(dest); i++) dest = join(assets, `${name}-${i}${ext}`);
        await copyFile(p, dest);
      }
      name = basename(dest, ext);
      const meta = await imageMeta(dest);
      out.push({ id: name, file: `assets/${basename(dest)}`, title: titleFromFile(p), ...meta });
    }
    return out;
  });

  handle('assets:meta', async (files: string[]) => {
    if (!projectDir) return {};
    const out: Record<string, { width: number; height: number; color: string }> = {};
    for (const f of files) {
      const abs = join(projectDir, f);
      if (inside(projectDir, abs) && existsSync(abs)) { try { out[f] = await imageMeta(abs); } catch { /* unreadable */ } }
    }
    return out;
  });

  handle('preview:update', async (gallery: unknown) => {
    if (!projectDir) throw new Error('No project open');
    const parsed = parseGallery(gallery);
    if (!parsed.gallery) return { ok: false, issues: parsed.issues };
    const assets: Record<string, ArtAsset> = {};
    for (const a of parsed.gallery.artworks) {
      const abs = join(projectDir, a.file);
      if (!existsSync(abs)) continue;
      try {
        const m = await imageMeta(abs);
        const url = `project/${a.file.split('/').map(encodeURIComponent).join('/')}`;
        const svg = /\.svg$/i.test(a.file);
        const raster = svg ? url.replace(/^project\//, 'raster/') : url;
        assets[a.id] = { thumb: raster, texture: raster, full: url, kind: svg ? 'svg' : 'raster', ...m };
      } catch { /* skip broken image */ }
    }
    previewData = { gallery: { ...parsed.gallery, basePath: './' }, assets, build: { generator: 'Vernissage Studio preview', builtAt: new Date().toISOString() } };
    return { ok: true, url: `http://127.0.0.1:${previewPort}/preview/`, issues: parsed.issues, site: previewData };
  });

  handle('build:chooseOut', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Choose the output folder for the website', properties: ['openDirectory', 'createDirectory', 'promptToCreate'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const dir = r.filePaths[0];
    if (projectDir) { const s = await loadSettings(); s.outDirs[projectDir] = dir; await saveSettings(s); }
    return dir;
  });

  handle('build:run', async (opts: { outDir: string; basePath?: string; force?: boolean }) => {
    if (!projectDir) throw new Error('No project open');
    if (!opts.outDir) throw new Error('Choose an output folder first');
    const outDir = resolve(opts.outDir);
    if (outDir === projectDir || inside(outDir, projectDir) || inside(projectDir, outDir)) throw new Error('The output folder must be outside the project folder.');
    const s = await loadSettings(); s.outDirs[projectDir] = outDir; await saveSettings(s);
    return buildSite(projectDir, outDir, {
      viewerDir, basePath: opts.basePath || undefined, force: opts.force,
      onProgress: (step, done, total) => win?.webContents.send('build:progress', { step, done, total }),
    });
  });

  handle('site:open', async (dir: string) => {
    if (!existsSync(join(dir, 'index.html'))) throw new Error('Build the site first');
    const url = await serveSite(resolve(dir));
    await shell.openExternal(url);
    return url;
  });

  handle('shell:reveal', async (p: string) => { shell.showItemInFolder(p); return true; });

  ipcMain.on('state:dirty', (_e, d: { dirty: boolean; title?: string }) => { dirty = !!d?.dirty; dirtyTitle = d?.title ?? ''; });
  // the window asks to be closed: `confirmed` once it has saved (or there was nothing to save)
  ipcMain.on('window:close', (_e, confirmed?: boolean) => { if (confirmed) closing = true; win?.close(); });
}

// ---------- window ----------
/** the open project has unsaved changes (reported by the window) */
let dirty = false;
let dirtyTitle = '';
/** a close the user has already confirmed */
let closing = false;

async function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 940, minWidth: 1140, minHeight: 640,
    title: 'Vernissage Studio',
    backgroundColor: '#17171a',
    webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // closing the window closes the app. With unsaved changes, ask first instead of refusing silently.
  win.on('close', (e) => {
    if (!dirty || closing) return;
    e.preventDefault();
    void (async () => {
      const r = await dialog.showMessageBox(win!, {
        type: 'question', title: 'Unsaved changes',
        message: `Save the changes to “${dirtyTitle || 'this gallery'}” before closing?`,
        detail: 'If you do not save, your changes since the last save are lost.',
        buttons: ['Save', 'Don’t save', 'Cancel'], defaultId: 0, cancelId: 2, noLink: true,
      });
      if (r.response === 2) return;
      // the window saves its own work and then asks to close again (see window:close)
      if (r.response === 0) { win?.webContents.send('menu', 'save-and-close'); return; }
      closing = true;
      win?.close();
    })();
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  await win.loadFile(join(here, 'renderer/index.html'));
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => win?.webContents.send('menu', 'save') },
      { label: 'Close project', accelerator: 'CmdOrCtrl+W', click: () => win?.webContents.send('menu', 'close-project') },
      { type: 'separator' }, { role: 'quit' },
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
  ]));
  await startPreviewServer();
  registerIpc();
  await createWindow();
  if (process.env.VERNISSAGE_OPEN) setTimeout(() => win?.webContents.send('menu', `open:${resolve(process.env.VERNISSAGE_OPEN!)}`), 400);
  // projects opened by the development hook are not added to the user's recent list
  if (process.env.VERNISSAGE_OPEN) noRemember = true;
  // development aid: VERNISSAGE_SCREENSHOT=/path/shot.png [VERNISSAGE_PANE=walls] captures the window after load
  if (process.env.VERNISSAGE_SCREENSHOT) {
    setTimeout(async () => {
      if (process.env.VERNISSAGE_JS) await win?.webContents.executeJavaScript(process.env.VERNISSAGE_JS).catch((e) => console.error(e));
      setTimeout(async () => {
        const img = await win!.webContents.capturePage();
        await writeFile(process.env.VERNISSAGE_SCREENSHOT!, img.toPNG());
        if (!process.env.VERNISSAGE_KEEP) app.quit();
      }, Number(process.env.VERNISSAGE_WAIT ?? 4000));
    }, 2500);
  }
});

app.on('window-all-closed', () => app.quit());
