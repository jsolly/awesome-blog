<script>
 import {onDestroy} from 'svelte';
 import Root from '$lib/components/ui/popover/popover.svelte';
 import Trigger from '$lib/components/ui/popover/popover-trigger.svelte';
 import Content from '$lib/components/ui/popover/popover-content.svelte';
 let open=$state(false);
 let timer;
 function enter(event){if(event.pointerType==='mouse'&&matchMedia('(hover: hover) and (pointer: fine)').matches){clearTimeout(timer);open=true;}}
 function leave(event){if(event.pointerType==='mouse'){clearTimeout(timer);timer=setTimeout(()=>open=false,120);}}
 onDestroy(()=>clearTimeout(timer));
</script>
<Root bind:open><Trigger class="nutrition-info" aria-label="About nutrition filters" onpointerenter={enter} onpointerleave={leave}>ⓘ</Trigger><Content class="nutrition-help" sideOffset={4} onpointerenter={enter} onpointerleave={leave} onOpenAutoFocus={e=>e.preventDefault()} onCloseAutoFocus={e=>e.preventDefault()}><strong>Nutrition filters</strong><p><strong>Iron-rich:</strong> at least 20% Daily Value of iron per serving.</p><p><strong>Immune support:</strong> at least 20% Daily Value in two or more of vitamins A, C, D, zinc and selenium per serving.</p><p><strong>Omega-3s:</strong> at least 0.5 g of recorded ALA, EPA, and DHA per meal serving or 8 oz smoothie glass. Missing nutrient observations are excluded. This is a recipe filter threshold, not a Daily Value.</p></Content></Root>
<style>
 :global(.nutrition-info){background:transparent;color:var(--recipe-accent);border:0;padding:4px 8px;min-height:32px!important;cursor:pointer}:global(.nutrition-help){z-index:60;width:320px;max-width:calc(100vw - 32px);background:var(--recipe-paper);color:var(--recipe-ink);border:1px solid var(--recipe-line);border-radius:8px;padding:12px;font:13px/1.5 var(--font-body);box-shadow:0 4px 16px #0003}:global(.nutrition-help p){margin:8px 0 0}
</style>
