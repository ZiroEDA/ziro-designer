/**
 * Manage Footprint Libraries. Counterpart: `pcbnew/dialogs/panel_fp_lib_table.cpp`
 * (PANEL_FP_LIB_TABLE, opened by ACTIONS::showFootprintLibTable) — the two
 * library tables, "Global Libraries" and "Project Specific Libraries", each a
 * grid of Enable / Nickname / Library Path / Library Format / Options /
 * Description rows, with add / add-existing / move / remove buttons and the
 * read-only path-substitution list underneath.
 *
 * Registering a library here is what makes it exist: FP_LIB_TABLE resolves an
 * FPID's nickname through these tables, so a `.pretty` folder that no row
 * points at is not a library and every assignment into it stays unresolved.
 *
 * Web deltas: the global table is the hosted library set, which is fixed, so
 * that tab is read-only (upstream's Reset/Migrate buttons have nothing to act
 * on). "Add Existing" lists the `.pretty` folders already in the project
 * instead of opening a directory picker.
 */

import { useMemo, useState, type JSX } from 'react';
import { Icon } from '../ui/icons.js';
import {
  projectFpLibTable,
  projectPrettyDirs,
  rowPrettyDir,
  type FpLibRow,
} from '../editors/footprint/fp_lib_table.js';

interface Props {
  /** The open project's files (footprints, the table, the `.kicad_pro`). */
  projectFiles: readonly { name: string; text: string }[];
  /** Nicknames of the hosted (global) libraries. */
  globalLibraries: readonly string[];
  /** Where the hosted libraries are served from (their "Library Path"). */
  globalBase: string;
  /** OK: the project table's new rows. */
  onSave: (rows: FpLibRow[]) => void;
  onClose: () => void;
}

