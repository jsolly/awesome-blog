import {test} from 'node:test';import assert from 'node:assert/strict';
import {recordedOmega3} from './nutrition.mjs';
import {ingredientAmount} from './recipe-logic.mjs';
import data from './recipes.json' with {type:'json'};
import {nutrientFilters,matchesRecipe,smoothieIngredientChoices,recipeStarches,starchTypes,normalizeSelection,normalizeMealStyles,toggleMealStyle,hasAppliances,availableAppliances,defaultAppliances} from './nutrient-filters.mjs';
test('nutrition filters have usable intersections at all supported serving counts',()=>{
 for(const servings of [2,4,6,8])for(const immune of [false,true])for(const iron of [false,true]){
  const matches=data.recipes.filter(r=>{const flags=nutrientFilters(r,servings);return (!immune||flags.immune)&&(!iron||flags.iron)});
  assert(matches.length>0);if(immune||iron)assert(matches.length<data.recipes.length);
 }
 const lentils=data.recipes.find(r=>r.key==='lentil_bake');assert.deepEqual(nutrientFilters(lentils,4),{immune:true,iron:true,omega:false});
 const cod=data.recipes.find(r=>r.key==='cod');assert.deepEqual(nutrientFilters(cod,4),{immune:false,iron:false,omega:true});
 assert.deepEqual(nutrientFilters({id:'missing',ingredients:[]},4),{immune:false,iron:false,omega:false});
});

test('protein and carb categories combine with nutrient criteria',()=>{const fish=data.recipes.filter(r=>matchesRecipe(r,4,{protein:'fish'}));assert.equal(fish.length,2);assert(fish.every(r=>r.proteinType==='fish'));assert.equal(data.recipes.filter(r=>matchesRecipe(r,4,{protein:'fish',iron:true})).length,0);const shared=data.recipes.filter(r=>matchesRecipe(r,4,{protein:'chicken',carb:'shared'}));assert.equal(shared.length,3);assert(shared.every(r=>r.group==='shared'&&r.proteinType==='chicken'));});

 test('starch categories cover every recipe and include main ingredients and family sides',()=>{
 assert.deepEqual(Object.keys(recipeStarches).sort(),data.recipes.map(r=>r.id).sort());
 const ids=starch=>data.recipes.filter(r=>matchesRecipe(r,4,{starch})).map(r=>r.id);
 assert.deepEqual(ids('rice').sort(),['salsa-verde-shredded-chicken','shawarma-chicken-bowls']);
 assert.deepEqual(ids('pasta'),['sheet-pan-gnocchi-white-beans-and-broccoli']);
 assert.equal(ids('none').length,7);
 assert.equal(ids('bread').length,3);
 for(const types of Object.values(recipeStarches))for(const type of types)assert(type in starchTypes);
 });

test('multi-select uses OR within each filter and AND across filters; legacy settings normalize',()=>{
 const matches=filters=>data.recipes.filter(r=>matchesRecipe(r,4,filters));
 assert.equal(matches({starch:['rice','pasta']}).length,3);
 assert.equal(matches({protein:['fish','turkey']}).length,4);
 assert.equal(matches({protein:['fish','chicken'],starch:['rice']}).length,2);
 assert.equal(matches({protein:[],starch:[]}).length,data.recipes.length);
 assert.deepEqual(normalizeSelection('rice',starchTypes),['rice']);
 assert.deepEqual(normalizeSelection(['rice','rice','invalid','all'],starchTypes),['rice']);
 assert.deepEqual(normalizeSelection('all',starchTypes),[]);
});

