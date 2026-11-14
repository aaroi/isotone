/**
 * The panel in a deployed app that collects feedback: notes are signed with
 * the name field, posted to the host's endpoint, and never read back; the
 * browser that wrote a note can edit and delete it.
 */
import { act, createElement } from 'react';
import { expect, it, vi } from 'vitest';

import { createVariantsSource } from '../../src/core/variants';
import { IsotonePanel, mountIsotone } from '../../src/react/index';
import { AXES, container, render, setUpPanelFixture } from '../helpers/panel';

setUpPanelFixture();

type Sent = { url: string; method: string; body: Record<string, unknown> };

/** The host's endpoint: records what the panel posts and answers as scripted. */
function endpoint(answer: () => Response = () => Response.json({ id: 'saved' }, { status: 201 })) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      sent.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : {} });
      return answer();
    }),
  );
  return sent;
}

const panel = (feedback: { endpoint: string; name?: string; release?: string }, props: Record<string, unknown> = {}) =>
  createElement(IsotonePanel, { route: '/projects', theme: 'light', store: { feedback }, ...props });

async function open() {
  await act(async () => container.querySelector<HTMLButtonElement>('.isotone-fab')?.click());
  // Opened by a key, the composer has focus; a click would start select mode.
  const field = container.querySelector('textarea');
  const name = container.querySelector<HTMLInputElement>('.isotone-name');
  if (!field) throw new Error('Missing feedback composer');
  return { field, name };
}

const type = (field: HTMLTextAreaElement | HTMLInputElement, value: string) =>
  act(async () => {
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });

const press = (field: Element, key = 'Enter') =>
  act(async () => void field.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 30)));

it('signs a note with the name the app gave and posts it to the host, once', async () => {
  const sent = endpoint();
  await render(panel({ endpoint: '/api/feedback', name: 'Ada Lovelace', release: 'a1b2c3d' }));
  const { field, name } = await open();
  expect(name?.value).toBe('Ada Lovelace');
  expect(field.getAttribute('aria-label')).toBe('Feedback');
  await type(field, 'The title wraps badly');
  await press(field);
  await settle();
  const posts = sent.filter((request) => request.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({
    url: '/api/feedback',
    body: {
      author: 'Ada Lovelace',
      feedback: 'The title wraps badly',
      route: '/projects',
      release: 'a1b2c3d',
      viewport: { w: innerWidth, h: innerHeight },
    },
  });
  // The endpoint only takes writes: the panel never asks it for notes.
  expect(sent.every((request) => request.method === 'POST')).toBe(true);
  expect(field.value).toBe('');
});

it('edits a sent note in place and deletes it, at the host too', async () => {
  const sent = endpoint();
  await render(panel({ endpoint: '/api/feedback', name: 'Ada' }));
  const { field } = await open();
  await type(field, 'Frist draft');
  await press(field);
  await settle();
  const row = () => container.querySelector('.isotone-note');
  // A click on the note brings it back into the composer, as in development.
  await act(async () => row()?.querySelector<HTMLButtonElement>('button.isotone-note-hit')?.click());
  expect(field.value).toBe('Frist draft');
  await type(field, 'First draft');
  await press(field);
  await settle();
  expect(row()?.textContent).toContain('First draft');
  expect(container.querySelectorAll('.isotone-note')).toHaveLength(1);
  await act(async () => row()?.querySelector<HTMLButtonElement>('.isotone-x')?.click());
  await settle();
  expect(row()).toBeNull();
  const [created, edited, removed] = sent.map((request) => request.body);
  expect(edited).toMatchObject({ id: created?.id, key: created?.key, feedback: 'First draft' });
  expect(removed).toEqual({ id: created?.id, key: created?.key, remove: true });
  // Every request is a write: the endpoint is never asked for notes.
  expect(sent.every((request) => request.method === 'POST')).toBe(true);
});

it('keeps a note the host will not remove, and says so', async () => {
  let refuse = false;
  endpoint(() => (refuse ? Response.json({ error: 'no' }, { status: 400 }) : Response.json({ id: 'saved' }, { status: 201 })));
  await render(panel({ endpoint: '/api/feedback', name: 'Ada' }));
  const { field } = await open();
  await type(field, 'Here to stay');
  await press(field);
  await settle();
  refuse = true;
  await act(async () => container.querySelector<HTMLButtonElement>('.isotone-note .isotone-x')?.click());
  await settle();
  expect(container.querySelector('.isotone-note')?.textContent).toContain('Here to stay');
  expect(container.querySelector('.isotone-notice')?.textContent).toBe('This note cannot be deleted here.');
});

it('asks for a name before sending, keeps the text, and remembers the name', async () => {
  const sent = endpoint();
  await render(panel({ endpoint: '/api/feedback' }));
  const { field, name } = await open();
  if (!name) throw new Error('Missing name field');
  expect(name.value).toBe('');
  expect(name.placeholder).toBe('Your name');
  await type(field, 'Who said this?');
  await press(field);
  await settle();
  expect(sent).toEqual([]);
  expect(container.querySelector('.isotone-notice')?.textContent).toBe('Add your name to send.');
  expect(field.value).toBe('Who said this?');
  expect(document.activeElement).toBe(name);
  await type(name, 'Grace Hopper');
  // Enter in the name field sends what is written.
  await press(name);
  await settle();
  expect(sent.map((request) => request.body.author)).toEqual(['Grace Hopper']);
  expect(container.querySelector('.isotone-notice')).toBeNull();
  expect(localStorage.getItem('isotone-feedback::author')).toBe('Grace Hopper');
});

it('keeps the name field beside a pin while a name is still missing, and the select hint once there is one', async () => {
  endpoint();
  await render(panel({ endpoint: '/api/feedback' }));
  await act(async () => container.querySelector<HTMLButtonElement>('.isotone-fab')?.click());
  const target = document.createElement('button');
  target.textContent = 'Save';
  target.getBoundingClientRect = () => ({
    x: 40,
    y: 40,
    left: 40,
    top: 40,
    right: 140,
    bottom: 70,
    width: 100,
    height: 30,
    toJSON: () => ({}),
  });
  document.body.append(target);
  try {
    await act(async () => container.querySelector<HTMLButtonElement>('.isotone-pick')?.click());
    document.elementFromPoint = () => target;
    await act(async () => {
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
        target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 60, clientY: 50 }));
    });
    await settle();
    const floating = container.querySelector('.isotone-float');
    if (!floating) throw new Error('The composer did not move beside the pin');
    expect(floating.querySelector('.isotone-name')).not.toBeNull();
    expect(floating.querySelector('.isotone-float-hint')).toBeNull();
    const name = floating.querySelector<HTMLInputElement>('.isotone-name');
    if (!name) throw new Error('Missing name field');
    // Typed a letter at a time, the field stays under the cursor until the reviewer leaves it.
    await act(async () => name.focus());
    for (const typed of ['G', 'Gr', 'Grace']) {
      await type(name, typed);
      expect(floating.querySelector('.isotone-name')).toBe(name);
      expect(document.activeElement).toBe(name);
    }
    await act(async () => name.blur());
    expect(floating.querySelector('.isotone-float-hint')).not.toBeNull();
    expect(floating.querySelector('.isotone-name')).toBeNull();
  } finally {
    target.remove();
  }
});

