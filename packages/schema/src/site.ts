import type { Gallery } from './model';

/** Per-artwork asset variants written by the generator (paths relative to the site root). */
export interface ArtAsset {
  /** small preview, webp */
  thumb: string;
  /** texture used in the 3D scene (max 2048px), webp */
  texture: string;
  /** focus-mode original: webp/jpg/png or the untouched svg */
  full: string;
  kind: 'raster' | 'svg';
  /** pixel size of the source */
  width: number;
  height: number;
  /** average colour, used as a placeholder while loading */
  color: string;
}

/** Everything the viewer needs; inlined into index.html by the generator. */
export interface SiteData {
  gallery: Gallery;
  assets: Record<string, ArtAsset>;
  build: { generator: string; builtAt: string };
}

export const SITE_DATA_ELEMENT_ID = 'vernissage-data';
