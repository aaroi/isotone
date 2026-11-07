import { rmSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { VARIANTS_ENDPOINT } from '../../src/core/variants';
import { createVariant, readActive } from '../../src/node/variants';
import { serveVariantsRequest } from '../../src/server/index';
import { tempGitRepo } from '../helpers/fs';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project() {
  const opts = { root: tempGitRepo('isotone-variants-request-', dirs) };
  createVariant(opts, { id: 'v' });
  return opts;
}

const activate = (origin?: string) =>
  new Request(`http://127.0.0.1:4101${VARIANTS_ENDPOINT}/active`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify({ active: ['v'] }),
  });

describe('serveVariantsRequest', () => {
  it('routes on the path below the variants endpoint', async () => {
    const opts = project();
    const listed = await serveVariantsRequest(opts, new Request(`http://127.0.0.1:4101${VARIANTS_ENDPOINT}`));
    expect(listed.status).toBe(200);
    expect((listed.body as { variants: Array<{ id: string }> }).variants.map((variant) => variant.id)).toEqual(['v']);

    const same = await serveVariantsRequest(opts, activate('http://127.0.0.1:4101'));
    expect(same.status).toBe(200);
    expect(readActive(opts)).toEqual(['v']);
  });

  it('refuses a page from another origin before changing anything', async () => {
    const opts = project();
    expect((await serveVariantsRequest(opts, activate('https://evil.example'))).status).toBe(403);
    expect((await serveVariantsRequest(opts, activate('http://localhost:4150'))).status).toBe(403);
    expect(readActive(opts)).toEqual([]);
  });

  it('accepts another loopback port only when loopback origins are allowed', async () => {
    const opts = project();
    const response = await serveVariantsRequest(opts, activate('http://localhost:4150'), { loopbackOrigins: true });
    expect(response.status).toBe(200);
    expect(readActive(opts)).toEqual(['v']);
  });
});
