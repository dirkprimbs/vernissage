<script lang="ts">
  import { FRAMES, WALL_SIDES, type WallSide } from '@vernissage/schema';
  import { studio, type ImportedAsset } from '../api';
  import { st, uniqueId } from '../state.svelte';
  import AlbumPicker from '../AlbumPicker.svelte';

  const g = $derived(st.gallery!);
  const art = $derived(g.artworks.find((a) => a.id === st.artwork) ?? g.artworks[0]);
  const index = $derived(art ? g.artworks.indexOf(art) : -1);
  const where = $derived(art ? st.placementOf(art.id) : undefined);
  const meta = $derived(art ? st.meta[art.file] : undefined);
  const auto = $derived(g.display.sizing === 'auto');
  let filter = $state('');
  let dropping = $state(false);
  let picking = $state(false);
  let strip = $state<HTMLElement>();
  // the work being edited stays in view in the strip (it may have been chosen in the preview)
  $effect(() => { void art?.id; queueMicrotask(() => strip?.querySelector('button.active')?.scrollIntoView({ block: 'nearest' })); });
  const shown = $derived(g.artworks.filter((a) => !filter || `${a.title} ${a.artist.name} ${a.description ?? ''}`.toLowerCase().includes(filter.toLowerCase())));
  const unhung = $derived(g.artworks.filter((a) => !st.placementOf(a.id)).length);
  /** every wall a work can hang on */
  const walls = $derived(g.rooms.flatMap((r) => WALL_SIDES.filter((s) => !r.walls[s].windows).map((s) => ({ key: `${r.id}/${s}`, roomId: r.id, side: s, name: `${r.name} · ${s} wall` }))));

  function add(items: ImportedAsset[]) {
    // a new work takes the artist of the work being edited: most libraries are one artist's
    const artist = art?.artist.name && art.artist.name !== 'Unknown artist' ? art.artist.name : 'Unknown artist';
    for (const it of items) {
      const id = uniqueId(it.id, g.artworks.map((a) => a.id));
      g.artworks.push({ id, file: it.file, title: it.title, artist: { name: artist }, provenance: [], tags: [], frame: 'style', label: 'right' });
      st.meta[it.file] = { width: it.width, height: it.height, color: it.color };
      st.artwork = id;
    }
    if (items.length) st.notify(`Added ${items.length} artwork${items.length > 1 ? 's' : ''}. Hang ${items.length > 1 ? 'them' : 'it'} with “Hangs on” below, or in the Walls pane.`);
  }
  async function importFiles(paths?: string[]) {
    try { add(await studio.importAssets(paths)); } catch (e) { st.notify((e as Error).message, 'error'); }
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    dropping = false;
    const paths = [...(e.dataTransfer?.files ?? [])].map((f) => studio.pathForFile(f)).filter(Boolean);
    if (paths.length) importFiles(paths);
  }
  function remove() {
    if (!art || !confirm(`Remove “${art.title}” from the gallery? The image file stays in the project's assets folder.`)) return;
    const i = index;
    st.unhang(art.id);
    g.artworks.splice(i, 1);
    st.artwork = g.artworks[Math.min(i, g.artworks.length - 1)]?.id ?? null;
  }
  function step(d: number) {
    if (!g.artworks.length) return;
    st.artwork = g.artworks[(index + d + g.artworks.length) % g.artworks.length].id;
  }
  function hangOn(key: string) {
    if (!art) return;
    if (!key) { st.unhang(art.id); return; }
    const w = walls.find((x) => x.key === key);
    if (w) st.hang(art.id, w.roomId, w.side as WallSide);
  }
  function setDims(w: number | null, h: number | null) {
    if (!art) return;
    const next = { width: w ?? art.dimensions?.width ?? 0, height: h ?? art.dimensions?.height ?? 0 };
    // typing one side fills in the other from the image's proportions
    if (meta && w && !next.height) next.height = Math.round((w / (meta.width / meta.height)) * 10) / 10;
    if (meta && h && !next.width) next.width = Math.round(h * (meta.width / meta.height) * 10) / 10;
    art.dimensions = next.width && next.height ? next : undefined;
  }
  function renameId(v: string) {
    if (!art) return;
    const id = uniqueId(v, g.artworks.filter((a) => a !== art).map((a) => a.id));
    for (const r of g.rooms) for (const w of Object.values(r.walls)) for (const p of w.artworks) if (p.artwork === art.id) p.artwork = id;
    art.id = id;
    st.artwork = id;
  }
  function artistForAll() {
    if (!art || !confirm(`Set the artist of all ${g.artworks.length} works to “${art.artist.name}”?`)) return;
    for (const a of g.artworks) a.artist = { ...art.artist };
  }
  function moveProv(i: number, d: number) {
    if (!art) return;
    const j = i + d;
    if (j < 0 || j >= art.provenance.length) return;
    const [x] = art.provenance.splice(i, 1);
    art.provenance.splice(j, 0, x);
  }
  /** optional fields that are filled in, to decide whether "More details" starts open */
  const extras = $derived(art ? [art.artist.life, art.artist.nationality, art.dimensions, art.collection, art.accession, art.credit, art.rights, art.tags.length ? 1 : undefined].filter(Boolean).length : 0);
  const sameArtist = $derived(!!art && g.artworks.every((a) => a.artist.name === art.artist.name));
