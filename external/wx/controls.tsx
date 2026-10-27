// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from wxWidgets (wxWindows Library Licence).
/**
 * The wx core controls every dialog's `_base` is built from - wxButton, wxCheckBox,
 * wxRadioButton, wxTextCtrl, wxStaticBox, wxStaticLine, wxHyperlinkCtrl - with wxChoice and
 * wxComboBox re-exported from `combobox.tsx`. ONE file for wx's core controls, by decision
 * (10-10): wx is outside KiCad's tree, so splitting it per wx header buys no KiCad match.
 */
import { type JSX, type MouseEvent, type ReactNode, type Ref, useState } from 'react';

/** wxChoice and wxComboBox, part of the wx layer like the controls below. */
import { Combo } from './combobox.js';
import { type wxColour, wxColourToCss } from './colour.js';

export { Combo, TextCombo } from './combobox.js';

export function Button({
  label,
  onClick,
  isDefault,
  disabled,
  title,
  className,
  buttonRef,
  exactFit,
  minSizeLabel,
}: {
  label: string;
  /** wxEVT_BUTTON; the event's target is GetEventObject(), e.g. to anchor a popup at it. */
  onClick?: (aEvent: MouseEvent<HTMLButtonElement>) => void;
  isDefault?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
  /** The button element, e.g. as a dialog's initialFocus. */
  buttonRef?: Ref<HTMLButtonElement>;
  /** wxBU_EXACTFIT: as wide as its label, not the standard button width. */
  exactFit?: boolean;
  /**
   * `SetMinSize( GetBestSize() )` taken with another label: the button stays wide enough for it
   * while showing `label` (a Select All that toggles to Deselect All).
   */
  minSizeLabel?: string;
}): JSX.Element {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`ze-btn${isDefault ? ' primary' : ''}${exactFit ? ' ze-btn-exactfit' : ''}${className ? ` ${className}` : ''}`}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {minSizeLabel === undefined ? (
        label
      ) : (
        <span className="ze-btn-minsize">
          <span>{label}</span>
          <span aria-hidden="true">{minSizeLabel}</span>
        </span>
      )}
    </button>
  );
}

/**
 * `wxCheckBox` in a dialog. The indicator is the shared checkbox rule and the row is
 * `.ze-check` (a GtkCheckButton's height and indicator spacing); `className` carries the
 * caller's sizer position and border only. The Preferences panels' bordered variant is
 * {@link Check}.
 */
export function CheckBox({
  label,
  checked,
  onChange,
  check,
  disabled,
  title,
  className,
  ariaLabel,
  onContextMenu,
  font,
}: {
  /** Its text; a wxDataViewListCtrl toggle row puts its icon-text cell here. */
  label: ReactNode;
  /** `SetFont( KIUI::GetInfoFont( this ) )`. */
  font?: 'info';
  /** The accessible name of a box whose label is wxEmptyString. */
  ariaLabel?: string;
  /** wxEVT_RIGHT_DOWN on the box. */
  onContextMenu?: (aX: number, aY: number) => void;
  checked?: boolean;
  onChange?: (aChecked: boolean) => void;
  /** The `_base` member instead of `checked` / `onChange` / `disabled`. */
  check?: CHECK;
  disabled?: boolean;
  title?: string;
  className?: string;
}): JSX.Element {
  const value = check ? check.value : (checked ?? false);
  const off = check ? check.enabled === false : disabled;
  const change = check ? check.onChange : onChange;

  return (
    <label
      className={`ze-check${font === 'info' ? ' info' : ''}${className ? ` ${className}` : ''}`}
      title={title}
      onContextMenu={
        onContextMenu
          ? (e) => {
              e.preventDefault();
              onContextMenu(e.clientX, e.clientY);
            }
          : undefined
      }
    >
      <input
        type="checkbox"
        checked={value}
        disabled={off}
        aria-label={ariaLabel}
        onChange={(e) => change?.(e.target.checked)}
      />
      {label}
    </label>
  );
}

/**
 * `wxChoice` bound to its `_base` member: the base's strings, the selection (-1 is wxNOT_FOUND,
 * an empty face) and the enable. `ariaLabel` is the label beside it.
 */
