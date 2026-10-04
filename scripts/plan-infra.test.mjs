import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import manifest from './infra-inputs.json' with { type: 'json' };
import { planArgs, planEnv, planStack, verifyIdentity } from './plan-infra.mjs';

const [{ stack, template, inputs }] = manifest.stacks;
const body = readFileSync(template, 'utf8');
const readOnlyArn = 'arn:aws:sts::730335616323:assumed-role/agent-readonly/botocore-session-1';
const denied = 'An error occurred (AccessDenied) when calling the CreateChangeSet operation: User: '
  + `${readOnlyArn} is not authorized to perform: cloudformation:CreateChangeSet on resource: `
  + `arn:aws:cloudformation:us-east-1:730335616323:stack/${stack}/* because no identity-based policy allows the cloudformation:CreateChangeSet action`;
const changed = {
  Status: 'CREATE_COMPLETE',
  Changes: [
    {
      Type: 'Resource',
      ResourceChange: {
        Action: 'Modify',
        LogicalResourceId: 'BackupBucket',
        ResourceType: 'AWS::S3::Bucket',
        Replacement: 'False',
        Scope: ['Properties'],
        Details: [{ Target: { Attribute: 'Properties', Name: 'VersioningConfiguration', RequiresRecreation: 'Never' }, Evaluation: 'Static', ChangeSource: 'DirectModification' }],
      },
    },
    { Type: 'Resource', ResourceChange: { Action: 'Add', LogicalResourceId: 'AccessLogBucket', ResourceType: 'AWS::S3::Bucket', Scope: [], Details: [] } },
  ],
};
const directories = [];
test.after(() => { for (const directory of directories) rmSync(directory, { recursive: true, force: true }); });
const scratch = prefix => {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
};

/**
 * A stand-in for the AWS CLI that models one change set: created by create-change-set, listed
 * until delete-change-set removes it. `create` and `remove` replace those two calls and receive
 * the default effect; `pages` are describe-change-set's answers, the last one repeating;
 * `listings` replaces what list-change-sets says.
 */
function fakeAws({ create, remove, pages = [changed], listings } = {}) {
  const calls = [];
  const pauses = [];
  let listed = null;
  let page = 0;
  const aws = async args => {
    calls.push(args);
    assert.equal(args[0], 'cloudformation');
    assert.equal(args[args.indexOf('--stack-name') + 1], stack);
    const land = () => { listed = pages.at(-1).Status; };
    const drop = () => { listed = null; };
    switch (args[1]) {
      case 'create-change-set':
        if (create) return create(land);
        land();
        return { Id: 'arn:aws:cloudformation:us-east-1:730335616323:changeSet/plan/1' };
      case 'describe-change-set': {
        const answer = pages[Math.min(page, pages.length - 1)];
        page += 1;
        return answer;
      }
      case 'list-change-sets':
        return listings ? listings.shift() ?? null : listed;
      case 'delete-change-set':
        if (remove) return remove(drop);
        drop();
        return {};
      default:
        throw new Error(`Unexpected operation ${args[1]}`);
    }
  };
  const plan = (options = {}) => planStack({ stack, body, aws, pause: async ms => { pauses.push(ms); }, ...options });
  return { plan, calls, pauses, operations: () => calls.map(args => args[1]), nameOf: args => args[args.indexOf('--change-set-name') + 1] };
}

test('plans with one UPDATE change set from the committed template, then deletes it', async () => {
  const fake = fakeAws();
  const report = await fake.plan();
  assert.deepEqual(report, {
    stack,
    region: 'us-east-1',
    status: 'changes',
    changes: [
      { logicalId: 'BackupBucket', type: 'AWS::S3::Bucket', action: 'Modify', replacement: 'False', scope: ['Properties'], details: ['Properties.VersioningConfiguration requiresRecreation=Never source=DirectModification'] },
      { logicalId: 'AccessLogBucket', type: 'AWS::S3::Bucket', action: 'Add', replacement: '', scope: [], details: [] },
    ],
  });
  assert.deepEqual(fake.operations(), ['create-change-set', 'describe-change-set', 'list-change-sets', 'delete-change-set', 'list-change-sets']);
  const [created, described, , deleted] = fake.calls;
  const name = fake.nameOf(created);
  assert.match(name, /^plan-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u);
  // The whole request: an UPDATE of this stack from the committed bytes, with nothing else attached.
  assert.deepEqual(created, ['cloudformation', 'create-change-set', '--stack-name', stack, '--change-set-name', name, '--change-set-type', 'UPDATE', '--template-body', body, '--description', 'plan:infra preview; never execute']);
  assert.equal(fake.nameOf(described), name);
  assert.deepEqual(deleted, ['cloudformation', 'delete-change-set', '--stack-name', stack, '--change-set-name', name]);
  assert.equal(fake.calls[2].at(-1), `Summaries[?ChangeSetName=='${name}'].Status | [0]`);
});