export function DialogFpLibTable({
  projectFiles,
  globalLibraries,
  globalBase,
  onSave,
  onClose,
}: Props): JSX.Element {
  const [tab, setTab] = useState<'global' | 'project'>('project');
  const [rows, setRows] = useState<FpLibRow[]>(() => projectFpLibTable(projectFiles));
  const [sel, setSel] = useState<number | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);

  // The project's `.pretty` folders — "Add Existing" offers the unregistered ones.
  const prettyDirs = useMemo(() => projectPrettyDirs(projectFiles, rows), [projectFiles, rows]);
  const unregistered = prettyDirs.filter(
    (d) => !rows.some((r) => rowPrettyDir(r).toLowerCase() === d.dir.toLowerCase()),
  );

  const setAt = (i: number, patch: Partial<FpLibRow>): void =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = (row: FpLibRow): void => {
    setRows([...rows, row]);
    setSel(rows.length);
  };
  const removeSel = (): void => {
    if (sel === null) return;
    setRows(rows.filter((_, j) => j !== sel));
    setSel(null);
  };
  const move = (delta: -1 | 1): void => {
    if (sel === null) return;
    const to = sel + delta;
    if (to < 0 || to >= rows.length) return;
    const next = [...rows];
    const [row] = next.splice(sel, 1);
    next.splice(to, 0, row!);
    setRows(next);
    setSel(to);
  };

  const cell: React.CSSProperties = { padding: 0 };
  const globalRows = globalLibraries.map((name) => ({
    name,
    uri: `${globalBase}/${name}.pretty`,
  }));

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div
        className="ze-modal"
        style={{ width: 900, maxWidth: '94vw', height: 560, maxHeight: '90vh' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          Footprint Libraries
          <span className="x" title="Close" onClick={onClose}>
            ✕
          </span>
        </div>
        <div
          className="ze-modal-body"
          style={{ display: 'flex', flexDirection: 'column', padding: '10px 14px', gap: 8 }}
        >
          {/* The two library tables (upstream's notebook pages). */}
          <div className="ze-tabbar">
            <button
              className={`ze-tab${tab === 'global' ? ' active' : ''}`}
              onClick={() => setTab('global')}
            >
              Global Libraries
            </button>
            <button
              className={`ze-tab${tab === 'project' ? ' active' : ''}`}
              onClick={() => setTab('project')}
            >
              Project Specific Libraries
            </button>
          </div>

          {tab === 'global' ? (
            <>
              <div className="ze-grid-pane" style={{ flex: 1, minHeight: 0 }}>
                <table className="ze-grid" style={{ tableLayout: 'fixed', width: '100%' }}>
                  <colgroup>
                    <col style={{ width: 220 }} />
                    <col />
                    <col style={{ width: 110 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Nickname</th>
                      <th>Library Path</th>
                      <th>Library Format</th>
                    </tr>
                  </thead>
                  <tbody>
                    {globalRows.map((r) => (
                      <tr key={r.name}>
                        <td style={{ padding: '3px 6px' }}>{r.name}</td>
                        <td style={{ padding: '3px 6px' }}>{r.uri}</td>
                        <td style={{ padding: '3px 6px' }}>KiCad</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="ze-muted" style={{ fontSize: 11.5 }}>
                The global table is the hosted KiCad library set ({globalLibraries.length}{' '}
                libraries) and is read-only here.
              </div>
            </>
          ) : (
            <>
              <div className="ze-grid-pane" style={{ flex: 1, minHeight: 0 }}>
                <table className="ze-grid" style={{ tableLayout: 'fixed', width: '100%' }}>
                  <colgroup>
                    <col style={{ width: 56 }} />
                    <col style={{ width: 180 }} />
                    <col />
                    <col style={{ width: 110 }} />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 160 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Enable</th>
                      <th>Nickname</th>
                      <th>Library Path</th>
                      <th>Library Format</th>
                      <th>Options</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr
                        key={i}
                        className={i === sel ? 'selected' : undefined}
                        onFocusCapture={() => setSel(i)}
                        onMouseDown={() => setSel(i)}
                      >
                        <td style={{ ...cell, textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={!r.disabled}
                            onChange={(e) => setAt(i, { disabled: !e.target.checked })}
                          />
                        </td>
                        <td style={cell}>
                          <input
                            type="text"
                            value={r.name}
                            placeholder="Footprints"
                            onChange={(e) => setAt(i, { name: e.target.value })}
                          />
                        </td>
                        <td style={cell}>
                          <input
                            type="text"
                            value={r.uri}
                            placeholder="${KIPRJMOD}/footprints.pretty"
                            onChange={(e) => setAt(i, { uri: e.target.value })}
                          />
                        </td>
                        <td style={{ ...cell, padding: '3px 6px' }}>{r.type || 'KiCad'}</td>
                        <td style={cell}>
                          <input
                            type="text"
                            value={r.options}
                            onChange={(e) => setAt(i, { options: e.target.value })}
                          />
                        </td>
                        <td style={cell}>
                          <input
                            type="text"
                            value={r.descr}
                            onChange={(e) => setAt(i, { descr: e.target.value })}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="ze-grid-btns" style={{ position: 'relative' }}>
                <button
                  className="ze-gridbtn"
                  title="Add empty row to table"
                  onClick={() =>
                    addRow({ name: '', type: 'KiCad', uri: '', options: '', descr: '' })
                  }
                >
                  <Icon name="plus" size={14} />
                </button>
                <button
                  className="ze-btn sm"
                  title="Add Existing"
                  disabled={unregistered.length === 0}
                  onClick={() => setBrowseOpen((v) => !v)}
                >
                  Add Existing
                </button>
                {browseOpen && unregistered.length > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: '100%',
                      left: 34,
                      zIndex: 20,
                      minWidth: 240,
                      marginBottom: 4,
                      background: 'var(--chrome-bg2)',
                      border: '1px solid var(--chrome-border)',
                      borderRadius: 3,
                      fontSize: 12,
                      boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
                    }}
                  >
                    {unregistered.map((d) => (
                      <div
                        key={d.dir}
                        className="ze-menu-item"
                        style={{ padding: '4px 12px', cursor: 'pointer' }}
                        onClick={() => {
                          addRow({
                            name: d.dir,
                            type: 'KiCad',
                            uri: `\${KIPRJMOD}/${d.dir}.pretty`,
                            options: '',
                            descr: '',
                          });
                          setBrowseOpen(false);
                        }}
                      >
                        {d.dir}.pretty
                      </div>
                    ))}
                  </div>
                )}
                <span style={{ width: 8 }} />
                <button
                  className="ze-gridbtn"
                  title="Move up"
                  disabled={sel === null || sel === 0}
                  onClick={() => move(-1)}
                >
                  <Icon name="arrowUp" size={14} />
                </button>
                <button
                  className="ze-gridbtn"
                  title="Move down"
                  disabled={sel === null || sel === rows.length - 1}
                  onClick={() => move(1)}
                >
                  <Icon name="arrowDown" size={14} />
                </button>
                <button
                  className="ze-gridbtn"
                  title="Remove library from table"
                  disabled={sel === null}
                  onClick={removeSel}
                >
                  <Icon name="delete" size={14} />
                </button>
              </div>

              {/* The read-only environment/path substitutions grid. */}
              <div>
                <div style={{ fontSize: 12, marginBottom: 3 }}>Available path substitutions:</div>
                <div className="ze-grid-pane" style={{ maxHeight: 92, overflow: 'auto' }}>
                  <table className="ze-grid" style={{ tableLayout: 'fixed', width: '100%' }}>
                    <colgroup>
                      <col style={{ width: 180 }} />
                      <col />
                    </colgroup>
                    <tbody>
                      <tr>
                        <td style={{ padding: '3px 6px' }}>$&#123;KIPRJMOD&#125;</td>
                        <td style={{ padding: '3px 6px' }}>the project folder</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="ze-btn primary"
            onClick={() => {
              onSave(rows.filter((r) => r.name.trim() && r.uri.trim()));
            }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
