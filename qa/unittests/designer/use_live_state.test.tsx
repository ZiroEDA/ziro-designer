// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * An undo folded in a state updater is popped exactly once, however many
 * times React replays the render.
 *
 * `SCH_COMMIT::Push` / `GetSchematicFromUndoList` touch the undo list once,
 * synchronously. A React updater may run more than once — StrictMode replays
 * every render — and only when the update is NOT computed eagerly at dispatch,
 * which is whenever something else is already queued on the component. That
 * is the path taken here: a flag is set first so the pop is left for the
 * render, then replayed. With `useState` the replay finds the stack empty and
 * the document comes back unchanged — Ctrl+Z after an M-key move did nothing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { StrictMode, useState } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useLiveState } from '@ziroeda/designer/src/ui/useLiveState.js';

afterEach(cleanup);

type Handle = { undo: () => void; edit: (v: string) => void };

function Editor({ stack, handle }: { stack: string[]; handle: Handle }): React.JSX.Element {
  const [doc, setDoc, docRef] = useLiveState('original');
  const [, setDirty] = useState(false);
  handle.edit = (v) => {
    stack.push(docRef.current);
    setDoc(v);
  };
  handle.undo = () => {
    // Something else queued first, so the updater below is not run eagerly at
    // dispatch by React itself — the shape of the Ctrl+Z handler.
    setDirty(true);
    setDoc((d) => stack.pop() ?? d);
  };
  return <output>{doc}</output>;
}

describe('useLiveState', () => {
  it('pops the undo stack once under a replayed render, and shows the result', () => {
    const stack: string[] = [];
    const handle = {} as Handle;
    render(
      <StrictMode>
        <Editor stack={stack} handle={handle} />
      </StrictMode>,
    );
    act(() => handle.edit('moved'));
    expect(screen.getByRole('status').textContent).toBe('moved');
    expect(stack).toEqual(['original']);

    act(() => handle.undo());
    expect(screen.getByRole('status').textContent).toBe('original');
    expect(stack).toEqual([]);
  });

  it('gives an updater the value of the previous dispatch, not the last render', () => {
    const stack: string[] = [];
    const handle = {} as Handle;
    render(
      <StrictMode>
        <Editor stack={stack} handle={handle} />
      </StrictMode>,
    );
    // Two edits in one tick: the second must see the first's result.
    act(() => {
      handle.edit('a');
      handle.edit('b');
    });
    expect(screen.getByRole('status').textContent).toBe('b');
    expect(stack).toEqual(['original', 'a']);
  });
});