export function Choice({
  choices,
  choice,
  ariaLabel,
  title,
}: {
  choices: readonly string[];
  choice: CHOICE;
  ariaLabel: string;
  title?: string;
}): JSX.Element {
  return (
    <span title={title}>
      <Combo
        value={choice.value < 0 ? '' : String(choice.value)}
        options={choices.map((label, i) => ({ value: String(i), label }))}
        onChange={(v) => choice.onChange(Number(v))}
        disabled={choice.enabled === false}
        ariaLabel={ariaLabel}
      />
    </span>
  );
}

/**
 * `wxRadioButton`. The indicator is the shared drawn radio (`.ze-app input[type="radio"]`,
 * measured off a live pcb_calculator) and the row is `.ze-check`, a GtkRadioButton being the
 * same row as a GtkCheckButton. Buttons sharing `name` are one group (wxRB_GROUP).
 */
export function RadioButton({
  label,
  checked,
  onChange,
  name,
  disabled,
  title,
  className,
}: {
  label: string;
  checked: boolean;
  /** Selecting it; a radio button is never unselected by its own click. */
  onChange: () => void;
  name?: string;
  disabled?: boolean;
  title?: string;
  className?: string;
}): JSX.Element {
  return (
    <label className={`ze-check${className ? ` ${className}` : ''}`} title={title}>
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.checked) onChange();
        }}
      />
      {label}
    </label>
  );
}

/**
 * `wxRadioBox( …, label, …, choices, majorDimension, wxRA_SPECIFY_COLS )`: a static box whose
 * radio buttons fill `majorDimension` columns, row by row. `selection` is GetSelection().
 */
export function RadioBox({
  label,
  choices,
  selection,
  onChange,
  majorDimension = 1,
  disabled,
  itemEnabled,
  title,
}: {
  label: string;
  choices: readonly string[];
  selection: number;
  /** wxEVT_RADIOBOX, with the new selection. */
  onChange: (aSelection: number) => void;
  majorDimension?: number;
  disabled?: boolean;
  /** `Enable( n, false )`: which items are live; absent, all of them. */
  itemEnabled?: readonly boolean[];
  /** `SetToolTip`. */
  title?: string;
}): JSX.Element {
  return (
    <StaticBox label={label}>
      <div
        className="ze-radiobox"
        title={title}
        role="radiogroup"
        aria-label={label}
        style={{ gridTemplateColumns: `repeat(${majorDimension}, max-content)` }}
      >
        {choices.map((choice, i) => (
          <RadioButton
            // A wxRadioBox's items are its choices in order.
            // biome-ignore lint/suspicious/noArrayIndexKey: the choice index is the item's identity
            key={i}
            label={choice}
            checked={selection === i}
            disabled={disabled || itemEnabled?.[i] === false}
            onChange={() => onChange(i)}
          />
        ))}
      </div>
    </StaticBox>
  );
}

/**
 * `wxTextCtrl`. Its fill, border, radius, padding, font and height are the GTK entry's
 * (`.ze-app input`, `--ctl-height`), so a call site states none of them. `onEnter` is
 * `wxTE_PROCESS_ENTER`: the entry takes Enter itself; without it Enter goes on to the dialog's
 * default button. `multiLine` is wxTE_MULTILINE. `readOnly` is SetEditable( false ), which keeps
 * ordinary text; `disabled` is Enable( false ), which dims it.
 */
