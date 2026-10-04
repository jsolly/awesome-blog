import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {validateFlow,flowGrid,flowHtml} from './trn-logic.mjs';
const {recipes}=JSON.parse(readFileSync(new URL('./recipes.json',import.meta.url),'utf8'));
test('all recipe dependency diagrams allocate all ingredients and produce a complete nonoverlapping merged-cell grid',()=>{
 for(const recipe of recipes){assert(validateFlow(recipe));for(const servings of [2,4,6,8]){
 const grid=flowGrid(recipe,{servings,units:'metric'});const occupied=grid.rows.map(()=>Array(grid.columns).fill(false));
 for(let row=0;row<grid.rows.length;row++)for(const cell of grid.rows[row].cells){
  assert(cell.colspan>0&&cell.rowspan>0);
  for(let y=row;y<row+cell.rowspan;y++)for(let x=cell.col;x<cell.col+cell.colspan;x++){assert(y<grid.rows.length&&x<grid.columns,recipe.id);assert(!occupied[y][x],`${recipe.id} overlap${y},${x}`);occupied[y][x]=true;}
 }
 assert(occupied.every(row=>row.every(Boolean)),recipe.id);assert(grid.columns<=6,`${recipe.id} excessively wide`);
 const last=grid.rows[0].cells.at(-1);assert.equal(last.rowspan,grid.rows.length);assert.equal(last.col,grid.columns-1);
 }}
});
test('incomplete or duplicate ingredient allocations fail closed',()=>{
 const r=structuredClone(recipes[0]);r.flow.root.children.pop();assert.throws(()=>validateFlow(r),/Unallocated/);
 const r2=structuredClone(recipes[0]);r2.flow.root.children.push({ingredientId:'hemp_hearts'});assert.throws(()=>validateFlow(r2),/Unbalanced/);
});
test('tables keep scaled spoon measures, safe endpoint conversions and symbolic pinches',()=>{
 const salmon=recipes.find(r=>r.key==='salmon');const html=flowHtml(salmon,{servings:2,units:'metric'});assert.match(html,/¼ tsp/);assert.match(html,/63°C \(145°F\)/);assert.match(html,/1g<\/strong> Lemon zest/);
 const shawarma=recipes.find(r=>r.key==='shawarma');const s=flowHtml(shawarma,{servings:4,units:'metric'});assert.match(s,/pinch of/);assert.match(s,/½ remaining/);assert.match(s,/rowspan=/);
});

test('split symbolic salt preserves one pinch and a complete positive remainder',()=>{
 const recipe=recipes.find(r=>r.key==='shawarma');assert(validateFlow(recipe));
 const invalid=structuredClone(recipe);const branches=invalid.flow.root.children[2].children;
 branches[0].children.find(x=>x.share==='remainder').fraction=-1;branches[1].children.find(x=>x.share==='remainder').fraction=2;
 assert.throws(()=>validateFlow(invalid),/Invalid ingredient fraction/);
 branches[0].children.find(x=>x.share==='remainder').fraction=.25;branches[1].children.find(x=>x.share==='remainder').fraction=.5;
 assert.throws(()=>validateFlow(invalid),/Unbalanced symbolic allocation/);
});


test('smoothie loading starts with liquids and keeps seeds and greens ahead of fruit',()=>{
 for(const recipe of recipes.filter(r=>r.type==='smoothie')){
  const rows=flowGrid(recipe,{servings:4,units:'us'}).rows;
  assert.equal(rows[0].ingredient.ingredientId,'water',recipe.id);
  const ids=rows.map(r=>r.ingredient.ingredientId);
  const firstFruit=Math.min(...['avocado','banana','strawberry','cucumber'].map(id=>ids.indexOf(id)).filter(i=>i>=0));
  for(const id of ['lime','yogurt','flax','hemp','spinach'])if(ids.includes(id))assert.ok(ids.indexOf(id)<firstFruit,recipe.id+' '+id);
 }
});
