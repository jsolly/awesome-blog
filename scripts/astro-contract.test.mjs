import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir, access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { convertExport, importExport } from './import-legacy.mjs';
import { articleHtml, plainText, headingId } from '../src/lib/html.ts';
import { parsePost } from '../src/lib/frontmatter.ts';
import { serializePost } from './content-files.mjs';
import { articleSignature } from './article-signature.mjs';
import { verifyMediaBackup } from './verify-media-backup.mjs';
import { load } from 'cheerio';

const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const readPosts = async () => Promise.all((await readdir('src/content/posts')).filter(name => name.endsWith('.md')).map(async name => {
  const post = parsePost(await readFile(`src/content/posts/${name}`, 'utf8'));
  return { ...post, draft: post.draft ?? true, related: post.related ?? [], feedAuthor: post.feedAuthor ?? 'John_Solly' };
}));
const records = [
  { model: 'blog.category', pk: 1, fields: { slug: 'Geodev', name: 'Geo Dev', description: 'Spatial development' } },
  { model: 'blog.post', pk: 3, fields: { slug: 'Some-Post', title: 'A < B', category: 1, author: 2, snippet: '<p>Authored card excerpt</p>', metadesc: 'Description', draft: false, metaimg: 'post_metaimgs/test.webp', metaimg_width: 10, metaimg_height: 20, metaimg_alt_txt: 'Image', metaimg_attribution: 'Author', content: '<table><tr><td>Exact HTML &amp; text</td></tr></table>', date_posted: '2024-01-02T00:00:00Z', date_updated: '2025-01-02T00:00:00Z' } },
];

test('CMS YAML timestamps preserve exact source strings whether quoted or unquoted', () => {
  const timestamp = '2026-10-02T14:00:23.123456-04:00';
  for (const value of [timestamp, `"${timestamp}"`]) {
    const post = parsePost(`---\npublished: ${value}\nupdated: ${value}\ndraft: false\nlegacyId: 42\n---\n\n<pre><code>  kept\n</code></pre>\n`);
    assert.equal(post.published, timestamp);
    assert.equal(post.updated, timestamp);
    assert.equal(post.draft, false);
    assert.equal(post.legacyId, 42);
    assert.equal(post.body, '<pre><code>  kept\n</code></pre>');
  }
});

test('import preserves body, slug case, category and dates; never overwrites an edited collection', async () => {
  const { posts } = convertExport(records);
  assert.deepEqual(articleSignature(posts[0].body), articleSignature(records[1].fields.content));
  assert.deepEqual(parsePost(serializePost(posts[0])), posts[0]);
  assert.equal(posts[0].slug, 'Some-Post');
  assert.equal(posts[0].category, 'Geodev');
  assert.equal(posts[0].published, records[1].fields.date_posted);
  assert.equal(posts[0].excerpt, records[1].fields.snippet);
  const directory = await mkdtemp(join(tmpdir(), 'blog-import-'));
  try {
    const sourcePath = join(directory, 'export.json');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(sourcePath, JSON.stringify(records));
    const destination = join(directory, 'content');
    await importExport({ sourcePath, destination });
    await assert.rejects(importExport({ sourcePath, destination }), /must be empty/u);
  } finally { await rm(directory, { recursive: true }); }
});

test('invalid or ambiguous exports fail before writing content', () => {
  assert.throws(() => convertExport([...records, records[1]]), /Duplicate/u);
  assert.throws(() => convertExport([records[0], { ...records[1], fields: { ...records[1].fields, slug: '../escape' } }]), /Unsafe/u);
  assert.throws(() => convertExport([records[0], { ...records[1], fields: { ...records[1].fields, category: 42 } }]), /Unknown category/u);
  assert.throws(() => convertExport([records[0], { ...records[1], fields: { ...records[1].fields, date_posted: 'invalid' } }]), /Invalid/u);
  assert.throws(() => convertExport([records[0], { ...records[1], fields: { ...records[1].fields, author: 99 } }]), /Unknown public author/u);
});

