import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import manifest from './infra-inputs.json' with { type: 'json' };

const SCRIPT = resolve('scripts/check-infra-drift.mjs');
const [{ stack, command, inputs }] = manifest.stacks;
const [TEMPLATE, DEPLOY] = inputs;
const QUERY = "Stacks[0].[StackStatus, Tags[?Key=='InfraDeployCommit'].Value|[0]]";

const directories = [];
test.after(() => { for (const directory of directories) rmSync(directory, { recursive: true, force: true }); });
const scratch = prefix => {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
};

/**
 * A fixture-owned global git config that turns off auto-maintenance: commit and receive-pack
 * otherwise spawn a detached `git maintenance run --auto` that can repack a fixture repo under the
 * next read (dotagents rules/testing.md, Git-fixture hermeticity).
 */
const FIXTURE_GIT_CONFIG = join(scratch('infra-drift-gitconfig-'), 'gitconfig');
writeFileSync(FIXTURE_GIT_CONFIG, '[maintenance]\n\tauto = false\n');

/** Built from nothing: the gate runs these under git, whose GIT_* variables would redirect the fixtures. */
const HERMETIC = {
  PATH: process.env.PATH ?? '/usr/bin:/bin',
  // A HOME without ~/.aws/agent-config unless a test adds one.
  HOME: scratch('infra-drift-home-'),
  GIT_CONFIG_GLOBAL: FIXTURE_GIT_CONFIG,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.com',
};

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: HERMETIC });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

/** A clone whose origin main holds every infra input plus an app file. */
function fixture() {
  const root = scratch('infra-drift-test-');
  const origin = join(root, 'origin.git');
  const work = join(root, 'work');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'init', '-q', '-b', 'main', work);
  git(work, 'remote', 'add', 'origin', origin);
  const commitIn = (directory, paths, label) => {
    for (const file of paths) {
      mkdirSync(dirname(join(directory, file)), { recursive: true });
      writeFileSync(join(directory, file), `${label}\n`);
    }
    git(directory, 'add', '-A');
    git(directory, 'commit', '-q', '--allow-empty', '-m', label);
    git(directory, 'push', '-q', 'origin', 'HEAD:main');
    return git(directory, 'rev-parse', 'HEAD');
  };
  return {
    work,
    base: commitIn(work, [...inputs, 'src/pages/index.astro'], 'base'),
    /** Commits `paths` with fresh content and pushes it to origin main. */
    land: (paths, label) => commitIn(work, paths, label),
    /** Lands a commit from a second clone; `work` never fetches it. */
    landElsewhere: paths => {
      const other = join(root, 'other');
      git(root, 'clone', '-q', origin, other);
      return commitIn(other, paths, 'elsewhere');
    },
  };
}

/**
 * Runs the command in `work` with a stub aws answering the one describe-stacks read. `live` is the
 * stack's `{status?, tag?}`, `{raw}` to replace the CLI's JSON answer, or 'AccessDenied'.
 */
function run(work, live, flags = ['--json'], env = {}) {
  const bin = scratch('infra-drift-aws-');
  writeFileSync(join(bin, 'aws'), `#!${process.execPath}
const args = process.argv.slice(2);
const arg = flag => args[args.indexOf(flag) + 1];
if (args[0] !== 'cloudformation' || args[1] !== 'describe-stacks' || arg('--region') !== 'us-east-1' ||
    arg('--stack-name') !== ${JSON.stringify(stack)} || arg('--query') !== ${JSON.stringify(QUERY)} || arg('--output') !== 'json') process.exit(2);
if ((process.env.AWS_PROFILE ?? '') !== (process.env.EXPECT_PROFILE ?? 'agent-readonly')) process.exit(3);
if (process.env.AWS_MAX_ATTEMPTS !== '1') process.exit(4);
if ((process.env.AWS_CONFIG_FILE ?? '') !== (process.env.EXPECT_CONFIG ?? '')) process.exit(5);
const live = ${JSON.stringify(live)};
if (live === 'AccessDenied') { process.stderr.write('An error occurred (AccessDenied) when calling the DescribeStacks operation'); process.exit(254); }
process.stdout.write((live.raw ?? JSON.stringify([live.status ?? 'UPDATE_COMPLETE', live.tag ?? null])) + '\\n');
`);
  chmodSync(join(bin, 'aws'), 0o755);
  const result = spawnSync(process.execPath, [SCRIPT, ...flags], { cwd: work, encoding: 'utf8', env: { ...HERMETIC, PATH: `${bin}:${HERMETIC.PATH}`, ...env } });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, receipt: () => JSON.parse(result.stdout) };
}

