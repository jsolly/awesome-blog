/**
 * npm run plan:infra: preview what `npm run deploy:infra` would change in the stack.
 *
 * Creates an UPDATE change set from this checkout's template, reads it, and deletes it. It never
 * executes one. It sends no tags, so CloudFormation keeps the stack's own: the preview is the
 * template's changes, not deploy:infra's InfraDeployCommit restamp, which is
 * `npm run check:infra-drift`'s question. The report is the fleet receipt
 * `{stack, region, status, changes, error?}` (dotagents
 * skills/optimize-workspaces/references/infra-plan.md).
 *
 * Usage: npm run plan:infra -- [--json] [--out <file>]
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { AGENT_AWS_CONFIG, AGENT_ROLE, REGION } from './constants.mjs';
import manifest from './infra-inputs.json' with { type: 'json' };

const ACCOUNT = '730335616323';
// One stack. A second needs an aggregated report; scripts/plan-infra.test.mjs pins the count.
const [{ stack: STACK, template: TEMPLATE }] = manifest.stacks;
/** CloudFormation's limit for a template passed inline. This plan never uploads one. */
const INLINE_LIMIT = 51200;
const POLL_MS = 2000;
/** About five minutes of polling; this stack's change set settles in seconds. */
const MAX_POLLS = 150;
// CloudFormation reports an empty change set only as a FAILED status with one of these reasons.
const EMPTY_CHANGE_SET = /didn['’]t contain changes|^No updates are to be performed\.$/u;
const ACTIONS = new Set(['Add', 'Modify', 'Remove', 'Import', 'Dynamic']);
const REPLACEMENTS = new Set(['True', 'False', 'Conditional']);
const MOVING = new Set(['CREATE_PENDING', 'CREATE_IN_PROGRESS', 'DELETE_PENDING', 'DELETE_IN_PROGRESS']);

const message = error => (error instanceof Error ? error.message : String(error));
const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value);

function record(value, what) {
  if (!isRecord(value)) throw new Error(`${what} is not an object`);
  return value;
}

function text(value, what) {
  if (typeof value !== 'string' || value === '') throw new Error(`${what} is missing`);
  return value;
}

