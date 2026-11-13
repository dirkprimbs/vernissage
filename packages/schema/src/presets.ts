import type { FrameId, LightingId, StyleId } from './model';

export interface FrameDef {
  id: Exclude<FrameId, 'style'>;
  name: string;
  color: string;
  /** moulding width in metres */
  width: number;
  depth: number;
  metalness: number;
  roughness: number;
  ornate?: boolean;
  /** default passe-partout (mat) width in metres, 0 = none */
  mat: number;
}

export const FRAMES: Record<FrameDef['id'], FrameDef> = {
  none: { id: 'none', name: 'No frame', color: '#000000', width: 0, depth: 0.02, metalness: 0, roughness: 1, mat: 0 },
  'thin-black': { id: 'thin-black', name: 'Thin black', color: '#151515', width: 0.025, depth: 0.04, metalness: 0.1, roughness: 0.6, mat: 0.06 },
  'thin-white': { id: 'thin-white', name: 'Thin white', color: '#f2f0ea', width: 0.025, depth: 0.04, metalness: 0, roughness: 0.7, mat: 0.06 },
  oak: { id: 'oak', name: 'Oak', color: '#a47c4f', width: 0.045, depth: 0.05, metalness: 0, roughness: 0.75, mat: 0.05 },
  gilt: { id: 'gilt', name: 'Gilt (ornate)', color: '#c39a3e', width: 0.09, depth: 0.07, metalness: 0.85, roughness: 0.35, ornate: true, mat: 0 },
  steel: { id: 'steel', name: 'Brushed steel', color: '#8d9399', width: 0.02, depth: 0.035, metalness: 0.9, roughness: 0.4, mat: 0.05 },
  float: { id: 'float', name: 'Float mount', color: '#222222', width: 0.012, depth: 0.05, metalness: 0, roughness: 0.6, mat: 0 },
};

export interface StyleDef {
  id: StyleId;
  name: string;
  description: string;
  wall: string;
  floor: string;
  floorPattern: 'plain' | 'parquet' | 'concrete' | 'planks' | 'stone';
  ceiling: string;
  trim: string;
  skirting: boolean;
  moulding: boolean;
  frame: Exclude<FrameId, 'style'>;
  labelBackground: string;
  labelText: string;
  labelFont: 'sans' | 'serif';
  accent: string;
  wallRoughness: number;
  floorRoughness: number;
  /** css for the 2D UI */
  ui: { bg: string; fg: string; muted: string; panel: string; accent: string; font: 'sans' | 'serif' };
}

