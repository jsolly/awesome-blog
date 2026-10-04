<script>
 import {recipeHref} from './recipe-url.mjs';
 import Button from '$lib/components/ui/button/button.svelte';
 let {recipe,settings}=$props();
 let message=$state('');
 let fallbackUrl=$state('');
 async function share(){
  const url=new URL(recipeHref(recipe,settings),window.location.origin);
  const data={title:recipe.title,url:url.href};
  fallbackUrl='';message='';
  if(navigator.share){
   try{await navigator.share(data);return;}catch(error){if(error instanceof DOMException && error.name==='AbortError')return;}
  }
  try{await navigator.clipboard.writeText(url.href);message='Recipe link copied.';}
  catch{fallbackUrl=url.href;message='Copy this recipe link:';}
 }
</script>
<div class="recipe-share"><Button variant="outline" onclick={share}>Share recipe</Button><p role="status">{message}</p>{#if fallbackUrl}<a href={fallbackUrl}>{fallbackUrl}</a>{/if}</div>
<style>.recipe-share{margin-top:24px;padding-top:16px;border-top:1px solid var(--recipe-line)}p:empty{display:none}a{overflow-wrap:anywhere}@media print{.recipe-share{display:none}}</style>
