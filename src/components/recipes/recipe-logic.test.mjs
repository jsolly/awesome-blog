import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  capacityNote, familyNutrition, shuffleRecipes, formatIngredient, formatQuantity,
  ingredientAmount, temperature, validateSettings, servingNutrition,
} from './recipe-logic.mjs';

const ingredient = (id, name, amount, unit, state = 'raw', extra = {}) => ({
  id, name, amount, unit, state, category: 'produce', scale: 'linear', ...extra,
});
const nutrition = { kcal: 400, protein_g: 35, carbs_g: 12, fiber_g: 3, net_carbs_g: 9 };
const chicken = {
  id: 'chicken', key: 'salsa_chicken', title: 'Salsa chicken', group: 'shared',
  proteinType: 'chicken', vegetarian: false, appliance: 'instant-pot',
  activeMinutes: 15, totalMax: 45, timeVariable: true,
  allergens: [], boosters: ['hemp hearts'],
  ingredients: [
    ingredient('chicken-breast', 'chicken breast', 800, 'g', 'raw', {
      category: 'meat', us: { amount: 1.75, unit: 'lb' },
    }),
    ingredient('lime', 'lime juice', 30, 'ml', 'juiced', {
      us: { amount: 2, unit: 'tbsp' },
    }),
    ingredient('salt', 'salt', 1, 'tsp', 'dry', {
      category: 'pantry', scale: 'minimum', us: { amount: 1, unit: 'tsp' },
    }),
  ],
  familyOptions: [{
    id: 'rice', label: 'Brown rice', ingredientId: 'rice', ingredientName: 'cooked brown rice',
    amount: 150, unit: 'g', state: 'cooked', category: 'grains',
    nutrition: { kcal: 166, protein_g: 4, carbs_g: 34, fiber_g: 2, net_carbs_g: 32 },
  }], nutrition,
};


test('familiar fractions, typed US measures, and seasoning rules survive serving changes', () => {
  assert.equal(formatQuantity(1.5), '1 ½');
  assert.equal(formatQuantity(0.3333), '⅓');
  assert.equal(formatQuantity(37.5), '37.5');
  assert.equal(formatIngredient(chicken.ingredients[1], 2, 'us'), '1 tbsp');
  assert.equal(formatIngredient(chicken.ingredients[1], 2, 'metric'), '15 ml');
  assert.equal(formatIngredient(chicken.ingredients[0], 8, 'us'), '1600g');
  assert.equal(ingredientAmount(chicken.ingredients[2], 2), 1);
  assert.equal(formatIngredient(chicken.ingredients[2], 2, 'us'), '1 tsp');
  assert.equal(ingredientAmount(chicken.ingredients[2], 8), 2);
  const fixedEgg = ingredient('egg', 'beaten egg', 1, 'count', 'beaten', { scale: 'fixed' });
  assert.equal(ingredientAmount(fixedEgg, 8), 1);
  const linearEgg = { ...fixedEgg, scale: 'linear' };
  assert.equal(formatIngredient(linearEgg, 2), '½ count');
  assert.equal(formatIngredient(ingredient('pepper', 'black pepper', 0, 'tsp'), 8), 'to taste');
});

test('temperature keeps the source setting and rounds safe endpoints upward', () => {
  assert.equal(temperature(425, 'metric'), '220°C (425°F)');
  assert.equal(temperature(165, 'metric', true), '74°C (165°F)');
  assert.equal(temperature(145, 'metric', true), '63°C (145°F)');
  assert.equal(temperature(165, 'us', true), '165°F');
});



test('family macros are per serving and base remains intact', () => {
  assert.deepEqual(familyNutrition(chicken, 'rice'), {
    kcal: 566, protein_g: 39, carbs_g: 46, fiber_g: 5, net_carbs_g: 41,
  });
  assert.deepEqual(familyNutrition(chicken, 'unknown'), familyNutrition(chicken,'rice')); 
  assert.deepEqual(chicken.nutrition, nutrition);
});

test('invalid settings fail to a safe four-serving settings and capacity messaging is honest', () => {
  assert.deepEqual(validateSettings({ servings: 5, familyDiners: -1, units: 'cups' }), {
    servings: 4, familyDiners: 0, units: 'us',
  });
  assert.deepEqual(validateSettings({ servings: 6, familyDiners: 20, units: 'metric' }), {
    servings: 6, familyDiners: 6, units: 'metric',
  });
  assert.match(capacityNote(8), /extra pan or basket batches/);
  assert.match(capacityNote(2), /do not shorten a pressure minimum/);
});






test('pressure minimum changes small-batch per-person nutrition, not safe liquid',async()=>{
 const data=JSON.parse(await readFile(new URL('./recipes.json',import.meta.url),'utf8')).recipes;
 const pressure=data.find(r=>r.key==='salsa_chicken');const p=servingNutrition(pressure,2);
 assert(Math.abs(p.kcal-pressure.nutrition.kcal-6.5625)<1e-10);
 assert(Math.abs(p.protein_g-pressure.nutrition.protein_g-1.275)<1e-10);
 assert(Math.abs(p.carbs_g-pressure.nutrition.carbs_g-.35625)<1e-10);
 assert.deepEqual(servingNutrition(pressure,4),pressure.nutrition);
 assert.deepEqual(servingNutrition(pressure,8),pressure.nutrition);
 assert.deepEqual(familyNutrition(pressure,'bogus',2),familyNutrition(pressure,pressure.familyOptions[0].id,2));
});

