/**
 * The agent's question under a note: its offered answers, one press each,
 * Answer… through the composer, and the answer shown until the agent acts.
 */
import { act, createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IsotonePanel } from '../../src/react/index';
import { PANEL_CSS } from '../../src/react/styles/panel';
import { byText, click, container, render, setUpPanelFixture } from '../helpers/panel';

setUpPanelFixture();

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const note = (id: string, extra: object = {}) => ({
  id,
  route: '/',
  feedback: `Note ${id}`,
  element: null,
  done: false,
  createdAt: minutesAgo(60),
  ...extra,
});
const asked = (id: string, choices?: string[], extra: object = {}) =>
  note(id, { reply: { text: `Question ${id}?`, at: minutesAgo(30), ...(choices ? { choices } : {}) }, ...extra });

/** A notes endpoint: GET answers `notes`, POST is recorded and answered with `answer`. */
function serve(
  notes: object[],
  answer: (body: Record<string, unknown>) => { ok: boolean; status: number } = () => ({ ok: true, status: 200 }),
) {
  const posts: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        posts.push(body);
        const { ok, status } = answer(body);
        return { ok, status, json: async () => (ok ? { id: body.id } : { error: 'no' }) };
      }
      return { ok: true, status: 200, json: async () => notes };
    }),
  );
  return posts;
}

async function open() {
  await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
  await click(container.querySelector('.isotone-fab'));
  await act(async () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))));
}

const rows = () => Array.from(container.querySelectorAll<HTMLElement>('.isotone-note'));
const field = () => container.querySelector('textarea');
const press = (key: string, target: Element | null = document.activeElement) =>
  act(async () => {
    target?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true }));
  });