it('moves from the name to the text when there is nothing to send yet', async () => {
  endpoint();
  await render(panel({ endpoint: '/api/feedback' }));
  const { field, name } = await open();
  if (!name) throw new Error('Missing name field');
  await type(name, 'Grace');
  await act(async () => name.focus());
  await press(name);
  expect(document.activeElement).toBe(field);
  expect(fetch).not.toHaveBeenCalled();
});

it('puts a refused note back in the field', async () => {
  endpoint(() => Response.json({ error: 'feedback is required' }, { status: 400 }));
  await render(panel({ endpoint: '/api/feedback', name: 'Ada' }));
  const { field } = await open();
  await type(field, 'Refused');
  await press(field);
  await settle();
  expect(field.value).toBe('Refused');
  expect(container.querySelector('.isotone-note')).toBeNull();
  expect(container.querySelector('.isotone-notice')?.textContent).toBe('Could not save. Your feedback is still here.');
});

it('says what every selector on the page was set to', async () => {
  const sent = endpoint();
  const variants = createVariantsSource({ axes: AXES, selections: { headline: 'b' }, onChange: () => {} });
  await render(panel({ endpoint: '/api/feedback', name: 'Ada' }, { variants }));
  const { field } = await open();
  await type(field, 'Bold reads better');
  await press(field);
  await settle();
  // The pick and the defaults around it: what the reviewer was looking at.
  expect(sent[0]?.body.selections).toEqual({ headline: 'b', haze: '0.3', tagline: 'x' });
});

it('has no name field in development, where notes go to the agent', async () => {
  await render(createElement(IsotonePanel, { route: '/projects', theme: 'light', store: { endpoint: '/api/isotone/notes' } }));
  const { field, name } = await open();
  expect(name).toBeNull();
  expect(field.getAttribute('aria-label')).toBe('Feedback for the agent');
});

it('mounts from a URL alone, and leaves the development endpoint unused', async () => {
  const sent = endpoint();
  vi.useFakeTimers();
  const off = mountIsotone({ feedback: '/api/feedback', endpoint: '/api/isotone/notes' });
  await act(async () => void vi.runOnlyPendingTimers());
  const host = document.querySelector('[data-isotone="root"]');
  expect(host?.shadowRoot?.querySelector('.isotone-fab')).not.toBeNull();
  await act(async () => host?.shadowRoot?.querySelector<HTMLButtonElement>('.isotone-fab')?.click());
  expect(host?.shadowRoot?.querySelector('.isotone-name')).not.toBeNull();
  await act(async () => void vi.advanceTimersByTime(6000));
  expect(sent).toEqual([]);
  off();
  await act(async () => void vi.runOnlyPendingTimers());
  expect(document.querySelector('[data-isotone="root"]')).toBeNull();
});

it('mounts nothing for an empty feedback option', () => {
  const off = mountIsotone({ feedback: { endpoint: '' } });
  expect(document.querySelector('[data-isotone="root"]')).toBeNull();
  off();
});
