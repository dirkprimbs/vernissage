<script lang="ts">
  import { NOTE_COLORS, PIN_FORMATS, type PinFormat } from '@vernissage/schema';
  import { studio } from './api';
  import { st, uniqueId } from './state.svelte';

  /** A room's pinboard: instant photos with a line written on them, and notes. */
  let { roomId }: { roomId: string } = $props();
  const g = $derived(st.gallery!);
  const room = $derived(g.rooms.find((r) => r.id === roomId)!);
  const items = $derived(room.pinboard?.items ?? []);
  const formatNames: Record<PinFormat, string> = { mini: 'Mini (upright)', square: 'Square', wide: 'Wide' };
  const paper: Record<(typeof NOTE_COLORS)[number], string> = { yellow: '#fbe98a', pink: '#f9c0d3', blue: '#bfe0f6', green: '#cdeab4', white: '#fbfaf5' };
  const full = $derived(items.length >= 60);
  // a board or card picked in the preview: bring the editor (and the card's entry) into view
  let section = $state<HTMLElement>();
  const focus = $derived(st.pinFocus?.room === roomId ? st.pinFocus : null);
  $effect(() => {
    const f = focus;
    if (!f || f.quiet) return;
    void f.n;
    queueMicrotask(() => {
      const row = f.id ? section?.parentElement?.querySelector(`[data-pin="${CSS.escape(f.id)}"]`) : null;
      (row ?? section)?.scrollIntoView({ block: row ? 'center' : 'start', behavior: 'smooth' });
    });
  });

  function toggle(on: boolean) {
    if (on) room.pinboard = { items: [] };
    else if (!items.length || confirm(`Take the pinboard with its ${items.length} item${items.length > 1 ? 's' : ''} out of ${room.name}? The image files stay in the project's assets folder.`)) room.pinboard = undefined;
  }
  const taken = () => items.map((i) => i.id);
  async function addPhotos() {
    try {
      for (const a of await studio.importAssets()) {
        if (room.pinboard!.items.length >= 60) break;
        // a landscape picture suits the wide format, an upright one the mini
        const format: PinFormat = a.width > a.height * 1.15 ? 'wide' : a.height > a.width * 1.15 ? 'mini' : 'square';
        room.pinboard!.items.push({ id: uniqueId(a.id, taken()), kind: 'photo', file: a.file, format });
        st.meta[a.file] = { width: a.width, height: a.height, color: a.color };
      }
    } catch (e) { st.notify((e as Error).message, 'error'); }
  }
  function addNote() {
    room.pinboard!.items.push({ id: uniqueId('note', taken()), kind: 'note', text: '', color: NOTE_COLORS[items.filter((i) => i.kind === 'note').length % NOTE_COLORS.length] });
  }
  /** later in the list means further on top where cards overlap */
  function reorder(i: number, d: number) {
    const list = room.pinboard!.items, j = i + d;
    if (j < 0 || j >= list.length) return;
    const [it] = list.splice(i, 1);
    list.splice(j, 0, it);
  }
  /** back to where the board would put it by itself */
  function unplace(i: number) { const it = room.pinboard!.items[i]; it.x = undefined; it.y = undefined; it.tilt = undefined; }
</script>

<h2 bind:this={section} class="pin-head">Pinboard</h2>
<div class="form">
  <label class="check wide"><input type="checkbox" checked={!!room.pinboard} onchange={(e) => { toggle(e.currentTarget.checked); e.currentTarget.checked = !!room.pinboard; }} /> A pinboard next to this room's door</label>
</div>
{#if room.pinboard}
  <p class="muted small">Photos hang as instant pictures with a short line on the white border; notes are written in Markdown, so they can carry links. Click the board or a card in the preview to get here. Drag a card in the preview to give it its place; turn the mouse wheel while holding it, or use the slider here, to rotate it. Where cards overlap, the one further down this list lies on top (a card you drop onto another in the preview goes right after it). Visitors can move the cards too: each visitor's arrangement stays in their own browser.</p>
  <ul class="pin-list">
    {#each room.pinboard.items as it, i (it.id)}
      <li data-pin={it.id} class:picked={focus?.id === it.id}>
        {#if it.kind === 'photo'}
          <img src={st.thumb(it.file)} alt="" />
          <div class="pin-fields">
            <label>Written on the photo <input bind:value={it.caption} maxlength="60" placeholder="A short line" /></label>
            <label>Format <select bind:value={it.format}>{#each PIN_FORMATS as f}<option value={f}>{formatNames[f]}</option>{/each}</select></label>
          </div>
        {:else}
          <span class="pin-swatch" style:background={paper[it.color]}></span>
          <div class="pin-fields">
            <label class="wide">Note <textarea bind:value={it.text} rows="3" maxlength="2000" placeholder="Markdown: **bold**, - lists, [a link](https://example.org)"></textarea></label>
            <label>Paper <select bind:value={it.color}>{#each NOTE_COLORS as c}<option value={c}>{c}</option>{/each}</select></label>
          </div>
        {/if}
        <label class="pin-turn small" title="Turn the card: left of the middle anticlockwise, right of it clockwise">Turned
          <input type="range" min="-180" max="180" step="1" value={it.tilt ?? 0} oninput={(e) => (it.tilt = +e.currentTarget.value)} aria-label="Turn the card, in degrees" />
          <output>{it.tilt === undefined ? 'a little, by itself' : `${it.tilt}°`}</output>
        </label>
        <div class="pin-actions">
          {#if it.x !== undefined || it.tilt !== undefined}<button class="link small" onclick={() => unplace(i)} title="Let the board place it again">reset place</button>{/if}
          <span class="pin-order">
            <button class="ghost small" disabled={i === 0} onclick={() => reorder(i, -1)} aria-label="Further underneath" title="Further underneath where cards overlap">↑</button>
            <button class="ghost small" disabled={i === items.length - 1} onclick={() => reorder(i, 1)} aria-label="Further on top" title="Further on top where cards overlap">↓</button>
            <button class="ghost small danger" onclick={() => room.pinboard!.items.splice(i, 1)} aria-label="Remove from the pinboard">✕</button>
          </span>
        </div>
      </li>
    {:else}<li class="muted small">Nothing is pinned yet.</li>{/each}
  </ul>
  <div class="row">
    <button class="primary" disabled={full} onclick={addPhotos}>+ Add photos…</button>
    <button disabled={full} onclick={addNote}>+ Add note</button>
    {#if full}<span class="muted small">A board holds up to 60 cards.</span>{/if}
  </div>
{/if}
