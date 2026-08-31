// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { iuToMM } from '@ziroeda/common';
import {
  ERC_ITEMS,
  ercExclusionKey,
  nextMarker,
  prevMarker,
  type ErcSeverityLevel,
  type ErcViolation,
} from '@ziroeda/eeschema';
import { ContextMenu, type MenuItem } from '../../../ui/MenuBar.js';
import { ERC_PHASES } from '@ziroeda/eeschema';
import { bitmapUrl } from '../../../ui/toolbarIcons.js';
import { useModalEscape } from '../../../ui/useModalEscape.js';

/**
 * Electrical Rules Checker. Counterpart: `eeschema/dialogs/dialog_erc.cpp`
 * (DIALOG_ERC) over `dialog_erc_base.cpp`'s layout, the annotation infobar and
 * config menu, the Violations / Ignored Tests notebook over the marker tree
 * (640 x 260 minimum, as upstream sizes m_markerDataView), the "Show:" severity
 * row with its number badges and Save…, and the Delete Marker / Delete All
 * Markers / Run ERC / Close row.
 *
 * Modeless like upstream: it floats over the canvas, is dragged by its title
 * bar and resized from its corner, so the sheet stays visible while stepping
 * through faults.
 */

export interface ErcFilters {
  errors: boolean;
  warnings: boolean;
  exclusions: boolean;
}

/**
 * The "Show:" row's opening state.
 *
 * Upstream these are four plain `wxCheckBox`es built by the generated base
 * (`dialog_erc_base.cpp:143-176`) and read back only through
 * `DIALOG_ERC::getSeverities` (`dialog_erc.cpp:221-235`). Nothing persists
 * them: `EESCHEMA_SETTINGS m_Appearance.show_erc_*` is a DIFFERENT thing — the
 * canvas layer visibility the View menu toggles, `LAYER_ERC_ERR` /
 * `LAYER_ERC_WARN` / `LAYER_ERC_EXCLUSION` (`sch_edit_frame.cpp:2005-2007`) —
 * so the row is dialog state and starts here on every open.
 *
 * `dialog_erc_base.fbp` leaves all four `checked=0`, where the sibling
 * severity row in `dialog_drc_base.cpp:197,204` sets Errors and Warnings true;
 * taking the ERC generator output literally would open the dialog showing
 * nothing at all. The manual settles it: "Any warnings or errors are reported
 * in the Violations tab" and "Excluded violations are hidden unless the
 * Exclusions checkbox is enabled" (eeschema manual 4.6, Electrical rules
 * checking).
 */
export const ERC_DEFAULT_FILTERS: ErcFilters = {
  errors: true,
  warnings: true,
  exclusions: false,
};

/**
 * `NUMBER_BADGE::SetMaximumNumber( 999 )` (`dialog_erc.cpp:137-139`): a count
 * above the maximum reads "999+" (`number_badge.cpp:177-180`).
 */
export const ERC_BADGE_MAX = 999;

/** What a NUMBER_BADGE paints for one count, or null when it paints nothing. */
export interface ErcBadge {
  /** The label, capped with a "+" past the maximum. */
  text: string;
  /** The severity class the colour comes from. */
  kind: 'err' | 'warn' | 'excl' | 'zero';
}

/**
 * `NUMBER_BADGE::UpdateNumber` (`number_badge.cpp:43-92`). A negative number
 * hides the badge outright; zero hides it for every severity but error and
 * warning, where it turns green; anything else takes its severity's colour.
 *
 * `DIALOG_ERC::updateDisplayedCounts` passes -1 for the error and warning
 * counts when ERC has not been run and the count is zero
 * (`dialog_erc.cpp:391-396`), which is the only way the badge is hidden with
 * markers absent rather than shown green.
 */
export function ercBadge(n: number, severity: 'error' | 'warning' | 'exclusion'): ErcBadge | null {
  if (n < 0) return null;
  if (n === 0) {
    if (severity === 'exclusion') return null;
    return { text: '0', kind: 'zero' };
  }
  const text = n > ERC_BADGE_MAX ? `${ERC_BADGE_MAX}+` : `${n}`;
  return {
    text,
    kind: severity === 'error' ? 'err' : severity === 'warning' ? 'warn' : 'excl',
  };
}

