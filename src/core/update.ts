/** Read-only snapshot from the local development server. */
export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string | null;
  status: 'checking' | 'available' | 'current' | 'ahead' | 'unavailable' | 'disabled';
  upgrade: { manager: 'npm' | 'pnpm' | 'yarn'; command: string; cwd: string } | null;
  message?: string;
}
