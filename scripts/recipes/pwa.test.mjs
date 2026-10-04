import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, cp, mkdtemp, rm, symlink } from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { resolve, extname, join } from 'node:path';
import { chromium } from 'playwright';
import { recipeRoute, buildRecipePwa } from './pwa-build.mjs';

let server, browser, origin, fixture, legacyDirectory;
const snapshots = [];
let version = 1;
let failDownload = false;
const root = resolve('dist');
// Playwright's waitForFunction polls synchronous predicates. Await browser-side
// service worker/cache reads here before deciding whether the condition passed.
async function waitForBrowserState(page, predicate, argument) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate, argument)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail('Browser state did not reach the expected condition within 30 seconds');
}
before(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'recipe-pwa-test-'));
  for (const label of ['A', 'B']) {
    const directory = join(fixture, label);
    await cp(root, directory, { recursive: true });
    const htmlPath = `${directory}${recipeRoute}index.html`;
    const html = (await readFile(htmlPath, 'utf8')).replace('</head>', `<meta name="pwa-test-snapshot" content="${label}"></head>`);
    await writeFile(htmlPath, html);
    const dataPath = `${directory}/data/recipe-library.json`;
    const data = JSON.parse(await readFile(dataPath, 'utf8'));
    await writeFile(dataPath, JSON.stringify({ ...data, testSnapshot: label }));
    const snapshot = await buildRecipePwa(pathToFileURL(`${directory}/`));
    snapshots.push({ directory, ...snapshot });
    const firstWorker = await readFile(`${directory}/recipe-service-worker.js`, 'utf8');
    await buildRecipePwa(pathToFileURL(`${directory}/`));
    assert.equal(await readFile(`${directory}/recipe-service-worker.js`, 'utf8'), firstWorker);
    assert.deepEqual(snapshot.urls, [...snapshot.urls].sort());
  }
  assert.notEqual(snapshots[0].cache, snapshots[1].cache);
  // Freeze the actual previous release, rather than simulating it with the new builder.
  // git archive creates no repository or shared Git configuration in the fixture.
  const legacySha='d6adba53e272964cc8c8e9583281dd1f35d8cc98';
  const legacySource=join(fixture,'previous-release');await mkdir(legacySource);
  const archive=execFileSync('git',['archive',legacySha],{maxBuffer:100*1024*1024});
  execFileSync('tar',['-x','-C',legacySource],{input:archive});
  await symlink(resolve('node_modules'),join(legacySource,'node_modules'),'dir');
  const buildEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
  buildEnv.GIT_CONFIG_GLOBAL='/dev/null';buildEnv.GIT_CONFIG_NOSYSTEM='1';
  buildEnv.GITHUB_SHA=legacySha;buildEnv.VERCEL_GIT_COMMIT_SHA=legacySha;
  execFileSync(process.execPath,[resolve('node_modules/astro/bin/astro.mjs'),'build'],{cwd:legacySource,env:buildEnv,maxBuffer:10*1024*1024});
  legacyDirectory=join(legacySource,'dist');
  const legacyHtml=join(legacyDirectory,recipeRoute,'index.html');
  await writeFile(legacyHtml,(await readFile(legacyHtml,'utf8')).replace('</head>','<meta name="pwa-test-snapshot" content="LEGACY"></head>'));
  const priorBuilder=await import(pathToFileURL(join(legacySource,'scripts/recipes/pwa-build.mjs')));
  await priorBuilder.buildRecipePwa(pathToFileURL(`${legacyDirectory}/`));
  server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const servingRoot = version===0?legacyDirectory:snapshots[version - 1].directory;
    const path = resolve(servingRoot, `.${url.pathname}${url.pathname.endsWith('/') ? 'index.html' : ''}`);
    if (!path.startsWith(`${servingRoot}/`)) { response.writeHead(403).end(); return; }
    if (failDownload && url.pathname === '/recipes-pwa/icon-512.png') { response.writeHead(503).end(); return; }
    try {
      let body = await readFile(path);
      const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
      response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'text/plain', 'Cache-Control': 'no-store' }).end(body);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); await rm(fixture, { recursive: true, force: true }); });