test('article rendering preserves legacy fragments and strips executable authored HTML', () => {
  assert.equal(plainText('<p>A &amp; B &#x27;quoted&#x27;</p>'), "A & B 'quoted'");
  assert.equal(headingId(plainText('<h2>A &amp; B: Example</h2>')), 'a--b-example');
  const rendered = articleHtml('<h2>A &amp; B: Example</h2><script>alert(1)</script><img src="post_imgs/test.webp" onerror="alert(2)"><a href="javascript:alert(3)">bad</a><iframe src="https://evil.example/test"></iframe><iframe src="https://www.youtube.com/embed/example"></iframe><table><tr><td>kept</td></tr></table>');
  assert.match(rendered, /id="a--b-example"/u);
  assert.match(rendered, /cloudfront\.net\/media\/post_imgs\/test.webp/u);
  assert.match(rendered, /<table>/u);
  assert.match(rendered, /youtube\.com\/embed/u);
  assert.doesNotMatch(rendered, /<script|onerror|javascript:|evil\.example/u);
  const authoredIds = articleHtml('<p id="terms">Intro paragraph</p><p id="kept">Independent anchor</p><h2 id="Intro">Introduction</h2><h2 id="terms">Intro</h2><h2 id="terms">Terms</h2>');
  assert.match(authoredIds, /id="introduction"/u);
  assert.match(authoredIds, /id="intro"/u);
  assert.equal([...authoredIds.matchAll(/id="terms"/gu)].length, 1);
  assert.match(authoredIds, /<p id="kept">/u);
  assert.doesNotMatch(authoredIds, /<p id="terms">/u);
  assert.equal([...authoredIds.matchAll(/class="heading-link"/gu)].length, 3);
});

test('historical redirects retain canonical-site paths and have matching Vercel rules', async () => {
  const aliases = [
    { model: 'sites.site', pk: 1, fields: { domain: 'www.blogthedata.com' } },
    { model: 'redirects.redirect', pk: 9, fields: { site: 1, old_path: '/post/old/', new_path: '/post/Some-Post/' } },
  ];
  assert.deepEqual(convertExport([...records, ...aliases]).redirects, [{ source: '/post/old/', destination: '/post/Some-Post/', legacyId: 9 }]);
  assert.throws(() => convertExport([...records, aliases[1]]), /canonical public site/u);
  assert.throws(() => convertExport([...records, ...aliases, aliases[1]]), /Duplicate redirect/u);
  assert.throws(() => convertExport([...records, aliases[0], { ...aliases[1], fields: { ...aliases[1].fields, new_path: 'https://evil.example/' } }]), /Unsupported redirect/u);
  for (const field of ['old_path', 'new_path']) assert.throws(() => convertExport([...records, aliases[0], { ...aliases[1], fields: { ...aliases[1].fields, [field]: '//evil/' } }]), /Unsupported redirect/u);
  const config = await readJson('vercel.json');
  const imported = await readJson('src/content/redirects.json');
  assert.equal(config.trailingSlash, true, 'Vercel must canonicalize bare article/alias destinations to Astro directory URLs');
  const directoryPath = path => `${path.replace(/\/$/u, '')}/`;
  for (const redirect of imported) assert.ok(config.redirects.some(rule => rule.source === directoryPath(redirect.source) && rule.destination === directoryPath(redirect.destination) && rule.permanent));
  const { publishedPaths } = await readJson('src/content/migration-receipt.json');
  assert.deepEqual(imported.filter(rule => !publishedPaths.includes(directoryPath(rule.destination))), [{
    source: '/post/how-to-leverage-closed-loops', destination: '/post/stop-asking-questions-to-save-time', legacyId: 3,
  }], 'Only the documented pre-existing missing alias target may remain unresolved');
});

test('static CSP permits emitted hydration scripts by hash and has no permissive script rule', async () => {
  const html = await readFile('dist/index.html', 'utf8');
  const { createHash } = await import('node:crypto');
  assert.match(html, /http-equiv="content-security-policy"/iu);
  for (const [, attrs, body] of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gu)) {
    if (/src=|application\/ld\+json/u.test(attrs) || !body) continue;
    const hash = createHash('sha256').update(body).digest('base64');
    assert.ok(html.includes(`sha256-${hash}`), 'Missing CSP hash for Astro hydration');
  }
  const config = await readJson('vercel.json');
  const header = config.headers[0].headers.find(header => header.key === 'Content-Security-Policy').value;
  assert.ok(!header.includes('script-src'), 'Response header must not override per-page script hashes');
});

