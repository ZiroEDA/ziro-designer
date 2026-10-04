// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The window that draws PCB_BASE_EDIT_FRAME's item dialogs — the half of each
 * `Show…Dialog` KiCad's frame does with `dlg.ShowModal()`. One module for
 * every PCB_BASE_EDIT_FRAME window, as the methods are one set on the base
 * class upstream: pad, text, shape, dimension, text box, reference image,
 * table, barcode and the three zone dialogs, each on its live item, plus the
 * "Choose Image" file dialog.
 *
 * {@link usePcbItemDialogs} answers the hooks the frame calls and the React
 * node that draws whichever dialog is up.
 */

import { type JSX, type ReactNode, useCallback, useState } from 'react';
import { DisplayErrorMessage, IsOK } from '@ziroeda/common/confirm.js';
import { DialogTableProperties } from '@ziroeda/common/dialogs/dialog_table_properties.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { LSET } from '@ziroeda/common/lset.js';
import type { StatusUnits } from '@ziroeda/common/widgets/kistatusbar_format.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import type { BOARD } from './board.js';
import {
  barcodePreview,
  type BarcodePreview,
  type BarcodeValues,
  type DIALOG_BARCODE_PROPERTIES,
} from './dialogs/dialog_barcode_properties.js';
import { DialogBarcodeProperties } from './dialogs/dialog_barcode_properties_ui.js';
import { DialogCopperZones } from './dialogs/dialog_copper_zones.js';
import type {
  DIALOG_DIMENSION_PROPERTIES,
  DimensionValues,
} from './dialogs/dialog_dimension_properties.js';
import { DialogDimensionProperties } from './dialogs/dialog_dimension_properties_ui.js';
import { DialogShapeProperties } from './dialogs/dialog_graphic_properties.js';
import type { DIALOG_NON_COPPER_ZONES_EDITOR } from './dialogs/dialog_non_copper_zones_properties.js';
import { DialogNonCopperZonesProperties } from './dialogs/dialog_non_copper_zones_properties_ui.js';
import type { DIALOG_PAD_PROPERTIES, PadValues } from './dialogs/dialog_pad_properties.js';
import { DialogPadProperties } from './dialogs/dialog_pad_properties_ui.js';
import type {
  DIALOG_REFERENCE_IMAGE_PROPERTIES,
  ImageValues,
} from './dialogs/dialog_reference_image_properties.js';
import { DialogReferenceImageProperties } from './dialogs/dialog_reference_image_properties_ui.js';
import {
  collectPlacementSources,
  DIALOG_RULE_AREA_PROPERTIES,
} from './dialogs/dialog_rule_area_properties.js';
import { DialogRuleAreaProperties } from './dialogs/dialog_rule_area_properties_ui.js';
import type { DIALOG_SHAPE_PROPERTIES, ShapeValues } from './dialogs/dialog_shape_properties.js';
import type { DIALOG_TABLE_PROPERTIES, TableValues } from './dialogs/dialog_table_properties.js';
import type { DIALOG_TEXT_PROPERTIES, TextValues } from './dialogs/dialog_text_properties.js';
import { DialogTextProperties } from './dialogs/dialog_text_properties_ui.js';
import type {
  DIALOG_TEXTBOX_PROPERTIES,
  TextBoxValues,
} from './dialogs/dialog_textbox_properties.js';
import { DialogTextBoxProperties } from './dialogs/dialog_textbox_properties_ui.js';
import { DIALOG_COPPER_ZONE } from './dialogs/panel_zone_properties.js';
import type { PCB_BASE_EDIT_FRAME_DIALOG_HOOKS } from './pcb_base_edit_frame.js';
import type { PCB_TABLE } from './pcb_table.js';

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
      | 'showBarcodePropertiesDialog'
      | 'showZoneSettingsDialog'
      | 'showImageFileDialog'
    >
  >;
  node: ReactNode;
} {
  const { units, board, layerColor, background } = aEnv;

  const [pad, setPad] = useState<DIALOG_PAD_PROPERTIES | null>(null);
  const [shape, setShape] = useState<DIALOG_SHAPE_PROPERTIES | null>(null);
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

  const hooks = {
    showPadPropertiesDialog: (aDialog: DIALOG_PAD_PROPERTIES) => setPad(aDialog),
    showGraphicItemPropertiesDialog: (aDialog: DIALOG_SHAPE_PROPERTIES) => setShape(aDialog),
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

  /** DIALOG_REFERENCE_IMAGE_PROPERTIES::TransferDataFromWindow, its one IsOK in between. */
  const applyImage = useCallback(
    (values: ImageValues) => {
      const req = image;
      setImage(null);
      if (!req) return;

      let question: string | null = null;
      const r = req.dialog.TransferDataFromWindow(values, (m) => {
        question = m;
        return false;
      });
      if (r.ok) req.resolve(true);
      else if (question !== null)
        void IsOK(question).then((yes) => {
          req.resolve(yes && req.dialog.TransferDataFromWindow(values).ok);
        });
      else req.resolve(false);
    },
    [image],
  );

  const theBoard = board();
  const layers = enabledLayerNames(theBoard);
  const coloured = layers.map((name) => ({ name, color: layerColor(name) }));

  const tableHeader = (v: TableValues, set: (patch: Partial<TableValues>) => void): JSX.Element => (
    <div className="ze-tableprops-header">
      <label className="row ze-tableprops-field">
        <span className="ze-tableprops-lbl">Layer:</span>
        <Combo
          value={v.layer}
          onChange={(layer) => set({ layer })}
          options={layers.map((name) => ({ value: name, label: name, swatch: layerColor(name) }))}
        />
      </label>
      <label className="row ze-tableprops-field">
        <input
          type="checkbox"
          checked={v.locked}
          onChange={(e) => set({ locked: e.target.checked })}
        />
        <span className="ze-tableprops-boxlbl">Locked</span>
      </label>
    </div>
  );

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
      {shape && (
        <DialogShapeProperties
          units={units}
          initial={shape.TransferDataToWindow()}
          shape={shape.GetShape()}
          layers={layers}
          onApply={(values: ShapeValues) => {
            const d = shape;
            setShape(null);
            // DIALOG_SHAPE_PROPERTIES on the live PCB_SHAPE: one BOARD_COMMIT.
            d.TransferDataFromWindow(values);
          }}
          onClose={() => setShape(null)}
        />
      )}
      {table && (
        <DialogTableProperties<TableValues>
          initial={table.dialog.TransferDataToWindow()}
          iuScale={pcbIUScale}
          columnWidths={Array.from({ length: table.table.GetColCount() }, (_, i) =>
            table.table.GetColWidth(i),
          )}
          isNew={table.table.IsNew()}
          header={tableHeader}
          onOk={(values: TableValues) => {
            const d = table;
            setTable(null);
            d.resolve(d.dialog.TransferDataFromWindow(values).ok);
          }}
          onCancel={() => {
            table.resolve(false);
            setTable(null);
          }}
        />
      )}
      {textBox && (
        <DialogTextBoxProperties
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
          image={{ data: image.dialog.ImageData() }}
          initial={image.dialog.TransferDataToWindow()}
          units={units}
          layers={layers}
          layerColor={layerColor}
          onApply={applyImage}
          onClose={() => {
            image.resolve(false);
            setImage(null);
          }}
        />
      )}
      {dimension && (
        <DialogDimensionProperties
          units={units}
          initial={dimension.TransferDataToWindow()}
          type={dimension.GetDimensionType()}
          layers={layers}
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
        <DialogPadProperties
          units={units}
          initial={pad.TransferDataToWindow()}
          nets={netNamesByCode(theBoard)}
          layers={layers}
          onApply={(values: PadValues) => {
            const d = pad;
            setPad(null);
            // DIALOG_PAD_PROPERTIES on the live PAD: one BOARD_COMMIT.
            d.TransferDataFromWindow(values);
          }}
          onClose={() => setPad(null)}
        />
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

  return { hooks, node };
}
