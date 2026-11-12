// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Project Rescue Helper's dialog. Counterpart:
 * `eeschema/dialogs/dialog_rescue_each.cpp` and its `_base`.
 *
 * The sizer tree, ported whole rather than guessed at from a screenshot:
 *
 *     bSizerMain (vertical)
 *       bSizer8 (vertical, proportion 3)
 *         m_htmlPrompt          min height 80, EXPAND|TOP|BOTTOM 5
 *         "Symbols to update:"  EXPAND|LEFT|RIGHT 10
 *         2 px spacer
 *         m_ListOfConflicts     proportion 2, EXPAND|BOTTOM|RIGHT|LEFT 10
 *         "Instances of this symbol (n items):"
 *         2 px spacer
 *         m_ListOfInstances     proportion 1, EXPAND|BOTTOM|RIGHT|LEFT 10
 *       bSizerPreviews (horizontal, proportion 2, EXPAND|RIGHT|LEFT 10)
 *         "Cached Symbol:"  + panel, min width 350
 *         "Library Symbol:" + panel, min width 350
 *       bSizer5 (horizontal)
 *         "Never Show Again" ALIGN_CENTER_VERTICAL|RIGHT|LEFT 10
 *         stretch spacer
 *         OK / Cancel
 *
 * Two things about it are easy to get wrong and are load-bearing:
 *
 *   - every candidate starts CHECKED (`data.push_back( wxVariant( true ) )`),
 *     so OK with nothing touched rescues everything. The dialog is a list of
 *     things to un-tick, not one to tick.
 *   - "Never Show Again" does not just set the preference. It asks first, and
 *     on yes it clears the chosen candidates and closes — `m_chosen_candidates.clear()`
 *     — so nothing is rescued. Its own message says so: "No changes will be
 *     made." A port that set the flag and left the rescue running would do the
 *     opposite of what the button promises.
 */
import { Button } from '@ziroeda/wx/controls.js';
import { useState, type JSX } from 'react';
import type { LibSymbol } from '@ziroeda/eeschema';
import {
  rescueActionDescription,
  type DialogRescueEachProps,
} from '@ziroeda/eeschema/project_rescue.js';
import { unescapeString } from '@ziroeda/common';
import { SymbolPreviewWidget } from '../widgets/symbol_preview_widget.js';
import { MessageDialogYesNo } from '@ziroeda/common/dialogs/dialog_message.js';
import { DialogShim } from '@ziroeda/common/dialog_shim.js';
import './dialog_rescue_each.css';
import { _ } from '@ziroeda/wx/translation.js';

const INFO =
  'This schematic was made using older symbol libraries which may break the schematic. ' +
  'Some symbols may need to be linked to a different symbol name. Some symbols may need to ' +
  'be "rescued" (copied and renamed) into a new library.\n\n' +
  'The following changes are recommended to update the project.';

const NEVER_SHOW_QUESTION =
  'Stop showing this tool?\nNo changes will be made.\n\n' +
  'This setting can be changed from the "Preferences" dialog,\n' +
  'and the tool can be activated manually from the "Tools" menu.';

export function DialogRescueEach({
  candidates,
  instancesOf,
  askShowAgain,
  inputPrefs,
  onOk,
  onCancel,
  onNeverShowAgain,
}: DialogRescueEachProps): JSX.Element {
  // "Select the first choice" — PopulateConflictList selects row 0 and shows it.
  const [selected, setSelected] = useState(0);
  // Every row starts accepted; see the note at the top of the file.
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(
    () => new Set(candidates.map((c) => c.requestedId)),
  );
  const [confirmNever, setConfirmNever] = useState(false);

  const current = candidates[selected] ?? candidates[0];
  const instances = current ? instancesOf(current.requestedId) : [];

  const toggle = (id: string): void =>
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const preview = (symbol: LibSymbol | null): JSX.Element => (
    <SymbolPreviewWidget
      symbol={symbol}
      unit={current?.unit ?? 0}
      {...(inputPrefs ? { inputPrefs } : {})}
    />
  );

  return (
    <>
      <DialogShim
        title={_('Project Rescue Helper')}
        onClose={onCancel}
        className="ze-rescue-dialog"
      >
        <div className="ze-rescue-body">
          {/* m_htmlPrompt: an HTML_WINDOW with the button-face background. */}
          <div className="ze-rescue-prompt">{INFO}</div>

          <div className="ze-rescue-title">{_('Symbols to update:')}</div>
          <div className="ze-rescue-list ze-rescue-conflicts">
            <table className="ze-grid">
              <thead>
                <tr>
                  <th className="ze-rescue-accept">{_('Accept')}</th>
                  <th>{_('Symbol Name')}</th>
                  <th>{_('Action Taken')}</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c, i) => (
                  <tr
                    key={c.requestedId}
                    className={i === selected ? 'selected' : undefined}
                    onClick={() => setSelected(i)}
                  >
                    <td className="ze-rescue-accept">
                      <input
                        type="checkbox"
                        checked={accepted.has(c.requestedId)}
                        onChange={() => toggle(c.requestedId)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    <td>{unescapeString(c.requestedId)}</td>
                    <td>{rescueActionDescription(c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ze-rescue-title">
            Instances of this symbol ({instances.length} items):
          </div>
          <div className="ze-rescue-list ze-rescue-instances">
            <table className="ze-grid">
              <thead>
                <tr>
                  <th>{_('Reference')}</th>
                  <th>{_('Value')}</th>
                </tr>
              </thead>
              <tbody>
                {instances.map((inst) => (
                  <tr key={`${inst.reference}\u0000${inst.value}`}>
                    <td>{inst.reference}</td>
                    <td>{inst.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ze-rescue-previews">
            <div className="ze-rescue-preview">
              <div className="lbl">{_('Cached Symbol:')}</div>
              <div className="ze-rescue-preview-panel">{preview(current?.cache ?? null)}</div>
            </div>
            <div className="ze-rescue-preview">
              <div className="lbl">{_('Library Symbol:')}</div>
              <div className="ze-rescue-preview-panel">{preview(current?.lib ?? null)}</div>
            </div>
          </div>
        </div>

        <div className="ze-rescue-buttons">
          {askShowAgain && (
            <Button label={_('Never Show Again')} onClick={() => setConfirmNever(true)} />
          )}
          <div className="spacer" />
          <Button
            label={_('OK')}
            isDefault
            onClick={() => onOk(candidates.filter((c) => accepted.has(c.requestedId)))}
          />
          <Button label={_('Cancel')} onClick={onCancel} />
        </div>
      </DialogShim>

      {confirmNever && (
        <MessageDialogYesNo
          caption={_('Rescue Symbols')}
          message={NEVER_SHOW_QUESTION}
          icon="question"
          defaultButton="no"
          onResult={(r) => {
            setConfirmNever(false);
            // Yes clears the chosen candidates and closes: nothing is rescued.
            if (r === 'yes') onNeverShowAgain();
          }}
        />
      )}
    </>
  );
}
