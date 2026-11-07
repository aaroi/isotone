import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Run npm synchronously and return its stdout.
 *
 * On Windows npm is `npm.cmd`, and Node (since the CVE-2024-27980 fix) refuses
 * to spawn a `.cmd` without a shell (EINVAL). A shell would re-parse every
 * argument, so run npm's own entry script with this Node instead; Windows
 * installs ship it next to `node.exe`.
 */
export function npm(args, options = {}) {
  const settings = { encoding: 'utf8', ...options };
  if (process.platform !== 'win32') return execFileSync('npm', args, settings);
  const cli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!existsSync(cli)) throw new Error(`npm's entry script was not found at ${cli}`);
  return execFileSync(process.execPath, [cli, ...args], settings);
}
