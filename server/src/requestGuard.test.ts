import { describe, expect, it } from 'vitest';
import { isAllowedHost, isAllowedOrigin } from './requestGuard.js';

describe('isAllowedHost', () => {
  it('accepts bare loopback hostnames', () => {
    expect(isAllowedHost('127.0.0.1')).toBe(true);
    expect(isAllowedHost('localhost')).toBe(true);
  });

  it('accepts loopback hostnames with a port', () => {
    expect(isAllowedHost('127.0.0.1:5199')).toBe(true);
    expect(isAllowedHost('localhost:5173')).toBe(true);
  });

  it('accepts bracketed IPv6 loopback, with or without a port', () => {
    expect(isAllowedHost('[::1]')).toBe(true);
    expect(isAllowedHost('[::1]:5199')).toBe(true);
  });

  it('rejects a public domain, even with a port', () => {
    expect(isAllowedHost('evil.example')).toBe(false);
    expect(isAllowedHost('evil.example:5199')).toBe(false);
  });

  it('rejects undefined/empty', () => {
    expect(isAllowedHost(undefined)).toBe(false);
    expect(isAllowedHost('')).toBe(false);
  });
});

describe('isAllowedOrigin', () => {
  it('accepts undefined (non-browser client)', () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
  });

  it('accepts the Vite dev origin', () => {
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true);
  });

  it('accepts loopback origins on any scheme/port', () => {
    expect(isAllowedOrigin('http://127.0.0.1:5199')).toBe(true);
    expect(isAllowedOrigin('https://127.0.0.1')).toBe(true);
    expect(isAllowedOrigin('http://[::1]:5199')).toBe(true);
  });

  it('rejects a foreign origin', () => {
    expect(isAllowedOrigin('https://evil.example')).toBe(false);
  });

  it('rejects the literal string "null" (opaque/sandboxed origin)', () => {
    expect(isAllowedOrigin('null')).toBe(false);
  });

  it('rejects unparseable garbage', () => {
    expect(isAllowedOrigin('not a url')).toBe(false);
  });
});
