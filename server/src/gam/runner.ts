import { execFile, spawn, ChildProcess } from 'node:child_process';
import { findGamPath, isMock } from './detect.js';
import { parseGamCsv } from './csv.js';
import * as mock from './mock.js';

export class GamError extends Error {
  constructor(
    message: string,
    public stderr: string = '',
    public code: number | null = null,
  ) {
    super(message);
  }
}

let cachedPath: string | null = null;

export async function gamPath(): Promise<string> {
  if (cachedPath) return cachedPath;
  const p = await findGamPath();
  if (!p) throw new GamError('GAM is not installed. Complete the setup wizard first.');
  cachedPath = p;
  return p;
}

export function invalidateGamPath(): void {
  cachedPath = null;
}

const RUN_TIMEOUT_MS = 10 * 60 * 1000;

/** Run a non-interactive GAM command; resolves with stdout. argv only, never a shell. */
export function runGam(args: string[]): Promise<string> {
  if (isMock()) return mock.run(args);
  return gamPath().then(
    (bin) =>
      new Promise<string>((resolve, reject) => {
        execFile(
          bin,
          args,
          { timeout: RUN_TIMEOUT_MS, maxBuffer: 512 * 1024 * 1024, env: gamEnv() },
          (err, stdout, stderr) => {
            if (err) {
              const code =
                typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === 'number'
                  ? (err as unknown as { code: number }).code
                  : null;
              // GAM writes harmless progress lines to stderr ("Getting all…");
              // don't let them mask the actual failure reason.
              const meaningful = (stderr ?? '')
                .split('\n')
                .filter((l) => l.trim() && !/^(Getting|Got) /.test(l))
                .join('\n')
                .trim();
              reject(new GamError(meaningful || err.message, stderr ?? '', code));
            } else {
              resolve(stdout);
            }
          },
        );
      }),
  );
}

/**
 * Prefix a CSV-producing command so GAM writes plain RFC 4180 CSV. By default
 * GAM's writer uses `\\` as an escape char and doubles every backslash in every
 * field (on top of `""` quote-doubling), which no standard CSV parser undoes —
 * bodies/subjects/filenames came back with `\\` for `\`.
 */
export function csvArgs(args: string[]): string[] {
  return ['config', 'csv_output_no_escape_char', 'true', ...args];
}

/** Run a GAM command whose output is CSV and parse it. */
export async function runGamCsv(args: string[]): Promise<Record<string, string>[]> {
  const out = await runGam(csvArgs(args));
  return parseGamCsv(out);
}

/** Raw CSV text (for direct download streaming). */
export async function runGamCsvRaw(args: string[]): Promise<string> {
  return runGam(csvArgs(args));
}

export interface StreamHandle {
  child: ChildProcess | null;
  cancel(): void;
}

/**
 * Spawn a long-running GAM command, invoking onLine per stdout/stderr line.
 * Used by the jobs system to surface per-file progress.
 */
export async function streamGam(
  args: string[],
  onLine: (line: string, stream: 'stdout' | 'stderr') => void,
): Promise<{ handle: StreamHandle; done: Promise<number> }> {
  if (isMock()) return mock.stream(args, onLine);
  const bin = await gamPath();
  const child = spawn(bin, args, { env: gamEnv() });
  const handle: StreamHandle = {
    child,
    cancel() {
      child.kill('SIGTERM');
    },
  };
  const wire = (stream: NodeJS.ReadableStream, name: 'stdout' | 'stderr') => {
    let buf = '';
    stream.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        onLine(buf.slice(0, idx).replace(/\r$/, ''), name);
        buf = buf.slice(idx + 1);
      }
    });
    stream.on('end', () => {
      if (buf.trim()) onLine(buf, name);
    });
  };
  wire(child.stdout!, 'stdout');
  wire(child.stderr!, 'stderr');
  const done = new Promise<number>((resolve) => {
    child.on('close', (code) => resolve(code ?? -1));
  });
  return { handle, done };
}

function gamEnv(): NodeJS.ProcessEnv {
  // GAM reads its config from GAMCFGDIR if set; inherit everything else.
  return { ...process.env };
}
