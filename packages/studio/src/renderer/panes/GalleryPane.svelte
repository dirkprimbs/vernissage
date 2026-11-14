<script lang="ts">
  import { LIGHTING, LIGHTING_IDS, LANDSCAPE_IDS, type LandscapeId } from '@vernissage/schema';
  import { st } from '../state.svelte';

  const g = $derived(st.gallery!);
  const landNames: Record<LandscapeId, string> = { toronto: 'Toronto skyline across the lake', lake: 'Lake shore' };
  let urlError = $state('');
  function setUrl(v: string) {
    v = v.trim();
    if (v && !/^https?:\/\//i.test(v)) v = `https://${v}`;
    try { new URL(v); g.entrance.url = v; urlError = ''; } catch { urlError = 'Enter a web address such as https://example.org'; }
  }
  /** a web address without its scheme gets https:// */
  const withScheme = (v: string) => { v = v.trim(); return v && !/^[a-z]+:\/\//i.test(v) ? `https://${v}` : v; };
  function moveLink(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= g.menu.length) return;
    const [l] = g.menu.splice(i, 1);
    g.menu.splice(j, 0, l);
  }
</script>

<h1>Gallery</h1>
<div class="form">
  <label>Title <input bind:value={g.title} /></label>
  <label>Subtitle <input bind:value={g.subtitle} placeholder="Shown under the title" /></label>
  <label class="wide">Introduction <span class="muted small">(Markdown, shown on the welcome screen)</span>
    <textarea rows="4" bind:value={g.intro}></textarea>
  </label>
</div>

<h2>Visitors start in</h2>
<div class="form">
  <label>First view
    <select bind:value={g.startIn}>
      <option value="gallery">The 3D gallery</option>
      <option value="portfolio">The portfolio (a grid of all works)</option>
    </select>
    <span class="muted small">Either way, the other is one click away: “Portfolio” in the gallery's toolbar, “Walk the gallery” in the portfolio.</span>
  </label>
</div>

<h2>Menu bar</h2>
<p class="muted small">Links to other web pages, shown at the top of the gallery and the portfolio. Up to eight.</p>
<div class="link-rows">
  {#each g.menu as l, i}
    <div class="link-row">
      <input bind:value={l.label} placeholder="Label" aria-label="Label of link {i + 1}" maxlength="40" />
      <input value={l.url} placeholder="https://…" aria-label="Address of link {i + 1}" onchange={(e) => (l.url = withScheme(e.currentTarget.value))} />
      <button class="ghost small" disabled={i === 0} onclick={() => moveLink(i, -1)} aria-label="Move up">↑</button>
      <button class="ghost small" disabled={i === g.menu.length - 1} onclick={() => moveLink(i, 1)} aria-label="Move down">↓</button>
      <button class="ghost small danger" onclick={() => g.menu.splice(i, 1)} aria-label="Remove link {i + 1}">✕</button>
    </div>
  {/each}
  {#if g.menu.length < 8}<div><button onclick={() => g.menu.push({ label: '', url: '' })}>+ Add link</button></div>{/if}
</div>

<h2>Indoor light</h2>
<p class="muted small">The light outside follows Toronto's time of day and weather by itself. Choose how the rooms are lit; visitors can change it in the Light menu.</p>
<div class="cards">
  {#each LIGHTING_IDS as id}
    {@const l = LIGHTING[id]}
    <button class="style-card" class:active={g.lighting.scenario === id} onclick={() => { g.lighting.scenario = id; g.lighting.overrides = {}; }}>
      <span class="swatches"><i style="background:{l.background}"></i><i style="background:{l.hemi.sky}"></i><i style="background:{l.spot.color}"></i></span>
      <strong>{l.name}</strong><span>{l.description}</span>
    </button>
  {/each}
</div>

<h2>Entry door</h2>
<div class="form">
  <label class="check"><input type="checkbox" bind:checked={g.entrance.enabled} /> A door in the first room that visitors can leave through</label>
  {#if g.entrance.enabled}
    <label class="wide">Clicking the door opens
      <input value={g.entrance.url} onchange={(e) => setUrl(e.currentTarget.value)} placeholder="https://primbs.ca" />
      {#if urlError}<span class="warn small">{urlError}</span>{/if}
    </label>
  {/if}
</div>

<h2>Source links</h2>
<div class="form">
  <label class="check"><input type="checkbox" bind:checked={g.display.sourceLinks} /> Show each work's source link to visitors</label>
  {#if !g.display.sourceLinks}<p class="wide muted small">The links stay in this project and are left out of the website.</p>{/if}
</div>

<h2>View outside</h2>
<div class="form">
  <label>Scenery <select bind:value={g.environment.landscape}>{#each LANDSCAPE_IDS as id}<option value={id}>{landNames[id]}</option>{/each}</select></label>
</div>
