import { useCallback, useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface TermProps {
  sessionId: string;
  height?: number;
  onExit?: (code: number) => void;
  /** Receives raw output chunks (used by the wizard to detect URLs). */
  onOutput?: (data: string) => void;
}

/** Used only if the theme's monospace token is somehow unset (xterm needs a concrete font string). */
const FALLBACK_MONO = 'ui-monospace, Menlo, Monaco, monospace';

/** The theme's monospace stack (Pastel Retro sets IBM Plex Mono), read off <html> as a concrete string. */
function themeMonospace(): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue('--mantine-font-family-monospace').trim() ||
    FALLBACK_MONO
  );
}

/** xterm.js terminal bound to a server PTY session over WebSocket. */
export function Term({ sessionId, height = 380, onExit, onOutput }: TermProps) {
  const ref = useRef<HTMLDivElement>(null);
  const cbRef = useRef({ onExit, onOutput });
  cbRef.current = { onExit, onOutput };

  // Build the xterm theme from the terminal role tokens (App.css defaults, repointed
  // per skin) — xterm needs concrete colour strings; it can't read CSS variables.
  const buildTermTheme = useCallback(() => {
    const s = getComputedStyle(document.documentElement);
    const cv = (name: string) => s.getPropertyValue(name).trim();
    const theme: Record<string, string> = {};
    for (const [channel, token] of [
      ['background', '--surface-terminal'],
      ['foreground', '--text-on-terminal'],
      ['cursor', '--text-on-terminal'],
      ['green', '--term-ok'],
      ['red', '--term-error'],
      ['yellow', '--term-command'],
      ['brightBlack', '--term-dim'],
    ] as const) {
      const c = cv(token);
      if (c) theme[channel] = c;
    }
    return theme;
  }, []);

  useEffect(() => {
    const el = ref.current!;
    const term = new Terminal({
      convertEol: true,
      fontSize: 13,
      fontFamily: themeMonospace(),
      cursorBlink: true,
      theme: buildTermTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    // Fit only once the renderer has laid out: fitting synchronously after open() is what threw
    // xterm's `reading 'dimensions'` error. A zero-size container (hidden tab) can still throw — skip it.
    const sendSize = () => {
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };
    let frame = 0;
    const refit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!el.clientWidth || !el.clientHeight) return;
        try {
          fit.fit();
        } catch {
          return;
        }
        sendSize();
      });
    };

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/pty/${sessionId}`);
    let deliberateClose = false; // set just before we close it ourselves (unmount) so onclose doesn't also report it
    ws.onopen = refit;
    ws.onmessage = (e) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped wire frame, checked field by field below
      let msg: any;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return; // drop malformed frames
      }
      if (msg.type === 'data') {
        term.write(msg.data);
        cbRef.current.onOutput?.(msg.data);
      } else if (msg.type === 'exit') {
        term.write(`\r\n\x1b[2m[process exited with code ${msg.code}]\x1b[0m\r\n`);
        cbRef.current.onExit?.(msg.code);
      }
    };
    ws.onerror = () => {
      if (!deliberateClose) term.write('\r\n\x1b[2m[connection error]\x1b[0m\r\n');
    };
    ws.onclose = () => {
      if (!deliberateClose) term.write('\r\n\x1b[2m[connection closed]\x1b[0m\r\n');
    };
    term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data: d }));
    });

    // Refit on any container resize (window, panel, layout shift), not just window resizes.
    const observer = new ResizeObserver(refit);
    observer.observe(el);
    refit();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      deliberateClose = true;
      ws.close();
      term.dispose();
    };
  }, [sessionId, buildTermTheme]);

  // The wrapper reads the token directly (CSS resolves it), so it matches the
  // xterm canvas. The terminal adopts the active skin's colours when it mounts;
  // switching skins with a terminal already open repaints it on next mount.
  return (
    <div
      ref={ref}
      style={{
        height,
        background: 'var(--surface-terminal)',
        borderRadius: 'var(--mantine-radius-md)',
        padding: 'var(--mantine-spacing-xs)',
      }}
    />
  );
}
