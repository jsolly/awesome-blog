/**
 * npm run check:infra-drift: is merged infrastructure live?
 *
 * `npm run deploy:infra` applies only origin's landed main tip and tags the stack
 * InfraDeployCommit=<that commit>. This compares the tag with origin's main: the stack is clean
 * when the tagged commit is an ancestor of main's tip and no infra input
 * (scripts/infra-inputs.json) differs between the two. Otherwise deploy:infra is pending.
 *
 * Read-only: `git ls-remote` for main's live tip (no fetch), local history, and one
 * `aws cloudformation describe-stacks` (agent-readonly unless the caller chose credentials). It
 * fails closed: an unreadable or unsettled stack, an input missing at main's tip, a commit this
 * clone lacks, or any git failure or timeout is an error, never clean. The `--json` object is the
 * fleet receipt `{status, deployed?, latest?, error?}` (dotagents
 * skills/optimize-workspaces/references/infra-plan.md).
 *
 * Usage: npm run check:infra-drift -- [--json] [--warn-only]
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AGENT_AWS_CONFIG, AGENT_ROLE, REGION } from './constants.mjs';
import manifest from './infra-inputs.json' with { type: 'json' };

const TAG = 'InfraDeployCommit';
const MANIFEST = 'scripts/infra-inputs.json';
/** John's laptop checkout, where the hand-off commands run. */
const CHECKOUT = '/Users/johnsolly/code/awesome-blog';
/**
 * Stack states whose tags describe applied infra. A rolled-back update is not one: whether the
 * rollback restored the old tag is not something to bet on, and the failed deploy:infra must be
 * rerun anyway.
 */
const SETTLED = new Set(['CREATE_COMPLETE', 'UPDATE_COMPLETE']);
// One stack; scripts/plan-infra.test.mjs pins the count.
const [{ stack: STACK, command: COMMAND, inputs: INPUTS }] = manifest.stacks;

const isSha = value => /^[0-9a-f]{40}$/u.test(value);
const message = error => (error instanceof Error ? error.message.trim() : String(error));

/** Runs a command; any exit status outside `ok` is a failure, never a quiet answer. */
function exec(cmd, args, ok = [0], env = process.env) {
  // Bounded: a credential prompt or a network stall must fail the check, not hang its caller.
  const result = spawnSync(cmd, args, { encoding: 'utf8', env, timeout: 10_000 });
  if (result.status === null || !ok.includes(result.status)) {
    throw new Error(`${cmd} ${args[0]} failed: ${(result.stderr || String(result.error)).trim()}`);
  }
  return { status: result.status, stdout: result.stdout.trim() };
}

const git = (...args) => exec('git', args).stdout;
/** git's yes/no probes exit 0 or 1; anything else throws. */
const gitProbe = (...args) => exec('git', args, [0, 1]).status === 0;
const hasCommit = sha => gitProbe('rev-parse', '--quiet', '--verify', `${sha}^{commit}`);

/** origin's live main tip, which this clone must already hold. */
function mainTip() {
  const tip = git('ls-remote', 'origin', 'refs/heads/main')
    .split('\n')
    .map(line => line.split('\t'))
    .find(([, ref]) => ref === 'refs/heads/main')?.[0];
  if (!tip || !isSha(tip)) throw new Error("cannot read origin's main tip");
  if (!hasCommit(tip)) throw new Error(`origin's main tip ${tip} is not in this clone; git fetch origin`);
  return tip;
}

/**
 * One attempt, and agent-readonly unless the caller already chose credentials. Supplying that
 * default also supplies ~/.aws/agent-config when it exists, over any caller AWS_CONFIG_FILE, as
 * dotagents gate-lib's gate__check_one_stack does.
 */
function awsEnv() {
  const env = { ...process.env, AWS_MAX_ATTEMPTS: '1', AWS_PAGER: '' };
  const chosen = ['AWS_PROFILE', 'AWS_ACCESS_KEY_ID', 'AWS_WEB_IDENTITY_TOKEN_FILE', 'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI', 'AWS_CONTAINER_CREDENTIALS_FULL_URI']
    .some(key => env[key]);
  if (chosen) return env;
  const agentConfig = join(homedir(), AGENT_AWS_CONFIG);
  return { ...env, AWS_PROFILE: AGENT_ROLE, ...(existsSync(agentConfig) ? { AWS_CONFIG_FILE: agentConfig } : {}) };
}