/** EESCHEMA_SETTINGS m_ERCDialog, the config (gear) menu's three toggles. */
export interface ErcDialogOptions {
  crossprobe: boolean;
  scrollOnCrossprobe: boolean;
  showAllErrors: boolean;
}

/** Reported as `kicad_version` in the JSON report. */
const KICAD_VERSION = '10.0.0';

interface Props {
  /** The schematic file the report names as its source. */
  sourceName?: string;
  /** null until Run ERC has been pressed at least once (DIALOG_ERC m_ercRun). */
  violations: readonly ErcViolation[] | null;
  /** The "Tests Running…" page: phase messages so far, or null when idle. */
  running: readonly string[] | null;
  /** Rules whose severity is set to 'ignore' (the Ignored Tests tab). */
  ignoredTests: readonly string[];
  /** The config menu's toggles and their persistence. */
  options: ErcDialogOptions;
  onOptionsChange: (o: ErcDialogOptions) => void;
  /** Schematic not fully annotated: DIALOG_ERC shows an infobar warning. */
  unannotated?: boolean;
  onShowAnnotate?: () => void;
  onRun: () => void;
  /**
   * OnERCItemSelected: focus what the clicked row stands for, the marker
   * itself for a heading row (`itemId` unset), or that one item for a child
   * row. `center` follows the "Center on Cross-probe" option.
   */
  onLocate: (v: ErcViolation, center: boolean, itemId?: string) => void;
  /** One line describing an involved item (EDA_ITEM::GetItemDescription);
   *  `file` is the sheet the marker belongs to. */
  describeItem?: (id: string, file?: string) => string;
  /** Delete Marker / Delete All Markers (index into `violations`). */
  onDelete: (index: number) => void;
  onDeleteAll: () => void;
  /** Exclusion signatures (SCHEMATIC::m_ercExclusions); a marker whose key is
   *  in the set is excluded, shown only under the Exclusions filter. */
  excluded: ReadonlySet<string>;
  /** Exclude Marker / drop the exclusion (SCH_INSPECTION_TOOL::ExcludeMarker).
   *  `comment` is MARKER_BASE::SetComment (Exclude with comment…). */
  onToggleExclude: (v: ErcViolation, comment?: string) => void;
  /** The comment stored with each exclusion, by signature. */
  exclusionComments?: ReadonlyMap<string, string>;
  /** Cancel a run in flight (m_cancelled); absent = the button just closes. */
  onCancelRun?: () => void;
  /** Change severity for every violation of one rule (the row context menu). */
  onSetSeverity?: (code: ErcViolation['code'], level: ErcSeverityLevel) => void;
  /** "Edit ignored tests" link: opens Schematic Setup > Violation Severity. */
  onEditSeverities?: () => void;
  /** Open Schematic Setup on the Pin Conflicts Map / Formatting pages. */
  onEditPinMap?: () => void;
  onEditConnectionGrid?: () => void;
  /**
   * Previous / Next / Exclude Marker act on the dialog, not on the schematic:
   * upstream's SCH_INSPECTION_TOOL raises the dialog and calls into it, because
   * the dialog owns the tree the selection lives in. The Inspect menu fills
   * this ref in and calls it.
   */
  navRef?: { current: ErcDialogNav | null };
  onClose: () => void;
}

/** What the Inspect menu can do to an open dialog (DIALOG_ERC's public API). */
export interface ErcDialogNav {
  next: () => void;
  prev: () => void;
  /** ExcludeMarker with no marker given: whichever row the dialog has. */
  excludeCurrent: () => void;
  /**
   * `DIALOG_ERC::SelectMarker`: put the cursor on the row for this marker.
   *
   * `SCH_INSPECTION_TOOL::CrossProbe` calls it both when a marker is selected
   * on the canvas and when one is double-clicked, so clicking a marker walks
   * the dialog to its violation. Returns false if the row is filtered out of
   * the current view, which is the caller's cue not to pretend it worked.
   */
  selectByKey: (key: string) => boolean;
}

const fmt = (iu: number): string => `${iuToMM(iu).toFixed(2)} mm`;

/** Phases the gauge divides the run into (PROGRESS_REPORTER_BASE's phase count). */
const ERC_PHASE_COUNT = ERC_PHASES.length;

const titleOf = (code: ErcViolation['code']): string =>
  ERC_ITEMS.find((i) => i.code === code)?.title ?? code;

