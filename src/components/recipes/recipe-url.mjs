import {validateSettings} from './recipe-logic.mjs';

export function readRecipeURL(url, recipes, defaults={servings:4}) {
  const servings=validateSettings({servings:url.searchParams.has('servings')?Number(url.searchParams.get('servings')):defaults.servings}).servings;
  const familyChoice={};
  for(const part of (url.searchParams.get('starch')||'').split(',')){
    const [id,side]=part.split(':');
    if(recipes.find(recipe=>recipe.id===id)?.familyOptions.some(option=>option.id===side)) familyChoice[id]=side;
  }
  const recipeId=recipes.find(recipe=>url.pathname===`/recipes/${recipe.id}/` || url.hash===`#${recipe.id}`)?.id || '';
  return {servings,familyChoice,recipeId};
}

export function recipeHref(recipe,settings) {
  const p=new URLSearchParams({servings:String(validateSettings(settings).servings)});
  const side=settings.familyChoice?.[recipe.id];
  if(recipe.familyOptions.some(option=>option.id===side))p.set('starch',`${recipe.id}:${side}`);
  return `/recipes/${recipe.id}/?${p}`;
}
