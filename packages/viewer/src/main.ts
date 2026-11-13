import css from './style.css?inline';
import fonts from './fonts.css?inline';
import { resolveStyle, type LightingId, type SiteData, type StyleDef } from '@vernissage/schema';
import { loadSiteData } from './data';
import { h, store } from './dom';
import { FocusView } from './ui/focus';
import { PortfolioView } from './ui/portfolio';
import { Shell } from './ui/shell';
import { EntryModal, LoadingScreen } from './ui/entry';
import { Gallery3D } from './app3d';
import { LabelView } from './ui/label';
import { siteMenu } from './ui/menu';
import { Conditions, type ConditionsChoice } from './conditions';
import type { Quality } from './scene/lighting';

type Mode = '3d' | 'portfolio';

function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

/** The interface follows the social-space look (white panels, round buttons); each gallery style supplies the accent. */
function applyTheme(style: StyleDef) {
  const r = document.documentElement.style;
  r.setProperty('--primary', style.ui.accent);
  r.setProperty('--room-bg', style.ui.bg);
  r.setProperty('--room-fg', style.ui.fg);
  r.setProperty('--room-muted', style.ui.muted);
  r.setProperty('--room-font', style.ui.font === 'serif' ? 'var(--serif)' : 'var(--sans)');
  document.documentElement.dataset.style = style.id;
}

function defaultQuality(): Quality {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return coarse || (mem && mem < 4) ? 'low' : 'medium';
}