</script>

{#if picking}<AlbumPicker onclose={() => (picking = false)} />{/if}

<div class="lib" class:dropping ondragover={(e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); dropping = true; } }} ondragleave={() => (dropping = false)} ondrop={onDrop} role="region" aria-label="Artworks">
  <div class="lib-top">
    <h1>Artworks</h1>
    <span class="muted small">{g.artworks.length} work{g.artworks.length === 1 ? '' : 's'}{unhung ? ` · ${unhung} not hung` : ''}</span>
    <span class="spacer"></span>
    {#if g.artworks.length > 8}<input class="lib-filter" type="search" placeholder="Filter…" bind:value={filter} aria-label="Filter artworks" />{/if}
    <button onclick={() => (picking = true)}>+ Add from Photos album…</button>
    <button class="primary" onclick={() => importFiles()}>+ Add images…</button>
  </div>

  {#if !g.artworks.length}
    <button class="lib-empty" onclick={() => importFiles()}>
      <strong>Add your first artworks</strong>
      <span>Click to choose JPG, PNG or SVG files, or drop them anywhere on this page.</span>
    </button>
  {:else}
    <ul class="lib-strip" aria-label="All artworks" bind:this={strip}>
      {#each shown as a (a.id)}
        <li>
          <button class:active={a.id === art?.id} class:loose={!st.placementOf(a.id)} onclick={() => (st.artwork = a.id)} title="{a.title}{st.placementOf(a.id) ? '' : ' (not hung)'}" aria-label={a.title} aria-pressed={a.id === art?.id}>
            <img src={st.thumb(a.file)} alt="" loading="lazy" />
          </button>
        </li>
      {:else}<li class="muted small">Nothing matches “{filter}”.</li>{/each}
    </ul>
    <p class="muted small lib-hint">Drop image files anywhere here to add them. A dashed outline marks works that are not on a wall yet.</p>
  {/if}

  {#if art}
    <section class="lib-card">
      <div class="lib-head">
        <img src={st.thumb(art.file)} alt="" />
        <div class="lib-head-main">
          <div class="lib-nav">
            <button class="ghost small" onclick={() => step(-1)} aria-label="Previous artwork">←</button>
            <span class="muted small">{index + 1} of {g.artworks.length}</span>
            <button class="ghost small" onclick={() => step(1)} aria-label="Next artwork">→</button>
            <span class="spacer"></span>
            <button class="ghost small" disabled={!where} onclick={() => (st.previewGoto = { id: art.id, n: (st.previewGoto?.n ?? 0) + 1 })} title={where ? 'Go to this work in the live preview' : 'Hang the work first'}>Show in preview</button>
            <button class="ghost small danger" onclick={remove}>Remove</button>
          </div>
          <label>Hangs on
            <select value={where ? `${where.roomId}/${where.side}` : ''} onchange={(e) => hangOn(e.currentTarget.value)}>
              <option value="">Not hung (portfolio only)</option>
              {#each walls as w}<option value={w.key}>{w.name}</option>{/each}
            </select>
          </label>
          <p class="muted small file">{art.file.replace(/^assets\//, '')}{#if meta} · {meta.width} × {meta.height} px{/if}</p>
        </div>
      </div>

      <h2>On the label</h2>
      <div class="lib-form">
        <label class="wide">Title <input bind:value={art.title} /></label>
        <label>Artist <input bind:value={art.artist.name} />
          {#if g.artworks.length > 1 && !sameArtist}<button class="link small" onclick={artistForAll}>Use for all {g.artworks.length} works</button>{/if}
        </label>
        <label>Date <input bind:value={art.date} placeholder="c. 1503 or 18 April 2026" /></label>
        <label class="wide">Medium <input bind:value={art.medium} placeholder="Oil on panel, digital photograph, …" /></label>
        <label class="wide">Description <span class="muted small">shown when a visitor inspects the work; Markdown allowed</span>
          <textarea rows="3" bind:value={art.description}></textarea>
        </label>
      </div>

      <details class="lib-more" open={extras > 0}>
        <summary>More details <span class="muted small">{extras ? `${extras} filled in` : 'artist dates, size, collection, credit, rights'}</span></summary>
        <div class="lib-form">
          <label>Artist's life dates <input bind:value={art.artist.life} placeholder="1452–1519" /></label>
          <label>Nationality <input bind:value={art.artist.nationality} /></label>
          <label>Width (cm) <input type="number" min="0" step="0.1" value={art.dimensions?.width ?? ''} onchange={(e) => setDims(+e.currentTarget.value || null, null)} /></label>
          <label>Height (cm) <input type="number" min="0" step="0.1" value={art.dimensions?.height ?? ''} onchange={(e) => setDims(null, +e.currentTarget.value || null)} /></label>
          <p class="wide muted small">{auto ? 'The real size is printed on the label. On the wall, works are sized automatically (adjust in the Walls pane).' : 'The real size sets how large the work hangs. Enter one side and the other follows the image.'}
            {#if art.dimensions}<button class="link small" onclick={() => (art.dimensions = undefined)}>Clear size</button>{/if}</p>
          <label>Collection <input bind:value={art.collection} /></label>
          <label>Accession no. <input bind:value={art.accession} /></label>
          <label class="wide">Credit line <input bind:value={art.credit} /></label>
          <label class="wide">Source link <input type="url" value={art.source ?? ''} placeholder="https://…" onchange={(e) => { const v = e.currentTarget.value.trim(); art.source = v ? (/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`) : undefined; }} /></label>
          <label>Rights <input bind:value={art.rights} placeholder="Public domain" /></label>
          <label>Tags <input value={art.tags.join(', ')} onchange={(e) => (art.tags = e.currentTarget.value.split(',').map((t) => t.trim()).filter(Boolean))} placeholder="portrait, Florence" /></label>
          <label class="wide">Id <span class="muted small">used in links to this work</span><input value={art.id} onchange={(e) => renameId(e.currentTarget.value)} /></label>
        </div>
      </details>

      <details class="lib-more">
        <summary>Frame and light <span class="muted small">{art.frame === 'style' ? 'gallery default frame' : FRAMES[art.frame].name.toLowerCase()}</span></summary>
        <div class="lib-form">
          <label>Frame
            <select bind:value={art.frame}><option value="style">Gallery default</option>{#each Object.values(FRAMES) as f}<option value={f.id}>{f.name}</option>{/each}</select>
          </label>
          <label>Mat (passe-partout)
            <select value={art.mat === undefined ? 'auto' : art.mat ? 'yes' : 'no'} onchange={(e) => (art.mat = e.currentTarget.value === 'auto' ? undefined : e.currentTarget.value === 'yes')}>
              <option value="auto">As the frame has it</option><option value="yes">With mat</option><option value="no">Without mat</option>
            </select>
          </label>
          <label>Wall label <select bind:value={art.label}><option value="right">Right of the work</option><option value="below">Below the work</option></select></label>
          <label>Spotlight <span class="muted small">{Math.round((art.spotlight?.intensity ?? 1) * 100)}%</span>
            <input type="range" min="0" max="3" step="0.1" value={art.spotlight?.intensity ?? 1} oninput={(e) => (art.spotlight = { ...art.spotlight, intensity: +e.currentTarget.value })} /></label>
        </div>
      </details>

      <h2>Provenance <span class="muted small">the work's history, oldest first</span></h2>
      <ol class="prov-list">
        {#each art.provenance as p, i}
          <li>
            <input class="prov-date" bind:value={p.date} placeholder="Date" aria-label="Date of entry {i + 1}" />
            <input class="prov-event" bind:value={p.event} placeholder="What happened: painted, acquired by …" aria-label="Event of entry {i + 1}" />
            <span class="prov-buttons">
              <button class="ghost small" disabled={i === 0} onclick={() => moveProv(i, -1)} aria-label="Move entry {i + 1} up">↑</button>
              <button class="ghost small" disabled={i === art.provenance.length - 1} onclick={() => moveProv(i, 1)} aria-label="Move entry {i + 1} down">↓</button>
              <button class="ghost small danger" onclick={() => art.provenance.splice(i, 1)} aria-label="Delete entry {i + 1}">✕</button>
            </span>
            <input class="prov-note" bind:value={p.note} placeholder="Note (optional)" aria-label="Note of entry {i + 1}" />
          </li>
        {:else}<li class="muted small empty">No entries yet. The label shows the first and the latest entry; the close-up shows them all.</li>{/each}
      </ol>
      <button onclick={() => art.provenance.push({ date: '', event: '' })}>+ Add entry</button>
    </section>
  {/if}
</div>
