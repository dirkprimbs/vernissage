<script lang="ts">
  import { WALL_SIDES, computeFloorPlan, entranceOf, wallHasWindows, type FloorPlan } from '@vernissage/schema';
  import { st, newRoom } from '../state.svelte';

  const g = $derived(st.gallery!);
  const plan = $derived.by((): FloorPlan | null => { try { return computeFloorPlan($state.snapshot(g) as typeof g); } catch { return null; } });
  const sel = $derived(g.rooms.find((r) => r.id === st.room) ?? g.rooms[0]);
  const view = $derived.by(() => {
    if (!plan) return '0 0 10 10';
    const b = plan.bounds, pad = 1.5;
    return `${b.minX - pad} ${b.minZ - pad} ${b.maxX - b.minX + pad * 2} ${b.maxZ - b.minZ + pad * 2}`;
  });

  let drag: { id: string; x: number; z: number; ox: number; oz: number } | null = null;

  function setCount(n: number) {
    n = Math.max(1, Math.min(30, n));
    while (g.rooms.length < n) g.rooms.push(newRoom(g.rooms.map((r) => r.id), g.rooms.length + 1));
    while (g.rooms.length > n) {
      const r = g.rooms[g.rooms.length - 1];
      const hung = Object.values(r.walls).reduce((s, w) => s + w.artworks.length, 0);
      if (hung && !confirm(`"${r.name}" has ${hung} artworks on its walls. Remove it anyway? The artworks stay in the library.`)) break;
      g.rooms.pop();
    }
    if (!g.rooms.some((r) => r.id === st.room)) st.room = g.rooms[0].id;
  }
  function move(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= g.rooms.length) return;
    const [r] = g.rooms.splice(i, 1);
    g.rooms.splice(j, 0, r);
  }
  function remove(i: number) {
    if (g.rooms.length === 1) return;
    const r = g.rooms[i];
    if (!confirm(`Remove "${r.name}"? Its artworks stay in the library.`)) return;
    g.rooms.splice(i, 1);
    st.room = g.rooms[Math.max(0, i - 1)].id;
  }
  function setMode(m: 'linear' | 'grid' | 'custom') {
    if (m === 'custom' && plan) for (const pr of plan.rooms) { const r = g.rooms.find((x) => x.id === pr.room.id); if (r && !r.position) r.position = { x: Math.round(pr.centre.x * 10) / 10, z: Math.round(pr.centre.z * 10) / 10 }; }
    g.layout.mode = m;
  }
  function addRoom() {
    const r = newRoom(g.rooms.map((x) => x.id), g.rooms.length + 1) as (typeof g.rooms)[number];
    // in free placement the new room goes to the east of the last one, a doorway's width away
    const last = plan?.rooms[plan.rooms.length - 1];
    if (g.layout.mode === 'custom' && last) r.position = { x: Math.round((last.maxX + g.layout.gap + r.width / 2) * 2) / 2, z: last.centre.z };
    g.rooms.push(r);
    st.room = r.id;
  }
  const entrance = $derived(plan ? entranceOf($state.snapshot(g) as typeof g, plan) : undefined);
  function svgPoint(e: PointerEvent) {
    const svg = (e.currentTarget as SVGElement).closest('svg')!;
    const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    const q = p.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: q.x, z: q.y };
  }
  function down(e: PointerEvent, id: string) {
    st.room = id;
    // dragging a room is positioning it by hand: switch to free placement, keeping every room where it is
    if (g.layout.mode !== 'custom') setMode('custom');
    const r = g.rooms.find((x) => x.id === id);
    if (!r?.position) return;
    const p = svgPoint(e);
    drag = { id, x: p.x, z: p.z, ox: r.position.x, oz: r.position.z };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  function moveDrag(e: PointerEvent) {
    if (!drag) return;
    const p = svgPoint(e);
    const r = g.rooms.find((x) => x.id === drag!.id);
    const snap = (v: number) => Math.round(v * 2) / 2;
    if (r?.position) { r.position.x = snap(drag.ox + p.x - drag.x); r.position.z = snap(drag.oz + p.z - drag.z); }
  }
</script>

<h1>Floor plan</h1>
<div class="form">
  <button class="primary" onclick={addRoom}>+ Add room</button>
  <label>Arrangement
    <select value={g.layout.mode} onchange={(e) => setMode(e.currentTarget.value as 'linear' | 'grid' | 'custom')}>
      <option value="linear">In a row</option><option value="grid">Grid</option><option value="custom">Free (as placed)</option>
    </select>
  </label>
  {#if g.layout.mode === 'grid'}<label>Columns <input type="number" min="1" max="10" bind:value={g.layout.columns} /></label>{/if}
  <label>Gap between rooms (m) <input type="number" min="0.4" max="10" step="0.1" bind:value={g.layout.gap} /></label>
</div>
<p class="muted small">Drag a room to position it. Doorways are added automatically between rooms that follow each other and face each other across a gap of up to 8 m. Blue: windowed walls. Green: the entry door.</p>

<div class="plan-wrap">
  {#if plan}
    <svg class="plan" viewBox={view} onpointermove={moveDrag} onpointerup={() => (drag = null)} role="img" aria-label="Floor plan">
      {#each plan.passages as p}<rect class="passage" x={p.minX} y={p.minZ} width={p.maxX - p.minX} height={p.maxZ - p.minZ} />{/each}
      {#each plan.rooms as pr, i}
        <g class="room" class:sel={pr.room.id === sel?.id} onpointerdown={(e) => down(e, pr.room.id)} role="button" tabindex="0" onkeydown={() => (st.room = pr.room.id)}>
          <rect x={pr.minX} y={pr.minZ} width={pr.room.width} height={pr.room.depth} />
          <text x={pr.centre.x} y={pr.centre.z - 0.3} font-size="0.8">{i + 1}. {pr.room.name}</text>
          <text x={pr.centre.x} y={pr.centre.z + 0.7} font-size="0.55" class="dim">{pr.room.width} × {pr.room.depth} × {pr.room.height} m</text>
        </g>
      {/each}
      {#each plan.rooms as pr}
        {#each WALL_SIDES as side}
          {#if wallHasWindows(g, pr.room, side)}
            {@const w = pr.walls[side]}
            <line class="window" x1={w.start.x + w.along.x * 0.8} y1={w.start.z + w.along.z * 0.8} x2={w.start.x + w.along.x * (w.length - 0.8)} y2={w.start.z + w.along.z * (w.length - 0.8)} />
          {/if}
        {/each}
      {/each}
      {#if entrance}
        {@const w = plan.rooms[0].walls[entrance.wall]}
        <circle class="entry" cx={w.start.x + w.along.x * entrance.offset} cy={w.start.z + w.along.z * entrance.offset} r="0.45" />
      {/if}
      {#each plan.doors as d}
        {@const w = plan.rooms.find((r) => r.room.id === d.roomId)!.walls[d.wall]}
        <line class="door" x1={w.start.x + w.along.x * (d.offset - d.width / 2)} y1={w.start.z + w.along.z * (d.offset - d.width / 2)} x2={w.start.x + w.along.x * (d.offset + d.width / 2)} y2={w.start.z + w.along.z * (d.offset + d.width / 2)} />
      {/each}
    </svg>
  {:else}<p class="muted">Fix the room settings to see the plan.</p>{/if}
</div>

<h2>Rooms</h2>
<div class="room-list">
  {#each g.rooms as r, i (r.id)}
    <div class="room-row" class:sel={r.id === sel?.id}>
      <button class="link" onclick={() => (st.room = r.id)}>{i + 1}. {r.name}</button>
      <span class="muted small">{Object.values(r.walls).reduce((s, w) => s + w.artworks.length, 0)} works</span>
      <span class="spacer"></span>
      <button class="ghost small" disabled={i === 0} onclick={() => move(i, -1)} aria-label="Move up">↑</button>
      <button class="ghost small" disabled={i === g.rooms.length - 1} onclick={() => move(i, 1)} aria-label="Move down">↓</button>
      <button class="ghost small danger" disabled={g.rooms.length === 1} onclick={() => remove(i)}>Remove</button>
    </div>
  {/each}
  <button onclick={addRoom}>+ Add room</button>
</div>

{#if sel}
  <h2>{sel.name}</h2>
  <div class="form">
    <label>Name <input bind:value={sel.name} /></label>
    <label>Id <input value={sel.id} disabled /></label>
    <label class="wide">Description <input bind:value={sel.description} placeholder="Shown when visitors enter" /></label>
    <label>Width (m) <input type="range" min="3" max="40" step="0.5" bind:value={sel.width} /><output>{sel.width}</output></label>
    <label>Depth (m) <input type="range" min="3" max="40" step="0.5" bind:value={sel.depth} /><output>{sel.depth}</output></label>
    <label>Ceiling height (m) <input type="range" min="2.6" max="12" step="0.1" bind:value={sel.height} /><output>{sel.height}</output></label>
    <label class="color">Wall colour <input type="color" value={sel.wallColor ?? '#ffffff'} oninput={(e) => (sel.wallColor = e.currentTarget.value)} />
      {#if sel.wallColor}<button class="link small" onclick={() => (sel.wallColor = undefined)}>use style colour</button>{/if}
    </label>
    {#if g.layout.mode === 'custom' && sel.position}
      <label>Centre x (m) <input type="number" step="0.5" bind:value={sel.position.x} /></label>
      <label>Centre z (m) <input type="number" step="0.5" bind:value={sel.position.z} /></label>
    {/if}
  </div>
{/if}