export const STYLES: Record<StyleId, StyleDef> = {
  pavilion: {
    id: 'pavilion',
    name: 'Pavilion',
    description: 'Bright social-space look: soft pastel walls, pale tiles, white frames, crisp blue accents.',
    wall: '#eef2f6', floor: '#cfd8e0', floorPattern: 'stone', ceiling: '#ffffff', trim: '#dfe6ec',
    skirting: true, moulding: false, frame: 'thin-white',
    labelBackground: '#ffffff', labelText: '#1f2a33', labelFont: 'sans', accent: '#007ab8',
    wallRoughness: 0.9, floorRoughness: 0.55,
    ui: { bg: '#f4f6f8', fg: '#000000', muted: '#868686', panel: '#ffffff', accent: '#007ab8', font: 'sans' },
  },
  atrium: {
    id: 'atrium',
    name: 'Atrium',
    description: 'Airy lobby under a glass roof: warm white walls, honey-oak floor, oak frames, plants.',
    wall: '#f6f3ee', floor: '#c89b6a', floorPattern: 'planks', ceiling: '#fbfaf7', trim: '#e2d8ca',
    skirting: true, moulding: false, frame: 'oak',
    labelBackground: '#ffffff', labelText: '#26303a', labelFont: 'sans', accent: '#007ab8',
    wallRoughness: 0.9, floorRoughness: 0.55,
    ui: { bg: '#f7f5f1', fg: '#000000', muted: '#868686', panel: '#ffffff', accent: '#007ab8', font: 'sans' },
  },
  'white-cube': {
    id: 'white-cube',
    name: 'White Cube',
    description: 'Contemporary gallery: white walls, pale polished concrete, minimal frames.',
    wall: '#f4f3ef', floor: '#bdbab3', floorPattern: 'concrete', ceiling: '#fbfbfa', trim: '#e6e4de',
    skirting: false, moulding: false, frame: 'thin-black',
    labelBackground: '#ffffff', labelText: '#1b1b1b', labelFont: 'sans', accent: '#1b1b1b',
    wallRoughness: 0.95, floorRoughness: 0.45,
    ui: { bg: '#f7f6f3', fg: '#141414', muted: '#6b6b6b', panel: '#ffffff', accent: '#141414', font: 'sans' },
  },
  'classical-salon': {
    id: 'classical-salon',
    name: 'Classical Salon',
    description: 'Old-master rooms: deep red damask walls, gilt frames, oak parquet, cornices.',
    wall: '#6e1f24', floor: '#7a5230', floorPattern: 'parquet', ceiling: '#efe6d6', trim: '#d9c9a3',
    skirting: true, moulding: true, frame: 'gilt',
    labelBackground: '#f3ead6', labelText: '#2a1d12', labelFont: 'serif', accent: '#b8903c',
    wallRoughness: 0.9, floorRoughness: 0.5,
    ui: { bg: '#1d1210', fg: '#f3ead6', muted: '#bba98a', panel: '#2a1a16', accent: '#c9a24a', font: 'serif' },
  },
  'industrial-loft': {
    id: 'industrial-loft',
    name: 'Industrial Loft',
    description: 'Converted warehouse: raw concrete walls, dark plank floor, steel frames.',
    wall: '#a3a29e', floor: '#3d3631', floorPattern: 'planks', ceiling: '#55534f', trim: '#2b2b2b',
    skirting: false, moulding: false, frame: 'steel',
    labelBackground: '#1f1f1f', labelText: '#eeeeee', labelFont: 'sans', accent: '#e0752d',
    wallRoughness: 1, floorRoughness: 0.7,
    ui: { bg: '#1b1b1b', fg: '#ececec', muted: '#9a9a9a', panel: '#262626', accent: '#e0752d', font: 'sans' },
  },
  scandinavian: {
    id: 'scandinavian',
    name: 'Scandinavian',
    description: 'Calm and light: soft grey walls, pale oak floor, oak frames with mats.',
    wall: '#e3e1dc', floor: '#d6bf98', floorPattern: 'planks', ceiling: '#f6f5f2', trim: '#d2cec6',
    skirting: true, moulding: false, frame: 'oak',
    labelBackground: '#fbfaf7', labelText: '#2e2c29', labelFont: 'sans', accent: '#5b7b6a',
    wallRoughness: 0.95, floorRoughness: 0.6,
    ui: { bg: '#f2f0eb', fg: '#2e2c29', muted: '#7d7a73', panel: '#fbfaf7', accent: '#5b7b6a', font: 'sans' },
  },
  'dark-museum': {
    id: 'dark-museum',
    name: 'Dark Museum',
    description: 'Dramatic and focused: charcoal walls, dark stone floor, brass labels.',
    wall: '#26272b', floor: '#1d1d1f', floorPattern: 'stone', ceiling: '#141416', trim: '#3a3a3e',
    skirting: true, moulding: false, frame: 'float',
    labelBackground: '#b08d57', labelText: '#16120c', labelFont: 'serif', accent: '#b08d57',
    wallRoughness: 0.85, floorRoughness: 0.35,
    ui: { bg: '#0f0f11', fg: '#e8e4dc', muted: '#8f8a80', panel: '#1a1a1d', accent: '#b08d57', font: 'serif' },
  },
};

