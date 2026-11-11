// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_BASE_EDIT_FRAME's window half (`pcbnew/pcb_base_edit_frame.cpp`): the
 * item dialogs its `Show...Dialog` members open, and the vertex editor's
 * floating pane.
 *
 * The window that draws PCB_BASE_EDIT_FRAME's item dialogs — the half of each
 * `Show…Dialog` KiCad's frame does with `dlg.ShowModal()`. One module for
 * every PCB_BASE_EDIT_FRAME window, as the methods are one set on the base
 * class upstream: pad, text, shape, dimension, text box, reference image,
 * table, barcode and the three zone dialogs, each on its live item, plus the
 * "Choose Image" file dialog.
 *
 * {@link usePcbItemDialogs} answers the hooks the frame calls and the React
 * node that draws whichever dialog is up.
 *
 * `PCB_BASE_EDIT_FRAME::OpenVertexEditor`'s floating pane
 * (`pcb_base_edit_frame.cpp:439-462`): `.Float()`, caption "Edit Vertices",
 * `.CloseButton( true )`, `.DestroyOnClose( true )`, `.MinSize( 260, 200 )`,
 * `.BestSize( 260, 320 )`, `.FloatingSize( 320, 360 )`.
 *
 * Closing it destroys the pane (`~PCB_VERTEX_EDITOR_PANE` ->
 * `OnVertexEditorPaneClosed`), so the owner drops its reference in `onClose`.
 */
import {
  type DIALOG_TABLECELL_PROPERTIES,
  DialogTableCellProperties,
} from './dialogs/dialog_tablecell_properties.js';
import { type JSX, type ReactNode, useCallback, useState, useSyncExternalStore } from 'react';
import type { PCB_VERTEX_EDITOR_PANE } from './widgets/vertex_editor_pane.js';
import { PcbVertexEditorPane } from './widgets/vertex_editor_pane.js';

import { DisplayErrorMessage, IsOK } from '@ziroeda/common/confirm.js';
import { LSET } from '@ziroeda/common/lset.js';
import { WX_PT_ENTRY_DIALOG } from '@ziroeda/common/dialogs/dialog_unit_entry.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import type { BOARD } from './board.js';
import {
  barcodePreview,
  type BarcodePreview,
  type BarcodeValues,
  type DIALOG_BARCODE_PROPERTIES,
} from './dialogs/dialog_barcode_properties.js';
import { DialogBarcodeProperties } from './dialogs/dialog_barcode_properties.js';
import { DialogCopperZones } from './dialogs/dialog_copper_zones.js';
import type {
  DIALOG_DIMENSION_PROPERTIES,
  DimensionValues,
} from './dialogs/dialog_dimension_properties.js';
import { DialogDimensionProperties } from './dialogs/dialog_dimension_properties.js';
import { DialogShapeProperties } from './dialogs/dialog_shape_properties.js';
import type { DIALOG_NON_COPPER_ZONES_EDITOR } from './dialogs/dialog_non_copper_zones_properties.js';
import { DialogNonCopperZonesProperties } from './dialogs/dialog_non_copper_zones_properties.js';
import {
  type DIALOG_PAD_PROPERTIES,
  DialogPadProperties,
} from './dialogs/dialog_pad_properties.js';
import {
  type DIALOG_REFERENCE_IMAGE_PROPERTIES,
  DialogReferenceImageProperties,
} from './dialogs/dialog_reference_image_properties.js';
import {
  collectPlacementSources,
  DIALOG_RULE_AREA_PROPERTIES,
} from './dialogs/dialog_rule_area_properties.js';
import { DialogRuleAreaProperties } from './dialogs/dialog_rule_area_properties.js';
import type { DIALOG_SHAPE_PROPERTIES } from './dialogs/dialog_shape_properties.js';
import {
  type DIALOG_TABLE_PROPERTIES,
  DialogTableProperties,
} from './dialogs/dialog_table_properties.js';
import type { DIALOG_TEXT_PROPERTIES, TextValues } from './dialogs/dialog_text_properties.js';
import { DialogTextProperties } from './dialogs/dialog_text_properties.js';
import type {
  DIALOG_TEXTBOX_PROPERTIES,
  TextBoxValues,
} from './dialogs/dialog_textbox_properties.js';
import { DialogTextBoxProperties } from './dialogs/dialog_textbox_properties.js';
import { DIALOG_COPPER_ZONE } from './dialogs/dialog_copper_zones.js';
import type { PCB_BASE_EDIT_FRAME_DIALOG_HOOKS } from './pcb_base_edit_frame.js';
import {
  type DIALOG_PUSH_PAD_PROPERTIES,
  DialogPushPadProperties,
} from './dialogs/dialog_push_pad_properties.js';
import { type DIALOG_ENUM_PADS, DialogEnumPads } from './dialogs/dialog_enum_pads.js';
import {
  type DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS,
  DialogGlobalEditTextAndGraphics,
} from './dialogs/dialog_global_edit_text_and_graphics.js';
import { choiceOf } from './grid_layer_box_helpers.js';
import {
  type DIALOG_FP_EDIT_PAD_TABLE,
  DialogFpEditPadTable,
} from './dialogs/dialog_fp_edit_pad_table.js';
import type { PCB_TABLE } from './pcb_table.js';
import { _ } from '@ziroeda/wx/translation.js';

