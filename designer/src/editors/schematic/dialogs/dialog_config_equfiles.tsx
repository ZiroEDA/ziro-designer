// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Manage Footprint Association Files. Counterparts:
 * `cvpcb/dialogs/dialog_config_equfiles.cpp` (`DIALOG_CONFIG_EQUFILES`) and
 * `cvpcb/dialogs/dialog_config_equfiles_base.cpp` (its wxFormBuilder layout),
 * opened by `CVPCB_ACTIONS::showEquFileTable` from Assign Footprints'
 * Preferences menu (`cvpcb/menubar.cpp:71`).
 *
 * The window, top to bottom, is the base class's:
 *
 *     "Footprint association files:"
 *     a multi-selection wxListBox, minimum 500 x 100
 *     [Add] [Move Up] [Move Down] [Edit]   (20 px)   [Remove]
 *     "Available path substitutions:"      a 2-column Name / Value grid
 *     OK / Cancel
 *
 * The title is `wxString::Format( _( "Project file: '%s'" ),
 * Prj().GetProjectFullName() )` (`:47`) — the project's path, not the dialog's
 * name; the dialog's name is only the menu row's.
 *
 * **No button is ever disabled.** `DIALOG_CONFIG_EQUFILES` has no
 * `wxUpdateUIEvent` handler and no `Enable()` call: each handler carries its
 * own guard and returns silently — Move Up with the first row selected does
 * nothing at all, Move Down with the last row selected likewise, Remove with
 * nothing selected likewise. Those guards are `cvpcb_equ_files.ts`; this file
 * is the window they are wired to.
 *
 * ## What is different here, and why
 *
 * **Edit File is disabled.** `OnEditEquFile` runs `ExecuteFile(
 * Pgm().GetTextEditor(), … )` (`:87-101`) — it launches the user's external
 * text editor on the file. A browser tab cannot start a process, and this app
 * ships no text editor to stand in for one, so the button is here in its
 * upstream position and greyed, the way every other launcher here shows a
 * command it cannot run. It is not silently missing.
 *
 * **One path substitution, not two.** Upstream's grid holds
 * `PROJECT_VAR_NAME` and `FOOTPRINT_LIBRARY_ADAPTER::GlobalPathEnvVariableName()`
 * (`:67-70`), and both are places a `.equ` file might sit on a local disk. The
 * second is a hosted bucket here and holds no user files, and — more to the
 * point — `equFilePathFor` relativizes against `${KIPRJMOD}` and nothing else,
 * so listing a variable that never appears in a stored path would be a row that
 * describes behaviour we do not have.
 *
 * **Add reaches the account's project tree**, which is this app's filesystem,
 * with "Add from Computer..." beside it for a file that is not in the account
 * yet. Either way the file ends up IN the open project, because
 * `buildEquivalenceList` re-reads it on every press and a reference to
 * something outside the project cannot be re-read. The copy is deferred to OK
 * along with the list, so Cancel really does discard everything —
 * `OnOkClick` is the only writer upstream too (`:104-118`).
 */

import { useMemo, useRef, useState, type JSX } from 'react';
import { StdBitmapButton } from '../../../ui/StdBitmapButton.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';
import { MessageDialogError } from '../../../ui/dialog_message.js';
import { OpenFileDialog } from '../../../fs/OpenFileDialog.js';
import { equFileWildcard } from '../../../fs/wildcards.js';
import { projectRoot, type ProjectFile } from '../../../fs/project_paths.js';
import {
  addEquFile,
  equFilePathFor,
  EQU_FILE_EXTENSION,
  moveEquFilesDown,
  moveEquFilesUp,
  removeEquFiles,
  type EquFileList,
} from '../cvpcb_equ_files.js';
import './dialog_config_equfiles.css';

/** `PROJECT_VAR_NAME` (include/project.h:41), bare, for the grid's Name cell. */
const PROJECT_VAR_NAME = 'KIPRJMOD';

/** `wxString::Format( _( "Project file: '%s'" ), … )` (`:47`). */
export function equFilesDialogTitle(projectFullName: string): string {
  return `Project file: '${projectFullName}'`;
}

interface Props {
  /** The open project's files — the filesystem a listed `.equ` is read out of,
   *  and what `${KIPRJMOD}` is measured against. */
  projectFiles: readonly ProjectFile[];
  /** `PROJECT_FILE::m_EquivalenceFiles` as it stands. */
  equFiles: readonly string[];
  /**
   * OK. `newFiles` are the `.equ` files Add copied in from outside the project
   * and that have not been written yet; the caller persists both, which is
   * upstream's `SaveProject()` at `:116`.
   */
  onSave: (files: readonly string[], newFiles: readonly ProjectFile[]) => void;
  onClose: () => void;
}

const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p;