for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  test(`Recipe PWA installs and cooking tools work offline on ${name}`, { timeout: 60000 }, async () => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (['warning', 'error'].includes(message.type())) errors.push(message.text()); });
    try {
      await page.goto(`${origin}${recipeRoute}`);
      await page.getByText('Recipes saved for offline use.', { exact: false }).waitFor({ state: 'attached' });
      await page.waitForFunction(() => navigator.serviceWorker.controller);
      const metadata = await page.evaluate(async () => {
        const manifest = await fetch(document.querySelector('link[rel="manifest"]').href).then(r => r.json());
        const registration = await navigator.serviceWorker.getRegistration();
        return { manifest, scope: registration.scope };
      });
      assert.equal(metadata.manifest.scope, '/');
      assert.equal(metadata.manifest.start_url, recipeRoute);
      assert.equal(metadata.manifest.display, 'standalone');
      assert.equal(metadata.scope, `${origin}/`);
      for (const icon of metadata.manifest.icons) {
        assert.equal(await page.evaluate(async url => (await fetch(url)).status, icon.src), 200);
      }
      await context.setOffline(true);
      await page.reload();
      await page.getByText('You are offline.', { exact: false }).waitFor({ state: 'attached' });
      await page.getByRole('combobox', { name: 'Servings', exact: true }).selectOption('2');
      await page.locator('.recipe-card').filter({hasText:'Lemon salmon and asparagus'}).getByRole('link',{name:/See recipe/}).click();
      assert.ok(await page.locator('.recipe-detail').isVisible());
      assert.ok(await page.locator('.recipe-detail .trn-table').count() > 0);
      await page.waitForFunction(() => [...document.querySelectorAll('.recipe-detail img')].every(image => image.complete && image.naturalWidth > 0));
      assert.equal(await page.evaluate(async () => (await fetch('/data/recipe-library.json')).status), 200);
      assert.equal(await page.evaluate(async () => (await fetch('/data/recipe-library.md')).status), 200);
      await page.emulateMedia({ media: 'print' });
      assert.equal(await page.locator('.recipe-pwa').isVisible(), false);
      await page.emulateMedia({ media: 'screen' });
      if (process.env.PWA_SCREENSHOTS) {
        await mkdir('.migration-work/pwa', { recursive: true });
        await page.screenshot({ path: `.migration-work/pwa/${name}-offline.png`, fullPage: true });
        await page.getByRole('link', { name: '← Back to meals', exact: true }).click();
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: `.migration-work/pwa/${name}.png` });
      }
      // Changing the recipe URL's query or fragment still opens the cached app.
      await page.goto(`${origin}${recipeRoute}?cooking=1#meal-results`);
      await page.getByRole('combobox', { name: 'Servings', exact: true }).waitFor();
      assert.equal(await page.getByRole('combobox', { name: 'Servings', exact: true }).inputValue(), '2');
      assert.deepEqual(errors, []);
      await context.setOffline(false);
      await page.goto(`${origin}/`);
      assert.equal(await page.evaluate(() => navigator.serviceWorker.controller !== null), true);
    } finally { await context.close(); }
  });
}