export function TextCtrl({
  value,
  onChange,
  onEnter,
  onBlur,
  multiLine,
  readOnly,
  disabled,
  title,
  hint,
  className,
  inputRef,
  textAreaRef,
  id,
  ariaLabel,
  autoFocus,
  maxLength,
  foregroundColour,
  minWidthText,
  password,
  autoComplete,
}: {
  value: string;
  /** wxTE_PASSWORD: the characters hidden. */
  password?: boolean;
  /** What a password manager may fill it with (the browser's `autocomplete`). */
  autoComplete?: string;
  /**
   * `SetMinSize( GetTextExtent( text ) )`: the whole control exactly as wide as that text would
   * be, as the stackup's fields are.
   */
  minWidthText?: string;
  onChange?: (aValue: string) => void;
  onEnter?: () => void;
  /** wxEVT_KILL_FOCUS. */
  onBlur?: () => void;
  multiLine?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  title?: string;
  /** `wxTextEntry::SetHint`: the grey text an empty entry shows. */
  hint?: string;
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
  textAreaRef?: Ref<HTMLTextAreaElement>;
  id?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  /** `SetMaxLength( n )`. */
  maxLength?: number;
  /** `SetForegroundColour( c )`: the entry's text colour; absent, the theme's. */
  foregroundColour?: wxColour;
}): JSX.Element {
  const common = {
    maxLength,
    style: foregroundColour ? { color: wxColourToCss(foregroundColour) } : undefined,
    id,
    value,
    readOnly,
    disabled,
    title,
    // `ze-textctrl`: the entry's best width, the GTK one (shell.css).
    className: multiLine ? className : `ze-textctrl${className ? ` ${className}` : ''}`,
    placeholder: hint,
    autoFocus,
    // A GtkEntry does not spell-check.
    spellCheck: false,
    'aria-label': ariaLabel,
    onBlur,
    onChange: (e: { target: { value: string } }) => onChange?.(e.target.value),
  };
  if (multiLine) return <textarea ref={textAreaRef} {...common} />;
  const input = (
    <input
      ref={inputRef}
      type={password ? 'password' : 'text'}
      {...(autoComplete ? { autoComplete } : {})}
      {...common}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onEnter) {
          e.preventDefault();
          onEnter();
        }
      }}
    />
  );
  if (minWidthText === undefined) return input;
  return (
    <span className="ze-textctrl-minw">
      {input}
      <span aria-hidden="true">{minWidthText}</span>
    </span>
  );
}

/**
 * `wxStaticBoxSizer`'s box: `fieldset.ze-sbox` (staticbox_inset_probe: the label line on top, a
 * 1 px frame in --ctl-border, the children flush inside). `className` is the sizer inside it.
 */
export function StaticBox({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <fieldset className={`ze-sbox${className ? ` ${className}` : ''}`}>
      <legend>{label}</legend>
      {children}
    </fieldset>
  );
}

/**
 * `wxStaticText`: a label. `Enable( false )` greys it as GTK's `label:disabled`; `Wrap( n )` breaks
 * it at n pixels, otherwise it never wraps.
 */
export function StaticText({
  label,
  disabled,
  wrap,
  title,
  font,
  italic,
  ellipsize,
  minWidthText,
}: {
  label: string;
  /** `SetMinSize( { GetTextExtent( text ).x, -1 } )`: at least as wide as this text would be. */
  minWidthText?: string;
  disabled?: boolean;
  /** `Wrap( width )`, in pixels; -1 or absent never wraps. */
  wrap?: number;
  title?: string;
  /** `SetFont( KIUI::GetInfoFont( this ) )` or `KIUI::GetSmallInfoFont( this )`. */
  font?: 'info' | 'smallInfo';
  /** `.Italic()` on the font. */
  italic?: boolean;
  /** `wxST_ELLIPSIZE_END`: a label too long for its cell ends in "…". */
  ellipsize?: boolean;
}): JSX.Element {
  return (
    <span
      className={`ze-statictext${disabled ? ' disabled' : ''}${wrap && wrap > 0 ? ' wrapped' : ''}${font === 'info' ? ' info' : font === 'smallInfo' ? ' small-info' : ''}${italic ? ' italic' : ''}${ellipsize ? ' ellipsize' : ''}`}
      style={wrap && wrap > 0 ? { maxWidth: wrap } : undefined}
      title={title}
    >
      {label}
      {minWidthText !== undefined && (
        <span className="ze-statictext-minw" aria-hidden="true">
          {minWidthText}
        </span>
      )}
    </span>
  );
}

/**
 * `wxStaticBitmap`: an image. `bitmap` is the bundle `SetBitmap()` was given - a URL here, which
 * is what `KiBitmapBundle()` answers - or null for `wxNullBitmap`, which draws nothing but keeps
 * the stated `size`. `Enable( false )` draws it as GTK's insensitive image.
 */
