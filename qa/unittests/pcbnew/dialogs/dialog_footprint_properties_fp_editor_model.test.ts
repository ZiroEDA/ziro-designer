// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR (`pcbnew/dialogs/dialog_footprint_properties_fp_editor.cpp`)
 * on the footprint editor's live footprint, and FOOTPRINT_EDIT_FRAME::OnEditItemRequest
 * (`footprint_editor_utils.cpp`) routing each item to its dialog.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import type { KiDialogRequest } from '@ziroeda/common/kidialog.js';
import {
  DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR,
  type FootprintFpEditorValues,
} from '@ziroeda/pcbnew/dialogs/dialog_footprint_properties_fp_editor.js';
import { DIALOG_PAD_PROPERTIES } from '@ziroeda/pcbnew/dialogs/dialog_pad_properties.js';
import { DIALOG_TEXT_PROPERTIES } from '@ziroeda/pcbnew/dialogs/dialog_text_properties.js';
import {
  FOOTPRINT,
  FP_BOARD_ONLY,
  FP_DNP,
  FP_SMD,
  FP_THROUGH_HOLE,
} from '@ziroeda/pcbnew/footprint.js';
import { FOOTPRINT_EDIT_FRAME } from '@ziroeda/pcbnew/footprint_edit_frame.js';
import { FOOTPRINT_LIBRARY_STORE } from '@ziroeda/pcbnew/footprint_library_adapter.js';
import { ZONE_CONNECTION } from '@ziroeda/pcbnew/zones.js';
import { PCB_FIELD } from '@ziroeda/pcbnew/pcb_field.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { attachFootprintFrameCanvas } from '../support/footprint_frame_canvas.js';

const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const FP_TEXT = (aName: string): string => `(footprint "${aName}" (layer "F.Cu") (uuid "${U(10)}")
  (descr "A resistor") (tags "R res")
  (attr smd)
  (property "Reference" "R1" (at 0 0 0) (layer "F.SilkS") (uuid "${U(11)}"))
  (property "Value" "${aName}" (at 0 1 0) (layer "F.Fab") (uuid "${U(12)}"))
  (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu") (uuid "${U(13)}"))
  (pad "2" smd rect (at 1 0) (size 1 1) (layers "F.Cu") (uuid "${U(14)}")))`;

let store: FOOTPRINT_LIBRARY_STORE;
let frame: FOOTPRINT_EDIT_FRAME;
let asked: KiDialogRequest[];
let answer: 'ok' | 'cancel';
let shown: unknown[];

beforeEach(async () => {
  asked = [];
  answer = 'cancel';
  shown = [];
  store = new FOOTPRINT_LIBRARY_STORE({
    footprintText: () => Promise.reject(new Error('none')),
    flipLeftRight: () => false,
  });
  store.AddProjectLibrary('Lib', 'Lib.pretty', [
    { fileName: 'R.kicad_mod', text: FP_TEXT('R') },
    { fileName: 'C.kicad_mod', text: FP_TEXT('C') },
  ]);
  frame = new FOOTPRINT_EDIT_FRAME({
    fpEdit: () => {},
    askKiDialog: (aRequest) => {
      asked.push(aRequest);
      return Promise.resolve(answer);
    },
    showPadPropertiesDialog: (d) => shown.push(d),
    showTextPropertiesDialog: (d) => {
      shown.push(d);
      return Promise.resolve(false);
    },
    showFootprintPropertiesFpEditorDialog: (d) => {
      shown.push(d);
      return Promise.resolve(false);
    },
  });
  frame.SetFootprintLibAdapter(store);
  attachFootprintFrameCanvas(frame);
  await frame.LoadFootprintFromLibrary(new LIB_ID('Lib', 'R'));
});

const fp = (): FOOTPRINT => frame.GetBoard()!.GetFirstFootprint()!;
const dialog = (): DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR =>
  new DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR(frame, fp());

describe('TransferDataToWindow', () => {
  it('shows the name, description, keywords, type and the field copies', () => {
    const v = dialog().TransferDataToWindow();

    expect(v.footprintName).toBe('R');
    expect(v.description).toBe('A resistor');
    expect(v.keywords).toBe('R res');
    expect(v.componentType).toBe(1);
    expect(v.fields.map((f) => f.GetName())).toContain('Reference');
    // Copies: editing one leaves the footprint's field alone.
    v.fields[0]!.SetText('changed');
    expect(fp().GetFields()[0]!.GetText()).not.toBe('changed');
    expect(v.zoneConnection).toBe(0);
    expect(v.localClearance).toBeNull();
  });
});