for (const width of [390, 1280]) {
  test(`Easy Meals preserves filters and recipe navigation at ${width}px`, { timeout: 60000 }, async () => {
    const context = await browser.newContext({ viewport: { width, height: 984 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    const ready = () => page.locator('[data-hydrated=true]').waitFor();
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('blogthedata-recipes-v2')));
    try {
      await page.goto(`${origin}${recipeRoute}`); await ready();
      await page.getByRole('button', { name: /^Proteins:/ }).click();
      await page.getByRole('checkbox', { name: 'Fish', exact: true }).check();
      await page.getByRole('checkbox', { name: 'Turkey', exact: true }).check();
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /^Carbs:/ }).click();
      assert.equal(await page.getByRole('checkbox', { name: 'No starch', exact: true }).count(),0);
      await page.getByRole('checkbox', { name: 'Bread', exact: true }).check();
      await page.keyboard.press('Escape');
      await page.getByRole('combobox', { name: 'Pressure cookers count', exact: true }).selectOption('0');
      await page.getByRole('combobox', { name: 'Air fryers count', exact: true }).selectOption('0');
      await page.getByRole('checkbox', { name: 'Oven', exact: true }).uncheck();
      await page.getByRole('checkbox', { name: 'Microwave', exact: true }).uncheck();
      assert.equal(await page.getByRole('checkbox', { name: 'Blender', exact: true }).count(),0);
      assert.equal(await page.getByRole('checkbox', { name: 'Pans', exact: true }).isDisabled(), true);
      assert.equal(await page.locator('.recipe-card').count(), 0);
      const before = await stored();
      assert.deepEqual(before.proteinChoice, ['fish', 'turkey']);
      assert.deepEqual(before.starchChoice, ['bread']);
      await page.reload(); await ready();
      const after = await stored();
      assert.deepEqual(after.proteinChoice, before.proteinChoice);
      assert.deepEqual(after.starchChoice, before.starchChoice);
      assert.deepEqual(after.appliancesOnHand, before.appliancesOnHand);
      assert.equal(await page.getByRole('checkbox', { name: 'Pans', exact: true }).isDisabled(), true);
      assert.equal(await page.locator('.recipe-card').count(), 0);
      await page.getByRole('checkbox', { name: 'Oven', exact: true }).check();
      await page.getByRole('checkbox', { name: 'Microwave', exact: true }).check();


      await page.getByRole('link', { name: 'Smoothies', exact: true }).click(); await ready();
      assert.equal(await page.locator('.recipe-card').count(), 6);
      assert.equal(await page.getByRole('button', { name: /^Proteins:/ }).count(), 0);
      assert.equal(await page.getByRole('button', { name: /^Carbs:/ }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Shared Main', exact: true }).count(), 0);
      assert.equal(await page.locator('.inventory-options label').count(), 1);
      await page.getByRole('button', { name: /^Ingredients:/ }).click();
      await page.getByRole('checkbox', { name: 'Hulled hemp hearts', exact: true }).check();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.recipe-card').count(), 1);
      await page.reload(); await ready();
      assert.deepEqual((await stored()).ingredientChoice, ['hemp']);
      assert.equal(await page.locator('.recipe-card').count(), 1);
      await page.getByRole('button', { name: /^Ingredients:/ }).click();
      await page.getByRole('button', { name: 'Clear selections', exact: true }).click();
      await page.keyboard.press('Escape');
      await page.getByRole('checkbox', { name: 'Keto Friendly', exact: true }).check();
      assert.equal(await page.locator('.recipe-card').count(), 4);
      await page.reload(); await ready();
      assert.equal(await page.getByRole('link', { name: 'Smoothies', exact: true }).getAttribute('aria-current'), 'page');
      assert.equal((await stored()).smoothieKetoOnly, true);
      assert.equal(await page.locator('.recipe-card').count(), 4);
      await page.waitForFunction(() => [...document.querySelectorAll('.recipe-card img')].every(image => image.complete && image.naturalWidth > 0));
      await page.getByRole('link', { name: 'Avocado-lime smoothie', exact: true }).click();
      await page.locator('.recipe-detail .reset-checks-row').waitFor();
      await page.getByRole('button', { name: 'Learn more about Tabular Recipe Notation', exact: true }).click();
      await page.locator('.method-dialog').waitFor();
      await page.keyboard.press('Escape');
      await page.locator('.method-dialog').waitFor({ state: 'detached' });
      assert.equal(await page.locator('.recipe-detail').isVisible(),true);
      await page.getByRole('link',{name:'← Back to smoothies',exact:true}).click();await ready();
      await page.goBack();await page.locator('.recipe-detail').waitFor();
      await page.goForward();await ready();
      await page.evaluate(() => localStorage.setItem('blogthedata-recipes-v2', JSON.stringify({ collection: 'meal', ironRich: true, servings: 8 })));
      await page.goto(`${origin}${recipeRoute}?deep-link=1#strawberry-banana-smoothie`);
      await page.locator('.recipe-takeover').waitFor();
      assert.match(await page.locator('.recipe-takeover').innerText(), /up to two servings/);
      assert.match(await page.locator('.recipe-takeover').innerText(), /Nutrition per 8 oz glass/);
      await page.getByRole('button', { name: /^Vitamins & minerals/ }).click();
      assert.equal(await page.locator('.daily-values').getByText('0% DV', { exact: true }).count(), 0);
      assert.equal(await page.locator('.recipe-takeover .reset-checks-row').count(), 1);
      assert.match(await page.locator('.recipe-takeover .trn-table').innerText(), /27 oz Cold water/);
      await page.keyboard.press('Escape');
      await page.locator('.recipe-takeover').waitFor({ state: 'detached' });
      assert.equal(await page.locator('.recipe-card').count(), 6);
      assert.equal((await stored()).ironRich, true);
      assert.equal(await page.getByRole('checkbox',{name:'Iron-rich',exact:true}).count(),0);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
}

test('Distinct snapshot update waits for both tabs, then serves new recipes offline', { timeout: 60000 }, async () => {
  version = 1;
  const context = await browser.newContext();
  const snapshotLabel = page => page.locator('meta[name="pwa-test-snapshot"]').getAttribute('content');
  try {
    const tabs = [await context.newPage(), await context.newPage()];
    for (const page of tabs) {
      await page.goto(`${origin}${recipeRoute}`);
      await page.getByText('Recipes saved for offline use.', { exact: false }).waitFor({ state: 'attached' });
      assert.equal(await snapshotLabel(page), 'A');
    }
    version = 2;
    await tabs[0].evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration(); await registration.update(); });
    await tabs[0].getByText('Updated recipes are downloaded.', { exact: false }).waitFor({ state: 'attached' });
    await context.setOffline(true);
    for (const page of tabs) {
      await page.reload();
      assert.equal(await snapshotLabel(page), 'A');
      assert.equal(await page.evaluate(async () => (await fetch('/data/recipe-library.json')).json().then(data => data.testSnapshot)), 'A');
    }
    await tabs[0].close();
    assert.equal(await tabs[1].evaluate(async () => (await navigator.serviceWorker.getRegistration()).waiting.state), 'installed');
    assert.ok((await tabs[1].evaluate(() => caches.keys())).includes(snapshots[0].cache));
    await tabs[1].close();
    const reopened = await context.newPage();
    // Wait for activation without relying on a network visit to establish it.
    await reopened.goto(`${origin}${recipeRoute}`);
    await waitForBrowserState(reopened, async () => !(await navigator.serviceWorker.getRegistration()).waiting);
    await reopened.reload();
    assert.equal(await snapshotLabel(reopened), 'B');
    assert.equal(await reopened.evaluate(async () => (await fetch('/data/recipe-library.json')).json().then(data => data.testSnapshot)), 'B');
    assert.deepEqual(await reopened.evaluate(() => caches.keys()), [snapshots[1].cache]);
    await reopened.getByRole('combobox', { name: 'Servings', exact: true }).selectOption('6');
  } finally { await context.close(); }
});

test('Failed replacement preserves the previous offline snapshot and reports failure', { timeout: 60000 }, async () => {
  version = 1;
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`${origin}${recipeRoute}`);
    await page.getByText('Recipes saved for offline use.', { exact: false }).waitFor({ state: 'attached' });
    version = 2;
    failDownload = true;
    await page.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration(); await registration.update(); });
    await page.getByText('Update download failed.', { exact: false }).waitFor({ state: 'attached' });
    await context.setOffline(true);
    await page.reload();
    await page.getByText('You are offline.', { exact: false }).waitFor({ state: 'attached' });
    assert.equal(await page.locator('meta[name="pwa-test-snapshot"]').getAttribute('content'), 'A');
    assert.equal(await page.evaluate(async () => (await fetch('/data/recipe-library.json')).json().then(data => data.testSnapshot)), 'A');
    await page.getByRole('combobox', { name: 'Servings', exact: true }).selectOption('2');
    assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).waiting), null);
  } finally { failDownload = false; await context.close(); }
});