/** [data] `.FloatingSize( 320, 360 )`, `.MinSize( 260, 200 )` (`pcb_base_edit_frame.cpp:452-454`). */
export const VERTEX_EDITOR_FLOATING_SIZE = { width: 320, height: 360 } as const;
/** [data] `.MinSize( 260, 200 )` (`pcb_base_edit_frame.cpp:452`). */
export const VERTEX_EDITOR_MIN_SIZE = { width: 260, height: 200 } as const;

interface VertexEditorWindowProps {
  pane: PCB_VERTEX_EDITOR_PANE;
  onClose: () => void;
}

export function VertexEditorWindow({ pane, onClose }: VertexEditorWindowProps): JSX.Element {
  const revision = useSyncExternalStore(
    (l) => pane.Subscribe(l),
    () => pane.GetRevision(),
  );
  const [at, setAt] = useState({ x: 80, y: 80 });

  const startDrag = (e: React.MouseEvent): void => {
    e.preventDefault();
    const sx = e.clientX - at.x;
    const sy = e.clientY - at.y;
    const onMove = (ev: MouseEvent): void => setAt({ x: ev.clientX - sx, y: ev.clientY - sy });
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div
      className="ze-panel"
      data-testid="pcb-vertex-editor"
      style={{
        position: 'fixed',
        left: at.x,
        top: at.y,
        width: VERTEX_EDITOR_FLOATING_SIZE.width,
        height: VERTEX_EDITOR_FLOATING_SIZE.height,
        minWidth: VERTEX_EDITOR_MIN_SIZE.width,
        minHeight: VERTEX_EDITOR_MIN_SIZE.height,
        zIndex: 50,
        resize: 'both',
        overflow: 'hidden',
      }}
    >
      <div className="ze-panel-header" onMouseDown={startDrag} style={{ cursor: 'move' }}>
        <span>Edit Vertices</span>
        <button
          type="button"
          className="ze-pane-close"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onClose}
          title={_('Close')}
        >
          ⊠
        </button>
      </div>
      <div className="ze-panel-body">
        <PcbVertexEditorPane pane={pane} revision={revision} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The item dialogs

/**
 * The board's enabled layers by canonical name: the copper stack, then the
 * rest in UI order (`BOARD::GetEnabledLayers()`, walked as
 * APPEARANCE_CONTROLS::rebuildLayers walks it).
 */
export function enabledLayerNames(aBoard: BOARD | null | undefined): string[] {
  const enabled = aBoard?.GetEnabledLayers();
  if (!enabled) return [];
  return [...enabled.CuStack(), ...enabled.TechAndUserUIOrder()].map((l) => LSET.Name(l));
}

/** The board's nets by netcode, for the pad and zone dialogs' net lists. */
export function netNamesByCode(aBoard: BOARD | null | undefined): ReadonlyMap<number, string> {
  return new Map(
    [...(aBoard?.GetNetInfo().NetsByNetcode() ?? new Map())].map(
      ([code, net]) => [code, net.GetNetname()] as const,
    ),
  );
}

/** What the dialogs read off the window. */
export interface PCB_ITEM_DIALOGS_ENV {
  /** The frame's user units. */
  units: StatusUnits;
  /** The frame's board, read when a dialog opens. */
  board: () => BOARD | null;
  /** A layer's colour, by canonical name. */
  layerColor: (aName: string) => string;
  /** The canvas background, behind the barcode preview. */
  background: string;
}

type Resolve = (aOk: boolean) => void;

export function usePcbItemDialogs(aEnv: PCB_ITEM_DIALOGS_ENV): {
  hooks: Required<
    Pick<
      PCB_BASE_EDIT_FRAME_DIALOG_HOOKS,
      | 'showPadPropertiesDialog'
      | 'showTextPropertiesDialog'
      | 'showGraphicItemPropertiesDialog'
      | 'showDimensionPropertiesDialog'
      | 'showTextBoxPropertiesDialog'
      | 'showReferenceImagePropertiesDialog'
      | 'showTablePropertiesDialog'
      | 'showTableCellPropertiesDialog'
      | 'showBarcodePropertiesDialog'
      | 'showZoneSettingsDialog'
      | 'showImageFileDialog'
      | 'showPushPadPropertiesDialog'
      | 'showEnumPadsDialog'
      | 'showPadTableDialog'
      | 'showGlobalEditTextAndGraphicsDialog'
    >
  >;
  /**
   * `WX_PT_ENTRY_DIALOG( frame, title, labelX, labelY, value, showReset ).ShowModal()`: what each
   * editor installs as its frame's point-entry presenter (COMMON_TOOLS::GridOrigin's dialog).
   */
  pointEntry: (
    aTitle: string,
    aLabelX: string,
    aLabelY: string,
    aValue: VECTOR2I,
    aShowResetButton: boolean,
  ) => Promise<VECTOR2I | null>;
  node: ReactNode;
} {
  const { units, board, layerColor, background } = aEnv;
  const [ptEntry, setPtEntry] = useState<{
    title: string;
    labelX: string;
    labelY: string;
    value: VECTOR2I;
    reset: boolean;
    resolve: (aValue: VECTOR2I | null) => void;
  } | null>(null);

  const [pad, setPad] = useState<DIALOG_PAD_PROPERTIES | null>(null);
  const [shape, setShape] = useState<{
    dialog: DIALOG_SHAPE_PROPERTIES;
    onOK?: () => void;
  } | null>(null);
  const [dimension, setDimension] = useState<DIALOG_DIMENSION_PROPERTIES | null>(null);
  const [text, setText] = useState<{ dialog: DIALOG_TEXT_PROPERTIES; resolve: Resolve } | null>(
    null,
  );
  const [textBox, setTextBox] = useState<{
    dialog: DIALOG_TEXTBOX_PROPERTIES;
    resolve: Resolve;
  } | null>(null);
  const [image, setImage] = useState<{
    dialog: DIALOG_REFERENCE_IMAGE_PROPERTIES;
    resolve: Resolve;
  } | null>(null);
  const [table, setTable] = useState<{
    dialog: DIALOG_TABLE_PROPERTIES;
    table: PCB_TABLE;
    resolve: Resolve;
  } | null>(null);
  const [cells, setCells] = useState<{
    dialog: DIALOG_TABLECELL_PROPERTIES;
    resolve: () => void;
  } | null>(null);
  const [barcode, setBarcode] = useState<{
    dialog: DIALOG_BARCODE_PROPERTIES;
    preview: (v: BarcodeValues) => BarcodePreview;
    commitError: (v: BarcodeValues) => string;
    resolve: Resolve;
  } | null>(null);
  const [zone, setZone] = useState<{
    dialog: DIALOG_COPPER_ZONE | DIALOG_NON_COPPER_ZONES_EDITOR | DIALOG_RULE_AREA_PROPERTIES;
    resolve: Resolve;
  } | null>(null);

  /** PAD_TOOL's dialogs, each with the promise the tool waits on. */
  const [pushPad, setPushPad] = useState<{
    dialog: DIALOG_PUSH_PAD_PROPERTIES;
    resolve: (aReturnCode: number) => void;
  } | null>(null);
  const [enumPads, setEnumPads] = useState<{ dialog: DIALOG_ENUM_PADS; resolve: Resolve } | null>(
    null,
  );
  const [padTable, setPadTable] = useState<DIALOG_FP_EDIT_PAD_TABLE | null>(null);
  const [editTg, setEditTg] = useState<DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS | null>(null);

  const hooks = {
    showPushPadPropertiesDialog: (aDialog: DIALOG_PUSH_PAD_PROPERTIES) =>
      new Promise<number>((resolve) => setPushPad({ dialog: aDialog, resolve })),
    showEnumPadsDialog: (aDialog: DIALOG_ENUM_PADS) =>
      new Promise<boolean>((resolve) => setEnumPads({ dialog: aDialog, resolve })),
    showPadTableDialog: (aDialog: DIALOG_FP_EDIT_PAD_TABLE) => setPadTable(aDialog),
    showGlobalEditTextAndGraphicsDialog: (aDialog: DIALOG_GLOBAL_EDIT_TEXT_AND_GRAPHICS) =>
      setEditTg(aDialog),
    showPadPropertiesDialog: (aDialog: DIALOG_PAD_PROPERTIES) => setPad(aDialog),
    showGraphicItemPropertiesDialog: (aDialog: DIALOG_SHAPE_PROPERTIES, aOnOK?: () => void) =>
      setShape({ dialog: aDialog, ...(aOnOK ? { onOK: aOnOK } : {}) }),
    showDimensionPropertiesDialog: (aDialog: DIALOG_DIMENSION_PROPERTIES) => setDimension(aDialog),
    showTextPropertiesDialog: (aDialog: DIALOG_TEXT_PROPERTIES) =>
      new Promise<boolean>((resolve) => setText({ dialog: aDialog, resolve })),
    showTextBoxPropertiesDialog: (aDialog: DIALOG_TEXTBOX_PROPERTIES) =>
      new Promise<boolean>((resolve) => setTextBox({ dialog: aDialog, resolve })),
    showReferenceImagePropertiesDialog: (aDialog: DIALOG_REFERENCE_IMAGE_PROPERTIES) =>
      new Promise<boolean>((resolve) => setImage({ dialog: aDialog, resolve })),
    showTablePropertiesDialog: (aDialog: DIALOG_TABLE_PROPERTIES) =>
      new Promise<boolean>((resolve) =>
        setTable({ dialog: aDialog, table: aDialog.GetTable(), resolve }),
      ),
    showTableCellPropertiesDialog: (aDialog: DIALOG_TABLECELL_PROPERTIES) =>
      new Promise<void>((resolve) => setCells({ dialog: aDialog, resolve })),
    showBarcodePropertiesDialog: (aDialog: DIALOG_BARCODE_PROPERTIES) =>
      new Promise<boolean>((resolve) =>
        setBarcode({
          dialog: aDialog,
          preview: (v) => barcodePreview(aDialog.Preview(v)),
          commitError: (v) => aDialog.CommitError(v),
          resolve,
        }),
      ),
    showZoneSettingsDialog: (
      aDialog: DIALOG_COPPER_ZONE | DIALOG_NON_COPPER_ZONES_EDITOR | DIALOG_RULE_AREA_PROPERTIES,
    ) => new Promise<boolean>((resolve) => setZone({ dialog: aDialog, resolve })),
    // The "Choose Image" dialog: a file input, read as bytes. Cancel answers
    // null (the input's `cancel` event), which leaves the tool armed, as
    // upstream's `continue` does.
    showImageFileDialog: () =>
      new Promise<Uint8Array | null>((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.addEventListener('cancel', () => resolve(null));
        input.onchange = (): void => {
          const file = input.files?.[0];
          if (!file) {
            resolve(null);
            return;
          }
          void file.arrayBuffer().then(
            (b) => resolve(new Uint8Array(b)),
            () => resolve(null),
          );
        };
        input.click();
      }),
  };

  const theBoard = board();
  const layers = enabledLayerNames(theBoard);
  const coloured = layers.map((name) => ({ name, color: layerColor(name) }));

  const zoneNode = ((): ReactNode => {
    if (!zone) return null;

    const { dialog, resolve } = zone;
    const done = (aOk: boolean): void => {
      setZone(null);
      resolve(aOk);
    };
    const transferred = (r: { ok: boolean; message?: string }): void => {
      if (r.ok) done(true);
      else if (r.message) DisplayErrorMessage(r.message);
    };

    if (dialog instanceof DIALOG_COPPER_ZONE)
      return (
        <DialogCopperZones
          units={units}
          initial={dialog.TransferDataToWindow()}
          nets={netNamesByCode(theBoard)}
          layers={coloured.filter((l) => /\.Cu$/.test(l.name))}
          onApply={(values, conv) => transferred(dialog.TransferDataFromWindow(values, conv))}
          onClose={() => done(false)}
        />
      );

    if (dialog instanceof DIALOG_RULE_AREA_PROPERTIES)
      return (
        <DialogRuleAreaProperties
          units={units}
          initial={dialog.TransferDataToWindow()}
          layers={coloured}
          sources={collectPlacementSources(theBoard!)}
          onApply={(values, conv) => transferred(dialog.TransferDataFromWindow(values, conv))}
          onClose={() => done(false)}
        />
      );

    return (
      <DialogNonCopperZonesProperties
        dialog={dialog}
        units={units}
        layers={coloured.filter((l) => !/\.Cu$/.test(l.name))}
        onResult={done}
      />
    );
  })();

  const node = (
    <>
      {zoneNode}
      {text && (
        <DialogTextProperties
          initial={text.dialog.TransferDataToWindow()}
          shape={text.dialog.GetWindowShape()}
          units={units}
          layers={layers}
          layerColor={layerColor}
          onApply={(values: TextValues) => {
            const d = text;
            setText(null);
            // On the live PCB_TEXT: one BOARD_COMMIT, or none for a new text (IS_NEW),
            // which its tool commits.
            d.resolve(d.dialog.TransferDataFromWindow(values).ok);
          }}
          onClose={() => {
            text.resolve(false);
            setText(null);
          }}
        />
      )}
      {pushPad && (
        <DialogPushPadProperties
          dialog={pushPad.dialog}
          onResult={(aReturnCode) => {
            setPushPad(null);
            pushPad.resolve(aReturnCode);
          }}
        />
      )}
      {enumPads && (
        <DialogEnumPads
          dialog={enumPads.dialog}
          onResult={(aOk) => {
            setEnumPads(null);
            enumPads.resolve(aOk);
          }}
        />
      )}
      {padTable && <DialogFpEditPadTable dialog={padTable} onClose={() => setPadTable(null)} />}
      {ptEntry && (
        <WX_PT_ENTRY_DIALOG
          caption={ptEntry.title}
          labelX={ptEntry.labelX}
          labelY={ptEntry.labelY}
          defaultValue={ptEntry.value}
          showResetButton={ptEntry.reset}
          units={units}
          iuScale={pcbIUScale}
          onResult={(aValue) => {
            setPtEntry(null);
            ptEntry.resolve(aValue);
          }}
        />
      )}
      {editTg && board() && (
        <DialogGlobalEditTextAndGraphics
          dialog={editTg}
          layers={LSET.AllLayersMask()
            .UIOrder()
            .filter((l) => board()!.IsLayerEnabled(l))
            .map((l) => {
              const c = choiceOf(l);
              return { layer: l, label: c.label, swatch: c.swatch };
            })}
          onClose={() => setEditTg(null)}
        />
      )}
      {shape && (
        <DialogShapeProperties
          dialog={shape.dialog}
          layers={layers}
          layerColor={layerColor}
          onApplied={() => {
            shape.onOK?.();
            setShape(null);
          }}
          onClose={() => setShape(null)}
        />
      )}
      {cells && (
        <DialogTableCellProperties
          dialog={cells.dialog}
          onClose={() => {
            cells.resolve();
            setCells(null);
          }}
        />
      )}
      {table && (
        <DialogTableProperties
          dlg={table.dialog}
          onClose={(aOk) => {
            table.resolve(aOk);
            setTable(null);
          }}
        />
      )}
      {textBox && (
        <DialogTextBoxProperties
          dialog={textBox.dialog}
          initial={textBox.dialog.TransferDataToWindow()}
          units={units}
          layers={layers}
          layerColor={layerColor}
          onApply={(values: TextBoxValues) => {
            const d = textBox;
            setTextBox(null);
            d.resolve(d.dialog.TransferDataFromWindow(values).ok);
          }}
          onClose={() => {
            textBox.resolve(false);
            setTextBox(null);
          }}
        />
      )}
      {image && (
        <DialogReferenceImageProperties
          dialog={image.dialog}
          onClose={(aOk) => {
            setImage(null);
            image.resolve(aOk);
          }}
        />
      )}
      {dimension && (
        <DialogDimensionProperties
          dialog={dimension}
          units={units}
          layers={layers}
          layerColor={layerColor}
          onApply={(values: DimensionValues) => {
            const d = dimension;
            setDimension(null);
            // DIALOG_DIMENSION_PROPERTIES on the live dimension: one BOARD_COMMIT.
            d.TransferDataFromWindow(values);
          }}
          onClose={() => setDimension(null)}
        />
      )}
      {pad && (
        // DIALOG_PAD_PROPERTIES on the live PAD: OK is one BOARD_COMMIT.
        <DialogPadProperties dialog={pad} onClose={() => setPad(null)} />
      )}
      {barcode && (
        <DialogBarcodeProperties
          units={units}
          preview={barcode.preview}
          commitError={barcode.commitError}
          initial={barcode.dialog.TransferDataToWindow()}
          layers={layers}
          layerColor={layerColor}
          background={background}
          onClose={() => {
            barcode.resolve(false);
            setBarcode(null);
          }}
          onApply={(v) => {
            const d = barcode;
            setBarcode(null);
            d.resolve(d.dialog.TransferDataFromWindow(v).ok);
          }}
        />
      )}
    </>
  );

  const pointEntry = (
    aTitle: string,
    aLabelX: string,
    aLabelY: string,
    aValue: VECTOR2I,
    aShowResetButton: boolean,
  ): Promise<VECTOR2I | null> =>
    new Promise((resolve) =>
      setPtEntry({
        title: aTitle,
        labelX: aLabelX,
        labelY: aLabelY,
        value: aValue,
        reset: aShowResetButton,
        resolve,
      }),
    );

  return { hooks, pointEntry, node };
}
