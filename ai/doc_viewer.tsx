/**
 * The project's spec, shown for reading in a KiCad dialog centred on the
 * space between the file explorer (the manager's left dock) and the AI
 * pane, so the tree and the chat stay usable beside it.
 * It opens when the assistant writes DESIGN.md and from the pane's Spec
 * button; it is not modal - the user answers in the chat.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Markdown } from './markdown.js';

interface ShownDoc {
  title: string;
  text: string;
}

let shown: ShownDoc | null = null;
const listeners = new Set<() => void>();
const changed = () => {
  for (const l of listeners) l();
};

export function showDoc(doc: ShownDoc): void {
  shown = doc;
  changed();
}
export function hideDoc(): void {
  shown = null;
  changed();
}
export function shownDoc(): ShownDoc | null {
  return shown;
}
function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The free area between the left dock and the AI pane, below the frame chrome. */
function freeArea(): { left: number; top: number; right: number; bottom: number } {
  const dock = document.querySelector('.ze-leftdock')?.getBoundingClientRect();
  const ai = document.querySelector('.ze-ai-dock')?.getBoundingClientRect();
  const chrome = document.querySelector('.ze-framechrome')?.getBoundingClientRect();
  const left = dock && dock.width > 0 ? dock.right : 0;
  const right = ai && ai.width > 0 ? ai.left : window.innerWidth;
  const top = chrome && chrome.height > 0 ? chrome.bottom : 0;
  return { left, top, right, bottom: window.innerHeight };
}

/** [ours] the share of the free area's width and height the viewer takes. */
const SHARE = 0.8;

export function DocViewer(): JSX.Element | null {
  const doc = useSyncExternalStore(subscribe, shownDoc);
  const [, relayout] = useState(0);
  useEffect(() => {
    if (!doc) return;
    const onResize = () => relayout((n) => n + 1);
    window.addEventListener('resize', onResize);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hideDoc();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
    };
  }, [doc]);
  if (!doc) return null;
  const a = freeArea();
  const w = (a.right - a.left) * SHARE;
  const h = (a.bottom - a.top) * SHARE;
  // A KiCad dialog (.ze-modal: the CSD title bar, the window radius and
  // shadow), centred on the free area. Not modal: the user answers in chat.
  return (
    <>
      {/* Everything but the chat dims, as a modal dims its parent, so the
          spec stands out and the chat stays live. A click on it closes. */}
      <div
        className="ze-ai-docview-scrim"
        style={{ right: window.innerWidth - a.right }}
        onClick={hideDoc}
      />
      <div
        className="ze-app ze-ai-docview"
        style={{
          left: (a.left + a.right - w) / 2,
          top: (a.top + a.bottom - h) / 2,
          width: w,
          height: h,
        }}
      >
        <div
          className="ze-modal ze-ai-docview-dialog"
          role="dialog"
          aria-label={doc.title}
          data-testid="ai-doc-viewer"
        >
          <div className="ze-modal-header">
            {doc.title}
            <span className="x" title="Close (Esc)" onClick={hideDoc}>
              ✕
            </span>
          </div>
          <div className="ze-ai-docview-body">
            <Markdown text={doc.text} className="ze-md-doc" />
          </div>
        </div>
      </div>
    </>
  );
}
