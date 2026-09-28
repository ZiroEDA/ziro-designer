// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The window half of `PROPERTIES_FRAME`
 * (pagelayout_editor/dialogs/properties_frame_base.cpp): the two notebook
 * pages over the engine in `properties_frame.ts`, which holds every control's
 * state under its base-class name and does every transfer.
 *
 *  - "Item Properties": item type + Syntax Help; the page-option choice; for
 *    text items the text, the bold/italic + alignment button bar, colour,
 *    font, size and the maxlen/maxheight constraints; comment; the Position /
 *    End Position groups with their corner combos; line width; rotation;
 *    bitmap DPI; and the Repeat Parameters group.
 *  - "General Options": the sheet's default text size / line & text thickness
 *    (with Set to Default) and the four page margins.
 *
 * An edit only marks the panel dirty - a choice, a combo or a button through
 * `onModify`, a text field when it loses focus through `onTextFocusLost` - and
 * `OnUpdateUI` turns that into one `OnAcceptPrms`, as wx's idle does.
 */

import { type JSX, useEffect, useReducer, useState } from 'react';
import { bitmapUrl } from '@ziroeda/common/bitmap_store.js';
import { COLOR4D_UNSPECIFIED, type Color4d, toCss } from '@ziroeda/common/gal/color4d.js';
import { DialogColorPicker } from '@ziroeda/common/dialogs/dialog_color_picker.js';
import type { UNIT_BINDER } from '@ziroeda/common/widgets/unit_binder.js';
import { BinderField } from '@ziroeda/common/widgets/unit_binder_ui.js';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import {
  CORNER_CHOICES,
  FONT_CHOICES,
  PAGE_OPTION_CHOICES,
  type PROPERTIES_FRAME,
} from './properties_frame.js';

// ---- small layout helpers ----------------------------------------------------

function Group({
  title,
  children,
  layout = 'grid',
}: {
  title: string;
  children: React.ReactNode;
  /**
   * Which sizer the box holds. The two pages do NOT use the same one:
   * `grid` is the Item Properties page's `wxFlexGridSizer( 0, 3, 3, 0 )` with
   * `AddGrowableCol( 1 )`; `stack` is General Options' `wxFlexGridSizer( 0, 2,
   * 0, 0 )` with `AddGrowableCol( 0 )`, which spends two grid rows per field -
   * `[label][spacer]` then `[ctrl][units]` (:471-481, :545-555) - and so puts
   * the label on a line of its OWN above a full-width field.
   */
  layout?: 'grid' | 'stack';
}): JSX.Element {
  return (
    <fieldset className="ze-ds-group">
      <legend>{title}</legend>
      {/* The label column is as wide as the widest label IN THIS BOX, which is
          what a CSS grid's `auto` track is. */}
      <div className={layout === 'grid' ? 'ze-ds-grid' : 'ze-ds-stack'}>{children}</div>
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

/** General Options' row: the label on its own line, the field under it. */
function StackRow({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <>
      <span className="ze-ds-label ze-ds-stacklabel">{label}</span>
      <div className="ze-ds-row">{children}</div>
    </>
  );
}

/**
 * One of the panel's plain `wxTextCtrl`s - Rotation, Count, Step text and
 * Bitmap DPI (properties_frame_base.cpp:369, :400, :410, :376). None is a
 * spin control, so there is no step and no arrows.
 */
function TextCtrl({
  value,
  onChange,
  onFocusLost,
  title,
}: {
  value: string;
  onChange: (aText: string) => void;
  onFocusLost: () => void;
  title?: string;
}): JSX.Element {
  return (
    <input
      className="ze-search"
      type="text"
      style={{ flex: '1 1 auto', minWidth: 0 }}
      title={title}
      value={value}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onFocusLost}
    />
  );
}

function FormatButton({
  active,
  title,
  onClick,
  bitmap,
}: {
  active?: boolean;
  /**
   * Only two of the eight buttons have one: `m_bold->SetToolTip( _( "Bold" ) )`
   * and `m_italic->SetToolTip( _( "Italic" ) )` (properties_frame_base.cpp:93, 98).
   */
  title?: string;
  onClick: () => void;
  /** The `BITMAPS::` name properties_frame.cpp:100-120 sets on this button. */
  bitmap: string;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`ze-btn ze-ds-fmt${active ? ' active' : ''}`}
      title={title}
      onClick={onClick}
    >
      <img src={bitmapUrl(bitmap)} alt="" />
    </button>
  );
}

