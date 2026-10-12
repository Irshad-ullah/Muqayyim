import { maskDeep, maskString, maskMessage, maskStack, REDACTED } from '../backend/utils/mask.js';

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxMjMifQ.c2lnbmF0dXJlLXNpZ25hdHVyZQ';

describe('maskDeep', () => {
  test('redacts sensitive keys at any depth, in objects and arrays', () => {
    const input = {
      user: { email: 'a@b.co', password: 'hunter2', profile: { apiKey: 'k1', api_key: 'k2', 'api-key': 'k3' } },
      headers: { Authorization: 'Bearer abc', cookie: 'sid=1', 'X-Internal-Key': 'secret-key' },
      items: [{ token: 't1' }, { nested: [{ refreshToken: 't2', clientSecret: 's' }] }],
      passwd: 'kept-name-does-not-match',
      count: 3,
    };
    const out = maskDeep(input);
    expect(out.user.password).toBe(REDACTED);
    expect(out.user.email).toBe('a@b.co');
    expect(out.user.profile).toEqual({ apiKey: REDACTED, api_key: REDACTED, 'api-key': REDACTED });
    expect(out.headers).toEqual({ Authorization: REDACTED, cookie: REDACTED, 'X-Internal-Key': REDACTED });
    expect(out.items[0].token).toBe(REDACTED);
    expect(out.items[1].nested[0]).toEqual({ refreshToken: REDACTED, clientSecret: REDACTED });
    expect(out.count).toBe(3);
    expect(input.user.password).toBe('hunter2'); // original untouched
  });

  test('is cycle-safe', () => {
    const a = { name: 'x' };
    a.self = a;
    expect(() => maskDeep(a)).not.toThrow();
  });
});

describe('maskString / messages', () => {
  test('redacts JWTs in messages', () => {
    expect(maskString(`jwt malformed: ${JWT} rejected`)).toBe('jwt malformed: [REDACTED_JWT] rejected');
  });

  test('redacts bearer tokens, URL credentials and key=value secrets', () => {
    expect(maskString('Authorization: Bearer abc.def.ghi')).not.toMatch(/abc\.def\.ghi/);
    expect(maskString('connect mongodb://admin:S3cret!@db.example.com:27017/core_db failed'))
      .toBe(`connect mongodb://admin:${REDACTED}@db.example.com:27017/core_db failed`);
    expect(maskString('SMTP login failed for user=bob password=hunter2 host=smtp')).toBe(
      `SMTP login failed for user=bob password=${REDACTED} host=smtp`,
    );
    expect(maskString('token: "abc123" api_key=XYZ')).toBe(`token: ${REDACTED} api_key=${REDACTED}`);
  });

  test('messages and stacks are truncated (1000 / 4000)', () => {
    expect(maskMessage('x'.repeat(5000))).toHaveLength(1000);
    expect(maskStack('y'.repeat(9000))).toHaveLength(4000);
    expect(maskStack(undefined)).toBeUndefined();
  });
});