describe('TransferDataFromWindow', () => {
  const edit = (aChange: Partial<FootprintFpEditorValues>): { ok: boolean; message?: string } => {
    const dlg = dialog();
    return dlg.TransferDataFromWindow({ ...dlg.TransferDataToWindow(), ...aChange });
  };

  it('writes the name into the FPID, keeping the nickname, and the texts', () => {
    expect(edit({ footprintName: 'R_new', description: 'B', keywords: 'k' }).ok).toBe(true);

    expect(fp().GetFPID().Format()).toBe('Lib:R_new');
    expect(fp().GetLibDescription()).toBe('B');
    expect(fp().GetKeywords()).toBe('k');
  });

  it('writes the type and the attribute boxes as one attribute word', () => {
    edit({ componentType: 0, boardOnly: true, dnp: true });

    expect(fp().GetAttributes()).toBe(FP_THROUGH_HOLE | FP_BOARD_ONLY | FP_DNP);

    edit({ componentType: 2, boardOnly: false, dnp: false });
    expect(fp().GetAttributes() & (FP_THROUGH_HOLE | FP_SMD)).toBe(0);
  });

  it('writes the clearance overrides, an empty control clearing one', () => {
    edit({ localClearance: 200000, localSolderMaskMargin: 50000, zoneConnection: 2 });
    expect(fp().GetLocalClearance()).toBe(200000);
    expect(fp().GetLocalSolderMaskMargin()).toBe(50000);
    expect(fp().GetLocalZoneConnection()).toBe(ZONE_CONNECTION.THERMAL);

    edit({ localClearance: null });
    expect(fp().GetLocalClearance()).toBeUndefined();
  });

  it('net-tie groups drop empty rows; jumper groups split on commas and spaces', () => {
    edit({ netTieGroups: ['1, 2', ''], jumperGroups: ['1, 2'] });

    expect(fp().GetNetTiePadGroups()).toEqual(['1, 2']);
    expect(
      fp()
        .JumperPadGroups()
        .map((g) => [...g]),
    ).toEqual([['1', '2']]);
  });

  it('a jumper group naming a pad the footprint lacks is refused', () => {
    const r = edit({ jumperGroups: ['1 9'] });

    expect(r.ok).toBe(false);
    expect(r.message).toBe("Pad '9' in jumper pad group 1 does not exist in this footprint.");
  });

  it('replaces the fields with the edited copies, as one undo step', () => {
    const dlg = dialog();
    const v = dlg.TransferDataToWindow();
    v.fields.find((f) => f.GetName() === 'Value')!.SetText('Edited');

    dlg.TransferDataFromWindow(v);
    expect(fp().GetValue()).toBe('Edited');

    frame.RestoreCopyFromUndoList();
    expect(frame.GetBoard()!.GetFirstFootprint()!.GetValue()).toBe('R');
  });
});

describe('Validate', () => {
  it('a footprint must have a name, without the reserved characters', async () => {
    const dlg = dialog();
    const v = dlg.TransferDataToWindow();

    expect(await dlg.Validate({ ...v, footprintName: '' })).toMatchObject({
      ok: false,
      message: 'Footprint must have a name.',
    });
    expect(await dlg.Validate({ ...v, footprintName: 'a/b' })).toMatchObject({
      ok: false,
      message: `Footprint name may not contain '${FOOTPRINT.StringLibNameInvalidChars(true)}'.`,
    });
  });

  it('a field needs a name', async () => {
    const dlg = dialog();
    const v = dlg.TransferDataToWindow();
    // A mandatory field always answers its canonical name; a user field can be blank.
    v.fields.push(new PCB_FIELD(fp(), FIELD_T.USER, ''));

    expect(await dlg.Validate(v)).toMatchObject({
      ok: false,
      message: 'Fields must have a name.',
      fieldRow: v.fields.length - 1,
    });
  });

  it("another footprint's name asks to overwrite; Overwrite deletes the other one", async () => {
    const dlg = dialog();
    const v = { ...dlg.TransferDataToWindow(), footprintName: 'C' };

    answer = 'cancel';
    expect((await dlg.Validate(v)).ok).toBe(true);
    expect(asked.map((r) => r.message)).toEqual(["Footprint 'C' already exists in library 'Lib'."]);
    expect(store.FootprintExists('Lib', 'C')).toBe(true);

    answer = 'ok';
    expect((await dlg.Validate(v)).ok).toBe(true);
    expect(asked[1]!.labels).toEqual({ ok: 'Overwrite' });
    expect(store.FootprintExists('Lib', 'C')).toBe(false);
  });

  it('its own name asks nothing', async () => {
    const dlg = dialog();

    expect((await dlg.Validate(dlg.TransferDataToWindow())).ok).toBe(true);
    expect(asked).toEqual([]);
  });

  it('a negative clearance is refused', async () => {
    const dlg = dialog();

    expect((await dlg.Validate({ ...dlg.TransferDataToWindow(), localClearance: -1 })).ok).toBe(
      false,
    );
  });
});

describe('OnEditItemRequest', () => {
  it('a pad opens the pad dialog on it', () => {
    const pad = fp().Pads()[0]!;
    frame.OnEditItemRequest(pad);

    expect(shown).toHaveLength(1);
    expect(shown[0]).toBeInstanceOf(DIALOG_PAD_PROPERTIES);
  });

  it('a field opens the text dialog', () => {
    frame.OnEditItemRequest(fp().GetFields()[0]!);

    expect(shown[0]).toBeInstanceOf(DIALOG_TEXT_PROPERTIES);
  });

  it('the footprint opens the footprint editor properties dialog on it', async () => {
    frame.OnEditItemRequest(fp());
    await new Promise((r) => setTimeout(r, 0));

    expect(shown[0]).toBeInstanceOf(DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR);
    expect((shown[0] as DIALOG_FOOTPRINT_PROPERTIES_FP_EDITOR).GetFootprint()).toBe(fp());
  });
});
