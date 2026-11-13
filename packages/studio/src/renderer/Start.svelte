<script lang="ts">
  import { onMount } from 'svelte';
  import { studio } from './api';
  import { st } from './state.svelte';

  let demos = $state<Array<{ id: string; name: string; description: string }>>([]);
  let recent = $state<string[]>([]);
  let title = $state('My Gallery');
  let busy = $state(false);
  let album = $state('');
  let progress = $state('');

  onMount(() => {
    void studio.info().then((i) => { demos = i.demos; recent = i.recent; st.previewBase = i.previewBase; });
    return studio.onImportProgress((p) => { progress = `${p.step}${p.total > 1 ? ` ${p.done} / ${p.total}` : '…'}`; });
  });

  async function fromAlbum() {
    progress = 'Choose a folder…';
    await run(async () => {
      const p = await studio.fromAlbum(album);
      if (p?.notes?.length) st.notify(p.notes.join(' · '));
      return p;
    });
    progress = '';
  }

  async function run(fn: () => Promise<import('./api').ProjectInfo | null>) {
    busy = true;
    try { const p = await fn(); if (p) st.load(p); }
    catch (e) { st.notify((e as Error).message, 'error'); }
    finally { busy = false; }
  }
  const folderName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
</script>

<div class="start">
  <div class="start-card">
    <h1>Vernissage <span>Studio</span></h1>
    <p class="muted">Design a 3D gallery, hang your art, and export it as a static website.</p>

    <div class="start-cols">
      <div>
        <section>
          <h2>New gallery</h2>
          <div class="row">
            <input bind:value={title} aria-label="Gallery title" />
            <button class="primary" disabled={busy} onclick={() => run(() => studio.newProject(title))}>Create…</button>
          </div>
          <p class="muted small">One room: three walls for art, a windowed wall onto Toronto and an entry door. If the folder you choose has files in it, you are asked before anything is deleted.</p>
        </section>

        <section>
          <h2>From a Google Photos album</h2>
          <div class="row">
            <input bind:value={album} placeholder="https://photos.app.goo.gl/…" aria-label="Link of a shared Google Photos album" />
            <button class="primary" disabled={busy || !album.trim()} onclick={fromAlbum}>Import…</button>
          </div>
          <p class="muted small">{progress || 'The album must be shared by link. Rooms are suggested for the number and shapes of its photos; each label starts with the file name, date, camera settings and caption.'}</p>
        </section>
      </div>

      <div>
        <section>
          <h2>Open</h2>
          <button disabled={busy} onclick={() => run(() => studio.openProject())}>Open project folder…</button>
          {#if recent.length}
            <ul class="recent">
              {#each recent as r}<li><button title={r} onclick={() => run(() => studio.openProject(r))}><strong>{folderName(r)}</strong><span>{r}</span></button></li>{/each}
            </ul>
          {/if}
        </section>

        <section>
          <h2>Start from a demo</h2>
          <div class="demo-list">
            {#each demos as d}
              <button class="demo" disabled={busy} onclick={() => run(() => studio.fromDemo(d.id))}><strong>{d.name}</strong><span>{d.description}</span></button>
            {/each}
          </div>
          <p class="muted small">The demo is copied into a folder you choose, so you can change it freely.</p>
        </section>
      </div>
    </div>
  </div>
</div>
