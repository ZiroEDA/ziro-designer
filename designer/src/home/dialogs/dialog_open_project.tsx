// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Open Project.
 *
 * KICAD_MANAGER_ACTIONS::openProject puts up a native wxFileDialog filtered to
 * `*.kicad_pro`, pointed at the last-used directory. A browser has no directory
 * to point at and no file dialog we can filter, so the equivalent question -
 * "which of my projects do you want?" - has to be asked about the place the
 * user's projects actually live: their account.
 *
 * The list is `listProjects()`, the local IndexedDB store. That is the cloud
 * list: `syncAllProjects` reconciles the account's projects into this store on
 * sign-in and pushes local-only ones up, so signed in it is the account's
 * projects and signed out it is whatever this browser is holding. Reading the
 * store rather than the network also means this dialog opens instantly and
 * works offline, which a file dialog does too.
 *
 * "Open from Computer…" is the other half, and the reason this is a dialog and
 * not just a list: the user may well be opening a project that is not in the
 * account yet, which is what the folder picker is for.
 */

import { useState, type JSX } from 'react';
import type { ProjectMeta } from '../projectStore.js';
import { fmtBytes, fmtWhen } from '../project_tree.js';
import { TreeIcon } from '../project_tree_pane.js';

export function OpenProjectDialog({
  projects,
  signedIn,
  onOpen,
  onOpenFromComputer,
  onSelectFiles,
  onRename,
  onDelete,
  onCancel,
}: {
  /** Saved projects, newest-opened first (the caller sorts). */
  projects: readonly ProjectMeta[];
  /** Whether these are backed by an account, which changes what we promise. */
  signedIn: boolean;
  onOpen: (id: string) => void;
  /** The directory picker (File System Access API, else webkitdirectory). */
  onOpenFromComputer: () => void;
  /** Fallback for folders the browser refuses to hand over as a directory. */
  onSelectFiles: () => void;
  onRename: (id: string, current: string) => void;
  onDelete: (id: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const [sel, setSel] = useState<string | null>(projects[0]?.id ?? null);
  const open = (id: string | null): void => {
    if (id) onOpen(id);
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div
        className="ze-modal ze-open-project"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
          else if (e.key === 'Enter') open(sel);
        }}
      >
        <div className="ze-modal-header">
          Open Project
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>

        <div className="ze-modal-body ze-openprj-body">
          {projects.length > 0 ? (
            <>
              {/* The header lives *inside* the scroller, stuck to its top.
                  Outside it, the two boxes have different content widths - the
                  rows lose whatever the scrollbar takes - and every column
                  drifts out of line with its own title. Sticky also keeps the
                  titles in view while the list scrolls, which is what a file
                  chooser does. */}
              <div className="ze-openprj-list">
                <div className="ze-openprj-head">
                  <span className="c-name">Name</span>
                  <span className="c-files">Files</span>
                  <span className="c-size">Size</span>
                  <span className="c-when">Modified</span>
                  {/* The rows' actions column, so the titles sit over their
                      own data rather than 66px to the right of it. */}
                  <span className="c-acts" />
                </div>
                {projects.map((p) => (
                  <div
                    key={p.id}
                    className={`ze-openprj-row${sel === p.id ? ' active' : ''}`}
                    onClick={() => setSel(p.id)}
                    onDoubleClick={() => onOpen(p.id)}
                  >
                    <span className="c-name">
                      <TreeIcon name="project" />
                      <span className="nm">{p.name}</span>
                    </span>
                    <span className="c-files">{p.fileCount}</span>
                    <span className="c-size">{fmtBytes(p.bytes)}</span>
                    <span className="c-when">{fmtWhen(p.updatedAt)}</span>
                    <span className="c-acts">
                      <button
                        type="button"
                        title="Rename this project"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRename(p.id, p.name);
                        }}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="del"
                        title={
                          signedIn
                            ? 'Delete this project from your account'
                            : 'Remove this project from this browser'
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(p.id);
                        }}
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="ze-openprj-empty">
              <p>
                {signedIn
                  ? 'No projects in your account yet.'
                  : 'No projects saved in this browser yet.'}
              </p>
              <p>Open one from your computer to get started — it is saved from then on.</p>
            </div>
          )}
        </div>

        <div className="ze-modal-footer" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="ze-btn" onClick={onOpenFromComputer}>
              Open from Computer…
            </button>
            {/* Chrome refuses showDirectoryPicker for Downloads, Desktop and
                the profile root. When it does, there is no way back to the
                project except picking its files, so the way in is offered
                here rather than hidden behind a failure. */}
            <button
              className="ze-btn"
              onClick={onSelectFiles}
              title="If the browser blocks the folder (Downloads, Desktop…), select all the project files instead"
            >
              Select Files…
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="ze-btn" onClick={onCancel}>
              Cancel
            </button>
            <button className="ze-btn primary" disabled={!sel} onClick={() => open(sel)}>
              Open
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