async function boot() {
  document.head.append(h('style', {}, fonts), h('style', {}, css));
  const app = document.getElementById('app')!;
  let data: SiteData;
  try { data = await loadSiteData(); }
  catch (e) { app.append(h('div', { class: 'fatal' }, h('h1', {}, 'This gallery could not be opened'), h('p', {}, String((e as Error).message)))); return; }

  const g = data.gallery;
  document.title = g.title;
  const style = resolveStyle(g.style.preset, g.style.overrides as Partial<StyleDef>);
  applyTheme(style);

  const key = (k: string) => `vernissage:${g.title}:${k}`;
  const prefs = {
    lighting: store<LightingId>(key('lighting'), g.lighting.scenario),
    quality: store<Quality>(key('quality'), defaultQuality()),
    outside: store<ConditionsChoice>(key('outside'), { time: g.environment.time, weather: g.environment.weather }),
  };
  // visitors may change the conditions outside wherever they may change the lighting;
  // live weather (a request to Environment Canada) is only ever used if the gallery's owner left it on
  const chosen = g.lighting.allowVisitorChoice ? prefs.outside.get() : { time: g.environment.time, weather: g.environment.weather };
  if (chosen.weather === 'live' && g.environment.weather !== 'live') chosen.weather = g.environment.weather;
  const state = {
    outside: chosen,
    lighting: g.lighting.allowVisitorChoice ? prefs.lighting.get() : g.lighting.scenario,
    quality: prefs.quality.get(),
  };

  const params = new URLSearchParams(location.search);
  // browsers refuse WebGL textures from file:// pages, so local files get the portfolio only
  const fromFile = location.protocol === 'file:';
  const has3D = !fromFile && webglAvailable() && !params.has('no3d');
  const stage = h('div', { class: 'stage' });
  app.append(stage);

  let g3d: Gallery3D | undefined;
  let shell: Shell | undefined;
  let mode: Mode = has3D ? '3d' : 'portfolio';
  let joined = false;

  const focus = new FocusView(data, {
    onNavigate: (id) => { history.replaceState(null, '', `#/art/${id}`); void route(); },
    onClose: () => { location.hash = mode === 'portfolio' ? '#/portfolio' : '#/'; },
    onShowInGallery: has3D ? (id) => { location.hash = '#/'; queueMicrotask(() => { join(); g3d?.select(id, 'teleport'); }); } : undefined,
  });
  const portfolio = new PortfolioView(data, {
    onOpen: (id) => { location.hash = `#/art/${id}`; },
    onEnter3D: has3D ? () => { location.hash = '#/'; } : undefined,
  });
  portfolio.el.hidden = true;
  const menu = siteMenu(data);
  if (menu) { app.append(menu); document.body.classList.add('has-menu'); }
  const labels = new LabelView(data, style, {
    onInspect: (id) => { closeLabel(); location.hash = `#/art/${id}`; },
    onClose: () => closeLabel(),
  });
  app.append(portfolio.el, focus.el, labels.el);
  function openLabel(id: string) {
    labels.show(id);
    if (g3d) { g3d.input.enabled = false; g3d.input.keys.clear(); }
  }
  function closeLabel() {
    if (!labels.open) return;
    labels.hide();
    if (g3d && joined && !focus.isOpen) g3d.input.enabled = true;
    g3d?.renderer.domElement.focus();
  }

  const loading = new LoadingScreen(g.title);
  const entry = new EntryModal({
    data, has3D,
    no3DReason: fromFile ? 'Opened from a local file: the 3D walk-through needs a web server (for example `vernissage serve`). The portfolio works here.' : has3D ? undefined : '3D is not available in this browser.',
    onJoin: () => join(),
    onBrowse: () => { location.hash = '#/portfolio'; },
  });

  const conditions = new Conditions(state.outside, (now) => { g3d?.setOutside(now.sun, now.weather); shell?.setOutside(now); });

  /** build the 3D gallery behind the loading screen (a second or two for a large gallery) */
  async function prepare3D() {
    if (g3d) return;
    app.append(loading.el);
    loading.el.classList.remove('gone');
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
    ensure3D();
    await new Promise((r) => setTimeout(r, 350));
    loading.hide();
  }

  function ensure3D(): Gallery3D {
    if (g3d) return g3d;
    g3d = new Gallery3D(stage, data, style, state.quality, conditions.now(), { teleport: g.navigation.teleport, accent: style.ui.accent, orbit: g.navigation.lobbyOrbit }, {
      onRoom: (r) => { shell?.setRoom(r); if (window.parent !== window) window.parent.postMessage({ type: 'vernissage:room', id: r.room.id }, '*'); },
      onNear: (a) => shell?.setNear(a),
      onSelect: (a) => shell?.setSelected(a),
      onOpen: (id) => { location.hash = `#/art/${id}`; },
      onLabel: (id) => openLabel(id),
      onExit: (url) => {
        // inside the studio's preview the door only says where it leads
        if (window.parent !== window && params.has('enter')) { shell?.notify('Entry door', `Leads to ${url}`); return; }
        // embedded in another page, the whole page leaves, not just the frame
        if (window.parent !== window) window.open(url, '_top'); else window.location.assign(url);
      },
      onProgress: (d, t) => { shell?.setProgress(d, t); },
    });
    if (state.lighting !== g.lighting.scenario) g3d.setLighting(state.lighting);
    shell = new Shell(data, g3d, state, {
      onPortfolio: () => { location.hash = '#/portfolio'; },
      onLeave: () => leave(),
      onInspect: (id) => { location.hash = `#/art/${id}`; },
      onLabel: (id) => openLabel(id),
      onLighting: (id) => { prefs.lighting.set(id); g3d!.setLighting(id); },
      onOutside: (c) => { prefs.outside.set(c); conditions.set(c); },
      onQuality: (q) => { prefs.quality.set(q); g3d!.setQuality(q); },
    });
    shell.setVisible(false);
    stage.append(shell.el);
    conditions.start();
    setInterval(() => shell?.drawMap(), 100);
    (window as unknown as { vernissage: Gallery3D }).vernissage = g3d;
    return g3d;
  }

  /** lobby → in the gallery */
  function join() {
    const x = ensure3D();
    joined = true;
    entry.hide();
    x.setLobby(false);
    shell!.setVisible(true);
    if (!focus.isOpen) x.start();
    if (!sessionStorage.getItem('vernissage:welcomed')) {
      sessionStorage.setItem('vernissage:welcomed', '1');
      shell!.notify('Welcome!', 'WASD to move · drag to look · scroll to zoom · right-click to teleport · Space on an artwork for options');
    }
  }

  /** back to the lobby */
  function leave() {
    if (!g3d) return;
    joined = false;
    g3d.select(undefined);
    shell!.setVisible(false);
    g3d.setLobby(true);
    g3d.start();
    app.append(entry.el);
    entry.showRoom();
  }

  function show(m: Mode) {
    mode = m;
    stage.hidden = m !== '3d';
    portfolio.el.hidden = m !== 'portfolio';
    document.body.dataset.mode = m;
  }

  async function route() {
    const hash = location.hash.replace(/^#\/?/, '');
    const [kind, raw] = hash.split('/');
    const id = raw ? decodeURIComponent(raw) : '';
    if (kind === 'art' && id) {
      focus.open(id);
      if (mode === '3d' && has3D) {
        const x = ensure3D();
        if (!joined) { joined = true; entry.hide(); x.setLobby(false); shell!.setVisible(true); }
        if (!x.built.artworks.some((a) => a.id === id && a.viewpoint.distanceTo(x.position) < 3)) x.teleportToArtwork(id);
        x.select(id);
        x.stop();
        x.renderOnce();
      }
      return;
    }
    focus.close();
    if (kind === 'portfolio' || !has3D) {
      g3d?.stop();
      entry.hide();
      show('portfolio');
      return;
    }
    show('3d');
    await prepare3D();
    const x = ensure3D();
    if (kind === 'room' && id) { x.teleportToRoom(id); if (!joined) join(); }
    if (joined) { x.setLobby(false); x.start(); }
    else {
      x.setLobby(true);
      x.start();
      if (!entry.el.isConnected) { app.append(entry.el); entry.showRoom(); }
    }
  }

  // a gallery set to open in the portfolio does so unless a link asks for something else
  const opensInPortfolio = g.startIn === 'portfolio' && !location.hash && !params.has('enter');
  if (opensInPortfolio) history.replaceState(null, '', '#/portfolio');
  // first paint: loading screen, then build the scene behind it
  show(has3D && !opensInPortfolio ? '3d' : 'portfolio');
  if (has3D && !location.hash.startsWith('#/portfolio')) await prepare3D();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (params.has('enter') && has3D) join(); // the studio preview skips the lobby
  else if (reduced && !location.hash && has3D) location.hash = '#/portfolio';
  window.addEventListener('hashchange', () => void route());
  await route();
}

boot();
