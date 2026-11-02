/**
 * The export scan behind live dispatchers. It has to list every runtime
 * export of an ordinary component or hook file, skip types, and answer null
 * whenever it cannot be sure, so the plugin swaps that file whole instead.
 */
import { describe, expect, it } from 'vitest';

import { isRouteModule, scanExports } from '../src/vite/exports';

describe('scanExports', () => {
  it('lists declarations, defaults and export clauses', () => {
    const code = [
      `import { x } from './x';`,
      `export function Picker() {}`,
      `export async function load() {}`,
      `export const useProjects = () => {};`,
      `export const PAGE = 20;`,
      `export let count = 0`,
      `export class Store {}`,
      `export abstract class Base {}`,
      `export enum Kind { A }`,
      `export const enum Flag { B }`,
      `export default function App() {}`,
      `const a = 1, b = 2;`,
      `export {`,
      `  a,`,
      `  b as bee, // trailing comment`,
      `  type Hidden,`,
      `};`,
      `export * as helpers from './helpers';`,
      `export { c } from './c';`,
    ].join('\n');
    expect(scanExports(code)?.sort()).toEqual([
      'Base', 'Flag', 'Kind', 'PAGE', 'Picker', 'Store', 'a', 'bee', 'c', 'count',
      'default', 'helpers', 'load', 'useProjects',
    ]);
  });

  it('skips type-only exports', () => {
    const code = [
      'export type Props = { a: string };',
      'export interface State { b: number }',
      `export type { Other } from './other';`,
      `export type * from './types';`,
      'export declare const injected: string;',
      'export function Only() {}',
    ].join('\n');
    expect(scanExports(code)).toEqual(['Only']);
  });

  it('ignores exports that are not at the start of a line', () => {
    const code = [
      'export function Real() {}',
      'const doc = `',
      '  export const notReal = 1',
      '`;',
      '// export const commented = 1',
      ' * export const inDoc = 1',
      'const exported = 1;',
    ].join('\n');
    expect(scanExports(code)).toEqual(['Real']);
  });

  it('answers null when it cannot list the names', () => {
    expect(scanExports(`export * from './all';`)).toBeNull();
    expect(scanExports('export const { a, b } = obj;')).toBeNull();
    expect(scanExports('export const [a] = list;')).toBeNull();
    expect(scanExports('export = thing;')).toBeNull();
    expect(scanExports('export namespace N {}')).toBeNull();
    expect(scanExports(`export import A = B.C;`)).toBeNull();
  });
});

describe('isRouteModule', () => {
  it('spots a framework route module by its default and route exports', () => {
    expect(isRouteModule(['default', 'loader'])).toBe(true);
    expect(isRouteModule(['default', 'meta'])).toBe(true);
    // A nav config may export `links` without being a route.
    expect(isRouteModule(['links', 'NavItem'])).toBe(false);
    expect(isRouteModule(['default', 'Picker'])).toBe(false);
  });
});

describe('scanExports after the review', () => {
  it('serves several declarators whole instead of guessing', () => {
    expect(scanExports('export const a = 1, b = 2;')).toBeNull();
    expect(scanExports('export const a = 1,\n  b = 2;')).toBeNull();
  });

  it('does not take parameters or type arguments for exports', () => {
    expect(scanExports('export const f = (x, y = 2) => x + y;')).toEqual(['f']);
    expect(scanExports('export const C: FC<{ a: number, b: string }> = () => null;')).toEqual(['C']);
    expect(scanExports("export const pair = ['a,b', 'c'];")).toEqual(['pair']);
    expect(scanExports('export const m = new Map<string, number>();')).toEqual(['m']);
  });

  it('reads an export behind a one-line doc comment', () => {
    expect(scanExports('/** The picker. */ export function Picker() {}')).toEqual(['Picker']);
  });
});
