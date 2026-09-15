import { describe, expect, it } from 'vitest';

import {
  describeIterationElement,
  isRouteVisible,
  type NodeLike,
} from '../src/core/index';

function node(tagName: string, overrides: Partial<NodeLike> = {}) {
  return { tagName, children: [], ...overrides } as NodeLike;
}

describe('describeIterationElement', () => {
  it('collects an id segment and stops at it', () => {
    const el = node('SPAN', { id: 'runtime', textContent: ' 158d 2h ' });
    const desc = describeIterationElement(el);
    expect(desc).toEqual({ tag: 'span', text: '158d 2h', selector: '#runtime' });
  });

  it('falls back to tag:nth-child(n) and climbs to BODY', () => {
    const body = node('BODY');
    const table = node('table', { parentElement: body });
    const row = node('tr', { parentElement: table });
    const cell = node('td', { textContent: 'platform-api', parentElement: row });
    body.children = [table];
    table.children = [node('thead'), row, node('caption')];
    row.children = [node('td'), cell];
    const desc = describeIterationElement(cell);
    expect(desc.selector).toBe(
      'table:nth-child(1) > tr:nth-child(2) > td:nth-child(2)',
    );
    expect(desc.text).toBe('platform-api');
  });

  it('caps text at 80 chars and collapses whitespace', () => {
    const el = node('button', { textContent: ` x `.repeat(40) });
    const desc = describeIterationElement(el);
    expect(desc.text.length).toBeLessThanOrEqual(80);
    expect(desc.text).not.toContain('  ');
  });
});

describe('isRouteVisible', () => {
  it('is visible on normal console routes by default', () => {
    expect(isRouteVisible('/projects')).toBe(true);
    expect(isRouteVisible('/')).toBe(true);
    expect(isRouteVisible('/sandboxes/sb_1')).toBe(true);
  });

  it('is hidden on auth/error routes by default', () => {
    expect(isRouteVisible('/login')).toBe(false);
    expect(isRouteVisible('/logout')).toBe(false);
    expect(isRouteVisible('/error')).toBe(false);
  });

  it('honors an explicit allow-list (visible) over the default', () => {
    const rule = { visible: ['/projects', '/sandboxes*'] };
    expect(isRouteVisible('/projects/xyz', rule)).toBe(true);
    expect(isRouteVisible('/overview', rule)).toBe(false);
  });

  it('never shows on always-hidden surfaces (auth/api) even when allow-listed', () => {
    const rule = { visible: ['/api', '/auth'] };
    expect(isRouteVisible('/api/foo', rule)).toBe(false);
    expect(isRouteVisible('/auth/session', rule)).toBe(false);
  });

  it('supports a catch-all by listing the bare prefix', () => {
    const rule = { hidden: ['/sandboxes', '/secrets'] };
    expect(isRouteVisible('/sandboxes/sb_1', rule)).toBe(false);
    expect(isRouteVisible('/secrets/key_1', rule)).toBe(false);
    expect(isRouteVisible('/projects', rule)).toBe(true);
  });
});