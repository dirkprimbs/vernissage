<script lang="ts">
  import { WALL_SIDES, blockersOn, computeFloorPlan, doorsOn, entranceOf, hangWall, plantSize, pointOnWall, resolveStyle, roomPlants, wallHasWindows, type FloorPlan, type Gallery, type StyleDef } from '@vernissage/schema';
  import { st } from './state.svelte';

  /** Plants of one room, on a plan of the room: click to add, drag to move, select to resize or remove. */
  let { roomId }: { roomId: string } = $props();
  const g = $derived(st.gallery!);
  const room = $derived(g.rooms.find((r) => r.id === roomId)!);
  const snap = $derived($state.snapshot(g) as Gallery);
  const plan = $derived.by((): FloorPlan | null => { try { return computeFloorPlan(snap); } catch { return null; } });
  const pr = $derived(plan?.rooms.find((r) => r.room.id === roomId));
  const style = $derived(resolveStyle(g.style.preset, g.style.overrides as Partial<StyleDef>));
  const aspect = (id: string) => { const a = g.artworks.find((x) => x.id === id); const m = a && st.meta[a.file]; return m ? m.width / m.height : undefined; };
  /** the room's plants in world metres: its own list, or the automatic ones */
  const spots = $derived(plan && pr ? roomPlants({ ...snap, environment: { ...snap.environment, plants: true } }, plan, { aspect, styleFrame: style.frame }).get(roomId) ?? [] : []);
  const byHand = $derived(room.plants !== undefined);
  /** what is on the walls, so plants can be kept out of the way of pictures and doors */
  const marks = $derived.by(() => {
    const works: Array<{ x1: number; z1: number; x2: number; z2: number }> = [], doors: typeof works = [], windows: typeof works = [];
    if (!plan || !pr) return { works, doors, windows };
    const line = (side: (typeof WALL_SIDES)[number], a: number, b: number, inset: number) => { const w = pr.walls[side], p = pointOnWall(w, a, inset), q = pointOnWall(w, b, inset); return { x1: p.x, z1: p.z, x2: q.x, z2: q.z }; };
    const byId = new Map(snap.artworks.map((a) => [a.id, a]));
    const e = entranceOf(snap, plan);
    for (const side of WALL_SIDES) {
      const w = pr.walls[side];
      for (const d of doorsOn(plan, roomId, side)) doors.push(line(side, d.offset - d.width / 2, d.offset + d.width / 2, 0));
      if (e && e.roomId === roomId && e.wall === side) doors.push(line(side, e.offset - e.width / 2, e.offset + e.width / 2, 0));
      if (wallHasWindows(snap, pr.room, side)) windows.push(line(side, 0.8, w.length - 0.8, 0));
      const res = hangWall({ wall: pr.room.walls[side], length: w.length, roomHeight: pr.room.height, doors: blockersOn(snap, plan, roomId, side), artworks: byId, aspect, styleFrame: style.frame, ...snap.display });
      for (const hw of res.works) works.push(line(side, hw.offset - hw.outerW / 2, hw.offset + hw.outerW / 2, 0.12));
    }
    return { works, doors, windows };
  });

  let picked = $state<number | null>(null);
  let drag: { i: number; moved: boolean } | null = null;
  const round = (v: number) => Math.round(v * 100) / 100;
  /** Editing starts from what is there: the automatic plants become the room's own list. */
  function own() {
    if (!room.plants && pr) room.plants = spots.map((s) => ({ x: round(s.x - pr.centre.x), z: round(s.z - pr.centre.z), size: round(s.scale) }));
    return (room.plants ??= []);
  }
  function at(e: PointerEvent) {
    const svg = (e.currentTarget as SVGElement).closest('svg')!;
    const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    const q = p.matrixTransform(svg.getScreenCTM()!.inverse());
    // a pot needs its own width clear of the walls
    const hw = room.width / 2 - 0.3, hd = room.depth / 2 - 0.3;
    return { x: round(Math.min(hw, Math.max(-hw, q.x - pr!.centre.x))), z: round(Math.min(hd, Math.max(-hd, q.y - pr!.centre.z))) };
  }
  function addAt(e: PointerEvent) {
    if (!pr || own().length >= 40) return;
    own().push(at(e));
    picked = own().length - 1;
  }
  function grab(e: PointerEvent, i: number) {
    e.stopPropagation();
    own();
    picked = i;
    drag = { i, moved: false };
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
  }
  function move(e: PointerEvent) {
    if (!drag || !pr) return;
    const p = at(e), q = own()[drag.i];
    if (q) { q.x = p.x; q.z = p.z; drag.moved = true; }
  }
  function remove(i: number) { own().splice(i, 1); picked = null; }
  function key(e: KeyboardEvent) { if (picked !== null && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); remove(picked); } }
  // another room: nothing is selected there yet
  $effect(() => { void roomId; picked = null; });
  const sel = $derived(picked !== null ? room.plants?.[picked] : undefined);
</script>

<h2>Plants <span class="muted small">{byHand ? 'placed by hand' : 'placed automatically'}</span></h2>
{#if !g.environment.plants}
  <p class="muted small">Plants are switched off for this gallery (<code>environment.plants</code> in gallery.json).</p>
{:else if pr}
  <p class="muted small">Click the floor to add a plant, drag a plant to move it, and select one to resize or remove it. Automatic plants stay clear of pictures and doors; once you change anything here, this room keeps exactly the plants you see.</p>
  <!-- the plan is a small drawing surface: pointer and Delete-key handling live on it -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <svg class="plants-plan" viewBox="{pr.minX - 0.6} {pr.minZ - 0.6} {pr.room.width + 1.2} {pr.room.depth + 1.2}" onpointermove={move} onpointerup={() => (drag = null)} onkeydown={key} tabindex="0" role="application" aria-label="Plants in {room.name}">
    <rect class="floor" x={pr.minX} y={pr.minZ} width={pr.room.width} height={pr.room.depth} onpointerdown={addAt} role="presentation" />
    {#each marks.windows as l}<line class="window" x1={l.x1} y1={l.z1} x2={l.x2} y2={l.z2} />{/each}
    {#each marks.doors as l}<line class="door" x1={l.x1} y1={l.z1} x2={l.x2} y2={l.z2} />{/each}
    {#each marks.works as l}<line class="work" x1={l.x1} y1={l.z1} x2={l.x2} y2={l.z2} />{/each}
    {#each spots as s, i}
      <circle class="plant" class:sel={picked === i} cx={s.x} cy={s.z} r={0.32 * s.scale} onpointerdown={(e) => grab(e, i)} role="button" tabindex="-1" aria-label="Plant {i + 1}" />
    {/each}
  </svg>
  <p class="muted small plants-key"><i class="k work"></i> pictures <i class="k door"></i> doors <i class="k window"></i> windows <i class="k plant"></i> plants</p>
  <div class="form plants-tools">
    {#if sel && picked !== null}
      <label>Size of the selected plant
        <input type="range" min="0.5" max="2.2" step="0.05" value={sel.size ?? plantSize(room.height)} oninput={(e) => (sel.size = +e.currentTarget.value)} />
        <output>{Math.round((sel.size ?? plantSize(room.height)) * 130)} cm</output>
      </label>
      <button class="danger" onclick={() => remove(picked!)}>Remove this plant</button>
    {/if}
    {#if spots.length}<button onclick={() => { room.plants = []; picked = null; }}>Remove all</button>{/if}
    {#if byHand}<button onclick={() => { room.plants = undefined; picked = null; }} title="Forget the plants placed by hand in this room">Back to automatic</button>{/if}
  </div>
{/if}
