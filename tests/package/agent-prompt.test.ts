import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AGENT_PROMPT } from '../../examples/demo/agent-prompt';

// The demo tour's last step and the README hand visitors the same prompt.
describe('the agent prompt', () => {
  it('is the README’s “Start with your agent” block, word for word', () => {
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
    const section = readme.split('## Start with your agent')[1] ?? '';
    const block = /```text\n([\s\S]*?)```/.exec(section)?.[1];
    expect(block, 'README has a text block under "Start with your agent"').toBeDefined();
    const words = (text: string) => text.replace(/\s+/g, ' ').trim();
    expect(words(block ?? '')).toBe(words(AGENT_PROMPT));
  });
});
