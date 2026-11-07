import { describe, expect, it } from 'vitest';

import { isRouteVisible, matchRoute } from '../../src/core/routes';
import { knobsFor, variantAppliesTo } from '../../src/core/variants';

// One grammar for every route pattern: variant and knob scope, the panel's
// route gate, `npx isotone <route>` and `blast start <route>`.
const TABLE: [pattern: string | undefined, route: string, matches: boolean][] = [
  [undefined, '/anything', true],
  ['', '/anything', true],
  ['*', '/a/b', true],
  ['/settings', '/settings', true],
  ['/settings', '/settings/', true],
  ['/settings/', '/settings', true],
  ['settings', '/settings', true],
  ['/settings', '/settings?tab=2', true],
  ['/settings', '/settings/x', false],
  ['/settings', '/', false],
  ['/', '/', true],
  ['/', '/x', false],
  ['/items/*', '/items', true],
  ['/items/*', '/items/42', true],
  ['/items/*', '/items/a/b', true],
  ['/items/*', '/items-archive', false],
  ['/items/*', '/orders/7', false],
  ['/items*', '/items-archive', true],
  ['/items*', '/items/42', true],
  ['/items*', '/item', false],
];

describe('matchRoute', () => {
  it.each(TABLE)('%j covers %j: %s', (pattern, route, matches) => {
    expect(matchRoute(pattern, route)).toBe(matches);
    // Variants and knobs use the same rule.
    expect(variantAppliesTo(pattern, route)).toBe(matches);
    if (pattern !== undefined)
      expect(knobsFor([{ id: 'k', label: 'K', options: [], route: pattern }] as never, route)).toHaveLength(matches ? 1 : 0);
    // The panel's allow-list too (on routes the gate does not always hide).
    if (pattern) expect(isRouteVisible(route, { visible: [pattern] })).toBe(matches);
  });
});
