// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Symbol Fields Table. Counterpart: `eeschema/dialogs/
 * dialog_symbol_fields_table.cpp` (DIALOG_SYMBOL_FIELDS_TABLE), one dialog
 * with two views over the same model, exactly as upstream:
 *
 *   - **Edit** (Tools > Edit Symbol Fields): every symbol of the hierarchy in a
 *     grid, grouped by the fields ticked "Group By", with the cells editable in
 *     place. OK applies the changed cells as one undoable commit per sheet.
 *   - **Export** (Tools > Generate Bill of Materials): the same rows serialized
 *     with the format preset's delimiters, previewed and written to the output
 *     file.
 *
 * The left sidebar is the view control: which fields are columns ("Include"),
 * which ones group rows ("Group By"), what each column is called in the BOM
 * ("BOM Name"), plus the saved view presets. It collapses with the button at
 * the bottom-left, like upstream's sidebar toggle.
 *
 * Not built: the "Schematic variants" pane of the left splitter, schematic
 * variants are a v10 engine feature (per-instance field/attribute overrides)
 * that ZiroEDA's document model does not carry yet.
 */

import { useCallback, useRef, useState, type JSX } from 'react';
import {
  buildFieldsReferences,
  FieldsDataModel,
  generatedFieldDisplayName,
  INDETERMINATE_STATE,
  isGeneratedField,
  loadFieldNames,
  type BomPresetSpec,
  type FieldsRef,
  type FieldsScope,
  type FieldsTableEdits,
  type Schematic,
} from '@ziroeda/eeschema';
import { Icon } from '../../../ui/icons.js';
import {
  bomBuiltInPresets,
  bomFmtBuiltInPresets,
  type BomFmtPreset,
  type BomPreset,
  type BomPresets,
} from '../schematic_settings.js';

/** Changed cells, grouped by sheet file then symbol refId. */
export type FieldsEdits = FieldsTableEdits['fields'];

/** Cross-probe modes (PANEL_SYMBOL_FIELDS_TABLE::selection_mode). */
export type CrossProbeMode = 'highlight' | 'select' | 'none';

interface Props {
  /** Every sheet document of the project, keyed by file name. */
  docs: ReadonlyMap<string, Schematic>;
  /** Root sheet, so symbols collect in hierarchy order with real sheet paths. */
  rootFile?: string;
  /** The sheet path the editor is on, for the "Current Sheet" scopes. */
  currentPath?: string;
  /** Schematic Setup > Field Name Templates: offered as columns even when no
   *  symbol carries the field yet (LoadFieldNames). */
  fieldTemplates?: readonly { name: string }[];
  /** Saved BOM presets plus the last-used view/format and output file. */
  presets: BomPresets;
  /** Persist a changed preset list / current view (schematic.bom_*). */
  onSavePresets: (next: BomPresets) => void;
  /** Default output file when none is set: `<schematic>.csv`. */
  defaultBomFileName: string;
  /** Which notebook page opens: Edit Symbol Fields vs Generate BOM. */
  initialTab?: 'edit' | 'export';
  /** Apply the pending cell edits; `persist` also saves the sheets. */
  onApply: (edits: FieldsTableEdits, opts: { persist?: boolean }) => void;
  /** Write the BOM output into the project (the Export button). */
  onExportFile?: (name: string, text: string) => void;
  /** Cross-probe the selected row's symbols onto the canvas. */
  onCrossProbe?: (refs: readonly FieldsRef[], mode: CrossProbeMode) => void;
  onClose: () => void;
}

const SEPARATOR = '---';
const SAVE_PRESET = 'Save preset...';
const DELETE_PRESET = 'Delete preset...';

const SCOPES: readonly { id: FieldsScope; label: string }[] = [
  { id: 'all', label: 'Entire Project' },
  { id: 'sheet', label: 'Current Sheet Only' },
  { id: 'sheet-recursive', label: 'Current Sheet and Down' },
];

/** The 5 mandatory fields lead the list and can be neither renamed nor removed. */
const MANDATORY_COUNT = 5;

/** SetSize( horizPixelsFromDU( 600 ), … ), the dialog's design width, which
 *  also caps a table column at a third of it (SetupAllColumnProperties). */
const DIALOG_WIDTH = 1050;
/** field_editor.sash_pos, where the main splitter sits (eeschema_settings.cpp). */
const DEFAULT_SASH_POS = 400;

/** BOM_PRESET → the engine's preset shape (same fields, different home). */
const toSpec = (p: BomPreset): BomPresetSpec => ({
  name: p.name,
  readOnly: p.readOnly ?? false,
  fieldsOrdered: p.fieldsOrdered.map((f) => ({ ...f })),
  sortField: p.sortField,
  sortAsc: p.sortAsc,
  filterString: p.filterString,
  groupSymbols: p.groupSymbols,
  excludeDnp: p.excludeDnp,
  includeExcludedFromBom: p.includeExcludedFromBom,
});

const fromSpec = (p: BomPresetSpec, name: string): BomPreset => ({
  name,
  readOnly: false,
  fieldsOrdered: p.fieldsOrdered.map((f) => ({ ...f })),
  sortField: p.sortField,
  sortAsc: p.sortAsc,
  filterString: p.filterString,
  groupSymbols: p.groupSymbols,
  excludeDnp: p.excludeDnp,
  includeExcludedFromBom: p.includeExcludedFromBom,
});

/** syncBomPresetSelection, a preset matches when its simple settings and its
 *  shown/grouped fields are identical to the model's current state. */
function presetMatches(preset: BomPreset, current: BomPresetSpec): boolean {
  if (
    preset.sortAsc !== current.sortAsc ||
    preset.filterString !== current.filterString ||
    preset.groupSymbols !== current.groupSymbols ||
    preset.excludeDnp !== current.excludeDnp ||
    preset.includeExcludedFromBom !== current.includeExcludedFromBom ||
    preset.sortField !== current.sortField
  ) {
    return false;
  }
  const a = preset.fieldsOrdered.filter((f) => f.show || f.groupBy);
  const b = current.fieldsOrdered.filter((f) => f.show || f.groupBy);
  if (a.length !== b.length) return false;
  return a.every(
    (f, i) =>
      f.name === b[i]!.name &&
      f.label === b[i]!.label &&
      f.show === b[i]!.show &&
      f.groupBy === b[i]!.groupBy,
  );
}

/** PreviewRefresh, symbols marked "exclude from BOM" are never exported, even
 *  when the table is showing them. */
function exportPreview(model: FieldsDataModel, format: BomFmtPreset): string {
  const saved = model.getIncludeExcludedFromBOM();
  model.setIncludeExcludedFromBOM(false);
  model.rebuildRows();
  const text = model.export(format);
  if (saved) {
    model.setIncludeExcludedFromBOM(true);
    model.rebuildRows();
  }
  return text;
}

interface TableState {
  model: FieldsDataModel;
  /** Field names in the sidebar's order (VIEW_CONTROLS_GRID_DATA_MODEL rows). */
  order: string[];
}

export function DialogSymbolFieldsTable({
  docs,
  rootFile,
  currentPath = '/',
  fieldTemplates,
  presets,
  onSavePresets,
  defaultBomFileName,
  initialTab = 'edit',
  onApply,
  onExportFile,
  onCrossProbe,
  onClose,
}: Props): JSX.Element {
  // The symbol list is snapshotted when the dialog opens, like the C++ dialog's
  // constructor (which then listens for schematic changes).
  const stateRef = useRef<TableState | null>(null);
  if (!stateRef.current) {
    const refs = buildFieldsReferences(docs, rootFile);
    const model = new FieldsDataModel(refs);
    const order = loadFieldNames(model, refs, fieldTemplates);
    model.setPath(currentPath);
    model.applyBomPreset(toSpec(presets.settings));
    // A preset may add columns (the ${DNP} / ${EXCLUDE_FROM_…} attributes);
    // they join the field list, as in doApplyBomPreset.
    for (const col of model.getColumns()) {
      if (!order.includes(col.fieldName)) order.push(col.fieldName);
    }
    stateRef.current = { model, order };
  }
  const { model, order } = stateRef.current;

  const [, setVersion] = useState(0);
  const redraw = useCallback(() => setVersion((v) => v + 1), []);

  const [tab, setTab] = useState<'edit' | 'export'>(initialTab);
  const [filter, setFilter] = useState(model.getFilter());
  const [scope, setScope] = useState<FieldsScope>('all');
  const [groupSymbols, setGroupSymbols] = useState(model.getGroupingEnabled());
  const [selField, setSelField] = useState(0);
  const [selRow, setSelRow] = useState<number | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sashPos, setSashPos] = useState(DEFAULT_SASH_POS);
  const [menuOpen, setMenuOpen] = useState(false);
  const [crossProbe, setCrossProbe] = useState<CrossProbeMode>('highlight');

  const [presetName, setPresetName] = useState(presets.settings.name || SEPARATOR);
  const [userPresets, setUserPresets] = useState<BomPreset[]>(presets.presets);
  const [userFmtPresets, setUserFmtPresets] = useState<BomFmtPreset[]>(presets.fmtPresets);
  const [fmt, setFmt] = useState<BomFmtPreset>({ ...presets.fmtSettings });
  const [fmtName, setFmtName] = useState(presets.fmtSettings.name || SEPARATOR);
  const [outputFileName, setOutputFileName] = useState(presets.exportFileName);
  // Opening straight onto the Export page shows its preview at once, the way
  // ShowExportTab lands on a page whose OnPageChanged has already refreshed it.
  const [preview, setPreview] = useState(() =>
    initialTab === 'export' ? exportPreview(model, presets.fmtSettings) : '',
  );
  const [status, setStatus] = useState('');

  const allPresets = [...bomBuiltInPresets(), ...userPresets];
  const allFmtPresets = [...bomFmtBuiltInPresets(), ...userFmtPresets];

  // --- preset selection -----------------------------------------------------

  const syncPresetSelection = useCallback((): void => {
    const current = model.getBomSettings();
    const match = allPresets.find((p) => presetMatches(p, current));
    setPresetName(match ? match.name : SEPARATOR);
  }, [model, allPresets]);

  const syncFmtPresetSelection = useCallback(
    (next: BomFmtPreset): void => {
      const match = allFmtPresets.find(
        (p) =>
          p.fieldDelimiter === next.fieldDelimiter &&
          p.stringDelimiter === next.stringDelimiter &&
          p.refDelimiter === next.refDelimiter &&
          p.refRangeDelimiter === next.refRangeDelimiter &&
          p.keepTabs === next.keepTabs &&
          p.keepLineBreaks === next.keepLineBreaks,
      );
      setFmtName(match ? match.name : SEPARATOR);
    },
    [allFmtPresets],
  );

  const refreshPreview = useCallback(
    (format = fmt): void => setPreview(exportPreview(model, format)),
    [model, fmt],
  );

  /** Every model mutation ends here: re-sync the preset combo and redraw the
   *  page that is showing (upstream refreshes the grid or the preview). */
  const afterChange = useCallback((): void => {
    syncPresetSelection();
    if (tab === 'export') refreshPreview();
    redraw();
  }, [syncPresetSelection, tab, refreshPreview, redraw]);

  const showTab = (next: 'edit' | 'export'): void => {
    setTab(next);
    if (next === 'export') refreshPreview();
  };

  // --- field list (the sidebar's view-controls grid) ------------------------

  const colOf = (fieldName: string): number => model.getFieldNameCol(fieldName);

  const setShow = (fieldName: string, show: boolean): void => {
    const col = colOf(fieldName);
    if (col === -1) return;
    model.setShowColumn(col, show);
    afterChange();
  };

  const setGroupBy = (fieldName: string, group: boolean): void => {
    const col = colOf(fieldName);
    if (col === -1) return;
    if (group && model.colIsQuantity(col)) {
      window.alert('The Quantity column cannot be grouped by.');
      return;
    }
    if (group && model.colIsItemNumber(col)) {
      window.alert('The Item Number column cannot be grouped by.');
      return;
    }
    model.setGroupColumn(col, group);
    model.rebuildRows();
    afterChange();
  };

  const setLabel = (fieldName: string, label: string): void => {
    const col = colOf(fieldName);
    if (col === -1) return;
    model.setColLabelValue(col, label);
    afterChange();
  };

  const addField = (): void => {
    const fieldName = window.prompt('New field name:')?.trim();
    if (fieldName === undefined) return;
    if (fieldName === '') {
      window.alert('Field must have a name.');
      return;
    }
    if (colOf(fieldName) !== -1) {
      window.alert(`Field name '${fieldName}' already in use.`);
      return;
    }
    model.addColumn(fieldName, generatedFieldDisplayName(fieldName), true);
    model.setShowColumn(model.getColsCount() - 1, true);
    order.push(fieldName);
    setSelField(order.length - 1);
    model.rebuildRows();
    afterChange();
  };

  const renameField = (): void => {
    const fieldName = order[selField];
    if (fieldName === undefined) return;
    if (selField < MANDATORY_COUNT) {
      window.alert(
        `The first ${MANDATORY_COUNT} fields are mandatory and names cannot be changed.`,
      );
      return;
    }
    const col = colOf(fieldName);
    if (col === -1) return;
    const label = model.getColLabelValue(col);
    const labelIsAutogenerated = label === generatedFieldDisplayName(fieldName);
    const newName = window.prompt('New field name:', fieldName)?.trim();
    if (newName === undefined || newName === '' || newName === fieldName) return;
    if (colOf(newName) !== -1) {
      window.alert(`Field name ${newName} already exists.`);
      return;
    }
    model.renameColumn(col, newName);
    if (labelIsAutogenerated) model.setColLabelValue(col, generatedFieldDisplayName(newName));
    order[selField] = newName;
    model.rebuildRows();
    afterChange();
  };

  const removeField = (): void => {
    const fieldName = order[selField];
    if (fieldName === undefined) return;
    if (selField < MANDATORY_COUNT) {
      window.alert(`The first ${MANDATORY_COUNT} fields are mandatory.`);
      return;
    }
    if (!window.confirm(`Are you sure you want to remove the field '${fieldName}'?`)) return;
    const col = colOf(fieldName);
    if (col !== -1) model.removeColumn(col);
    order.splice(selField, 1);
    setSelField(Math.min(selField, order.length - 1));
    model.rebuildRows();
    afterChange();
  };

  // --- presets --------------------------------------------------------------

  const applyPreset = (preset: BomPreset): void => {
    model.disableRebuilds();
    model.applyBomPreset(toSpec(preset));
    for (const c of model.getColumns()) {
      if (!order.includes(c.fieldName)) order.push(c.fieldName);
    }
    model.enableRebuilds();
    model.rebuildRows();
    setGroupSymbols(model.getGroupingEnabled());
    setFilter(model.getFilter());
    setPresetName(preset.name);
    if (tab === 'export') refreshPreview();
    redraw();
  };

  const onPresetChoice = (value: string): void => {
    if (value === SEPARATOR) return;
    if (value === SAVE_PRESET) {
      const name = window.prompt('BOM preset name:')?.trim();
      if (!name) return;
      if (bomBuiltInPresets().some((p) => p.name === name)) {
        window.alert('Default presets cannot be modified.\nPlease use a different name.');
        return;
      }
      const exists = userPresets.some((p) => p.name === name);
      if (exists && !window.confirm('Overwrite existing preset?')) return;
      const saved = fromSpec(model.getBomSettings(), name);
      const next = [...userPresets.filter((p) => p.name !== name), saved];
      setUserPresets(next);
      setPresetName(name);
      onSavePresets({ ...presets, presets: next, settings: saved });
      return;
    }
    if (value === DELETE_PRESET) {
      if (userPresets.length === 0) {
        window.alert('No user presets to delete.');
        return;
      }
      const name = window
        .prompt(
          `Select preset:\n${userPresets.map((p) => p.name).join('\n')}`,
          userPresets[0]!.name,
        )
        ?.trim();
      if (!name) return;
      const next = userPresets.filter((p) => p.name !== name);
      setUserPresets(next);
      onSavePresets({ ...presets, presets: next });
      syncPresetSelection();
      return;
    }
    const preset = allPresets.find((p) => p.name === value);
    if (preset) applyPreset(preset);
  };

  const editFmt = (patch: Partial<BomFmtPreset>): void => {
    const next = { ...fmt, ...patch, readOnly: false };
    setFmt(next);
    syncFmtPresetSelection(next);
    refreshPreview(next);
  };

  const onFmtChoice = (value: string): void => {
    if (value === SEPARATOR) return;
    if (value === SAVE_PRESET) {
      const name = window.prompt('BOM format preset name:')?.trim();
      if (!name) return;
      if (bomFmtBuiltInPresets().some((p) => p.name === name)) {
        window.alert('Default presets cannot be modified.\nPlease use a different name.');
        return;
      }
      if (
        userFmtPresets.some((p) => p.name === name) &&
        !window.confirm('Overwrite existing preset?')
      )
        return;
      const saved: BomFmtPreset = { ...fmt, name, readOnly: false };
      const next = [...userFmtPresets.filter((p) => p.name !== name), saved];
      setUserFmtPresets(next);
      setFmtName(name);
      onSavePresets({ ...presets, fmtPresets: next, fmtSettings: saved });
      return;
    }
    if (value === DELETE_PRESET) {
      if (userFmtPresets.length === 0) {
        window.alert('No user presets to delete.');
        return;
      }
      const name = window
        .prompt(
          `Select preset:\n${userFmtPresets.map((p) => p.name).join('\n')}`,
          userFmtPresets[0]!.name,
        )
        ?.trim();
      if (!name) return;
      const next = userFmtPresets.filter((p) => p.name !== name);
      setUserFmtPresets(next);
      onSavePresets({ ...presets, fmtPresets: next });
      return;
    }
    const preset = allFmtPresets.find((p) => p.name === value);
    if (!preset) return;
    const next = { ...preset };
    setFmt(next);
    setFmtName(preset.name);
    refreshPreview(next);
  };

  // --- table interaction ----------------------------------------------------

  const onFilterText = (value: string): void => {
    setFilter(value);
    model.setFilter(value);
    model.rebuildRows();
    afterChange();
  };

  const onScope = (next: FieldsScope): void => {
    setScope(next);
    model.setPath(currentPath);
    model.setScope(next);
    model.rebuildRows();
    afterChange();
  };

  const onGroupSymbols = (next: boolean): void => {
    setGroupSymbols(next);
    model.setGroupingEnabled(next);
    model.rebuildRows();
    afterChange();
  };

  const onColSort = (col: number): void => {
    // The item number is generated by the sort, so it can't sort.
    if (model.colIsItemNumber(col)) return;
    const ascending = model.getSortCol() === col ? !model.getSortAsc() : true;
    model.setSorting(col, ascending);
    model.rebuildRows();
    afterChange();
  };

  const onRowClick = (row: number): void => {
    setSelRow(row);
    const refs = model.getRows()[row]?.refs ?? [];
    if (crossProbe !== 'none') onCrossProbe?.(refs, crossProbe);
  };

  // --- buttons --------------------------------------------------------------

  const currentSettings = (): BomPresets => ({
    ...presets,
    presets: userPresets,
    fmtPresets: userFmtPresets,
    settings: fromSpec(model.getBomSettings(), presetName === SEPARATOR ? '' : presetName),
    fmtSettings: { ...fmt, name: fmtName === SEPARATOR ? '' : fmtName },
    exportFileName: outputFileName,
  });

  const transferDataFromWindow = (opts: { persist?: boolean }): void => {
    onApply(model.applyData(), opts);
    onSavePresets(currentSettings());
  };

  const onSaveAndContinue = (): void => {
    transferDataFromWindow({ persist: true });
    setStatus('Schematic saved.');
    redraw();
  };

  const onOk = (): void => {
    transferDataFromWindow({});
    onClose();
  };

  const onCancel = (): void => {
    if (model.isEdited() && !window.confirm('Symbol fields have been modified. Discard changes?')) {
      return;
    }
    onClose();
  };

  const onExport = (): void => {
    if (
      model.isEdited() &&
      !window.confirm('Changes have not yet been saved. Export unsaved data?')
    ) {
      return;
    }
    let path = outputFileName.trim();
    if (path === '') {
      path = defaultBomFileName;
      if (path === '') {
        window.alert('No output file specified in Export tab.');
        return;
      }
      setOutputFileName(path);
    }
    const saved = model.getIncludeExcludedFromBOM();
    model.setIncludeExcludedFromBOM(false);
    model.rebuildRows();
    const text = model.export(fmt);
    if (saved) {
      model.setIncludeExcludedFromBOM(true);
      model.rebuildRows();
    }
    setPreview(text);
    onExportFile?.(path, text);
    onSavePresets({ ...currentSettings(), exportFileName: path });
    setStatus(`Wrote BOM output to '${path}'`);
  };

  // --- rendering ------------------------------------------------------------
  //
  // Geometry follows dialog_symbol_fields_table_base.cpp: a 600 x 300 DU dialog
  // split vertically at field_editor.sash_pos (400 px, minimum pane 120), the
  // view-controls grid 250 px tall with 24 px column labels, the filter 240 px
  // wide, the table grid at least 400 x 200, and 60 px delimiter fields.

  const columns = model.getColumns();
  const shownCols: number[] = [];
  columns.forEach((c, i) => {
    if (c.show) shownCols.push(i);
  });
  const rows = model.getRows();
  const expanderCol = shownCols[0] ?? -1;

  // SetupAllColumnProperties: a column is as wide as its data, clamped between
  // 100 px and a third of the dialog (COLUMN_MARGIN = 15).
  const colWidth = (col: number): number =>
    Math.min(Math.max(model.getDataWidth(col) * 7 + 15, 100), Math.round(DIALOG_WIDTH / 3));

  const renderCell = (row: number, col: number): JSX.Element => {
    const value = model.getValue(row, col);
    const isExpander = col === expanderCol;
    const group = rows[row]!;
    const indent = group.flag === 'child' ? 16 : 0;

    if (model.colIsAttribute(col)) {
      const mixed = value === INDETERMINATE_STATE;
      return (
        <div className="ze-sft-cell center">
          <input
            type="checkbox"
            checked={value === '1'}
            ref={(el) => {
              if (el) el.indeterminate = mixed;
            }}
            onChange={(e) => {
              model.setValue(row, col, e.target.checked ? '1' : '0');
              afterChange();
            }}
          />
        </div>
      );
    }

    const readOnly =
      model.colIsReference(col) ||
      model.colIsQuantity(col) ||
      model.colIsItemNumber(col) ||
      (isGeneratedField(columns[col]!.fieldName) && !model.colIsAttribute(col));

    // The expander column carries the group triangle; child rows indent under it.
    const twisty = isExpander ? (
      <span
        className={`ze-sft-twisty${group.flag === 'collapsed' || group.flag === 'expanded' ? ' on' : ''}`}
        title={group.flag === 'collapsed' ? 'Expand group' : 'Collapse group'}
        onClick={(e) => {
          e.stopPropagation();
          model.expandCollapseRow(row);
          redraw();
        }}
      >
        {group.flag === 'collapsed' ? '▶' : group.flag === 'expanded' ? '▼' : ''}
      </span>
    ) : null;

    if (readOnly) {
      const right = model.colIsQuantity(col) || model.colIsItemNumber(col);
      return (
        <div className={`ze-sft-cell${right ? ' right' : ''}`} style={{ paddingLeft: 6 + indent }}>
          {twisty}
          <span className="ze-sft-text">{value}</span>
        </div>
      );
    }
    return (
      <div className="ze-sft-cell" style={{ paddingLeft: indent }}>
        {twisty}
        <input
          type="text"
          className="ze-grid-input"
          value={value}
          onChange={(e) => {
            model.setValue(row, col, e.target.value);
            redraw();
          }}
        />
      </div>
    );
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-fields-table" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Symbol Fields Table
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>

        <div className="ze-sft-body">
          {/* Left panel: the view-controls grid, its buttons, and the presets. */}
          {!sidebarCollapsed && (
            <>
              <div className="ze-sft-left" style={{ width: sashPos }}>
                <div className="ze-grid-pane ze-sft-fields-pane">
                  <table className="ze-grid ze-sft-fields">
                    <colgroup>
                      <col />
                      <col />
                      {/* OnSizeViewControlsGrid: the two flag columns are as
                          wide as their labels + COLUMN_MARGIN, the rest splits. */}
                      <col style={{ width: 66 }} />
                      <col style={{ width: 74 }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Field</th>
                        <th>BOM Name</th>
                        <th>Include</th>
                        <th>Group By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.map((fieldName, i) => {
                        const col = colOf(fieldName);
                        if (col === -1) return null;
                        return (
                          <tr
                            key={fieldName}
                            className={i === selField ? 'selected' : undefined}
                            onMouseDown={() => setSelField(i)}
                          >
                            <td className="ze-sft-name">{fieldName}</td>
                            <td>
                              <input
                                type="text"
                                value={model.getColLabelValue(col)}
                                onChange={(e) => setLabel(fieldName, e.target.value)}
                              />
                            </td>
                            <td className="center">
                              <input
                                type="checkbox"
                                checked={model.getShowColumn(col)}
                                onChange={(e) => setShow(fieldName, e.target.checked)}
                              />
                            </td>
                            <td className="center">
                              <input
                                type="checkbox"
                                checked={model.getGroupColumn(col)}
                                onChange={(e) => setGroupBy(fieldName, e.target.checked)}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="ze-grid-btns">
                  <button className="ze-gridbtn" title="Add a new field" onClick={addField}>
                    <Icon name="plus" />
                  </button>
                  <button
                    className="ze-gridbtn"
                    title="Rename selected field"
                    onClick={renameField}
                  >
                    <Icon name="annotate" />
                  </button>
                  <span style={{ width: 15 }} />
                  <button
                    className="ze-gridbtn"
                    title="Remove selected field"
                    onClick={removeField}
                  >
                    <Icon name="delete" />
                  </button>
                </div>
                <div className="ze-sft-presets">
                  <hr />
                  <label>View presets:</label>
                  <select value={presetName} onChange={(e) => onPresetChoice(e.target.value)}>
                    {presetName === SEPARATOR && <option value={SEPARATOR}>{SEPARATOR}</option>}
                    {allPresets.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name}
                      </option>
                    ))}
                    <option value={SEPARATOR}>{SEPARATOR}</option>
                    <option value={SAVE_PRESET}>{SAVE_PRESET}</option>
                    <option value={DELETE_PRESET}>{DELETE_PRESET}</option>
                  </select>
                </div>
              </div>
              {/* The splitter sash (wxSP_LIVE_UPDATE, minimum pane 120). */}
              <div
                className="ze-sft-sash"
                onMouseDown={(e) => {
                  const startX = e.clientX;
                  const startW = sashPos;
                  const move = (ev: MouseEvent): void =>
                    setSashPos(Math.max(120, startW + ev.clientX - startX));
                  const up = (): void => {
                    window.removeEventListener('mousemove', move);
                    window.removeEventListener('mouseup', up);
                  };
                  window.addEventListener('mousemove', move);
                  window.addEventListener('mouseup', up);
                }}
              />
            </>
          )}

          {/* Right panel: the Edit / Export notebook over the dialog buttons. */}
          <div className="ze-sft-right">
            <div className="ze-sft-tabs">
              <div
                className={`ze-sft-tab${tab === 'edit' ? ' active' : ''}`}
                onClick={() => showTab('edit')}
              >
                Edit
              </div>
              <div
                className={`ze-sft-tab${tab === 'export' ? ' active' : ''}`}
                onClick={() => showTab('export')}
              >
                Export
              </div>
            </div>

            {tab === 'edit' ? (
              <div className="ze-sft-page">
                {/* Filter | scope | grouping | regroup | options (bControls). */}
                <div className="ze-sft-controls">
                  <input
                    className="ze-search ze-sft-filter"
                    placeholder="Filter"
                    value={filter}
                    onChange={(e) => onFilterText(e.target.value)}
                  />
                  <span className="ze-sft-vsep" />
                  <select
                    className="ze-select ze-sft-scope"
                    value={scope}
                    onChange={(e) => onScope(e.target.value as FieldsScope)}
                  >
                    {SCOPES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <span className="ze-sft-vsep" />
                  <label
                    className="ze-sft-check"
                    title="Group symbols together based on common properties"
                  >
                    <input
                      type="checkbox"
                      checked={groupSymbols}
                      onChange={(e) => onGroupSymbols(e.target.checked)}
                    />
                    Group symbols
                  </label>
                  <span className="ze-sft-vsep" />
                  <button
                    className="ze-gridbtn"
                    title="Regroup symbols"
                    onClick={() => {
                      model.rebuildRows();
                      redraw();
                    }}
                  >
                    <Icon name="zoomRedraw" />
                  </button>
                  <button
                    className="ze-gridbtn"
                    title="Options"
                    onClick={() => setMenuOpen((o) => !o)}
                  >
                    <Icon name="setup" />
                  </button>
                  {menuOpen && (
                    <div className="ze-sft-menu" onMouseLeave={() => setMenuOpen(false)}>
                      <div
                        onClick={() => {
                          model.setExcludeDNP(!model.getExcludeDNP());
                          model.rebuildRows();
                          afterChange();
                        }}
                      >
                        <span className="tick">{model.getExcludeDNP() ? '' : '✓'}</span>
                        Include &lsquo;DNP&rsquo; Symbols
                      </div>
                      <div
                        onClick={() => {
                          model.setIncludeExcludedFromBOM(!model.getIncludeExcludedFromBOM());
                          model.rebuildRows();
                          afterChange();
                        }}
                      >
                        <span className="tick">{model.getIncludeExcludedFromBOM() ? '✓' : ''}</span>
                        Include &lsquo;Exclude from BOM&rsquo; Symbols
                      </div>
                      <hr />
                      {(
                        [
                          ['highlight', 'Highlight on Cross-probe'],
                          ['select', 'Select on Cross-probe'],
                        ] as const
                      ).map(([mode, label]) => (
                        <div
                          key={mode}
                          onClick={() => setCrossProbe(crossProbe === mode ? 'none' : mode)}
                        >
                          <span className="tick">{crossProbe === mode ? '✓' : ''}</span>
                          {label}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* The fields table itself. */}
                <div className="ze-grid-pane ze-sft-table-pane">
                  <table className="ze-grid ze-sft-table">
                    <colgroup>
                      {shownCols.map((col) => (
                        <col key={columns[col]!.fieldName} style={{ width: colWidth(col) }} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr>
                        {shownCols.map((col) => (
                          <th
                            key={columns[col]!.fieldName}
                            title="Sort by this column"
                            onClick={() => onColSort(col)}
                          >
                            {model.getColLabelValue(col)}
                            {model.getSortCol() === col ? (model.getSortAsc() ? ' ▲' : ' ▼') : ''}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((group, row) => (
                        <tr
                          key={`${group.refs[0]?.file}\0${group.refs[0]?.id}\0${row}`}
                          className={row === selRow ? 'selected' : undefined}
                          onMouseDown={() => onRowClick(row)}
                        >
                          {shownCols.map((col) => (
                            <td key={columns[col]!.fieldName}>{renderCell(row, col)}</td>
                          ))}
                        </tr>
                      ))}
                      {rows.length === 0 && (
                        <tr>
                          <td colSpan={Math.max(1, shownCols.length)} className="ze-sft-empty">
                            No symbols, place and annotate symbols first.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              /* Export page (gbExport): options left, output + preview right. */
              <div className="ze-sft-page ze-sft-export">
                <div className="ze-sft-fmt">
                  <label>Field delimiter:</label>
                  <input
                    className="ze-search"
                    value={fmt.fieldDelimiter === '\t' ? '\\t' : fmt.fieldDelimiter}
                    onChange={(e) =>
                      editFmt({ fieldDelimiter: e.target.value === '\\t' ? '\t' : e.target.value })
                    }
                  />
                  <label>String delimiter:</label>
                  <input
                    className="ze-search"
                    value={fmt.stringDelimiter}
                    onChange={(e) => editFmt({ stringDelimiter: e.target.value })}
                  />
                  <label>Reference delimiter:</label>
                  <input
                    className="ze-search"
                    value={fmt.refDelimiter}
                    onChange={(e) => editFmt({ refDelimiter: e.target.value })}
                  />
                  <label>Range delimiter:</label>
                  <input
                    className="ze-search"
                    title="Leave blank to disable ranges."
                    value={fmt.refRangeDelimiter}
                    onChange={(e) => editFmt({ refRangeDelimiter: e.target.value })}
                  />
                  <label className="span ze-sft-check">
                    <input
                      type="checkbox"
                      checked={fmt.keepTabs}
                      onChange={(e) => editFmt({ keepTabs: e.target.checked })}
                    />
                    Keep tabs
                  </label>
                  <label className="span ze-sft-check">
                    <input
                      type="checkbox"
                      checked={fmt.keepLineBreaks}
                      onChange={(e) => editFmt({ keepLineBreaks: e.target.checked })}
                    />
                    Keep line breaks
                  </label>
                  <hr className="span" />
                  <label className="span">Format presets:</label>
                  <select
                    className="ze-select span"
                    value={fmtName}
                    onChange={(e) => onFmtChoice(e.target.value)}
                  >
                    {fmtName === SEPARATOR && <option value={SEPARATOR}>{SEPARATOR}</option>}
                    {allFmtPresets.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name}
                      </option>
                    ))}
                    <option value={SEPARATOR}>{SEPARATOR}</option>
                    <option value={SAVE_PRESET}>{SAVE_PRESET}</option>
                    <option value={DELETE_PRESET}>{DELETE_PRESET}</option>
                  </select>
                </div>

                <div className="ze-sft-output">
                  <div className="ze-sft-outfile">
                    <label>Output file:</label>
                    <input
                      className="ze-search"
                      value={outputFileName}
                      placeholder={defaultBomFileName}
                      onChange={(e) => setOutputFileName(e.target.value)}
                    />
                    <button
                      className="ze-gridbtn"
                      title="Use the default output file"
                      onClick={() => setOutputFileName(defaultBomFileName)}
                    >
                      <Icon name="folder" />
                    </button>
                  </div>
                  <div className="ze-sft-previewrow">
                    <label>Preview:</label>
                    <span style={{ flex: 1 }} />
                    <button
                      className="ze-gridbtn"
                      title="Refresh preview"
                      onClick={() => refreshPreview()}
                    >
                      <Icon name="zoomRedraw" />
                    </button>
                  </div>
                  <textarea className="ze-sft-preview" readOnly value={preview} />
                </div>
              </div>
            )}

            {/* bButtonsSizer: sidebar toggle, stretch, Export, Apply, Cancel/OK. */}
            <div className="ze-modal-footer ze-sft-footer">
              <button
                className="ze-gridbtn"
                title={sidebarCollapsed ? 'Expand left panel' : 'Collapse left panel'}
                onClick={() => setSidebarCollapsed((c) => !c)}
              >
                <Icon name={sidebarCollapsed ? 'navFwd' : 'navBack'} />
              </button>
              <span className="ze-muted ze-sft-status">{status}</span>
              <span style={{ flex: 1 }} />
              <button className="ze-btn" onClick={onExport}>
                Export
              </button>
              <button className="ze-btn" onClick={onSaveAndContinue}>
                Apply, Save Schematic &amp; Continue
              </button>
              <button className="ze-btn" onClick={onCancel}>
                Cancel
              </button>
              <button className="ze-btn primary" onClick={onOk}>
                OK
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