export function StaticBitmap({
  bitmap,
  size,
  disabled,
  title,
}: {
  bitmap: string | null | undefined;
  /** The constructor's `wxSize( w, h )` / `SetMinSize`; absent, the bitmap's own. */
  size?: readonly [number, number];
  disabled?: boolean;
  /** `SetToolTip()`. */
  title?: string;
}): JSX.Element {
  const style = size ? { width: size[0], height: size[1] } : undefined;

  if (!bitmap) return <span className="ze-staticbitmap" style={style} title={title} />;

  return (
    <img
      className={`ze-staticbitmap${disabled ? ' disabled' : ''}`}
      src={bitmap}
      alt=""
      title={title}
      style={style}
    />
  );
}

/** `wxGauge( …, range, …, wxGA_HORIZONTAL )`: the GtkProgressBar the shell styles as `.ze-gauge`. */
export function Gauge({ value, range }: { value: number; range: number }): JSX.Element {
  return <progress className="ze-gauge" max={range} value={value} />;
}

let g_measureCtx: CanvasRenderingContext2D | null | undefined;

/**
 * `wxWindow::GetTextExtent( text ).x`: the text's width in the dialog font. Without a canvas (a
 * test DOM) it is an estimate of 7 px a character.
 */
export function GetTextExtent(aText: string): number {
  if (g_measureCtx === undefined) {
    try {
      g_measureCtx = document.createElement('canvas').getContext('2d');
    } catch {
      g_measureCtx = null;
    }
  }
  if (!g_measureCtx) return aText.length * 7;
  const app = document.querySelector('.ze-app') ?? document.body;
  g_measureCtx.font = getComputedStyle(app).font || '13px sans-serif';
  return Math.ceil(g_measureCtx.measureText(aText).width);
}

/**
 * `wxListCtrl( …, wxLC_REPORT | wxLC_NO_HEADER )`: rows of columns at the widths
 * `InsertColumn` / `SetColumnWidth` gave them. `onRightClick` is wxEVT_LIST_ITEM_RIGHT_CLICK.
 */
