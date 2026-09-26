// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_ASSIGN_NETCLASS` (common/dialogs/dialog_assign_netclass.cpp) with its
 * `_base` folded in: what Assign Netclass... opens in the schematic
 * (SCH_EDITOR_CONTROL::AssignNetclass) and the board editor
 * (BOARD_EDITOR_CONTROL::AssignNetclass).
 *
 * ONE pattern, proposed for the whole selection by `GetNetclassPatternForSet`
 * and editable; a read-only choice of net class (the first non-Default one
 * selected); and under them, as the pattern is typed, "Currently matching
 * nets:" from the frame's candidate nets, which the frame also previews
 * (`m_previewer`). OK makes one `SetNetclassPatternAssignment( pattern, class )`
 * - the caller applies it - and an empty pattern does nothing.
 *
 * The sizer tree (dialog_assign_netclass_base.cpp): `bUpperSizer`
 * (wxEXPAND|wxALL 5) holds "Pattern:" (wxLEFT 10), the entry (proportion 1,
 * 240 px minimum, wxRIGHT|wxLEFT 5), "Net class:" (wxLEFT 30) and the choice
 * (wxALL 5); `bLowerSizer` (wxBOTTOM|wxEXPAND|wxLEFT|wxRIGHT 10) holds the
 * WX_HTML_REPORT_BOX (200 px tall minimum, wxEXPAND|wxBOTTOM|wxRIGHT|wxLEFT 5)
 * and the italic note (wxTOP|wxRIGHT|wxLEFT 5); the std buttons wxALL 5. The
 * report and the note are in the info font (KIUI::GetInfoFont).
 */
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { StdDialogButtons } from '../dialog_shim_buttons.js';
import { netclassPatternMatches } from '../eda_pattern_match.js';
import { strNumCmp } from '../string_utils.js';
import { Combo } from '../widgets/wx_combobox.js';
import { WX_HTML_REPORT_BOX } from '../widgets/wx_html_report_box.js';
import { useModalEscape } from './use_modal_escape.js';

/** `NETCLASS::Default`. */
const DEFAULT_NETCLASS = 'Default';

/** `UpgradeGlobStarToRegex`: a `*` not preceded by `.` becomes `.*`. */
export function UpgradeGlobStarToRegex(aPattern: string): string {
  return aPattern.replace(/(?<!\.)\*/g, '.*');
}

/** `GetStringCommonPrefix`. */
export function GetStringCommonPrefix(aSet: readonly string[]): string {
  if (aSet.length === 0) return '';
  let commonPrefix = aSet[0]!;
  for (const str of aSet) {
    const minLength = Math.min(commonPrefix.length, str.length);
    let matchUntil = 0;
    while (matchUntil < minLength && commonPrefix[matchUntil] === str[matchUntil]) ++matchUntil;
    commonPrefix = commonPrefix.slice(0, matchUntil);
    if (commonPrefix === '') break;
  }
  return commonPrefix;
}

/**
 * `GetNetclassPatternForSet`: one name as itself; several glued with `|`,
 * natural-sorted case-insensitively, a common prefix other than "/" factored
 * out as `prefix(a|b)`. A glob star in a name is upgraded to a regex one first.
 */
export function GetNetclassPatternForSet(aNetNames: ReadonlySet<string>): string {
  if (aNetNames.size === 0) return '';
  if (aNetNames.size === 1) return [...aNetNames][0]!;
  const netNames = [...aNetNames].map(UpgradeGlobStarToRegex);
  netNames.sort((a, b) => strNumCmp(a, b, true));
  const commonPrefix = GetStringCommonPrefix(netNames);
  if (commonPrefix !== '' && commonPrefix !== '/') {
    const netTails = netNames.map((n) => n.slice(commonPrefix.length));
    return `${commonPrefix}(${netTails.join('|')})`;
  }
  return netNames.join('|');
}

/** `onPatternText`: the candidates the pattern matches, in candidate order. */
export function matchingNets(aPattern: string, aCandidates: Iterable<string>): string[] {
  if (aPattern === '') return [];
  return [...aCandidates].filter((net) => netclassPatternMatches(aPattern, net));
}

export function DialogAssignNetclass({
  netNames,
  candidateNetNames,
  netClasses,
  frame,
  onPreview,
  onOk,
  onCancel,
}: {
  /** `aNetNames`: the selection's nets (or bus patterns). */
  netNames: ReadonlySet<string>;
  /** `aCandidateNetNames`: every net the pattern may match. */
  candidateNetNames: Iterable<string>;
  /** `netSettings->GetNetclasses()`' names, in its (sorted) order, Default excluded. */
  netClasses: readonly string[];
  /** Which frame opened it: the note names that frame's Setup dialog. */
  frame: 'schematic' | 'pcb';
  /** `m_previewer`: show the matching nets in the frame. */
  onPreview?: (netNames: string[]) => void;
  /** wxID_OK with a non-empty pattern: `SetNetclassPatternAssignment`. */
  onOk: (pattern: string, netClass: string) => void;
  onCancel: () => void;
}): JSX.Element {
  useModalEscape(onCancel);

  // TransferDataToWindow: Default first, then the project's classes; the first
  // non-Default one selected.
  const choices = useMemo(() => [DEFAULT_NETCLASS, ...netClasses], [netClasses]);
  const [netClass, setNetClass] = useState(choices.length > 1 ? choices[1]! : DEFAULT_NETCLASS);
  const [pattern, setPattern] = useState(() => GetNetclassPatternForSet(netNames));
  const candidates = useMemo(() => [...candidateNetNames], [candidateNetNames]);
  const matches = useMemo(() => matchingNets(pattern, candidates), [pattern, candidates]);

  // onPatternText -> m_previewer( matchingNetNames ), on every change of pattern.
  const previewRef = useRef(onPreview);
  previewRef.current = onPreview;
  useEffect(() => {
    previewRef.current?.(matches);
  }, [matches]);

  const report = pattern === '' ? [] : ['<b>Currently matching nets:</b>', ...matches];

  return (
    <div className="ze-modal-backdrop">
      <div
        className="ze-modal ze-assignnc"
        role="dialog"
        aria-modal="true"
        aria-label="Assign Netclass"
      >
        <div className="ze-modal-header">Assign Netclass</div>
        <div className="ze-assignnc-upper">
          <span className="ze-assignnc-patlabel">Pattern:</span>
          <input
            className="ze-search ze-assignnc-pattern"
            aria-label="Pattern"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <span className="ze-assignnc-nclabel">Net class:</span>
          <Combo
            className="ze-assignnc-netclass"
            value={netClass}
            onChange={setNetClass}
            options={choices.map((c) => ({ value: c, label: c }))}
          />
        </div>
        <div className="ze-assignnc-lower">
          <WX_HTML_REPORT_BOX className="ze-assignnc-matching" messages={report} />
          <div className="ze-assignnc-info">
            {frame === 'pcb'
              ? 'Note: complete netclass assignments can be edited in Board Setup > Project.'
              : 'Note: complete netclass assignments can be edited in Schematic Setup > Project.'}
          </div>
        </div>
        <StdDialogButtons
          onCancel={onCancel}
          onOk={() => {
            if (pattern === '') onCancel();
            else onOk(pattern, netClass);
          }}
        />
      </div>
    </div>
  );
}
