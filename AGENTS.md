# AGENTS.md

**Source archive:** the blog and recipes now live in jsolly/jsolly-website.
This repository is frozen for retained public source and recovery history. Do not
publish content here, drain Dependabot, reconnect hosting, or delete local recovery
exports. John's approved C4 archive notices are the final integration work.

## Stack and structure

Static Astro + Svelte + PagesCMS blog, Node 24. `src/content/posts/*.md` holds
Markdown with YAML frontmatter; category JSON is in `src/content/categories`.
`src/content.config.ts` validates metadata and uses file paths as loader IDs, so
`src/lib/content.ts` sees and rejects all duplicate post/category slugs before
filtering drafts. `src/lib/html.ts` sanitizes rendered
HTML and preserves the original heading fragment algorithm. Keep that behavior.

Astro builds public routes in `src/pages`. Svelte handles navigation, GET search
and query pagination. Client data must contain published posts only. Assets are
bundled or first-party; no CDN runtime CSS/JS. Existing S3/CloudFront article media
remains public. Do not introduce database/auth/AI backends without a new scope decision.

`.pages.yml` uses a Markdown code editor, structured metadata, new-post draft
labels and `settings.content.merge: true` to preserve unmanaged reconciliation keys.
Timestamps use validated ISO strings to preserve seconds, precision and timezones;
the cover image uses a URL/media-path string with uploads through the Media sidebar.
Do not replace the body with WYSIWYG without a verified complex-article roundtrip.
Legacy slugs are case-sensitive and stable. Preserve author names, timestamps,
excerpts and related links. CommonMark is configured without smart punctuation or
GFM autolinking; complex authored HTML is retained and sanitized.

## Frontend stack

Astro owns pages and content; Svelte owns interactive islands. Use the installed
shadcn-svelte controls for new or replaced standard UI controls, loading the
shared `/shadcn-svelte` skill. Navigation and search use the generated Button and
Input sources in `src/lib/components/ui`. Import the defining `.svelte` file
directly. `components.json` and the `$lib` paths support the pinned local CLI.
`src/styles/ui.css` maps UI utilities to the existing site theme without a
Tailwind preflight reset; source scanning is limited to the UI component directory
and the navigation/search sources. Preserve authored article styling and recipe workflows.
Canon: `~/code/dotagents/rules/frontend-stack.md`.

## Commands

Commands run from `/Users/johnsolly/code/awesome-blog`.

```bash
npm ci
npx --no-install playwright install chromium
npm run gate
npm run dev
npm run build
npm run preview
```

`npm run gate:app` checks Astro/Svelte, builds, runs content/route contracts and
proves a real draft's content and slug are absent from all built assets and routes,
rejects identical duplicate post/category files, then restores the normal build.
`npm run gate` additionally checks secrets, Bash, YAML, Actions, Markdown, the
stack-protection and infra-script contracts, and read-only production-smoke
contracts. It validates the full working tree even with
an empty index. It needs the installed dotagents gate library, Bash 5, actionlint,
gitleaks and pinned Node dependencies. Use `npm run worktree:init` for fresh checkouts.
Never set `core.hooksPath`; the trusted dotagents dispatcher owns it.

The importer `scripts/import-legacy.mjs` writes only to an empty destination.
`npm run verify:migration -- .migration-work/source-2026-10-02.json` compares the
actual build against the private authoritative source; its source oracle must not
use the application's converter or renderer. Private export evidence stays ignored.
Git history keeps legacy code; ignored SQLite, virtualenv and media state is retained.

## Ship and release

Ship profile: `gate-only`.

Integration for the final archive notices is branch → PR → merge on green
`CI / ci`. Start from freshly fetched `origin/main`. Every remote push and PR
runs through `/ship`; never push `main`, edit rulesets or admin-merge.
Record `deploy: none`; do not dispatch Production smoke for this repository.
The retained workflow and Vercel configuration are historical recovery inputs.

Vercel project `blogthedata` is connected to
`jsolly/jsolly-website`, Root Directory `legacy/blogthedata`, for the permanent
redirects. Never reconnect it to awesome-blog. The live blog and recipes are
<https://www.jsolly.com/blog/> and <https://www.jsolly.com/recipes/>. Production
release verification belongs to the active repository. Heroku automatic deploys
remain disabled; release v315, its database and media stay retained for recovery
until separately authorized retirement.

## UI verification

Use the installed `verify-ui` skill and `rules/frontend-verification.md` after
observable changes. Preview: <http://127.0.0.1:4321>, no login. Check desktop and
mobile pixels, console, navigation, pagination, GET search, article reading,
heading links and print. Complex-content changes additionally require recipe table,
code and iframe checks in both viewports. Screenshots/evidence belong in ignored
`.migration-work` or a temporary directory.

## Infra

- **Dirty IaC.** This frozen repository has no deployment entry; nothing deploys the CloudFormation stack. A change to an infra input (`scripts/infra-inputs.json`: the backup template and its deploy script) needs a manual infra deploy after merge. Say that in the PR body and the final report, and include `plan:infra` output. `check:infra-drift` never blocks; it reads `pending` while the stack's `InfraDeployCommit` tag (written only by `deploy:infra`) lags main's infra inputs. Do not run `deploy:infra`. The action is `John runs deploy:infra after reviewing`. Canon: laptop global brief Implementation when synced.

`npm run plan:infra -- --json --out <file>` previews the stack update as `agent-readonly`
with a change set it deletes and never executes. `npm run check:infra-drift -- --json --warn-only`
compares that tag with origin's `main` and fails closed. `npm run deploy:infra` is John's, from
clean landed `main` in his own terminal with administrator credentials; no profile name is
committed. `.mise.toml` pins the AWS CLI these scripts and `protect:stacks` run.
`.gitattributes` marks the manifest's inputs `infra-input` for the pre-commit
reminder, and `npm run test:infra` pins all three scripts without AWS. See
[stack updates](docs/migration-backups.md#stack-updates).

## Cloud and data safety

John authorized migration backups and hosting administration. Infrastructure deployment,
production DB writes and destructive cloud changes remain John's human operations. Keep Heroku/database/S3/CloudFront/IAM
resources and independent backups intact until separately authorized retirement.
Cutover acceptance does not authorize teardown. The AWS bucket is
`blogthedata` in account `730335616323`; do not widen the retained bucket-scoped
policy. All new AWS resources must be defined with CloudFormation. The recovery
bucket has been provisioned through CloudFormation and its exact-version database
and media recovery verified; the frontend needs no AWS credentials. Do not delete
ignored exports or local rollback state. See the runbook for independent backups.

Cross-repo rules remain canon in dotagents; this task does not authorize fleet
rollouts or edits in other repositories. Shared recall and fleet policies apply.
