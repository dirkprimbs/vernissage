<script lang="ts">
  import { WALL_SIDES, blockersOn, computeFloorPlan, entranceOf, hangWall, resolveStyle, type HangResult, type StyleDef, type WallSide } from '@vernissage/schema';
  import { st } from '../state.svelte';

  const g = $derived(st.gallery!);
  const room = $derived(g.rooms.find((r) => r.id === st.room) ?? g.rooms[0]);
  const plan = $derived.by(() => { try { return computeFloorPlan($state.snapshot(g) as typeof g); } catch { return null; } });
  const style = $derived(resolveStyle(g.style.preset, g.style.overrides as Partial<StyleDef>));
  const byId = $derived(new Map(g.artworks.map((a) => [a.id, a])));
  const unhung = $derived(g.artworks.filter((a) => !st.placementOf(a.id)));
  const sideNames: Record<WallSide, string> = { north: 'North wall', east: 'East wall', south: 'South wall', west: 'West wall' };

  function hung(side: WallSide): HangResult & { length: number } {
    const pr = plan?.rooms.find((r) => r.room.id === room.id);
    if (!pr) return { works: [], warnings: [], length: 1 };
    const res = hangWall({
      wall: $state.snapshot(room.walls[side]) as typeof room.walls.north, length: pr.walls[side].length, roomHeight: room.height,
      doors: blockersOn($state.snapshot(g) as typeof g, plan!, room.id, side), artworks: byId,
      aspect: (id) => { const a = byId.get(id); const m = a && st.meta[a.file]; return m ? m.width / m.height : undefined; },
      styleFrame: style.frame, ...$state.snapshot(g.display),
    });
    return { ...res, length: pr.walls[side].length };
  }

  let dragOver = $state<WallSide | null>(null);
  function drop(e: DragEvent, side: WallSide) {
    e.preventDefault();
    dragOver = null;
    const id = e.dataTransfer?.getData('text/x-vernissage-art');
    if (!id) return;
    if (room.walls[side].windows) { st.notify('This wall has windows. Untick “Windows” to hang art on it.'); return; }
    st.hang(id, room.id, side);
  }
  function startDrag(e: DragEvent, id: string) { e.dataTransfer?.setData('text/x-vernissage-art', id); e.dataTransfer!.effectAllowed = 'move'; }
  function move(side: WallSide, i: number, d: number) {
    const list = room.walls[side].artworks;
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const [p] = list.splice(i, 1);
    list.splice(j, 0, p);
  }
  function distribute() {
    // spread unhung works over this room's closed walls, longest walls first
    const sides = [...WALL_SIDES].filter((s) => !room.walls[s].windows).sort((a, b) => wallLen(b) - wallLen(a));
    if (!sides.length) return;
    let k = 0;
    for (const a of unhung) { st.hang(a.id, room.id, sides[k % sides.length]); k++; }
  }
  const wallLen = (s: WallSide) => (s === 'north' || s === 'south' ? room.width : room.depth);
  const auto = $derived(g.display.sizing === 'auto');
  const entrance = $derived(plan ? entranceOf($state.snapshot(g) as typeof g, plan) : undefined);
  /** closed walls that carry art come first; a windowed wall is for the view */
  function setWindows(side: WallSide, on: boolean) {
    const w = room.walls[side];
    if (on && w.artworks.length && !confirm(`Take the ${w.artworks.length} artworks off this wall to make room for windows? They stay in the library.`)) return;
    if (on) for (const p of [...w.artworks]) st.unhang(p.artwork);
    w.windows = on;
  }
</script>

