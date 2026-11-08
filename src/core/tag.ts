/** The port `isotone serve` listens on unless given `--port`. */
export const DEFAULT_PORT = 4123;

/**
 * The script tag for a page served by another dev server, guarded so it
 * requests nothing unless the page itself is on loopback. A plain tag that
 * reaches production HTML makes every visitor's browser try its own
 * localhost, which newer browsers turn into a permission prompt; this one
 * stays inert there.
 */
export function guardedScriptTag(src: string): string {
  return (
    `<script>if(/^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/.test(location.hostname))` +
    `document.head.append(Object.assign(document.createElement('script'),{src:${JSON.stringify(src).replace(/"/g, "'")}}))</script>`
  );
}