const isUnspecified = (c: Color4d): boolean => c.r === 0 && c.g === 0 && c.b === 0 && c.a === 0;

// ---- the frame -----------------------------------------------------------------

export function PropertiesFrame({
  panel,
}: {
  /** `PL_EDITOR_FRAME::GetPropertiesFrame()`. */
  panel: PROPERTIES_FRAME;
}): JSX.Element {
  const [tab, setTab] = useState<'item' | 'general'>('item');
  const [, repaint] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    panel.SetChangeListener(repaint);
    return () => panel.SetChangeListener(null);
  }, [panel]);

  /** A choice / combo / button: `onModify`, then the idle's `OnUpdateUI`. */
  const modify = (): void => {
    panel.onModify();
    panel.OnUpdateUI();
  };
  /** A text field left: `onTextFocusLost`, then `OnUpdateUI`. */
  const focusLost = (): void => {
    panel.onTextFocusLost();
    panel.OnUpdateUI();
  };
  const binder = (b: UNIT_BINDER, title?: string): JSX.Element => (
    <BinderField
      binder={b}
      onEdit={repaint}
      onFocusLost={focusLost}
      {...(title === undefined ? {} : { title })}
    />
  );

  return (
    <div
      className="ze-panel grow"
      style={{ overflow: 'auto', display: 'flex', flexDirection: 'column' }}
    >
      {/* The AUI pane caption: `.Caption( _( "Properties" ) )`
          (pl_editor_frame.cpp:199-203), WX_AUI_DOCK_ART's shared strip. */}
      <div className="ze-panel-header">Properties</div>
      <div className="ze-ds-tabs">
        <button
          type="button"
          className={tab === 'item' ? 'active' : ''}
          onClick={() => setTab('item')}
        >
          Item Properties
        </button>
        <button
          type="button"
          className={tab === 'general' ? 'active' : ''}
          onClick={() => setTab('general')}
        >
          General Options
        </button>
      </div>
      <div
        className="ze-panel-body"
        data-testid="ds-properties"
        style={{ flex: 1, overflow: 'auto' }}
      >
        {tab === 'item' ? (
          // `CopyPrmsFromItemToPanel( nullptr )` hides the whole sizer
          // (properties_frame.cpp:226-233): a blank page with no selection.
          panel.m_showItemProperties ? (
            <ItemProperties
              panel={panel}
              modify={modify}
              focusLost={focusLost}
              binder={binder}
              repaint={repaint}
            />
          ) : null
        ) : (
          <GeneralOptions panel={panel} binder={binder} />
        )}
      </div>
    </div>
  );
}

