# Cursor Cloud Agent notes

This file is read by Cloud / Background Agents only (local IDE chat ignores it).
Repo `AGENTS.md` still applies first; this file overlays cloud-specific facts.

Read `~/.cursor/dotagents-package/memory/MEMORY.md`, resolve its real path, then read the matching
normalized-remote project index and relevant topics. Curated recall is separate from native memory;
current evidence overrides dated facts, and missing files permit an honest repository-evidence
fallback. Published snapshots are read-only; saves go through isolated dotagents `/ship` PRs.

## Skills package (private checkout)

`.cursor/install-cloud-skills.sh` (via `.cursor/environment.json` `install`) finds or
fetches a private `dotagents` checkout and runs that checkout's
`templates/cloud-agent/install-cloud-package.sh`, which copies **skills, agents, cited
rules, the connector catalog, and `gate/gate-lib.sh`** into VM home paths, installs a pinned
mise when the VM has none, makes the gate's pinned gitleaks available through it, and installs
this repo's `.mise.toml` tools (table below). Preferred source is
a host-local tree (`DOTAGENTS_ROOT` or `~/code/dotagents`, whichever holds
`templates/cloud-agent/install-cloud-package.sh`). If none is present it fetches `jsolly/dotagents` in this order: `gh api` tarball,
`gh repo clone`, then `git clone`. GitHub MCP read access is **not** git clone
credentials — a child-repo VM often needs `gh` (or `repositoryDependencies`)
before anonymous HTTPS clone works. There is no public skills mirror. An install log
line `WARN — the gate refuses gated commits on this VM` means the pinned gitleaks is
missing: every gated commit here is refused until it is on PATH or installed with mise.
`WARN — mise <version> not installed: <reason>` says why mise is missing. `WARN — <repo>/.mise.toml
tools not installed` or `WARN — mise trust or mise install failed` means this repo's gate refuses
its mise steps until `mise install` succeeds here. The last install line says whether the
gitleaks pin was ensured. The gate's staged secrets scan reads binary-marked and NUL-byte files
through `GIT_ATTR_SOURCE`, which needs git 2.41 or newer: on an older git, a commit that stages
one is refused, and the refusal names the fix.

A fresh VM clone has no `core.hooksPath` and no `node_modules`, so the same install arms this repo's
gate (the last two rows below). The last install line ends with `node_modules in sync,
core.hooksPath → dispatcher` when both took. A `WARN — … core.hooksPath` or `WARN — the core.hooksPath
dispatcher is not installed` line means the pre-commit gate does not run through the dispatcher; `WARN — … node_modules not installed` means `npm run gate` fails until you do what
it names; `WARN — cannot find the repo` means neither step, nor the `.mise.toml` tools, ran. An armed
gate can still refuse until setup only this repo knows is done (a Python `.venv`, say): follow its
error. If it reports a Node major mismatch in your shell, run `nvm use` (it reads `.nvmrc`). The
dispatcher serves only `pre-commit`, so checkout, fetch, and reset run no hook, and a commit runs the
tree's `.git-hooks/pre-commit` only when it matches a version on `origin/main` or an approved blob.
A checked-out tree still runs its own code through the gate, npm, and project agent config, so read
a fork or third-party ref with `gh pr diff`, `git show`, or
`git archive <ref> | tar -x -C "$(mktemp -d)"`, never a checkout in this repo. When its files must
be a working tree, clone into a scratch directory outside the repo with
`git -c core.hooksPath=/dev/null clone`, keep that `-c` on every git command there, and run nothing
from it (`rules/agent-cloud-access.md` → GitHub).
`npm ci` ran the lockfile's lifecycle scripts at install time, and what they did persists for every
later agent on this environment.