test('reports a replacement and what causes it, so the receipt can flag a replaced bucket', async () => {
  // A BucketName edit: the bucket is replaced, and the policy that references it may be.
  const replacing = {
    Status: 'CREATE_COMPLETE',
    Changes: [
      {
        ResourceChange: {
          Action: 'Modify',
          LogicalResourceId: 'BackupBucket',
          ResourceType: 'AWS::S3::Bucket',
          Replacement: 'True',
          Scope: ['Properties'],
          Details: [{ Target: { Attribute: 'Properties', Name: 'BucketName', RequiresRecreation: 'Always' }, Evaluation: 'Static', ChangeSource: 'DirectModification' }],
        },
      },
      {
        ResourceChange: {
          Action: 'Modify',
          LogicalResourceId: 'BackupBucketPolicy',
          ResourceType: 'AWS::S3::BucketPolicy',
          Replacement: 'Conditional',
          Scope: ['Properties'],
          Details: [{ Target: { Attribute: 'Properties', Name: 'Bucket', RequiresRecreation: 'Always' }, Evaluation: 'Dynamic', ChangeSource: 'ResourceReference', CausingEntity: 'BackupBucket' }],
        },
      },
      { ResourceChange: { Action: 'Remove', LogicalResourceId: 'AccessLogBucket', ResourceType: 'AWS::S3::Bucket', Scope: [], Details: [] } },
    ],
  };
  assert.deepEqual((await fakeAws({ pages: [replacing] }).plan()).changes, [
    { logicalId: 'BackupBucket', type: 'AWS::S3::Bucket', action: 'Modify', replacement: 'True', scope: ['Properties'], details: ['Properties.BucketName requiresRecreation=Always source=DirectModification'] },
    { logicalId: 'BackupBucketPolicy', type: 'AWS::S3::BucketPolicy', action: 'Modify', replacement: 'Conditional', scope: ['Properties'], details: ['Properties.Bucket requiresRecreation=Always source=ResourceReference cause=BackupBucket'] },
    { logicalId: 'AccessLogBucket', type: 'AWS::S3::Bucket', action: 'Remove', replacement: '', scope: [], details: [] },
  ]);
});

test('reads an empty change set as no changes and still deletes it', async () => {
  const empties = [
    { Status: 'FAILED', StatusReason: "The submitted information didn't contain changes. Submit different information to create a change set.", Changes: [] },
    { Status: 'FAILED', StatusReason: 'The submitted information didn’t contain changes.', Changes: [] },
    { Status: 'FAILED', StatusReason: 'No updates are to be performed.', Changes: [] },
    { Status: 'CREATE_COMPLETE', Changes: [] },
  ];
  for (const page of empties) {
    const fake = fakeAws({ pages: [page] });
    assert.deepEqual(await fake.plan(), { stack, region: 'us-east-1', status: 'no-changes', changes: [] });
    assert.deepEqual(fake.operations().slice(-2), ['delete-change-set', 'list-change-sets']);
  }
});

test('waits for a change set that is still creating', async () => {
  const fake = fakeAws({ pages: [{ Status: 'CREATE_PENDING' }, { Status: 'CREATE_IN_PROGRESS' }, changed] });
  assert.equal((await fake.plan()).status, 'changes');
  assert.deepEqual(fake.pauses, [2000, 2000]);
});