test('Failed first download does not claim offline readiness', { timeout: 60000 }, async () => {
  failDownload = true;
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`${origin}${recipeRoute}`);
    await page.getByText('Recipes could not be saved offline.', { exact: false }).waitFor({ state: 'attached' });
    assert.equal(await page.evaluate(() => navigator.serviceWorker.controller), null);
  } finally { failDownload = false; await context.close(); }
});

for (const viewport of [{width:390,height:844},{width:1280,height:900}]) {
  test(`Recipe details match without JavaScript and share their settings at ${viewport.width}px`, {timeout:60000}, async()=>{
    const {recipes}=JSON.parse(await readFile('src/components/recipes/recipes.json','utf8'));
    const plain=await browser.newContext({javaScriptEnabled:false,viewport,reducedMotion:'reduce'});
    const context=await browser.newContext({viewport,reducedMotion:'reduce'});
    await context.addInitScript(()=>{
      Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.sharedRecipe=data;}});
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedRecipe=text;}}});
      window.print=()=>{window.dispatchEvent(new Event('beforeprint'));};
    });
    const staticPage=await plain.newPage();const page=await context.newPage();const errors=[];
    page.on('pageerror',error=>errors.push(String(error)));
    page.on('console',message=>{if(['error','warning'].includes(message.type()))errors.push(message.text());});
    try {
      await staticPage.goto(`${origin}${recipeRoute}`);
      assert.equal(await staticPage.locator('.recipe-card').count(),recipes.filter(r=>(r.type||'meal')==='meal').length);
      assert.equal(await staticPage.locator('.recipe-detail').count(),0);
      const bodyContent=async body=>({
        appliances:await body.locator('.detail-appliances').innerText(),
        facts:await body.locator('.detail-facts').innerText(),
        image:await body.locator('.recipe-photo img').getAttribute('src'),
        flow:await body.locator('.trn-table tr:not(.reset-checks-row)').allTextContents(),
        macros:await body.locator('.nutrition>dl').innerText(),
        nutrients:await body.locator('.daily-values').innerText(),
        family:await body.locator('.family-box p').allTextContents(),
      });
      for(const recipe of recipes){
        await page.goto(`${origin}/recipes/${recipe.id}/`);
        await staticPage.goto(`${origin}/recipes/${recipe.id}/`);
        const live=page.locator('.recipe-detail .recipe-body');await live.locator('.reset-checks-row').waitFor();
        await live.getByRole('button',{name:/^Vitamins & minerals/}).click();
        const staticBody=staticPage.locator(`#${recipe.id} .recipe-body`);
        await staticBody.locator('summary').click();
        const normalize=value=>JSON.stringify(value,(_key,item)=>typeof item==='string'?item.replace(/\s+/g,' ').trim():item);
        assert.equal(normalize(await bodyContent(live)),normalize(await bodyContent(staticBody)),recipe.id);
      }
      await page.goto(`${origin}/recipes/shawarma-chicken-bowls/?servings=8&starch=shawarma-chicken-bowls:pita_one`);
      const share=page.getByRole('button',{name:'Share recipe',exact:true});await share.click();
      const shared=new URL(await page.evaluate(()=>window.sharedRecipe.url));
      assert.equal(shared.pathname,'/recipes/shawarma-chicken-bowls/');assert.equal(shared.hash,'');assert.equal(shared.searchParams.get('servings'),'8');assert.equal(shared.searchParams.get('starch'),'shawarma-chicken-bowls:pita_one');
      const receiver=await browser.newContext({viewport});const received=await receiver.newPage();
      try{await received.goto(shared.href);await received.locator('.reset-checks-row').waitFor();assert.match(await received.locator('.family-box p').innerText(),/480g Pita/);assert.match(await received.locator('.recipe-detail .trn-ingredient').filter({hasText:'chicken thighs'}).innerText(),/1360g/);}
      finally{await receiver.close();}
      await page.getByRole('combobox',{name:'Servings',exact:true}).selectOption('2');await page.getByRole('combobox',{name:'Family starch',exact:true}).selectOption('rice_half_cup');await share.click();
      const changed=new URL(await page.evaluate(()=>window.sharedRecipe.url));const fresh=await browser.newContext({viewport});const reopened=await fresh.newPage();
      try{await reopened.goto(changed.href);await reopened.locator('.reset-checks-row').waitFor();assert.match(await reopened.locator('.family-box p').innerText(),/160g Cooked rice/);assert.match(await reopened.locator('.recipe-detail .trn-ingredient').filter({hasText:'chicken thighs'}).innerText(),/340g/);}finally{await fresh.close();}
      await page.getByRole('combobox',{name:'Servings',exact:true}).selectOption('8');await page.getByRole('combobox',{name:'Family starch',exact:true}).selectOption('pita_one');
      await page.evaluate(()=>Object.defineProperty(navigator,'share',{value:undefined}));await share.click();
      await page.getByText('Recipe link copied.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.copiedRecipe),shared.href);
      await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw new Error('Permission denied');}}}));await share.click();
      assert.equal(await page.locator('.recipe-share a').getAttribute('href'),shared.href);
      await page.getByRole('button',{name:'Print recipe',exact:true}).click();await page.emulateMedia({media:'print'});
      assert.equal(await page.locator('.print-document').isVisible(),true);
      assert.equal(await page.locator('.recipe-detail').isVisible(),false);
      assert.match(await page.locator('.print-document').innerText(),/Before you start/);
      assert.match(await page.locator('.print-document').innerText(),/Cook/);
      const borders=await page.locator('.print-document .trn-table').evaluate(table=>{
        const styles=getComputedStyle(table);return [styles.borderTopWidth,styles.borderRightWidth,styles.borderBottomWidth,styles.borderLeftWidth];
      });assert.ok(borders.every(width=>parseFloat(width)>0));
      assert.deepEqual(errors,[]);
    }finally{await context.close();await plain.close();}
  });
}