/** One change detail as `Properties.Name requiresRecreation=… source=… cause=…`. Values are never printed. */
function formatDetail(value) {
  const detail = isRecord(value) ? value : {};
  const target = isRecord(detail.Target) ? detail.Target : {};
  const parts = [
    [target.Attribute, target.Name].filter(part => typeof part === 'string' && part !== '').join('.'),
    typeof target.RequiresRecreation === 'string' && `requiresRecreation=${target.RequiresRecreation}`,
    typeof detail.ChangeSource === 'string' && `source=${detail.ChangeSource}`,
    typeof detail.CausingEntity === 'string' && `cause=${detail.CausingEntity}`,
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : 'unspecified';
}

/** The receipt's change rows. AWS omits Replacement for Add, Remove and Import; a Modify must carry one. */
function changesFrom(page) {
  if (!Array.isArray(page.Changes)) throw new Error('Change-set result has no Changes list');
  return page.Changes.map(entry => {
    const change = record(record(entry, 'Change').ResourceChange, 'ResourceChange');
    const logicalId = text(change.LogicalResourceId, 'LogicalResourceId');
    const action = text(change.Action, `${logicalId} Action`);
    if (!ACTIONS.has(action)) throw new Error(`Unknown change action ${action} on ${logicalId}`);
    const replacement = change.Replacement ?? '';
    if (typeof replacement !== 'string' || (action === 'Modify' && !REPLACEMENTS.has(replacement))) {
      throw new Error(`Invalid replacement result on ${logicalId}`);
    }
    const scope = change.Scope ?? [];
    if (!Array.isArray(scope) || !scope.every(item => typeof item === 'string')) throw new Error(`Invalid change scope on ${logicalId}`);
    const details = change.Details ?? [];
    if (!Array.isArray(details)) throw new Error(`Invalid change details on ${logicalId}`);
    return { logicalId, type: text(change.ResourceType, `${logicalId} ResourceType`), action, replacement, scope, details: details.map(formatDetail) };
  });
}

/**
 * Delete the preview, confirmed by the stack's change-set listing rather than by the delete's own
 * answer: a create that failed may still have landed, a change set that is still creating refuses
 * deletion, and a refused create left nothing behind. Returns what is left to inspect, if anything.
 */
async function removeChangeSet({ stack, name, aws, pause }) {
  let failure = '';
  let deletes = 0;
  for (let look = 0; look < 15; look += 1) {
    let listed;
    try {
      // The name is this run's own UUID, so nothing in it needs escaping.
      listed = await aws(['cloudformation', 'list-change-sets', '--stack-name', stack, '--query', `Summaries[?ChangeSetName=='${name}'].Status | [0]`]);
    } catch (error) {
      failure = message(error);
      break;
    }
    if (listed === null || listed === 'DELETE_COMPLETE') return undefined;
    if (MOVING.has(listed)) {
      await pause(POLL_MS);
      continue;
    }
    if (deletes === 3) break;
    deletes += 1;
    try {
      await aws(['cloudformation', 'delete-change-set', '--stack-name', stack, '--change-set-name', name]);
      failure = '';
    } catch (error) {
      failure = message(error);
    }
  }
  return `Cleanup failed; inspect change set ${name} on ${stack}${failure ? `: ${failure}` : ''}`;
}

/**
 * Plan one stack. `aws` runs one AWS CLI call and resolves with its parsed JSON answer; `pause`
 * waits between polls. Both are injected so the tests reach no AWS and no clock.
 */
export async function planStack({ stack, body, aws, interrupted = () => false, pause = delay }) {
  const report = { stack, region: REGION, status: 'error', changes: [] };
  if (Buffer.byteLength(body) > INLINE_LIMIT) return { ...report, error: 'Template exceeds the inline limit; no upload performed' };
  if (interrupted()) return { ...report, error: 'Interrupted before change-set creation' };
  const name = `plan-${randomUUID()}`;
  try {
    // No --tags, --parameters or --capabilities: the stack keeps its tags, and the template declares
    // no parameters and no IAM resources. aws/migration-backups/deploy.sh sends none of the last two either.
    await aws([
      'cloudformation', 'create-change-set',
      '--stack-name', stack,
      '--change-set-name', name,
      '--change-set-type', 'UPDATE',
      '--template-body', body,
      '--description', 'plan:infra preview; never execute',
    ]);
    for (let poll = 0; ; poll += 1) {
      if (interrupted()) throw new Error('Interrupted; removing the preview change set');
      const page = record(await aws(['cloudformation', 'describe-change-set', '--stack-name', stack, '--change-set-name', name]), 'Change-set result');
      if (page.Status === 'FAILED') {
        const reason = typeof page.StatusReason === 'string' ? page.StatusReason : '';
        if (!EMPTY_CHANGE_SET.test(reason)) throw new Error(reason || 'Change set FAILED without a reason');
        report.status = 'no-changes';
        break;
      }
      if (page.Status === 'CREATE_COMPLETE') {
        // The AWS CLI follows this operation's pages itself, so a token here means a partial list.
        if (page.NextToken !== undefined) throw new Error('Change-set result is paginated; refusing a partial plan');
        report.changes = changesFrom(page);
        report.status = report.changes.length ? 'changes' : 'no-changes';
        break;
      }
      if (page.Status !== 'CREATE_PENDING' && page.Status !== 'CREATE_IN_PROGRESS') throw new Error(`Unexpected change-set status ${String(page.Status)}`);
      if (poll === MAX_POLLS) throw new Error(`Change set ${name} did not settle`);
      await pause(POLL_MS);
    }
  } catch (error) {
    report.status = 'error';
    report.error = message(error);
  }
  // After every create attempt, even a failed one: the listing decides whether anything is left.
  const leftover = await removeChangeSet({ stack, name, aws, pause });
  if (leftover !== undefined) {
    report.status = 'error';
    report.error = [report.error, leftover].filter(Boolean).join('; ');
  }
  return report;
}

/**
 * agent-readonly only, with inherited static credentials dropped: this plan always forces the
 * profile. The caller's AWS_CONFIG_FILE wins (dotagents gate_with_readonly_aws hands over a config
 * holding minted agent-readonly credentials, and a Cloud Agent VM's own config defines the
 * profile). Without one, the laptop's agent-only config when it is installed.
 */
export function planEnv(base, home) {
  const env = { ...base, AWS_PROFILE: AGENT_ROLE, AWS_PAGER: '', AWS_DEFAULT_REGION: REGION };
  for (const key of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_SECURITY_TOKEN']) delete env[key];
  const agentConfig = join(home, AGENT_AWS_CONFIG);
  if (!env.AWS_CONFIG_FILE && existsSync(agentConfig)) env.AWS_CONFIG_FILE = agentConfig;
  return env;
}

/** Only the fleet's read-only role, in the fleet account, plans this stack. */
export function verifyIdentity(value) {
  const identity = record(value, 'Caller identity');
  const role = new RegExp(`^arn:aws:sts::${ACCOUNT}:assumed-role/${AGENT_ROLE}/[^/]+$`, 'u');
  if (identity.Account !== ACCOUNT || typeof identity.Arn !== 'string' || !role.test(identity.Arn)) {
    throw new Error(`Planning requires the fleet ${AGENT_ROLE} role`);
  }
}

/** `--json` is the only report format; `--out <file>` writes the report there instead of stdout. */
export function planArgs(argv) {
  let out;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--json') continue;
    const file = argv[index + 1];
    if (argv[index] === '--out' && file && !file.startsWith('--')) {
      out = file;
      index += 1;
      continue;
    }
    throw new Error('Usage: npm run plan:infra -- [--json] [--out <file>]');
  }
  return { out };
}

async function main() {
  let interrupted = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { interrupted = true; });
  const env = planEnv(process.env, homedir());
  const run = promisify(execFile);
  const aws = async args => {
    let stdout;
    try {
      ({ stdout } = await run('aws', [...args, '--region', REGION, '--output', 'json'], { env, timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }));
    } catch (error) {
      // An exec error's message repeats the command line, template included: keep only AWS's own words.
      const said = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
      throw new Error(said || (error?.code === 'ENOENT' ? 'aws CLI not found on PATH' : `aws ${args[0]} ${args[1]} failed`), { cause: error });
    }
    return stdout.trim() ? JSON.parse(stdout) : {};
  };
  let report;
  let out;
  try {
    ({ out } = planArgs(process.argv.slice(2)));
    verifyIdentity(await aws(['sts', 'get-caller-identity']));
    const body = readFileSync(new URL(`../${TEMPLATE}`, import.meta.url), 'utf8');
    report = await planStack({ stack: STACK, body, aws, interrupted: () => interrupted });
  } catch (error) {
    report = { stack: STACK, region: REGION, status: 'error', changes: [], error: message(error) };
  }
  const receipt = `${JSON.stringify(report, null, 2)}\n`;
  process.exitCode = report.status === 'error' ? 1 : 0;
  if (out === undefined) {
    process.stdout.write(receipt);
    return;
  }
  try {
    writeFileSync(out, receipt);
  } catch (error) {
    // No receipt file: still show the report and fail, so the runner never reads a clean miss.
    process.stdout.write(receipt);
    process.stderr.write(`cannot write the --out receipt: ${message(error)}\n`);
    process.exitCode = 1;
  }
}

// Node names the main module by its real path, so a symlinked invocation must resolve the same way.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) await main();
