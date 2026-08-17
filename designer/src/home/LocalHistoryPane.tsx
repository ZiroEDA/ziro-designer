// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LOCAL_HISTORY_PANE` (kicad/local_history_pane.cpp), the pane behind
 * `View > Panels > Local History`.
 *
 * Upstream is a two-column report-mode `wxListCtrl`:
 *
 *     m_list->AppendColumn( _( "Title" ) );
 *     m_list->AppendColumn( _( "Time" ) );
 *     m_list->SetColumnWidth( 0, FromDIP( 200 ) );
 *     m_list->SetColumnWidth( 1, FromDIP( 150 ) );
 *
 * filled by walking the project's git log. Each row is the commit message's
 * first line and a relative time, tinted by what made the snapshot:
 *
 *     if( info.summary.StartsWith( wxS( "Autosave" ) ) )
 *         m_list->SetItemTextColour( row, ...wxSYS_COLOUR_GRAYTEXT );
 *     else if( info.summary.StartsWith( wxS( "Backup" ) ) )
 *         m_list->SetItemTextColour( row, wxColour( 80, 120, 200 ) );
 *
 * with the full message and an ISO timestamp on hover, and one item on the
 * right-click menu:
 *
 *     wxMenuItem* restore = menu.Append( wxID_ANY, _( "Restore Commit" ) );
 *
 * The 80/120/200 blue is a literal in the source rather than a system colour,
 * so it is a literal here too; the grey is `wxSYS_COLOUR_GRAYTEXT`, which is
 * this app's own muted foreground.
 *
 * The time strings refresh on a timer upstream (`m_refreshTimer`), because
 * "Moments ago" stops being true on its own. Same here, and for the same
 * reason - a pane that only re-read on a save would sit there claiming a
 * snapshot from this morning happened moments ago.
 */
import { useEffect, useState, type JSX } from 'react';
import { relativeTime, snapshotTooltip, type Snapshot } from './local_history.js';
import { listSnapshots, onHistoryChanged } from './local_history_store.js';

interface Props {
  /** The project whose history this is; `null` closes the pane's contents. */
  projectId: string | null;
  /** Restore Commit. Absent while the restore flow is not wired up. */
  onRestore?: (snapshot: Snapshot) => void;
}

/**
 * How often the Time column is re-rendered.
 *
 * Upstream's timer is what keeps "Moments ago" honest. A minute is the
 * granularity of the smallest unit the column shows, so anything faster
 * repaints without changing a character.
 */
const REFRESH_MS = 60_000;

export function LocalHistoryPane({ projectId, onRestore }: Props): JSX.Element {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; snapshot: Snapshot } | null>(null);
  /** Re-render tick, so the relative times stay true without a re-read. */
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!projectId) {
      setSnapshots([]);
      return;
    }
    let live = true;
    const read = (): void => {
      void listSnapshots(projectId).then((rows) => {
        if (live) setSnapshots(rows);
      });
    };
    read();
    // OnRefreshEvent: a snapshot taken anywhere shows up here without whoever
    // took it knowing this pane exists.
    const off = onHistoryChanged((id) => {
      if (id === projectId) read();
    });
    return () => {
      live = false;
      off();
    };
  }, [projectId]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="ze-lhist">
      {/* The wxListCtrl's header. */}
      <div className="ze-lhist-head">
        <span className="title">Title</span>
        <span className="time">Time</span>
      </div>

      <div className="ze-lhist-list">
        {snapshots.length === 0 ? (
          // Upstream shows an empty list; a project with no history yet is the
          // normal state before the first save rather than an error.
          <div className="ze-lhist-empty">
            {projectId ? 'No snapshots yet.' : 'No project open.'}
          </div>
        ) : (
          snapshots.map((s) => (
            <div
              key={s.id}
              className={`ze-lhist-row ${s.kind}${selected === s.id ? ' selected' : ''}`}
              title={snapshotTooltip(s)}
              onMouseDown={() => setSelected(s.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setSelected(s.id);
                setMenu({ x: e.clientX, y: e.clientY, snapshot: s });
              }}
            >
              <span className="title">{s.title}</span>
              <span className="time">{relativeTime(s.at, now)}</span>
            </div>
          ))
        )}
      </div>

      {menu && (
        <>
          {/* A popped-up wxMenu takes the mouse until it is dismissed. */}
          <div className="ze-tplsel-ctxscrim" onMouseDown={() => setMenu(null)} />
          <div
            className="ze-dropdown"
            style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 1000 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* menu.Append( wxID_ANY, _( "Restore Commit" ) ) - the only entry
                on upstream's menu. */}
            <div
              className={`ze-mitem${onRestore ? '' : ' disabled'}`}
              title={onRestore ? undefined : 'Restoring a snapshot is not built yet'}
              onClick={() => {
                if (!onRestore) return;
                setMenu(null);
                onRestore(menu.snapshot);
              }}
            >
              <span className="mico" />
              <span className="lbl">Restore Commit</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
