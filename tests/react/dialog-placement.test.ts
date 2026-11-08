import { describe, expect, it } from 'vitest';
import { placeDialog } from '../../src/react/variants/AxisActionsDialog';

// A 300px dialog in a 520px panel, opened from a heading at various heights.
describe('selector dialog placement', () => {
  it('opens above the heading when it fits there', () => {
    expect(placeDialog(300, 520, { top: 400, bottom: 424 })).toEqual({ top: 94 });
  });

  it('opens below the heading when it fits only there', () => {
    expect(placeDialog(300, 520, { top: 100, bottom: 124 })).toEqual({ top: 130 });
  });

  it('scrolls on the roomier side rather than covering the heading', () => {
    expect(placeDialog(300, 520, { top: 240, bottom: 264 })).toEqual({ top: 270 });
    expect(placeDialog(300, 520, { top: 290, bottom: 314 })).toEqual({ top: 6, max: 278 });
  });

  it('covers the heading only when neither side has a useful height', () => {
    expect(placeDialog(300, 300, { top: 120, bottom: 144 })).toEqual({ top: 6 });
  });

  it('starts at the top without an opener', () => {
    expect(placeDialog(300, 520)).toEqual({ top: 6 });
  });
});
