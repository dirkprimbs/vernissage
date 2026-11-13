<script lang="ts">
  import { studio } from './api';
  import { st, finished } from './state.svelte';

  let src = $state('');
  let status = $state('');
  let frame = $state<HTMLIFrameElement>();
  /** the preview page is up and takes edits without reloading */
  let ready = false;
  let n = 0;
  let lastKey = -1;

  $effect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame?.contentWindow) return;
      // keep the visitor in the same room across reloads
      if (e.data?.type === 'vernissage:room') st.previewRoom = e.data.id;
      else if (e.data?.type === 'vernissage:ready') ready = true;
      else if (e.data?.type === 'vernissage:reload') { ready = false; st.previewKey += 1; }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  });

  // "Show in preview" from the artworks editor
  $effect(() => {
    const go = st.previewGoto;
    if (go && frame?.contentWindow) frame.contentWindow.postMessage({ type: 'vernissage:goto', art: go.id }, st.previewBase);
  });

  $effect(() => {
    if (!st.gallery) return;
    const snap = JSON.stringify(st.gallery);
    const key = st.previewKey;
    // a reload (the Reload button, or the page asking for one) starts over; ordinary edits go straight in
    const reload = !ready || key !== lastKey;
    status = reload ? 'Updating…' : '';
    const t = setTimeout(async () => {
      try {
        // rows still being typed (a menu link, a provenance entry) should not stop the preview
        const r = await studio.updatePreview(finished(JSON.parse(snap)));
        if (!r.ok) { status = 'Fix the errors to update the preview'; return; }
        if (!reload && ready && frame?.contentWindow) {
          frame.contentWindow.postMessage({ type: 'vernissage:data', site: r.site }, st.previewBase);
          status = '';
          return;
        }
        lastKey = key;
        ready = false;
        const room = st.previewRoom && st.gallery?.rooms.some((x) => x.id === st.previewRoom) ? `#/room/${st.previewRoom}` : '#/';
        src = `${r.url}?enter&studio&v=${++n}${room}`;
        status = '';
      } catch (e) { status = (e as Error).message; }
    }, reload ? 500 : 120);
    return () => clearTimeout(t);
  });
</script>

<div class="preview-head">
  <strong>Live preview</strong>
  <span class="muted small">{status || 'Click inside, then use WASD / drag to look'}</span>
  <button class="ghost small" onclick={() => (st.previewKey += 1)}>Reload</button>
</div>
{#if src}
  <iframe bind:this={frame} title="Gallery preview" {src}></iframe>
{:else}
  <div class="preview-empty muted">{status || 'Preparing preview…'}</div>
{/if}
