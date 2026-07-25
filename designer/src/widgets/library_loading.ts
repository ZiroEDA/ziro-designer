/**
 * "The libraries are loading" signal. Counterpart: the PROGRESS_REPORTER KiCad
 * drives while it reads the library tables — `SYMBOL_TREE_MODEL_ADAPTER::
 * AddLibraries` ("Loading Symbol Libraries") and `FOOTPRINT_LIST::
 * ReadFootprintFiles` ("Loading Footprint Libraries").
 *
 * KiCad reads libraries off local disk behind a modal gauge; here they come
 * from the hosted bucket over the network, one `index.json` up front and a
 * `.kicad_sym` / `.kicad_mod` per library. A blocking dialog would be wrong for
 * that, but an empty pane with no explanation is worse — so every hosted fetch
 * registers here and a pane with nothing in it yet shows a spinner.
 *
 * Symbols and footprints are tracked separately: a chooser fetching a footprint
 * preview must not make the symbol tree look like it is still loading.
 */

/** Which hosted library set a fetch belongs to. */
export type LibraryKind = 'symbols' | 'footprints';

/** What the widgets render, per kind. */
export interface LibraryLoadingState {
  /** Fetches currently in flight. */
  count: number;
  /** Label of the most recent one, e.g. "Loading Device…". */
  label: string;
}

const IDLE: LibraryLoadingState = { count: 0, label: '' };

const state: Record<LibraryKind, LibraryLoadingState> = { symbols: IDLE, footprints: IDLE };
/** Any kind — the snapshot a widget that doesn't care about the split sees. */
let anyState: LibraryLoadingState = IDLE;
const listeners = new Set<() => void>();

function publish(kind: LibraryKind, next: LibraryLoadingState): void {
  state[kind] = next;
  const count = state.symbols.count + state.footprints.count;
  anyState = count === 0 ? IDLE : { count, label: next.count > 0 ? next.label : anyState.label };
  for (const l of listeners) l();
}

/** Subscribe to changes (useSyncExternalStore's contract). */
export function subscribeLibraryLoading(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** The current snapshot for one kind, or for both when `kind` is omitted.
 *  Stable between publishes, as useSyncExternalStore requires. */
export function libraryLoadingState(kind?: LibraryKind): LibraryLoadingState {
  return kind ? state[kind] : anyState;
}

/**
 * Report a hosted-library fetch for as long as `work` runs. Returns the same
 * promise, so call sites just wrap:
 * `trackLibraryLoad('symbols', 'Loading Device…', fetch(...))`.
 */
export function trackLibraryLoad<T>(
  kind: LibraryKind,
  label: string,
  work: Promise<T>,
): Promise<T> {
  publish(kind, { count: state[kind].count + 1, label });
  const done = (): void => {
    const count = Math.max(0, state[kind].count - 1);
    publish(kind, count === 0 ? IDLE : { count, label: state[kind].label });
  };
  work.then(done, done);
  return work;
}