test('package counts follow scaled ingredient weights rather than fixed recipe notes',async()=>{
 const {purchaseNote}=await import('./recipe-logic.mjs');
 const data=JSON.parse(await readFile(new URL('./recipes.json',import.meta.url),'utf8')).recipes;
 const chickpea=data.find(r=>r.key==='chickpea').ingredients.find(i=>i.id==='chickpeas_canned');
 assert.match(purchaseNote(chickpea,2),/About 1 ×/);assert.match(purchaseNote(chickpea,8),/About 4 ×/);
 const spinach=data.find(r=>r.key==='frittata').ingredients.find(i=>i.id==='spinach_frozen');assert.match(purchaseNote(spinach,8),/Buy 2 ×/);
 const gnocchi=data.find(r=>r.key==='gnocchi').ingredients.find(i=>i.id==='shelf_stable_gnocchi');assert.match(purchaseNote(gnocchi,8),/Buy 2 ×/);
});

test('small finishing amounts use spoons in both modes without changing nutrition weights', async()=>{
 const data=JSON.parse(await readFile(new URL('./recipes.json',import.meta.url),'utf8')).recipes;
 for(const r of data)for(const i of r.ingredients.filter(i=>i.displayMeasure==='spoon')){
  for(const count of [2,4,6,8]){assert.equal(formatIngredient(i,count,'metric'),formatIngredient(i,count,'us'));if(ingredientAmount(i,count)>=1)assert.match(formatIngredient(i,count,'metric'),/g$/);}
 }
 const salmon=data.find(r=>r.key==='salmon');const zest=salmon.ingredients.find(i=>i.id==='lemon_zest');
 assert.equal(zest.amount,2);assert.equal(formatIngredient(zest,2,'metric'),'1g');
});






test('appliance card requirements include the microwaves specified by recipe equipment', async () => {
 const data=JSON.parse(await readFile(new URL('./recipes.json',import.meta.url),'utf8')).recipes;
 for(const recipe of data){
  assert.ok(recipe.appliancesNeeded.length>0);
  assert.equal(new Set(recipe.appliancesNeeded).size,recipe.appliancesNeeded.length);
  if(recipe.equipment.some(item=>/microwave/i.test(item)))assert.ok(recipe.appliancesNeeded.includes('Microwave'),recipe.id);
 }
});


test('shuffle preserves the source and visits every index with a fresh random choice', () => {
 const source=['a','b','c','d'];let calls=0;
 const shuffled=shuffleRecipes(source,()=>{calls++;return 0;});
 assert.deepEqual(source,['a','b','c','d']);assert.deepEqual(shuffled,['b','c','d','a']);
 assert.equal(calls,source.length-1);
 assert.deepEqual(shuffleRecipes(source,()=>0.99),source);
 assert.deepEqual(shuffleRecipes([]),[]);assert.deepEqual(shuffleRecipes(['one']),['one']);
});

test('gram threshold preserves subgram source measures',()=>{const i=ingredient('spice','spice',1,'g','dry',{displayMeasure:'spoon',us:{amount:0.5,unit:'tsp'}});assert.equal(formatIngredient(i,4,'us'),'1g');assert.equal(formatIngredient(i,2,'us'),'¼ tsp');});

test('display rounds gram amounts without changing scaling weights',()=>{const i=ingredient('paprika','paprika',2.3,'g');for(const count of [2,4,6,8])assert.equal(formatIngredient(i,count,'us'),`${Math.round(2.3*count/4)}g`);assert.ok(Math.abs(ingredientAmount(i,6)-3.45)<1e-10);});

test('smoothie nutrition uses explicit estimated fluid yield, independent of batch selection',async()=>{
 const {smoothiePortionNutrition}=await import('./recipe-logic.mjs');
 const smoothie={type:'smoothie',estimatedYieldMl:800,nutrition:{kcal:200,protein_g:10,carbs_g:12,fiber_g:4,net_carbs_g:8}};
 const portion=smoothiePortionNutrition(smoothie);
 assert.ok(Math.abs(portion.net_carbs_g-9.46352946)<1e-7);
 assert.ok(Math.abs(smoothiePortionNutrition(smoothie,4).net_carbs_g-portion.net_carbs_g/2)<1e-9);
 assert.throws(()=>smoothiePortionNutrition({...smoothie,estimatedYieldMl:undefined}),/yield/);
 assert.throws(()=>smoothiePortionNutrition(smoothie,0),/positive glass/);
});
test('whole-ounce smoothie display keeps canonical quantities intact',()=>{
 const water={id:'water',amount:400,unit:'ml',scale:'linear'};
 assert.equal(formatIngredient(water,4,'us'),'13.5 oz');
 assert.equal(formatIngredient(water,4,'us',{wholeOunces:true}),'14 oz');
 assert.equal(formatIngredient(water,2,'us',{wholeOunces:true}),'7 oz');
 assert.equal(formatIngredient(water,4,'metric',{wholeOunces:true}),'400 ml');
 assert.equal(water.amount,400);
});
