import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recipeDocument,recipeBrief,recipeBundle} from './recipe-export.mjs';
const {recipes}=JSON.parse(readFileSync(new URL('./recipes.json',import.meta.url),'utf8'));
test('assistant/print document preserves safe pressure liquid, recalculated macros and separate chosen family servings',()=>{
 const r=recipes.find(r=>r.key==='salsa_chicken');
 const d=recipeDocument(r,{servings:2,units:'metric',familyDiners:1,familyChoice:{[r.id]:r.familyOptions[0].id}});
 assert.equal(d.ingredients.find(i=>/broth/i.test(i.name)).quantity,'375 ml');
 assert(Math.abs(d.nutrition.kcal-r.nutrition.kcal-6.5625)<1e-9);
 assert.equal(d.familyDiners,1);assert(d.familyIngredient);assert.equal(d.steps.length,r.steps.length);
 assert.match(recipeBrief(r,{servings:2,units:'metric'}),/74°C \(165°F\)/);
 assert(d.sources.every(s=>s.url.startsWith('https://')));
});
test('exports keep family choices, food states, allergies, limits and tiny spoon measures',()=>{
 const r=recipes.find(r=>r.key==='turkey');const o=r.familyOptions.find(o=>o.id==='pita_one');
 const d=recipeDocument(r,{servings:8,units:'metric',familyDiners:3,familyChoice:{[r.id]:o.id}});
 assert.equal(d.familyIngredient.choiceId,o.id);assert.equal(d.familyIngredient.quantity,'180g');assert(d.allergens.includes('wheat'));
 assert(d.ingredients.every(i=>typeof i.state==='string'));assert.match(d.capacity,/extra pan or basket batches/);assert.match(d.disclaimer,/not been cooked/);
 assert.match(d.ingredients.find(i=>i.name==='Olive oil').quantity,/g$/);
 const noFamily=recipeDocument(r,{familyDiners:0});assert.equal(noFamily.familyIngredient,null);assert(!noFamily.allergens.includes('wheat'));
 const d2=recipeDocument(recipes.find(r=>r.key==='salmon'),{servings:2,units:'metric'});
 assert.equal(d2.ingredients.find(i=>i.name==='Lemon zest').quantity,'1g');
 const bundle=JSON.parse(JSON.stringify(recipeBundle(recipes,{servings:4,units:'us',familyDiners:0})));
 assert.equal(bundle.recipes.length,recipes.length);assert.equal(new Set(bundle.recipes.map(r=>r.recipeId)).size,recipes.length);
 assert(bundle.recipes.every(r=>r.sources.length&&r.steps.length&&r.ingredients.length&&r.image));
});

test('new keto smoothies scale ingredients and keep cold preparation in exports',()=>{
 for(const [id,netCarbs] of [['strawberry-hemp-smoothie',8.282],['cucumber-spinach-lime-smoothie',6.8546]]){
  const recipe=recipes.find(r=>r.id===id);
  assert(recipe);assert.equal(recipe.type,'smoothie');assert.equal(recipe.group,'keto');
  assert.equal(recipe.nutrition.net_carbs_g,netCarbs);
  for(const servings of [2,4,6,8]){
   const document=recipeDocument(recipe,{servings,units:'metric'});
   assert.equal(document.ingredients.find(i=>i.name==='Plain lowfat Greek yogurt').quantity,`${100*servings}g`);
   assert.ok(Math.abs(document.nutrition.net_carbs_g-netCarbs*4*236.5882365/recipe.estimatedYieldMl)<1e-9);
   assert.equal(document.nutritionHeading,'Nutrition per 8 oz glass');
   assert.match(document.capacity,/two servings/);
   assert.match(document.safety,/chilled/);assert.doesNotMatch(document.safety,/poultry|thermometer/);
   assert.doesNotMatch(document.leftovers,/reheat/);
   assert.equal(document.cookingFlow.rows.flat().filter(c=>c.kind==='ingredient').length,recipe.ingredients.length);
  }
 }
});
