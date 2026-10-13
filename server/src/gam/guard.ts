/**
 * Safety checks for GAM commands typed into the console.
 * Commands always execute via execFile/pty with an argv array — never a shell —
 * so quoting/injection is not a concern here; this guard is about intent.
 */

const DESTRUCTIVE_VERBS = [
  'delete',
  'del',
  'wipe',
  'purge',
  'trash',
  'empty', // `empty drivetrash` and similar
  'remove',
  'clear',
  'undelete',
  'deprovision',
  'suspend',
  'suspended', // argument form: `update user x suspended on` (also flags the un-suspend form — acceptable)
  'archive',
  'password', // password resets are account-takeover-grade
  'revoke', // token/ASP revocation
  'expire', // session/token expiry
  'cancel', // cancelling in-progress operations (e.g. data transfers)
];

/** Split a console command line into argv tokens (supports quotes). */
export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  return tokens;
}

/**
 * Validate a console command. Returns the gam argv (without the leading "gam")
 * or throws. Only `gam ...` commands are allowed; shell metacharacters are
 * rejected outright since nothing here should ever need them.
 */
export function parseConsoleCommand(line: string): { args: string[]; destructive: boolean } {
  const trimmed = line.trim();
  if (/[;&|<>`$\\]/.test(trimmed)) {
    throw new Error('Shell operators are not allowed — enter a single gam command.');
  }
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) throw new Error('Empty command.');
  if (tokens[0].toLowerCase() !== 'gam') {
    throw new Error('Only gam commands are allowed. Start your command with "gam".');
  }
  const args = tokens.slice(1);
  if (args.length === 0) throw new Error('Enter a gam command, e.g. "gam info domain".');
  const destructive = isDestructive(args);
  return { args, destructive };
}

export function isDestructive(args: string[]): boolean {
  return args.some((a) => DESTRUCTIVE_VERBS.includes(a.toLowerCase()));
}
