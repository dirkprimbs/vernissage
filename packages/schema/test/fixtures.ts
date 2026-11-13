import type { GalleryInput } from '../src';

export function art(id: string, w = 60, h = 80) {
  return { id, file: `assets/${id}.jpg`, title: id.toUpperCase(), artist: { name: 'Anon' }, dimensions: { width: w, height: h }, provenance: [{ event: 'made' }] };
}

export function twoRooms(): GalleryInput {
  return {
    title: 'Test',
    artworks: [art('a'), art('b'), art('c'), art('huge', 880, 460)],
    rooms: [
      { id: 'r1', name: 'One', width: 10, depth: 8, walls: { north: { artworks: [{ artwork: 'a' }, { artwork: 'b' }] }, east: { artworks: [{ artwork: 'c' }] } } as any },
      { id: 'r2', name: 'Two', width: 8, depth: 6, walls: { west: { artworks: [{ artwork: 'huge' }] } } as any },
    ],
  };
}
