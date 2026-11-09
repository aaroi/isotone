import { describe, expect, it } from 'vitest';
import { segmentLayout } from '../../src/react/variants/segmentLayout';

// A selector wrapped by flex gave each row its own widths, inside a track rounded like a one-row capsule.
describe('segment layout', () => {
  const room = 306;
  const gap = 3;
  it('keeps options that fit on one row', () => {
    expect(segmentLayout([50, 44, 46, 44, 50], room, gap)).toEqual({ wraps: false, columns: 5 });
    expect(segmentLayout([400], room, gap)).toEqual({ wraps: false, columns: 1 });
  });
  it('wraps into at least two columns and truncates rather than stack', () => {
    expect(segmentLayout([90, 140, 140], room, gap)).toEqual({ wraps: true, columns: 2 });
    expect(segmentLayout([250, 260], room, gap)).toEqual({ wraps: true, columns: 2 });
    expect(segmentLayout([90, 176, 140, 130], room, gap)).toEqual({ wraps: true, columns: 2 });
  });
  it('balances rows so the last one is as full as it can be', () => {
    expect(segmentLayout(Array(5).fill(70), room, gap)).toEqual({ wraps: true, columns: 3 });
    expect(segmentLayout(Array(12).fill(70), room, gap)).toEqual({ wraps: true, columns: 4 });
    expect(segmentLayout(Array(7).fill(100), room, gap)).toEqual({ wraps: true, columns: 3 });
  });
});
