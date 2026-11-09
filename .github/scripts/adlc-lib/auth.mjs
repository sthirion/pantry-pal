// Token resolution chain (design doc §6.1): env var -> CLI session -> git credential
// manager -> AuthRequiredError. Tokens are held in memory only for the lifetime of the
// process — never logged, printed, or written to disk (§11 security).
import { runFixedCommand, runWithStdin } from './exec.mjs';

export class AuthRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

const ADO_RESOURCE_ID = '499b84ac-1321-427f-aa17-267ca6975798';

/** `git credential fill` for a given base URL, with GIT_TERMINAL_PROMPT=0 so it never blocks
 * on an interactive prompt (§6.1). Returns the password/token line, or null if git has no
 * stored credential (exit non-zero) or the command errors out. */
export async function gitCredentialFill(url, { exec = runWithStdin, env = process.env } = {}) {
  let host;
  try {
    ({ host } = new URL(url));
  } catch {
    return null;
  }
  const input = `protocol=https\nhost=${host}\n\n`;
  const result = await exec('git', ['credential', 'fill'], input, {
    env: { ...env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
  });
  if (!result) return null;
  const match = result.stdout.match(/^password=(.*)$/m);
  return match ? match[1].trim() : null;
}

/** Resolves GitHub credentials: GH_TOKEN -> GITHUB_TOKEN -> `gh auth token` -> GCM -> throw.
 * `host` supports GHE.com/GHES hosts (§8.2) via `gh auth token --hostname <host>`. */
export async function resolveGitHubAuth({ env = process.env, exec = runFixedCommand, credentialFill = gitCredentialFill, host = 'github.com' } = {}) {
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN']) {
    if (env[name]) return { token: env[name], scheme: 'Bearer', source: `env:${name}` };
  }
  const cliArgs = host === 'github.com' ? ['auth', 'token'] : ['auth', 'token', '--hostname', host];
  const cli = await exec('gh', cliArgs, { env });
  if (cli?.stdout?.trim()) return { token: cli.stdout.trim(), scheme: 'Bearer', source: 'gh CLI' };

  const gcmToken = await credentialFill(`https://${host}`, { env });
  if (gcmToken) return { token: gcmToken, scheme: 'Bearer', source: 'git credential manager' };

  throw new AuthRequiredError(
    'AUTH_REQUIRED github: no credentials found (checked GH_TOKEN, GITHUB_TOKEN, gh CLI).\n' +
    'Sign in by running:  gh auth login --web'
  );
}

/** Resolves Azure DevOps credentials: AZURE_DEVOPS_EXT_PAT (Basic) -> ADO_TOKEN (Bearer) ->
 * `az account get-access-token` -> GCM -> throw. Unverified against live ADO (no ADO sandbox
 * available yet — see plan "Phase 0 findings"). */
export async function resolveAdoAuth({ env = process.env, exec = runFixedCommand, credentialFill = gitCredentialFill, org } = {}) {
  if (env.AZURE_DEVOPS_EXT_PAT) return { token: env.AZURE_DEVOPS_EXT_PAT, scheme: 'Basic', source: 'env:AZURE_DEVOPS_EXT_PAT' };
  if (env.ADO_TOKEN) return { token: env.ADO_TOKEN, scheme: 'Bearer', source: 'env:ADO_TOKEN' };

  const cli = await exec('az', ['account', 'get-access-token', '--resource', ADO_RESOURCE_ID, '--query', 'accessToken', '-o', 'tsv'], { env });
  if (cli?.stdout?.trim()) return { token: cli.stdout.trim(), scheme: 'Bearer', source: 'az CLI' };

  const gcmToken = await credentialFill(org ? `https://dev.azure.com/${org}` : 'https://dev.azure.com', { env });
  if (gcmToken) return { token: gcmToken, scheme: 'Basic', source: 'git credential manager' };

  throw new AuthRequiredError(
    'AUTH_REQUIRED ado: no credentials found (checked AZURE_DEVOPS_EXT_PAT, ADO_TOKEN, az CLI).\n' +
    'Sign in by running:  az login'
  );
}
