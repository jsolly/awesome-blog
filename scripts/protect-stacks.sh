#!/usr/bin/env bash
# Stack protection for Blogthedata migration backups: termination protection plus each stack's
# committed stack policy, which denies replacing or removing its stateful resources in any
# stack update. gate-lib applies and checks both (dotagents rules/agent-cloud-access.md →
# Destructive-op hardening). None of these files is an infra input.
#
#   npm run protect:stacks            John, admin: apply from the landed main tip
#   npm run check:stack-protection    anyone, read-only: exit 1 on drift, 2 when unreadable
((BASH_VERSINFO[0] >= 5)) || { echo "✗ $0 requires Bash >= 5, not $BASH_VERSION. Fix: brew install bash; rerun bash ~/code/dotagents/setup/install-local-agent-runtime.sh; open a new shell." >&2; exit 1; }
set -euo pipefail
cd "$(dirname "$0")/.."
# Any setup failure (no lib, a lib older than v4, no aws) exits 2, "unverified", never 1 (drift).
# shellcheck source=/dev/null
source "${DOTAGENTS_GATE_LIB:-$HOME/code/dotagents/gate/gate-lib.sh}" || exit 2
# v2: gate_check_stack_protection / gate_apply_stack_protection <owner/repo>. v4: the check's
# agent-readonly default reads ~/.aws/agent-config, the only laptop config that holds that profile.
# The subshell turns gate_require_lib's exit into a status.
(gate_require_lib 4) || exit 2
gate_activate_mise_shims || exit 2
gate_require_cli aws || exit 2

# Explicit allow-list: <stack> <policy-file>. scripts/stack-protection.test.mjs runs this script and
# pins the list to scripts/infra-inputs.json and the committed backup template.
STACKS=(
  blogthedata-migration-backups aws/migration-backups/stack-policy.json
)

case "${1:-}" in
  --check)
    rc=0
    gate_check_stack_protection "${STACKS[@]}" || rc=$?
    if [ "$rc" -eq 1 ]; then
      echo "  John, after reviewing: cd /Users/johnsolly/code/awesome-blog && git switch main && git pull --ff-only && npm run protect:stacks" >&2
    fi
    exit "$rc"
    ;;
  "")
    gate_apply_stack_protection jsolly/awesome-blog "${STACKS[@]}"
    ;;
  *)
    echo "usage: $0 [--check]" >&2
    exit 2
    ;;
esac
