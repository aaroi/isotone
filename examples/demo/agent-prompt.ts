/**
 * The prompt a visitor gives their coding agent to set Isotone up. The README's
 * "Start with your agent" block carries the same words, wrapped for reading;
 * `tests/agent-prompt.test.ts` keeps the two in step.
 */
export const AGENT_PROMPT = "Set up Isotone (https://github.com/aaroi/isotone) and show me how to try it on <the page I'm working on>.";

/** The same setup by hand, for the tour's "Or set it up yourself". */
export const SETUP_COMMANDS = ['npm i -D isotone', 'npx isotone init'];
