import { describe, expect, it } from 'vitest';

import { checkOrigin, checkRequest } from '../../src/node/http';
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

describe('checkRequest, the gate isotone serve and the Vite plugin share', () => {
  const local = { host: '127.0.0.1:4123', remoteAddress: '127.0.0.1' };

  it('refuses a peer on another machine whatever Host and forwarding headers it claims', () => {
    for (const remoteAddress of ['192.168.1.20', '::ffff:192.168.1.20', '10.0.0.5', null]) {
      for (const claims of [{}, { host: 'localhost:4123' }, { forwardedFor: '127.0.0.1' }, { forwarded: 'for=127.0.0.1' }]) {
        expect(() => checkRequest({ ...local, ...claims, remoteAddress }), `${remoteAddress} ${JSON.stringify(claims)}`).toThrow(
          'only requests from this machine',
        );
      }
    }
  });

  it('refuses a local peer forwarding for another machine, or under a LAN or rebinding Host', () => {
    expect(() => checkRequest({ ...local, forwardedFor: '203.0.113.9' })).toThrow('only requests from this machine');
    expect(() => checkRequest({ ...local, forwarded: 'for="[2001:db8::1]";proto=https' })).toThrow('only requests from this machine');
    for (const host of ['192.168.1.10:4123', 'rebind.attacker.example:4123', 'evil.test:4123', '']) {
      expect(() => checkRequest({ ...local, host }), host).toThrow('host not allowed');
    }
  });

  it('accepts this machine under its local names and loopback addresses', () => {
    for (const remoteAddress of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      for (const host of ['127.0.0.1:4123', 'localhost:4123', '[::1]:4123', 'app.localhost:4123']) {
        expect(() => checkRequest({ host, remoteAddress, forwardedFor: '127.0.0.1, ::1' }), `${remoteAddress} ${host}`).not.toThrow();
      }
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