export interface LightingDef {
  id: LightingId;
  name: string;
  description: string;
  hemi: { sky: string; ground: string; intensity: number };
  ambient: number;
  /** sun through skylights */
  sun?: { color: string; intensity: number };
  skylights: boolean;
  ceiling: 'panels' | 'track' | 'none';
  /** emissive strength of ceiling panels */
  panelGlow: number;
  spot: { intensity: number; color: string; angle: number; penumbra: number };
  /** how much of the room light is removed so only spotlit art reads */
  exposure: number;
  torch: boolean;
  background: string;
}

export const LIGHTING: Record<LightingId, LightingDef> = {
  daylight: {
    id: 'daylight', name: 'Daylight', description: 'Natural light through the roof lanterns and windows. It follows the conditions outside; spotlights come on as it gets dark.',
    hemi: { sky: '#e8f0ff', ground: '#b9ad9c', intensity: 1.6 }, ambient: 0.5,
    sun: { color: '#fff4e0', intensity: 1.4 }, skylights: true, ceiling: 'none', panelGlow: 0,
    spot: { intensity: 0.6, color: '#ffffff', angle: 0.5, penumbra: 0.8 }, exposure: 1.05, torch: false, background: '#cfe0f5',
  },
  'gallery-white': {
    id: 'gallery-white', name: 'Gallery white', description: 'Even, neutral light from ceiling panels; every work clearly visible.',
    hemi: { sky: '#ffffff', ground: '#cfcac2', intensity: 1.3 }, ambient: 0.55,
    skylights: false, ceiling: 'panels', panelGlow: 1.2,
    spot: { intensity: 1.0, color: '#fffaf2', angle: 0.45, penumbra: 0.7 }, exposure: 1.0, torch: false, background: '#e8e6e1',
  },
  'evening-spots': {
    id: 'evening-spots', name: 'Evening spots', description: 'Warm, dim room light with track spots on every work.',
    hemi: { sky: '#ffd9a8', ground: '#4a3a2c', intensity: 0.45 }, ambient: 0.18,
    skylights: false, ceiling: 'track', panelGlow: 0,
    spot: { intensity: 2.2, color: '#ffd7a0', angle: 0.38, penumbra: 0.55 }, exposure: 1.0, torch: false, background: '#2a2018',
  },
  chiaroscuro: {
    id: 'chiaroscuro', name: 'Chiaroscuro', description: 'Dark rooms; tight, intense pools of light on the art only.',
    hemi: { sky: '#9aa6c0', ground: '#1a1a1a', intensity: 0.28 }, ambient: 0.08,
    skylights: false, ceiling: 'track', panelGlow: 0,
    spot: { intensity: 3.2, color: '#fff1dc', angle: 0.28, penumbra: 0.35 }, exposure: 1.1, torch: false, background: '#050505',
  },
  'night-tour': {
    id: 'night-tour', name: 'Night tour', description: 'After hours: the gallery is dark, your torch and faint spots guide you.',
    hemi: { sky: '#3b4c7a', ground: '#050508', intensity: 0.08 }, ambient: 0.02,
    skylights: true, ceiling: 'none', panelGlow: 0,
    spot: { intensity: 0.9, color: '#cdd8ff', angle: 0.3, penumbra: 0.5 }, exposure: 1.15, torch: true, background: '#03040a',
  },
};

export function resolveStyle(preset: StyleId, overrides: Partial<StyleDef> & { frame?: FrameId } = {}): StyleDef {
  const base = STYLES[preset];
  const clean = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined && v !== 'style'));
  return { ...base, ...clean } as StyleDef;
}

export function resolveLighting(id: LightingId, o: { ambient?: number; spot?: number; spotColor?: string; warmth?: number } = {}): LightingDef {
  const base = LIGHTING[id];
  return {
    ...base,
    ambient: o.ambient ?? base.ambient,
    spot: { ...base.spot, intensity: o.spot ?? base.spot.intensity, color: o.spotColor ?? base.spot.color },
  };
}
