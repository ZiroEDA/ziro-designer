// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Drawing Sheet Editor's docked properties panel, the web counterpart of
 * `pl_editor`'s PROPERTIES_FRAME (pagelayout_editor/dialogs/properties_frame.cpp).
 *
 * Two notebook tabs:
 *  - "Item Properties": item type + Syntax Help; the page-option choice; for
 *    text items the multiline editor with the bold/italic + alignment button
 *    bar, colour, font, size and the maxlen/maxheight constraints; comment;
 *    the Position / End Position groups with their corner combos; line
 *    thickness; rotation; bitmap DPI; and the Repeat Parameters group.
 *  - "General Options": the sheet's default text size / line & text thickness
 *    (with Set to Default) and the four page margins.
 *
 * Every distance is a UNIT_BINDER (ui/UnitField.tsx): the panel holds
 * millimetres, as the file does, but shows and reads them back in whichever
 * unit the frame's toolbar is set to. `properties_frame.cpp:57-79` builds all
 * twenty of its numeric fields that way, with the frame as UNITS_PROVIDER, so
 * the panel never hardcodes a unit and never carries a literal "mm".
 */

import { useState, type JSX } from 'react';
import {
  WKS_ITEM_TYPE_LABEL,
  type WksSheet,
  type WksItem,
  type WksText,
  type WksLine,
  type WksRect,
  type WksBitmap,
  type WksPoly,
  type WksPoint,
  type WksCorner,
  type WksOption,
  type WksColor,
} from '@ziroeda/common';
import { KICAD_FONT_NAME } from '@ziroeda/common/src/font/stroke_font.js';
import { Combo, type ComboOption } from '../../ui/Combo.js';
import { useModalEscape } from '../../ui/useModalEscape.js';
import { UnitField } from '../../ui/UnitField.js';
import type { EdaUnits, UnitRange } from '../../ui/unit_binder.js';
import { MessageDialogError } from '../../ui/dialog_message.js';

/**
 * The font faces the Text page offers — `FONT_CHOICE`
 * (common/widgets/font_choice.cpp:240-258), which appends "Default Font" and
 * KICAD_FONT_NAME as two SEPARATE entries before the installed faces.
 *
 * They are not the same value. The first leaves `m_Font` null and writes no
 * `(face …)`; the second names the stroke font and writes
 * `(face "KiCad Font")`, because `write_face` is
 * `m_Font && !GetName().IsEmpty()` and the stroke font's own `m_fontName` IS
 * that string (stroke_font.cpp:189).
 *
 * The installed faces are the one divergence we cannot close: a browser cannot
 * enumerate system fonts without the Local Font Access permission and its
 * prompt. So the list stops at the two KiCad entries — the same pair our own
 * schematic text and label dialogs already offer.
 */
const FACE_CHOICES: readonly ComboOption[] = [
  { value: '', label: 'Default Font' },
  { value: KICAD_FONT_NAME, label: KICAD_FONT_NAME },
];

/** TB_DEFAULT_TEXTSIZE and the standard default pen widths (ds_data_model). */
const DEFAULT_TEXTSIZE = 1.5;
const DEFAULT_WIDTH = 0.15;

/*
 * The `validateMM` ranges, in millimetres — `validateMM( binder, min, max )`
 * is `UNIT_BINDER::Validate( min, max, EDA_UNITS::MM )`, so the limits stay in
 * mm however the field is displayed. Every call site upstream is listed; a
 * field NOT in this list is deliberately unchecked there, and adding a range
 * to one would be as wrong as dropping one from these.
 */

/** DLG_MIN_TEXTSIZE / DLG_MAX_TEXTSIZE (properties_frame.cpp:49-50). */
const DLG_MIN_TEXTSIZE = 0.01;
const DLG_MAX_TEXTSIZE = 100.0;

/** An item's pen width (:529) and the sheet's default line width (:204). */
const LINE_WIDTH_RANGE: UnitRange = { min: 0.0, max: 10.0 };

/**
 * An item's own text size (:611, :614). Zero is legal here and means "use the
 * sheet default", which is why the minimum is 0 and not DLG_MIN_TEXTSIZE.
 */
const ITEM_TEXT_SIZE_RANGE: UnitRange = { min: 0.0, max: DLG_MAX_TEXTSIZE };

