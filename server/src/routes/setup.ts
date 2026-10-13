import { Router } from 'express';
import { getGamStatus } from '../gam/detect.js';
import { invalidateGamPath, runGam } from '../gam/runner.js';
import { createGamSession, createInstallSession, killSession, GAM_INSTALL_CMD } from '../gam/pty.js';
import { loadState, saveState } from '../state.js';
import { h, badRequest, requireEmail } from '../util.js';

export const setupRouter = Router();

setupRouter.get(
  '/status',
  h(async (_req, res) => {
    invalidateGamPath(); // re-detect every time; setup changes things under us
    const gam = await getGamStatus();
    res.json({ gam, state: loadState(), installCmd: GAM_INSTALL_CMD });
  }),
);

setupRouter.post(
  '/state',
  h((req, res) => {
    const { adminEmail, completedSteps, setupDone } = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (adminEmail !== undefined)
      patch.adminEmail = adminEmail === null ? null : requireEmail(adminEmail, 'admin email');
    if (Array.isArray(completedSteps)) patch.completedSteps = completedSteps.map(String);
    if (typeof setupDone === 'boolean') patch.setupDone = setupDone;
    res.json(saveState(patch));
  }),
);

/** Start an interactive wizard step in a PTY; returns a session id for the terminal WebSocket. */
setupRouter.post(
  '/session',
  h(async (req, res) => {
    const step = String(req.body?.step ?? '');
    let session;
    if (step === 'install') {
      session = await createInstallSession();
    } else if (step === 'create-project') {
      session = await createGamSession('create-project', ['create', 'project']);
    } else if (step === 'oauth') {
      session = await createGamSession('oauth', ['oauth', 'create']);
    } else if (step === 'serviceaccount') {
      const admin = requireEmail(loadState().adminEmail, 'admin email (set it in the wizard first)');
      session = await createGamSession('serviceaccount', ['user', admin, 'update', 'serviceaccount']);
    } else {
      throw badRequest(`Unknown wizard step: ${step}`);
    }
    res.json({ sessionId: session.id });
  }),
);

setupRouter.post(
  '/session/:id/kill',
  h((req, res) => {
    res.json({ killed: killSession(req.params.id) });
  }),
);

/** Non-interactive verification of the finished setup. */
setupRouter.post(
  '/verify',
  h(async (_req, res) => {
    invalidateGamPath();
    const state = loadState();
    const results: { check: string; ok: boolean; output: string }[] = [];
    const tryRun = async (check: string, args: string[]) => {
      try {
        const out = await runGam(args);
        results.push({ check, ok: true, output: out.slice(0, 4000) });
      } catch (e) {
        results.push({ check, ok: false, output: (e as Error).message.slice(0, 4000) });
      }
    };
    await tryRun('GAM version', ['version']);
    await tryRun('Domain info (OAuth)', ['info', 'domain']);
    if (state.adminEmail) {
      await tryRun('Service account (domain-wide delegation)', ['user', state.adminEmail, 'check', 'serviceaccount']);
    }
    const allOk = results.every((r) => r.ok);
    // Reflects the latest run: a failed re-verification un-marks setup as done.
    saveState({ setupDone: allOk });
    res.json({ ok: allOk, results });
  }),
);
