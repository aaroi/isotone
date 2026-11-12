/** Figures that roll into place: only changed characters move, and the text stays plain to read. */
import { act, createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { RollingText } from '../../src/react/RollingText';
import { container, render, rerender, setUpPanelFixture } from '../helpers/panel';

setUpPanelFixture();

describe('RollingText', () => {
  it('rolls only the characters that change, up for a larger number, with the old one hidden from readers', async () => {
    let finish = () => {};
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const animate = vi.fn(() => ({ finished }));
    const original = HTMLElement.prototype.animate;
    const originalList = HTMLElement.prototype.getAnimations;
    HTMLElement.prototype.animate = animate as unknown as typeof HTMLElement.prototype.animate;
    HTMLElement.prototype.getAnimations = () => [];
    try {
      await render(createElement(RollingText, { text: '11px', className: 'value' }));
      expect(container.querySelector('.value')?.textContent).toBe('11px');
      expect(animate).not.toHaveBeenCalled();
      await act(async () => rerender(createElement(RollingText, { text: '14px', className: 'value' })));
      // The new digit and the one it replaces, nothing else.
      expect(animate).toHaveBeenCalledTimes(2);
      const [incoming] = animate.mock.calls[0] as unknown as [Keyframe[]];
      expect(String(incoming[0]?.transform)).toContain('translateY(0.6em)');
      const ghost = container.querySelector('.isotone-roll-out');
      expect((ghost as HTMLElement | null)?.dataset.c).toBe('1');
      expect(ghost?.closest('[aria-hidden="true"]')).not.toBeNull();
      // Readers, and the element's text, get the value once.
      expect(container.querySelector('.value')?.textContent).toBe('14px');
      await act(async () => finish());
      expect(container.querySelector('.isotone-roll-out')).toBeNull();
      expect(container.querySelector('.value')?.textContent).toBe('14px');
    } finally {
      HTMLElement.prototype.animate = original;
      HTMLElement.prototype.getAnimations = originalList;
    }
  });

  it('keeps a unit in place when the figure gains a digit', async () => {
    await render(createElement(RollingText, { text: '9px', className: 'value' }));
    const unit = container.querySelector('.value [aria-hidden]')?.lastElementChild;
    await act(async () => rerender(createElement(RollingText, { text: '10px', className: 'value' })));
    expect(container.querySelector('.value [aria-hidden]')?.lastElementChild).toBe(unit);
    expect(container.querySelector('.value')?.textContent).toBe('10px');
  });
});
