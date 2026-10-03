/**
 * Mounts the AI pane app-wide, docked on the right of every editor the way
 * KiCad docks Properties or Appearance: a 5px AUI sash on its inner (left)
 * edge to resize it, the editors shrinking to make room (html.ze-ai-open)
 * while the frame's title bar still spans the window. Its toggle sits at the
 * right end of that title bar, opening and closing it; Ctrl+Shift+A too.
 */
import { DockSash } from '@ziroeda/common/widgets/wx_aui_sash.js';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AiChatPane } from './chat_pane.js';
import { DocViewer } from './doc_viewer.js';

/** [ours] KiCad has no such pane; a width that fits a chat and a tool line. */
const DEFAULT_WIDTH = 380;
const MIN_WIDTH = 280;
const WIDTH_KEY = 'ziroeda.ai.paneWidth';

function storedWidth(): number {
  try {
    const v = Number(localStorage.getItem(WIDTH_KEY));
    return v >= MIN_WIDTH ? v : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

export function AiDock(): JSX.Element {
  // Open whenever the app loads; the title-bar icon brings it back once closed.
  const [open, setOpen] = useState(true);
  const [width, setWidth] = useState(storedWidth);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('ze-ai-open', open);
    root.style.setProperty('--ai-pane-width', `${width}px`);
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      // private window: the width is just not remembered
    }
    // Canvases size themselves from resize events.
    window.dispatchEvent(new Event('resize'));
  }, [open, width]);

  // The frame's status bar spans the window under the pane, as the title bar
  // does over it; its height is the frame's own (--statusbar-height differs
  // per frame), so the pane's bottom follows the bar on screen.
  useEffect(() => {
    if (!open) return;
    let last = -1;
    const fit = () => {
      const bar = [...document.querySelectorAll<HTMLElement>('#root .ze-statusbar')].find(
        (e) => e.offsetParent !== null,
      );
      const h = bar ? bar.getBoundingClientRect().height : 0;
      if (h !== last) {
        last = h;
        document.documentElement.style.setProperty('--ai-dock-bottom', `${h}px`);
      }
    };
    fit();
    const id = setInterval(fit, 500);
    return () => clearInterval(id);
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return createPortal(
    <>
      <DocViewer />
      {open && (
        <div className="ze-app ze-ai-dock">
          <DockSash
            edge="left"
            width={width}
            min={MIN_WIDTH}
            max={Math.max(MIN_WIDTH, Math.round(window.innerWidth * 0.6))}
            onResize={setWidth}
          />
          <AiChatPane />
        </div>
      )}
      {/* Always in the title bar: opens the pane, and closes it again. */}
      <button
        type="button"
        className={`ze-ai-toggle${open ? ' on' : ''}`}
        title={open ? 'Close the AI Assistant (Ctrl+Shift+A)' : 'AI Assistant (Ctrl+Shift+A)'}
        aria-label={open ? 'Close the AI Assistant' : 'Open the AI Assistant'}
        aria-pressed={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path
            fill="currentColor"
            d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6zM13 11l.6 1.4L15 13l-1.4.6L13 15l-.6-1.4L11 13l1.4-.6z"
          />
        </svg>
      </button>
    </>,
    document.body,
  );
}
