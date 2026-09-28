// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `useState` for a document that has an undo stack behind it.
 *
 * KiCad keeps the screen and its undo list on the frame, and a commit touches
 * both once, synchronously, when the tool asks for it: `SCH_COMMIT::Push`
 * modifies the items and calls `SaveCopyInUndoList` in the same breath, and
 * `SCH_EDIT_FRAME::GetSchematicFromUndoList` pops one entry and puts it back.
 * There is no moment at which "apply this edit" is a function waiting to be
 * called, and so no way for it to be called twice.
 *
 * A React updater is exactly that function, and React reserves the right to
 * run it more than once — an updater is required to be pure. It exercises the
 * right, too: StrictMode replays every render in development, and a concurrent
 * render that is thrown away replays in production. Whether an updater is run
 * at dispatch (once, when the component has nothing else queued) or at render
 * (in every replay) depends on what else happened to be queued, so an undo
 * folded inside one worked or did not depending on timing: replayed, its second
 * run found the stack already popped and handed the document straight back.
 * That was Ctrl+Z after an M-key move doing nothing.
 *
 * So the updater is folded here, at dispatch, exactly once, and React is only
 * ever handed a value. The ref is the document as of the last dispatch — the
 * frame's screen — for callbacks that must read it without waiting for a
 * render, the same reason `PcbEditor` keeps `boardRef` beside its state.
 */

import { useCallback, useRef, useState, type MutableRefObject, type SetStateAction } from 'react';

export function useLiveState<T>(
  initial: T,
): [T, (next: SetStateAction<T>) => void, MutableRefObject<T>] {
  const [value, setValue] = useState<T>(initial);
  const live = useRef<T>(initial);
  const set = useCallback((next: SetStateAction<T>): void => {
    const v = typeof next === 'function' ? (next as (prev: T) => T)(live.current) : next;
    live.current = v;
    setValue(v);
  }, []);
  return [value, set, live];
}
