<script>
 import NativeSelect from '$lib/components/ui/native-select/native-select.svelte';
 import ApplianceIcon from './ApplianceIcon.svelte';
 import RecipeFlow from './RecipeFlow.svelte';
 import NutrientDisclosure from './NutrientDisclosure.svelte';
 import {dailyNutrition} from './nutrition.mjs';
 import {formatIngredient,ingredientAmount,displayNutrition,nutritionHeading} from './recipe-logic.mjs';
 let {recipe,settings,interactive=true,headingLevel=3,onSideChange}=$props();
 const selectedSide=$derived(settings.familyChoice[recipe.id] || recipe.familyOptions[0]?.id || '');
 const baseNutrition=$derived(displayNutrition(recipe,settings.servings));
 const dailyValues=$derived(dailyNutrition(recipe,settings.servings,ingredientAmount).filter(n=>n.amount!==null));
</script>
<div class="recipe-body">
      <div class="detail-appliances"><span>Appliances needed</span><div class="appliance-icons">{#each recipe.appliancesNeeded as name (name)}<ApplianceIcon {name}/>{/each}</div></div>
      <div class="detail-facts"><span><strong>{recipe.activeMinutes}{settings.servings>4?'+':''} min</strong> active time{settings.servings>4?' / base batch':''}</span><span><strong>{settings.servings}</strong> servings</span></div>
      {#if recipe.image}<figure class="recipe-photo"><img src={recipe.image.src} srcset={recipe.image.detailSrcset} sizes="(max-width:600px) 320px, (max-width:1000px) 680px, 960px" width={recipe.image.width} height={recipe.image.height} alt={recipe.image.alt} loading="eager" decoding="async"/></figure>{/if}
        {#if recipe.familyOptions.length}
        {@const option=recipe.familyOptions.find(o=>o.id===selectedSide)||recipe.familyOptions[0]}
        <div class="family-box"><label>Family side<NativeSelect aria-label="Family starch" value={selectedSide} disabled={!interactive} onchange={e=>onSideChange?.(e.currentTarget.value)}>{#each recipe.familyOptions as option (option.id)}<option value={option.id}>{option.label}</option>{/each}</NativeSelect></label><p>{formatIngredient({...option,amount:option.amount*settings.familyDiners,us:option.us?{...option.us,amount:option.us.amount*settings.familyDiners}:undefined,scale:'fixed'},4,settings.units)} {option.ingredientName} · serve separately</p></div>
      {/if}
      {#key recipe.id}<RecipeFlow recipe={recipe} {settings} {interactive} {headingLevel}/>{/key}
      <section class="nutrition" aria-label={nutritionHeading(recipe)}><svelte:element this={`h${headingLevel}`}>{nutritionHeading(recipe)}</svelte:element><dl><div><dt>Calories</dt><dd>{Math.round(baseNutrition.kcal)} kcal</dd></div><div><dt>Protein</dt><dd>{Math.round(baseNutrition.protein_g)} g</dd></div><div><dt>Total carbs</dt><dd>{Math.round(baseNutrition.carbs_g)} g</dd></div><div><dt>Fiber</dt><dd>{Math.round(baseNutrition.fiber_g)} g</dd></div><div><dt>Net carbs</dt><dd>{Math.round(baseNutrition.net_carbs_g)} g</dd></div></dl>{#key recipe.id}<NutrientDisclosure nutrients={dailyValues} {interactive} headingLevel={headingLevel+1}/>{/key}</section>
</div>
<style>
 .detail-appliances{display:flex;align-items:center;gap:14px;margin:16px 0;font-size:.84rem}.appliance-icons{display:flex;align-items:center;gap:10px}.detail-facts{display:flex;gap:25px;flex-wrap:wrap;margin:20px 0}.detail-facts span{font-size:.84rem}.detail-facts strong{display:block;font-size:1.1rem;color:var(--recipe-ink)}.recipe-photo{max-width:60rem;margin:22px 0}.recipe-photo img{display:block;width:100%;height:auto;border-radius:10px}.family-box{background:var(--recipe-family);border-radius:12px;padding:16px 20px;margin:20px 0}.family-box p{font-size:.9rem}.family-box :global(select){max-width:360px;margin-top:6px;appearance:none}.nutrition{margin-top:20px}.nutrition dl{display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:.84rem}.nutrition dl>div{padding:8px;background:var(--recipe-soft);border-radius:6px}.nutrition dt{font-size:.73rem;color:var(--recipe-muted)}.nutrition dd{font-weight:650;margin:2px 0}
 @media(max-width:600px){.detail-facts{gap:16px}.detail-facts strong{font-size:.95rem}.family-box{padding:15px}}
.family-box :global([data-slot=native-select-wrapper]){width:100%;max-width:360px}@media print{.recipe-photo{display:none!important}}
</style>
