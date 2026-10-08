#!/usr/bin/env bash
# Federate this Cloud Agent VM into IAM role agent-readonly via vendor OIDC.
# Laptop agents use Identity Center AgentReadOnly instead — this script no-ops
# when no cloud OIDC identity is present.
#
# Install/start writes ~/.aws/config with credential_process (no static keys).
# `aws` then mints a JWT and assumes the role at use time; the CLI caches until
# Expiration. Do not persist Build-time STS keys — they expire in 1h and install
# does not re-run on later agent starts.
#
# It also writes profile agent-host-operator for host work on
# fleet:agent-operable=true instances (rules/agent-cloud-access.md → Agent-operable
# hosts), used only explicitly: `AWS_PROFILE=agent-host-operator aws ssm ...`.
# The default stays agent-readonly. Residual: on Cursor Cloud the split is a
# convention, not a boundary. Both roles trust the same Cursor JWT (same aud/sub
# pin) and no claim tells them apart, so any process on the VM that can mint the
# JWT can assume either role. The laptop's separate Identity Center user is what
# makes the split real there.
set -euo pipefail

REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
CURSOR_SOCK="${CURSOR_AGENT_SOCKET:-/run/cursor/api.sock}"
HELPER="${HOME}/.local/bin/aws-oidc-login.sh"
CREDENTIAL_PROCESS=0
ROLE=agent-readonly
if [[ "${1:-}" == "--credential-process" ]]; then
  CREDENTIAL_PROCESS=1
  ROLE="${2:-}"
fi
# A literal allowlist. AWS_ROLE_ARN may repoint the read role (a Cursor
# Environment Variable), never the host role.
case "$ROLE" in
  agent-readonly)
    ROLE_ARN="${AWS_ROLE_ARN:-arn:aws:iam::730335616323:role/agent-readonly}"
    SESSION_NAME="${AWS_ROLE_SESSION_NAME:-cloud-agent}"
    ;;
  agent-host-operator)
    ROLE_ARN="arn:aws:iam::730335616323:role/agent-host-operator"
    SESSION_NAME="cloud-agent-host"
    ;;
  *)
    echo "aws-oidc-login: unknown role '${ROLE}' (want agent-readonly or agent-host-operator)" >&2
    exit 2
    ;;
esac

log() {
  if [[ "$CREDENTIAL_PROCESS" -eq 1 ]]; then
    echo "aws-oidc-login: $*" >&2
  else
    echo "aws-oidc-login: $*"
  fi
}

install_aws_cli() {
  if command -v aws >/dev/null 2>&1; then
    return 0
  fi
  log "installing AWS CLI v2"
  local arch bundle dest
  arch="$(uname -m)"
  case "$arch" in
    aarch64 | arm64) bundle="awscli-exe-linux-aarch64.zip" ;;
    x86_64) bundle="awscli-exe-linux-x86_64.zip" ;;
    *)
      log "unsupported arch ${arch}; install aws CLI manually" >&2
      return 1
      ;;
  esac
  dest="$(mktemp -d)"
  curl -fsSL "https://awscli.amazonaws.com/${bundle}" -o "${dest}/awscliv2.zip"
  unzip -q "${dest}/awscliv2.zip" -d "$dest"
  if [[ "$(id -u)" -eq 0 ]]; then
    "${dest}/aws/install"
  elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    sudo "${dest}/aws/install"
  else
    mkdir -p "${HOME}/.local/bin"
    "${dest}/aws/install" -i "${HOME}/.local/aws-cli" -b "${HOME}/.local/bin"
    if [[ -d /etc/profile.d && -w /etc/profile.d ]]; then
      printf 'export PATH="%s/.local/bin:$PATH"\n' "$HOME" >/etc/profile.d/aws-local-bin.sh
    fi
    # Non-login bash -c still misses ~/.local/bin; prefer sudo install above.
    export PATH="${HOME}/.local/bin:${PATH}"
    if [[ -w /usr/local/bin ]]; then
      ln -sfn "${HOME}/.local/bin/aws" /usr/local/bin/aws
    elif command -v sudo >/dev/null 2>&1; then
      sudo ln -sfn "${HOME}/.local/bin/aws" /usr/local/bin/aws || true
    fi
  fi
  rm -rf "$dest"
  command -v aws >/dev/null 2>&1 || {
    log "aws CLI not on PATH after install" >&2
    return 1
  }
}

