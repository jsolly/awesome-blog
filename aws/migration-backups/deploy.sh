#!/usr/bin/env bash
# deploy:infra for the migration backup stack: applies the landed main tip's template and stamps the
# stack InfraDeployCommit=<that commit>, the tag npm run check:infra-drift compares with main.
#
#   npm run plan:infra      anyone, read-only: preview the change set first
#   npm run deploy:infra    John only, from his own terminal with administrator credentials
#
# Agents never run this (dotagents rules/dirty-iac.md). This file is an infra input
# (scripts/infra-inputs.json): a change to it leaves deploy:infra pending until John reruns it.
((BASH_VERSINFO[0] >= 5)) || { echo "✗ $0 requires Bash >= 5, not $BASH_VERSION. Fix: brew install bash; rerun bash ~/code/dotagents/setup/install-local-agent-runtime.sh; open a new shell." >&2; exit 1; }
set -euo pipefail
cd "$(dirname "$0")/../.."
STACK=blogthedata-migration-backups
REGION=us-east-1
ACCOUNT=730335616323
# The commit this run applies; the InfraDeployCommit tag below must name it.
INFRA_COMMIT="$(git rev-parse HEAD)"
# shellcheck source=/dev/null
source "${DOTAGENTS_GATE_LIB:-$HOME/code/dotagents/gate/gate-lib.sh}" || {
  echo "✗ dotagents gate-lib missing; re-run the agent runtime installer." >&2
  exit 1
}
gate_require_lib 1
gate_activate_mise_shims
gate_require_cli aws
export AWS_PAGER=""

# This repository is public, so no profile is named here: the caller's own credentials deploy.
# John's terminal holds his MFA-gated administrator profile. An agent shell holds agent-readonly,
# which cannot execute a change set and would leave the one it created behind.
identity="$(aws sts get-caller-identity --region "$REGION" --query '[Account, Arn]' --output text)" || {
  echo "✗ cannot read the caller's AWS identity; refusing to deploy" >&2
  exit 1
}
read -r account arn <<<"$identity"
if [ "$account" != "$ACCOUNT" ]; then
  echo "✗ refusing to deploy in account ${account:-unknown}: $STACK lives in $ACCOUNT" >&2
  exit 1
fi
case "$arn" in
  *:assumed-role/agent-readonly/*)
    echo "✗ deploy:infra needs administrator credentials and this shell holds agent-readonly. John runs it from his own terminal." >&2
    exit 1
    ;;
esac

# Update only. aws cloudformation deploy creates a missing stack, and this one is never recreated
# (docs/migration-backups.md), so a stack that cannot be read stops the run.
aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
  --query 'Stacks[0].StackStatus' --output text >/dev/null || {
  echo "✗ cannot read $STACK in $ACCOUNT; refusing to deploy" >&2
  exit 1
}

# Apply only what landed on jsolly/awesome-blog's main, exactly as committed, and only the commit
# captured above. Nothing builds here, so the guard runs once, right before the irreversible step.
gate_require_landed main jsolly/awesome-blog
[ "$(git rev-parse HEAD)" = "$INFRA_COMMIT" ] || { echo "✗ HEAD moved since this run started (was $INFRA_COMMIT); rerun deploy:infra" >&2; exit 1; }

# --tags replaces the stack's tag set, so the two tags the stack was created with ride along.
# The template declares no parameters and no IAM resources, so there are none to pass
# (scripts/plan-infra.mjs previews with the same absence).
aws cloudformation deploy \
  --region "$REGION" \
  --stack-name "$STACK" \
  --template-file aws/migration-backups/template.json \
  --no-fail-on-empty-changeset \
  --tags Project=blogthedata Purpose=migration-recovery "InfraDeployCommit=$INFRA_COMMIT"
# A change set CloudFormation judged empty also exits 0, so read the stamp back before claiming it.
stamped="$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
  --query "Stacks[0].Tags[?Key=='InfraDeployCommit'].Value|[0]" --output text)" || stamped=""
if [ "$stamped" != "$INFRA_COMMIT" ]; then
  echo "✗ $STACK reads InfraDeployCommit=${stamped:-none} after the deploy, not $INFRA_COMMIT; check:infra-drift stays pending" >&2
  exit 1
fi
echo "✓ $STACK carries InfraDeployCommit=$INFRA_COMMIT"
