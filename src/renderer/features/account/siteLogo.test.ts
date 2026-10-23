import { describe, expect, it } from 'vitest';
import { resolveSiteLogo } from './siteLogo';

const origin = 'https://lingsiai.vip';

describe('resolveSiteLogo', () => {
  it('keeps an image data URL from the site settings', () => {
    const logo = 'data:image/png;base64,iVBORw0KGgo=';
    expect(resolveSiteLogo(origin, logo)).toBe(logo);
  });

  it('resolves a root-relative logo against the packaged origin', () => {
    expect(resolveSiteLogo(`${origin}/`, '/uploads/logo.png')).toBe(`${origin}/uploads/logo.png`);
  });

  it('allows an https logo hosted outside the origin', () => {
    expect(resolveSiteLogo(origin, 'https://cdn.example.com/logo.png')).toBe('https://cdn.example.com/logo.png');
  });

  it('allows an http logo only on the same http origin', () => {
    expect(resolveSiteLogo('http://127.0.0.1:8080', 'http://127.0.0.1:8080/logo.png')).toBe('http://127.0.0.1:8080/logo.png');
    expect(resolveSiteLogo(origin, 'http://127.0.0.1:8080/logo.png')).toBe('');
  });

  it('rejects missing, script, and non-image values', () => {
    expect(resolveSiteLogo(origin, '')).toBe('');
    expect(resolveSiteLogo(origin, '   ')).toBe('');
    expect(resolveSiteLogo(origin, 'javascript:alert(1)')).toBe('');
    expect(resolveSiteLogo(origin, '//evil.example/logo.png')).toBe('');
    expect(resolveSiteLogo(origin, 'data:text/html,hi')).toBe('');
    expect(resolveSiteLogo('not a url', '/logo.png')).toBe('');
  });
});