| Artifact | VM path | Notes |
| --- | --- | --- |
| Skills | `~/.cursor/skills/` | Same discovery as laptop `~/.cursor/skills` |
| Agents | `~/.cursor/agents/` | One `.md` file per reviewer/scanner agent |
| Cited rules | `~/.cursor/dotagents-package/rules/` | **Read from here** when a skill cites `rules/<name>.md` |
| Connector catalog | `~/.cursor/dotagents-package/mcps/catalog.json` | The cloud-first canon for MCP servers + marketplace plugins. `/optimize-workspaces` reconciles the live session against it — no laptop checkout needed |
| Pre-commit gate lib | `~/.cursor/dotagents-package/gate/gate-lib.sh` | Canonical copy. Child `.git-hooks/pre-commit` shims source `${DOTAGENTS_GATE_LIB:-$HOME/code/dotagents/gate/gate-lib.sh}`; the default path is a stub symlink to this copy, so no `DOTAGENTS_GATE_LIB` export is needed |
| mise | `/usr/local/bin/mise` | Only when no `mise` is on PATH: the installer's pinned release, checked against its pinned sha256, written with `sudo` when not root. `/usr/local/bin` survives the PATH reset at session start |
| Gate's pinned gitleaks | mise's install dir (`mise where gitleaks@<pin>`) | Only when the gate cannot already resolve gate-lib's `GATE_GITLEAKS_VERSION`: `mise use -g`, which changes mise's global config (`~/.config/mise/config.toml`) |
| This repo's `.mise.toml` tools | mise's install dir | When this repo has a `.mise.toml`: `mise trust` (recorded in mise's own state) and `mise install` here. Nothing in the repo changes |
| This repo's git hooks | `~/.local/share/dotagents/hooks/`, named by `.git/config` `core.hooksPath` | When this repo has `.git-hooks/pre-commit`, after `npm ci`: the `core.hooksPath` dispatcher, the laptop's path too, replacing any other value. Serves only `pre-commit`, and runs only a tracked copy that matches a version on `origin/main` or an approved blob. A `package.json` `prepare` that sets `core.hooksPath` resets it inside `npm ci`: the gate's `gate_npm_ci` restores it mid-commit and warns; any other revert shows as a warning on each commit, so rerun `.cursor/install-cloud-skills.sh`. Never set `core.hooksPath` to `.git-hooks`, and never check out a fork or third-party head here (`rules/agent-cloud-access.md` → GitHub) |
| This repo's npm dependencies | `node_modules/` (gitignored) | When this repo has a `package-lock.json`: `npm ci`, skipped while `node_modules` matches the lockfile. The Node is the one `.nvmrc` pins; when the VM's differs or is missing, nvm switches to it (installing it first if needed) and makes it the default |

### Agents / Review Task fallback

`~/.cursor/agents/` is installed on Cloud, but Task `subagent_type` names are
laptop/IDE-oriented and often unavailable here. Cloud `/ship` uses
`general-purpose` Tasks that each read `~/.cursor/agents/<name>.md` and follow
that lens plus `skills/ship/references/output-contract.md`. Same roster names
and depth gates as `skills/ship/references/review-roster.md` — do not invent
parallel lenses.

Laptop-only skills (see `skills/laptop-only.txt`) are **not** installed on cloud.

There is **no** full `~/code/dotagents` checkout on this VM unless the current
repo *is* dotagents. The installer plants a **stub symlink** at
`~/code/dotagents/gate/gate-lib.sh` so child pre-commits' default source path
resolves in every shell (non-login `bash -c` / git hooks) with `DOTAGENTS_GATE_LIB` unset.
The installer does **not** replace `gate-lib.sh` inside a real `~/code/dotagents`
checkout. That stub is **not** a laptop tree — do not look for skills there, do not claim
child repos inherit home wiring, and do **not** hand-copy `gate-lib.sh` into
this repo. Do **not** vendor the private dotagents tree into this repo.

`.cursor/environment.json` sets `repositoryDependencies` to
`github.com/jsolly/dotagents` so the generated GitHub token can include that
private repo (it does **not** auto-clone). The Cursor GitHub App must allowlist
`jsolly/dotagents`.

`~/.cursor/rules` from a laptop home is **not** auto-applied on cloud. User Rules + repo
`AGENTS.md` + this file carry policy; skills that cite rules must read the copies under
`~/.cursor/dotagents-package/rules/`.

## Connectors and marketplace plugins

The account's marketplace plugins follow you onto this VM; `~/.cursor/mcp.json` does **not**. The
canon is `mcps/catalog.json` (copied to `~/.cursor/dotagents-package/mcps/`): it records every
fleet-worthy connector with its plugin id / remote URL, the surfaces it belongs on, and its rule.
Run `/optimize-workspaces` to reconcile this session against it. Two standing rules: GitHub MCP access
may use the approved marketplace plugin `48677658`, the `github-local` account connector, or `gh` — with the same authorization rules — and
a connector that crosses repos gets its catalog row in the **same change** that adds it.

## Durable planning and human handoffs

When this harness lacks a usable native planning mode, load
`~/.cursor/skills/persist-todos-in-todoist/SKILL.md` for durable Todoist outcomes,
cooperative claims and human handoffs. Human actions and ad hoc work outside a
repo also use that skill. A supported native repo plan needs no Todoist mirror;
reconsider this integration when Cursor Cloud or Grok Bot gains native planning.
Reconcile already-tracked commitments regardless of the current harness.

A change other repos must adopt is never synced from here. Link its merged PR on
the one open fleet-rollout task in the dotagents project; John starts one agent
on it once dotagents settles. Canon: laptop global brief **One repo per chip**;
also this repo's `AGENTS.md` when present.

For Todoist-backed work, load the expected John user ID and email from the
installed private persistence skill. Require both user-info fields to match
before queue pickup or writes; missing private identity policy or an account
mismatch stops Todoist work and is reported. Then read a known shared task and
all its comments;
shared-task visibility alone is not identity proof. Discover only work in this repo or assigned
role, inside existing authorization. Missing tracker access blocks unattended
Todoist pickup; explicitly requested read-only analysis may continue with an
honest unsynced status. Native repo plans without a Todoist obligation do not
require the connector. Catalog installation is not authentication proof.

## Laptop-only (not on cloud)

- `setup/install-local-agent-runtime.sh` and `setup/doctor-agents.sh`
- User-level `~/.cursor/hooks.json` and other home hooks
- Laptop-only skills (e.g. `setup-personal-machine`, `solly-create-skill`)

## Skills / slash commands

If slash-skill autocomplete is empty on a **follow-up** turn, invoke the skill by name in prose
(known Agents Window bug; typed invoke still works).

`/verify-ui` ships in this package — use it for UI smoke when the skill is present. If it is
missing, follow this repo's `AGENTS.md` **Local UI verification** stanza instead.

Product UI must not load runtime CSS/JS from third-party CDNs (jsDelivr, unpkg, cdnjs, esm.sh,
Google Fonts CSS, and similar). Prefer npm/local packages and first-party origins. Detailed policy: `~/.cursor/dotagents-package/rules/no-cdn-app-assets.md`; also read this repo's `AGENTS.md` when present.

Use Svelte + shadcn-svelte for new frontends. Existing Svelte repos use
shadcn-svelte for new or replaced standard controls; load `/shadcn-svelte`.
Framework migrations and alternative stacks require explicit user direction.
Policy: `~/.cursor/dotagents-package/rules/frontend-stack.md`. Record the stack
and any user-directed exception in this repo's `AGENTS.md`.

Vercel Git repos must not auto-Preview every branch. Production stays on `main`; opt-in `/preview`
only when John asks. Canon: laptop global brief **No automatic Vercel Previews**; also this repo's
`AGENTS.md` when present.

Personal AWS/SAM Lambdas keep the full enrichment path (copied logger, both alarms, error-level
metric filter, `AlertTopicArn`). Copy retention and thresholds; never invent. Missing `~/code/shared-infra` is `not done`. Detailed policy: `~/.cursor/dotagents-package/rules/lambda-shared-infra.md`; also read this repo's `AGENTS.md` when present. Add or repair via `/new-solly-repo`.

`/remove-feature` ships in this package — load it before substantial code deletion (a feature,
module, many files, a large deleted-line diff), not only when the user types the slash command.
Tiny unused-line deletes and complexity-only cleanup (`/remove-slop`) stay ordinary editing.

## Outbound identity (standing rule, not a skill)

Read `~/.cursor/dotagents-package/rules/outbound-identity.md` before composing or claiming `done`, `holding`, or `sent` for outbound.

## Hooks

Only hooks committed under this repo's `.cursor/hooks.json` (or team/enterprise hooks) apply.
User-level hook config from a laptop does not run in cloud.

## AWS reads (same role as the laptop)

Only when this repo's `.cursor/environment.json` runs `bash .cursor/aws-oidc-login.sh` is AWS set
up on this VM. Repos that use AWS run it on `install` and `start`; the rest are install-only
(`grep -c aws-oidc-login.sh .cursor/environment.json` prints `0`). On an install-only repo there is
no AWS CLI install, no `~/.aws/config` from the script, and no `AWS_PROFILE`, so report AWS reads as
not set up rather than looking for credentials. Install-only is least setup, not least privilege
(the rule's Cloud assume path says why), so never describe it as withholding AWS access. A task here
that genuinely needs AWS reads may run `bash .cursor/aws-oidc-login.sh` itself, which sets up the same
`agent-readonly` role described below.

Where it runs, the script writes
`~/.aws/config` with `credential_process` (no static STS keys — those expire in
1h and Builds do not re-run `install`). Each `aws` call mints a Cursor OIDC JWT
(`aud: sts.amazonaws.com`) and assumes `arn:aws:iam::730335616323:role/agent-readonly`.
That is the **same** IAM role laptop agents use via Identity Center `AgentReadOnly`; its policies,
including the change-set grants, are in `~/.cursor/dotagents-package/rules/agent-cloud-access.md` →
Read path. Do not look for `fleet-deploy` or
`agent-deploy`; those laptop deploy identities are gone.

Once it has run, `AWS_PROFILE=agent-readonly` is set. Use it for CloudWatch / Lambda
describe/get/list. Secret reads (SSM parameters, Secrets Manager values) are denied
except the narrow nonsecret configuration exception defined in
`~/.cursor/dotagents-package/rules/agent-cloud-access.md` — read that rule for the exact
parameters and actions. A denied read is reported once, never bypassed.
Do **not** invoke `*-live-provider-check` — that grant is CI and human-admin only.

Allow `sts.amazonaws.com` (and regional STS if used) on this environment's network
policy or assume-role will hang. The role ARN may be a Cursor Environment Variable
(`AWS_ROLE_ARN`); it is not a secret. Never store long-lived AWS keys.

Claude/Codex cloud OIDC is stubbed until those vendors publish an issuer; then add
another IAM OIDC provider + trust statement on the **same** `agent-readonly` role.

### Host work (explicit role)

The script also writes profile `agent-host-operator`, which assumes
`arn:aws:iam::730335616323:role/agent-host-operator` through the same JWT. Use it only for
host work on `fleet:agent-operable=true` instances, and only by naming it on the command:
`AWS_PROFILE=agent-host-operator aws ssm send-command ...` (read results with
`aws ssm get-command-invocation`), or `aws ssm start-session` where a TTY and the Session
Manager plugin exist (the script installs the plugin when it can). Never export it as the
default. What the role may and may not do is in
`~/.cursor/dotagents-package/rules/agent-cloud-access.md` → Agent-operable hosts; until John
deploys shared-infra's role, assuming it fails, so report that rather than switching roles.
On this VM the split is a convention, not a boundary: both roles trust the same JWT, so any
process here can assume either.

## Infra plan (read-only change set)

The procedure and its meaning are canon in
`~/.cursor/dotagents-package/rules/dirty-iac.md` and
`~/.cursor/dotagents-package/rules/agent-cloud-access.md` → **Infra plan**; the
`/optimize-workspaces` steps are
`~/.cursor/skills/optimize-workspaces/references/infra-plan.md`. Read them before running
or reporting `plan:infra` or `check:infra-drift`. What this VM adds:

- `gate_with_readonly_aws` (through the gate-lib stub) mints `agent-readonly` from the
  OIDC profile `.cursor/aws-oidc-login.sh` wrote, which exists only where the section above
  says the script runs. If minting fails, report unavailable; do not switch roles.
- Run either script only in the current workspace, and only when it is the fleet repo.
  Do not clone other fleet repos onto this VM to plan them.

Follow the installed dirty-IaC and agent-cloud-access rules above for deploy prohibitions, plan denials, report requirements and human hand-offs.
