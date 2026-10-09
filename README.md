# Blogthedata — retained source archive

The blog now lives at <https://www.jsolly.com/blog/> and the recipe library at
<https://www.jsolly.com/recipes/>. Active source and publishing workflows are in
[jsolly/jsolly-website](https://github.com/jsolly/jsolly-website), a private repository.
This public MIT repository preserves the earlier source and migration history.
Do not publish here or reconnect it to a hosting project. Open Dependabot PRs are
closed as part of archival; dependency maintenance belongs in the active repository.

## Retained recovery resources

The AWS `blogthedata-migration-backups` stack and its IaC remain frozen here.
The recovery objects remain under Object Lock through **November 1, 2026**.
Continuous fleet protection and drift reads stop when this repository is archived;
the stack's termination protection and stack policy remain enabled independently.
John's November 1 retention decision remains open; archival does not authorize
infrastructure deployment or teardown.

Final read-only checks on October 9, 2026, from
`/Users/johnsolly/code/awesome-blog` through `gate_with_readonly_aws`:

- `check:stack-protection` passed: termination protection is on and the stack
  policy matches `aws/migration-backups/stack-policy.json`.
- `check:infra-drift -- --json --warn-only` passed with `status: clean`, no changed
  infra inputs, and `InfraDeployCommit` matching main's infra inputs. Recorded
  deployed commit: `88a9012b0d63c34751b397ee0b7dac08a2a8efbe`; latest infra-input
  commit: `00b5fb31e2e69b6a5d1efe25151c6564d080679f`.

S3/CloudFront still serve article images for jsolly.com. Heroku release v315,
its database and media, independent backups and local recovery exports remain
retained until separately authorized retirement. Keep blogthedata.com registered
indefinitely with auto-renew; its Vercel project serves redirects from the active
repository's `legacy/blogthedata` directory.

## Historical documentation

[Publishing](docs/publishing.md), [recipes](docs/recipes.md), the
[Astro migration runbook](docs/astro-migration.md), and
[backup runbook](docs/migration-backups.md) describe the retained source and
recovery history. Current publishing instructions belong in jsolly-website.
Local builds remain available for recovery using Node 24 and the commands in
[AGENTS.md](AGENTS.md); merging archival documentation does not deploy this site.

See [contributing](docs/CONTRIBUTING.md), [security](docs/SECURITY.md), and
[license](LICENSE).
