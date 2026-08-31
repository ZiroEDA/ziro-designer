// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_FIELD_PROPERTIES, control by control against
 * `dialog_field_properties_base.cpp` and the `init()` that shows and hides
 * parts of it.
 *
 * The control-set assertions are EQUALITIES over what is rendered rather than
 * "is present" lookups, because the differences a side-by-side against a live
 * 10.0.5 turned up were as much about controls we had INVENTED as about ones
 * we were missing:
 *
 *   1. a "Name:" row. There is no field-name editor in this dialog at all —
 *      the field's name is the LABEL of the value entry
 *      (dialog_field_properties.cpp:281) — and with it went our own
 *      "mandatory fields cannot be renamed" rule;
 *   2. the value entry was labelled the literal "Text:", the base file's
 *      pre-SetLabel string, instead of the field's name;
 *   3. no Font: row at all, where the base builds a FONT_CHOICE;
 *   4. Bold and Italic as checkboxes, and both alignments as <select>s, where
 *      upstream has eleven BITMAP_BUTTONs in one bar
 *      (dialog_field_properties.cpp:100-131);
 *   5. "mm" written into all three unit labels, where each is a UNIT_BINDER
 *      showing the frame's own units (`:52-54`).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DialogFieldProperties } from '@ziroeda/designer/src/editors/schematic/dialogs/dialog_field_properties.js';
import type { FieldPropsResult } from '@ziroeda/designer/src/editors/schematic/dialogs/dialog_field_properties.js';
import { fieldEditCaption } from '@ziroeda/eeschema/src/tools/field_properties.js';
import { schIUScale } from '@ziroeda/common';

afterEach(cleanup);

const SIZE = schIUScale.mmToIU(1.27);

const initialFor = (over: Partial<FieldPropsResult> = {}): FieldPropsResult => ({
  key: 'Value',
  value: '10k',
  at: { x: schIUScale.mmToIU(2.54), y: schIUScale.mmToIU(1.27) },
  angle: 0,
  effects: { hidden: false, fontSize: [SIZE, SIZE] },
  nameShown: false,
  doNotAutoplace: false,
  ...over,
});

function open(over: Partial<FieldPropsResult> = {}, units?: 'mm' | 'mils' | 'in') {
  const initial = initialFor(over);
  const seen: FieldPropsResult[] = [];
  render(
    <DialogFieldProperties
      initial={initial}
      caption={fieldEditCaption(initial.key)}
      units={units}
      onOk={(r) => seen.push(r)}
      onCancel={() => {}}
    />,
  );
  return seen;
}

/** Every `<label class="row">`'s leading `<span>` — the dialog's row captions. */
const rowLabels = (): string[] =>
  Array.from(document.querySelectorAll('.ze-label-dialog-body label.row > span')).map(
    (s) => s.textContent ?? '',
  );

/** The formatting bar's buttons, by their tooltip, in order. */
const barButtons = (): string[] =>
  Array.from(document.querySelectorAll('.ze-lp-iconbar button')).map(
    (b) => b.getAttribute('title') ?? '',
  );

const barChecked = (): string[] =>
  Array.from(document.querySelectorAll('.ze-lp-iconbar button'))
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.getAttribute('title') ?? '');

describe('DIALOG_FIELD_PROPERTIES: the value row', () => {
  /**
   * `m_textLabel->SetLabel( aField->GetName() + wxS( ":" ) )`
   * (dialog_field_properties.cpp:281). The base file's "Text:" is only what
   * wxFormBuilder wrote; the dialog overwrites it before it is ever shown.
   */
  it('labels the entry with the field name, and has no Name row', () => {
    open({ key: 'MPN', value: 'RC0402' });
    expect(rowLabels()).toStrictEqual(['MPN:']);
    expect(screen.queryByText('Name:')).toBeNull();
    expect(screen.queryByText('Text:')).toBeNull();
  });

  it('labels a mandatory field the same way, with no read-only name cell', () => {
    open({ key: 'Value' });
    expect(rowLabels()).toStrictEqual(['Value:']);
    expect(document.querySelectorAll('.ze-cell-ro').length).toBe(0);
  });

  /**
   * TransferDataFromWindow reads m_TextCtrl, the position binders, the size
   * binder, the font, the buttons and the three checkboxes — and nothing that
   * could rename the field, because no such control exists.
   */
  it('hands the field back under its original name', () => {
    const seen = open({ key: 'MPN' });
    fireEvent.click(screen.getByText('OK'));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.key).toBe('MPN');
  });
});

