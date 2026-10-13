import { Router } from 'express';
import { parseConsoleCommand } from '../gam/guard.js';
import { createGamSession } from '../gam/pty.js';
import { h } from '../util.js';

export const consoleRouter = Router();

/**
 * Run a gam command in a PTY (interactive-safe). Destructive commands must be
 * re-submitted with confirmed:true — the client shows a confirmation modal.
 */
consoleRouter.post(
  '/run',
  h(async (req, res) => {
    const command = String(req.body?.command ?? '');
    const confirmed = Boolean(req.body?.confirmed);
    let parsed;
    try {
      parsed = parseConsoleCommand(command);
    } catch (e) {
      throw Object.assign(e as Error, { status: 400 });
    }
    const { args, destructive } = parsed;
    if (destructive && !confirmed) {
      return res.status(409).json({ needsConfirmation: true, command });
    }
    const session = await createGamSession('console', args);
    res.json({ sessionId: session.id });
  }),
);
