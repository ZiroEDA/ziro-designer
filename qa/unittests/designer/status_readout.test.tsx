// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Moving the mouse must not re-render the editor frame.
 *
 * `EDA_DRAW_FRAME::UpdateStatusBar` and its overrides
 * (`eeschema/sch_base_frame.cpp:252`, `pcbnew/pcb_base_frame.cpp:761`) run on
 * every cursor motion and write the pane text with `SetStatusText`. Nothing
 * else on the frame repaints — a wxStatusBar pane is a text field, and setting
 * it touches that field alone.
 *
 * `ui/useStatusReadout` is that, in React: the values live in refs and are
 * written straight into the three text nodes. The rule it exists for was never
 * pinned, and four of the five draw frames were not on it — pcbnew held the
 * cursor in `useState` and set it from `onPointerMove` with a fresh
 * `{ x, y }`, so `Object.is` never matched, React could never bail out, and
 * every mouse move re-rendered both toolbars, the Appearance notebook, the
 * Properties grid and the Selection Filter before the
 * `requestAnimationFrame` that actually moves the crosshair. That is why the
 * PCB crosshair trailed the pointer and eeschema's did not.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useRef, type JSX } from 'react';
import { useStatusReadout } from '@ziroeda/designer/src/ui/useStatusReadout.js';

afterEach(cleanup);

const MM = 1e6; // a PCB_IU_PER_MM-shaped scale, so the numbers below read in mm

/** A frame that counts its own renders, like the ones this hook lives in. */
function Frame({
  renders,
  polar = false,
  localOrigin = { x: 0, y: 0 },
  onReady,
}: {
  renders: { n: number };
  polar?: boolean;
  localOrigin?: { x: number; y: number };
  onReady: (r: ReturnType<typeof useStatusReadout>) => void;
}): JSX.Element {
  renders.n++;
  const readout = useStatusReadout({
    units: 'mm',
    localOrigin,
    devicePixelRatio: 1,
    iuPerMM: MM,
    polar,
  });
  const done = useRef(false);
  if (!done.current) {
    done.current = true;
    onReady(readout);
  }
  return (
    <div>
      <span data-testid="zoom" ref={readout.zoomRef} />
      <span data-testid="coords" ref={readout.coordsRef} />
      <span data-testid="deltas" ref={readout.deltasRef} />
    </div>
  );
}

