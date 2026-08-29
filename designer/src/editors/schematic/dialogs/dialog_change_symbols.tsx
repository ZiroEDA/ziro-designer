// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Change Symbols / Update Symbols from Library. Counterpart:
 * `eeschema/dialogs/dialog_change_symbols_base.cpp` (DIALOG_CHANGE_SYMBOLS),
 * which is one dialog in two modes — the title, the field-box label and the
 * defaults change, the machinery does not.
 *
 * Update pulls each symbol's own library entry back in; Change swaps the
 * symbols for a different library part. The checklist is the real decision:
 * which fields the library is allowed to overwrite. Its defaults differ per
 * mode, because changing to a different part should bring that part's look,
 * while updating should leave your field placement alone.
 *
 * LAYOUT, from `_base.cpp`'s `m_mainSizer` (vertical):
 *
 *     matchSizerMargins   the five match rows, each radio and its own entry
 *                         on ONE line                                  (:68)
 *     8 px spacer                                                      (:71)
 *     m_staticline1                                                    (:74)
 *     m_newIdSizer        Change mode's "New library identifier"       (:90)
 *     bSizerUpdate        horizontal:
 *         m_updateFieldsSizer  "Update/Reset Fields", proportion 2    (:116)
 *             m_fieldsBox      a wxCheckListBox — a bordered, scrolling
 *                              list, not a grid of checkboxes          (:98)
 *             Select All / Select None                             (:106-109)
 *         5 px spacer                                                 (:119)
 *         m_updateOptionsSizer "Update Options", proportion 4, and it is
 *                              wxHORIZONTAL: TWO columns             (:121,197)
 *     m_messagePanel      WX_HTML_REPORT_PANEL, SetMinSize( -1, 200 ) (:205)
 *     m_sdbSizer          Close / Update                              (:220)
 *
 * This was one long single column with no report panel, no Update Options box
 * and no seeding, inside a "Scope" group that upstream does not have.
 */
import { Fragment, useState, type JSX } from 'react';
import {
  defaultChangeSymbolsOptions,
  type ChangeSymbolsMessage,
  type ChangeSymbolsMode,
  type ChangeSymbolsOptions,
  type SymbolMatch,
  type SymbolMatchMode,
} from '@ziroeda/eeschema';
import { RPT_SEVERITY_ACTION, RPT_SEVERITY_ERROR, type ReportLine } from '@ziroeda/common';
import { useModalEscape } from '../../../ui/useModalEscape.js';
import { HtmlReportPanel, RPT_SEVERITY_ALL } from '../../../widgets/wx_html_report_panel.js';
import { Icon } from '../../../ui/icons.js';
import { SymbolChooserFrame } from './symbol_chooser_frame.js';
import type { PickedSymbol } from '../widgets/panel_symbol_chooser.js';

/**
 * The symbol the dialog was opened ON, when it was opened from one — Symbol
 * Properties' "Update Symbol from Library..." passes the symbol it is editing.
 * `DIALOG_CHANGE_SYMBOLS` takes it as its second constructor argument and seeds
 * all three entries from it (`TransferDataToWindow`, :146-152).
 */
export interface ChangeSymbolsSubject {
  /** `m_symbol->GetRef( currentSheet )`. */
  reference: string;
  /** `UnescapeString( m_symbol->GetField( FIELD_T::VALUE )->GetText() )`. */
  value: string;
  /** `UnescapeString( m_symbol->GetLibId().Format() )`. */
  libId: string;
  /** `m_symbol->IsSelected()`, which decides the opening radio. */
  isSelected: boolean;
}

