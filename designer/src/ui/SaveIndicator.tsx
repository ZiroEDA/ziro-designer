// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Where the user's work is, said continuously.
 *
 * A tool that goes quiet when the network does is worse than one that never
 * claimed anything: the app read "Saved in browser · cloud sync on" while an
 * hour of edits sat on one machine, and a failed write said nothing at all.
 *
 * Quiet in the steady state and loud only when something is wrong, so it can be
 * left on screen without becoming furniture the user stops seeing. The wording
 * and the escalation live in `save_state.ts`, which is a pure function of a
 * snapshot and the time; this only renders it.
 */
import { useEffect, useState, type JSX } from 'react';
import {
  describeSaveState,
  getSaveSnapshot,
  STALE_AFTER_MS,
  subscribeSaveState,
  type SaveSnapshot,
} from '../home/save_state.js';
import './saveIndicator.css';

export function SaveIndicator({ onDownload }: { onDownload?: () => void }): JSX.Element | null {
  const [snap, setSnap] = useState<SaveSnapshot>(getSaveSnapshot);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => subscribeSaveState(setSnap), []);

  // "Retrying" becomes "not saved since 14:32" with the passage of time and no
  // new event to render on, so while a run of failures is open the clock is
  // read periodically. Only then: an idle tab that is saving fine has nothing
  // to recompute.
  useEffect(() => {
    if (snap.cloudFailingSince === 0) return;
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, [snap.cloudFailingSince]);

  const state = describeSaveState(snap, Math.max(now, Date.now()));

  // The steady state is silent. A permanent "all changes saved" badge is read
  // once and then never again, which is exactly when it stops being true.
  if (state.kind === 'saved' || state.kind === 'local-only') return null;

  return (
    <div className={`ze-save-indicator ${state.kind}`} role="status" aria-live="polite">
      <span className="ze-save-indicator-text">{state.text}</span>
      {state.offerDownload && onDownload && (
        <button type="button" onClick={onDownload}>
          Download a copy
        </button>
      )}
    </div>
  );
}

export { STALE_AFTER_MS };
