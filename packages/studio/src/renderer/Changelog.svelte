<script lang="ts">
  import { onMount } from 'svelte';
  import { inline, type Entry } from './changelog';

  let { entries, heading, onclose }: { entries: Entry[]; heading: string; onclose: () => void } = $props();
  let dialog: HTMLDialogElement;
  onMount(() => dialog.showModal());
</script>

<dialog bind:this={dialog} class="changelog" onclose={onclose} aria-label={heading}>
  <h1>{heading}</h1>
  <div class="cl-body">
    {#each entries as e (e.version)}
      <h2>Version {e.version}{e.title ? ` · ${e.title}` : ""}{#if e.date}<span class="muted small">{e.date}</span>{/if}</h2>
      <!-- the items come from the bundled CHANGELOG.md and are escaped before their emphasis is marked up -->
      <ul>{#each e.items as item}<li>{@html inline(item)}</li>{/each}</ul>
    {/each}
  </div>
  <div class="row"><span class="spacer"></span><button class="primary" onclick={() => dialog.close()}>Got it</button></div>
</dialog>
