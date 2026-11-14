import type { BuildReport } from '@vernissage/generator';
import type { Gallery, ValidationIssue } from '@vernissage/schema';

export interface ProjectInfo { dir: string; gallery: Gallery; issues: ValidationIssue[]; outDir?: string }
export interface ImportedAsset { id: string; file: string; title: string; width: number; height: number; color: string }
export interface Meta { width: number; height: number; color: string }
export interface AlbumListing { title: string; truncated: boolean; photos: Array<{ id: string; name: string; thumb?: string; width: number; height: number; inGallery: boolean }> }
export interface AlbumArtwork { art: Gallery['artworks'][number] & { id: string; file: string }; meta: Meta }

export interface StudioApi {
  info(): Promise<{ demos: Array<{ id: string; name: string; description: string }>; recent: string[]; previewBase: string }>;
  openProject(dir?: string): Promise<ProjectInfo | null>;
  newProject(title: string): Promise<ProjectInfo | null>;
  fromDemo(id: string): Promise<ProjectInfo | null>;
  fromAlbum(url: string): Promise<(ProjectInfo & { notes?: string[] }) | null>;
  save(gallery: unknown): Promise<boolean>;
  importAssets(paths?: string[]): Promise<ImportedAsset[]>;
  assetMeta(files: string[]): Promise<Record<string, Meta>>;
  listAlbum(url: string, known: string[]): Promise<AlbumListing>;
  addFromAlbum(url: string, photoIds: string[], takenIds: string[]): Promise<{ artworks: AlbumArtwork[]; skipped: string[] }>;
  updatePreview(gallery: unknown): Promise<{ ok: boolean; url?: string; issues: ValidationIssue[]; site?: unknown }>;
  chooseOutDir(): Promise<string | null>;
  build(opts: { outDir: string; basePath?: string; force?: boolean }): Promise<BuildReport>;
  openSite(dir: string): Promise<string>;
  reveal(path: string): Promise<boolean>;
  pathForFile(f: File): string;
  onBuildProgress(cb: (p: { step: string; done: number; total: number }) => void): () => void;
  onImportProgress(cb: (p: { step: string; done: number; total: number }) => void): () => void;
  setDirty(dirty: boolean, title?: string): void;
  closeWindow(confirmed?: boolean): void;
  onMenu(cb: (cmd: string) => void): void;
}

export const studio = (window as unknown as { studio: StudioApi }).studio;