/**
 * The sheet's DEFAULT text size (:207, :210). This one cannot be zero — there
 * is no further default to fall back to — so an emptied field is refused.
 */
const DEFAULT_TEXT_SIZE_RANGE: UnitRange = { min: DLG_MIN_TEXTSIZE, max: DLG_MAX_TEXTSIZE };

/** The sheet's default text thickness (:213). */
const DEFAULT_TEXT_THICKNESS_RANGE: UnitRange = { min: 0.0, max: 5.0 };

/** Corner combo entries, in the panel's order. */
const CORNER_CHOICES: { value: WksCorner; label: string }[] = [
  { value: 'rtcorner', label: 'Upper Right' },
  { value: 'ltcorner', label: 'Upper Left' },
  { value: 'rbcorner', label: 'Lower Right' },
  { value: 'lbcorner', label: 'Lower Left' },
];

const PAGE_CHOICES: { value: WksOption; label: string }[] = [
  { value: 'normal', label: 'Show on all pages' },
  { value: 'page1only', label: 'First page only' },
  { value: 'notonpage1', label: 'Subsequent pages only' },
];

// ---- small layout helpers ----------------------------------------------------

function Group({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <fieldset className="ze-ds-group">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

function Row({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}): JSX.Element {
  return (
    <div className="ze-ds-row" title={hint}>
      <span className="ze-ds-label">{label}</span>
      {children}
    </div>
  );
}

function NumField({
  value,
  onCommit,
  step = 0.1,
  width,
  title,
}: {
  value: number;
  onCommit: (n: number) => void;
  step?: number;
  /** Unset expands to fill the value column, as `wxEXPAND` does upstream. */
  width?: number | string;
  title?: string;
}): JSX.Element {
  // Commit on blur / Enter like the wx panel (focus-lost applies the value).
  const [text, setText] = useState<string | null>(null);
  const commit = (): void => {
    if (text === null) return;
    const n = Number(text);
    if (Number.isFinite(n) && n !== value) onCommit(n);
    setText(null);
  };
  return (
    <input
      className="ze-search"
      type="number"
      step={step}
      style={width === undefined ? { flex: '1 1 auto', minWidth: 0 } : { width }}
      title={title}
      value={text ?? String(value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
    />
  );
}

function CornerCombo({
  value,
  onChange,
}: {
  value: WksCorner;
  onChange: (c: WksCorner) => void;
}): JSX.Element {
  return (
    <Combo
      style={{ flex: 1, minWidth: 0 }}
      value={value}
      options={CORNER_CHOICES}
      onChange={(v) => onChange(v as WksCorner)}
    />
  );
}

function PositionGroup({
  title,
  point,
  units,
  onChange,
}: {
  title: string;
  point: WksPoint;
  units: EdaUnits;
  onChange: (p: WksPoint) => void;
}): JSX.Element {
  return (
    <Group title={title}>
      <Row label="X:">
        <UnitField
          label="X:"
          units={units}
          value={point.x}
          onCommit={(x) => onChange({ ...point, x })}
        />
      </Row>
      <Row label="Y:">
        <UnitField
          label="Y:"
          units={units}
          value={point.y}
          onCommit={(y) => onChange({ ...point, y })}
        />
      </Row>
      <Row label="From:">
        <CornerCombo value={point.corner} onChange={(corner) => onChange({ ...point, corner })} />
      </Row>
    </Group>
  );
}

// ---- text formatting bar -------------------------------------------------------

function FormatButton({
  active,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      className={`ze-btn ze-ds-fmt${active ? ' active' : ''}`}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const colorCss = (c: WksColor | undefined): string =>
  c ? `rgba(${c.r},${c.g},${c.b},${c.a})` : '#c8322d';

const hexOf = (c: WksColor | undefined): string => {
  if (!c) return '#c8322d';
  const h = (n: number): string => Math.round(n).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
};

// ---- the frame -----------------------------------------------------------------

export function PropertiesFrame({
  sheet,
  selectedIndex,
  units,
  onItemChange,
  onSetupChange,
  onShowSyntaxHelp,
}: {
  sheet: WksSheet;
  selectedIndex: number;
  /** The frame's display unit — PROPERTIES_FRAME's parent is the UNITS_PROVIDER. */
  units: EdaUnits;
  onItemChange: (patch: Partial<WksItem>) => void;
  onSetupChange: (patch: Partial<WksSheet['setup']>) => void;
  onShowSyntaxHelp: () => void;
}): JSX.Element {
  const [tab, setTab] = useState<'item' | 'general'>('item');
  /**
   * UNIT_BINDER::delayedFocusHandler's DisplayErrorMessage box. One per panel,
   * not one per field: only one binder can be failing at a time, because the
   * check runs on the focus that leaves it.
   */
  const [error, setError] = useState<string | null>(null);
  const item = selectedIndex >= 0 ? sheet.items[selectedIndex] : undefined;

  return (
    <div
      className="ze-panel grow"
      style={{ overflow: 'auto', display: 'flex', flexDirection: 'column' }}
    >
      <div className="ze-ds-tabs">
        <button className={tab === 'item' ? 'active' : ''} onClick={() => setTab('item')}>
          Item Properties
        </button>
        <button className={tab === 'general' ? 'active' : ''} onClick={() => setTab('general')}>
          General Options
        </button>
      </div>
      <div
        className="ze-panel-body"
        data-testid="ds-properties"
        style={{ flex: 1, overflow: 'auto' }}
      >
        {tab === 'item' ? (
          item ? (
            <ItemProperties
              item={item}
              units={units}
              onError={setError}
              onChange={onItemChange}
              onShowSyntaxHelp={onShowSyntaxHelp}
            />
          ) : (
            <div className="ze-muted" style={{ padding: 6 }}>
              Select an item to edit its properties.
            </div>
          )
        ) : (
          <GeneralOptions
            setup={sheet.setup}
            units={units}
            onError={setError}
            onChange={onSetupChange}
          />
        )}
      </div>
      {error && <MessageDialogError message={error} onClose={() => setError(null)} />}
    </div>
  );
}

function ItemProperties({
  item,
  units,
  onError,
  onChange,
  onShowSyntaxHelp,
}: {
  item: WksItem;
  units: EdaUnits;
  onError: (message: string) => void;
  onChange: (patch: Partial<WksItem>) => void;
  onShowSyntaxHelp: () => void;
}): JSX.Element {
  const t = item.type === 'text' ? (item as WksText) : null;
  const shape = item.type === 'line' || item.type === 'rect' ? (item as WksLine | WksRect) : null;
  const bitmap = item.type === 'bitmap' ? (item as WksBitmap) : null;
  const poly = item.type === 'polygon' ? (item as WksPoly) : null;
  /** DS_DATA_ITEM::m_LineWidth — every type but a bitmap has one. */
  const pen: WksText | WksLine | WksRect | WksPoly | null = t ?? shape ?? poly;
  const patch = onChange as (p: Record<string, unknown>) => void;

  return (
    <div>
      {/* bSizerButt (properties_frame_base.cpp:25-44): the item type, the
          Syntax Help link and the page-option choice share one row, and the
          choice carries NO label - the three entries say what it is. It wraps
          here rather than clipping, which a wxBoxSizer does not have to do. */}
      <div
        className="ze-ds-row"
        style={{ justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 3 }}
      >
        {/* `m_staticTextType->SetLabel( aItem->GetClassName() )`
            (properties_frame.cpp:241): the type NAME alone. Ours prefixed it
            with "Type: ", which upstream never shows — the control's designer
            placeholder is "Item Type" and it is overwritten on every
            selection. It is also not bold: properties_frame_base.cpp:31 sets
            the font explicitly to wxFONTWEIGHT_NORMAL. */}
        <span className="ze-ds-type">{WKS_ITEM_TYPE_LABEL[item.type]}</span>
        {/* `m_syntaxHelpLink->Show( aItem->GetType() == DS_DATA_ITEM::DS_TEXT )`
            (properties_frame.cpp:358). Only a text item has `${…}` syntax to
            be helped with; ours offered the link for a Line. */}
        {t && (
          <a
            href="#syntax"
            className="ze-ds-syntaxhelp"
            onClick={(e) => {
              e.preventDefault();
              onShowSyntaxHelp();
            }}
          >
            Syntax Help
          </a>
        )}
        <Combo
          style={{ flex: '1 1 100%', minWidth: 0 }}
          ariaLabel="First page option"
          value={item.option}
          options={PAGE_CHOICES}
          onChange={(v) => patch({ option: v as WksOption })}
        />
      </div>

      {t && (
        <>
          <textarea
            className="ze-search ze-ds-textedit"
            rows={3}
            value={t.text}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => patch({ text: e.target.value })}
          />
          <div className="ze-ds-fmtbar">
            <FormatButton active={t.bold} title="Bold" onClick={() => patch({ bold: !t.bold })}>
              <b>B</b>
            </FormatButton>
            <FormatButton
              active={t.italic}
              title="Italic"
              onClick={() => patch({ italic: !t.italic })}
            >
              <i>I</i>
            </FormatButton>
            <span className="ze-ds-fmtsep" />
            <FormatButton
              active={t.hjustify === 'left'}
              title="Align left"
              onClick={() => patch({ hjustify: 'left' })}
            >
              ⬅
            </FormatButton>
            <FormatButton
              active={t.hjustify === 'center'}
              title="Align center"
              onClick={() => patch({ hjustify: 'center' })}
            >
              ↔
            </FormatButton>
            <FormatButton
              active={t.hjustify === 'right'}
              title="Align right"
              onClick={() => patch({ hjustify: 'right' })}
            >
              ➡
            </FormatButton>
            <span className="ze-ds-fmtsep" />
            <FormatButton
              active={t.vjustify === 'top'}
              title="Align top"
              onClick={() => patch({ vjustify: 'top' })}
            >
              ⬆
            </FormatButton>
            <FormatButton
              active={t.vjustify === 'center'}
              title="Align middle"
              onClick={() => patch({ vjustify: 'center' })}
            >
              ↕
            </FormatButton>
            <FormatButton
              active={t.vjustify === 'bottom'}
              title="Align bottom"
              onClick={() => patch({ vjustify: 'bottom' })}
            >
              ⬇
            </FormatButton>
            <span className="ze-ds-fmtsep" />
            <input
              type="color"
              title="Text color"
              value={hexOf(t.color)}
              style={{
                width: 26,
                height: 22,
                padding: 0,
                border: 'none',
                background: colorCss(t.color),
              }}
              onChange={(e) => {
                const hex = e.target.value;
                patch({
                  color: {
                    r: parseInt(hex.slice(1, 3), 16),
                    g: parseInt(hex.slice(3, 5), 16),
                    b: parseInt(hex.slice(5, 7), 16),
                    a: t.color?.a ?? 1,
                  },
                });
              }}
            />
            {t.color && (
              <button
                className="ze-btn ze-ds-fmt"
                title="Clear color override (use the sheet color)"
                onClick={() => patch({ color: undefined })}
              >
                ✕
              </button>
            )}
          </div>
          <Row label="Font:">
            <Combo
              style={{ flex: 1, minWidth: 0 }}
              value={t.face ?? ''}
              options={FACE_CHOICES}
              onChange={(v) => patch({ face: v || undefined })}
            />
          </Row>
          <Row label="Text width:" hint="Set to 0 to use default values">
            <UnitField
              label="Text width:"
              units={units}
              range={ITEM_TEXT_SIZE_RANGE}
              onError={onError}
              value={t.fontW}
              onCommit={(fontW) => patch({ fontW })}
            />
          </Row>
          <Row label="Text height:" hint="Set to 0 to use default values">
            <UnitField
              label="Text height:"
              units={units}
              range={ITEM_TEXT_SIZE_RANGE}
              onError={onError}
              value={t.fontH}
              onCommit={(fontH) => patch({ fontH })}
            />
          </Row>
          <Row label="Maximum width:" hint="Set to 0 to disable this constraint">
            <UnitField
              label="Maximum width:"
              units={units}
              value={t.maxlen}
              onCommit={(maxlen) => patch({ maxlen })}
            />
          </Row>
          <Row label="Maximum height:" hint="Set to 0 to disable this constraint">
            <UnitField
              label="Maximum height:"
              units={units}
              value={t.maxheight}
              onCommit={(maxheight) => patch({ maxheight })}
            />
          </Row>
          {/* `m_staticTextSizeInfo` (properties_frame_base.cpp:226), drawn in
              KIUI::GetInfoFont().Italic() (properties_frame.cpp:97) — one
              relative point down from the control font, which is what
              --ui-font-size-info is. Ours said "Set to 0 to disable a
              constraint", which is the TOOLTIP of the two Maximum fields
              (:185, :198) and not this line. */}
          <div className="ze-ds-sizeinfo">Set to 0 to use default values</div>
        </>
      )}

      <Row label="Comment:">
        <input
          className="ze-search"
          style={{ flex: 1, minWidth: 0 }}
          value={item.comment}
          onKeyDown={(e) => e.stopPropagation()}
          onChange={(e) => patch({ comment: e.target.value })}
        />
      </Row>

      {(t || bitmap || poly) && (
        <PositionGroup
          title="Position"
          units={units}
          point={(t ?? bitmap ?? poly)!.pos}
          onChange={(pos) => patch({ pos })}
        />
      )}
      {shape && (
        <>
          <PositionGroup
            title="Position"
            units={units}
            point={shape.start}
            onChange={(start) => patch({ start })}
          />
          <PositionGroup
            title="End Position"
            units={units}
            point={shape.end}
            onChange={(end) => patch({ end })}
          />
        </>
      )}

      {/*
       * gbSizer1 (properties_frame_base.cpp:350-380): Line width, Rotation and
       * Bitmap DPI, in that order and outside every type branch, because
       * upstream builds each of them ONCE and Show()s it per type
       * (properties_frame.cpp:359-379).
       *
       * m_lineWidth is a single binder over DS_DATA_ITEM::m_LineWidth, so a
       * line, a rectangle, a text and a polygon all label it "Line width:".
       * We used to split it into "Line thickness:" for shapes and an invented
       * "Text thickness:" row for text - and "Text thickness:" is a real
       * label, but it belongs to General Options > Default Values, over the
       * sheet's m_DefaultTextThickness, which is a different value entirely.
       */}
      {!bitmap && pen && (
        <Row label="Line width:" hint="Set to 0 to use default values">
          <UnitField
            label="Line width:"
            units={units}
            range={LINE_WIDTH_RANGE}
            onError={onError}
            value={pen.lineWidth}
            onCommit={(lineWidth) => patch({ lineWidth })}
          />
        </Row>
      )}
      {/* Rotation carries no unit label: m_textCtrlRotation has no
          m_*Units static text beside it, and its value goes through
          DoubleValueFromString with EDA_UNITS::UNSCALED. */}
      {(t || poly) && (
        <Row label="Rotation:">
          <NumField
            step={90}
            value={(t ?? poly)!.rotate}
            onCommit={(rotate) => patch({ rotate })}
          />
        </Row>
      )}
      {/* A bitmap gets Bitmap DPI and nothing else - there is no Scale row
          upstream, because the scale IS the DPI (DS_DATA_ITEM_BITMAP::SetPPI). */}
      {bitmap && (
        <Row label="Bitmap DPI:">
          <NumField
            step={1}
            value={bitmap.ppi}
            onCommit={(ppi) => patch({ ppi: Math.max(1, Math.round(ppi)) })}
          />
        </Row>
      )}

      <Group title="Repeat Parameters">
        <Row label="Count:">
          <NumField
            step={1}
            value={item.repeat}
            onCommit={(n) => patch({ repeat: Math.min(100, Math.max(1, Math.round(n))) })}
          />
        </Row>
        {t && (
          <Row
            label="Step text:"
            hint="Number of characters or digits to step text by for each repeat."
          >
            <NumField
              step={1}
              value={item.incrlabel}
              onCommit={(n) => patch({ incrlabel: Math.round(n) })}
            />
          </Row>
        )}
        <Row label="Step X:" hint="Distance on the X axis to step for each repeat.">
          <UnitField
            label="Step X:"
            units={units}
            value={item.incrx}
            onCommit={(incrx) => patch({ incrx })}
          />
        </Row>
        <Row label="Step Y:" hint="Distance to step on Y axis for each repeat.">
          <UnitField
            label="Step Y:"
            units={units}
            value={item.incry}
            onCommit={(incry) => patch({ incry })}
          />
        </Row>
      </Group>
    </div>
  );
}

function GeneralOptions({
  setup,
  units,
  onError,
  onChange,
}: {
  setup: WksSheet['setup'];
  units: EdaUnits;
  onError: (message: string) => void;
  onChange: (patch: Partial<WksSheet['setup']>) => void;
}): JSX.Element {
  return (
    <div>
      <Group title="Default Values">
        <Row label="Text width:">
          <UnitField
            label="Text width:"
            units={units}
            range={DEFAULT_TEXT_SIZE_RANGE}
            onError={onError}
            value={setup.textW}
            onCommit={(textW) => onChange({ textW })}
          />
        </Row>
        <Row label="Text height:">
          <UnitField
            label="Text height:"
            units={units}
            range={DEFAULT_TEXT_SIZE_RANGE}
            onError={onError}
            value={setup.textH}
            onCommit={(textH) => onChange({ textH })}
          />
        </Row>
        <Row label="Line thickness:">
          <UnitField
            label="Line thickness:"
            units={units}
            range={LINE_WIDTH_RANGE}
            onError={onError}
            value={setup.lineWidth}
            onCommit={(lineWidth) => onChange({ lineWidth })}
          />
        </Row>
        <Row label="Text thickness:">
          <UnitField
            label="Text thickness:"
            units={units}
            range={DEFAULT_TEXT_THICKNESS_RANGE}
            onError={onError}
            value={setup.textLineWidth}
            onCommit={(textLineWidth) => onChange({ textLineWidth })}
          />
        </Row>
        <div className="ze-ds-row">
          <button
            className="ze-btn"
            onClick={() =>
              onChange({
                textW: DEFAULT_TEXTSIZE,
                textH: DEFAULT_TEXTSIZE,
                lineWidth: DEFAULT_WIDTH,
                textLineWidth: DEFAULT_WIDTH,
              })
            }
          >
            Set to Default
          </button>
        </div>
      </Group>
      {/* Deliberately unvalidated on both sides: CopyPrmsFromPanelToGeneral
          assigns the four margins with no validateMM call at all. */}
      <Group title="Page Margins">
        <Row label="Left:">
          <UnitField
            label="Left:"
            units={units}
            value={setup.leftMargin}
            onCommit={(leftMargin) => onChange({ leftMargin })}
          />
        </Row>
        <Row label="Right:">
          <UnitField
            label="Right:"
            units={units}
            value={setup.rightMargin}
            onCommit={(rightMargin) => onChange({ rightMargin })}
          />
        </Row>
        <Row label="Top:">
          <UnitField
            label="Top:"
            units={units}
            value={setup.topMargin}
            onCommit={(topMargin) => onChange({ topMargin })}
          />
        </Row>
        <Row label="Bottom:">
          <UnitField
            label="Bottom:"
            units={units}
            value={setup.bottomMargin}
            onCommit={(bottomMargin) => onChange({ bottomMargin })}
          />
        </Row>
      </Group>
    </div>
  );
}

/** The Syntax Help dialog body (the panel's "Predefined Keywords" message). */
export function SyntaxHelpDialog({ onClose }: { onClose: () => void }): JSX.Element {
  // wxDialog maps Esc to wxID_CANCEL for free; ours has to ask. See
  // ui/modal_escape.ts.
  useModalEscape(onClose);

  const keywords: [string, string][] = [
    ['KICAD_VERSION', 'application version'],
    ['#', 'sheet number'],
    ['##', 'sheet count'],
    ['COMMENT1 … COMMENT9', 'title block comments'],
    ['COMPANY', 'company name'],
    ['FILENAME', 'file name'],
    ['ISSUE_DATE', 'issue date'],
    ['LAYER', 'layer name'],
    ['PAPER', 'paper size'],
    ['REVISION', 'revision'],
    ['SHEETNAME', 'sheet name'],
    ['SHEETPATH', 'sheet path'],
    ['TITLE', 'title'],
  ];
  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div className="ze-modal ze-label-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          Predefined Keywords
          <span className="x" onClick={onClose}>
            ✕
          </span>
        </div>
        <div className="ze-ds-syntaxhelp-body">
          <p>
            Texts can include keywords. Keyword notation is <code>{'${keyword}'}</code>; each
            keyword is replaced by its value at draw time.
          </p>
          <table style={{ borderCollapse: 'collapse' }}>
            <tbody>
              {keywords.map(([k, d]) => (
                <tr key={k}>
                  <td style={{ padding: '1px 14px 1px 0' }}>
                    <code>{k}</code>
                  </td>
                  <td className="ze-muted">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