interface Props {
  mode: ChangeSymbolsMode;
  /**
   * The checklist's contents FOR A GIVEN MATCH. `updateFieldsList()` is re-run
   * from every match handler upstream (`onMatchByAll`, `onMatchBySelected`, …),
   * because the list is built from the symbols the match selects — choosing a
   * different scope offers a different set of fields.
   */
  fieldNamesFor: (match: SymbolMatch) => readonly string[];
  hasSelection: boolean;
  /**
   * The symbol this was opened on, if any. Absent when the dialog is opened
   * from the Tools menu rather than from a symbol — and then upstream HIDES the
   * "selected symbol(s)" radio outright:
   *   `if( !m_symbol ) m_matchSizer->FindItem( m_matchBySelection )->Show( false )`.
   */
  subject?: ChangeSymbolsSubject;
  /** Report lines from the last run; the dialog stays open to show them. */
  messages: readonly ChangeSymbolsMessage[];
  onApply: (o: ChangeSymbolsOptions) => void;
  onClose: () => void;
  /**
   * `s_SymbolHistoryList`, for the chooser the two browse buttons open.
   * SYMBOL_CHOOSER_FRAME passes the same global list the Place Symbol chooser
   * uses (symbol_chooser_frame.cpp:86), so a symbol placed a moment ago is
   * under "Recently Used" here too.
   */
  chooserHistory?: readonly PickedSymbol[];
  /** "Show footprint previews in Symbol Chooser" (Preferences > Editing). */
  showFootprints?: boolean;
}

/** The five match rows, in `_base.cpp` order. `needs` names the entry beside
 *  the radio — upstream has THREE separate controls, not one shared box. */
const MATCH_ROWS: {
  mode: SymbolMatchMode;
  label: string;
  needs?: 'reference' | 'value' | 'libId';
}[] = [
  { mode: 'all', label: 'Update all symbols in schematic' },
  { mode: 'selected', label: 'Update selected symbol(s)' },
  {
    mode: 'reference',
    label: 'Update symbols matching reference designator:',
    needs: 'reference',
  },
  { mode: 'value', label: 'Update symbols matching value:', needs: 'value' },
  {
    mode: 'libId',
    label: 'Update symbols matching library identifier:',
    needs: 'libId',
  },
];

