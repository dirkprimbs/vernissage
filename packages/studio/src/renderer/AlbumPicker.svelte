<script lang="ts">
  import { onMount } from 'svelte';
  import { studio, type AlbumListing } from './api';
  import { st } from './state.svelte';

  let { onclose }: { onclose: () => void } = $props();
  const g = $derived(st.gallery!);
  const ALBUM = /^https:\/\/(photos\.app\.goo\.gl|photos\.google\.com)\//;
  // a gallery started from an album remembers the album's link in its works
  let url = $state(st.gallery!.artworks.find((a) => a.source && ALBUM.test(a.source))?.source ?? '');
  let listing = $state<AlbumListing | null>(null);
  let chosen = $state<Record<string, boolean>>({});
  let busy = $state(false);
  let progress = $state('');
  let error = $state('');
  let dialog: HTMLDialogElement;

  const fresh = $derived(listing?.photos.filter((p) => !p.inGallery) ?? []);
  const picked = $derived(fresh.filter((p) => chosen[p.id]));

  onMount(() => {
    dialog.showModal();
    const off = studio.onImportProgress((p) => { progress = `${p.step}${p.total > 1 ? ` ${p.done} / ${p.total}` : '…'}`; });
    if (url) void load();
    return off;
  });

  async function load() {
    busy = true; error = ''; progress = 'Reading the album…';
    try {
      // a work counts as "in the gallery" by its id or by the name of its image file
      const known = g.artworks.flatMap((a) => [a.id, a.file.replace(/^.*\//, '').replace(/\.[a-z0-9]+$/i, '')]);
      listing = await studio.listAlbum(url.trim(), known);
      chosen = Object.fromEntries(listing.photos.filter((p) => !p.inGallery).map((p) => [p.id, true]));
    } catch (e) { listing = null; error = (e as Error).message; }
    busy = false; progress = '';
  }

  async function add() {
    busy = true; error = ''; progress = 'Fetching photos…';
    try {
      const r = await studio.addFromAlbum(url.trim(), picked.map((p) => p.id), g.artworks.map((a) => a.id));
      for (const { art, meta } of r.artworks) {
        g.artworks.push({ ...art, tags: [], frame: 'style', label: 'right' } as (typeof g.artworks)[number]);
        st.meta[art.file] = meta;
        st.artwork = art.id;
      }
      const n = r.artworks.length;
      st.notify([n ? `Added ${n} photo${n > 1 ? 's' : ''} from the album. Hang ${n > 1 ? 'them' : 'it'} with “Hangs on”, or in the Walls pane.` : 'No photos were added.', ...r.skipped].join(' · '), n ? 'info' : 'error');
      onclose();
    } catch (e) { error = (e as Error).message; }
    busy = false; progress = '';
  }
</script>

<dialog bind:this={dialog} class="album-picker" onclose={onclose} oncancel={(e) => { if (busy) e.preventDefault(); }} aria-label="Add from a Google Photos album">
  <h1>Add from a Google Photos album</h1>
  <p class="muted small">Only the photos you choose are added. Works already in the gallery, and everything you edited, stay as they are.</p>
  <div class="row">
    <input bind:value={url} placeholder="https://photos.app.goo.gl/…" aria-label="Link of a shared Google Photos album" disabled={busy} onkeydown={(e) => { if (e.key === 'Enter' && url.trim()) void load(); }} />
    <button disabled={busy || !url.trim()} onclick={load}>{listing ? 'Refresh' : 'Show photos'}</button>
  </div>
  {#if error}<p class="warn small">{error}</p>{/if}

  {#if listing}
    <div class="row ap-count">
      <span class="small"><strong>{listing.title}</strong> · {listing.photos.length} photo{listing.photos.length === 1 ? '' : 's'}, {fresh.length} not in the gallery yet</span>
      <span class="spacer"></span>
      {#if fresh.length > 1}
        <button class="ghost small" disabled={busy} onclick={() => { for (const p of fresh) chosen[p.id] = true; }}>Select all new</button>
        <button class="ghost small" disabled={busy} onclick={() => (chosen = {})}>Select none</button>
      {/if}
    </div>
    <ul class="ap-grid">
      {#each listing.photos as p (p.id)}
        <li>
          <label class:have={p.inGallery} class:on={!!chosen[p.id]} title={p.inGallery ? `${p.name} is already in the gallery` : p.name}>
            <input type="checkbox" disabled={p.inGallery || busy} bind:checked={chosen[p.id]} />
            {#if p.thumb}<img src={p.thumb} alt="" />{:else}<span class="ap-blank"></span>{/if}
            <span class="ap-name small">{p.inGallery ? 'In the gallery' : p.name}</span>
          </label>
        </li>
      {/each}
    </ul>
    {#if listing.truncated}<p class="muted small">The album is longer than its first page; only the first photos are listed.</p>{/if}
  {/if}

  <div class="row ap-foot">
    <span class="muted small">{busy ? progress : ''}</span>
    <span class="spacer"></span>
    <button disabled={busy} onclick={() => dialog.close()}>Cancel</button>
    <button class="primary" disabled={busy || !picked.length} onclick={add}>{picked.length ? `Add ${picked.length} photo${picked.length > 1 ? 's' : ''}` : 'Add photos'}</button>
  </div>
</dialog>
