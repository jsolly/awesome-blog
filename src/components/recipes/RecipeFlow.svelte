<script>
 import Button from '$lib/components/ui/button/button.svelte';
 import Checkbox from '$lib/components/ui/checkbox/checkbox.svelte';
 import DialogRoot from '$lib/components/ui/dialog/dialog.svelte';
  import DialogContent from '$lib/components/ui/dialog/dialog-content.svelte';
  import DialogTitle from '$lib/components/ui/dialog/dialog-title.svelte';
  import DialogDescription from '$lib/components/ui/dialog/dialog-description.svelte';
 import {ingredientIcon} from './ingredient-icon.mjs';
 import {flowGrid} from './trn-logic.mjs';
 let {recipe,settings,interactive=true,headingLevel=3}=$props();
 let methodOpen=$state(false);
 const grid=$derived(flowGrid(recipe,settings));
 let checks=$state([]);
 function toggle(row){checks=checks.includes(row)?checks.filter(i=>i!==row):[...checks,row];}
</script>
<section class="trn-view" aria-label="Tabular recipe notation"><div class="flow-toolbar"><svelte:element this={`h${headingLevel}`}>{recipe.type==='smoothie'?'Preparation flow':'Cooking flow'}</svelte:element></div><p class="trn-help">Read left to right. Each merged cell acts on the ingredient rows feeding into it. Parallel branches stay separate until plating.</p><!-- Keyboard focus allows horizontal scrolling of the wide table. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="trn-frame"><div class="trn-scroll" tabindex="0" role="region" aria-label={`${recipe.title} cooking flow, scroll horizontally`}><table class="trn-table"><tbody>
 {#each grid.prep as text,i (i)}<tr><td colspan={grid.columns} class="trn-prep">{text}</td></tr>{/each}
 {#if interactive}<tr class="reset-checks-row"><td colspan={grid.columns}><Button variant="ghost" class="reset-checks" type="button" onclick={()=>checks=[]}>Reset cooking checks</Button></td></tr>{/if}
 {#each grid.rows as row,i (i)}<tr>{#each row.cells as cell (cell.col)}{#if cell.kind==='ingredient'}<th scope="row" colspan={cell.colspan} class="trn-ingredient" class:checked={checks.includes(i)}><label>{#if interactive}<Checkbox aria-label={`Added ${cell.name}, ${cell.text}`} checked={checks.includes(i)} onCheckedChange={()=>toggle(i)}/>{:else}<input type="checkbox" aria-label={`Added ${cell.name}, ${cell.text}`} />{/if}<span><strong>{cell.text}</strong> {cell.name}{#if ingredientIcon(cell.name)} <span class="ingredient-icon" aria-hidden="true">{ingredientIcon(cell.name)}</span>{/if}<small>{cell.state}</small></span></label></th>{:else}<td rowspan={cell.rowspan} colspan={cell.colspan} class="trn-operation">{cell.text}</td>{/if}{/each}</tr>{/each}
 </tbody></table></div></div>{#if interactive}<Button variant="ghost" class="learn-method" type="button" onclick={()=>methodOpen=true}>Learn more about Tabular Recipe Notation</Button>
<DialogRoot bind:open={methodOpen}><DialogContent class="method-dialog" showCloseButton={false}><DialogTitle id="trn-method-title">Tabular Recipe Notation</DialogTitle><DialogDescription class="sr-only">How to read a cooking dependency table.</DialogDescription><p>This format connects ingredients to cooking steps in a table. Read from left to right: each ingredient row feeds into the operation beside it. A merged operation cell uses all the ingredient rows alongside it.</p><p>Follow each branch across the table. Separate branches let you prepare parts of the meal independently; they join when those parts are combined or plated. Preparation notes at the top apply before you start.</p><p>The table shows which ingredients each step uses. Preparation notes at the top list the equipment and steps to complete first. Tick each ingredient row as you add that portion; split ingredients have separate checks.</p><p>The format comes from Michael Chu’s <a href="https://www.cookingforengineers.com/">Cooking for Engineers <span aria-hidden="true">↗</span></a>.</p><Button variant="outline" onclick={()=>methodOpen=false}>Close and continue recipe</Button></DialogContent></DialogRoot>{:else}<a class="learn-method" href="https://www.cookingforengineers.com/">Learn more about Tabular Recipe Notation <span aria-hidden="true">↗</span></a>{/if}</section>
<style>
 :global(.learn-method){border:0;background:none;color:var(--recipe-accent,#355b40);text-decoration:underline;padding:8px 0;margin-bottom:12px;cursor:pointer;font:inherit}:global(.method-dialog){max-width:540px;width:calc(100% - 32px);max-height:80vh;overflow:auto;border:1px solid var(--recipe-input-border);border-radius:14px;padding:24px;color:var(--recipe-ink);background:var(--recipe-flow-paper)}:global(.method-dialog p){line-height:1.6}:global(.method-dialog button){min-height:44px;padding:8px 14px}:global(.method-dialog:focus-visible),:global(.learn-method:focus-visible){outline:3px solid var(--recipe-focus);outline-offset:3px}
 .ingredient-icon{display:inline-block;width:1.4em;margin-left:4px;font-size:1.1em;line-height:1;vertical-align:baseline}.trn-ingredient label{display:flex;align-items:flex-start;gap:8px;font-weight:400}.trn-ingredient :global([data-slot=checkbox]){width:19px;height:19px;flex-shrink:0;accent-color:var(--recipe-accent)}.trn-ingredient.checked span{opacity:.6;text-decoration:line-through}.flow-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px}.flow-toolbar h3{margin:0}:global(.reset-checks){font-size:.8rem!important;border:1px solid var(--recipe-line,#d4dacb);background:transparent;color:var(--recipe-ink,#25392b);border-radius:8px;padding:8px 12px;min-height:44px}.trn-view{margin:26px 0;max-width:100%;min-width:0}.trn-help{font-size:.85rem;line-height:1.5;max-width:55rem}
 .trn-frame{max-width:100%;border:1px solid var(--recipe-line,#d4dacb);border-radius:6px;overflow:hidden;background:var(--recipe-flow-paper)}.trn-view :global(.trn-scroll){overflow-x:auto;max-width:100%}
 .trn-frame:has(.trn-scroll:focus-visible){outline:3px solid var(--recipe-accent,#365b3d);outline-offset:3px}.trn-view :global(.trn-scroll:focus-visible){outline:none}
 .trn-view :global(.trn-table){border-collapse:collapse;border:1px solid var(--recipe-line,#d4dacb);border-spacing:0;width:100%;min-width:760px;table-layout:auto;margin:0!important;font-size:14px;line-height:1.4;background:var(--recipe-flow-paper);color:var(--recipe-flow-ink)}
 .trn-view :global(caption){text-align:left;padding:10px;font-size:13px;background:var(--recipe-flow-caption);color:var(--recipe-flow-ink)}
 .trn-view :global(th),.trn-view :global(td){border:1px solid var(--recipe-line,#d4dacb);padding:8px;vertical-align:middle;white-space:normal;overflow-wrap:anywhere}
 .trn-view :global(.trn-ingredient){font-weight:400;text-align:left;min-width:220px}
 .trn-view :global(.trn-ingredient small){display:block;font-size:11px;line-height:1.3;margin-top:3px}
 .trn-view :global(.trn-operation){text-align:center;min-width:100px;max-width:200px}
 .trn-view :global(.reset-checks-row td){text-align:left}
 .trn-view :global(.trn-prep){text-align:center;background:var(--recipe-flow-prep)}
 @media print{
 .reset-checks-row,:global(.learn-method){display:none!important}
 .flow-toolbar :global(button),:global(.learn-method),:global(.method-dialog),.trn-ingredient :global([data-slot=checkbox]){display:none!important}
 .trn-view{margin:10pt 0;break-inside:avoid}.trn-help{display:none}.trn-view h3{font:700 12pt/1.2 Georgia,serif;margin:6pt 0}
 .trn-frame{overflow:visible;border:0;border-radius:0}.trn-view :global(.trn-scroll){overflow:visible}
 .trn-view :global(.trn-table){min-width:0!important;width:100%;border:1px solid #555!important;table-layout:fixed;font-size:8pt!important;line-height:1.2!important;background:white!important}
 .trn-view :global(th),.trn-view :global(td){padding:3pt!important;min-width:0!important;max-width:none!important;line-height:1.2!important;font-size:8pt!important;border-color:#555!important}
 .trn-view :global(.trn-ingredient small){font-size:7pt!important}
 .trn-view :global(caption){font-size:8pt!important;padding:4pt!important}
 }
</style>