describe('useStatusReadout', () => {
  /**
   * Inside `act`, and that is the load-bearing part.
   *
   * React 18 does not re-render synchronously for an update made outside an
   * event handler — it schedules one. So a bare `setCursor(...)` followed by a
   * synchronous `expect(renders.n)` reads the count BEFORE any re-render could
   * have happened, and the assertion passes whatever the hook does. Written
   * that way first, it did: a mutant holding the cursor in `useState` — the
   * exact defect this file exists for — survived it. `act` flushes the queue,
   * so the count is the real one.
   */
  const flushing = (fn: () => void): void => {
    act(fn);
  };

  it('writes the panes without re-rendering the frame', () => {
    const renders = { n: 0 };
    let readout!: ReturnType<typeof useStatusReadout>;
    const { getByTestId } = render(<Frame renders={renders} onReady={(r) => (readout = r)} />);
    const after = renders.n;

    flushing(() => readout.setCursor({ x: 3 * MM, y: 4 * MM }));
    expect(getByTestId('coords').textContent).toBe('X 3.0000  Y 4.0000');
    flushing(() => readout.setCursor({ x: 5 * MM, y: 6 * MM }));
    expect(getByTestId('coords').textContent).toBe('X 5.0000  Y 6.0000');
    flushing(() => readout.setCursor({ x: 5 * MM, y: 7 * MM }));

    // The whole point: three cursor motions, no render.
    expect(renders.n, 'the frame re-rendered on a cursor move').toBe(after);
  });

  it('and the zoom pane the same way', () => {
    const renders = { n: 0 };
    let readout!: ReturnType<typeof useStatusReadout>;
    const { getByTestId } = render(<Frame renders={renders} onReady={(r) => (readout = r)} />);
    const after = renders.n;
    flushing(() => readout.setScale(0.002));
    expect(getByTestId('zoom').textContent).toMatch(/^Z /);
    expect(renders.n).toBe(after);
  });

  it('clears every pane when the pointer leaves the canvas', () => {
    let readout!: ReturnType<typeof useStatusReadout>;
    const { getByTestId } = render(<Frame renders={{ n: 0 }} onReady={(r) => (readout = r)} />);
    readout.setCursor({ x: MM, y: MM });
    readout.setCursor(null);
    expect(getByTestId('coords').textContent).toBe('X, Y -');
    expect(getByTestId('deltas').textContent).toBe('dx, dy, dist -');
  });

  it('measures pane 3 from m_LocalOrigin, not from the page origin', () => {
    // `dx = cursorPos.x - screen->m_LocalOrigin.x` (pcb_base_frame.cpp:798-801).
    let readout!: ReturnType<typeof useStatusReadout>;
    const { getByTestId } = render(
      <Frame
        renders={{ n: 0 }}
        localOrigin={{ x: 1 * MM, y: 2 * MM }}
        onReady={(r) => (readout = r)}
      />,
    );
    readout.setCursor({ x: 4 * MM, y: 6 * MM });
    // Pane 2 is absolute and does NOT move with the origin.
    expect(getByTestId('coords').textContent).toBe('X 4.0000  Y 6.0000');
    expect(getByTestId('deltas').textContent).toBe('dx 3.0000  dy 4.0000  dist 5.0000');
  });

  it('swaps pane 3 for r/theta under GetShowPolarCoords', () => {
    // `theta = RAD2DEG( atan2( -dy, dx ) )` over the SAME dx/dy, so the angle
    // is the mathematical one on a screen whose Y grows downward
    // (pcb_base_frame.cpp:773-785). pcbnew computed both from the page origin
    // instead, so the polar readout ignored Set Local Origin entirely.
    let readout!: ReturnType<typeof useStatusReadout>;
    const { getByTestId } = render(
      <Frame
        renders={{ n: 0 }}
        polar
        localOrigin={{ x: 1 * MM, y: 2 * MM }}
        onReady={(r) => (readout = r)}
      />,
    );
    readout.setCursor({ x: 4 * MM, y: 6 * MM });
    // r = hypot(3, 4) = 5; theta = atan2(-4, 3) = -53.130 degrees.
    expect(getByTestId('deltas').textContent).toBe('r 5.0000  theta -53.130');
    readout.setCursor(null);
    expect(getByTestId('deltas').textContent).toBe('r, theta -');
  });
});

/**
 * Every draw frame is on the hook — or is named here with its reason.
 *
 * The defect is not subtle to spot once you know its shape: a `cursor` in
 * `useState`, fed from `onCursorMove`. What makes it worth a check is that it
 * costs nothing to write and shows up only as a feel.
 */
describe('the draw frames', () => {
  // `resolve(process.cwd(), …)` rather than `new URL(…, import.meta.url)`:
  // under `@vitest-environment happy-dom` the global `URL` is happy-dom's, and
  // `fileURLToPath` cannot read what it returns — every path came out
  // `undefined`. The other DOM tests here resolve from the cwd for the same
  // reason.
  const read = (rel: string): string =>
    readFileSync(resolve(process.cwd(), `../designer/src/${rel}`), 'utf8');

  const ON_THE_HOOK = [
    'editors/schematic/SchematicEditor.tsx',
    'editors/pcb/PcbEditor.tsx',
    'editors/footprint/FootprintEditor.tsx',
    'editors/gerbview/GerberViewer.tsx',
    'editors/symbol/SymbolEditor.tsx',
  ];

  it.each(
    ON_THE_HOOK.map((rel) => [rel] as const),
  )('%s reads the pointer through useStatusReadout', (rel) => {
    const src = read(rel);
    expect(src).toContain('useStatusReadout');
    // The shape of the defect: the cursor as state, which no frame on the
    // hook has any use for.
    expect(src, `${rel} still holds the cursor in React state`).not.toMatch(
      /const \[cursor, setCursor\] = useState/,
    );
  });

  it('and pl_editor is the one still off it, for a stated reason', () => {
    // `PL_EDITOR_FRAME::UpdateStatusBar` runs the cursor through
    // `m_originTransforms` — the page origin can be any corner, with a sign
    // flip per axis — and its pane 3 is `dx`/`dy` with no `dist`. That is
    // `plCoordFields`, and the hook would have to learn the origin transform
    // before this frame could move onto it. Named rather than quietly skipped,
    // so the list is a checklist and not a decoration.
    const src = read('editors/drawingsheet/DrawingSheetEditor.tsx');
    expect(src).toContain('plCoordFields');
    expect(src).not.toContain('useStatusReadout');
  });
});
