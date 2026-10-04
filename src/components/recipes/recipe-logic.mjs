/** Pure calculations for the meal library. Recipe ingredient amounts are for four adults. */
const BASE_SERVINGS = 4;
const SERVINGS = new Set([2, 4, 6, 8]);
const NUTRIENTS = ['kcal', 'protein_g', 'carbs_g', 'fiber_g', 'net_carbs_g'];

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

export function validateSettings(settings = {}) {
  const servings = SERVINGS.has(Number(settings?.servings)) ? Number(settings.servings) : BASE_SERVINGS;
  const familyDiners = Number.isInteger(Number(settings?.familyDiners))
    ? Math.max(0, Math.min(servings, Number(settings.familyDiners)))
    : 0;
  const units = settings?.units === 'metric' ? 'metric' : 'us';
  return { servings, familyDiners, units };
}

/** Use familiar fractions for kitchen measures; retain two decimals otherwise. */
export function formatQuantity(value) {
  if (!finite(value)) return '—';
  if (value === 0) return '0';
  const sign = value < 0 ? '−' : '';
  const magnitude = Math.abs(value);
  if (magnitude >= 10) return sign + Number(magnitude.toFixed(2)).toString();
  const whole = Math.floor(magnitude + 1e-9);
  const remainder = magnitude - whole;
  const fractions = [
    [0, ''], [1 / 8, '⅛'], [1 / 6, '⅙'], [1 / 4, '¼'], [1 / 3, '⅓'],
    [3 / 8, '⅜'], [1 / 2, '½'], [5 / 8, '⅝'], [2 / 3, '⅔'],
    [3 / 4, '¾'], [5 / 6, '⅚'], [7 / 8, '⅞'], [1, ''],
  ];
  const fraction = fractions.find(([decimal]) => Math.abs(remainder - decimal) < 0.012);
  if (fraction) {
    const integer = whole + (fraction[0] === 1 ? 1 : 0);
    return sign + (fraction[1] ? `${integer ? `${integer} ` : ''}${fraction[1]}` : String(integer));
  }
  return sign + Number(magnitude.toFixed(2)).toString();
}

/** Minimum seasonings retain their baseline amount for smaller batches. */
export function ingredientAmount(ingredient, servings) {
  const amount = Number(ingredient?.amount);
  if (!Number.isFinite(amount)) return NaN;
  const validServings = validateSettings({ servings }).servings;
  if (ingredient.scale === 'fixed') return amount;
  const scaled = amount * validServings / BASE_SERVINGS;
  return ingredient.scale === 'minimum' ? Math.max(amount, scaled) : scaled;
}

/** US measures come from typed source quantities, never a generic g-to-cup ratio. */
export function formatIngredient(ingredient, servings, units = 'metric', {wholeOunces=false}={}) {
  const amount = ingredientAmount(ingredient, servings);
  if (!Number.isFinite(amount)) return '—';
  if (amount === 0) return 'to taste';
  const grams = ingredient.unit === 'g' ? amount : amount * ingredient.gramsPerUnit;
  if (Number.isFinite(grams) && grams >= 1) return `${Math.round(grams)}g`;
  const hasUS = (units === 'us' || ingredient.displayMeasure === 'spoon')
    && finite(ingredient?.us?.amount) && ingredient.us.unit;
  const displayAmount = hasUS && ingredient.amount
    ? ingredient.us.amount * amount / ingredient.amount
    : amount;
  let unit = hasUS ? ingredient.us.unit : ingredient.unit;
  let shown = displayAmount;
  if(units==='us'&&!hasUS&&unit==='g'){shown=amount/28.349523125;unit='oz';}
  if(units==='us'&&!hasUS&&unit==='ml'){shown=amount/29.5735295625;unit='fl oz';}
  // Typed source measures can land just below a decimal half after rescaling.
  const roundedOunces = wholeOunces?Math.round(shown):Math.round((shown + Number.EPSILON * Math.abs(shown)) * 10) / 10;
  const quantity=unit==='oz'||unit==='fl oz'?String(roundedOunces):formatQuantity(shown);
  return `${quantity}${unit ? ` ${unit === 'fl oz' ? 'oz' : unit}` : ''}`;
}