function readStack() {
  const out = exec('aws', [
    'cloudformation', 'describe-stacks',
    '--region', REGION,
    '--stack-name', STACK,
    '--query', `Stacks[0].[StackStatus, Tags[?Key=='${TAG}'].Value|[0]]`,
    '--output', 'json',
  ], [0], awsEnv()).stdout;
  const parsed = JSON.parse(out);
  if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== 'string' || (parsed[1] !== null && typeof parsed[1] !== 'string')) {
    throw new Error(`unexpected describe-stacks output: ${out}`);
  }
  return { stackStatus: parsed[0], tag: parsed[1] };
}

/** Throws when the check cannot decide; the caller reports that as an error. */
function checkStack(tip) {
  // A moved input would otherwise diff empty forever and read clean.
  const present = new Set(git('ls-tree', '--name-only', tip, '--', ...INPUTS).split('\n'));
  const missing = INPUTS.filter(input => !present.has(input));
  if (missing.length > 0) throw new Error(`infra inputs missing at main's tip: ${missing.join(', ')} (${MANIFEST})`);
  /** Newest main commit that touched an infra input. */
  const latest = git('log', '-1', '--format=%H', tip, '--', ...INPUTS);
  const { stackStatus, tag } = readStack();
  if (!SETTLED.has(stackStatus)) {
    throw new Error(`stack is ${stackStatus}: wait out an in-progress deploy:infra, or rerun a failed or rolled-back one`);
  }
  const pending = (reason, deployed, changed = []) => ({ status: 'pending', deployed, latest, changed, reason });
  if (tag === null) return pending(`no ${TAG} tag; ${COMMAND} stamps it`);
  if (!isSha(tag)) return pending(`${TAG} ${tag} is not a commit SHA`);
  if (!hasCommit(tag)) throw new Error(`${TAG} ${tag} is not in this clone; git fetch origin`);
  if (!gitProbe('merge-base', '--is-ancestor', tag, tip)) return pending(`${TAG} ${tag} is not on origin's main`, tag);
  // Inputs are paths, not pathspecs.
  const changed = git('--literal-pathspecs', 'diff', '--name-only', tag, tip, '--', ...INPUTS).split('\n').filter(Boolean);
  return changed.length > 0
    ? pending(`infra inputs changed since ${TAG}: ${changed.join(', ')}`, tag, changed)
    : { status: 'clean', deployed: tag, latest, changed, reason: `${TAG} matches main's infra inputs` };
}

function decide(argv) {
  try {
    const unknown = argv.find(arg => arg !== '--json' && arg !== '--warn-only');
    if (unknown) throw new Error(`Unknown argument: ${unknown}`);
    const tip = mainTip();
    // The input list is this checkout's; an older one would miss inputs main added.
    if (!gitProbe('diff', '--quiet', 'HEAD', tip, '--', MANIFEST)) {
      throw new Error(`${MANIFEST} differs from main's tip; check from an up-to-date main`);
    }
    return checkStack(tip);
  } catch (error) {
    return { status: 'error', error: message(error) };
  }
}

/** The hand-off Deploy's infra gate prints in the fleet's SAM repos: pull and plan, then deploy. */
function lines(drift) {
  if (drift.status === 'clean') return [`infra clean: ${drift.reason}`];
  if (drift.status === 'error') return [`check:infra-drift could not decide: ${drift.error}`];
  return [
    `deploy:infra pending: ${drift.reason}`,
    '  John, after reviewing:',
    `  1. cd ${CHECKOUT} && git switch main && git pull --ff-only && npm run plan:infra -- --json`,
    `  2. after reviewing that plan, in a terminal holding administrator credentials: cd ${CHECKOUT} && ${COMMAND}`,
  ];
}

const argv = process.argv.slice(2);
const drift = decide(argv);
if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(drift)}\n`);
else (drift.status === 'clean' ? process.stdout : process.stderr).write(`${lines(drift).join('\n')}\n`);
process.exitCode = drift.status === 'clean' || argv.includes('--warn-only') ? 0 : 1;
