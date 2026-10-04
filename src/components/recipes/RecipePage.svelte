<script>
 import {onMount} from 'svelte';
 import RecipePrint from './RecipePrint.svelte';
 import {readRecipeURL} from './recipe-url.mjs';
 import {createRecipePrintSession} from './recipe-print-session.mjs';
 import RecipeBody from './RecipeBody.svelte';
 import ShareRecipe from './ShareRecipe.svelte';
 import NativeSelect from '$lib/components/ui/native-select/native-select.svelte';
 import Button from '$lib/components/ui/button/button.svelte';
 import {validateSettings} from './recipe-logic.mjs';
 let {recipe}=$props();
 let interactive=$state(false);
 let message=$state('');
 let settings=$state({servings:4,units:'us',familyDiners:4,familyChoice:{}});
 const collection=$derived(recipe.type==='smoothie'?'smoothies':'meals');
 const groups={keto:'Keto',shared:'Shared main',nonketo:'Not Keto'};
 const printSession=createRecipePrintSession(()=> 'recipe');
 function print(){printSession.prepare();try{window.print();}catch{printSession.restore();message='Printing could not open. Use your browser’s Print command.';}}
 onMount(()=>{
   const parsed=readRecipeURL(new URL(location.href),[recipe]);
   settings={...settings,servings:parsed.servings,familyDiners:parsed.servings,familyChoice:parsed.familyChoice};interactive=true;
   return printSession.listen();
 });
</script>
<div class="recipe-page">
<section class="recipe-detail" id={recipe.id}>
 <div class="toolbar"><a href={`/recipes/${collection}/`}>← Back to {collection}</a>{#if interactive}<Button variant="outline" onclick={print}>Print recipe</Button>{/if}</div>
 <span class="badge">{groups[recipe.group]}</span><h1>{recipe.title}</h1><p>{recipe.summary}</p>
 {#if interactive}<label class="servings">Servings<NativeSelect aria-label="Servings" value={settings.servings} onchange={e=>{const servings=validateSettings({servings:Number(e.currentTarget.value)}).servings;settings={...settings,servings,familyDiners:servings};}}>{#each [2,4,6,8] as n (n)}<option value={n}>{n}</option>{/each}</NativeSelect></label>{/if}
 <RecipeBody {recipe} {settings} {interactive} headingLevel={2} onSideChange={value=>settings={...settings,familyChoice:{...settings.familyChoice,[recipe.id]:value}}}/>
 {#if interactive}<ShareRecipe {recipe} {settings}/>{:else}<div class="share"><a href={`/recipes/${recipe.id}/`}>Share recipe link</a></div>{/if}
<p role="status">{message}</p></section>
<div class="print-output"><RecipePrint recipes={[recipe]} {settings}/></div>
</div>
<style>
 .print-output{display:none}@media print{.print-output{display:block}.recipe-detail{display:none!important}}
 .recipe-detail{background:var(--recipe-paper);color:var(--recipe-ink);border:1px solid var(--recipe-line);border-radius:20px;padding:28px;font:16px/1.55 var(--font-body)}.servings{display:flex;gap:10px;align-items:center}.servings :global(select){min-width:72px;min-height:44px;padding-right:32px;background:var(--recipe-paper);color:var(--recipe-ink);padding:8px;border:1px solid var(--recipe-line);border-radius:8px}.toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:24px}a{color:var(--recipe-accent)}h1{font:600 clamp(2rem,4vw,3rem)/1.13 var(--font-heading)}.badge{display:inline-block;background:var(--recipe-badge);padding:4px 10px;border-radius:4px;font-size:.75rem}.share{margin-top:24px;border-top:1px solid var(--recipe-line);padding-top:16px}@media(max-width:600px){.recipe-detail{padding:18px}}@media print{.toolbar,.share,.servings{display:none}.recipe-detail{padding:0;border:0;background:white;color:black}}
</style>
