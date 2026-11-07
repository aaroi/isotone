/** An in-memory `CliIO` that captures everything runCli writes, so tests
 *  assert on output the same way a person reading a terminal would. */
export function captureIo(cwd: string) {
  const text = { out: '', err: '' };
  return {
    cwd,
    stdout: {
      write: (s: string) => {
        text.out += s;
      },
    },
    stderr: {
      write: (s: string) => {
        text.err += s;
      },
    },
    text,
  };
}
