import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const pExecFile = promisify(execFile);

export interface GamStatus {
  installed: boolean;
  gamPath: string | null;
  version: string | null;
  /** `gam oauth info` succeeds — admin OAuth is set up */
  oauthReady: boolean;
  /** `gam info domain` succeeds — project + oauth working end to end */
  configured: boolean;
  mock: boolean;
}

const CANDIDATE_PATHS = [
  path.join(os.homedir(), 'bin', 'gam7', 'gam'),
  path.join(os.homedir(), 'bin', 'gamadv-xtd3', 'gam'),
  path.join(os.homedir(), 'bin', 'gam', 'gam'),
  '/usr/local/bin/gam',
  '/opt/homebrew/bin/gam',
];

export function isMock(): boolean {
  return process.env.GAM_MOCK === '1';
}

/**
 * Root dir for persisted state/cache (setup wizard state, stats cache, mail
 * storage cache, job logs, exports). Mock runs get their own subdirectory so
 * they never read or overwrite real Workspace data on disk.
 */
export function dataDir(): string {
  return isMock() ? path.join(os.homedir(), '.gam-integrator', 'mock') : path.join(os.homedir(), '.gam-integrator');
}

export async function findGamPath(): Promise<string | null> {
  for (const p of CANDIDATE_PATHS) {
    if (existsSync(p)) return p;
  }
  try {
    const { stdout } = await pExecFile('/usr/bin/which', ['gam']);
    const p = stdout.trim();
    if (p) return p;
  } catch {
    /* not on PATH */
  }
  return null;
}

export async function getGamStatus(): Promise<GamStatus> {
  if (isMock()) {
    return {
      installed: true,
      gamPath: '(mock)',
      version: 'GAM 7.mock',
      oauthReady: true,
      configured: true,
      mock: true,
    };
  }
  const gamPath = await findGamPath();
  if (!gamPath) {
    return { installed: false, gamPath: null, version: null, oauthReady: false, configured: false, mock: false };
  }
  let version: string | null;
  try {
    const { stdout } = await pExecFile(gamPath, ['version'], { timeout: 15000 });
    version = stdout.split('\n')[0]?.trim() ?? null;
  } catch {
    return { installed: false, gamPath, version: null, oauthReady: false, configured: false, mock: false };
  }
  let oauthReady = false;
  let configured = false;
  try {
    await pExecFile(gamPath, ['oauth', 'info'], { timeout: 20000 });
    oauthReady = true;
    await pExecFile(gamPath, ['info', 'domain'], { timeout: 30000 });
    configured = true;
  } catch {
    /* partial setup */
  }
  return { installed: true, gamPath, version, oauthReady, configured, mock: false };
}