describe('DIALOG_FIELD_PROPERTIES: the checkbox row', () => {
  /**
   * bSizer9 (dialog_field_properties_base.cpp:110-134) is ONE horizontal
   * sizer holding m_visible, m_nameVisible and m_cbAllowAutoPlace, both of the
   * latter Show()n again by the dialog (`:299-300`). An equality, so a fourth
   * checkbox fails.
   */
  it('is Visible / Show field name / Allow automatic placement', () => {
    open();
    expect(
      Array.from(document.querySelectorAll('.ze-fieldprops-checks label')).map(
        (l) => l.textContent ?? '',
      ),
    ).toStrictEqual(['Visible', 'Show field name', 'Allow automatic placement']);
  });

  /** The tooltips the base sets on the two hidden-by-default boxes. */
  it('carries the tooltips the base sets', () => {
    open();
    const labels = Array.from(document.querySelectorAll('.ze-fieldprops-checks label'));
    expect(labels.map((l) => l.getAttribute('title'))).toStrictEqual([
      null,
      'Show the field name in addition to its value',
      'Allow automatic placement of this field in the schematic',
    ]);
  });

  /**
   * TransferDataToWindow: m_visible from IsVisible(), m_nameVisible from
   * IsNameShown(), m_cbAllowAutoPlace from CanAutoplace() — so a hidden field
   * that may not be autoplaced opens with Visible and Allow clear.
   */
  it('takes its three values from the field', () => {
    open({
      effects: { hidden: true, fontSize: [SIZE, SIZE] },
      nameShown: true,
      doNotAutoplace: true,
    });
    const boxes = Array.from(document.querySelectorAll('.ze-fieldprops-checks input'));
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toStrictEqual([false, true, false]);
  });
});

describe('DIALOG_FIELD_PROPERTIES: the formatting bar', () => {
  /**
   * FONT_CHOICE's two built-in entries, spelled by the generated base
   * (dialog_field_properties_base.cpp:145).
   */
  it('offers the font choice with its two built-in faces', () => {
    open();
    // `FONT_CHOICE` is a wxOwnerDrawnComboBox (`font_choice.h:28`), so this is
    // our `Combo` — the owner-drawn one the toolbars use — and not a native
    // <select>. Its rows carry role="option", which is what a listbox offers.
    const combo = document.querySelector('.ze-lp-font') as HTMLElement | null;
    expect(combo).toBeTruthy();
    expect(combo?.getAttribute('aria-haspopup')).toBe('listbox');
    // An owner-drawn combo builds its list when it drops down, so the faces
    // are asserted through the gesture that shows them rather than by reading
    // markup a wxChoice would have had sitting there.
    fireEvent.click(combo!);
    expect(
      Array.from(document.querySelectorAll('[role="option"]')).map((o) => o.textContent),
    ).toStrictEqual(['Default Font', 'KiCad Font']);
    expect(screen.getByText('Font:')).toBeTruthy();
  });

  /**
   * formattingSizer's order, and every tooltip verbatim
   * (dialog_field_properties_base.cpp:152-225). The five separators are
   * BITMAP_BUTTONs with SetIsSeparator() and carry no tooltip, so they are not
   * in this list; they are counted below.
   */
  it('is bold, italic, three H aligns, three V aligns, two orientations', () => {
    open();
    expect(barButtons()).toStrictEqual([
      'Bold',
      'Italic',
      'Align left',
      'Align horizontal center',
      'Align right',
      'Align top',
      'Align vertical center',
      'Align bottom',
      'Horizontal text',
      'Vertical text',
    ]);
    expect(document.querySelectorAll('.ze-lp-iconbar .ze-lp-sep').length).toBe(5);
  });

  /** They are BITMAP_BUTTONs, not a wxChoice: no dropdown in the bar. */
  it('draws no dropdown for either alignment', () => {
    open();
    // The alignments are BITMAP_BUTTONs, never a choice: upstream's formatting
    // row has exactly one combo in it and that is the font. Counting native
    // <select>s used to say this; the font picker is our owner-drawn `Combo`
    // now, so the count that carries the claim is of comboboxes, and a native
    // <select> anywhere in this dialog would itself be the bug.
    expect(document.querySelectorAll('[aria-haspopup="listbox"]').length).toBe(1);
    expect(document.querySelectorAll('select').length).toBe(0);
    expect(screen.queryByText('Orientation:')).toBeNull();
    expect(screen.queryByText('Align:')).toBeNull();
  });

  /**
   * TransferDataToWindow checks the button for the field's justification, and
   * m_horizontal for a non-vertical angle (dialog_field_properties.cpp:496-521).
   */
  it('checks the buttons the field asks for', () => {
    open({
      angle: 90,
      effects: { hidden: false, fontSize: [SIZE, SIZE], justify: ['right', 'top'] },
    });
    expect(barChecked()).toStrictEqual(['Align right', 'Align top', 'Vertical text']);
  });

  /**
   * onHAlignButton un-checks the OTHER two of its group and leaves the rest
   * alone (dialog_field_properties.cpp:446-454); bold and italic are
   * SetIsCheckButton() and toggle independently.
   */
  it('runs each group as radio buttons and bold/italic as toggles', () => {
    open();
    fireEvent.click(screen.getByTitle('Align right'));
    fireEvent.click(screen.getByTitle('Align left'));
    expect(barChecked()).toStrictEqual(['Align left', 'Align vertical center', 'Horizontal text']);

    fireEvent.click(screen.getByTitle('Bold'));
    fireEvent.click(screen.getByTitle('Italic'));
    expect(barChecked()).toStrictEqual([
      'Bold',
      'Italic',
      'Align left',
      'Align vertical center',
      'Horizontal text',
    ]);

    // A SetIsCheckButton() button CLEARS on the second click; a radio one, and
    // the three of an alignment group, do not.
    fireEvent.click(screen.getByTitle('Bold'));
    expect(barChecked()).toStrictEqual([
      'Italic',
      'Align left',
      'Align vertical center',
      'Horizontal text',
    ]);
    fireEvent.click(screen.getByTitle('Align left'));
    expect(barChecked()).toContain('Align left');
  });

  /** GR_TEXT_*_ALIGN_CENTER writes no justify token, as the writer expects. */
  it('writes the chosen justification back', () => {
    const seen = open();
    fireEvent.click(screen.getByTitle('Align right'));
    fireEvent.click(screen.getByTitle('Align top'));
    fireEvent.click(screen.getByTitle('Vertical text'));
    fireEvent.click(screen.getByText('OK'));
    expect(seen[0]!.effects.justify).toStrictEqual(['right', 'top']);
    expect(seen[0]!.angle).toBe(90);
  });
});

