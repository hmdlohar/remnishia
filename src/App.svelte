<script lang="ts">
  import { route } from './lib/router'
  import Home from './views/Home.svelte'
  import Session from './views/Session.svelte'
</script>

{#if $route.view === 'session'}
  <Session id={$route.id ?? ''} />
{:else}
  <Home />
{/if}
