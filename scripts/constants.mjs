/** The region every AWS call in scripts/ is pinned to; the backup stack lives there. */
export const REGION = 'us-east-1';

/** The fleet's read-only IAM role, and the name of the AWS profile that assumes it. */
export const AGENT_ROLE = 'agent-readonly';

/**
 * The laptop's agent-only AWS config, relative to $HOME: the only laptop file that holds the
 * agent-readonly profile. Absent on a Cloud Agent VM, whose own config defines that profile.
 */
export const AGENT_AWS_CONFIG = '.aws/agent-config';
