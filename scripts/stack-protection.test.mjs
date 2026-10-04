import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const template = JSON.parse(readFileSync('aws/migration-backups/template.json', 'utf8'));
const policy = JSON.parse(readFileSync('aws/migration-backups/stack-policy.json', 'utf8'));
// New resource types must receive an explicit decision about replacement/data loss.
const protection = { 'AWS::S3::Bucket': true, 'AWS::S3::BucketPolicy': true };
// The protected stack is the one deploy:infra applies: scripts/infra-inputs.json is the one list.
const [{ stack }] = JSON.parse(readFileSync('scripts/infra-inputs.json', 'utf8')).stacks;
const policyPath = 'aws/migration-backups/stack-policy.json';
const pairs = `${stack} ${policyPath}`;

test('every resource is classified, retained and protected from replacement/removal', () => {
  const entries = Object.entries(template.Resources);
  for (const [id, resource] of entries) {
    assert.ok(Object.hasOwn(protection, resource.Type), `Classify new resource type: ${resource.Type}`);
    if (protection[resource.Type]) {
      assert.equal(resource.DeletionPolicy, 'Retain', id);
      assert.equal(resource.UpdateReplacePolicy, 'Retain', id);
    }
  }
  assert.equal(policy.Statement.length, 2);
  const deny = policy.Statement.find(statement => statement.Effect === 'Deny');
  const allow = policy.Statement.find(statement => statement.Effect === 'Allow');
  assert.deepEqual(Object.keys(deny).sort(), ['Action', 'Effect', 'Principal', 'Resource']);
  assert.equal(deny.Principal, '*');
  assert.deepEqual([deny.Action].flat().sort(), ['Update:Delete', 'Update:Replace']);
  assert.deepEqual([deny.Resource].flat().sort(), entries.filter(([, resource]) => protection[resource.Type]).map(([id]) => `LogicalResourceId/${id}`).sort());
  assert.deepEqual(allow, { Effect: 'Allow', Action: 'Update:*', Principal: '*', Resource: '*' });
});

test('recovery storage remains private, versioned, encrypted and retained for 30 days', () => {
  const bucket = template.Resources.BackupBucket.Properties;
  assert.deepEqual(bucket.PublicAccessBlockConfiguration, { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true });
  assert.equal(bucket.VersioningConfiguration.Status, 'Enabled');
  assert.equal(bucket.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.SSEAlgorithm, 'AES256');
  assert.equal(bucket.OwnershipControls.Rules[0].ObjectOwnership, 'BucketOwnerEnforced');
  assert.equal(bucket.ObjectLockEnabled, true);
  assert.deepEqual(bucket.ObjectLockConfiguration.Rule.DefaultRetention, { Mode: 'GOVERNANCE', Days: 30 });
  assert.equal(bucket.LifecycleConfiguration, undefined, 'Recovery artifacts must not expire automatically');
  const tls = template.Resources.BackupBucketPolicy.Properties.PolicyDocument.Statement;
  assert.equal(tls.length, 1);
  assert.equal(tls[0].Effect, 'Deny');
  assert.equal(tls[0].Principal, '*');
  assert.equal(tls[0].Action, 's3:*');
  assert.deepEqual(tls[0].Resource, [{ 'Fn::GetAtt': ['BackupBucket', 'Arn'] }, { 'Fn::Sub': '${BackupBucket.Arn}/*' }]);
  assert.deepEqual(template.Resources.BackupBucketPolicy.Properties.Bucket, { Ref: 'BackupBucket' });
  assert.deepEqual(tls[0].Condition, { Bool: { 'aws:SecureTransport': 'false' } });
});

test('wrapper pins the stack and owner, propagates check failures and never calls apply during check', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'blog-stack-protection-'));
  try {
    const lib = join(fixture, 'gate-lib.sh');
    writeFileSync(lib, `gate_require_lib() { [ "$1" = 4 ] && [ -z "$STALE_LIB" ]; }
 gate_activate_mise_shims() { :; }
 gate_require_cli() { [ -z "$NO_AWS" ]; }
 gate_check_stack_protection() { echo "check $*"; return "$FAKE_RC"; }
 gate_apply_stack_protection() { echo "apply $*"; return "$FAKE_RC"; }
`);
    const run = (args, rc = 0, extra = {}) => {
      const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
      return spawnSync('bash', ['scripts/protect-stacks.sh', ...args], { encoding: 'utf8', env: { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', DOTAGENTS_GATE_LIB: lib, FAKE_RC: String(rc), STALE_LIB: '', NO_AWS: '', ...extra } });
    };
    for (const rc of [0, 1, 2]) {
      const checked = run(['--check'], rc);
      assert.equal(checked.status, rc);
      assert.equal(checked.stdout, `check ${pairs}\n`);
      assert.equal(checked.stderr.includes('npm run protect:stacks'), rc === 1);
      const applied = run([], rc);
      assert.equal(applied.status, rc);
      assert.equal(applied.stdout, `apply jsolly/awesome-blog ${pairs}\n`);
    }
    for (const extra of [{ DOTAGENTS_GATE_LIB: join(fixture, 'missing') }, { STALE_LIB: '1' }, { NO_AWS: '1' }]) {
      const result = run(['--check'], 0, extra);
      assert.equal(result.status, 2);
      assert.equal(result.stdout, '');
      assert.ok(!result.stderr.includes('npm run protect:stacks'));
    }
    assert.equal(run(['--force']).status, 2);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});

test('protection contracts run locally and in exact-tree PR CI', () => {
  const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
  assert.equal(scripts['protect:stacks'], 'bash scripts/protect-stacks.sh');
  assert.equal(scripts['check:stack-protection'], 'bash scripts/protect-stacks.sh --check');
  assert.match(readFileSync('.git-hooks/pre-commit', 'utf8'), /npm run test:stack-protection/u);
  assert.match(readFileSync('.github/workflows/ci.yml', 'utf8'), /npm run test:stack-protection/u);
});