# `aws ssm start-session` needs AWS's Session Manager plugin. Best effort: a
# missing plugin must not fail the read-role bootstrap, and `aws ssm
# send-command` works without it. Pinned and sha256-checked, since it installs
# as root; bump the version and both hashes together.
SSM_PLUGIN_VERSION=1.2.835.0
install_session_manager_plugin() {
  if command -v session-manager-plugin >/dev/null 2>&1; then
    return 0
  fi
  local arch deb dest sha got
  case "$(uname -m)" in
    aarch64 | arm64) arch="ubuntu_arm64" sha=0add94c4c8b6ca63f26e44fd655d662b0f6455a268b5b9ebebee0f462214e928 ;;
    x86_64) arch="ubuntu_64bit" sha=7c6dcad12518571cc7959a713e6a8ae1bdf6ed66fd9bee37dc189e39ca58ae03 ;;
    *)
      log "Session Manager plugin: unsupported arch; start-session unavailable"
      return 0
      ;;
  esac
  if ! command -v dpkg >/dev/null 2>&1; then
    log "Session Manager plugin: no dpkg; start-session unavailable"
    return 0
  fi
  dest="$(mktemp -d)"
  deb="${dest}/session-manager-plugin.deb"
  if ! curl -fsSL "https://s3.amazonaws.com/session-manager-downloads/plugin/${SSM_PLUGIN_VERSION}/${arch}/session-manager-plugin.deb" -o "$deb"; then
    log "Session Manager plugin: download failed; start-session unavailable"
  elif got="$(sha256sum "$deb" 2>/dev/null || shasum -a 256 "$deb" 2>/dev/null)"; [[ "${got%% *}" != "$sha" ]]; then
    log "Session Manager plugin: sha256 mismatch for ${SSM_PLUGIN_VERSION}; not installed"
  elif [[ "$(id -u)" -eq 0 ]]; then
    dpkg -i "$deb" >/dev/null || log "Session Manager plugin: dpkg -i failed"
  elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    sudo dpkg -i "$deb" >/dev/null || log "Session Manager plugin: dpkg -i failed"
  else
    log "Session Manager plugin: no root or passwordless sudo; start-session unavailable"
  fi
  rm -rf "$dest"
  return 0
}

extract_oidc_token() {
  python3 -c '
import json, sys
raw = sys.stdin.read().strip()
if raw.startswith("eyJ"):
    print(raw)
    raise SystemExit(0)
data = json.loads(raw)
for key in ("token", "oidc_token", "id_token", "access_token"):
    value = data.get(key)
    if isinstance(value, str) and value:
        print(value)
        raise SystemExit(0)
raise SystemExit("no token in OIDC response")
'
}

jwt_sub() {
  python3 -c '
import base64, json, sys
parts = sys.argv[1].split(".")
if len(parts) < 2:
    raise SystemExit(0)
pad = "=" * ((4 - len(parts[1]) % 4) % 4)
payload = json.loads(base64.urlsafe_b64decode(parts[1] + pad))
print(payload.get("sub", ""))
' "$1"
}

prefer_oidc_chain() {
  # Env static keys and Cursor's proprietary AssumeRole beat credential_process.
  unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
  unset CURSOR_AWS_ASSUME_IAM_ROLE_ARN
  export AWS_CONFIG_FILE="${HOME}/.aws/config"
  export AWS_PROFILE=agent-readonly
  export AWS_REGION="$REGION"
  export AWS_DEFAULT_REGION="$REGION"
}

append_aws_exports() {
  local rc="$1"
  touch "$rc"
  if ! grep -q 'AWS_PROFILE=agent-readonly' "$rc" 2>/dev/null; then
    cat >> "$rc" <<EOF

# Cloud Agent AWS read role (vendor OIDC → agent-readonly)
export AWS_PROFILE=agent-readonly
export AWS_REGION=${REGION}
export AWS_DEFAULT_REGION=${REGION}
export PATH="\$HOME/.local/bin:/usr/local/bin:\$PATH"
EOF
  fi
  if ! grep -q 'unset AWS_ACCESS_KEY_ID' "$rc" 2>/dev/null; then
    cat >> "$rc" <<'EOF'
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
unset CURSOR_AWS_ASSUME_IAM_ROLE_ARN
export AWS_CONFIG_FILE="$HOME/.aws/config"
EOF
  fi
}

install_helper() {
  mkdir -p "$(dirname "$HELPER")"
  local src
  src="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  if [[ "$src" != "$HELPER" ]]; then
    cp "$src" "$HELPER"
  fi
  chmod 0755 "$HELPER"
}

