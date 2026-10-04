# Meal library data contract

All recipe ingredient amounts describe the reviewed four-adult base, except familyOptions which describe one non-keto adult's starch. The 12 recipe IDs preserve the static article anchors. Canonical units distinguish mass, volume, count and spoon measures; source-specific US measures describe the same food quantity. Pesto and pressure liquid stay weighed/measured in grams/mL in both display modes because generic spoon conversions would be misleading.

Linear ingredient scaling supports 2/4/6/8 adults. Pressure liquid has a minimum constraint matching the named Duo 6 QT manual. Its small-batch per-serving nutrient difference is recalculated from the model's all-broth-counted contribution. Higher minima for another cooker are outside the numeric estimate and explicitly noted. Time, safe endpoints, cut size, patty geometry and capacity do not scale linearly. Six/eight servings require capacity checks/batches; the frittata explicitly uses two matching dishes. Fractional turkey eggs are beaten and weighed.

Family controls use one valid option per shared recipe. Missing or invalid option IDs fall back to its first choice consistently in detail and nutrition. Neither generic feta nor generic Parmesan is certified vegetarian; those recipes are conservatively plant-forward, with label guidance. The harissa/yogurt meal is vegetarian as specified.

Package guides calculate purchases from scaled ingredient weights. Purchased brands can differ; weigh drained food.

midCookActions counts scheduled starts, shakes, flips and ingredient additions to the main cooking appliances. Cold-side preparation and family-starch heating remain active work outside this count. Terminal temperature checks and separate food finish checks always remain; optional oven rack swaps are disclosed. Extra batches may add time.

Nutrition objects copy the unrounded ingredient model at four servings; presentation rounds estimates. servingNutrition adjusts fixed minimums for smaller batches. Family nutrition adds a measured starch to one base serving, leaving keto servings unchanged. Original recipe formulas, USDA records, label evidence and cooking adaptation boundaries remain in the persistent handoff package at `/Users/johnsolly/Documents/Codex/2026-10-02/overhaul-https-www-blogthedata-com-post/outputs/evidence/`. Recipe source links and modeled limits are also retained in the canonical data and public guide. No cooking, tasting or stopwatch testing is claimed.

Maintain recipes.json and its unit/allergen/family metadata together. Do not make protein-critical yogurt/Parmesan optional without recalculating. Do not substitute frozen/raw/dry food states or sauce brands without reviewing the resulting method and nutrition. The data notes are product assumptions, not a medical nutrition prescription.

Ingredients with a scaled mass of at least 1 g display grams. Canonical gramsPerUnit and massSource fields retain source-backed weights for spoon measures and eggs without changing the nutrition model. Finishing ingredients marked displayMeasure=spoon retain typed spoon quantities below 1 g. Fine salt uses the USDA table-salt mass of 6 g per teaspoon.

flow stores the mandatory TRN operation tree: ingredient leaves with fractional allocations (sum1) or a paired symbolic salt pinch/remainder, operations with children, and preparation rows. The renderer validates every ingredient, compacts same-input successive actions, and computes nonoverlapping rowspan/colspan cells. Family starch remains separate from the base tree. Current-setting assistant documents expose the rendered cell graph and measured family options without requiring model-weight precision.

Assistant JSON uses schemaVersion1 and contains current settings, stable recipe IDs, readable quantities, food states, dependency cells, steps, sources, restrictions, estimates and illustration metadata. Static downloads are for4adults, US units, no family starch selected; every shared recipe includes per-person starch options. Downloaded current-setting JSON and copied Markdown use the same recipeDocument as printing.

## Installable recipe page

The recipe article is a standalone PWA at its existing URL. Its manifest and
home-screen icons are in `public/recipes-pwa`. Safari users can choose Share →
Add to Home Screen; supported desktop and Android browsers offer installation
in their browser menu.

