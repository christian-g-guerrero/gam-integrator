import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dataDir } from './gam/detect.js';

/** Wizard/app state persisted across restarts (~/.gam-integrator/state.json). */
export interface AppState {
  adminEmail: string | null;
  /** Wizard steps the user has explicitly completed. */
  completedSteps: string[];
  setupDone: boolean;
}

const FILE = path.join(dataDir(), 'state.json');

const DEFAULT_STATE: AppState = { adminEmail: null, completedSteps: [], setupDone: false };

export function loadState(): AppState {
  try {
    return { ...DEFAULT_STATE, ...JSON.parse(readFileSync(FILE, 'utf8')) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function saveState(patch: Partial<AppState>): AppState {
  const next = { ...loadState(), ...patch };
  mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(next, null, 2));
  return next;
}