export function ListCtrl({
  rows,
  columnWidths,
  onRightClick,
  ariaLabel,
  headers,
  selection,
  onSelect,
  onKeyDown,
  selectedRows,
  onSelectRows,
  onActivate,
  boldRows,
}: {
  rows: readonly (readonly string[])[];
  columnWidths: readonly number[];
  onRightClick?: (aRow: number, aEvent: MouseEvent) => void;
  ariaLabel?: string;
  /** wxLC_REPORT without wxLC_NO_HEADER: the AppendColumn() titles. */
  headers?: readonly string[];
  /** wxLC_SINGLE_SEL: the selected row, -1 for none. */
  selection?: number;
  /** wxEVT_LIST_ITEM_SELECTED. */
  onSelect?: (aRow: number) => void;
  /** wxEVT_LIST_KEY_DOWN. */
  onKeyDown?: (aKey: string) => void;
  /** Without wxLC_SINGLE_SEL: the selected rows. */
  selectedRows?: readonly number[];
  /** A click's new selection: plain replaces, Ctrl toggles, Shift extends from the anchor. */
  onSelectRows?: (aRows: number[], aClicked: number) => void;
  /** wxEVT_LIST_ITEM_ACTIVATED: a double click. */
  onActivate?: (aRow: number) => void;
  /** `SetItemFont( row, font.Bold() )`: the rows drawn bold. */
  boldRows?: readonly number[];
}): JSX.Element {
  const columns = { gridTemplateColumns: columnWidths.map((w) => `${w}px`).join(' ') };
  const [anchor, setAnchor] = useState(-1);
  const isSelected = (i: number): boolean =>
    selectedRows ? selectedRows.includes(i) : i === selection;
  const click = (i: number, e: MouseEvent): void => {
    if (onSelectRows && selectedRows) {
      let next: number[];
      if (e.shiftKey && anchor >= 0) {
        const [a, b] = anchor < i ? [anchor, i] : [i, anchor];
        next = Array.from({ length: b - a + 1 }, (_, k) => a + k);
      } else if (e.ctrlKey)
        next = selectedRows.includes(i)
          ? selectedRows.filter((r) => r !== i)
          : [...selectedRows, i];
      else next = [i];
      if (!e.shiftKey) setAnchor(i);
      onSelectRows(next, i);
    }
    onSelect?.(i);
  };
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: the list window takes the focus, as wx's does
    <div
      className="ze-listctrl"
      role="list"
      aria-label={ariaLabel}
      tabIndex={onKeyDown ? 0 : undefined}
      onKeyDown={onKeyDown ? (e) => onKeyDown(e.key) : undefined}
    >
      {headers && (
        <div className="ze-listctrl-row ze-listctrl-header" style={columns}>
          {headers.map((h, c) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the column index is the header's identity
            <span key={c}>{h}</span>
          ))}
        </div>
      )}
      {rows.map((row, i) => (
        // A row is its index, as wxListCtrl items are.
        // biome-ignore lint/suspicious/noArrayIndexKey: InsertItem order is the row's identity
        <div
          key={i}
          role="listitem"
          aria-selected={selection === undefined && !selectedRows ? undefined : isSelected(i)}
          className={`ze-listctrl-row${isSelected(i) ? ' selected' : ''}${boldRows?.includes(i) ? ' bold' : ''}`}
          style={columns}
          onClick={onSelect || onSelectRows ? (e) => click(i, e) : undefined}
          onDoubleClick={onActivate ? () => onActivate(i) : undefined}
          onContextMenu={(e) => {
            if (!onRightClick) return;
            e.preventDefault();
            onRightClick(i, e);
          }}
        >
          {row.map((cell, c) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the column index is the cell's identity
            <span key={c}>{cell}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * A dialog's own `wxStatusBar` with `SetFieldsCount( n )` and `SetStatusWidths`: a width of -1
 * takes the rest, as wx's variable fields do.
 */
export function StatusBar({
  widths,
  texts,
}: {
  widths: readonly number[];
  texts: readonly string[];
}): JSX.Element {
  return (
    <div className="ze-wxstatusbar">
      {widths.map((w, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: SetFieldsCount order is the field's identity
        <span key={i} style={w < 0 ? { flex: -w } : { width: w, flex: '0 0 auto' }}>
          {texts[i] ?? ''}
        </span>
      ))}
    </div>
  );
}

/** `wxStaticLine`: a GtkSeparator, horizontal unless `vertical` (wxLI_VERTICAL). */
export function StaticLine({
  vertical,
  className,
}: {
  vertical?: boolean;
  className?: string;
}): JSX.Element {
  return (
    <div
      className={`ze-staticline${vertical ? ' vertical' : ''}${className ? ` ${className}` : ''}`}
    />
  );
}

/**
 * `wxPanel`: a child window that holds its own sizer. `border="simple"` is `wxBORDER_SIMPLE`, the
 * one-pixel frame wxFormBuilder puts around a COLOR_SWATCH (`m_panelBorderColor`), which the
 * swatch itself does not draw.
 */
export function Panel({
  border,
  title,
  background,
  children,
}: {
  border?: 'simple';
  /** `SetBackgroundColour( wxSystemSettings::GetColour( wxSYS_COLOUR_3DLIGHT ) )`. */
  background?: '3dlight';
  /** `SetToolTip()`. */
  title?: string;
  children?: ReactNode;
}): JSX.Element {
  return (
    <div
      className={`ze-panel${border === 'simple' ? ' border-simple' : ''}${background === '3dlight' ? ' bg-3dlight' : ''}`}
      title={title}
    >
      {children}
    </div>
  );
}

/** `wxHyperlinkCtrl`: a GtkLinkButton in the theme's link colour, on the dialog's own font. */
export function HyperlinkCtrl({
  label,
  onClick,
  disabled,
  title,
  className,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`ze-hyperlink${className ? ` ${className}` : ''}`}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/**
 * A wxCheckBox member as a `_base` takes it: its value, the enable its onUpdateUI handler (or
 * `Enable()`) gives it, and the change.
 */
export interface CHECK {
  value: boolean;
  enabled?: boolean;
  onChange: (aOn: boolean) => void;
}

/** A wxChoice member as a `_base` takes it: its selection, enable, and change. */
export interface CHOICE {
  value: number;
  enabled?: boolean;
  onChange: (aIndex: number) => void;
}
