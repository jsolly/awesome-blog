import {flowHtml} from '../../src/components/recipes/trn-logic.mjs';
import {formatIngredient,displayNutrition} from '../../src/components/recipes/recipe-logic.mjs';
const escapeHtml=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function ingredientLine(i,recipe){const us=formatIngredient(i,4,'us',{wholeOunces:recipe.type==='smoothie'});const metric=formatIngredient(i,4,'metric');return `- ${us}${metric!==us?' ('+metric+')':''} ${i.name}${i.state?' — '+i.state:''}${i.note?'. '+i.note:''}`;}
function section(r){
 const lines=[`<div id="${r.id}"></div>`,`### ${r.title}`,`About ${r.activeMinutes} minutes hands-on; ${r.totalMin}–${r.totalMax} minutes${r.timeVariable?' expected':''} total. Four adult servings. ${r.summary}`,'**Cooking flow · Tabular Recipe Notation**',flowHtml(r,{servings:4,units:'us'}),'**Ingredients**',r.ingredients.map(i=>ingredientLine(i,r)).join('\n'),'**Equipment and capacity**',r.equipment.map(x=>'- '+x).join('\n'),'**Method**',r.steps.map((s,i)=>`${i+1}. **${s.title}.** ${s.text}`).join('\n')];
 if(r.familyOptions.length)lines.push('**Family add-on**',r.familyOptions.map(o=>`- Per non-keto adult: ${formatIngredient({...o,scale:'fixed'},4,'us')}${o.unit==='g'?' ('+o.amount+' g)':''} ${o.ingredientName}. ${o.note}`).join('\n'));
 lines.push('**Why it works**',r.flavorRationale,r.tips.map(x=>'- '+x).join('\n'));
 if(r.fallback)lines.push('**Capacity fallback**',r.fallback);
 lines.push('**First-cook checks and limits**',r.limitations.map(x=>'- '+x).join('\n'),'**Sources**',r.sources.map(s=>`- [${s.title}](${s.url})`).join('\n'),'These sources support safety, labels or comparable cooking methods; this exact recipe has not been kitchen-tested.');
 if(r.image)lines.splice(2,0,`<figure class="recipe-illustration"><img src="${r.image.src}" width="${r.image.width}" height="${r.image.height}" srcset="${r.image.detailSrcset}" sizes="(max-width:600px) 340px, 640px" alt="${r.image.alt}" loading="lazy" decoding="async" /><figcaption>${r.image.caption}</figcaption></figure>`);
 return lines.filter(Boolean).join('\n\n')+'\n\n';
}

// Stable keyed comments delimit generated content; everything outside belongs to the editor.
function replaceRegions(article, replacements) {
 const regions=replacements.map(([key,content])=>{
 const begin=`<!-- recipe-generated:${key}:begin -->`;
 const end=`<!-- recipe-generated:${key}:end -->`;
 const start=article.indexOf(begin);
 const finish=article.indexOf(end);
 if(article.split(begin).length!==2 || article.split(end).length!==2 || finish<start) throw new Error(`Missing, duplicate or inverted generated region: ${key}`);
 return {key,start,finish:finish+end.length,replacement:begin+'\n\n'+content.trim()+'\n\n'+end};
 }).sort((a,b)=>a.start-b.start);
 for(let i=1;i<regions.length;i++) if(regions[i].start<regions[i-1].finish) throw new Error(`Overlapping generated regions: ${regions[i-1].key} and ${regions[i].key}`);
 // Work right-to-left so validated offsets continue to refer to the original source.
 return regions.reduceRight((result,region)=>result.slice(0,region.start)+region.replacement+result.slice(region.finish),article);
}
export function generateRecipeArticle(article,data){
 const replacements=data.recipes.map(r=>[`recipe:${r.id}`,section(r)]);
// Derive all comparison tables from the same formulas used by the interactive UI.
const mealLink=r=>({html:`<a href="#${escapeHtml(r.id)}">${escapeHtml(r.title)}</a>`});
const cell=x=>x&&typeof x==='object'&&'html' in x?x.html:escapeHtml(String(x));
const table=(headers,rows)=>'<table>\n<thead><tr>'+headers.map(x=>'<th scope="col">'+cell(x)+'</th>').join('')+'</tr></thead>\n<tbody>\n'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+cell(x)+'</td>').join('')+'</tr>').join('\n')+'\n</tbody>\n</table>';
const overview=table(['Meal','Group','Appliance','Hands-on min','Total min','Attention and finish checks'],data.recipes.map(r=>[mealLink(r),{keto:'Keto',shared:'Keto + family',nonketo:'Non-keto'}[r.group],r.key==='potato_chicken'?'Microwave + oven':{'air-fryer':'Two air fryers',oven:'Oven','instant-pot':'Instant Pot',stovetop:'Frying pan',blender:'Blender'}[r.appliance],r.activeMinutes,`${r.totalMin}–${r.totalMax}${r.timeVariable?' expected':''}`,r.attentionSummary]));
const nutrition=table(['Recipe','Nutrition basis','kcal','Protein g','Total carbs g','Fiber g','Net carbs g'],data.recipes.map(r=>{const n=displayNutrition(r);return [mealLink(r),r.type==='smoothie'?'8 oz glass':'One quarter of recipe',Math.round(n.kcal),n.protein_g.toFixed(1),n.carbs_g.toFixed(1),n.fiber_g.toFixed(1),n.net_carbs_g.toFixed(1)];}));
const options=[...new Map(data.recipes.flatMap(r=>r.familyOptions).map(o=>[o.id,o])).values()];
const addons=table(['One family add-on per person','Approx kcal added','Total carbs g added','Fiber g added','Net carbs g added'],options.map(o=>[`${formatIngredient({...o,scale:'fixed'},4,'metric')} ${o.ingredientName}`,Math.round(o.nutrition.kcal),o.nutrition.carbs_g.toFixed(1),o.nutrition.fiber_g.toFixed(1),o.nutrition.net_carbs_g.toFixed(1)]));

 for(const [key,content] of [['overview',overview],['nutrition',nutrition],['family',addons]]) replacements.push([`table:${key}`,'<div class="recipe-table-scroll">\n'+content+'\n</div>']);
 return replaceRegions(article,replacements).replace(/^excerpt:.*$/m,'excerpt: "Easy meals and smoothies with keto and family choices, serving scaling and appliance filters."');
}
