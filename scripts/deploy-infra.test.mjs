import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import manifest from './infra-inputs.json' with { type: 'json' };

const [{ stack, template, inputs }] = manifest.stacks;
const SCRIPT = 'aws/migration-backups/deploy.sh';
const HEAD = 'a'.repeat(40);
const MOVED = 'b'.repeat(40);
const ADMIN = 'arn:aws:sts::730335616323:assumed-role/AWSReservedSSO_AdministratorAccess_0123456789abcdef/john';

const directories = [];
test.after(() => { for (const directory of directories) rmSync(directory, { recursive: true, force: true }); });

/**
 * Runs deploy.sh against stand-ins for everything it reaches: gate-lib, `aws` and `git`. Each
 * appends what it was asked to one event log, so the order across all three is checkable. No AWS
 * call and no real git state is involved.
 */
function deploy(scenario = {}) {
  const fixture = mkdtempSync(join(tmpdir(), 'blog-deploy-infra-'));
  directories.push(fixture);
  const events = join(fixture, 'events');
  const bin = join(fixture, 'bin');
  mkdirSync(bin);
  const lib = join(fixture, 'gate-lib.sh');
  writeFileSync(lib, `gate_require_lib() { echo "lib gate_require_lib $*" >> "$EVENTS"; [ -z "$STALE_LIB" ] || exit 1; }
gate_activate_mise_shims() { echo "lib gate_activate_mise_shims" >> "$EVENTS"; }
gate_require_cli() { echo "lib gate_require_cli $*" >> "$EVENTS"; [ -z "$NO_AWS" ]; }
gate_require_landed() { echo "lib gate_require_landed $*" >> "$EVENTS"; [ -z "$UNLANDED" ] || exit 1; }
`);
  writeFileSync(join(bin, 'aws'), `#!/usr/bin/env bash
echo "aws $*" >> "$EVENTS"
case "$1 $2" in
  "sts get-caller-identity") [ -z "$NO_IDENTITY" ] || exit 255; printf '%s\\t%s\\n' "$FAKE_ACCOUNT" "$FAKE_ARN" ;;
  "cloudformation describe-stacks")
    [ -z "$NO_STACK" ] || exit 254
    case "$*" in
      *InfraDeployCommit*) echo "\${STAMPED:-${HEAD}}" ;;
      *) echo CREATE_COMPLETE ;;
    esac ;;
  "cloudformation deploy") exit "$DEPLOY_RC" ;;
  *) exit 97 ;;
esac
`);
  writeFileSync(join(bin, 'git'), `#!/usr/bin/env bash
echo "git $*" >> "$EVENTS"
[ "$*" = "rev-parse HEAD" ] || exit 97
if [ -n "$HEAD_MOVES" ] && [ "$(grep -c '^git rev-parse HEAD$' "$EVENTS")" -gt 1 ]; then echo "${MOVED}"; else echo "${HEAD}"; fi
`);
  for (const tool of ['aws', 'git']) chmodSync(join(bin, tool), 0o755);
  const result = spawnSync('bash', [SCRIPT], {
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: fixture,
      DOTAGENTS_GATE_LIB: lib,
      EVENTS: events,
      FAKE_ACCOUNT: '730335616323',
      FAKE_ARN: ADMIN,
      DEPLOY_RC: '0',
      STALE_LIB: '',
      NO_AWS: '',
      NO_IDENTITY: '',
      NO_STACK: '',
      UNLANDED: '',
      HEAD_MOVES: '',
      STAMPED: '',
      // Were a stand-in ever missed, the real CLI would find no credentials to act with.
      AWS_CONFIG_FILE: '/dev/null',
      AWS_SHARED_CREDENTIALS_FILE: '/dev/null',
      AWS_EC2_METADATA_DISABLED: 'true',
      ...scenario,
    },
  });
  const log = existsSync(events) ? readFileSync(events, 'utf8').trim().split('\n') : [];
  return { ...result, events: log, deployed: log.some(line => line.startsWith('aws cloudformation deploy')) };
}

const identityRead = "aws sts get-caller-identity --region us-east-1 --query [Account, Arn] --output text";
const stackRead = `aws cloudformation describe-stacks --region us-east-1 --stack-name ${stack} --query Stacks[0].StackStatus --output text`;

test('deploys the landed commit to the existing stack and stamps it with that commit', () => {
  const result = deploy();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.events, [
    'git rev-parse HEAD',
    'lib gate_require_lib 1',
    'lib gate_activate_mise_shims',
    'lib gate_require_cli aws',
    identityRead,
    stackRead,
    // The landing guard and the HEAD re-read are the last things before the irreversible step.
    'lib gate_require_landed main jsolly/awesome-blog',
    'git rev-parse HEAD',
    // --tags replaces the stack's tag set: the two it was created with, plus the commit applied.
    `aws cloudformation deploy --region us-east-1 --stack-name ${stack} --template-file ${template} --no-fail-on-empty-changeset --tags Project=blogthedata Purpose=migration-recovery InfraDeployCommit=${HEAD}`,
    // The stamp is read back before the script claims it.
    `aws cloudformation describe-stacks --region us-east-1 --stack-name ${stack} --query Stacks[0].Tags[?Key=='InfraDeployCommit'].Value|[0] --output text`,
  ]);
  assert.equal(result.stdout, `✓ ${stack} carries InfraDeployCommit=${HEAD}\n`);
});

test('refuses before any deploy call when a precondition fails', () => {
  const cases = [
    ['a gate-lib older than the landing guard needs', { STALE_LIB: '1' }, ''],
    ['no aws CLI', { NO_AWS: '1' }, ''],
    ['an unreadable identity', { NO_IDENTITY: '1' }, "cannot read the caller's AWS identity; refusing to deploy"],
    ['another account', { FAKE_ACCOUNT: '111111111111' }, `refusing to deploy in account 111111111111: ${stack} lives in 730335616323`],
    ['the read-only agent role', { FAKE_ARN: 'arn:aws:sts::730335616323:assumed-role/agent-readonly/botocore-session-1' }, 'deploy:infra needs administrator credentials and this shell holds agent-readonly'],
    ['a stack that cannot be read, which deploy would otherwise create', { NO_STACK: '1' }, `cannot read ${stack} in 730335616323; refusing to deploy`],
    ['a checkout that is not the landed main tip', { UNLANDED: '1' }, ''],
    ['a HEAD that moved after the run started', { HEAD_MOVES: '1' }, `HEAD moved since this run started (was ${HEAD}); rerun deploy:infra`],
  ];
  for (const [label, scenario, said] of cases) {
    const result = deploy(scenario);
    assert.notEqual(result.status, 0, label);
    assert.equal(result.deployed, false, label);
    assert.ok(result.stderr.includes(said), `${label}: ${result.stderr}`);
    assert.equal(result.stdout, '', label);
  }
});

test('fails when the deploy exits 0 but the stack does not carry the new stamp', () => {
  const result = deploy({ STAMPED: 'None' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.includes(`reads InfraDeployCommit=None after the deploy, not ${HEAD}`), result.stderr);
});

test('fails when the deploy itself fails, without claiming the tag', () => {
  const result = deploy({ DEPLOY_RC: '255' });
  assert.equal(result.status, 255);
  assert.equal(result.deployed, true);
  assert.equal(result.stdout, '');
});

test('the manifest lists the deploy script as an infra input, next to the template it applies', () => {
  assert.deepEqual(inputs, [template, SCRIPT]);
  assert.equal(manifest.stacks[0].command, 'npm run deploy:infra');
});