/** A commit on a local side branch that never reaches origin's main. */
function offMain(f) {
  git(f.work, 'checkout', '-q', '-b', 'side');
  git(f.work, 'commit', '-q', '--allow-empty', '-m', 'side');
  const side = git(f.work, 'rev-parse', 'HEAD');
  git(f.work, 'checkout', '-q', 'main');
  return side;
}

test('is clean when the tag carries main\'s infra and later merges touch only code', () => {
  const f = fixture();
  f.land(['src/pages/index.astro'], 'code only');
  const result = run(f.work, { tag: f.base });
  assert.equal(result.status, 0, result.stderr);
  // stdout is exactly the one receipt object.
  assert.equal(result.stdout, `${JSON.stringify({ status: 'clean', deployed: f.base, latest: f.base, changed: [], reason: "InfraDeployCommit matches main's infra inputs" })}\n`);
});

test('stays pending after a code-only merge lands on top of an unapplied template merge', () => {
  // Merge A changes the template, merge B only code: B's own diff is clean, the tag is not.
  const f = fixture();
  const templateMerge = f.land([TEMPLATE, 'src/pages/index.astro'], 'A');
  f.land(['src/pages/index.astro'], 'B');
  const strict = run(f.work, { tag: f.base });
  assert.equal(strict.status, 1);
  assert.deepEqual(strict.receipt(), { status: 'pending', deployed: f.base, latest: templateMerge, changed: [TEMPLATE], reason: `infra inputs changed since InfraDeployCommit: ${TEMPLATE}` });

  const warn = run(f.work, { tag: f.base }, ['--json', '--warn-only']);
  assert.equal(warn.status, 0);
  assert.equal(warn.receipt().status, 'pending');
});

test('counts every manifest input, the deploy script included', () => {
  for (const input of inputs) {
    const f = fixture();
    f.land([input], `touch ${input}`);
    assert.deepEqual(run(f.work, { tag: f.base }).receipt().changed, [input]);
  }
});

test('is clean when an infra change was reverted before deploy:infra', () => {
  const f = fixture();
  f.land([TEMPLATE], 'change');
  git(f.work, 'revert', '--no-edit', 'HEAD');
  git(f.work, 'push', '-q', 'origin', 'HEAD:main');
  assert.equal(run(f.work, { tag: f.base }).receipt().status, 'clean');
});

test('is pending, with deploy:infra as the fix, for a stack that carries no usable tag', () => {
  const cases = [
    ['no tag', () => undefined, 'no InfraDeployCommit tag; npm run deploy:infra stamps it'],
    ['a short SHA', f => f.base.slice(0, 12), 'is not a commit SHA'],
    ['an uppercase SHA', f => f.base.toUpperCase(), 'is not a commit SHA'],
    ['a SHA with trailing text', f => `${f.base} extra`, 'is not a commit SHA'],
    ['a literal None', () => 'None', 'is not a commit SHA'],
    ['a commit off main', offMain, "is not on origin's main"],
  ];
  for (const [label, tagFor, reason] of cases) {
    const f = fixture();
    const tag = tagFor(f);
    const result = run(f.work, tag === undefined ? {} : { tag });
    assert.equal(result.status, 1, label);
    const receipt = result.receipt();
    assert.equal(receipt.status, 'pending', label);
    assert.ok(receipt.reason.includes(reason), `${label}: ${receipt.reason}`);
    assert.equal(receipt.latest, f.base, label);
    // Only a tag that names a real commit is reported as what is deployed.
    assert.equal(receipt.deployed, label === 'a commit off main' ? tag : undefined, label);
  }
});