<h1>Walls</h1>
<p class="muted small">Drag works onto a wall. They are sized and spaced to suit the wall: the more works, the smaller each one. Use a work's Size slider to make it larger or smaller than its neighbours.</p>
<div class="form">
  <label>Room
    <select bind:value={st.room}>{#each g.rooms as r, i}<option value={r.id}>{i + 1}. {r.name}</option>{/each}</select>
  </label>
  <button disabled={!unhung.length} onclick={distribute}>Hang all {unhung.length} unhung works in this room</button>
</div>

<div class="walls-layout">
  <div class="walls">
    {#each WALL_SIDES as side}
      {@const w = room.walls[side]}
      {@const res = hung(side)}
      {@const H = room.height}
      <section class="wall-card" class:over={dragOver === side} ondragover={(e) => { e.preventDefault(); dragOver = side; }} ondragleave={() => (dragOver = null)} ondrop={(e) => drop(e, side)} aria-label={sideNames[side]}>
        <header>
          <strong>{sideNames[side]}</strong><span class="muted small">{res.length} m</span>
          <span class="spacer"></span>
          <label class="check small"><input type="checkbox" checked={!!w.windows} onchange={(e) => setWindows(side, e.currentTarget.checked)} /> Windows</label>
          {#if !w.windows}<select bind:value={w.hang} aria-label="Hanging style"><option value="centred">In a line</option><option value="salon">Stacked</option><option value="grid">Grid</option></select>{/if}
        </header>
        <svg class="elevation" viewBox="0 0 {res.length} {H}" preserveAspectRatio="xMidYMid meet">
          <rect width={res.length} height={H} fill={w.color ?? room.wallColor ?? style.wall} />
          {#each plan?.doors.filter((d) => d.roomId === room.id && d.wall === side) ?? [] as d}
            <rect x={d.offset - d.width / 2} y={H - d.height} width={d.width} height={d.height} fill="#00000055" />
          {/each}
          {#if entrance && entrance.roomId === room.id && entrance.wall === side}
            <rect x={entrance.offset - entrance.width / 2} y={H - entrance.height} width={entrance.width} height={entrance.height} fill="#2b2f33" stroke="#3fbf6f" stroke-width="0.04" />
          {/if}
          {#if w.windows}
            <rect x="0.8" y={H - Math.min(H - 0.45, 2.9)} width={Math.max(0, res.length - 1.6)} height={Math.min(H - 0.45, 2.9) - 0.75} fill="#6fb7e855" stroke="#6fb7e8" stroke-width="0.04" />
          {/if}
          <line x1="0" x2={res.length} y1={H - 1.45} y2={H - 1.45} stroke="#ffffff55" stroke-width="0.01" stroke-dasharray="0.1 0.1" />
          {#each res.works as hw}
            {@const a = byId.get(hw.artworkId)}
            <rect x={hw.offset - hw.outerW / 2} y={H - hw.y - hw.outerH / 2} width={hw.outerW} height={hw.outerH} fill={hw.frame.color} />
            {#if a}<image href={st.thumb(a.file)} x={hw.offset - hw.width / 2} y={H - hw.y - hw.height / 2} width={hw.width} height={hw.height} preserveAspectRatio="none" />{/if}
            <rect x={hw.label.offset - hw.label.w / 2} y={H - hw.label.y - hw.label.h / 2} width={hw.label.w} height={hw.label.h} fill={style.labelBackground} />
          {/each}
        </svg>
        {#if res.warnings.length}<p class="warn small">{res.warnings.join(' · ')}</p>{/if}
        <ol class="placements">
          {#each w.artworks as p, i (p.artwork)}
            {@const a = byId.get(p.artwork)}
            {@const hw = res.works[i]}
            <li class="hung">
              <!-- only the grip and the thumbnail pick the work up, so the slider can be dragged freely -->
              <span class="grip" draggable="true" ondragstart={(e) => startDrag(e, p.artwork)} title="Drag to another wall" aria-hidden="true">⠿</span>
              {#if a}<img src={st.thumb(a.file)} alt="" draggable="true" ondragstart={(e) => startDrag(e, p.artwork)} />{/if}
              <button class="link" onclick={() => { st.artwork = p.artwork; st.pane = 'library'; }}>{a?.title ?? p.artwork}</button>
              <button class="ghost small" onclick={() => move(side, i, -1)} disabled={i === 0} aria-label="Move left">←</button>
              <button class="ghost small" onclick={() => move(side, i, 1)} disabled={i === w.artworks.length - 1} aria-label="Move right">→</button>
              <button class="ghost small danger" onclick={() => st.unhang(p.artwork)} aria-label="Take down">✕</button>
              <label class="small size-row" title={auto ? 'Size compared with the other works on this wall' : 'Extra scale on top of the real size'}>Size
                <input type="range" min="0.4" max="2.5" step="0.05" value={p.scale ?? 1} aria-label="Size of {a?.title ?? p.artwork}" oninput={(e) => (p.scale = +e.currentTarget.value === 1 ? undefined : +e.currentTarget.value)} />
                <output>{Math.round((p.scale ?? 1) * 100)}%</output>
                {#if hw}<span class="actual" title="Size of the picture on the wall, without frame">{Math.round(hw.width * 100)} × {Math.round(hw.height * 100)} cm</span>{/if}
                <button class="link small reset" style:visibility={p.scale === undefined ? 'hidden' : 'visible'} onclick={() => (p.scale = undefined)}>reset</button>
              </label>
            </li>
          {:else}<li class="muted small">{w.windows ? 'A windowed wall: it shows the view' : 'Drop artworks here'}</li>{/each}
        </ol>
      </section>
    {/each}
  </div>
  <aside class="tray">
    <h3>Not hung yet</h3>
    {#each unhung as a (a.id)}
      <div class="tray-item" draggable="true" ondragstart={(e) => startDrag(e, a.id)} role="listitem">
        <img src={st.thumb(a.file)} alt="" /><span>{a.title}</span>
      </div>
    {:else}<p class="muted small">Every artwork is on a wall. Drag works between walls to move them.</p>{/each}
  </aside>
</div>