for (const width of [390,1280]) {
 test(`Collection pages navigate without JS and nutrition help respects input at ${width}px`,{timeout:30000},async()=>{
  const plain=await browser.newContext({javaScriptEnabled:false,viewport:{width,height:900}});
  const live=await browser.newContext({viewport:{width,height:900},hasTouch:width===390,isMobile:width===390});
  try{
   const page=await plain.newPage();await page.goto(`${origin}/recipes/meals/`);
   assert.equal(await page.locator('.recipe-card').count(),14);assert.equal(await page.locator('.recipe-detail').count(),0);
   assert.equal(await page.getByRole('combobox',{name:'Servings',exact:true}).isVisible(),false);
   assert.equal(await page.getByRole('button',{name:'Print all meals',exact:true}).isVisible(),false);
   assert.equal(await page.getByRole('link',{name:'All posts',exact:true}).first().isVisible(),true);
   const fallbackStyles=await page.locator('noscript link[rel=stylesheet]').getAttribute('href');
   assert.ok(snapshots[0].urls.includes(fallbackStyles),'Offline snapshot includes no-JavaScript stylesheet');
   await page.getByRole('link',{name:'Smoothies',exact:true}).click();assert.equal(await page.locator('.recipe-card').count(),6);
   await page.getByRole('link',{name:'Avocado-lime smoothie',exact:true}).click();assert.equal(await page.locator('.recipe-detail').count(),1);
   await page.locator('.trn-ingredient input[type=checkbox]').first().check();assert.equal(await page.locator('.trn-ingredient input[type=checkbox]').first().isChecked(),true);
   await page.locator('.nutrient-disclosure summary').click();await page.locator('.recipe-body .daily-values').waitFor();assert.equal(await page.locator('.recipe-body .daily-values').isVisible(),true);
   await page.getByRole('link',{name:'← Back to smoothies',exact:true}).click();assert.equal(await page.locator('.recipe-card').count(),6);
   const enhanced=await live.newPage();await enhanced.goto(`${origin}/recipes/meals/`);await enhanced.locator('[data-hydrated=true]').waitFor();
   const help=enhanced.getByRole('button',{name:'About nutrition filters',exact:true});
   if(width===1280){await help.hover();await enhanced.locator('.nutrition-help').waitFor();await enhanced.getByRole('heading',{name:'Meals',exact:true}).hover();await enhanced.locator('.nutrition-help').waitFor({state:'detached'});await help.focus();await enhanced.keyboard.press('Enter');await enhanced.locator('.nutrition-help').waitFor();await enhanced.keyboard.press('Escape');await enhanced.locator('.nutrition-help').waitFor({state:'detached'});}else{await help.tap();await enhanced.locator('.nutrition-help').waitFor();await enhanced.getByRole('heading',{name:'Meals',exact:true}).tap();await enhanced.locator('.nutrition-help').waitFor({state:'detached'});}
   await enhanced.getByRole('combobox',{name:'Servings',exact:true}).selectOption('8');
   await enhanced.locator('.recipe-card').filter({hasText:'Lemon salmon and asparagus'}).getByRole('link',{name:'See recipe',exact:true}).click();
   await enhanced.locator('.reset-checks-row').waitFor();assert.match(await enhanced.locator('.detail-facts').innerText(),/8\s+servings/);
  }finally{await plain.close();await live.close();}
 });
}

