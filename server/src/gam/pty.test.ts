import { describe, expect, it, vi } from 'vitest';

// A fake node-pty: records kills and lets the test fire exit.
const kills: string[] = [];
vi.mock('node-pty', () => ({
  spawn: () => {
    const self = {
      onData: () => {},
      onExit: () => {},
      kill: () => kills.push('killed'),
    };
    return self;
  },
}));
vi.mock('./detect.js', () => ({ isMock: () => true, findGamPath: async () => null }));

const { createGamSession, sweepIdleSessions, IDLE_SESSION_MS } = await import('./pty.js');

describe('sweepIdleSessions', () => {
  it('kills a session nobody has watched for the idle window, never one with a listener', async () => {
    const t0 = Date.now();
    const watched = await createGamSession('console', []);
    const orphan = await createGamSession('console', []);
    watched.listeners.add(() => {});
    orphan.idleSince = t0;

    expect(sweepIdleSessions(t0 + IDLE_SESSION_MS - 1)).toBe(0);
    expect(sweepIdleSessions(t0 + IDLE_SESSION_MS)).toBe(1);
    expect(kills).toHaveLength(1);
    expect(watched.idleSince).toBeNull();
  });
});
