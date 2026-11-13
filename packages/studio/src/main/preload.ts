import { contextBridge, ipcRenderer, webUtils } from 'electron';

type Result<T> = { ok: true; value: T } | { ok: false; error: string; issues?: unknown[] };

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = (await ipcRenderer.invoke(channel, ...args)) as Result<T>;
  if (!r.ok) { const e = new Error(r.error) as Error & { issues?: unknown[] }; e.issues = r.issues; throw e; }
  return r.value;
}

const api = {
  info: () => call('app:info'),
  openProject: (dir?: string) => call('project:open', dir),
  newProject: (title: string) => call('project:new', title),
  fromDemo: (id: string) => call('project:fromDemo', id),
  fromAlbum: (url: string) => call('project:fromAlbum', url),
  save: (gallery: unknown) => call('project:save', gallery),
  importAssets: (paths?: string[]) => call('assets:import', paths),
  assetMeta: (files: string[]) => call('assets:meta', files),
  updatePreview: (gallery: unknown) => call('preview:update', gallery),
  chooseOutDir: () => call('build:chooseOut'),
  build: (opts: { outDir: string; basePath?: string; force?: boolean }) => call('build:run', opts),
  openSite: (dir: string) => call('site:open', dir),
  reveal: (path: string) => call('shell:reveal', path),
  pathForFile: (f: File) => webUtils.getPathForFile(f),
  onBuildProgress: (cb: (p: { step: string; done: number; total: number }) => void) => {
    const l = (_: unknown, p: { step: string; done: number; total: number }) => cb(p);
    ipcRenderer.on('build:progress', l);
    return () => ipcRenderer.removeListener('build:progress', l);
  },
  onImportProgress: (cb: (p: { step: string; done: number; total: number }) => void) => {
    const l = (_: unknown, p: { step: string; done: number; total: number }) => cb(p);
    ipcRenderer.on('import:progress', l);
    return () => ipcRenderer.removeListener('import:progress', l);
  },
  onMenu: (cb: (cmd: string) => void) => { ipcRenderer.on('menu', (_e, cmd: string) => cb(cmd)); },
};

contextBridge.exposeInMainWorld('studio', api);
export type StudioApi = typeof api;
