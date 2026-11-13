<script lang="ts">
  import { studio } from './api';
  import { st } from './state.svelte';

  let src = $state('');
  let status = $state('');
  let n = 0;

  // keep the visitor in the same room across reloads
  $effect(() => {
    const onMsg = (e: MessageEvent) => { if (e.data?.type === 'vernissage:room') st.previewRoom = e.data.id; };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  });

  $effect(() => {
    if (!st.gallery) return;
    const snap = JSON.stringify(st.gallery);
    void st.previewKey;
    status = 'Updating…';
    const t = setTimeout(async () => {
      try {
        const data = JSON.parse(snap);
        // a menu link still being typed should not stop the preview
        if (Array.isArray(data.menu)) data.menu = data.menu.filter((l: { label?: string; url?: string }) => l.label?.trim() && /^https?:\/\/\S+\.\S+/.test(l.url ?? ''));
        const r = await studio.updatePreview(data);
        if (!r.ok) { status = 'Fix the errors to update the preview'; return; }
        const room = st.previewRoom && st.gallery?.rooms.some((x) => x.id === st.previewRoom) ? `#/room/${st.previewRoom}` : '#/';
        src = `${r.url}?enter&v=${++n}${room}`;
        status = '';
      } catch (e) { status = (e as Error).message; }
    }, 700);
    return () => clearTimeout(t);
  });
</script>

<div class="preview-head">
  <strong>Live preview</strong>
  <span class="muted small">{status || 'Click inside, then use WASD / drag to look'}</span>
  <button class="ghost small" onclick={() => (st.previewKey += 1)}>Reload</button>
</div>
{#if src}
  <iframe title="Gallery preview" {src}></iframe>
{:else}
  <div class="preview-empty muted">{status || 'Preparing preview…'}</div>
{/if}