test('Legacy and root workers update independently with both new recipe tabs open',{timeout:60000},async()=>{
 version=1;
 const context=await browser.newContext();
 try{
  const page=await context.newPage();await page.goto(`${origin}/`);
  await page.evaluate(async route=>{
   const reg=await navigator.serviceWorker.register(`${route}service-worker.js`,{scope:route,updateViaCache:'none'});
   if(!reg.active)await new Promise(resolve=>reg.installing.addEventListener('statechange',()=>{if(reg.active)resolve();}));
  },recipeRoute);
  await page.goto(`${origin}${recipeRoute}`);await page.getByText('Recipes saved for offline use.',{exact:false}).waitFor({state:'attached'});
  await waitForBrowserState(page, async()=>{const regs=await navigator.serviceWorker.getRegistrations();return regs.length===2&&regs.every(r=>r.active);});
  const rootTab=await context.newPage();await rootTab.goto(`${origin}/recipes/smoothies/`);await rootTab.locator('[data-hydrated=true]').waitFor();
  version=2;
  await page.evaluate(async()=>{for(const r of await navigator.serviceWorker.getRegistrations())await r.update();});
  await waitForBrowserState(page, async()=>{const regs=await navigator.serviceWorker.getRegistrations();return regs.length===2&&regs.every(r=>r.waiting);});
  await page.reload();assert.equal(await page.locator('meta[name="pwa-test-snapshot"]').getAttribute('content'),'A');
  // Release both old snapshots. Each worker activates only after its clients leave.
  await page.close();await rootTab.close();
  const inspect=await context.newPage();await inspect.goto(`${origin}/`);
  await waitForBrowserState(inspect, async()=>{const regs=await navigator.serviceWorker.getRegistrations();return regs.length===2&&regs.every(r=>r.active&&!r.waiting);});
  const names=await inspect.evaluate(()=>caches.keys());assert.ok(names.includes(snapshots[1].cache));assert.ok(names.includes(snapshots[1].cache.replace('recipe-pages-pwa-','recipe-pwa-')));
  await context.setOffline(true);await inspect.goto(`${origin}${recipeRoute}`);assert.equal(await inspect.locator('meta[name="pwa-test-snapshot"]').getAttribute('content'),'B');
  await inspect.getByRole('link',{name:'Smoothies',exact:true}).click();await inspect.locator('[data-hydrated=true]').waitFor();assert.equal(await inspect.locator('.recipe-card').count(),6);
  await inspect.getByRole('link',{name:'Avocado-lime smoothie',exact:true}).click();await inspect.locator('.recipe-detail .reset-checks-row').waitFor();assert.match(await inspect.locator('.recipe-detail h1').innerText(),/Avocado/);
  assert.equal(await inspect.evaluate(async()=>{const regs=await navigator.serviceWorker.getRegistrations();return regs.length;}),2);
 }finally{await context.close();version=1;}
});