function ItemProperties({
  panel,
  modify,
  focusLost,
  binder,
  repaint,
}: {
  panel: PROPERTIES_FRAME;
  modify: () => void;
  focusLost: () => void;
  binder: (b: UNIT_BINDER, title?: string) => JSX.Element;
  repaint: () => void;
}): JSX.Element {
  /** COLOR_SWATCH's picker, open while the user is choosing. */
  const [pickerOpen, setPickerOpen] = useState(false);
  const swatch = panel.m_textColorSwatch;

  return (
    <div className="ze-ds-itempage">
      {/* bSizerButt (properties_frame_base.cpp:25-44): the item type, the
          Syntax Help link and the page-option choice share ONE row; the label
          takes the slack (proportion 1) and the choice keeps its width. */}
      <div className="ze-ds-row ze-ds-toprow">
        {/* `m_staticTextType->SetLabel( aItem->GetClassName() )` (:241). */}
        <span className="ze-ds-type">{panel.m_staticTextType}</span>
        {panel.m_showSyntaxHelpLink && (
          <a
            href="#syntax"
            className="ze-ds-syntaxhelp"
            onClick={(e) => {
              e.preventDefault();
              panel.ShowHelp();
            }}
          >
            Syntax Help
          </a>
        )}
        <Combo
          style={{ flex: '0 0 auto', minWidth: 0 }}
          ariaLabel="First page option"
          value={String(panel.m_choicePageOpt)}
          options={PAGE_OPTION_CHOICES.map((label, i) => ({ value: String(i), label }))}
          onChange={(v) => {
            panel.m_choicePageOpt = Number(v);
            modify();
          }}
        />
      </div>

      {panel.m_showTextOptions && (
        <>
          <textarea
            className="ze-search ze-ds-textedit"
            rows={3}
            value={panel.m_stcText}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              panel.m_stcText = e.target.value;
              repaint();
            }}
            onBlur={focusLost}
          />
          <div className="ze-ds-fmtbar">
            <FormatButton
              active={panel.m_bold}
              title="Bold"
              bitmap="text_bold"
              onClick={() => {
                panel.m_bold = !panel.m_bold;
                modify();
              }}
            />
            <FormatButton
              active={panel.m_italic}
              title="Italic"
              bitmap="text_italic"
              onClick={() => {
                panel.m_italic = !panel.m_italic;
                modify();
              }}
            />
            <span className="ze-ds-fmtsep" />
            <FormatButton
              active={panel.m_alignLeft}
              bitmap="text_align_left"
              onClick={() => {
                panel.onHAlignButton('left');
                panel.OnUpdateUI();
              }}
            />
            <FormatButton
              active={panel.m_alignCenter}
              bitmap="text_align_center"
              onClick={() => {
                panel.onHAlignButton('center');
                panel.OnUpdateUI();
              }}
            />
            <FormatButton
              active={panel.m_alignRight}
              bitmap="text_align_right"
              onClick={() => {
                panel.onHAlignButton('right');
                panel.OnUpdateUI();
              }}
            />
            <span className="ze-ds-fmtsep" />
            <FormatButton
              active={panel.m_vAlignTop}
              bitmap="text_valign_top"
              onClick={() => {
                panel.onVAlignButton('top');
                panel.OnUpdateUI();
              }}
            />
            <FormatButton
              active={panel.m_vAlignMiddle}
              bitmap="text_valign_center"
              onClick={() => {
                panel.onVAlignButton('middle');
                panel.OnUpdateUI();
              }}
            />
            <FormatButton
              active={panel.m_vAlignBottom}
              bitmap="text_valign_bottom"
              onClick={() => {
                panel.onVAlignButton('bottom');
                panel.OnUpdateUI();
              }}
            />
            <span className="ze-ds-fmtsep" />
            {/* `m_textColorSwatch`: a COLOR_SWATCH, which checkerboards
                COLOR4D::UNSPECIFIED (color_swatch.cpp:78-133) and opens
                DIALOG_COLOR_PICKER on a click (:301-311), its default being
                the UNSPECIFIED set at properties_frame.cpp:124. */}
            <button
              type="button"
              className={`ze-swatch${isUnspecified(swatch) ? ' unspecified' : ''}`}
              aria-label="Text color"
              style={isUnspecified(swatch) ? undefined : { background: toCss(swatch) }}
              onClick={() => setPickerOpen(true)}
            />
            {pickerOpen && (
              <DialogColorPicker
                value={swatch}
                defaultColor={COLOR4D_UNSPECIFIED}
                onDone={(picked) => {
                  setPickerOpen(false);
                  if (!picked) return; // wxID_CANCEL
                  panel.onSwatchChanged(picked);
                  panel.OnUpdateUI();
                }}
              />
            )}
          </div>
          <Row label="Font:">
            <Combo
              style={{ flex: 1, minWidth: 0 }}
              value={String(panel.m_fontCtrl)}
              options={FONT_CHOICES.map((label, i) => ({ value: String(i), label }))}
              onChange={(v) => {
                panel.m_fontCtrl = Number(v);
                modify();
              }}
            />
          </Row>
          <Row label="Text width:">{binder(panel.m_textSizeX)}</Row>
          <Row label="Text height:">{binder(panel.m_textSizeY)}</Row>
          <Row label="Maximum width:" hint="Set to 0 to disable this constraint">
            {binder(panel.m_constraintX)}
          </Row>
          <Row label="Maximum height:" hint="Set to 0 to disable this constraint">
            {binder(panel.m_constraintY)}
          </Row>
          {/* `m_staticTextSizeInfo` (properties_frame_base.cpp:226), in
              KIUI::GetInfoFont().Italic() (properties_frame.cpp:97). */}
          <div className="ze-ds-sizeinfo">Set to 0 to use default values</div>
        </>
      )}

      {/* m_staticTextComment above a full-width m_textCtrlComment
          (properties_frame_base.cpp:233-238). */}
      <label className="ze-ds-label ze-ds-stacklabel" htmlFor="ze-ds-comment">
        Comment:
      </label>
      <input
        id="ze-ds-comment"
        className="ze-search ze-ds-textedit"
        value={panel.m_textCtrlComment}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          panel.m_textCtrlComment = e.target.value;
          repaint();
        }}
        onBlur={focusLost}
      />

      <Group title="Position">
        <Row label="X:">{binder(panel.m_textPosX)}</Row>
        <Row label="Y:">{binder(panel.m_textPosY)}</Row>
        <Row label="From:">
          <Combo
            style={{ flex: 1, minWidth: 0 }}
            value={String(panel.m_comboBoxCornerPos)}
            options={CORNER_CHOICES.map((label, i) => ({ value: String(i), label }))}
            onChange={(v) => {
              panel.m_comboBoxCornerPos = Number(v);
              modify();
            }}
          />
        </Row>
      </Group>
      {panel.m_showEndPosition && (
        <Group title="End Position">
          <Row label="X:">{binder(panel.m_textEndX)}</Row>
          <Row label="Y:">{binder(panel.m_textEndY)}</Row>
          <Row label="From:">
            <Combo
              style={{ flex: 1, minWidth: 0 }}
              value={String(panel.m_comboBoxCornerEnd)}
              options={CORNER_CHOICES.map((label, i) => ({ value: String(i), label }))}
              onChange={(v) => {
                panel.m_comboBoxCornerEnd = Number(v);
                modify();
              }}
            />
          </Row>
        </Group>
      )}

      {/* gbSizer1 (properties_frame_base.cpp:350-380): Line width, Rotation and
          Bitmap DPI, built once and Show()n per type (properties_frame.cpp:359-379). */}
      <div className="ze-ds-grid bare">
        {panel.m_lineWidth.IsShown() && <Row label="Line width:">{binder(panel.m_lineWidth)}</Row>}
        {/* No unit label: m_textCtrlRotation has no m_*Units beside it. */}
        {panel.m_showRotation && (
          <Row label="Rotation:">
            <TextCtrl
              value={panel.m_textCtrlRotation}
              onChange={(t) => {
                panel.m_textCtrlRotation = t;
                repaint();
              }}
              onFocusLost={focusLost}
            />
          </Row>
        )}
        {panel.m_showBitmapDPI && (
          <Row label="Bitmap DPI:">
            <TextCtrl
              value={panel.m_textCtrlBitmapDPI}
              onChange={(t) => {
                panel.m_textCtrlBitmapDPI = t;
                repaint();
              }}
              onFocusLost={focusLost}
            />
          </Row>
        )}
      </div>

      <Group title="Repeat Parameters">
        <Row label="Count:">
          <TextCtrl
            value={panel.m_textCtrlRepeatCount}
            onChange={(t) => {
              panel.m_textCtrlRepeatCount = t;
              repaint();
            }}
            onFocusLost={focusLost}
          />
        </Row>
        {panel.m_showIncLabel && (
          <Row
            label="Step text:"
            hint="Number of characters or digits to step text by for each repeat."
          >
            <TextCtrl
              value={panel.m_textCtrlTextIncrement}
              onChange={(t) => {
                panel.m_textCtrlTextIncrement = t;
                repaint();
              }}
              onFocusLost={focusLost}
            />
          </Row>
        )}
        <Row label="Step X:" hint="Distance on the X axis to step for each repeat.">
          {binder(panel.m_textStepX)}
        </Row>
        <Row label="Step Y:" hint="Distance to step on Y axis for each repeat.">
          {binder(panel.m_textStepY)}
        </Row>
      </Group>
    </div>
  );
}

