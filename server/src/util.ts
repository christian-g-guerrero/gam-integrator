import type { Request, Response, NextFunction, RequestHandler } from 'express';

/** Route params here are only named `:segments`, so always strings (Express 5 types allow string[] for wildcards). */
type Params = Record<string, string>;

/** Wrap an async handler so rejections hit the express error middleware (Express 5 also does this itself). */
export function h(fn: (req: Request<Params>, res: Response) => Promise<unknown> | unknown): RequestHandler<Params> {
  return (req: Request<Params>, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Drive file ids are url-safe base64-ish; mock ids include underscores.
const FILE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function requireEmail(v: unknown, label = 'email'): string {
  if (typeof v !== 'string' || !EMAIL_RE.test(v)) throw badRequest(`Invalid ${label}: ${String(v)}`);
  return v;
}

export function requireFileId(v: unknown, label = 'file id'): string {
  if (typeof v !== 'string' || !FILE_ID_RE.test(v)) throw badRequest(`Invalid ${label}: ${String(v)}`);
  return v;
}

export function badRequest(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 400 });
}