/** Safe endpoints round upward; appliance settings round to the nearest 5°C. */
export function temperature(fahrenheit, units = 'us', safety = false) {
  if (!finite(fahrenheit)) return '—';
  const original = `${formatQuantity(fahrenheit)}°F`;
  if (units !== 'metric') return original;
  const celsius = (fahrenheit - 32) * 5 / 9;
  const shown = safety ? Math.ceil(celsius - 1e-10) : Math.round(celsius / 5) * 5;
  return `${shown}°C (${original})`;
}

/** Shuffle a copy once per visit, preserving the canonical recipe collection. */
export function shuffleRecipes(recipes, random = Math.random) {
 const result = [...recipes];
 for (let i=result.length-1;i>0;i--) {
  const j=Math.floor(random()*(i+1));
  [result[i],result[j]]=[result[j],result[i]];
 }
 return result;
}

export function servingNutrition(recipe,servings=4){
 const count=validateSettings({servings}).servings;
 const result={...recipe.nutrition};
 for(const ingredient of recipe.ingredients??[]){
  if(!ingredient.nutritionBatch||!ingredient.amount)continue;
  const actual=ingredientAmount(ingredient,count)/ingredient.amount;
  for(const key of NUTRIENTS)result[key]+=(Number(ingredient.nutritionBatch[key]??0)*(actual-count/4))/count;
 }
 return result;
}

/** Smoothie volumes are explicit estimates, separate from the canonical per-recipe-portion macros. */
export function smoothieGlassesPerBatch(recipe, fluidOunces=8){
 if(recipe.type!=='smoothie'||!finite(fluidOunces)||fluidOunces<=0)throw new Error('A smoothie and positive glass size are required.');
 if(!finite(recipe.estimatedYieldMl)||recipe.estimatedYieldMl<=0)throw new Error('Estimated smoothie yield is required.');
 return recipe.estimatedYieldMl/(fluidOunces*29.5735295625);
}
export function smoothiePortionNutrition(recipe,fluidOunces=8){
 const glassesPerBatch=smoothieGlassesPerBatch(recipe,fluidOunces);
 return Object.fromEntries(NUTRIENTS.map(key=>[key,recipe.nutrition[key]*BASE_SERVINGS/glassesPerBatch]));
}
export function displayNutrition(recipe,servings=4){
 return recipe.type==='smoothie'?smoothiePortionNutrition(recipe):servingNutrition(recipe,servings);
}
export function nutritionHeading(recipe){
 return recipe.type==='smoothie'?'Nutrition per 8 oz glass':'Nutrition per serving';
}
export function smoothieYieldNote(recipe,servings=4){
 const glasses=smoothieGlassesPerBatch(recipe)*validateSettings({servings}).servings/4;
 return `This batch makes about ${glasses.toFixed(1)} eight-fluid-ounce glasses. Yield is estimated; added liquid and blending affect actual volume.`;
}

/** A family's serving receives one chosen starch; the keto base stays untouched. */
export function familyNutrition(recipe, choiceId, servings=4) {
  const option = recipe?.group === 'shared'
    ? ((recipe.familyOptions ?? []).find((item) => item.id === choiceId) || recipe.familyOptions?.[0])
    : undefined;
  return Object.fromEntries(NUTRIENTS.map((key) => [
    key,
    Number(recipe ? servingNutrition(recipe,servings)[key] : 0) + Number(option?.nutrition?.[key] ?? 0),
  ]));
}

export function capacityNote(servings) {
  const count = validateSettings({ servings }).servings;
  if (count > BASE_SERVINGS) return 'More than four servings may need extra pan or basket batches. Keep the stated food thickness and thermometer endpoint; total time can increase.';
  if (count < BASE_SERVINGS) return 'Use the stated cook times as a starting point for this smaller batch. Check the thermometer endpoint; do not shorten a pressure minimum.';
  return 'The listed pan and basket capacity, cook times, and thermometer endpoint are for four servings.';
}

/** Package counts are shopping estimates; recipe weights remain the measured target. */
export function purchaseNote(ingredient,servings=4){
 const pack=ingredient?.package;const amount=ingredientAmount(ingredient,servings);
 if(!pack||!finite(pack.grams)||pack.grams<=0||!finite(amount))return '';
 const count=Math.ceil(amount/pack.grams-1e-10);
 return pack.drained?`About ${count} × ${pack.label}, assuming ~${pack.grams} g drained per can; check actual yield.`:`Buy ${count} × ${pack.label}; measure out the required weight.`;
}
