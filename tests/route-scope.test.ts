import { describe, expect, it } from 'vitest';

import { variantAppliesTo } from '../src/core/variants';

describe('variantAppliesTo', () => {
  it('no pattern means every route', () => {
    expect(variantAppliesTo(undefined, '/anything')).toBe(true);
    expect(variantAppliesTo('', '/anything')).toBe(true);
  });
  it('an exact pattern is that page only', () => {
    expect(variantAppliesTo('/settings', '/settings')).toBe(true);
    expect(variantAppliesTo('/settings', '/settings/x')).toBe(false);
    expect(variantAppliesTo('/settings', '/')).toBe(false);
  });
  it('a /* pattern is the base and everything under it', () => {
    expect(variantAppliesTo('/items/*', '/items/42')).toBe(true);
    expect(variantAppliesTo('/items/*', '/items')).toBe(true);
    expect(variantAppliesTo('/items/*', '/items-archive')).toBe(false);
    expect(variantAppliesTo('/items/*', '/orders/7')).toBe(false);
  });
});
