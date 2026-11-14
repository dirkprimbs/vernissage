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
  import Changelog from './Changelog.svelte';
  import { parseChangelog, whatsNew, type Entry } from './changelog';
  import changelogText from '../../../../CHANGELOG.md?raw';

  let showIssues = $state(false);
  let showPreview = $state(true);
  /** the editor (navigation and settings) can be folded away to test-drive the gallery in the whole window */
  let showEditor = $state(true);
  /** the changelog dialog: what is new since the last visit, or all of it */
  let news = $state<{ entries: Entry[]; heading: string } | null>(null);
  const changelog = parseChangelog(changelogText);

  const panes: Array<{ id: Pane; label: string; hint: string }> = [
    { id: 'gallery', label: 'Gallery', hint: 'Title, light, entry door' },
    { id: 'plan', label: 'Rooms', hint: 'Add, size and position rooms' },
    { id: 'walls', label: 'Walls', hint: 'Hang and size artworks' },
    { id: 'library', label: 'Artworks', hint: 'Add works, edit their labels' },
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
    st.version = info.version;
    // after an update: what changed since this person last opened the studio
    const unseen = whatsNew(changelog, info.seenVersion, info.returning, info.version);
    if (unseen.length) news = { entries: unseen, heading: 'What’s new in Vernissage Studio' };
    void studio.markSeen();
    studio.onMenu(async (cmd) => {
      if (cmd === 'save') save();
      else if (cmd === 'save-and-close') { if (await save()) studio.closeWindow(true); }
      else if (cmd === 'close-project') closeProject();
      else if (cmd.startsWith('open:')) try { const p = await studio.openProject(cmd.slice(5)); if (p) st.load(p); } catch (e) { st.notify((e as Error).message, 'error'); }
    });

    // Ctrl/Cmd+E folds the editor away and brings it back
    window.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') { e.preventDefault(); toggleEditor(); } });
  });

  function toggleEditor() {
    showEditor = !showEditor;
    if (!showEditor) showPreview = true; // something has to be on screen
  }

  /** returns whether the project was saved */
  async function save() {
    try { await st.save(); return true; } catch (e) { st.notify((e as Error).message, 'error'); return false; }
  }

  /** back to the start screen, to open or create another project */
  function closeProject() {
    if (!st.gallery) return;
    if (!st.dirty || confirm('Close this project without saving your changes?')) st.gallery = null;
  }

  // the app needs to know about unsaved changes so that closing the window can ask about them
  $effect(() => { studio.setDirty(!!st.gallery && st.dirty, st.gallery?.title); });

  function issueTarget(path: string) {
    const [head, idx] = path.split('.');
    if (head === 'artworks') { st.pane = 'library'; st.artwork = st.gallery?.artworks[Number(idx)]?.id ?? st.artwork; }
    else if (head === 'rooms') { st.pane = path.includes('walls') ? 'walls' : 'plan'; st.room = st.gallery?.rooms[Number(idx)]?.id ?? st.room; }
    else st.pane = 'gallery';
    showIssues = false;
  }
</script>

{#if news}<Changelog entries={news.entries} heading={news.heading} onclose={() => (news = null)} />{/if}

{#if !st.gallery}
  <Start onchangelog={() => (news = { entries: changelog, heading: 'Changelog' })} />
{:else}
  <div class="shell" class:no-preview={!showPreview} class:no-editor={!showEditor}>
    <header class="top">
      <button class="ghost fold" onclick={toggleEditor} title="{showEditor ? 'Hide' : 'Show'} the editor (Ctrl+E)" aria-expanded={showEditor} aria-label="{showEditor ? 'Hide' : 'Show'} the editor">{showEditor ? '⟨' : '⟩'} {showEditor ? 'Hide editor' : 'Edit'}</button>
      <div class="brand">Vernissage <span>Studio</span></div>
      <button class="link small version" onclick={() => (news = { entries: changelog, heading: 'Changelog' })} title="What changed in each version">v{st.version}</button>
      <div class="project" title={st.dir}>{st.gallery.title}{#if st.dirty}<span class="dot" title="Unsaved changes">●</span>{/if}</div>
      <div class="spacer"></div>
      <button class="ghost issues" class:bad={st.errors.length} onclick={() => (showIssues = !showIssues)}>
        {st.errors.length ? `${st.errors.length} error${st.errors.length > 1 ? 's' : ''}` : 'Valid'}
        {#if st.issues.length - st.errors.length}· {st.issues.length - st.errors.length} warnings{/if}
      </button>
      {#if showEditor}<button class="ghost" onclick={() => (showPreview = !showPreview)}>{showPreview ? 'Hide' : 'Show'} preview</button>{/if}
      <button class="ghost" onclick={() => studio.closeWindow()} title="Close Vernissage Studio (File › Close project returns to the start screen)">Close</button>
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

    {#if showPreview}<aside class="preview"><Preview editing={showEditor} /></aside>{/if}
  </div>
{/if}

{#if st.message}<div class="toast {st.message.kind}" role="status">{st.message.text}</div>{/if}