test('reports an unreadable or malformed change set as an error, never as a clean plan', async () => {
  const modify = change => ({ Status: 'CREATE_COMPLETE', Changes: [{ ResourceChange: { Action: 'Modify', LogicalResourceId: 'BackupBucket', ResourceType: 'AWS::S3::Bucket', Replacement: 'False', ...change } }] });
  const cases = [
    [{ Status: 'FAILED', StatusReason: 'Template format error: Unrecognized resource types: [AWS::S3::Bukket]' }, 'Template format error: Unrecognized resource types: [AWS::S3::Bukket]'],
    [{ Status: 'FAILED' }, 'Change set FAILED without a reason'],
    [{ Status: 'DELETE_FAILED' }, 'Unexpected change-set status DELETE_FAILED'],
    [{}, 'Unexpected change-set status undefined'],
    [[], 'Change-set result is not an object'],
    [{ Status: 'CREATE_COMPLETE' }, 'Change-set result has no Changes list'],
    [{ ...changed, NextToken: 'more' }, 'Change-set result is paginated; refusing a partial plan'],
    [modify({ Replacement: undefined }), 'Invalid replacement result on BackupBucket'],
    [modify({ Replacement: 'Maybe' }), 'Invalid replacement result on BackupBucket'],
    [modify({ Action: 'Rename' }), 'Unknown change action Rename on BackupBucket'],
    [modify({ ResourceType: undefined }), 'BackupBucket ResourceType is missing'],
    [modify({ LogicalResourceId: undefined }), 'LogicalResourceId is missing'],
    [modify({ Scope: 'Properties' }), 'Invalid change scope on BackupBucket'],
    [modify({ Details: {} }), 'Invalid change details on BackupBucket'],
    [{ Status: 'CREATE_COMPLETE', Changes: [{}] }, 'ResourceChange is not an object'],
  ];
  for (const [page, error] of cases) {
    const fake = fakeAws({ pages: [page] });
    assert.deepEqual(await fake.plan(), { stack, region: 'us-east-1', status: 'error', changes: [], error });
    assert.ok(fake.operations().includes('delete-change-set'), `${error}: the change set is still deleted`);
  }
});

test('gives up on a change set that never settles and names what it left behind', async () => {
  const fake = fakeAws({ pages: [{ Status: 'CREATE_IN_PROGRESS' }] });
  const report = await fake.plan();
  const name = fake.nameOf(fake.calls[0]);
  assert.equal(report.status, 'error');
  assert.equal(report.error, `Change set ${name} did not settle; Cleanup failed; inspect change set ${name} on ${stack}`);
  // It cannot be deleted while it is still creating, so nothing tries.
  assert.ok(!fake.operations().includes('delete-change-set'));
  assert.equal(fake.operations().filter(operation => operation === 'describe-change-set').length, 151);
});

test('reports a denied create once: no retry, no delete, and no change set to clean up', async () => {
  const fake = fakeAws({ create: () => { throw new Error(denied); } });
  assert.deepEqual(await fake.plan(), { stack, region: 'us-east-1', status: 'error', changes: [], error: denied });
  assert.deepEqual(fake.operations(), ['create-change-set', 'list-change-sets']);
});

test('deletes a change set whose create failed after it landed', async () => {
  const fake = fakeAws({ create: land => { land(); throw new Error('aws cloudformation create-change-set failed'); } });
  assert.deepEqual(await fake.plan(), { stack, region: 'us-east-1', status: 'error', changes: [], error: 'aws cloudformation create-change-set failed' });
  assert.deepEqual(fake.operations(), ['create-change-set', 'list-change-sets', 'delete-change-set', 'list-change-sets']);
});

test('fails the plan when the change set cannot be confirmed deleted', async () => {
  const refused = 'An error occurred (AccessDenied) when calling the DeleteChangeSet operation';
  const stuck = fakeAws({ remove: () => { throw new Error(refused); } });
  const report = await stuck.plan();
  const name = stuck.nameOf(stuck.calls[0]);
  // The read succeeded, but a preview left on the stack is an error row that says where to look.
  assert.equal(report.status, 'error');
  assert.equal(report.error, `Cleanup failed; inspect change set ${name} on ${stack}: ${refused}`);
  assert.equal(report.changes.length, 2);
  assert.equal(stuck.operations().filter(operation => operation === 'delete-change-set').length, 3);

  // Without the listing there is no proof either way, so that is a failure too.
  const throttled = 'An error occurred (Throttling) when calling the ListChangeSets operation';
  const unlisted = await planStack({
    stack,
    body,
    pause: async () => {},
    aws: async args => {
      if (args[1] === 'list-change-sets') throw new Error(throttled);
      return args[1] === 'describe-change-set' ? changed : {};
    },
  });
  assert.equal(unlisted.status, 'error');
  assert.match(unlisted.error, /^Cleanup failed; inspect change set plan-[0-9a-f-]{36} on /u);
  assert.ok(unlisted.error.endsWith(`on ${stack}: ${throttled}`));
});

