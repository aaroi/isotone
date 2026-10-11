import { checkUpdate } from '../update';
import { type CliIO, out, parseArgs, valueFor } from './util';

export async function runCheckUpdate(args: string[], io: CliIO): Promise<number> {
  if (args.some((arg) => arg === '--help' || arg === '-h')) {
    out(io, 'Usage: iso-iterate check-update [--json] [--manager npm|pnpm|yarn]');
    out(io, 'Checks the public npm latest tag. Does not install, execute commands or modify project files.');
    return 0;
  }
  if (parseArgs(args, ['--manager'], ['--json']).length) throw new Error('check-update does not take positional arguments.');
  const manager = valueFor(args, '--manager');
  if (manager !== undefined && manager !== 'npm' && manager !== 'pnpm' && manager !== 'yarn') throw new Error('--manager must be npm, pnpm or yarn.');
  const result = await checkUpdate(io.cwd, manager);
  if (args.includes('--json')) out(io, JSON.stringify(result, null, 2));
  else {
    out(io, `Running iso-iterate ${result.currentVersion}${result.latestVersion ? ` · npm latest ${result.latestVersion}` : ''}`);
    if (result.status === 'available') {
      out(io, 'Update available. Review the release, then run:');
      if (result.upgrade) {
        out(io, `  ${result.upgrade.command}`);
        out(io, `  from ${result.upgrade.cwd}`);
        out(io, 'Restart the dev server and commit the manifest and lockfile changes.');
      }
    } else if (result.status === 'current') out(io, 'Already on the latest release.');
    else if (result.status === 'ahead') out(io, 'This version is ahead of the latest tag; no downgrade suggested.');
    if (result.message) out(io, result.message);
  }
  return result.status === 'unavailable' ? 1 : 0;
}