The production build generates a service worker beside the recipe page. It
precaches the built recipe page, its JavaScript/CSS/font dependencies, recipe
illustrations and the two assistant downloads as one versioned snapshot. The
page reports when that snapshot is ready. Other blog pages and external recipe
sources require a connection. Servings and recipe-side choices persist in browser storage. Meal planning and interactive shopping lists have been removed.

New snapshots download on a connected visit. Updates wait until all recipe tabs
and app windows close, then activate on reopening. No forced reload interrupts
cooking. Failed downloads leave the previous snapshot available; browser storage
eviction or clearing site data requires another connected visit.

Use a production build and `npm run preview` to verify offline behavior. The
worker is generated at build time and is absent from the development server.

## Maintenance commands

The canonical recipe data is `src/components/recipes/recipes.json`. Run these commands
from `/Users/johnsolly/code/awesome-blog` after editing it:

```bash
npm run recipes:sync
npm run test:recipes
npm run gate
```

`recipes:sync` regenerates all twelve complete recipe sections and the three
overview/nutrition/family tables in the existing article. It preserves frontmatter
except the generated excerpt, and preserves editorial guidance. It also updates `public/data/recipe-library.json` and
`public/data/recipe-library.md`. `recipes:check` checks synchronization without
writing files and runs in the app gate. Review editorial advice when the method,
food state, capacity or nutrition changes; generated sections cannot do that.

Keep the `recipe-generated` begin/end comments around generated regions. Recipe
regions use stable recipe IDs; the three comparison tables each have their own
key. Titles and region order can change without changing ownership. Add editorial
content outside these comments; it remains untouched, including HTML tables.

The article retains `/post/15-minute-dump-and-go-instant-pot-recipes/`. Its route
uses `RecipeExperience.astro`. Interactive details and the no-JavaScript view
render the same `RecipeBody` and `RecipeFlow` components. The library and initial
recipe cards appear before hydration. JavaScript-disabled visitors see anchored
four-serving recipes, native ingredient checkboxes and nutrient disclosures.
Static family sides show the default four-diner option. Print and assistant
exports retain the expanded guide and share the ingredient and dependency model.

During this migration only, an explicit rewrite receipt pins the authorized
replacement and the original legacy record. Reconcile any new frozen-source
changes before updating that receipt. Ordinary publishing after cutover uses the
normal gate and does not require parity with the retired application source.

## Recipe browsing

The cards shuffle once on each page load, independently of recipe settings. Protein and Meal style filters narrow results without reordering shuffled cards. The three carb buttons match card categories: Keto, Not Keto, Shared Main; clicking an active button clears the category filter. Cards show active time, estimated base-meal net carbs for the selected serving count (before family starch), and accessible icons for canonical `appliancesNeeded` requirements. Servings and recipe-side choices persist locally; shared URLs override those settings. Recipe instructions retain stage timings and safety checks. Individual recipes, recipes and the whole collection remain printable; there is no plan or shopping-list print mode.

Recipe settings use `blogthedata-recipes-v2`. Old meal-plan storage is left intact but is no longer read or updated.

Ingredient display uses grams whenever the scaled canonical mass is at least 1 g, including split flow allocations. Subgram quantities retain typed source measures; volumes and counts retain their canonical conversions. Cooking flow has a native dialog explaining Tabular Recipe Notation; Escape and its close button return to the recipe.

The interactive cooking interface uses only the flow table, with a checkbox for each ingredient allocation. Separate ingredient and cooking-step checklists are removed; canonical steps remain for printing and assistant exports. Static reading uses the same cooking flow as interactive details. Table rows retain ingredient notes and purchase hints; preparation rows retain equipment, safe handling and selected family-side heating. Checks reset when another recipe opens.

Recipe detail keeps appliance icons above the photo/table, a concise family-side selector and quantity, and always-visible nutrition. General capacity alerts, duplicate side section, rationale/source disclosures and nutrition explanations are removed from the interactive view. The method link sits below the table. Pressure-flow actions are condensed while retaining pressure time, release time and165°F endpoint; canonical full steps remain in print/export content.

