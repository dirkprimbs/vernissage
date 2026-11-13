<script lang="ts">
  import { onMount } from 'svelte';
  import type { BuildReport } from '@vernissage/generator';
  import { studio } from '../api';
  import { st } from '../state.svelte';

  let busy = $state(false);
  let progress = $state<{ step: string; done: number; total: number } | null>(null);
  let report = $state<BuildReport | null>(null);
  let error = $state<{ message: string; issues?: Array<{ path: string; message: string }> } | null>(null);
  let force = $state(false);

  onMount(() => studio.onBuildProgress((p) => (progress = p)));

  async function choose() { const d = await studio.chooseOutDir(); if (d) st.outDir = d; }
  async function build() {
    busy = true; error = null; report = null;
    try {
      if (st.dirty) await st.save();
      report = await studio.build({ outDir: st.outDir, basePath: st.basePath || undefined, force });
      st.notify('Website built');
    } catch (e) {
      error = { message: (e as Error).message, issues: (e as { issues?: Array<{ path: string; message: string }> }).issues };
    } finally { busy = false; }
  }
</script>

<h1>Build the website</h1>
<p class="muted">Vernissage writes a self-contained static site: an <code>index.html</code>, the viewer script and optimised images. Upload the whole folder to any web host.</p>
<p class="muted small">To try the result on this computer, use <strong>Open in browser</strong>: it serves the folder the way a web host would. Opening <code>index.html</code> straight from the folder shows only the portfolio, because browsers allow the 3D gallery only on pages that come from a web server.</p>

<div class="form">
  <label class="wide">Output folder
    <div class="row"><input readonly value={st.outDir} placeholder="Choose a folder…" /><button onclick={choose}>Choose…</button></div>
  </label>
  <label>Base path override <input bind:value={st.basePath} placeholder={st.gallery?.basePath ?? './'} /></label>
  <label class="check"><input type="checkbox" bind:checked={force} /> Allow writing into a folder that already contains other files</label>
</div>

<div class="row">
  <button class="primary big" disabled={busy || !st.outDir || st.errors.length > 0} onclick={build}>{busy ? 'Building…' : st.dirty ? 'Save and build' : 'Build website'}</button>
  {#if report || st.outDir}
    {@const dir = report?.outDir ?? st.outDir}
    <button disabled={busy} onclick={() => studio.openSite(dir).catch((e) => st.notify(e.message, 'error'))}>Open in browser</button>
    <button class="ghost" disabled={busy} onclick={() => studio.reveal(dir + '/index.html')}>Show in folder</button>
  {/if}
</div>
{#if st.errors.length}<p class="warn">Fix {st.errors.length} error(s) before building (see the badge at the top).</p>{/if}

{#if busy && progress}
  <div class="progress"><span style="width:{progress.total ? (progress.done / progress.total) * 100 : 0}%"></span></div>
  <p class="muted small">{progress.step}{progress.total > 1 ? ` ${progress.done}/${progress.total}` : ''}</p>
{/if}

{#if error}
  <div class="error-box"><strong>{error.message}</strong>{#if error.issues}<ul>{#each error.issues as i}<li>{i.path}: {i.message}</li>{/each}</ul>{/if}</div>
{/if}

{#if report}
  <div class="report">
    <h2>Done</h2>
    <p>{report.artworks} artworks in {report.rooms} rooms · {(report.bytes / 1e6).toFixed(1)} MB · {report.processed} images processed, {report.cached} reused · {(report.durationMs / 1000).toFixed(1)} s</p>
    <p class="muted small">{report.outDir}</p>
    {#if report.issues.length}
      <h3>Warnings</h3>
      <ul class="small">{#each report.issues as i}<li>{i.message}</li>{/each}</ul>
    {/if}
  </div>
{/if}
