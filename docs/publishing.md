# Publishing with PagesCMS

> **Retained historical documentation.** The live blog now lives at
> <https://www.jsolly.com/blog/>. Publish and maintain its private source in
> [jsolly/jsolly-website](https://github.com/jsolly/jsolly-website); do not edit
> or publish from this frozen repository. Instructions below describe the old source.

Use [hosted PagesCMS](https://app.pagescms.org) after granting its GitHub App access
only to `jsolly/awesome-blog`. Choose an editorial branch made from current
`main`. Saves create commits on that branch; production changes only after a PR
passes `CI / ci` and merges. Start each subsequent branch from updated `main`.
Do not edit protected `main` directly or weaken branch protection.

## Write an article

Create a post with a stable slug, title, description, category, publication/update
timestamps, and an image with alt text. New posts default to drafts. The source
editor accepts CommonMark: paragraphs, headings, explicit links, lists, emphasis
and fenced code. Use ordinary Markdown for new prose. Complex tables and embeds
can use HTML; scripts, event handlers and unapproved iframe providers are removed.
GFM automatic linking/tables and typographic rewriting are disabled, so write
links explicitly and use HTML for tables. Imported HTML blocks retain formatting.
The card excerpt is optional HTML; absent excerpts use the SEO description.

Only YouTube, YouTube No-Cookie, diagrams.net and nbviewer frames are supported.
Any additional provider needs a reviewed renderer/CSP change. Assets cannot load
runtime CSS/JS from third-party CDNs. Preserve existing heading text if its linked
fragment must stay stable; H1–H3 fragments follow the former blog's algorithm.

Upload ordinary images through the CMS to `public/media`. Resize/compress before
uploading, then paste the uploaded `/media/...` path into the cover-image field.
That field also preserves existing HTTPS media URLs. Put large downloads, videos or datasets in existing S3 separately and
link their CloudFront URLs. The CMS does not upload to S3. Never paste AWS credentials
into article metadata or CMS fields.

Publication and update timestamps use ISO 8601 strings with seconds and an explicit
timezone, such as `2026-10-02T14:00:00Z`. Preserve an existing publication timestamp;
update `updated` when editing a post. The build rejects invalid or timezone-free
timestamps. String fields preserve seconds, fractional precision and timezone
instead of roundtripping them through the CMS's minute-resolution date control.
Quoted and unquoted YAML timestamps have the same meaning. The post loader reads
YAML 1.2 source values before schema validation, so the CMS's serialization does
not silently convert or truncate those strings. Empty optional fields may be
omitted on save; the declared defaults preserve their public meaning.
Keep published slugs and their case unchanged.
Category slugs are equally stable. Choose up to three related posts manually; there
is no embedding service. Unmanaged legacy IDs/image paths remain for reconciliation.

## Review and publish

Check the PR diff for accidental frontmatter/body rewrites. Run the Node app gate
and preview the build locally. New drafts must be absent from routes, archive,
search, feeds, sitemap and client data; the gate exercises a real sentinel draft.
Set `draft` to false only when ready. Review image accessibility, canonical URL,
category, article reading, search and feed entries, then merge after green CI.
Automatic branch previews are disabled; use local preview unless John explicitly
authorizes the fleet's opt-in preview workflow.

Before first production cutover, rehearse save/reopen of existing table/code/frame
articles, new category/image/draft, and a PR publish. Hosted CMS authentication, branch creation and editor access have been verified.
Code/table/frame article saves and reopens are verified, including exact bodies,
fractional timestamps, timezone offsets, remote images and unmanaged keys.
Category creation, image upload, actual draft exclusion and published output
are also verified. The isolated
[rehearsal PR #679](https://github.com/jsolly/awesome-blog/pull/679) passed
the actual required `CI / ci` check and closed without merging its fixtures.
Timestamps
and cover-image paths use string fields after the rehearsal exposed destructive
date initialization and unsupported external-image controls.

## Content validation

Article-specific Markdown lint allows retained HTML, original punctuation, heading
order and verbatim code whitespace. These are authored content, not repository
style errors. Astro schemas, route/feed/draft contracts and migration semantic
parity supply the structural checks. Engineering docs retain normal Markdown lint.
Changes to imported source are checked against a fresh export only during cutover;
the everyday gate permits legitimate future edits and new feed entries.
