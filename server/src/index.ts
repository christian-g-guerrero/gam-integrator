import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { setupRouter } from './routes/setup.js';
import { usersRouter } from './routes/users.js';
import { filesRouter } from './routes/files.js';
import { transferRouter } from './routes/transfer.js';
import { jobsRouter } from './routes/jobs.js';
import { consoleRouter } from './routes/console.js';
import { mailRouter } from './routes/mail.js';
import { dashboardRouter } from './routes/dashboard.js';
import { storageRouter } from './routes/storage.js';
import { getSession, sweepIdleSessions } from './gam/pty.js';
import { isMock } from './gam/detect.js';
import { isAllowedHost, isAllowedOrigin } from './requestGuard.js';
import { LOG_DIR, liveJobIds } from './jobs.js';
import { DAY_MS, JOB_LOG_RETENTION_DAYS, pruneDir } from './retention.js';

// API_PORT (not PORT) so dev-harness-assigned PORT values only affect the Vite client.
const PORT = Number(process.env.API_PORT ?? 5199);
const HOST = '127.0.0.1'; // super-admin tool: never expose beyond this machine

const app = express();
app.use(express.json());

// Rejecting a non-loopback Host defeats DNS rebinding (an attacker-controlled
// hostname re-pointed at 127.0.0.1, which a browser then treats as same-origin
// with this API); rejecting a foreign Origin defeats cross-site fetch/WebSocket.
app.use((req, res, next) => {
  if (!isAllowedHost(req.headers.host)) {
    return res.status(403).json({ error: 'Forbidden: bad Host header' });
  }
  const origin = req.headers.origin;
  if (origin !== undefined && !isAllowedOrigin(origin)) {
    return res.status(403).json({ error: 'Forbidden: cross-origin request' });
  }
  next();
});

app.use('/api/setup', setupRouter);
app.use('/api/users', usersRouter);
app.use('/api/users', filesRouter);
app.use('/api/transfer', transferRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/console', consoleRouter);
app.use('/api/mail', mailRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/storage', storageRouter);

// Serve the built client in production (npm run build && npm start).
const clientDist = path.resolve(fileURLToPath(import.meta.url), '../../../client/dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // `root` keeps Express 5's dotfile check to the relative part — a checkout under a dot-directory
  // (e.g. a clone inside a hidden folder) would otherwise 404 every page.
  app.get(/^\/(?!api|ws).*/, (_req, res) => res.sendFile('index.html', { root: clientDist }));
}

// Error handler — surface GAM stderr to the UI.
app.use(
  (err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.message });
  },
);

const server = createServer(app);

// PTY terminal transport: /ws/pty/<sessionId>
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (!isAllowedHost(req.headers.host) || !isAllowedOrigin(req.headers.origin)) {
    socket.destroy();
    return;
  }
  const url = new URL(req.url ?? '/', 'http://localhost');
  const match = url.pathname.match(/^\/ws\/pty\/([a-f0-9-]+)$/);
  if (!match) {
    socket.destroy();
    return;
  }
  const session = getSession(match[1]);
  if (!session) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.send(JSON.stringify({ type: 'data', data: session.buffer }));
    if (session.exited) {
      ws.send(JSON.stringify({ type: 'exit', code: session.exitCode ?? -1 }));
    }
    const listener = (msg: unknown) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };
    session.listeners.add(listener);
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'input' && typeof msg.data === 'string' && !session.exited) {
          session.pty.write(msg.data);
        } else if (msg.type === 'resize' && msg.cols && msg.rows && !session.exited) {
          session.pty.resize(Number(msg.cols), Number(msg.rows));
        }
      } catch {
        /* ignore malformed frames */
      }
    });
    ws.on('close', () => session.listeners.delete(listener));
  });
});

server.listen(PORT, HOST, () => {
  console.log(`GAM Integrator server on http://${HOST}:${PORT}${isMock() ? ' (GAM_MOCK mode)' : ''}`);
});

// Housekeeping: job logs are diagnostics (auto-pruned); idle console PTYs are killed. Exports are
// never auto-deleted — that's a user action in Settings (routes/storage.ts).
const pruneJobLogs = () => {
  const live = liveJobIds();
  pruneDir(LOG_DIR, { olderThanDays: JOB_LOG_RETENTION_DAYS, protect: (name) => live.has(name.replace(/\.log$/, '')) });
};
pruneJobLogs();
setInterval(pruneJobLogs, DAY_MS).unref();
setInterval(() => sweepIdleSessions(), 5 * 60 * 1000).unref();
