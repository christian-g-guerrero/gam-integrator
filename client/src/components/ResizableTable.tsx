import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Table, TableProps } from '@mantine/core';
import './ResizableTable.css';

interface ResizeCtxValue {
  widths: Record<string, number>;
  setLive: (w: Record<string, number>) => void;
  commit: () => void;
  reset: () => void;
}

const ResizeCtx = createContext<ResizeCtxValue | null>(null);

const MIN_WIDTH = 56;

/**
 * Mantine Table whose ResizableTh/SortableTh headers get a drag handle on
 * their right edge. Until a column is dragged the table lays out exactly as
 * before (auto layout); the first drag freezes every resizable column at its
 * rendered width and switches to fixed layout so only the dragged edge moves.
 * Widths persist per table via localStorage; double-clicking a handle resets
 * the whole table to automatic layout. Renders inside a TableFrame, which
 * scrolls sideways and carries the `withTableBorder` border.
 */
export function ResizableTable({
  storageKey,
  style,
  withTableBorder,
  children,
  ...props
}: TableProps & { storageKey: string; children: ReactNode }) {
  const lsKey = `gam-integrator:colw:${storageKey}`;
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem(lsKey) ?? '{}') as Record<string, number>;
    } catch {
      return {};
    }
  });
  // Ref mirrors the latest widths synchronously — commit() can fire in the
  // same tick as the final setLive(), before React has re-rendered.
  const latest = useRef(widths);

  const ctx = useMemo<ResizeCtxValue>(
    () => ({
      widths,
      setLive: (w) => {
        latest.current = w;
        setWidths(w);
      },
      commit: () => localStorage.setItem(lsKey, JSON.stringify(latest.current)),
      reset: () => {
        latest.current = {};
        setWidths({});
        localStorage.removeItem(lsKey);
      },
    }),
    [widths, lsKey],
  );

  const resized = Object.keys(widths).length > 0;

  // Fixed layout needs a definite table width (with width:auto browsers fall
  // back to the auto algorithm and treat column widths as mere hints), so pin
  // the table to the sum of its column widths. Runs every render — cheap, and
  // it keeps up with columns appearing/disappearing (e.g. the Location column
  // in the file browser's flat view).
  const tableRef = useRef<HTMLTableElement>(null);
  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    if (!resized) {
      table.style.width = '';
      return;
    }
    let total = 0;
    table.querySelectorAll<HTMLTableCellElement>('thead th').forEach((th) => {
      const managed = th.dataset.col ? widths[th.dataset.col] : undefined;
      total += managed ?? (parseFloat(th.style.width) || Math.max(th.getBoundingClientRect().width, MIN_WIDTH));
    });
    table.style.width = `${Math.round(total)}px`;
  });

  return (
    <ResizeCtx.Provider value={ctx}>
      {/* Pinned widths can make the table narrower than the page: `fit` shrinks the frame to it
          (and stops a flex parent stretching it back, which would redistribute the dragged pixels). */}
      <TableFrame bordered={withTableBorder} fit={resized}>
        <Table
          {...props}
          ref={tableRef}
          className={['gam-resizable-table', props.className].filter(Boolean).join(' ')}
          data-resized={resized || undefined}
          style={{ ...(style as CSSProperties), ...(resized ? { tableLayout: 'fixed' } : null) }}
        >
          {children}
        </Table>
      </TableFrame>
    </ResizeCtx.Provider>
  );
}

/**
 * Horizontal-scroll box for a table. The border (and each skin's table outline) is drawn on this frame,
 * not on the <table>, so it always closes on the right — even while the table is scrolled and its own
 * right edge is out of view. A soft shadow marks each edge that has columns scrolled out of sight.
 * ResizableTable uses it; modal tables that may scroll sideways wrap a plain Table in it.
 */
export function TableFrame({
  bordered = true,
  fit = false,
  children,
}: {
  /** Draw the frame's border (the Table's `withTableBorder`, moved out here). */
  bordered?: boolean;
  /** Shrink to the table's width instead of filling the row (fixed-layout tables narrower than the page). */
  fit?: boolean;
  children: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Flags which edges have hidden columns. Written straight to the DOM (no re-render per scroll
  // event); re-checked when the box or the table resizes (rows loading, columns dragged, window resized).
  useEffect(() => {
    const frame = frameRef.current;
    const scroller = scrollRef.current;
    if (!frame || !scroller) return;
    const update = () => {
      frame.style.setProperty('--gam-table-view-w', `${scroller.clientWidth}px`);
      const hidden = scroller.scrollWidth - scroller.clientWidth;
      frame.toggleAttribute('data-more-left', hidden > 1 && scroller.scrollLeft > 1);
      frame.toggleAttribute('data-more-right', hidden > 1 && scroller.scrollLeft < hidden - 1);
    };
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    return () => {
      scroller.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={frameRef} className="gam-table-frame" data-bordered={bordered || undefined} data-fit={fit || undefined}>
      <div ref={scrollRef} className="gam-table-scroll">
        {children}
      </div>
    </div>
  );
}

export function useColumnWidth(k: string): number | undefined {
  return useContext(ResizeCtx)?.widths[k];
}

/** Drag handle rendered inside a th. Renders nothing outside a ResizableTable. */
export function ColResizeHandle({ colKey }: { colKey: string }) {
  const ctx = useContext(ResizeCtx);
  const drag = useRef<{ startX: number; startW: number; base: Record<string, number> } | null>(null);
  if (!ctx) return null;
  return (
    <div
      className="gam-col-resize"
      title="Drag to resize — double-click to reset all columns"
      onPointerDown={(e) => {
        const th = e.currentTarget.closest('th');
        const row = th?.parentElement;
        if (!th || !row) return;
        // Freeze every resizable column at its rendered width so switching the
        // table to fixed layout doesn't reflow the untouched ones.
        const base: Record<string, number> = {};
        row.querySelectorAll<HTMLTableCellElement>('th[data-col]').forEach((el) => {
          base[el.dataset.col!] = Math.round(el.getBoundingClientRect().width);
        });
        drag.current = { startX: e.clientX, startW: base[colKey] ?? th.getBoundingClientRect().width, base };
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const w = Math.max(MIN_WIDTH, Math.round(drag.current.startW + e.clientX - drag.current.startX));
        ctx.setLive({ ...drag.current.base, [colKey]: w });
      }}
      onPointerUp={() => {
        if (!drag.current) return;
        drag.current = null;
        ctx.commit();
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation();
        ctx.reset();
      }}
    />
  );
}

interface ResizableThProps extends Omit<React.ComponentPropsWithoutRef<typeof Table.Th>, 'style'> {
  /** Column key — unique within the table; widths persist under it. */
  k: string;
  /** Width before the user ever resizes (auto if omitted). */
  defaultWidth?: number;
  style?: CSSProperties;
}

/** Plain (non-sortable) resizable header cell. */
export function ResizableTh({ k, defaultWidth, style, children, ...rest }: ResizableThProps) {
  const width = useColumnWidth(k) ?? defaultWidth;
  return (
    <Table.Th data-col={k} style={{ ...style, width }} {...rest}>
      {children}
      <ColResizeHandle colKey={k} />
    </Table.Th>
  );
}
