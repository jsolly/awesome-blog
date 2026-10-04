# Independent migration backups

The backup bucket is `blogthedata-backups-730335616323` in `us-east-1`, created by
John through CloudFormation on October 2, 2026.
It is separate from the live `blogthedata` media bucket. The tracked
`aws/migration-backups/template.json` creates private, encrypted storage with versioning,
disabled ACLs, all public access blocked, TLS required, and 30 days of governance
retention. CloudFormation retains the bucket and policy if the stack is removed
or replaced. A committed stack policy blocks their replacement and deletion
during updates; termination protection blocks stack deletion. No expiration rule deletes backups automatically.

Governance retention protects an object version from ordinary deletion for its
retention period. An administrator with explicit bypass permission can bypass it;
this is not protection from a compromised AWS account. See
[S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html).
The original Heroku release and local recovery artifacts provide additional
rollback paths during the publishing freeze.

## Human infrastructure step

Stack `blogthedata-migration-backups` is `CREATE_COMPLETE`. Read-only verification
confirmed its exact committed template and stack policy, termination protection,
CloudFormation-managed bucket/policy, encryption, versioning, ownership, private
access, TLS enforcement and 30-day Governance retention. The agent's AWS identity
remains read-only. The following are the reviewed creation commands, run by John
from `/Users/johnsolly/code/awesome-blog` in his own
terminal. Authenticate with your existing MFA-gated administrator profile for account
`730335616323`; keep local profile names outside Git. These commands assume that
authenticated human terminal. Do not run them in an agent shell or change its
AWS configuration.

```bash
aws sts get-caller-identity
aws cloudformation create-stack --stack-name blogthedata-migration-backups --region us-east-1 --enable-termination-protection --stack-policy-body file:///Users/johnsolly/code/awesome-blog/aws/migration-backups/stack-policy.json --template-body file:///Users/johnsolly/code/awesome-blog/aws/migration-backups/template.json --tags Key=Project,Value=blogthedata Key=Purpose,Value=migration-recovery
aws cloudformation wait stack-create-complete --stack-name blogthedata-migration-backups --region us-east-1
```

Do not recreate the existing stack. For a future authorized creation, check the
identity is account `730335616323` before creating the stack. Stop on a
failure; an existing stack or bucket is not a reason to replace it. Review its
actual configuration instead. After creation, `npm run check:stack-protection`
reads the live termination protection and compares the live policy with the
committed policy. Exit 1 means drift; exit 2 means unreadable or unverified.
`npm run protect:stacks` is human-only and refuses an unlanded or dirty tree.
Its wrapper and resource-classification tests run in the local gate and CI.
New resource types require an explicit protection decision. No IAM principal, public access grant, live-bucket
change or teardown is part of this template.

## Stack updates

The stack was created by hand before `deploy:infra` existed, so it carries no
`InfraDeployCommit` tag until John's first `npm run deploy:infra`. From then on
that script is the only way the template reaches the stack. Its inputs are
listed once, in `scripts/infra-inputs.json`: the template and the deploy script.

- `npm run plan:infra -- --json` previews the update. It creates a change set
  from the checkout's template, reads it, deletes it and never executes it. It
  runs only as the read-only agent role and sends no tags, so it shows template
  changes and not the commit restamp. That role's change-set grant lists stacks
  by name: while this stack is not on it, the receipt is `status: error` with
  CloudFormation's AccessDenied, which is reported once and never retried. A
  change set it could not confirm deleted is an error that names it.
- `npm run check:infra-drift -- --json` compares the stack's `InfraDeployCommit`
  tag with origin's `main`. `pending` means an infra input changed since the
  tagged commit, or the tag is missing. A stack it cannot read, a stack that is
  mid-update or rolled back, or a checkout behind `main` is `error`, never `clean`.
- `npm run deploy:infra` is human-only. It refuses any account but
  `730335616323`, the read-only agent role, a stack it cannot read, and anything
  but a clean checkout of landed `main`. It then runs `aws cloudformation deploy`
  with the template, the two tags the stack was created with, and
  `InfraDeployCommit=<that commit>`. Run it from
  `/Users/johnsolly/code/awesome-blog` in a terminal that holds your administrator
  credentials. The stack policy still denies replacing or deleting either resource.

`npm run test:infra` exercises all three against stand-ins for `aws`, `git` and
the gate library; it makes no AWS call. It runs in the local gate and CI.

## Recovery receipt

After the publishing freeze, retain the final database dump, media archive,
inventory, export, checksums and recovery receipt under a fresh dated prefix.
Upload through an authorized human session. Record each object's version ID,
size, checksum and retain-until date. Download those exact versions to a fresh
private directory, verify SHA-256 against the original files, restore the database
in isolation, and retrieve a media image and PDF. A successful upload or a bucket
listing alone does not prove recovery.

Initial local artifacts are under `.migration-work/cutover-2026-10-02/` and the
final frozen package is under `.migration-work/final-2026-10-02T1742Z/` in this
checkout. Both remain private and ignored by Git. Final backup b002 has passed an
isolated local restore against all five exported models. All 1,010 live media
objects match the earlier inventory; 1,009 files totaling 101,335,569 bytes have
fresh SHA-256 checksums. Earlier recovery receipts are retained too.

John uploaded `migrations/2026-10-02T1742Z/recovery-bundle.tar.gz` to the backup
bucket. Its version is `A7Eg62qqtUAxYJySvCGI2aoWGcB41w2W`, size 73,873,206 bytes,
and SHA-256 `233bd84e4325f767eb2a9b1d527b0730255f89a2d3b9f0e6e77ff63ab2cb8832`.
Exact-version reads confirmed AES256 encryption, the expected checksum/metadata,
and Governance retention until `2026-11-01T18:19:35.530Z`. Downloading that exact
version into a fresh private directory passed whole-bundle, manifest, safe-member
and every-media-file checks. The downloaded database restored in an isolated
Unix-only PostgreSQL cluster; all exported fields across all five models matched,
and the temporary cluster was stopped and removed. Image and PDF samples were
retrieved from the downloaded media archive and visually verified.

Independent durable backup recovery is complete. Its private aggregate receipt is
`.migration-work/final-2026-10-02T1742Z/durable-recovery-receipt.json`; exact-version
responses, downloaded payload, restore logs and sample renders are retained under
the adjacent `remote-version-ai4j__pl/` directory.
Do not mark independent backup storage complete until the exact remote versions
have passed retrieval and recovery checks.
