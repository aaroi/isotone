/**
 * Every test in a document starts as a fresh tab: the dock keeps which panels
 * are open in `sessionStorage` across a reload, and one test's panels must not
 * open in the next.
 */
import { beforeEach } from 'vitest';

beforeEach(() => {
  try {
    sessionStorage.clear();
  } catch {
    /* A test that stubs storage away has nothing to clear. */
  }
});
