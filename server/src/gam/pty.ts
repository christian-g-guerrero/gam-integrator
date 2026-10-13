import * as nodePty from 'node-pty';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { findGamPath, isMock } from './detect.js';

/**
 * Interactive PTY sessions for the setup wizard and the command console.
 * `gam create project` / `gam oauth create` prompt the user, so they must run
 * under a real pseudo-terminal; output streams to the browser over WebSocket.
 */

// Official GAM7 install script (GAM-team/GAM). -l = update PATH/alias in shell rc.
export const GAM_INSTALL_CMD =
  'bash <(curl -s -S -L https://raw.githubusercontent.com/GAM-team/GAM/main/src/gam-install.sh)';

/** Every session kind the server spawns — a closed set, so nothing caller-supplied reaches a shell string. */
export type SessionKind = 'install' | 'create-project' | 'oauth' | 'serviceaccount' | 'console';

/** A running session with no browser attached for this long is killed (then removed like any exited one). */
export const IDLE_SESSION_MS = 30 * 60 * 1000;

export interface PtySession {
  id: string;
  kind: SessionKind;
  pty: nodePty.IPty;
  /** Scrollback so a WebSocket attaching after spawn still sees prior output. */
  buffer: string;
  exited: boolean;
  exitCode: number | null;
  listeners: Set<(msg: SessionEvent) => void>;
  createdAt: number;
  /** When the last listener detached (or spawn time), null while a browser is attached. Set by sweepIdleSessions. */
  idleSince: number | null;
}

export type SessionEvent = { type: 'data'; data: string } | { type: 'exit'; code: number };

const sessions = new Map<string, PtySession>();

function spawnPty(file: string, args: string[], kind: SessionKind): PtySession {
  const pty = nodePty.spawn(file, args, {
    name: 'xterm-256color',
    cols: 100,
    rows: 30,
    cwd: os.homedir(),
    env: { ...process.env, TERM: 'xterm-256color' } as { [k: string]: string },
  });
  const session: PtySession = {
    id: randomUUID(),
    kind,
    pty,
    buffer: '',
    exited: false,
    exitCode: null,
    listeners: new Set(),
    createdAt: Date.now(),
    idleSince: Date.now(),
  };
  pty.onData((data) => {
    session.buffer += data;
    if (session.buffer.length > 1_000_000) session.buffer = session.buffer.slice(-500_000);
    for (const l of session.listeners) l({ type: 'data', data });
  });
  pty.onExit(({ exitCode }) => {
    session.exited = true;
    session.exitCode = exitCode;
    for (const l of session.listeners) l({ type: 'exit', code: exitCode });
    // keep the session around briefly so the client can read the outcome
    setTimeout(() => sessions.delete(session.id), 10 * 60 * 1000);
  });
  sessions.set(session.id, session);
  return session;
}

function mockScript(kind: SessionKind): string {
  switch (kind) {
    case 'install':
      return 'echo "[mock] Downloading GAM7..."; sleep 1; echo "[mock] Installing to ~/bin/gam7..."; sleep 1; echo "[mock] GAM installed."';
    case 'create-project':
      return [
        'echo "[mock] gam create project"',
        'read -p "Enter your Google Workspace admin email address: " ADMIN',
        'echo "Setting up project gam-project-mock for $ADMIN"',
        'echo "Please go to: https://console.cloud.google.com/apis/credentials?project=gam-project-mock"',
        'read -p "Enter your Client ID: " CID',
        'read -p "Enter your Client Secret: " CSEC',
        'echo "Project created."',
      ].join('; ');
    case 'oauth':
      return [
        'echo "[mock] gam oauth create"',
        'echo "Go to this URL to authorize: https://accounts.google.com/o/oauth2/mock"',
        'read -p "Enter verification code: " CODE',
        'echo "OAuth authorized."',
      ].join('; ');
    case 'serviceaccount':
      return 'echo "[mock] Authorize domain-wide delegation at: https://admin.google.com/ac/owl/domainwidedelegation"; sleep 1; echo "Done."';
    case 'console':
      return 'echo "[mock console]"; sleep 1';
  }
}

export async function createInstallSession(): Promise<PtySession> {
  if (isMock()) return spawnPty('/bin/bash', ['-c', mockScript('install')], 'install');
  return spawnPty('/bin/bash', ['-c', GAM_INSTALL_CMD], 'install');
}

export async function createGamSession(kind: Exclude<SessionKind, 'install'>, gamArgs: string[]): Promise<PtySession> {
  if (isMock()) return spawnPty('/bin/bash', ['-c', mockScript(kind)], kind);
  const bin = await findGamPath();
  if (!bin) throw new Error('GAM binary not found — run the install step first.');
  return spawnPty(bin, gamArgs, kind);
}

/**
 * Kill running sessions nobody has watched for `idleMs` (a console tab closed without exiting).
 * Exited sessions are already removed 10 minutes after exit by spawnPty's onExit.
 */
export function sweepIdleSessions(now = Date.now(), idleMs = IDLE_SESSION_MS): number {
  let killed = 0;
  for (const s of sessions.values()) {
    if (s.exited) continue;
    if (s.listeners.size > 0) {
      s.idleSince = null;
      continue;
    }
    s.idleSince ??= now;
    if (now - s.idleSince >= idleMs) {
      s.pty.kill();
      killed += 1;
    }
  }
  return killed;
}

export function getSession(id: string): PtySession | undefined {
  return sessions.get(id);
}

export function listSessions(): {
  id: string;
  kind: string;
  exited: boolean;
  exitCode: number | null;
  createdAt: number;
}[] {
  return [...sessions.values()].map((s) => ({
    id: s.id,
    kind: s.kind,
    exited: s.exited,
    exitCode: s.exitCode,
    createdAt: s.createdAt,
  }));
}

export function killSession(id: string): boolean {
  const s = sessions.get(id);
  if (!s || s.exited) return false;
  s.pty.kill();
  return true;
}