test('errors, never clean or pending, when it cannot decide', () => {
  const cases = [
    ['a tag this clone lacks', { tag: 'a'.repeat(40) }, 'is not in this clone; git fetch origin'],
    ['a stack mid-update', { status: 'UPDATE_IN_PROGRESS' }, 'stack is UPDATE_IN_PROGRESS'],
    ['a failed rollback', { status: 'UPDATE_ROLLBACK_FAILED' }, 'stack is UPDATE_ROLLBACK_FAILED'],
    ['a rolled-back deploy:infra', { status: 'UPDATE_ROLLBACK_COMPLETE' }, 'stack is UPDATE_ROLLBACK_COMPLETE: wait out an in-progress deploy:infra, or rerun a failed or rolled-back one'],
    ['an empty answer', { raw: '[]' }, 'unexpected describe-stacks output'],
    ['a bare string', { raw: '"UPDATE_COMPLETE"' }, 'unexpected describe-stacks output'],
    ['a non-string tag', { raw: '["UPDATE_COMPLETE", 7]' }, 'unexpected describe-stacks output'],
    ['output that is not JSON', { raw: 'UPDATE_COMPLETE' }, 'is not valid JSON'],
    ['a denied stack read', 'AccessDenied', 'aws cloudformation failed: An error occurred (AccessDenied)'],
  ];
  for (const [label, live, reason] of cases) {
    const f = fixture();
    const result = run(f.work, live === 'AccessDenied' ? live : { tag: f.base, ...live });
    assert.equal(result.status, 1, label);
    const receipt = result.receipt();
    assert.deepEqual(Object.keys(receipt), ['status', 'error'], label);
    assert.equal(receipt.status, 'error', label);
    assert.ok(receipt.error.includes(reason), `${label}: ${receipt.error}`);
  }
});

test('treats a created and an updated stack as settled', () => {
  for (const status of ['CREATE_COMPLETE', 'UPDATE_COMPLETE']) {
    const f = fixture();
    assert.equal(run(f.work, { tag: f.base, status }).receipt().status, 'clean');
  }
});

test('errors when an infra input no longer exists at main\'s tip', () => {
  const f = fixture();
  git(f.work, 'rm', '-q', DEPLOY);
  f.land([], 'move the deploy script');
  const receipt = run(f.work, { tag: f.base }).receipt();
  assert.equal(receipt.status, 'error');
  assert.equal(receipt.error, `infra inputs missing at main's tip: ${DEPLOY} (scripts/infra-inputs.json)`);
});

test('errors when origin\'s main moved past this clone instead of reporting a stale clean', () => {
  const f = fixture();
  const moved = f.landElsewhere([TEMPLATE]);
  const result = run(f.work, { tag: f.base }, ['--json', '--warn-only']);
  // --warn-only never fails the caller; the receipt still says error.
  assert.equal(result.status, 0);
  assert.deepEqual(result.receipt(), { status: 'error', error: `origin's main tip ${moved} is not in this clone; git fetch origin` });
});

test('errors when this checkout\'s input list differs from main\'s', () => {
  const f = fixture();
  f.land(['scripts/infra-inputs.json'], 'main adds an input');
  git(f.work, 'checkout', '-q', '--detach', 'HEAD~1');
  assert.deepEqual(run(f.work, { tag: f.base }).receipt(), { status: 'error', error: "scripts/infra-inputs.json differs from main's tip; check from an up-to-date main" });
});

test('errors when origin is unreachable or a flag is unknown', () => {
  const unreachable = fixture();
  git(unreachable.work, 'remote', 'set-url', 'origin', join(unreachable.work, 'missing.git'));
  const offline = run(unreachable.work, { tag: unreachable.base });
  assert.equal(offline.status, 1);
  assert.ok(offline.receipt().error.startsWith('git ls-remote failed'), offline.receipt().error);

  const f = fixture();
  const flagged = run(f.work, { tag: f.base }, ['--json', '--fix']);
  assert.equal(flagged.status, 1);
  assert.deepEqual(flagged.receipt(), { status: 'error', error: 'Unknown argument: --fix' });
});