export function DialogChangeSymbols({
  mode,
  fieldNamesFor,
  hasSelection,
  subject,
  messages,
  onApply,
  onClose,
  chooserHistory = [],
  showFootprints = true,
}: Props): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onClose);

  /* The panel filters on REPORTER's severity mask, so the engine's messages
     become REPORT_LINEs on the way in. `DIALOG_CHANGE_SYMBOLS` only ever
     reports two of the eight severities — RPT_SEVERITY_ERROR (:565, :599,
     :610, :621) and RPT_SEVERITY_ACTION (:832) — which is why
     `ChangeSymbolsMessage.severity` is a two-value union. Every line is a body
     line: upstream calls plain `Report()`, never ReportHead/ReportTail. */
  const reportLines: readonly ReportLine[] = messages.map((m) => ({
    message: m.text,
    severity: m.severity === 'error' ? RPT_SEVERITY_ERROR : RPT_SEVERITY_ACTION,
    location: 'body',
  }));

  /* The five checkboxes start ticked, as WX_HTML_REPORT_PANEL_BASE sets them
     (`SetValue( true )` on all five). Upstream persists this per facility;
     this dialog has no such setting, so it resets with the dialog. */
  const [severities, setSeverities] = useState<number>(RPT_SEVERITY_ALL);

  const [opts, setOpts] = useState<ChangeSymbolsOptions>(() => {
    const base = defaultChangeSymbolsOptions(mode);
    // `TransferDataToWindow` (:155-160): the symbol's own row if it is
    // selected; otherwise all-symbols in Update mode, by-reference in Change.
    const start: SymbolMatchMode = subject?.isSelected
      ? 'selected'
      : mode === 'change'
        ? 'reference'
        : 'all';
    return { ...base, match: { mode: start } };
  });

  /**
   * The three entries, each seeded from the symbol. `ChangeValue` rather than
   * `SetValue` upstream, i.e. seeded without firing the change handlers, which
   * is why seeding does not itself select a radio.
   */
  const [matchText, setMatchText] = useState<Record<'reference' | 'value' | 'libId', string>>({
    reference: subject?.reference ?? '',
    value: subject?.value ?? '',
    libId: subject?.libId ?? '',
  });
  const [newLibId, setNewLibId] = useState('');
  /**
   * Which browse button is up, or null. Upstream has two — `m_matchIdBrowserButton`
   * beside the match's library identifier and `m_newIdBrowserButton` beside the
   * new one — and `launchMatchIdSymbolBrowser` / `launchNewIdSymbolBrowser`
   * (:245, :262) differ only in the field they seed from and write back to.
   */
  const [browsing, setBrowsing] = useState<'match' | 'new' | null>(null);

  const set = <K extends keyof ChangeSymbolsOptions>(k: K, v: ChangeSymbolsOptions[K]): void =>
    setOpts((o) => ({ ...o, [k]: v }));

  /** `updateFieldsList()`, re-run whenever the match changes. */
  const fieldNames = fieldNamesFor(opts.match);

  const toggleField = (name: string): void =>
    setOpts((o) => {
      const next = new Set(o.updateFields);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return { ...o, updateFields: next };
    });

  // The words the Change-mode SetLabel block swaps out (ctor, :60-74).
  const part = mode === 'change' ? 'new symbol' : 'library symbol';
  const upd = mode === 'change' ? 'Update' : 'Update/reset';

  /** Every option in the right-hand box, so Check/Uncheck All can sweep them. */
  const OPTION_KEYS: (keyof ChangeSymbolsOptions)[] = [
    'removeExtraFields',
    'resetEmptyFields',
    'resetFieldText',
    'resetFieldVisibilities',
    'resetFieldEffects',
    'resetFieldPositions',
    'resetPinTextVisibility',
    'resetAlternatePin',
    'resetAttributes',
    'resetCustomPower',
  ];
  const setAllOptions = (v: boolean): void =>
    setOpts((o) => {
      const next = { ...o };
      for (const k of OPTION_KEYS) (next as Record<string, unknown>)[k] = v;
      return next;
    });

  /* A caveat of ours goes in the TOOLTIP, never beside the label. Upstream's
     row is one wxCheckBox and nothing else, and a trailing wxStaticText has no
     counterpart in the sizer — but it still offers its own width to the
     column, and through `m_updateOptionsSizer`'s 4-of-6 proportion straight to
     the dialog. "(not applied yet)" beside this one checkbox was 109 px of it.
     `m_removeExtraBox` already carries its explanation this way, because
     upstream gives it a SetToolTip and no second label. */
  const check = (
    label: string,
    k: keyof ChangeSymbolsOptions,
    extra?: { title?: string },
  ): JSX.Element => (
    <label className="row ze-chsym-opt" title={extra?.title}>
      <input
        type="checkbox"
        checked={Boolean(opts[k])}
        onChange={(e) => set(k, e.target.checked as never)}
      />
      <span>{label}</span>
    </label>
  );

  /** `updateShapeAndPins` / `updateKeywordsAndFootprintFilters`: SetValue(true)
   *  then Enable(false) in the base file (:160-161, :167-168). They are not
   *  options — they say what the operation always does. */
  const fixedOn = (label: string): JSX.Element => (
    <label className="row ze-chsym-opt">
      <input type="checkbox" checked disabled readOnly />
      <span>{label}</span>
    </label>
  );

  const apply = (): void => {
    const row = MATCH_ROWS.find((r) => r.mode === opts.match.mode);
    const text = row?.needs ? matchText[row.needs] : '';
    onApply({
      ...opts,
      match: { mode: opts.match.mode, ...(text ? { text } : {}) },
      ...(mode === 'change' ? { newLibId } : {}),
    });
  };

  const title = mode === 'change' ? 'Change Symbols' : 'Update Symbols from Library';

  /* `launchMatchIdSymbolBrowser` / `launchNewIdSymbolBrowser` (:245-259, :262):
     open SYMBOL_CHOOSER_FRAME seeded with whatever the field holds, and on a
     valid pick write `UnescapeString( newName )` back and re-run
     updateFieldsList(). The re-run is free here — `fieldNames` is derived on
     render, so writing the field re-derives it. */
  const browserSeed = browsing === 'new' ? newLibId : matchText.libId;
  const acceptBrowsed = (libId: string): void => {
    if (browsing === 'new') setNewLibId(libId);
    else setMatchText((t) => ({ ...t, libId }));
    setBrowsing(null);
  };

  return (
    <>
      {/* A SIBLING of this dialog's backdrop, not a child of it: the chooser
          brings its own backdrop, and a click on that one must not also reach
          this dialog's `onMouseDown={onClose}` and close the thing that opened
          it. Escape is already safe — modal_escape.ts is a stack and the
          chooser mounts on top. Upstream gets both for free from a modal
          KIWAY_PLAYER. */}
      {browsing !== null && (
        <SymbolChooserFrame
          preselect={browserSeed}
          showFootprints={showFootprints}
          historyList={chooserHistory}
          onOk={acceptBrowsed}
          onCancel={() => setBrowsing(null)}
        />
      )}
      <div className="ze-modal-backdrop" onMouseDown={onClose}>
        <div className="ze-modal ze-chsym" onMouseDown={(e) => e.stopPropagation()}>
          <div className="ze-modal-header">
            {title}
            <span className="x" title="Close" onClick={onClose}>
              ✕
            </span>
          </div>
          <div className="ze-label-dialog-body ze-chsym-body">
            {/* matchSizerMargins. No group box: upstream puts these five rows
              straight into the main sizer, each radio and its own entry on one
              line. */}
            {/* `m_matchSizer` is a `wxGridBagSizer( 3, 0 )` — TWO columns, five
              rows, `AddGrowableCol( 1 )`:

                (0,0) m_matchAll         span 1x2   — across both columns
                (1,0) m_matchBySelection span 1x1
                (2,0) m_matchByReference | (2,1) m_specifiedReference  wxEXPAND
                (3,0) m_matchByValue     | (3,1) m_specifiedValue      wxEXPAND
                (4,0) m_matchById        | (4,1) bSizer10 [ m_specifiedId,
                                                m_matchIdBrowserButton ]

              so the radios share one column and every entry starts at the same
              x. Five independent flex rows cannot do that — each was as wide as
              its own label. */}
            <div className="ze-chsym-match">
              {MATCH_ROWS.map((m) => {
                // `if( !m_symbol ) ... m_matchBySelection ... Show( false )`.
                if (m.mode === 'selected' && !subject) return null;
                const label = mode === 'change' ? m.label.replace('Update', 'Change') : m.label;
                return (
                  <Fragment key={m.mode}>
                    <label className={m.needs ? 'ze-chsym-mrad' : 'ze-chsym-mrad ze-chsym-mspan'}>
                      <input
                        type="radio"
                        name="ze-change-symbols-scope"
                        checked={opts.match.mode === m.mode}
                        disabled={m.mode === 'selected' && !hasSelection}
                        onChange={() => set('match', { mode: m.mode })}
                      />
                      <span>{label}</span>
                    </label>
                    {m.needs && (
                      <div className="ze-chsym-mentry">
                        <input
                          className="ze-search"
                          aria-label={label}
                          value={matchText[m.needs]}
                          onChange={(e) =>
                            setMatchText((t) => ({ ...t, [m.needs as string]: e.target.value }))
                          }
                          onKeyDown={(e) => e.stopPropagation()}
                        />
                        {/* `m_matchIdBrowserButton`, beside the library-id entry
                          only (bSizer10). It opens the symbol chooser, which
                          this app has — wiring it is a separate change; it is
                          here in its position and greyed rather than absent. */}
                        {m.needs === 'libId' && (
                          <button
                            type="button"
                            className="ze-gridbtn"
                            title="Browse for symbol"
                            aria-label="Browse for symbol"
                            onClick={() => setBrowsing('match')}
                          >
                            <Icon name="smallLibrary" size={14} />
                          </button>
                        )}
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>

            {/* m_staticline1 */}
            <hr className="ze-chsym-rule" />

            {mode === 'change' && (
              <label className="row ze-chsym-newid">
                <span>New library identifier:</span>
                <input
                  className="ze-search"
                  value={newLibId}
                  onChange={(e) => setNewLibId(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                />
                {/* `m_newIdBrowserButton` (_base.cpp:97), the twin of the match
                  row's. This row had no button at all. */}
                <button
                  type="button"
                  className="ze-gridbtn"
                  title="Browse for new symbol"
                  aria-label="Browse for new symbol"
                  onClick={() => setBrowsing('new')}
                >
                  <Icon name="smallLibrary" size={14} />
                </button>
              </label>
            )}

            {/* bSizerUpdate: the fields box at proportion 2, the options box at 4. */}
            <div className="ze-chsym-update">
              <fieldset className="ze-props-group ze-chsym-fields">
                <legend>{mode === 'change' ? 'Update Fields' : 'Update/Reset Fields'}</legend>
                {/* m_fieldsBox is a wxCheckListBox: a bordered, scrolling list
                  with a checkbox per row, which is why it reads as a box and
                  not as a run of loose checkboxes. */}
                <div className="ze-chsym-fieldbox">
                  {fieldNames.map((name) => (
                    <label className="row" key={name}>
                      <input
                        type="checkbox"
                        checked={opts.updateFields.has(name)}
                        onChange={() => toggleField(name)}
                      />
                      <span>{name}</span>
                    </label>
                  ))}
                </div>
                <div className="ze-chsym-selbtns">
                  <button
                    className="ze-btn"
                    onClick={() => set('updateFields', new Set(fieldNames))}
                    type="button"
                  >
                    Select All
                  </button>
                  <button
                    className="ze-btn"
                    onClick={() => set('updateFields', new Set())}
                    type="button"
                  >
                    Select None
                  </button>
                </div>
              </fieldset>

              <fieldset className="ze-props-group ze-chsym-options">
                <legend>Update Options</legend>
                {/* m_updateOptionsSizer is wxHORIZONTAL — bSizer8 then bSizer9. */}
                <div className="ze-chsym-optcol">
                  {check(`Remove fields if not in ${part}`, 'removeExtraFields', {
                    title: 'Removes fields that do not occur in the original library symbols',
                  })}
                  {check(`Reset fields if empty in ${part}`, 'resetEmptyFields')}
                  {/* `bSizer8->Add( 0, 10, 1, wxEXPAND, 5 )` — a spacer with
                    PROPORTION 1, so it takes the column's slack and pushes the
                    lower group down. */}
                  <div className="ze-chsym-optgap" />
                  {check(`${upd} field text`, 'resetFieldText')}
                  {check(`${upd} field visibilities`, 'resetFieldVisibilities')}
                  {check(`${upd} field text sizes and styles`, 'resetFieldEffects')}
                  {check(`${upd} field positions`, 'resetFieldPositions')}
                  <button className="ze-btn" type="button" onClick={() => setAllOptions(true)}>
                    Check All Update Options
                  </button>
                </div>
                <div className="ze-chsym-optcol">
                  {fixedOn('Update symbol shape and pins')}
                  {fixedOn('Update keywords and footprint filters')}
                  <div className="ze-chsym-optgap" />
                  {check(`${upd} pin name/number visibilities`, 'resetPinTextVisibility', {
                    title: 'Not applied yet',
                  })}
                  {check('Reset alternate pin functions', 'resetAlternatePin')}
                  {/* bSizer9 has TWO proportion-1 spacers, not one (:61, :64). */}
                  <div className="ze-chsym-optgap" />
                  {check(`${upd} symbol attributes`, 'resetAttributes')}
                  {check('Reset custom power symbols', 'resetCustomPower')}
                  <button className="ze-btn" type="button" onClick={() => setAllOptions(false)}>
                    Uncheck All Update Options
                  </button>
                </div>
              </fieldset>
            </div>

            {/* m_messagePanel is a WX_HTML_REPORT_PANEL, the same widget ERC,
              Annotate, Plot, Export Netlist and Update PCB from Schematic
              embed — so it brings the "Show:" severity strip, the two
              NUMBER_BADGEs and Save... with it. This was a bare list of divs
              with no filters at all. It is not conditional upstream: an empty
              report panel is what the dialog opens with. */}
            <div className="ze-chsym-msgs">
              <HtmlReportPanel
                label="Output Messages"
                lines={reportLines}
                fileName="report.txt"
                visibleSeverities={severities}
                onVisibleSeveritiesChange={setSeverities}
                // The 200 px minimum upstream states is on the PANEL
                // (`SetMinSize( wxSize( -1, 200 ) )`, :206), not on the message
                // view: the view is whatever is left once the Show: strip has
                // taken its 44. `.ze-chsym-msgs` carries it, so the view asks
                // for nothing of its own and simply grows into what is left.
                minHeight={0}
              />
            </div>
          </div>
          <div className="ze-modal-footer">
            <button className="ze-btn" onClick={onClose}>
              Close
            </button>
            <button
              className="ze-btn primary"
              onClick={apply}
              disabled={mode === 'change' && newLibId.trim() === ''}
            >
              {mode === 'change' ? 'Change' : 'Update'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