test('waits out an in-flight delete before calling the change set gone', async () => {
  const fake = fakeAws({ listings: ['CREATE_COMPLETE', 'DELETE_IN_PROGRESS', 'DELETE_COMPLETE'] });
  assert.equal((await fake.plan()).status, 'changes');
  assert.deepEqual(fake.operations().slice(2), ['list-change-sets', 'delete-change-set', 'list-change-sets', 'list-change-sets']);
  assert.deepEqual(fake.pauses, [2000]);
});

test('stops before creating anything when interrupted or when the template cannot go inline', async () => {
  const interrupted = fakeAws();
  assert.equal((await interrupted.plan({ interrupted: () => true })).error, 'Interrupted before change-set creation');
  assert.deepEqual(interrupted.calls, []);

  const oversized = fakeAws();
  assert.equal((await oversized.plan({ body: 'x'.repeat(51201) })).error, 'Template exceeds the inline limit; no upload performed');
  assert.deepEqual(oversized.calls, []);
});

test('an interrupt while polling still deletes the change set', async () => {
  let polls = 0;
  const fake = fakeAws({ pages: [{ Status: 'CREATE_IN_PROGRESS' }, changed] });
  const report = await fake.plan({ interrupted: () => { polls += 1; return polls > 2; } });
  assert.equal(report.error, 'Interrupted; removing the preview change set');
  assert.deepEqual(fake.operations().slice(-3), ['list-change-sets', 'delete-change-set', 'list-change-sets']);
});

test('only the fleet read-only role in the fleet account may plan', () => {
  assert.doesNotThrow(() => verifyIdentity({ Account: '730335616323', Arn: readOnlyArn }));
  for (const identity of [
    { Account: '730335616323', Arn: 'arn:aws:sts::730335616323:assumed-role/AWSReservedSSO_AdministratorAccess_0123456789abcdef/john' },
    { Account: '730335616323', Arn: 'arn:aws:sts::730335616323:assumed-role/agent-readonly/session/extra' },
    { Account: '730335616323', Arn: 'arn:aws:iam::730335616323:role/agent-readonly' },
    { Account: '111111111111', Arn: 'arn:aws:sts::111111111111:assumed-role/agent-readonly/session' },
    { Account: '111111111111', Arn: readOnlyArn },
    { Account: '730335616323' },
    null,
  ]) assert.throws(() => verifyIdentity(identity), /agent-readonly role|not an object/u);
});

test('accepts --json and --out <file> in either order and rejects everything else', () => {
  assert.deepEqual(planArgs([]), { out: undefined });
  assert.deepEqual(planArgs(['--json']), { out: undefined });
  assert.deepEqual(planArgs(['--json', '--out', '/tmp/plan.json']), { out: '/tmp/plan.json' });
  assert.deepEqual(planArgs(['--out', '/tmp/plan.json', '--json']), { out: '/tmp/plan.json' });
  for (const argv of [['--out'], ['--out', '--json'], ['--execute'], ['plan.json']]) {
    assert.throws(() => planArgs(argv), /Usage: npm run plan:infra -- \[--json\] \[--out <file>\]/u);
  }
});

test('plans as agent-readonly, drops static credentials, and keeps a caller-supplied config', () => {
  const emptyHome = scratch('plan-infra-home-');
  const base = { PATH: '/usr/bin', AWS_PROFILE: 'default', AWS_ACCESS_KEY_ID: 'static-key', AWS_SECRET_ACCESS_KEY: 'static-secret', AWS_SESSION_TOKEN: 'static-token', AWS_SECURITY_TOKEN: 'static-token' };
  assert.deepEqual(planEnv(base, emptyHome), { PATH: '/usr/bin', AWS_PROFILE: 'agent-readonly', AWS_PAGER: '', AWS_DEFAULT_REGION: 'us-east-1' });

  const laptopHome = scratch('plan-infra-home-');
  mkdirSync(join(laptopHome, '.aws'));
  const agentConfig = join(laptopHome, '.aws', 'agent-config');
  writeFileSync(agentConfig, '[profile agent-readonly]\n');
  assert.equal(planEnv({}, laptopHome).AWS_CONFIG_FILE, agentConfig);
  // gate_with_readonly_aws's minted config, or a Cloud Agent VM's own, wins over the laptop file.
  assert.equal(planEnv({ AWS_CONFIG_FILE: '/minted/config' }, laptopHome).AWS_CONFIG_FILE, '/minted/config');
});