function GeneralOptions({
  panel,
  binder,
}: {
  panel: PROPERTIES_FRAME;
  binder: (b: UNIT_BINDER) => JSX.Element;
}): JSX.Element {
  return (
    <div>
      <Group title="Default Values" layout="stack">
        <StackRow label="Text width:">{binder(panel.m_defaultTextSizeX)}</StackRow>
        <StackRow label="Text height:">{binder(panel.m_defaultTextSizeY)}</StackRow>
        <StackRow label="Line thickness:">{binder(panel.m_defaultLineWidth)}</StackRow>
        <StackRow label="Text thickness:">{binder(panel.m_defaultTextThickness)}</StackRow>
        <div className="ze-ds-row">
          <button type="button" className="ze-btn" onClick={() => panel.OnSetDefaultValues()}>
            Set to Default
          </button>
        </div>
      </Group>
      <Group title="Page Margins" layout="stack">
        <StackRow label="Left:">{binder(panel.m_textLeftMargin)}</StackRow>
        <StackRow label="Right:">{binder(panel.m_textRightMargin)}</StackRow>
        <StackRow label="Top:">{binder(panel.m_textTopMargin)}</StackRow>
        <StackRow label="Bottom:">{binder(panel.m_textBottomMargin)}</StackRow>
      </Group>
    </div>
  );
}