test('Shared Main combines with either exclusive meal style and saved styles normalize',()=>{
 assert.deepEqual(toggleMealStyle(['keto'],'shared'),['keto','shared']);
 assert.deepEqual(toggleMealStyle(['keto','shared'],'nonketo'),['shared','nonketo']);
 assert.deepEqual(toggleMealStyle(['shared','nonketo'],'shared'),['nonketo']);
 assert.deepEqual(normalizeMealStyles('keto'),['keto']);
 assert.deepEqual(normalizeMealStyles(['keto','nonketo','shared','bogus']),['nonketo','shared']);
 assert.equal(data.recipes.filter(r=>matchesRecipe(r,4,{carb:['keto','shared']})).length,14);
});

test('appliance inventory honors counts and oven/pan dependency, and validates storage',()=>{
 const fry=data.recipes.find(r=>r.id==='greek-turkey-patties');
 assert(!hasAppliances(fry,{...defaultAppliances,'Two air fryers':1}));
 assert(hasAppliances(fry,defaultAppliances));
 const pan=data.recipes.find(r=>r.id==='pan-fried-greek-turkey-patties');
 assert(hasAppliances(pan,defaultAppliances));assert(!hasAppliances(pan,{...defaultAppliances,Oven:0}));
 assert.equal(availableAppliances({'Instant Pot':8})['Instant Pot'],2);
 assert.equal(availableAppliances(['Two air fryers'])['Two air fryers'],2);
 assert.equal(availableAppliances([]).Oven,0);
 assert.equal(data.recipes.filter(r=>r.type==='smoothie').length,6);
 assert(data.recipes.filter(r=>r.type==='smoothie').every(r=>r.appliancesNeeded.includes('Blender')));
});

test('smoothie ingredient filters use actual ingredients and exclude shared bases',()=>{
 const choices=smoothieIngredientChoices(data.recipes);
 assert(!('water' in choices));assert(!('yogurt' in choices));
 assert.equal(choices.hemp,'Hulled hemp hearts');assert.equal(choices.spinach,'Raw spinach');
 const smoothies=data.recipes.filter(r=>r.type==='smoothie');
 assert.deepEqual(smoothies.filter(r=>matchesRecipe(r,4,{ingredients:['hemp']})).map(r=>r.id),['strawberry-hemp-smoothie']);
 assert.deepEqual(smoothies.filter(r=>matchesRecipe(r,4,{ingredients:['hemp','spinach']})).map(r=>r.id),['strawberry-hemp-smoothie','cucumber-spinach-lime-smoothie']);
 assert.deepEqual(smoothies.filter(r=>matchesRecipe(r,4,{ingredients:['hemp'],carb:['nonketo']})),[]);
 assert.equal(smoothies.filter(r=>matchesRecipe(r,4,{ingredients:[]})).length,6);
});

test('omega filter uses recorded quantities on meal and smoothie portion bases',()=>{
 const ids=data.recipes.filter(r=>matchesRecipe(r,4,{omega:true})).map(r=>r.id);
 assert.deepEqual(ids,['lemon-salmon-and-asparagus','pesto-cod-and-zucchini','spinach-feta-and-hemp-frittata','strawberry-hemp-smoothie']);
 for(const n of [2,6,8])assert.deepEqual(data.recipes.filter(r=>matchesRecipe(r,n,{omega:true})).map(r=>r.id),ids);
});

test('omega filter includes the 0.5 g boundary and excludes lower or unobserved quantities',()=>{
 const recipe=data.recipes.find(r=>r.id==='strawberry-hemp-smoothie');
 const recorded=recordedOmega3(recipe,4,ingredientAmount);
 const boundaryYield=recipe.estimatedYieldMl*recorded/0.5;
 const boundary={...recipe,estimatedYieldMl:boundaryYield};
 assert(Math.abs(recordedOmega3(boundary,4,ingredientAmount)-0.5)<1e-12);
 assert.equal(nutrientFilters(boundary,4).omega,true);
 assert.equal(nutrientFilters({...boundary,estimatedYieldMl:boundaryYield*1.001},4).omega,false);
 assert.equal(nutrientFilters({...boundary,id:'unobserved-omega-fixture'},4).omega,false);
});