test('Previous shipped article snapshot migrates to standalone recipe pages offline',{timeout:60000},async()=>{
 version=0;
 const context=await browser.newContext();
 try{
  const page=await context.newPage();await page.goto(`${origin}${recipeRoute}`);
  await page.getByText('Recipes saved for offline use.',{exact:false}).waitFor({state:'attached'});
  const initial=await page.evaluate(async()=>{const regs=await navigator.serviceWorker.getRegistrations();return regs.map(r=>({scope:r.scope,script:r.active?.scriptURL}));});
  assert.deepEqual(initial,[{scope:`${origin}${recipeRoute}`,script:`${origin}${recipeRoute}service-worker.js`}]);
  version=2;
  await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();});
  await waitForBrowserState(page, async ({name,route})=>{const r=await navigator.serviceWorker.getRegistration();const cache=await caches.open(name);const response=await cache.match(route);return r.waiting?.state==='installed'&&response&&(await response.text()).includes('pwa-test-snapshot\" content=\"B');},{name:snapshots[1].cache.replace('recipe-pages-pwa-','recipe-pwa-'),route:recipeRoute});
  await context.setOffline(true);await page.reload();
  assert.equal(await page.locator('meta[name="pwa-test-snapshot"]').getAttribute('content'),'LEGACY');
  await page.close();await context.setOffline(false);
  const migrated=await context.newPage();await migrated.goto(`${origin}/`);
  await waitForBrowserState(migrated, async route=>{const r=await navigator.serviceWorker.getRegistration(route);return r?.active?.state==='activated'&&!r.waiting;},recipeRoute);
  await migrated.goto(`${origin}${recipeRoute}`);
  assert.equal(await migrated.locator('meta[name="pwa-test-snapshot"]').getAttribute('content'),'B');
  await migrated.getByText('Recipes saved for offline use.',{exact:false}).waitFor({state:'attached'});
  await waitForBrowserState(migrated, async()=>{const regs=await navigator.serviceWorker.getRegistrations();return regs.length===2&&regs.every(r=>r.active);});
  await context.setOffline(true);
  await migrated.getByRole('link',{name:'Meals',exact:true}).click();await migrated.locator('[data-hydrated=true]').waitFor();assert.equal(await migrated.locator('.recipe-card').count(),14);
  await migrated.locator('.recipe-card').filter({hasText:'Lemon salmon and asparagus'}).getByRole('link',{name:'See recipe',exact:true}).click();await migrated.locator('.recipe-detail .reset-checks-row').waitFor();
  await migrated.waitForFunction(()=>[...document.querySelectorAll('.recipe-photo img')].every(image=>image.complete&&image.naturalWidth>0));
  const names=await migrated.evaluate(()=>caches.keys());assert.ok(names.includes(snapshots[1].cache));assert.ok(names.includes(snapshots[1].cache.replace('recipe-pages-pwa-','recipe-pwa-')));
 }finally{await context.close();version=1;}
});