Recipe details use the card badge, a short meal description, whole-gram ingredient amounts (spoon measures below one gram), decorative food symbols, and rounded nutrition per serving. The detail toolbar offers Back and Print recipe; clipboard actions, JSON downloads, cooking view and chart-only printing have been removed. Side nutrition is omitted from the display.

Extended nutrition is in `nutrition-data.json`, calculated by `nutrition.mjs`: 23 vitamins, minerals and choline plus total fat, saturated fat and cholesterol, using FDA Daily Values. USDA SR Legacy profiles share the existing macro model’s ingredient weights; gnocchi uses USDA FNDDS 2708722. Generic pesto/salsa/gnocchi profiles approximate the branded products, red pepper approximates harissa, and the fortified yeast label overrides a dry-yeast mineral profile. Salt is included in sodium. Values do not apply cooking-retention factors. Nutrient totals with missing ingredient observations are omitted from the display; biotin, chloride, chromium, iodine and molybdenum lack sufficient data and are not shown. Print and structured recipe documents include the same values.

Nutrition focus checkboxes combine with AND and the protein/carb category filters. Immune support requires at least20% DV in two of A,C,D,zinc,selenium; Iron-rich requires20% DV of iron. Qualification uses unrounded nutrient amounts, excludes missing totals, and counts only the base meal per serving. Checkbox preferences persist locally. Immune support describes nutrient content, not a demonstrated change in immune function; reference NIH Office of Dietary Supplements immune-function fact sheet and FDA20%DV guidance.

Nutrition filter criteria are available through a native click/tap info popover. Protein and servings dropdowns use an inset bundled chevron.

Recipe controls share one bordered panel: servings first, protein and carb type next, nutrition focus with an inline info popover next, and Print all recipes last. Responsive visual order matches keyboard order. The info icon stays attached to the nutrition-focus heading on narrow screens.

Protein, Carb and Meal style controls sit alongside nutrient focus. Choices that would leave no recipes are disabled; persisted unsupported values are reset to All, and invalid saved combinations reset the two categories. Card metric values share a baseline and omit Base. Recipe titles use the site heading font; post footer links use theme-colored button styling, with dates displayed without an updater byline. Author remains in public structured metadata.

Daily Values use the Bits UI Collapsible primitive underlying shadcn-svelte, styled with local theme tokens and a rotating chevron. It defaults closed on each recipe opening; macros remain visible and print retains every nutrient. Numeric carb range settings are no longer read or saved.

Carb filters main starches and available family sides: rice, pasta (including gnocchi), bread, tortillas, potatoes, legumes, or no starch. Meal style retains Keto, Not Keto and Shared Main. Invalid combined preferences reset all three category filters. The cooking table has an outer rounded frame separate from its horizontal scrolling region; separate cell borders avoid collapsed-border clipping.

Protein and Carb are checkbox multi-select popovers using generated shadcn-svelte Popover and Checkbox components. Selected values combine with OR within each filter, and filters combine with AND. Empty selection includes all types. Browser storage keeps validated arrays; old scalar preferences migrate to one selection. Checkboxes prevent changes that would leave no results; Clear selections broadens to all types. Social icons match the portfolio’s 300ms ease-in-out scale1.1/opacity hover treatment, with reduced-motion support.

Opening a recipe uses a full-viewport shadcn-svelte Dialog, with the rest of the page inert. Recipe hashes support direct links, reload and browser Back/Forward. Back to recipes and Escape close the view and return focus to the originating card; the method dialog has its own Escape behavior. Print renders the separate recipe document. Cooking table borders use the softer theme line token; ingredient icons follow names so quantities align. Reset cooking checks is an outlined button above the table.

Meal style supports Shared Main plus either Keto or Not Keto; selecting the opposite replaces only the exclusive style. Empty selection includes all styles. Style arrays persist locally, with old single values normalized. The nutrient fieldset label is Nutrition. The site header uses a bundled topographic contour SVG.

