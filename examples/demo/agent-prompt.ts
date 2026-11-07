/**
 * The prompt a visitor gives their coding agent to set Isotone up. The README's
 * "Start with your agent" block carries the same words, wrapped for reading;
 * `tests/agent-prompt.test.ts` keeps the two in step.
 */
export const AGENT_PROMPT =
  'Set up Isotone (https://github.com/aaroi/isotone) in this project, for development ' +
  'only. Install the `isotone` package as a dev dependency, run `npx isotone init --yes`, ' +
  "apply the setup it prints and do its first run on <the page I'm working on>. Then " +
  'tell me what to open and try.';

/** The same setup by hand, for the tour's "Or set it up yourself". */
export const SETUP_COMMANDS = ['npm i -D isotone', 'npx isotone init'];
