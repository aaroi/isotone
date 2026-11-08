/** The package managers an upgrade command can be built for. */
export type PackageManager = 'npm' | 'pnpm' | 'yarn';

/** Read-only snapshot from the local development server. */
export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  status: 'checking' | 'available' | 'current' | 'ahead' | 'unavailable' | 'disabled';
  upgrade: { manager: PackageManager; command: string; cwd: string } | null;
  message?: string;
}

/**
 * The user's request to upgrade Isotone, carried by one feedback note. The
 * local server builds it from its own update check; the browser only asks for
 * it, so the versions and command never come from page content.
 */
export interface UpdateRequest {
  from: string;
  to: string;
  /** The exact command `check-update` suggests, pinned to `to`. */
  command: string;
  /** The directory to run it in: the manifest that declares Isotone. */
  cwd: string;
  manager: PackageManager;
  /** The release's changelog, to summarize for the user afterwards. */
  changelog?: string;
}

/** The prompt the notice copies, for an agent that is not reading notes. */
export function updatePrompt(update: Pick<UpdateRequest, 'from' | 'to' | 'command' | 'cwd'>): string {
  return `Update Isotone in this project from ${update.from} to ${update.to}: run \`${update.command}\` in ${update.cwd}, restart the dev server if you run it, check the Isotone panel still loads, then tell me what changed (the new CHANGELOG.md).`;
}

/** An update note's text, always built from its request rather than stored text. */
export function updateNoteText(update: Pick<UpdateRequest, 'from' | 'to'>): string {
  return `Update Isotone ${update.from} → ${update.to}`;
}
