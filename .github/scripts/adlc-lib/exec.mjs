// execFile wrapper (design doc §12 gotcha 4): no shell, ever. Handles the Windows .cmd/.bat
// shim problem (Node refuses shell:false for them since 18.20/20.12 — EINVAL, CVE-2024-27980)
// by retrying through cmd.exe with a fixed argument array. Every arg passed through this
// module must be a constant supplied by adlc-lib code — never user or model input.
import { execFile as execFileCb, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFileCb);
const DEFAULT_TIMEOUT_MS = 10_000;

/** Finds `<command>.cmd` or `<command>.bat` on PATH (key matched case-insensitively). */
export function findWindowsShim(command, env = process.env) {
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path');
  const dirs = (pathKey ? env[pathKey] : '').split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of ['.cmd', '.bat']) {
      const candidate = join(dir, `${command}${ext}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** True when a failed spawn should be retried through cmd.exe: EINVAL on Windows, or ENOENT
 * on Windows when the command is really a .cmd/.bat shim (such as `az`). */
export function needsCmdShimRetry(err, command, { platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32') return false;
  if (err?.code === 'EINVAL') return true;
  return err?.code === 'ENOENT' && findWindowsShim(command, env) !== null;
}

/** Runs a fixed, argv-array command with shell:false. Returns { stdout, stderr } on success,
 * or null if the command is missing (ENOENT) or can't be spawned without a shell on this
 * platform (EINVAL) even after the Windows cmd.exe retry below. Never throws for those two
 * cases — callers treat null as "this credential source isn't available" and move on. */
export async function runFixedCommand(command, args = [], { env = process.env, timeout = DEFAULT_TIMEOUT_MS, platform = process.platform, execFile = execFileAsync } = {}) {
  try {
    return await execFile(command, args, { shell: false, env, windowsHide: true, timeout });
  } catch (err) {
    if (needsCmdShimRetry(err, command, { platform, env })) {
      try {
        return await execFile('cmd.exe', ['/d', '/s', '/c', command, ...args], { shell: false, env, windowsHide: true, timeout });
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Like runFixedCommand but for commands whose non-zero exit is a normal result (test runners):
 * returns { code, stdout, stderr, timedOut } for ANY exit code, or null when the command is
 * missing (ENOENT) or cannot be spawned without a shell. Same no-shell rule as above: every arg
 * must be a constant or validated by the caller; the Windows cmd.exe retry only exists for
 * .cmd/.bat shims, so callers should prefer real executables (dotnet, node). */
export async function runCapture(command, args = [], { cwd, env = process.env, timeout = 600_000, maxBuffer = 64 * 1024 * 1024, platform = process.platform, execFile = execFileAsync } = {}) {
  const attempt = async (cmd, cmdArgs, canRetry) => {
    try {
      const r = await execFile(cmd, cmdArgs, { shell: false, cwd, env, windowsHide: true, timeout, maxBuffer });
      return { code: 0, stdout: r.stdout, stderr: r.stderr, timedOut: false };
    } catch (err) {
      if (canRetry && needsCmdShimRetry(err, cmd, { platform, env })) return 'RETRY';
      if (err?.code === 'ENOENT' || err?.code === 'EINVAL') return null;
      return {
        code: typeof err?.code === 'number' ? err.code : 1,
        stdout: err?.stdout ?? '',
        stderr: err?.stderr ?? '',
        timedOut: err?.killed === true,
      };
    }
  };
  const result = await attempt(command, args, true);
  return result === 'RETRY' ? attempt('cmd.exe', ['/d', '/s', '/c', command, ...args], false) : result;
}

/** Runs a fixed command and writes `input` to its stdin (used for `git credential fill`).
 * Same null-on-unavailable contract as runFixedCommand; a non-zero exit is also treated as
 * unavailable (git credential fill exits 1 when it has no answer). */
export function runWithStdin(command, args, input, { env = process.env, timeout = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { shell: false, env, windowsHide: true });
    } catch {
      resolve(null);
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, timeout);
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code === 0 ? { stdout, stderr } : null));
    child.stdin?.on('error', () => {}); // EPIPE if the process exits before we finish writing
    child.stdin?.write(input);
    child.stdin?.end();
  });
}