test('all published legacy URLs exist and the index, archive and sitemap omit drafts', async () => {
  const receipt = await readJson('src/content/migration-receipt.json');
  for (const path of [...receipt.publishedPaths, ...receipt.categoryPaths]) await access(`dist${path}index.html`);
  const posts = await readPosts();
  const index = await readJson('dist/search-index.json');
  assert.equal(index.length, posts.filter(post => !post.draft).length);
  const sitemap = await readFile('dist/sitemap.xml', 'utf8');
  const archive = await readFile('dist/all-posts/index.html', 'utf8');
  for (const post of posts) {
    assert.equal(index.some(entry => entry.slug === post.slug), !post.draft);
    assert.equal(sitemap.includes(`/post/${post.slug}/`), !post.draft);
    assert.equal(archive.includes(`/post/${post.slug}/`), !post.draft);
    if (post.draft) await assert.rejects(access(`dist/post/${post.slug}/index.html`));
    else assert.ok(index.find(entry => entry.slug === post.slug).text.length > 0 || /<(?:iframe|img)\b/u.test(post.body), `Article has no readable content: ${post.slug}`);
  }
});

test('CMS fields cover authored metadata and preserve unmanaged migration data', async () => {
  const document = parseDocument(await readFile('.pages.yml', 'utf8'));
  assert.deepEqual(document.errors, []);
  const cms = document.toJS();
  assert.equal(cms.settings.content.merge, true);
  const config = cms.content.find(collection => collection.name === 'posts');
  const fields = new Set(config.fields.map(field => field.name));
  const first = (await readPosts())[0];
  for (const key of Object.keys(first)) if (!['legacyId', 'legacyImage', 'legacyAuthorId'].includes(key)) assert.ok(fields.has(key), `Missing CMS field ${key}`);
  assert.equal(config.format, 'yaml-frontmatter');
  assert.equal(config.fields.find(field => field.name === 'body').type, 'code');
  assert.equal(config.fields.find(field => field.name === 'body').options.format, 'markdown');
  assert.equal(config.fields.find(field => field.name === 'draft').default, true);
});

test('feeds follow current published metadata and retain canonical identities', async () => {
  const posts = (await readPosts()).filter(post => !post.draft).toSorted((a,b) => Date.parse(b.updated) - Date.parse(a.updated) || Date.parse(b.published) - Date.parse(a.published)).slice(0, 5);
  const rss = load(await readFile('dist/rss', 'utf8'), { xml: true });
  const atom = load(await readFile('dist/atom', 'utf8'), { xml: true });
  const config = await readJson('vercel.json');
  for (const [path, mime] of [['rss', 'application/rss+xml'], ['atom', 'application/atom+xml']]) {
    for (const source of [`/${path}`, `/${path}/`]) {
      assert.ok(config.headers.find(entry => entry.source === source)?.headers.some(header => header.key === 'Content-Type' && header.value.startsWith(mime)), `${source} declares its feed MIME type`);
    }
  }
  assert.deepEqual(rss('item').toArray().map(item => ({ title: rss(item).find('title').text(), link: rss(item).find('link').text(), guid: rss(item).find('guid').text(), description: rss(item).find('description').text() })), posts.map(post => ({ title: post.title, link: `https://www.blogthedata.com/post/${post.slug}/`, guid: `https://www.blogthedata.com/post/${post.slug}/`, description: post.description })));
  assert.deepEqual(atom('entry').toArray().map(entry => ({ title: atom(entry).find('title').text(), link: atom(entry).find('link').attr('href'), id: atom(entry).find('id').text(), updated: atom(entry).find('updated').text(), author: atom(entry).find('author name').text() })), posts.map(post => ({ title: post.title, link: `https://www.blogthedata.com/post/${post.slug}/`, id: `https://www.blogthedata.com/post/${post.slug}/`, updated: new Date(post.published).toISOString(), author: post.feedAuthor })));
});

test('related cards render the selected published associations', async () => {
  const posts = await readPosts();
  const published = new Set(posts.filter(post => !post.draft).map(post => post.slug));
  for (const post of posts.filter(post => !post.draft)) {
    const $ = load(await readFile(`dist/post/${post.slug}/index.html`, 'utf8'));
    const actual = $('.related-posts a.post-card-link').toArray().map(link => $(link).attr('href'));
    const expected = post.related.filter(slug => published.has(slug)).map(slug => `/post/${slug}/`);
    assert.deepEqual(actual, expected, `Related cards mismatch: ${post.slug}`);
  }
});