describe("answering the agent's question", () => {
  beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} })));

  it('stacks the question under the note with its choices and Answer…, and names it on the Feedback button', async () => {
    serve([asked('a', ['Bolder text', 'More contrast']), asked('b'), note('c')]);
    await open();
    const [a, b, c] = rows();
    expect(a?.classList.contains('isotone-note-asked')).toBe(true);
    expect(a?.querySelector('.isotone-reply')?.textContent).toBe('Agent asks Question a?');
    expect(
      Array.from(a?.querySelectorAll('.isotone-answer-actions button') ?? []).map((el) => [el.textContent, el.getAttribute('aria-label')]),
    ).toEqual([
      ['Bolder text', 'Bolder text: answer for Note a'],
      ['More contrast', 'More contrast: answer for Note a'],
      ['Answer…', 'Answer the agent: Note a'],
    ]);
    // Without choices, writing one is the only answer.
    expect(Array.from(b?.querySelectorAll('.isotone-answer-actions button') ?? []).map((el) => el.textContent)).toEqual(['Answer']);
    expect(c?.classList.contains('isotone-note-asked')).toBe(false);
    const feedback = container.querySelector('.isotone-rail-button');
    expect(feedback?.getAttribute('title')).toBe('Feedback · 2 questions');
    expect(feedback?.getAttribute('aria-label')).toBe('Feedback, 3 notes, 2 questions');
    expect(container.querySelector('.isotone-badge')?.textContent).toBe('3');
  });

  it('answers with one click on a choice, and shows the answer in place of the choices', async () => {
    const posts = serve([asked('a', ['Bolder text', 'More contrast'])]);
    await open();
    await click(byText('More contrast: answer for Note a'));
    expect(posts).toEqual([{ id: 'a', route: '/', answer: 'More contrast' }]);
    const [row] = rows();
    expect(row?.querySelector('.isotone-answer-actions')).toBeNull();
    expect(row?.querySelector('.isotone-reply')?.textContent).toBe('Agent asks Question a?');
    expect(row?.querySelector('.isotone-answered')?.textContent).toBe('You answered More contrast');
    expect(row?.querySelector('p')?.textContent).toBe('Note a');
    expect(container.querySelector('.isotone-rail-button')?.getAttribute('title')).toBe('Feedback');
  });

  it('puts the question back and says so when the server refuses the answer', async () => {
    serve([asked('a', ['Bolder text'])], () => ({ ok: false, status: 400 }));
    await open();
    await click(byText('Bolder text: answer for Note a'));
    const [row] = rows();
    expect(row?.querySelector('.isotone-answered')).toBeNull();
    expect(row?.querySelector('.isotone-answer-actions')).not.toBeNull();
    expect(container.querySelector('.isotone-notice')?.textContent).toBe('Could not send your answer. Try again.');
  });

  it('takes a written answer in the composer, leaving the note text as it is', async () => {
    const posts = serve([asked('a', ['Bolder text'])]);
    await open();
    await click(byText('Answer the agent: Note a'));
    expect(field()?.value).toBe('');
    expect(field()?.getAttribute('placeholder')).toBe('Your answer…');
    expect(container.querySelector('.isotone-context .isotone-chip')?.textContent).toBe('Answering agent');
    expect(container.querySelector('.isotone-editing-reply')?.textContent).toBe('Agent asks Question a?');
    expect(container.querySelector('.isotone-send')?.getAttribute('aria-label')).toBe('Send answer');
    expect(rows()[0]?.classList.contains('isotone-note-editing')).toBe(true);
    await act(async () => {
      const textarea = field();
      if (!textarea) return;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(textarea, 'Semibold, please');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await press('Enter', field());
    expect(posts).toEqual([{ id: 'a', route: '/', answer: 'Semibold, please' }]);
    expect(rows()[0]?.querySelector('p')?.textContent).toBe('Note a');
    expect(rows()[0]?.querySelector('.isotone-answered')?.textContent).toBe('You answered Semibold, please');
    expect(field()?.value).toBe('');
    expect(field()?.getAttribute('placeholder')).toBe('What would you change?');
    expect(container.querySelector('.isotone-context .isotone-chip')).toBeNull();
  });

  it('cancels answering with Escape, and gives a refused written answer back to the composer', async () => {
    serve([asked('a')], () => ({ ok: false, status: 400 }));
    await open();
    await click(byText('Answer the agent: Note a'));
    await act(async () => field()?.focus());
    await press('Escape', field());
    expect(container.querySelector('.isotone-context .isotone-chip')).toBeNull();
    expect(field()?.getAttribute('placeholder')).toBe('What would you change?');
    await click(byText('Answer the agent: Note a'));
    await act(async () => {
      const textarea = field();
      if (!textarea) return;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(textarea, 'The top one');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(byText('Send answer'));
    expect(field()?.value).toBe('The top one');
    expect(container.querySelector('.isotone-context .isotone-chip')?.textContent).toBe('Answering agent');
    expect(container.querySelector('.isotone-notice')?.textContent).toBe('Could not send your answer. Try again.');
    expect(rows()[0]?.querySelector('.isotone-answer-actions')).not.toBeNull();
  });

  it('still edits the note when the row itself is pressed', async () => {
    serve([asked('a', ['Bolder text'])]);
    await open();
    await click(rows()[0]?.querySelector('.isotone-note-hit'));
    expect(field()?.value).toBe('Note a');
    expect(container.querySelector('.isotone-context .isotone-chip')?.textContent).toBe('Editing note');
  });

  it('hides an answer the agent has acted on, and one an edit of the note replaced', async () => {
    serve([
      asked('a', ['Bolder text'], {
        reply: { text: 'Question a?', at: minutesAgo(30), answer: { text: 'Bolder text', at: minutesAgo(1) }, answered: true },
      }),
      note('b', { reply: { text: 'Question b?', at: minutesAgo(30), answered: true } }),
      note('c', {
        done: true,
        doneAt: minutesAgo(1),
        resolution: { at: minutesAgo(1) },
        reply: { text: 'Question c?', at: minutesAgo(30), answer: { text: 'Yes', at: minutesAgo(2) }, answered: true },
      }),
    ]);
    await open();
    const [a, b, c] = rows();
    expect(a?.querySelector('.isotone-answered')?.textContent).toBe('You answered Bolder text');
    expect(b?.querySelector('.isotone-reply')).toBeNull();
    expect(b?.classList.contains('isotone-note-asked')).toBe(false);
    expect(c?.textContent).not.toContain('Question c?');
    expect(c?.querySelector('.isotone-answered')).toBeNull();
  });

  it('moves between the note, its choices and Answer… with the arrow keys, from one Tab stop', async () => {
    serve([note('b', { createdAt: minutesAgo(90) }), asked('a', ['Bolder text', 'More contrast'])]);
    await open();
    const focused = () => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent;
    const tabbable = Array.from(container.querySelectorAll<HTMLButtonElement>('.isotone-list button')).filter((el) => el.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    await act(async () => tabbable[0]?.focus());
    expect(focused()).toContain('Note a');
    await press('ArrowRight');
    expect(focused()).toBe('Bolder text: answer for Note a');
    await press('ArrowRight');
    expect(focused()).toBe('More contrast: answer for Note a');
    await press('ArrowRight');
    expect(focused()).toBe('Answer the agent: Note a');
    await press('ArrowLeft');
    await press('ArrowLeft');
    expect(focused()).toBe('Bolder text: answer for Note a');
    await press('ArrowUp');
    expect(focused()).toContain('Note b');
    await press('ArrowDown');
    expect(focused()).toContain('Note a');
    // A choice from the keyboard answers, and focus stays on the row.
    await press('ArrowRight');
    await act(async () => document.activeElement?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })));
    expect(rows()[1]?.querySelector('.isotone-answered')?.textContent).toBe('You answered Bolder text');
    expect(document.activeElement).toBe(rows()[1]?.querySelector('.isotone-note-hit'));
  });

  it('sets an unsent draft and its pin aside while answering, and gives them back after sending or Escape', async () => {
    localStorage.setItem(
      'isotone-feedback::draft::/',
      JSON.stringify({ text: 'Draft words', elements: [{ tag: 'p', text: 'Pinned', selector: '#p' }] }),
    );
    const posts = serve([asked('a'), asked('b')]);
    await open();
    expect(field()?.value).toBe('Draft words');
    const chips = () => Array.from(container.querySelectorAll('.isotone-context .isotone-chip')).map((chip) => chip.textContent);
    expect(chips()).toEqual(['Pinned']);
    await click(byText('Answer the agent: Note a'));
    expect(field()?.value).toBe('');
    expect(chips()).toEqual(['Answering agent']);
    // Nothing pinned would go with an answer: no crosshair, no style editor.
    expect(container.querySelector('[aria-label="Select elements"]')).toBeNull();
    await act(async () => {
      const textarea = field();
      if (!textarea) return;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(textarea, 'The first one');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(byText('Send answer'));
    expect(posts).toEqual([{ id: 'a', route: '/', answer: 'The first one' }]);
    expect(field()?.value).toBe('Draft words');
    expect(chips()).toEqual(['Pinned']);
    expect(container.querySelector('[aria-label="Select elements"]')).not.toBeNull();
    await click(byText('Answer the agent: Note b'));
    await act(async () => field()?.focus());
    await press('Escape', field());
    expect(field()?.value).toBe('Draft words');
    expect(chips()).toEqual(['Pinned']);
    localStorage.clear();
  });

  it('says an answer waits in the browser while the dev server is away', async () => {
    serve([asked('a', ['Bolder text'])], () => ({ ok: false, status: 503 }));
    await open();
    await click(byText('Bolder text: answer for Note a'));
    expect(rows()[0]?.querySelector('.isotone-answered')?.textContent).toBe('You answered Bolder text');
    expect(container.querySelector('.isotone-notice')?.textContent).toBe('Saved here; it reaches your agent when the dev server is back.');
    localStorage.clear();
  });

  it('ignores the second click of a quick double-click on a choice, so the row moving under it is not opened', async () => {
    serve([asked('a', ['Bolder text']), note('b', { createdAt: minutesAgo(10) })]);
    await open();
    const choice = byText('Bolder text: answer for Note a');
    const pointer = (target: Element | null | undefined) =>
      act(async () => {
        target?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, detail: 1 }));
      });
    await pointer(choice);
    // The row collapsed: the next row is now under the pointer.
    await pointer(rows()[1]?.querySelector('.isotone-note-hit'));
    expect(container.querySelector('.isotone-context .isotone-chip')).toBeNull();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 450)));
    await pointer(rows()[1]?.querySelector('.isotone-note-hit'));
    expect(container.querySelector('.isotone-context .isotone-chip')?.textContent).toBe('Editing note');
  });

  it('wraps a long choice inside its key instead of cutting it off', () => {
    const rule = /\.isotone-answer-actions > button\[data-kind='choice'\] \{([^}]*)\}/.exec(PANEL_CSS)?.[1] ?? '';
    expect(rule).toContain('white-space: normal');
    expect(PANEL_CSS).not.toMatch(/isotone-answer-actions[^{]*\{[^}]*(text-overflow|line-clamp)/);
  });
});
