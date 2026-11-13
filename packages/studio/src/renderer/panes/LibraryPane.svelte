<script lang="ts">
  import { FRAMES } from '@vernissage/schema';
  import { studio, type ImportedAsset } from '../api';
  import { st, uniqueId } from '../state.svelte';

  const g = $derived(st.gallery!);
  const art = $derived(g.artworks.find((a) => a.id === st.artwork));
  const where = $derived(art ? st.placementOf(art.id) : undefined);
  const meta = $derived(art ? st.meta[art.file] : undefined);
  let filter = $state('');
  let dropping = $state(false);
  const shown = $derived(g.artworks.filter((a) => !filter || `${a.title} ${a.artist.name}`.toLowerCase().includes(filter.toLowerCase())));

  function add(items: ImportedAsset[]) {
    for (const it of items) {
      const id = uniqueId(it.id, g.artworks.map((a) => a.id));
      g.artworks.push({ id, file: it.file, title: it.title, artist: { name: 'Unknown artist' }, provenance: [], tags: [], frame: 'style', label: 'right' });
      st.meta[it.file] = { width: it.width, height: it.height, color: it.color };
      st.artwork = id;
    }
    if (items.length) st.notify(`Added ${items.length} artwork${items.length > 1 ? 's' : ''}`);
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
    if (!art || !confirm(`Remove "${art.title}" from the gallery? The image file stays in the project's assets folder.`)) return;
    st.unhang(art.id);
    const i = g.artworks.indexOf(art);
    g.artworks.splice(i, 1);
    st.artwork = g.artworks[Math.max(0, i - 1)]?.id ?? null;
  }
  function setDims(w: number | null, h: number | null) {
    if (!art) return;
    if (!w && !h) { art.dimensions = undefined; return; }
    art.dimensions = { ...(art.dimensions ?? { width: 0, height: 0 }), ...(w ? { width: w } : {}), ...(h ? { height: h } : {}) };
  }
  function fromAspect(by: 'width' | 'height') {
    if (!art?.dimensions || !meta) return;
    const r = meta.width / meta.height;
    if (by === 'width') art.dimensions.height = Math.round((art.dimensions.width / r) * 10) / 10;
    else art.dimensions.width = Math.round(art.dimensions.height * r * 10) / 10;
  }
  function renameId(v: string) {
    if (!art) return;
    const id = uniqueId(v, g.artworks.filter((a) => a !== art).map((a) => a.id));
    for (const r of g.rooms) for (const w of Object.values(r.walls)) for (const p of w.artworks) if (p.artwork === art.id) p.artwork = id;
    art.id = id;
    st.artwork = id;
  }
</script>