Easy Meals includes 13 meals and four smoothies, selected with a persisted Meals/Smoothies control. Pan-fried Greek turkey patties use one 12-inch nonstick frying pan in batches of four; original ingredients, nutrition profiles and illustration remain the same as the air-fryer version. Smoothies use plain lowfat Greek yogurt, edible fruit weights and direct USDA SR Legacy profiles (167762 strawberries,173944 banana,170903 yogurt,171705 avocado,169414 flax,168409 cucumber,168156 lime). No added sugar; two keto blends have under8g net carbs per serving, while two banana blends are Not Keto. Micronutrients retain unknown-data omission. Blend up to two servings per batch; larger serving counts add batches. New smoothie images are bundled vector illustrations.

Appliances on hand stores validated counts (0–2 pressure cookers/air fryers,0–1 other appliances). Every required appliance must be available; two-fryer recipes require2. Each appliance uses one icon. Oven-off disables Pans and makes pans unavailable as the requested inventory UI rule; the pan-fried method itself uses a stovetop. The blender option covers smoothies. Appliance changes may leave no matching recipes; the empty state asks users to adjust appliances and filters. Switching collections or opening deep links clears incompatible category/nutrition filters while preserving appliance inventory. Cards share five subgrid tracks so titles can wrap without shifting metrics within each row. Share links use bundled logos with accessible platform names; the article All posts button is removed. Header, favicon, legacy logo.webp and PWA icon exports share the topographic SVG artwork.

The Meals/Smoothies switch uses a full-width large segmented control. Collapsed micronutrients preview the three highest known Daily Values. Gram ingredient quantities omit the space before g. Shawarma has separate oil/spice rows per pan, a plain pinch-of-salt sauce row, and fractional remaining salt portions that preserve the total allocation. Oven setup belongs to the roasting operation; redundant reservation/preparation rows are removed.

All new recipe standard controls compose installed/generated shadcn-svelte sources: Button, Native Select, Checkbox, Popover, Collapsible, and Dialog. Dialog portals avoid container-layout containment; the recipe takeover overrides centering/animation utilities to fill the viewport, while the method dialog remains centered. Reload validates category/nutrition compatibility against the complete appliance set and preserves an empty user inventory without discarding filters. Built-app regression tests cover these workflows and offline smoothie SVG decoding.

Recipe details end with Share recipe. Native sharing falls back to copying a deep link, or showing the link if clipboard access fails. Links preserve servings and selected family starch. Static recipes offer a permalink. Nutrition Daily Values appear highest first; missing values sort last. Liquid displays use oz while canonical data keeps volume distinct from mass. Smoothie flow rows use full-size blender loading order: liquids and yogurt first, then seeds, greens and fruit. Meal rows keep the main ingredient beside its oil/seasonings, while pressure recipes keep cooking liquid first.

Meals and Smoothies have separate card grids at `/recipes/meals/` and `/recipes/smoothies/`. Each card links to `/recipes/<recipe-id>/`, which server-renders one shared recipe body and enhances its cooking controls with JavaScript. Without JavaScript, native checks and nutrient disclosures work and the collection grids hide interactive filters. Existing article fragments retain their enhanced dialog behavior. Shared links now use individual recipe URLs. Offline snapshots include both grids and every recipe page; the worker has root scope but only intercepts its explicit recipe asset allowlist.

The non-JavaScript recipe body uses the base four-serving recipe and default family side. Scaling and alternate-side query settings require JavaScript. The legacy worker URL remains available for installed-app updates, with an independent cache namespace.

Chicken Posole (enchilada soup) restores the legacy bean-based soup in Meals at `/recipes/chicken-posole/`. Original measured ingredients remain; John approved adding 400g cooked chicken for four adults because the source omitted chicken. The source gave no pressure time, so the restored version uses a documented stovetop adaptation. Cabbage and cilantro garnishes are measured at150g and8g. Nutrition models remain beside the recipe in `nutrition-data.json`, including source URLs and per100g macros; incomplete micronutrient totals stay omitted. The recipe is Not Keto and matches the Legumes filter.
