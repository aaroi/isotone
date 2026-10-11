// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { detectTheme, observeTheme } from '../src/react/theme';

let media: EventTarget & { matches: boolean };
let elementsAtDock: Element[];
const originalElementsFromPoint = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint');

beforeEach(() => {
  vi.useFakeTimers();
  media = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal('matchMedia', vi.fn(() => media));
  elementsAtDock = [];
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    value: () => elementsAtDock,
  });
});

afterEach(() => {
  document.body.replaceChildren();
  document.body.removeAttribute('style');
  document.documentElement.removeAttribute('style');
  if (originalElementsFromPoint) {
    Object.defineProperty(document, 'elementsFromPoint', originalElementsFromPoint);
  } else {
    Reflect.deleteProperty(document, 'elementsFromPoint');
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function frame() {
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(20);
}

it('uses body paint when a short page leaves only transparent html at the dock', () => {
  elementsAtDock = [document.documentElement];
  document.body.style.backgroundColor = 'rgb(8, 9, 12)';
  expect(detectTheme()).toBe('dark');
  document.body.style.backgroundColor = 'rgb(250, 250, 248)';
  expect(detectTheme()).toBe('light');
});

it('uses the painted surface at the dock before the body background', () => {
  const surface = document.createElement('div');
  surface.style.backgroundColor = 'white';
  document.body.append(surface);
  document.body.style.backgroundColor = 'black';
  elementsAtDock = [surface, document.body, document.documentElement];
  expect(detectTheme()).toBe('light');
});

it('ignores the overlay and its open shadow content', () => {
  const overlay = document.createElement('div');
  overlay.dataset.isoIterate = '';
  overlay.style.backgroundColor = 'white';
  const shadow = overlay.attachShadow({ mode: 'open' });
  const button = document.createElement('button');
  button.style.backgroundColor = 'white';
  shadow.append(button);
  document.body.append(overlay);
  document.body.style.backgroundColor = 'black';
  elementsAtDock = [button, overlay, document.documentElement];
  expect(detectTheme()).toBe('dark');
});

it('composites translucent backgrounds over the page', () => {
  const surface = document.createElement('div');
  surface.style.backgroundColor = 'rgba(255, 255, 255, .51)';
  document.body.append(surface);
  document.body.style.backgroundColor = 'black';
  elementsAtDock = [surface, document.body, document.documentElement];
  expect(detectTheme()).toBe('dark');
  surface.style.backgroundColor = 'rgba(0, 0, 0, .2)';
  document.body.style.backgroundColor = 'white';
  expect(detectTheme()).toBe('light');
});

it('resolves a transparent canvas through CSS color-scheme and the system preference', () => {
  expect(detectTheme()).toBe('light');
  document.documentElement.style.colorScheme = 'dark';
  expect(detectTheme()).toBe('dark');
  document.documentElement.style.colorScheme = 'light dark';
  expect(detectTheme()).toBe('light');
  media.matches = true;
  expect(detectTheme()).toBe('dark');
  document.body.style.backgroundColor = 'white';
  expect(detectTheme()).toBe('light');
});

it('keeps explicit modes fixed and gives system mode precedence over page paint', () => {
  document.body.style.backgroundColor = 'black';
  expect(detectTheme('light')).toBe('light');
  expect(detectTheme('system')).toBe('light');
  document.body.style.backgroundColor = 'white';
  expect(detectTheme('dark')).toBe('dark');
  media.matches = true;
  expect(detectTheme('system')).toBe('dark');
});

it('fixed modes install no observers or page listeners', () => {
  const mutationObserver = vi.spyOn(globalThis, 'MutationObserver');
  const documentListener = vi.spyOn(document, 'addEventListener');
  const windowListener = vi.spyOn(window, 'addEventListener');
  const sample = vi.fn();
  observeTheme(sample, 'dark')();
  expect(sample).toHaveBeenCalledExactlyOnceWith('dark');
  expect(mutationObserver).not.toHaveBeenCalled();
  expect(documentListener).not.toHaveBeenCalled();
  expect(windowListener).not.toHaveBeenCalled();
});

it('system mode follows only the media query and stops cleanly', async () => {
  const mutationObserver = vi.spyOn(globalThis, 'MutationObserver');
  const computedStyle = vi.spyOn(window, 'getComputedStyle');
  const sample = vi.fn();
  const stop = observeTheme(sample, 'system');
  expect(sample).toHaveBeenCalledExactlyOnceWith('light');
  document.body.style.backgroundColor = 'black';
  window.dispatchEvent(new Event('resize'));
  await frame();
  expect(sample).toHaveBeenCalledTimes(1);
  media.matches = true;
  media.dispatchEvent(new Event('change'));
  await frame();
  expect(sample).toHaveBeenLastCalledWith('dark');
  expect(mutationObserver).not.toHaveBeenCalled();
  expect(computedStyle).not.toHaveBeenCalled();
  stop();
  media.matches = false;
  media.dispatchEvent(new Event('change'));
  await frame();
  expect(sample).toHaveBeenCalledTimes(2);
});

it('follows page mutations but emits only changes, ignoring its own UI', async () => {
  const sample = vi.fn();
  const stop = observeTheme(sample);
  expect(sample).toHaveBeenCalledExactlyOnceWith('light');
  document.body.style.backgroundColor = 'black';
  await frame();
  expect(sample).toHaveBeenLastCalledWith('dark');
  const overlay = document.createElement('div');
  overlay.dataset.isoIterate = '';
  document.body.append(overlay);
  await frame();
  const requestFrame = vi.spyOn(window, 'requestAnimationFrame');
  overlay.style.backgroundColor = 'white';
  overlay.textContent = 'Changed UI';
  await frame();
  expect(requestFrame).not.toHaveBeenCalled();
  expect(sample).toHaveBeenCalledTimes(2);
  stop();
});

it('coalesces resize, scroll, stylesheet load and animation events in one frame', async () => {
  const surface = document.createElement('div');
  surface.style.backgroundColor = 'black';
  document.body.append(surface);
  const sample = vi.fn();
  const stop = observeTheme(sample);
  const requestFrame = vi.spyOn(window, 'requestAnimationFrame');
  elementsAtDock = [surface];
  window.dispatchEvent(new Event('resize'));
  document.dispatchEvent(new Event('scroll'));
  document.dispatchEvent(new Event('load'));
  document.dispatchEvent(new Event('transitionend'));
  document.dispatchEvent(new Event('animationend'));
  media.dispatchEvent(new Event('change'));
  await frame();
  expect(requestFrame).toHaveBeenCalledTimes(1);
  expect(sample).toHaveBeenLastCalledWith('dark');
  stop();
});

it('tracks a new body and stylesheet text changes', async () => {
  const style = document.createElement('style');
  style.append(document.createTextNode('body { background-color: white; }'));
  document.body.append(style);
  const sample = vi.fn();
  const stop = observeTheme(sample);
  if (style.firstChild) style.firstChild.textContent = 'body { background-color: black; }';
  await frame();
  expect(sample).toHaveBeenLastCalledWith('dark');
  const replacement = document.createElement('body');
  replacement.style.backgroundColor = 'white';
  document.body.replaceWith(replacement);
  await frame();
  expect(sample).toHaveBeenLastCalledWith('light');
  stop();
});

it('samples and observes open host shadow roots at the dock', async () => {
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });
  let surface = document.createElement('div');
  surface.style.backgroundColor = 'black';
  shadow.append(surface);
  Object.defineProperty(shadow, 'elementsFromPoint', { value: () => [surface, host] });
  document.body.append(host);
  elementsAtDock = [host];
  const sample = vi.fn();
  const stop = observeTheme(sample);
  expect(sample).toHaveBeenCalledExactlyOnceWith('dark');
  // jsdom caches computed styles inside shadow roots; replacing the node also
  // exercises the dynamic component rendering case without relying on that cache.
  const replacement = document.createElement('div');
  replacement.style.backgroundColor = 'white';
  surface.replaceWith(replacement);
  surface = replacement;
  await frame();
  expect(sample).toHaveBeenLastCalledWith('light');
  stop();
});

it('cancels queued work and disconnects every listener on cleanup', async () => {
  const sample = vi.fn();
  const stop = observeTheme(sample);
  window.dispatchEvent(new Event('resize'));
  stop();
  sample.mockClear();
  document.body.style.backgroundColor = 'black';
  window.dispatchEvent(new Event('resize'));
  document.dispatchEvent(new Event('scroll'));
  document.dispatchEvent(new Event('load'));
  document.dispatchEvent(new Event('transitionend'));
  document.dispatchEvent(new Event('animationend'));
  media.dispatchEvent(new Event('change'));
  await frame();
  expect(sample).not.toHaveBeenCalled();
});