write_profile() {
  mkdir -p "${HOME}/.aws"
  umask 077
  rm -f "${HOME}/.aws/credentials"
  # credential_process so later agent starts (and calls after 1h) mint fresh
  # STS creds. [default] covers non-login bash -c that never sources bashrc.
  cat > "${HOME}/.aws/config" <<EOF
[default]
credential_process = ${HELPER} --credential-process agent-readonly
region = ${REGION}
output = json

[profile agent-readonly]
credential_process = ${HELPER} --credential-process agent-readonly
region = ${REGION}
output = json

[profile agent-host-operator]
credential_process = ${HELPER} --credential-process agent-host-operator
region = ${REGION}
output = json
EOF
  append_aws_exports "${HOME}/.bashrc"
  append_aws_exports "${HOME}/.profile"
  prefer_oidc_chain
}

assume_web_identity_json() {
  local token="$1"
  # Do not load this profile's credential_process (infinite recursion).
  env -u AWS_PROFILE -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN \
    AWS_EC2_METADATA_DISABLED=true \
    AWS_CONFIG_FILE=/dev/null \
    AWS_SHARED_CREDENTIALS_FILE=/dev/null \
    aws sts assume-role-with-web-identity \
    --role-arn "$ROLE_ARN" \
    --role-session-name "$SESSION_NAME" \
    --web-identity-token "$token" \
    --duration-seconds 3600 \
    --region "$REGION" \
    --output json
}

mint_cursor_jwt() {
  local raw
  raw="$(
    curl --fail --silent --show-error --unix-socket "$CURSOR_SOCK" \
      -H "Content-Type: application/json" \
      -d '{"aud":"sts.amazonaws.com"}' \
      http://localhost/v1/tokens/oidc
  )"
  printf '%s' "$raw" | extract_oidc_token
}

wait_for_cursor_sock() {
  on_cursor_host=0
  if [[ -n "${CURSOR_AGENT_SOCKET:-}" || -d /run/cursor ]]; then
    on_cursor_host=1
    i=0
    while [[ ! -S "$CURSOR_SOCK" && "$i" -lt 6 ]]; do
      log "waiting for OIDC socket ${CURSOR_SOCK}"
      sleep 2
      i=$((i + 1))
    done
  fi
}

emit_credential_process() {
  local token creds
  token="$(mint_cursor_jwt)"
  creds="$(assume_web_identity_json "$token")"
  python3 -c '
import json, sys
c = json.loads(sys.argv[1])["Credentials"]
print(json.dumps({
    "Version": 1,
    "AccessKeyId": c["AccessKeyId"],
    "SecretAccessKey": c["SecretAccessKey"],
    "SessionToken": c["SessionToken"],
    "Expiration": c["Expiration"],
}))
' "$creds"
}

wait_for_cursor_sock

if [[ "$CREDENTIAL_PROCESS" -eq 1 ]]; then
  if [[ ! -S "$CURSOR_SOCK" ]]; then
    log "OIDC socket missing (${CURSOR_SOCK})" >&2
    exit 1
  fi
  emit_credential_process
  exit 0
fi

if [[ -S "$CURSOR_SOCK" ]]; then
  install_aws_cli
  install_session_manager_plugin
  log "Cursor Cloud OIDC socket at ${CURSOR_SOCK}"
  token="$(mint_cursor_jwt)"
  sub="$(jwt_sub "$token")"
  log "minted JWT sub=${sub:-unknown}"
  # Helper and config change together, after the mint succeeds: a failed run keeps the old pair.
  install_helper
  write_profile
  identity="$(aws sts get-caller-identity --profile agent-readonly --region "$REGION" --output json)"
  printf '%s\n' "$identity"
  arn="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["Arn"])' "$identity")"
  case "$arn" in
    *:assumed-role/agent-readonly/*) ;;
    *)
      log "expected assumed-role/agent-readonly, got ${arn}" >&2
      exit 1
      ;;
  esac
  log "assumed ${ROLE_ARN} as profile agent-readonly"
  # Not assumed here: the role may not be deployed yet, and host work is explicit.
  log "wrote profile agent-host-operator (host work only: AWS_PROFILE=agent-host-operator)"
  exit 0
fi

if [[ "${on_cursor_host:-0}" -eq 1 ]]; then
  log "Cursor Cloud OIDC socket missing after wait (${CURSOR_SOCK}); fail" >&2
  exit 1
fi

# Other vendors (Claude, Codex) have no published VM OIDC issuer yet; they land here too.
log "no cloud-agent OIDC identity; skip"
exit 0
