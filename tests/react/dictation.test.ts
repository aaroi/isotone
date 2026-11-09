/** The dictation experiment: a microphone in the composer, only when the flag is on and the browser can listen. */
import { act, createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { IsotonePanel } from '../../src/react/index';
import { byText, click, container, render, setUpPanelFixture } from '../helpers/panel';

setUpPanelFixture();

type Result = { 0: { transcript: string }; isFinal: boolean; length: 1 };
class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((event: { resultIndex: number; results: Result[] }) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  aborted = false;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started = true;
  }
  stop() {}
  abort() {
    this.aborted = true;
  }
  hear(...phrases: [text: string, final: boolean][]) {
    this.onresult?.({ resultIndex: 0, results: phrases.map(([transcript, isFinal]) => ({ 0: { transcript }, isFinal, length: 1 })) });
  }
}

const field = () => container.querySelector('textarea') as HTMLTextAreaElement;
async function openFeedback(experimental?: { dictation: boolean }) {
  await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' }, experimental }));
  // From the keyboard, so the composer opens without select mode.
  await click(container.querySelector('.isotone-fab'));
  await act(async () => {});
}
const mic = () => byText('Dictate') ?? byText('Stop dictating');

describe('dictation', () => {
  it('shows no microphone with the flag off, or in a browser that cannot listen', async () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
    await openFeedback();
    expect(mic()).toBeUndefined();
  });

  it('shows none with the flag on where there is no speech recognition', async () => {
    await openFeedback({ dictation: true });
    expect(container.querySelector('textarea')).not.toBeNull();
    expect(mic()).toBeUndefined();
  });

  it('writes what it hears after what is typed, replacing the phrase still being heard', async () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
    document.documentElement.lang = 'fi';
    await openFeedback({ dictation: true });
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(field(), 'Typed first.');
      field().dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(mic());
    const recognition = FakeRecognition.last as FakeRecognition;
    expect(recognition).toMatchObject({ started: true, continuous: true, interimResults: true, lang: 'fi' });
    expect(mic()?.getAttribute('aria-pressed')).toBe('true');
    expect(field().placeholder).toBe('Listening…');
    await act(async () => recognition.hear(['make the', false]));
    expect(field().value).toBe('Typed first. make the');
    await act(async () => recognition.hear(['make the cards', false]));
    expect(field().value).toBe('Typed first. make the cards');
    await act(async () => recognition.hear([' Make the cards wider.', true], ['and', false]));
    expect(field().value).toBe('Typed first. Make the cards wider. and');
    // Typing meanwhile is kept: the next words follow what the field holds.
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(field(), 'Rewritten.');
      field().dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => recognition.hear([' Make the cards wider.', true], ['and taller', true]));
    expect(field().value).toBe('Rewritten. and taller');
    await click(mic());
    expect(recognition.aborted).toBe(true);
    expect(mic()?.getAttribute('aria-pressed')).toBe('false');
    document.documentElement.lang = '';
  });

  it('lets go of the microphone when the note is sent, and when the browser stops listening', async () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
    await openFeedback({ dictation: true });
    await click(mic());
    const first = FakeRecognition.last as FakeRecognition;
    await act(async () => first.hear(['Tighter spacing', true]));
    await click(byText('Send note'));
    expect(first.aborted).toBe(true);
    expect(field().value).toBe('');
    expect(mic()?.getAttribute('aria-pressed')).toBe('false');
    await click(mic());
    const second = FakeRecognition.last as FakeRecognition;
    expect(second).not.toBe(first);
    await act(async () => second.onend?.());
    expect(mic()?.getAttribute('aria-pressed')).toBe('false');
  });

  it('says when the microphone is blocked', async () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
    await openFeedback({ dictation: true });
    await click(mic());
    const recognition = FakeRecognition.last as FakeRecognition;
    await act(async () => {
      recognition.onerror?.({ error: 'not-allowed' });
      recognition.onend?.();
    });
    expect(container.querySelector('.isotone-notice')?.textContent).toBe('Microphone access is blocked for this page.');
    expect(mic()?.getAttribute('aria-pressed')).toBe('false');
  });
});