export function DialogConfigEquFiles({
  projectFiles,
  equFiles,
  onSave,
  onClose,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask.
  useModalEscape(onClose);

  const [list, setList] = useState<EquFileList>({ files: [...equFiles], selection: [] });
  /** Files Add pulled in from outside the project, written on OK. */
  const [pending, setPending] = useState<ProjectFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const localInput = useRef<HTMLInputElement>(null);

  const root = useMemo(() => projectRoot(projectFiles), [projectFiles]);
  const proName = useMemo(
    () => projectFiles.find((f) => /\.kicad_pro$/i.test(f.name))?.name ?? '',
    [projectFiles],
  );

  /**
   * One chosen file, wherever it came from. A file already inside the open
   * project is referenced where it lies; anything else is copied to the project
   * root under its own name first, because `buildEquivalenceList` re-reads the
   * reference on every press.
   */
  const addChosen = (path: string, text: string): void => {
    const rel = path.replace(/\\/g, '/').replace(/^\/+/, '');
    const inProject = root !== '' && rel.toLowerCase().startsWith(root.toLowerCase());
    const name = inProject ? rel : `${root}${basename(rel)}`;

    const out = addEquFile(list, equFilePathFor(`/${name}`, projectFiles));
    if (out.error !== null) {
      setError(out.error);
      return;
    }
    if (!inProject) setPending((p) => [...p.filter((f) => f.name !== name), { name, text }]);
    setList({ files: out.files, selection: out.selection });
  };

  const rowClick = (index: number, e: React.MouseEvent): void => {
    // wxLB_EXTENDED: Ctrl toggles a row, Shift ranges from the last anchor,
    // a plain click replaces the selection.
    const current = new Set(list.selection);
    if (e.ctrlKey || e.metaKey) {
      if (current.has(index)) current.delete(index);
      else current.add(index);
    } else if (e.shiftKey && list.selection.length > 0) {
      const anchor = list.selection[0] as number;
      current.clear();
      for (let i = Math.min(anchor, index); i <= Math.max(anchor, index); i++) current.add(i);
    } else {
      current.clear();
      current.add(index);
    }
    setList({ ...list, selection: [...current].sort((a, b) => a - b) });
  };

  return (
    <div className="ze-modal-backdrop">
      <div className="ze-modal ze-equfiles" role="dialog" aria-modal="true">
        <div className="ze-modal-header">
          {equFilesDialogTitle(proName)}
          <span className="x" title="Close" onClick={onClose}>
            ✕
          </span>
        </div>
        <div className="ze-modal-body ze-equfiles-body">
          <div className="ze-equfiles-label">Footprint association files:</div>
          {/* `wxLB_EXTENDED|wxLB_HSCROLL|wxLB_NEEDED_SB` with a 500 x 100
              minimum (dialog_config_equfiles_base.cpp:29-30). */}
          <div className="ze-equfiles-list" role="listbox" aria-label="Footprint association files">
            {list.files.map((f, i) => (
              <div
                key={f}
                role="option"
                aria-selected={list.selection.includes(i)}
                className={`ze-equfiles-row${list.selection.includes(i) ? ' selected' : ''}`}
                onClick={(e) => rowClick(i, e)}
              >
                {f}
              </div>
            ))}
          </div>
          {/* The button row, in the base class's order: the four on the left,
              a fixed 20 px spacer, then Remove on its own. */}
          <div className="ze-equfiles-buttons">
            <StdBitmapButton
              bitmap="small_folder"
              title="Add association file"
              onClick={() => setAddOpen(true)}
            />
            <StdBitmapButton
              bitmap="small_up"
              title="Move up"
              onClick={() => setList(moveEquFilesUp(list))}
            />
            <StdBitmapButton
              bitmap="small_down"
              title="Move down"
              onClick={() => setList(moveEquFilesDown(list))}
            />
            <StdBitmapButton
              bitmap="small_edit"
              title="Edit association file"
              disabled
              onClick={() => {}}
            />
            <span className="ze-equfiles-gap" />
            <StdBitmapButton
              bitmap="small_trash"
              title="Remove association file"
              onClick={() => setList(removeEquFiles(list))}
            />
          </div>
          <div className="ze-equfiles-label ze-equfiles-vars-label">
            Available path substitutions:
          </div>
          <table className="ze-grid ze-equfiles-vars">
            <tbody>
              <tr>
                <td>{PROJECT_VAR_NAME}</td>
                <td>{root.replace(/\/$/, '')}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="ze-modal-footer">
          <button
            type="button"
            className="ze-btn primary"
            onClick={() => onSave(list.files, pending)}
          >
            OK
          </button>
          <button type="button" className="ze-btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>

      {/* `wxFileDialog( … FILEEXT::EquFileWildcard(), wxFD_DEFAULT_STYLE |
          wxFD_MULTIPLE )` (`:216-217`) — over the account's tree, which is this
          app's filesystem, with the local disk offered beside it. */}
      {addOpen && (
        <OpenFileDialog
          title="Footprint Association File"
          accept="Add"
          multiple
          filters={[equFileWildcard()]}
          extra={
            <button
              type="button"
              className="ze-btn"
              onClick={() => {
                setAddOpen(false);
                localInput.current?.click();
              }}
            >
              Add from Computer...
            </button>
          }
          onDone={(file) => {
            setAddOpen(false);
            if (!file) return; // wxID_CANCEL
            addChosen(file.path, file.text);
            for (const other of file.rest) addChosen(other.path, other.text);
          }}
        />
      )}
      {/* The local disk, which the account tree cannot see. */}
      <input
        ref={localInput}
        type="file"
        accept={`.${EQU_FILE_EXTENSION}`}
        multiple
        hidden
        onChange={(e) => {
          const chosen = Array.from(e.target.files ?? []);
          e.target.value = '';
          void (async () => {
            for (const f of chosen) addChosen(f.name, await f.text());
          })();
        }}
      />
      {error !== null && <MessageDialogError message={error} onClose={() => setError(null)} />}
    </div>
  );
}
