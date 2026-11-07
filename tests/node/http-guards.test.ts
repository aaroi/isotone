import { describe, expect, it } from 'vitest';

import { checkOrigin } from '../../src/node/http';
import { updateRequestOf } from '../../src/node/update/request';

describe('checkOrigin', () => {
  it('accepts only http and https pages on the expected host', () => {
    expect(() => checkOrigin('http://127.0.0.1:5173', '127.0.0.1:5173')).not.toThrow();
    expect(() => checkOrigin('https://127.0.0.1:5173', '127.0.0.1:5173')).not.toThrow();
    for (const origin of ['ws://127.0.0.1:5173', 'ftp://127.0.0.1:5173', 'file:///', 'null']) {
      expect(() => checkOrigin(origin, '127.0.0.1:5173'), origin).toThrow('origin not allowed');
      expect(() => checkOrigin(origin, '127.0.0.1:5173', true), origin).toThrow('origin not allowed');
    }
  });
});

describe('a stored update request', () => {
  const request = (changelog: string) => ({
    from: '1.1.3',
    to: '1.2.0',
    command: 'npm install -D --save-exact isotone@1.2.0',
    cwd: '/project',
    manager: 'npm',
    changelog,
  });

  it('keeps only an https changelog link', () => {
    expect(updateRequestOf(request('https://github.com/aaroi/isotone/blob/v1.2.0/CHANGELOG.md'))).not.toBeNull();
    for (const link of ['http://example.com/CHANGELOG.md', 'javascript:alert(1)', 'file:///etc/passwd']) {
      expect(updateRequestOf(request(link)), link).toBeNull();
    }
  });
});