<h1>Library</h1>
<div class="lib-layout" class:dropping ondragover={(e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); dropping = true; } }} ondragleave={() => (dropping = false)} ondrop={onDrop} role="region" aria-label="Artwork library">
  <aside class="lib-list">
    <div class="row">
      <input type="search" placeholder="Filter…" bind:value={filter} />
      <button class="primary" onclick={() => importFiles()}>Add…</button>
    </div>
    <p class="muted small">JPG, PNG or SVG. You can also drop files here.</p>
    <ul>
      {#each shown as a (a.id)}
        <li><button class:active={a.id === st.artwork} onclick={() => (st.artwork = a.id)}>
          <img src={st.thumb(a.file)} alt="" loading="lazy" />
          <span><strong>{a.title}</strong><small>{a.artist.name}{st.placementOf(a.id) ? '' : ' · not hung'}</small></span>
        </button></li>
      {/each}
    </ul>
  </aside>

  <section class="lib-edit">
    {#if art}
      <div class="lib-head">
        <img src={st.thumb(art.file)} alt="" />
        <div>
          <p class="muted small">{art.file}{#if meta} · {meta.width} × {meta.height} px{/if}</p>
          <p class="small">{#if where}Hangs in <b>{g.rooms.find((r) => r.id === where.roomId)?.name}</b>, {where.side} wall{:else}<span class="warn">Not hung — portfolio only</span>{/if}</p>
          <button class="ghost small danger" onclick={remove}>Remove from gallery</button>
        </div>
      </div>
      <div class="form">
        <label>Title <input bind:value={art.title} /></label>
        <label>Id <input value={art.id} onchange={(e) => renameId(e.currentTarget.value)} /></label>
        <label>Artist <input bind:value={art.artist.name} /></label>
        <label>Life dates <input bind:value={art.artist.life} placeholder="1452–1519" /></label>
        <label>Nationality <input bind:value={art.artist.nationality} /></label>
        <label>Date <input bind:value={art.date} placeholder="c. 1503–1519" /></label>
        <label class="wide">Medium <input bind:value={art.medium} placeholder="Oil on poplar panel" /></label>
        <label>Width (cm) <input type="number" min="0" step="0.1" value={art.dimensions?.width ?? ''} onchange={(e) => setDims(+e.currentTarget.value || null, null)} /></label>
        <label>Height (cm) <input type="number" min="0" step="0.1" value={art.dimensions?.height ?? ''} onchange={(e) => setDims(null, +e.currentTarget.value || null)} /></label>
        {#if art.dimensions && meta}
          <div class="wide small"><button class="link" onclick={() => fromAspect('width')}>Height from width and image ratio</button> · <button class="link" onclick={() => fromAspect('height')}>Width from height</button></div>
        {/if}
        <label>Collection <input bind:value={art.collection} /></label>
        <label>Accession no. <input bind:value={art.accession} /></label>
        <label class="wide">Credit line <input bind:value={art.credit} /></label>
        <label class="wide">Source URL <input type="url" bind:value={art.source} oninput={(e) => { if (!e.currentTarget.value) art.source = undefined; }} /></label>
        <label class="wide">Rights <input bind:value={art.rights} placeholder="Public domain" /></label>
        <label class="wide">Description <span class="muted small">(Markdown)</span><textarea rows="4" bind:value={art.description}></textarea></label>
        <label class="wide">Tags <input value={art.tags.join(', ')} onchange={(e) => (art.tags = e.currentTarget.value.split(',').map((t) => t.trim()).filter(Boolean))} placeholder="portrait, Florence" /></label>
      </div>

      <h2>Presentation</h2>
      <div class="form">
        <label>Frame
          <select bind:value={art.frame}><option value="style">Gallery style default</option>{#each Object.values(FRAMES) as f}<option value={f.id}>{f.name}</option>{/each}</select>
        </label>
        <label>Mat (passe-partout)
          <select value={art.mat === undefined ? 'auto' : art.mat ? 'yes' : 'no'} onchange={(e) => (art.mat = e.currentTarget.value === 'auto' ? undefined : e.currentTarget.value === 'yes')}>
            <option value="auto">Frame default</option><option value="yes">Always</option><option value="no">Never</option>
          </select>
        </label>
        <label>Label <select bind:value={art.label}><option value="right">Right of the work</option><option value="below">Below the work</option></select></label>
        <label>Spotlight strength <input type="range" min="0" max="3" step="0.1" value={art.spotlight?.intensity ?? 1} oninput={(e) => (art.spotlight = { ...art.spotlight, intensity: +e.currentTarget.value })} /></label>
      </div>

      <h2>Provenance</h2>
      <table class="prov">
        <thead><tr><th>Date</th><th>Event</th><th>Note</th><th></th></tr></thead>
        <tbody>
          {#each art.provenance as p, i}
            <tr>
              <td><input bind:value={p.date} placeholder="1797" /></td>
              <td><input bind:value={p.event} placeholder="Acquired by …" /></td>
              <td><input bind:value={p.note} /></td>
              <td class="nowrap">
                <button class="ghost small" disabled={i === 0} onclick={() => { const [x] = art.provenance.splice(i, 1); art.provenance.splice(i - 1, 0, x); }} aria-label="Up">↑</button>
                <button class="ghost small danger" onclick={() => art.provenance.splice(i, 1)} aria-label="Delete">✕</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      <button onclick={() => art.provenance.push({ date: '', event: 'New entry' })}>+ Add provenance entry</button>
    {:else}
      <p class="muted">Add artworks with the button on the left or by dropping image files here.</p>
    {/if}
  </section>
</div>