describe('DIALOG_FIELD_PROPERTIES: the three UNIT_BINDERs', () => {
  /**
   * `m_posX( aParent, m_xPosLabel, m_xPosCtrl, m_xPosUnits, true )` and its two
   * siblings (dialog_field_properties.cpp:52-54): the units label is the
   * FRAME's, so it reads "mils" on an imperial schematic and the value is
   * StringFromValue at that unit's precision — the same pair the properties
   * grid uses (PGPROPERTY_DISTANCE::DistanceToString).
   */
  it('wears the frame units, not a hardcoded mm', () => {
    open({}, 'mils');
    expect(
      Array.from(document.querySelectorAll('.ze-lp-units')).map((u) => u.textContent),
    ).toStrictEqual(['mils', 'mils', 'mils']);
  });

  it('shows the values converted to those units', () => {
    open({ at: { x: schIUScale.mmToIU(2.54), y: schIUScale.mmToIU(1.27) } }, 'mils');
    const fields = Array.from(document.querySelectorAll('.ze-lp-size'));
    // 1.27 mm = 50 mils, 2.54 mm = 100 mils; the size field is first.
    expect(fields.map((f) => (f as HTMLInputElement).value)).toStrictEqual(['50', '100', '50']);
  });

  it('reads them back in those units', () => {
    const seen = open({}, 'mils');
    const fields = Array.from(document.querySelectorAll('.ze-lp-size'));
    fireEvent.change(fields[1]!, { target: { value: '200' } });
    fireEvent.click(screen.getByText('OK'));
    expect(seen[0]!.at.x).toBe(schIUScale.mmToIU(5.08));
  });

  /** Position X: and Position Y: verbatim, and Text size: / Color: beside them. */
  it('labels the rows the way the base does', () => {
    open();
    expect(
      Array.from(document.querySelectorAll('.ze-lp-fmt-label')).map((s) => s.textContent),
    ).toStrictEqual(['Font:', 'Text size:', 'Position X:', 'Position Y:']);
    expect(screen.getByText('Color:')).toBeTruthy();
  });
});

describe('DIALOG_FIELD_PROPERTIES: the button row', () => {
  /** m_sdbSizerButtons: wxID_OK and wxID_CANCEL, GTK order. */
  it('is Cancel then OK', () => {
    open();
    expect(
      Array.from(document.querySelectorAll('.ze-modal-footer button')).map((b) => b.textContent),
    ).toStrictEqual(['Cancel', 'OK']);
  });
});