test('reads as agent-readonly unless the caller already chose credentials', () => {
  const f = fixture();
  const live = { tag: f.base };
  const clean = (env, label) => assert.equal(run(f.work, live, ['--json'], env).receipt().status, 'clean', label);
  clean({}, 'the default');
  clean({ AWS_PROFILE: 'someone-else', EXPECT_PROFILE: 'someone-else' }, 'a named profile');
  // CI-style environment credentials: forcing a named profile would break them.
  clean({ AWS_ACCESS_KEY_ID: 'static-key', EXPECT_PROFILE: '' }, 'environment credentials');

  const home = scratch('infra-drift-agent-home-');
  mkdirSync(join(home, '.aws'));
  const agentConfig = join(home, '.aws', 'agent-config');
  writeFileSync(agentConfig, '[profile agent-readonly]\n');
  clean({ HOME: home, EXPECT_CONFIG: agentConfig }, 'the laptop agent config');
  // Supplying the default also supplies agent-config over a caller config, as gate-lib does.
  clean({ HOME: home, EXPECT_CONFIG: agentConfig, AWS_CONFIG_FILE: '/alt/config' }, 'agent config over a caller config');
  // A caller that chose credentials keeps its own config.
  clean({ HOME: home, AWS_PROFILE: 'someone-else', EXPECT_PROFILE: 'someone-else' }, 'a chosen profile on the laptop');
  // gate_with_readonly_aws and a Cloud Agent VM export both: they pass through untouched.
  clean({ HOME: home, AWS_PROFILE: 'agent-readonly', AWS_CONFIG_FILE: '/minted/config', EXPECT_CONFIG: '/minted/config' }, 'a minted config');
});

test('without --json it prints the ordered hand-off, and --warn-only keeps the exit at 0', () => {
  const f = fixture();
  f.land([DEPLOY], 'deploy script');
  const pending = run(f.work, { tag: f.base }, ['--warn-only']);
  assert.equal(pending.status, 0);
  assert.equal(pending.stdout, '');
  assert.equal(pending.stderr, [
    `deploy:infra pending: infra inputs changed since InfraDeployCommit: ${DEPLOY}`,
    '  John, after reviewing:',
    '  1. cd /Users/johnsolly/code/awesome-blog && git switch main && git pull --ff-only && npm run plan:infra -- --json',
    `  2. after reviewing that plan, in a terminal holding administrator credentials: cd /Users/johnsolly/code/awesome-blog && ${command}`,
    '',
  ].join('\n'));
  assert.equal(run(f.work, { tag: f.base }, []).status, 1);

  const clean = fixture();
  const quiet = run(clean.work, { tag: clean.base }, []);
  assert.equal(quiet.status, 0);
  assert.equal(quiet.stdout, "infra clean: InfraDeployCommit matches main's infra inputs\n");

  const undecided = run(clean.work, { status: 'UPDATE_IN_PROGRESS' }, []);
  assert.equal(undecided.status, 1);
  assert.match(undecided.stderr, /^check:infra-drift could not decide: stack is UPDATE_IN_PROGRESS/u);
});

test('.gitattributes marks exactly the manifest inputs for the pre-commit reminder', () => {
  // Read from the working tree, not a hook's index, so an input not yet staged still counts.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
  const attrs = spawnSync('git', ['check-attr', 'infra-input', '--', ...inputs], { encoding: 'utf8', env });
  assert.equal(attrs.status, 0, attrs.stderr);
  assert.deepEqual(attrs.stdout.trim().split('\n'), inputs.map(input => `${input}: infra-input: set`));
  // And no other tracked path carries it.
  const marked = spawnSync('git', ['ls-files', ':(attr:infra-input)'], { encoding: 'utf8', env });
  assert.equal(marked.status, 0, marked.stderr);
  assert.deepEqual(marked.stdout.trim().split('\n').filter(path => !inputs.includes(path)), []);
});
