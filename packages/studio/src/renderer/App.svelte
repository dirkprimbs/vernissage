<script lang="ts">
  import { onMount } from 'svelte';
  import { studio } from './api';
  import { st, type Pane } from './state.svelte';
  import Start from './Start.svelte';
  import GalleryPane from './panes/GalleryPane.svelte';
  import FloorPlanPane from './panes/FloorPlanPane.svelte';
  import WallsPane from './panes/WallsPane.svelte';
  import LibraryPane from './panes/LibraryPane.svelte';
  import BuildPane from './panes/BuildPane.svelte';
  import Preview from './Preview.svelte';

  let showIssues = $state(false);
  let showPreview = $state(true);
  /** the editor (navigation and settings) can be folded away to test-drive the gallery in the whole window */
  let showEditor = $state(true);

  const panes: Array<{ id: Pane; label: string; hint: string }> = [
    { id: 'gallery', label: 'Gallery', hint: 'Title, light, entry door' },
    { id: 'plan', label: 'Rooms', hint: 'Add, size and position rooms' },
    { id: 'walls', label: 'Walls', hint: 'Hang and size artworks' },
    { id: 'library', label: 'Library', hint: 'Artworks and provenance' },
    { id: 'build', label: 'Build', hint: 'Export the static website' },
  ];

  // validation whenever anything in the working copy changes
  $effect(() => {
    if (!st.gallery) return;
    JSON.stringify(st.gallery);
    const t = setTimeout(() => st.validate(), 200);
    return () => clearTimeout(t);
  });

  onMount(async () => {
    const info = await studio.info();
    st.previewBase = info.previewBase;
    studio.onMenu(async (cmd) => {
      if (cmd === 'save') save();
      else if (cmd.startsWith('open:')) try { const p = await studio.openProject(cmd.slice(5)); if (p) st.load(p); } catch (e) { st.notify((e as Error).message, 'error'); }
    });
    window.addEventListener('beforeunload', (e) => { if (st.dirty) e.preventDefault(); });
    // Ctrl/Cmd+E folds the editor away and brings it back
    window.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') { e.preventDefault(); toggleEditor(); } });
  });

  function toggleEditor() {
    showEditor = !showEditor;
    if (!showEditor) showPreview = true; // something has to be on screen
  }

  async function save() {
    try { await st.save(); } catch (e) { st.notify((e as Error).message, 'error'); }
  }

  function issueTarget(path: string) {
    const [head, idx] = path.split('.');
    if (head === 'artworks') { st.pane = 'library'; st.artwork = st.gallery?.artworks[Number(idx)]?.id ?? st.artwork; }
    else if (head === 'rooms') { st.pane = path.includes('walls') ? 'walls' : 'plan'; st.room = st.gallery?.rooms[Number(idx)]?.id ?? st.room; }
    else st.pane = 'gallery';
    showIssues = false;
  }
</script>

{#if !st.gallery}
  <Start />
{:else}
  <div class="shell" class:no-preview={!showPreview} class:no-editor={!showEditor}>
    <header class="top">
      <button class="ghost fold" onclick={toggleEditor} title="{showEditor ? 'Hide' : 'Show'} the editor (Ctrl+E)" aria-expanded={showEditor} aria-label="{showEditor ? 'Hide' : 'Show'} the editor">{showEditor ? '⟨' : '⟩'} {showEditor ? 'Hide editor' : 'Edit'}</button>
      <div class="brand">Vernissage <span>Studio</span></div>
      <div class="project" title={st.dir}>{st.gallery.title}{#if st.dirty}<span class="dot" title="Unsaved changes">●</span>{/if}</div>
      <div class="spacer"></div>
      <button class="ghost issues" class:bad={st.errors.length} onclick={() => (showIssues = !showIssues)}>
        {st.errors.length ? `${st.errors.length} error${st.errors.length > 1 ? 's' : ''}` : 'Valid'}
        {#if st.issues.length - st.errors.length}· {st.issues.length - st.errors.length} warnings{/if}
      </button>
      {#if showEditor}<button class="ghost" onclick={() => (showPreview = !showPreview)}>{showPreview ? 'Hide' : 'Show'} preview</button>{/if}
      <button class="ghost" onclick={() => { if (!st.dirty || confirm('Discard unsaved changes?')) st.gallery = null; }}>Close</button>
      <button class="primary" disabled={!st.dirty} onclick={save}>Save</button>
    </header>

    {#if showIssues}
      <div class="issues-panel">
        {#each st.issues as i}
          <button class="issue {i.severity}" onclick={() => issueTarget(i.path)}><b>{i.severity === 'error' ? '✗' : '!'}</b> {i.message}<small>{i.path}</small></button>
        {:else}<p class="muted">No problems found.</p>{/each}
      </div>
    {/if}

    {#if showEditor}
    <nav class="side">
      {#each panes as p}
        <button class:active={st.pane === p.id} onclick={() => (st.pane = p.id)}><strong>{p.label}</strong><span>{p.hint}</span></button>
      {/each}
    </nav>

    <main class="pane">
      {#if st.pane === 'gallery'}<GalleryPane />
      {:else if st.pane === 'plan'}<FloorPlanPane />
      {:else if st.pane === 'walls'}<WallsPane />
      {:else if st.pane === 'library'}<LibraryPane />
      {:else}<BuildPane />{/if}
    </main>
    {/if}

    {#if showPreview}<aside class="preview"><Preview /></aside>{/if}
  </div>
{/if}

{#if st.message}<div class="toast {st.message.kind}" role="status">{st.message.text}</div>{/if}