/** A fake `aws` on PATH for the real command: it records each call and what credentials it saw. */
function command({ scenario = 'changes', args = ['--json'], env = {}, entry = 'scripts/plan-infra.mjs' } = {}) {
  const directory = scratch('plan-infra-cli-');
  const bin = join(directory, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'aws'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const dir = ${JSON.stringify(directory)};
const seen = name => process.env[name] ?? null;
fs.appendFileSync(dir + '/calls.jsonl', JSON.stringify({ args, profile: seen('AWS_PROFILE'), config: seen('AWS_CONFIG_FILE'), key: seen('AWS_ACCESS_KEY_ID') }) + '\\n');
const scenario = ${JSON.stringify(scenario)};
const live = dir + '/change-set';
const say = value => process.stdout.write(JSON.stringify(value) + '\\n');
if (args.slice(-4).join(' ') !== '--region us-east-1 --output json') process.exit(96);
if (args[0] === 'sts' && args[1] === 'get-caller-identity') {
  say({ Account: '730335616323', Arn: scenario === 'admin' ? 'arn:aws:sts::730335616323:assumed-role/admin/john' : ${JSON.stringify(readOnlyArn)} });
} else if (args[1] === 'create-change-set') {
  if (scenario === 'denied') { process.stderr.write('\\n' + ${JSON.stringify(denied)} + '\\n'); process.exit(254); }
  fs.writeFileSync(live, 'CREATE_COMPLETE');
  // The change set exists; now the plan itself, this stub's parent, is told to stop.
  if (scenario === 'terminated') process.kill(process.ppid, 'SIGTERM');
  say({ Id: 'arn:aws:cloudformation:us-east-1:730335616323:changeSet/plan/1' });
} else if (args[1] === 'describe-change-set') {
  // Never settling keeps a terminated plan polling until it notices the signal.
  say(scenario === 'terminated' ? { Status: 'CREATE_IN_PROGRESS' } : ${JSON.stringify(changed)});
} else if (args[1] === 'list-change-sets') {
  say(fs.existsSync(live) ? fs.readFileSync(live, 'utf8') : null);
} else if (args[1] === 'delete-change-set') {
  fs.rmSync(live);
} else {
  process.exit(97);
}
`);
  chmodSync(join(bin, 'aws'), 0o755);
  const home = join(directory, 'home');
  mkdirSync(home);
  const result = spawnSync(process.execPath, [entry, ...args], {
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, AWS_PROFILE: 'someone-else', AWS_ACCESS_KEY_ID: 'static-key', AWS_SECRET_ACCESS_KEY: 'static-secret', ...env },
  });
  const calls = existsSync(join(directory, 'calls.jsonl'))
    ? readFileSync(join(directory, 'calls.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
    : [];
  return { ...result, directory, calls, operations: calls.map(call => call.args[1]) };
}

test('the command writes exactly one receipt object to --out and nothing to stdout', () => {
  const directory = scratch('plan-infra-out-');
  const out = join(directory, 'receipt.json');
  writeFileSync(out, '');
  const result = command({ args: ['--json', '--out', out], env: { AWS_CONFIG_FILE: '/minted/config' } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  const receipt = JSON.parse(readFileSync(out, 'utf8'));
  assert.deepEqual(Object.keys(receipt), ['stack', 'region', 'status', 'changes']);
  assert.deepEqual([receipt.stack, receipt.region, receipt.status], [stack, 'us-east-1', 'changes']);
  for (const change of receipt.changes) {
    assert.deepEqual(Object.keys(change), ['logicalId', 'type', 'action', 'replacement', 'scope', 'details']);
  }
  // Every AWS call ran as agent-readonly with the caller's config and no static credentials.
  assert.ok(result.calls.length > 0);
  for (const call of result.calls) assert.deepEqual([call.profile, call.config, call.key], ['agent-readonly', '/minted/config', null]);
  // Nothing but the identity read and the change set's create, read, list and delete.
  assert.deepEqual(result.operations, ['get-caller-identity', 'create-change-set', 'describe-change-set', 'list-change-sets', 'delete-change-set', 'list-change-sets']);
  assert.equal(result.calls[1].args[result.calls[1].args.indexOf('--template-body') + 1], body);
  assert.ok(!existsSync(join(result.directory, 'change-set')), 'the change set is gone');
});

test('the command prints the receipt on stdout without --out', () => {
  const result = command();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'changes');
});

test('the command still plans when it is started through a symlinked path', () => {
  // Node names the main module by its real path; a mismatch would exit 0 having planned nothing.
  const link = join(scratch('plan-infra-link-'), 'scripts');
  symlinkSync(resolve('scripts'), link);
  const result = command({ entry: join(link, 'plan-infra.mjs') });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'changes');
});

test('the command exits 1 with an error receipt when the create is denied, without retrying', () => {
  const directory = scratch('plan-infra-out-');
  const out = join(directory, 'receipt.json');
  const result = command({ scenario: 'denied', args: ['--json', '--out', out] });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), { stack, region: 'us-east-1', status: 'error', changes: [], error: denied });
  assert.deepEqual(result.operations, ['get-caller-identity', 'create-change-set', 'list-change-sets']);
});

test('the command deletes its change set when it is terminated mid-plan', () => {
  const directory = scratch('plan-infra-out-');
  const out = join(directory, 'receipt.json');
  const result = command({ scenario: 'terminated', args: ['--json', '--out', out] });
  // SIGTERM is handled, not fatal: the run ends on its own, with a receipt and no change set left.
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).error, 'Interrupted; removing the preview change set');
  assert.deepEqual(result.operations.slice(-3), ['list-change-sets', 'delete-change-set', 'list-change-sets']);
  assert.ok(!existsSync(join(result.directory, 'change-set')), 'the change set is gone');
});

test('the command refuses any identity but agent-readonly before touching the stack', () => {
  const result = command({ scenario: 'admin' });
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout), { stack, region: 'us-east-1', status: 'error', changes: [], error: 'Planning requires the fleet agent-readonly role' });
  assert.deepEqual(result.operations, ['get-caller-identity']);
});

test('the command fails loudly on a bad argument or an unwritable receipt path', () => {
  const usage = command({ args: ['--execute'] });
  assert.equal(usage.status, 1);
  assert.equal(JSON.parse(usage.stdout).error, 'Usage: npm run plan:infra -- [--json] [--out <file>]');
  assert.deepEqual(usage.calls, []);

  const unwritable = command({ args: ['--json', '--out', join(scratch('plan-infra-out-'), 'missing', 'receipt.json')] });
  assert.equal(unwritable.status, 1);
  assert.equal(JSON.parse(unwritable.stdout).status, 'changes');
  assert.match(unwritable.stderr, /cannot write the --out receipt/u);
});

test('the manifest names one stack whose template fleet discovery finds', () => {
  // plan:infra and check:infra-drift read the first entry; a second stack needs an aggregated report.
  assert.equal(manifest.stacks.length, 1);
  assert.deepEqual(Object.keys(manifest.stacks[0]), ['stack', 'command', 'template', 'inputs']);
  assert.ok(inputs.includes(template));
  assert.match(template, /^aws\/(?:.+\/)?template\.(?:json|ya?ml)$/u);
  const parsed = JSON.parse(body);
  assert.equal(parsed.AWSTemplateFormatVersion, '2010-09-09');
  // The plan sends no --parameters and no --capabilities, and neither does aws/migration-backups/deploy.sh.
  // A template that needs either must teach both, or the preview and the deploy stop agreeing.
  assert.equal(parsed.Parameters, undefined, 'scripts/plan-infra.mjs and aws/migration-backups/deploy.sh pass no parameters');
  for (const [id, resource] of Object.entries(parsed.Resources)) {
    assert.ok(!resource.Type.startsWith('AWS::IAM::'), `${id}: scripts/plan-infra.mjs and aws/migration-backups/deploy.sh pass no IAM capability`);
  }
});

test('the infra scripts are wired at the package root, in the gate, and in CI', () => {
  const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
  assert.equal(scripts['plan:infra'], 'node scripts/plan-infra.mjs');
  assert.equal(scripts['check:infra-drift'], 'node scripts/check-infra-drift.mjs');
  assert.equal(scripts['deploy:infra'], 'bash aws/migration-backups/deploy.sh');
  assert.equal(scripts[manifest.stacks[0].command.replace('npm run ', '')], scripts['deploy:infra']);
  assert.match(readFileSync('.git-hooks/pre-commit', 'utf8'), /npm run test:infra/u);
  assert.match(readFileSync('.github/workflows/ci.yml', 'utf8'), /npm run test:infra/u);
});