export function ErcDialog({
  sourceName,
  violations,
  running,
  ignoredTests,
  options,
  onOptionsChange,
  unannotated,
  onShowAnnotate,
  onRun,
  onLocate,
  describeItem,
  onDelete,
  onDeleteAll,
  excluded,
  onToggleExclude,
  exclusionComments,
  onCancelRun,
  onSetSeverity,
  onEditSeverities,
  onEditPinMap,
  onEditConnectionGrid,
  navRef,
  onClose,
}: Props): JSX.Element {
  const [tab, setTab] = useState<'violations' | 'ignored'>('violations');
  const [filters, setFilters] = useState<ErcFilters>(ERC_DEFAULT_FILTERS);
  // m_showAll is a checkbox in its own right. DIALOG_ERC drives the other
  // three FROM it and never the other way round, so it stays wherever the user
  // left it even once all three below are on.
  const [showAll, setShowAll] = useState(false);
  // RC_TREE_MODEL's selection: a marker row, or one of its item child rows.
  const [selected, setSelected] = useState<{ index: number; item: number | null } | null>(null);
  const selectedRowRef = useRef<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; index: number } | null>(null);

  const markers = violations ?? [];
  // DIALOG_ERC::updateDisplayedCounts: before a run the notebook titles drop
  // their "(%s)" count and the error/warning badges are hidden (UpdateNumber
  // with -1); the tree itself is simply empty.
  const notRun = violations === null;
  const isExcl = useCallback(
    (v: ErcViolation): boolean => excluded.has(ercExclusionKey(v)),
    [excluded],
  );
  // Badges tally by category, excluding the excluded ones (as KiCad does).
  // SHEETLIST_ERC_ITEMS_PROVIDER::GetCount( severity ) counts every marker of
  // that severity whether or not the filters are showing it, which is why the
  // badges disagree with the tab count (erc_settings.cpp:445-462).
  const active = markers.filter((v) => !isExcl(v));
  const errors = active.filter((v) => v.severity === 'error').length;
  const warnings = active.length - errors;
  const exclusionCount = markers.length - active.length;
  // updateDisplayedCounts hides the error and warning badges, rather than
  // showing them green, only while ERC has not been run.
  const errorsBadge = ercBadge(notRun && errors === 0 ? -1 : errors, 'error');
  const warningsBadge = ercBadge(notRun && warnings === 0 ? -1 : warnings, 'warning');
  const exclusionsBadge = ercBadge(exclusionCount, 'exclusion');

  // An excluded marker shows only under the Exclusions filter; an active one
  // shows per its severity filter (DIALOG_ERC::OnSeverity display rules).
  // SHEETLIST_ERC_ITEMS_PROVIDER sorts errors before warnings.
  const shown = useMemo(
    () =>
      (violations ?? [])
        .map((v, i) => ({ v, i }))
        .filter(({ v }) =>
          isExcl(v)
            ? filters.exclusions
            : v.severity === 'error'
              ? filters.errors
              : filters.warnings,
        ),
    [violations, filters, isExcl],
  );

  // PrevMarker / NextMarker step the *displayed* tree, and both switch to the
  // violations page first (DIALOG_ERC::NextMarker sets notebook selection 0).
  const step = useCallback(
    (dir: 1 | -1) => {
      setTab('violations');
      const order = shown.map(({ i }) => i);
      const from = selected?.index ?? null;
      const to = dir === 1 ? nextMarker(order, from) : prevMarker(order, from);
      // null means "leave the selection where it is": neither direction wraps.
      if (to !== null) setSelected({ index: to, item: null });
    },
    [shown, selected],
  );

  // EnsureVisible: keep whatever row is selected on screen, however it got
  // selected — Prev/Next Marker, or a cross-probe from a marker on the sheet.
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  useEffect(() => {
    if (!navRef) return;
    navRef.current = {
      next: () => step(1),
      prev: () => step(-1),
      excludeCurrent: () => {
        const v = selected === null ? undefined : violations?.[selected.index];
        // "if( !marker || marker->IsExcluded() ) return" — excluding twice is
        // not a toggle, and onToggleExclude is one.
        if (v && !isExcl(v)) onToggleExclude(v);
      },
      selectByKey: (key: string): boolean => {
        // Only rows the filters are showing can be selected — the tree upstream
        // does not hold hidden rows either.
        const hit = shown.find(({ v }) => ercExclusionKey(v) === key);
        if (!hit) return false;
        setTab('violations');
        setSelected({ index: hit.i, item: null });
        return true;
      },
    };
    return () => {
      navRef.current = null;
    };
  }, [navRef, step, selected, shown, violations, isExcl, onToggleExclude]);

  // RC_TREE_MODEL::GetValue: "Error: " / "Warning: " / "Excluded error: ".
  const rowPrefix = (v: ErcViolation): string =>
    isExcl(v)
      ? v.severity === 'warning'
        ? 'Excluded warning: '
        : 'Excluded error: '
      : v.severity === 'error'
        ? 'Error: '
        : 'Warning: ';

  /** ERC_REPORT::WriteJsonReport, the erc.v1 schema. */
  const jsonReport = (): string => {
    const sheets = new Map<string, { v: ErcViolation; i: number }[]>();
    for (const row of shown) {
      const path = row.v.file ?? '/';
      const arr = sheets.get(path) ?? [];
      arr.push(row);
      sheets.set(path, arr);
    }
    return JSON.stringify(
      {
        $schema: 'https://schemas.kicad.org/erc.v1.json',
        source: sourceName ?? '',
        date: new Date().toISOString(),
        kicad_version: KICAD_VERSION,
        coordinate_units: 'mm',
        included_severities: [
          filters.errors ? 'error' : '',
          filters.warnings ? 'warning' : '',
          filters.exclusions ? 'exclusion' : '',
        ].filter(Boolean),
        sheets: [...sheets].map(([path, rows]) => ({
          path,
          uuid_path: path,
          violations: rows.map(({ v }) => ({
            type: v.code,
            description: v.message,
            severity: v.severity,
            items: v.items.map((id) => ({
              uuid: id,
              description: describeItem?.(id, v.file) ?? id,
              pos: { x: iuToMM(v.at.x), y: iuToMM(v.at.y) },
            })),
            ...(isExcl(v)
              ? { excluded: true, comment: exclusionComments?.get(ercExclusionKey(v)) ?? '' }
              : {}),
          })),
        })),
        ignored_checks: ERC_ITEMS.filter((it) => ignoredTests.includes(it.title)).map((it) => ({
          key: it.code,
          description: it.title,
        })),
      },
      null,
      4,
    );
  };

  const download = (name: string, text: string): void => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  // DIALOG_ERC::OnSaveReport, the plain-text .rpt of ERC_REPORT::GetTextReport.
  const saveReport = (): void => {
    const parts: string[] = [
      `ERC report (${new Date().toISOString()}, Encoding UTF8)`,
      `Report includes: ${[
        filters.errors ? 'Errors' : '',
        filters.warnings ? 'Warnings' : '',
        filters.exclusions ? 'Exclusions' : '',
      ]
        .filter(Boolean)
        .join(', ')}`,
      '',
      '***** Sheet /',
    ];
    for (const { v } of shown) {
      const severity = `${v.severity}${isExcl(v) ? ' (excluded)' : ''}`;
      parts.push(`[${v.code}]: ${v.message}`);
      parts.push(`    ${titleOf(v.code)}; ${severity}`);
      parts.push(
        `    @(${fmt(v.at.x)}, ${fmt(v.at.y)}): ${describeItem?.(v.items[0] ?? '', v.file) ?? ''}`,
      );
    }
    parts.push('', ` ** ERC messages: ${markers.length}  Errors ${errors}  Warnings ${warnings}`);
    download('erc.rpt', parts.join('\n'));
  };

  // ----- movable / resizable panel (a DIALOG_SHIM is a real window) ---------
  // The drag writes straight to the element's style: re-rendering a list of
  // markers on every pointermove is what made the window lag behind the mouse.
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStart = (down: React.PointerEvent): void => {
    const panel = panelRef.current;
    if (!panel || (down.target as HTMLElement).closest('.x')) return;
    const box = panel.getBoundingClientRect();
    down.preventDefault();
    const dx = down.clientX - box.left;
    const dy = down.clientY - box.top;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    const move = (e: PointerEvent): void => {
      panel.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, e.clientX - dx))}px`;
      panel.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dy))}px`;
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Escape closes, as the dialog's Cancel/Close button does. On the shared
  // stack rather than a listener of its own (ui/modal_escape.ts): ERC opens
  // Severities, the Pin Conflicts Map and the Connection Grid on top of
  // itself, and a plain window listener closed those *and* ERC with one key.
  useModalEscape(onClose);

  /** OnERCItemRClick's menu for one violation. */
  const rowMenu = (index: number): MenuItem[] => {
    const v = markers[index]!;
    const excludedNow = isExcl(v);
    const listName = v.severity === 'error' ? 'errors' : 'warnings';
    const key = ercExclusionKey(v);
    const askComment = (initial: string): string | null => {
      // WX_TEXT_ENTRY_DIALOG( _( "Exclusion Comment" ) ).
      const text = window.prompt('Exclusion Comment', initial);
      return text === null ? null : text;
    };
    const items: MenuItem[] = excludedNow
      ? [
          {
            label: 'Remove exclusion for this violation',
            action: () => onToggleExclude(v),
          },
          {
            label: 'Edit exclusion comment...',
            action: () => {
              const text = askComment(exclusionComments?.get(key) ?? '');
              if (text !== null) onToggleExclude(v, text);
            },
          },
          { sep: true },
        ]
      : [
          {
            label: 'Exclude this violation',
            action: () => onToggleExclude(v),
          },
          {
            label: 'Exclude with comment...',
            action: () => {
              const text = askComment('');
              if (text !== null) onToggleExclude(v, text);
            },
          },
          { sep: true },
        ];
    const pinToPin = v.code === 'pin_to_pin' || v.code === 'pin_to_pin_error';
    if (!pinToPin && onSetSeverity) {
      items.push(
        v.severity === 'warning'
          ? {
              label: `Change severity to Error for all '${titleOf(v.code)}' violations`,
              action: () => onSetSeverity(v.code, 'error'),
            }
          : {
              label: `Change severity to Warning for all '${titleOf(v.code)}' violations`,
              action: () => onSetSeverity(v.code, 'warning'),
            },
      );
    }
    if (onSetSeverity) {
      items.push({
        label: `Ignore all '${titleOf(v.code)}' violations`,
        action: () => onSetSeverity(v.code, 'ignore'),
      });
    }
    items.push({ sep: true });
    if (pinToPin && onEditPinMap) {
      items.push({ label: 'Edit pin-to-pin conflict map...', action: onEditPinMap });
    } else if (onEditSeverities) {
      items.push({ label: 'Edit violation severities...', action: onEditSeverities });
    }
    if (v.code === 'endpoint_off_grid' && onEditConnectionGrid) {
      items.push({ label: 'Edit connection grid spacing...', action: onEditConnectionGrid });
    }
    void listName;
    return items;
  };

  const configMenu: MenuItem[] = [
    {
      label: 'Cross-probe Selected Items',
      checked: options.crossprobe,
      action: () => onOptionsChange({ ...options, crossprobe: !options.crossprobe }),
    },
    {
      label: 'Center on Cross-probe',
      checked: options.scrollOnCrossprobe,
      action: () =>
        onOptionsChange({ ...options, scrollOnCrossprobe: !options.scrollOnCrossprobe }),
    },
    {
      label: 'Show all errors',
      checked: options.showAllErrors,
      action: () => onOptionsChange({ ...options, showAllErrors: !options.showAllErrors }),
    },
  ];
  const [configOpen, setConfigOpen] = useState<{ x: number; y: number } | null>(null);
  // The Save File dialog's wildcard: a text report or the JSON schema.
  const [saveMenu, setSaveMenu] = useState<{ x: number; y: number } | null>(null);

  return (
    <div className="ze-erc-panel" ref={panelRef}>
      <div className="ze-modal-header ze-drag-handle" onPointerDown={dragStart}>
        Electrical Rules Checker
        <span className="x" onClick={onClose}>
          ✕
        </span>
      </div>

      {unannotated && (
        <div className="ze-infobar">
          Schematic is not fully annotated. ERC results will be incomplete.
          {onShowAnnotate && (
            <a onClick={onShowAnnotate} className="lnk">
              Show Annotation dialog
            </a>
          )}
        </div>
      )}

      {/* gbSizerOptions: the config menu button sits above the notebook. */}
      <div className="ze-erc-options">
        <button
          type="button"
          className="ze-erc-menu-btn"
          title="Options"
          onClick={(e) => {
            const r = (e.target as HTMLElement).getBoundingClientRect();
            setConfigOpen({ x: r.left, y: r.bottom });
          }}
        >
          {/* m_bMenu->SetBitmap( KiBitmapBundle( BITMAPS::config ) ),
              dialog_erc.cpp:98 — the gear, not options_board. */}
          {bitmapUrl('config') ? <img src={bitmapUrl('config')} alt="" /> : '⚙'}
        </button>
      </div>

      {running ? (
        <div className="ze-erc-tabs">
          <div className="tab active">Tests Running...</div>
        </div>
      ) : (
        <div className="ze-erc-tabs">
          <div
            className={`tab${tab === 'violations' ? ' active' : ''}`}
            onClick={() => setTab('violations')}
          >
            {notRun ? 'Violations' : `Violations (${shown.length})`}
          </div>
          <div
            className={`tab${tab === 'ignored' ? ' active' : ''}`}
            onClick={() => setTab('ignored')}
          >
            {notRun ? 'Ignored Tests' : `Ignored Tests (${ignoredTests.length})`}
          </div>
        </div>
      )}

      {running ? (
        /* The running page: the phase messages so far over the gauge. */
        <div className="ze-erc-list" data-testid="erc-running">
          {running.map((line) => (
            <div key={line} className="ze-erc-progress-line">
              {line}
            </div>
          ))}
          <div className="ze-erc-gauge">
            <div
              className="bar"
              style={{ width: `${Math.round((running.length / ERC_PHASE_COUNT) * 100)}%` }}
            />
          </div>
        </div>
      ) : tab === 'violations' ? (
        <div className="ze-erc-list" data-testid="erc-violation-list">
          {shown.map(({ v, i }) => (
            <div key={`${i}:${v.code}`} className="ze-erc-item">
              <div
                // `DIALOG_ERC::SelectMarker` ends in `EnsureVisible`, so a row
                // reached by cross-probing from the canvas is scrolled to
                // rather than merely marked selected somewhere off-screen.
                ref={selected?.index === i ? selectedRowRef : undefined}
                className={`ze-erc-row ${v.severity}${
                  selected?.index === i && selected.item === null ? ' selected' : ''
                }${isExcl(v) ? ' excluded' : ''}`}
                onClick={() => {
                  setSelected({ index: i, item: null });
                  if (options.crossprobe) onLocate(v, options.scrollOnCrossprobe);
                }}
                onDoubleClick={() => onLocate(v, true)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setSelected({ index: i, item: null });
                  setMenu({ x: e.clientX, y: e.clientY, index: i });
                }}
              >
                {/* The shared disclosure chevron, `.twisty` — "declared without
                    an ancestor so every tree-ish expander in the app is the
                    same mark". This drew a raw "⌄" character in a span of its
                    own instead, which is why it read smaller and thinner than
                    KiCad's: a glyph at a font size rather than GTK's expander,
                    whose arms the shared rule measures at 11 x 6. A marker row
                    always has children and is always expanded here. */}
                <span className="twisty expandable open" />
                <span className="msg">
                  {rowPrefix(v)}
                  {v.message}
                </span>
              </div>
              {/* RC_TREE_MODEL::rebuildModel (rc_item.cpp:363-383) gives a
                  marker one child per non-null item id — MAIN_ITEM, AUX_ITEM,
                  AUX_ITEM2, AUX_ITEM3, so four and not three — and appends the
                  COMMENT node AFTER them, not before. */}
              {v.items.slice(0, 4).map((id, k) => (
                <div
                  key={id}
                  className={`ze-erc-subrow${isExcl(v) ? ' excluded' : ''}${
                    selected?.index === i && selected.item === k ? ' selected' : ''
                  }`}
                  onClick={() => {
                    setSelected({ index: i, item: k });
                    if (options.crossprobe) onLocate(v, options.scrollOnCrossprobe, id);
                  }}
                  onDoubleClick={() => onLocate(v, true, id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setSelected({ index: i, item: k });
                    setMenu({ x: e.clientX, y: e.clientY, index: i });
                  }}
                >
                  {describeItem?.(id, v.file) ?? id}
                </div>
              ))}
              {/* RC_TREE_NODE::COMMENT: an excluded marker's comment, when it
                  has one, last of the marker's children. */}
              {isExcl(v) && exclusionComments?.get(ercExclusionKey(v)) && (
                <div className="ze-erc-subrow excluded">
                  {exclusionComments.get(ercExclusionKey(v))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="ze-erc-list">
          {ignoredTests.map((t) => (
            <div key={t} className="ze-erc-row">
              <span className="msg"> • {t}</span>
            </div>
          ))}
          {onEditSeverities && (
            <a className="ze-erc-link" onClick={onEditSeverities}>
              Edit ignored tests
            </a>
          )}
        </div>
      )}

      <div className="ze-erc-footer">
        <span className="show-label">Show:</span>
        <label className="chk">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) =>
              // DIALOG_ERC::OnSeverity (dialog_erc.cpp:1118-1129): the All box
              // turns Errors on whichever way it is moved, and hands only
              // Warnings and Exclusions its own new state.
              {
                setShowAll(e.target.checked);
                setFilters({
                  errors: true,
                  warnings: e.target.checked,
                  exclusions: e.target.checked,
                });
              }
            }
          />
          All
        </label>
        <span className="gap-35" />
        <label className="chk">
          <input
            type="checkbox"
            checked={filters.errors}
            onChange={(e) => setFilters({ ...filters, errors: e.target.checked })}
          />
          Errors
        </label>
        {errorsBadge && <span className={`badge ${errorsBadge.kind}`}>{errorsBadge.text}</span>}
        <span className="gap-25" />
        <label className="chk">
          <input
            type="checkbox"
            checked={filters.warnings}
            onChange={(e) => setFilters({ ...filters, warnings: e.target.checked })}
          />
          Warnings
        </label>
        {warningsBadge && (
          <span className={`badge ${warningsBadge.kind}`}>{warningsBadge.text}</span>
        )}
        <span className="gap-25" />
        <label className="chk">
          <input
            type="checkbox"
            checked={filters.exclusions}
            onChange={(e) => setFilters({ ...filters, exclusions: e.target.checked })}
          />
          Exclusions
        </label>
        {exclusionsBadge && (
          <span className={`badge ${exclusionsBadge.kind}`}>{exclusionsBadge.text}</span>
        )}
        <span className="grow" />
        <button
          className="ze-btn"
          disabled={!!running}
          onClick={(e) => {
            const r = (e.target as HTMLElement).getBoundingClientRect();
            setSaveMenu({ x: r.left, y: r.top });
          }}
        >
          Save...
        </button>
      </div>

      {/* Both delete buttons are live except while a run is in flight, which is
          the only place DIALOG_ERC disables them (dialog_erc.cpp:523-525 and
          565-568). Neither is gated on a selection or on the list being
          non-empty: RC_TREE_MODEL::DeleteItems answers Delete Marker with no
          current item by ringing the bell and returning (rc_item.cpp:664-668). */}
      <div className="ze-erc-buttons">
        <button
          className="ze-btn"
          disabled={!!running}
          onClick={() => {
            if (selected) {
              onDelete(selected.index);
              setSelected(null);
            }
          }}
        >
          Delete Marker
        </button>
        <button className="ze-btn" disabled={!!running} onClick={onDeleteAll}>
          Delete All Markers
        </button>
        <span className="grow" />
        <button
          className="ze-btn"
          onClick={() => (running && onCancelRun ? onCancelRun() : onClose())}
        >
          {running ? 'Cancel' : 'Close'}
        </button>
        <button className="ze-btn primary" disabled={!!running} onClick={onRun}>
          Run ERC
        </button>
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={rowMenu(menu.index)}
          onClose={() => setMenu(null)}
        />
      )}
      {saveMenu && (
        <ContextMenu
          x={saveMenu.x}
          y={saveMenu.y}
          items={[
            { label: 'Report file (*.rpt)', action: saveReport },
            { label: 'JSON report (*.json)', action: () => download('erc.json', jsonReport()) },
          ]}
          onClose={() => setSaveMenu(null)}
        />
      )}
      {configOpen && (
        <ContextMenu
          x={configOpen.x}
          y={configOpen.y}
          items={configMenu}
          onClose={() => setConfigOpen(null)}
        />
      )}
    </div>
  );
}