test('recipe route shares complete recipe bodies without JavaScript and retains first-party assets', async () => {
  const { recipes } = await readJson('src/components/recipes/recipes.json');
  const html = await readFile('dist/post/15-minute-dump-and-go-instant-pot-recipes/index.html', 'utf8');
  const $ = load(html, { scriptingEnabled: false });
  assert.equal($('h1').not('.print-title').length, 1);
  assert.equal($('.article-hero, #print-article').length, 0);
  assert.equal($('.meal-library').attr('data-hydrated'), 'false');
  assert.equal($('.recipe-detail').length,0);
  for (const collection of ['meals','smoothies']) {
    const grid=load(await readFile(`dist/recipes/${collection}/index.html`,'utf8'));
    const expected=recipes.filter(recipe=>(recipe.type||'meal')===(collection==='meals'?'meal':'smoothie'));
    assert.equal(grid('.recipe-card').length,expected.length);
    for(const recipe of expected) assert.equal(grid(`a.title-button[href^="/recipes/${recipe.id}/"]`).length,1);
  }
  for(const recipe of recipes){
    const detail=load(await readFile(`dist/recipes/${recipe.id}/index.html`,'utf8'));
    assert.equal(detail('.recipe-detail').length,1);
    assert.equal(detail('.recipe-body .trn-table').length,1);
    assert.equal(detail('details.nutrient-disclosure').length,1);
    assert.equal(detail('.recipe-photo img').attr('src'),recipe.image.src);
    for(const ingredient of recipe.ingredients)assert.ok(detail('.recipe-body').text().includes(ingredient.name),recipe.id);
    for(const srcset of [recipe.image.cardSrcset,recipe.image.detailSrcset])for(const candidate of srcset.split(','))await access(`dist${candidate.trim().split(/\s+/u)[0]}`);
  }
  const assistant = await readJson('dist/data/recipe-library.json');
  assert.deepEqual(assistant.recipes.map(recipe => recipe.recipeId), recipes.map(recipe => recipe.id));
  assert.equal(assistant.recipes.length, recipes.length);
  await access('dist/data/recipe-library.md');
});

test('source signatures detect structural, media and preformatted losses', () => {
  const outdated = '<s>Old guidance</s>';
  assert.deepEqual(articleSignature(convertExport([records[0], { ...records[1], fields: { ...records[1].fields, content: outdated } }]).posts[0].body).emphasis, [{ type: 'del', text: 'Old guidance' }]);
  assert.notDeepEqual(articleSignature(outdated), articleSignature('Old guidance'));
  const original = '<h2 id="a">A</h2><ul><li>One<ul><li>Nested</li></ul></li></ul><blockquote><em>Quote</em></blockquote><pre><code>  code\n</code></pre><table><tr><td colspan="2">Cell</td></tr></table><iframe src="https://www.youtube.com/embed/a" width="800"></iframe><p style="color:#fff">Style</p>';
  for (const [from, to] of [['h2','h3'], ['Nested','Lost'], ['<em>Quote</em>','Quote'], ['  code','code'], ['colspan="2"','colspan="1"'], ['width="800"','width="400"'], ['color:#fff','color:#000']]) assert.notDeepEqual(articleSignature(original.replace(from, to)), articleSignature(original));
});

test('all builds record an exact release SHA', async () => {
  const release = await readJson('dist/release.json');
  assert.match(release.sha, /^[a-f0-9]{40}$/u);
});

test('backup verification fails for missing, truncated or escaped objects', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'blog-backup-contract-'));
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(directory, 'sample.txt'), 'backup');
    const inventory = { Contents: [{ Key: 'sample.txt', Size: 6 }] };
    assert.equal((await verifyMediaBackup(inventory, directory)).files, 1);
    await assert.rejects(verifyMediaBackup({ Contents: [{ Key: 'sample.txt', Size: 7 }] }, directory), /truncated/u);
    await assert.rejects(verifyMediaBackup({ Contents: [{ Key: 'missing.txt', Size: 6 }] }, directory), /ENOENT/u);
    await assert.rejects(verifyMediaBackup({ Contents: [{ Key: '../escape', Size: 6 }] }, directory), /escapes/u);
  } finally { await rm(directory, { recursive: true }); }
});
