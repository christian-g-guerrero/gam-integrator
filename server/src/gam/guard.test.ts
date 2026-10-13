import { describe, expect, it } from 'vitest';
import { parseConsoleCommand, tokenize, isDestructive } from './guard.js';

describe('tokenize', () => {
  it('splits on whitespace and respects quotes', () => {
    expect(tokenize('gam user a@b.com print filelist')).toEqual(['gam', 'user', 'a@b.com', 'print', 'filelist']);
    expect(tokenize('gam user a@b.com update drivefile 1 newfilename "My File"')).toContain('My File');
  });
});

describe('parseConsoleCommand', () => {
  it('accepts gam commands and strips the leading gam', () => {
    expect(parseConsoleCommand('gam info domain')).toEqual({ args: ['info', 'domain'], destructive: false });
  });

  it('rejects non-gam commands', () => {
    expect(() => parseConsoleCommand('rm -rf /')).toThrow(/Only gam commands/);
    expect(() => parseConsoleCommand('bash -c gam')).toThrow(/Only gam commands/);
  });

  it('rejects shell metacharacters (no injection surface)', () => {
    expect(() => parseConsoleCommand('gam info domain; rm -rf /')).toThrow(/Shell operators/);
    expect(() => parseConsoleCommand('gam info domain | tee /etc/passwd')).toThrow(/Shell operators/);
    expect(() => parseConsoleCommand('gam print users > out.csv')).toThrow(/Shell operators/);
    expect(() => parseConsoleCommand('gam $(whoami)')).toThrow(/Shell operators/);
  });

  it('rejects empty and bare gam', () => {
    expect(() => parseConsoleCommand('')).toThrow();
    expect(() => parseConsoleCommand('gam')).toThrow(/Enter a gam command/);
  });

  const DESTRUCTIVE_EXAMPLES: string[] = [
    'gam user a@b.com delete drivefile 123',
    'gam user a@b.com trash drivefile 123',
    'gam user a@b.com empty drivetrash',
    'gam update user a@b.com suspended on',
    'gam update user a@b.com password random',
    'gam user a@b.com deprovision',
    'gam user a@b.com wipe',
  ];
  const SAFE_EXAMPLES: string[] = [
    'gam user a@b.com show filelist',
    'gam info domain',
    'gam print users',
    'gam user a@b.com show tokens',
  ];

  it.each(DESTRUCTIVE_EXAMPLES)('flags destructive command: %s', (cmd) => {
    expect(parseConsoleCommand(cmd).destructive).toBe(true);
  });

  it.each(SAFE_EXAMPLES)('does not flag safe command: %s', (cmd) => {
    expect(parseConsoleCommand(cmd).destructive).toBe(false);
  });
});

describe('isDestructive', () => {
  it('matches verbs case-insensitively', () => {
    expect(isDestructive(['user', 'x@y.com', 'DELETE', 'drivefile', '1'])).toBe(true);
    expect(isDestructive(['print', 'users'])).toBe(false);
  });
});
