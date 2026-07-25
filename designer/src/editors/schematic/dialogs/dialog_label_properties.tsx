/**
 * Label Properties. Counterpart: `eeschema/dialogs/dialog_label_properties.cpp`
 * over `dialog_label_properties_base.cpp`'s layout, control for control:
 *
 *   Label:  [ value ]                       <- combo for local/global labels
 *   [x] Multiple label input      Syntax help
 *   ┌ Fields ─────────────────────────────────────────────┐
 *   │ Name | Value | Show | Show Name | H Align | V Align │
 *   │ Italic | Bold                                       │
 *   │ [+] [↑] [↓]   [🗑]                                  │
 *   └─────────────────────────────────────────────────────┘
 *   ┌ Shape ───┐ ┌ Formatting ───────────────────────────┐
 *   │ ( ) Input│ │ Font:      [Default Font] | B I | ←→↓↑ [ ] Auto
 *   │ …        │ │ Text size: [   ] mm   Color: [swatch] │
 *   └──────────┘ └───────────────────────────────────────┘
 *                                        [ Cancel ] [ OK ]
 *
 * The grid column widths, the shown-column set ("0 1 2 3 4 5 6 7"), the
 * 22 px column-label band and the 100 px minimum grid height are the base
 * class's; the per-type show/hide rules (which value control, whether Shape
 * appears, which orientation icons the four buttons carry) are the derived
 * class's constructor.
 *
 * Left out deliberately: the font list (the browser build renders everything
 * with KiCad's own stroke font, so the choice is shown but not editable) and
 * the syntax-help window, which links to KiCad's documentation instead.
 */

import { useEffect, useRef, useState, type JSX } from 'react';
import { iuToMM, mmToIU } from '@ziroeda/common';
import {
  cleanLabelFields,
  type DirectiveShape,
  type EditedLabelField,
  type LabelShape,
  type LabelSpin,
} from '@ziroeda/eeschema';
import { toolbarIconUrl } from '../../../ui/toolbarIcons.js';
import type { ItemColor } from './dialog_line_properties.js';

/** A flag shape: a label's electrical one, or a directive label's outline. */
export type AnyLabelShape = LabelShape | DirectiveShape;

/** The label types this dialog serves (SCH_LABEL_T / GLOBAL / HIER / SHEET_PIN). */
export type LabelPropsKind =
  | 'label'
  | 'global_label'
  | 'hierarchical_label'
  | 'sheet_pin'
  | 'directive';

const TITLES: Record<LabelPropsKind, string> = {
  label: 'Label Properties',
  global_label: 'Global Label Properties',
  hierarchical_label: 'Hierarchical Label Properties',
  sheet_pin: 'Hierarchical Sheet Pin Properties',
  directive: 'Directive Label Properties',
};

/** The flag shapes, in the dialog's radio order. */
const SHAPES: { value: AnyLabelShape; label: string }[] = [
  { value: 'input', label: 'Input' },
  { value: 'output', label: 'Output' },
  { value: 'bidirectional', label: 'Bidirectional' },
  { value: 'tri_state', label: 'Tri-state' },
  { value: 'passive', label: 'Passive' },
];

/** The four orientation buttons: KiCad's label_align_* bitmaps, in m_spin order. */
const SPINS: { spin: LabelSpin; icon: string; title: string }[] = [
  { spin: 'right', icon: 'label_align_left', title: 'Align right' },
  { spin: 'left', icon: 'label_align_right', title: 'Align left' },
  { spin: 'up', icon: 'label_align_bottom', title: 'Align top' },
  { spin: 'bottom', icon: 'label_align_top', title: 'Align bottom' },
];

/** A directive label points its pin instead, so it uses the pinorient bitmaps. */
const DIRECTIVE_SPINS: { spin: LabelSpin; icon: string; title: string }[] = [
  { spin: 'right', icon: 'pinorient_down', title: 'Point down' },
  { spin: 'left', icon: 'pinorient_up', title: 'Point up' },
  { spin: 'up', icon: 'pinorient_right', title: 'Point right' },
  { spin: 'bottom', icon: 'pinorient_left', title: 'Point left' },
];

/** The directive label's flag shapes (F_DOT / F_ROUND / F_DIAMOND / F_RECTANGLE). */
const DIRECTIVE_SHAPES: { value: AnyLabelShape; label: string }[] = [
  { value: 'dot', label: 'Dot' },
  { value: 'round', label: 'Circle' },
  { value: 'diamond', label: 'Diamond' },
  { value: 'rectangle', label: 'Rectangle' },
];

/** WX_GRID column widths from the base class, for the eight shown columns. */
const COLUMNS: { key: FieldCol; label: string; width: number }[] = [
  { key: 'name', label: 'Name', width: 72 },
  { key: 'value', label: 'Value', width: 84 },
  { key: 'show', label: 'Show', width: 48 },
  { key: 'showName', label: 'Show Name', width: 48 },
  { key: 'hAlign', label: 'H Align', width: 70 },
  { key: 'vAlign', label: 'V Align', width: 70 },
  { key: 'italic', label: 'Italic', width: 48 },
  { key: 'bold', label: 'Bold', width: 48 },
];

type FieldCol = 'name' | 'value' | 'show' | 'showName' | 'hAlign' | 'vAlign' | 'italic' | 'bold';

const H_ALIGNS = ['Left', 'Center', 'Right'];
const V_ALIGNS = ['Top', 'Center', 'Bottom'];

/** Everything the dialog hands back (DIALOG_LABEL_PROPERTIES's transfer-out). */
export interface LabelPropsResult {
  /** One entry per label: several when "Multiple label input" is used. */
  texts: string[];
  shape: AnyLabelShape;
  bold: boolean;
  italic: boolean;
  sizeIU: number;
  color?: ItemColor;
  spin: LabelSpin;
  autoRotate: boolean;
  fields: EditedLabelField[];
}

export interface LabelPropsInitial {
  text: string;
  shape: AnyLabelShape;
  bold: boolean;
  italic: boolean;
  sizeIU: number;
  color?: ItemColor;
  spin: LabelSpin;
  autoRotate: boolean;
  fields: readonly EditedLabelField[];
}

interface Props {
  kind: LabelPropsKind;
  /** Placing a new label (the "Multiple label input" box only appears then). */
  isNew: boolean;
  initial: LabelPropsInitial;
  /** Existing label names of the same type, offered by the combo. */
  suggestions?: readonly string[];
  onOk: (result: LabelPropsResult) => void;
  onCancel: () => void;
}

const justifyOf = (f: EditedLabelField, axis: 'h' | 'v'): string => {
  const j = f.effects?.justify ?? [];
  if (axis === 'h') return j.includes('left') ? 'Left' : j.includes('right') ? 'Right' : 'Center';
  return j.includes('top') ? 'Top' : j.includes('bottom') ? 'Bottom' : 'Center';
};

const withJustify = (f: EditedLabelField, axis: 'h' | 'v', value: string): EditedLabelField => {
  const keep = (f.effects?.justify ?? []).filter((t) =>
    axis === 'h' ? !['left', 'right'].includes(t) : !['top', 'bottom'].includes(t),
  );
  const token = value.toLowerCase();
  const justify = token === 'center' ? keep : [...keep, token];
  return { ...f, effects: { hidden: false, ...f.effects, justify } };
};

const toHex = (c: ItemColor): string =>
  `#${[c[0], c[1], c[2]].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (h: string): ItemColor => [
  Number.parseInt(h.slice(1, 3), 16),
  Number.parseInt(h.slice(3, 5), 16),
  Number.parseInt(h.slice(5, 7), 16),
  1,
];

/** Text size shown in mm, trimmed the way KiCad's unit binder prints it. */
const mmText = (iu: number): string =>
  String(Number(iuToMM(iu).toFixed(4)))
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');

function IconButton({
  icon,
  title,
  checked,
  onClick,
  disabled,
}: {
  icon: string;
  title: string;
  checked?: boolean;
  onClick: () => void;
  disabled?: boolean;
}): JSX.Element {
  const url = toolbarIconUrl(icon);
  return (
    <button
      type="button"
      className={`ze-lp-iconbtn${checked ? ' checked' : ''}`}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {url ? <img src={url} alt={title} /> : title}
    </button>
  );
}

export function DialogLabelProperties({
  kind,
  isNew,
  initial,
  suggestions,
  onOk,
  onCancel,
}: Props): JSX.Element {
  const [text, setText] = useState(initial.text);
  const [multi, setMulti] = useState(false);
  const [shape, setShape] = useState<AnyLabelShape>(initial.shape);
  const [bold, setBold] = useState(initial.bold);
  const [italic, setItalic] = useState(initial.italic);
  const [spin, setSpin] = useState<LabelSpin>(initial.spin);
  const [autoRotate, setAutoRotate] = useState(initial.autoRotate);
  const [sizeText, setSizeText] = useState(mmText(initial.sizeIU));
  const [color, setColor] = useState<ItemColor | undefined>(initial.color);
  const [fields, setFields] = useState<EditedLabelField[]>([...initial.fields]);
  const [selRow, setSelRow] = useState<number | null>(null);
  const valueRef = useRef<HTMLInputElement>(null);
  const multiRef = useRef<HTMLTextAreaElement>(null);

  // SetInitialFocus( m_valueCombo / m_valueSingleLine ).
  useEffect(() => {
    valueRef.current?.focus();
    valueRef.current?.select();
  }, []);

  // Global, hierarchical labels and sheet pins have a flag shape; only the
  // first two can auto-rotate on placement (AutoRotateOnPlacementSupported).
  const isDirective = kind === 'directive';
  const hasShape =
    kind === 'global_label' || kind === 'hierarchical_label' || kind === 'sheet_pin' || isDirective;
  const hasAutoRotate = kind === 'global_label' || kind === 'hierarchical_label';
  // The combo (with the existing labels) is used for local and global labels;
  // hierarchical labels and sheet pins get the plain single-line entry.
  const isCombo = kind === 'label' || kind === 'global_label';
  // A sheet pin is owned by its sheet and carries no fields of its own here,
  // so the Fields grid, which edits a label's `(property …)` children, has
  // nothing to show for it.
  const hasFields = kind !== 'sheet_pin';
  // A directive label has no text of its own, its netclass lives in a field,
  // so the text entry, the multi-label box and the syntax help are all hidden,
  // the shape box carries the flag shapes and "Text size" becomes "Pin length".
  const hasText = !isDirective;

  const sizeIU = (): number => {
    const n = Number(sizeText.trim());
    return Number.isFinite(n) && n > 0 ? Math.round(mmToIU(n)) : initial.sizeIU;
  };

  const submit = (): void => {
    const source = multi ? (multiRef.current?.value ?? '') : text;
    const texts = (multi ? source.split('\n') : [source]).map((t) => t.trim()).filter(Boolean);
    // A directive label carries no text of its own (its netclass is a field).
    if (texts.length === 0 && !isDirective) return; // KiCad refuses an empty label
    onOk({
      texts,
      shape,
      bold,
      italic,
      sizeIU: sizeIU(),
      ...(color ? { color } : {}),
      spin,
      autoRotate,
      fields: cleanLabelFields(fields),
    });
  };

  const onKey = (e: React.KeyboardEvent): void => {
    e.stopPropagation();
    if (e.key === 'Enter' && !multi) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  const patchField = (i: number, next: EditedLabelField): void =>
    setFields((fs) => fs.map((f, j) => (i === j ? next : f)));

  const moveRow = (delta: number): void => {
    setFields((fs) => {
      if (selRow === null) return fs;
      const to = selRow + delta;
      if (to < 0 || to >= fs.length) return fs;
      const out = [...fs];
      [out[selRow], out[to]] = [out[to]!, out[selRow]!];
      return out;
    });
    setSelRow((r) => (r === null ? r : Math.max(0, Math.min(fields.length - 1, r + delta))));
  };

  const addField = (): void => {
    setFields((fs) => [
      ...fs,
      { key: '', value: '', angle: 0, effects: { hidden: false }, source: undefined },
    ]);
    setSelRow(fields.length);
  };

  const deleteField = (): void => {
    if (selRow === null) return;
    setFields((fs) => fs.filter((_, i) => i !== selRow));
    setSelRow(null);
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onCancel}>
      <div className="ze-modal ze-label-props" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ze-modal-header">
          {TITLES[kind]}
          <span className="x" title="Cancel" onClick={onCancel}>
            ✕
          </span>
        </div>

        <div className="ze-modal-body ze-lp-body">
          {/* m_textEntrySizer: the label caption and its value control. */}
          {hasText && (
            <div className="ze-lp-entry">
              <span className="ze-lp-caption">Label:</span>
              {multi ? (
                <textarea
                  ref={multiRef}
                  className="ze-lp-value ze-lp-multiline"
                  rows={4}
                  defaultValue={text}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Escape') onCancel();
                  }}
                />
              ) : (
                <input
                  ref={valueRef}
                  className="ze-lp-value"
                  value={text}
                  title="Enter the text to be used within the schematic"
                  list={isCombo && suggestions?.length ? 'ze-label-suggestions' : undefined}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={onKey}
                />
              )}
              {isCombo && suggestions && suggestions.length > 0 && (
                <datalist id="ze-label-suggestions">
                  {suggestions.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              )}
            </div>
          )}

          {hasText && (
            <div className="ze-lp-entry-row2">
              {isNew ? (
                <label className="ze-lp-check">
                  <input
                    type="checkbox"
                    checked={multi}
                    onChange={(e) => setMulti(e.target.checked)}
                  />
                  Multiple label input
                </label>
              ) : (
                <span />
              )}
              <a
                className="ze-lp-syntax"
                href="https://docs.kicad.org/GetStarted#labels"
                target="_blank"
                rel="noreferrer"
                title="Show syntax help window"
              >
                Syntax help
              </a>
            </div>
          )}

          {/* sbFields: the label's own fields, in the symbol dialog's grid. */}
          {hasFields && (
            <fieldset className="ze-lp-fields">
              <legend>Fields</legend>
              <div className="ze-lp-grid-wrap">
                <table className="ze-lp-grid">
                  <thead>
                    <tr>
                      {COLUMNS.map((c) => (
                        <th key={c.key} style={{ width: c.width }}>
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((f, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
                      <tr
                        key={i}
                        className={selRow === i ? 'sel' : ''}
                        onMouseDown={() => setSelRow(i)}
                      >
                        <td>
                          <input
                            value={f.key}
                            onChange={(e) => patchField(i, { ...f, key: e.target.value })}
                            onKeyDown={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td>
                          <input
                            value={f.value}
                            onChange={(e) => patchField(i, { ...f, value: e.target.value })}
                            onKeyDown={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td className="c">
                          <input
                            type="checkbox"
                            checked={!f.effects?.hidden}
                            onChange={(e) =>
                              patchField(i, {
                                ...f,
                                effects: { ...f.effects, hidden: !e.target.checked },
                              })
                            }
                          />
                        </td>
                        <td className="c">
                          <input
                            type="checkbox"
                            checked={!!f.nameShown}
                            onChange={(e) => patchField(i, { ...f, nameShown: e.target.checked })}
                          />
                        </td>
                        <td>
                          <select
                            value={justifyOf(f, 'h')}
                            onChange={(e) => patchField(i, withJustify(f, 'h', e.target.value))}
                          >
                            {H_ALIGNS.map((a) => (
                              <option key={a}>{a}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            value={justifyOf(f, 'v')}
                            onChange={(e) => patchField(i, withJustify(f, 'v', e.target.value))}
                          >
                            {V_ALIGNS.map((a) => (
                              <option key={a}>{a}</option>
                            ))}
                          </select>
                        </td>
                        <td className="c">
                          <input
                            type="checkbox"
                            checked={!!f.effects?.italic}
                            onChange={(e) =>
                              patchField(i, {
                                ...f,
                                effects: { hidden: false, ...f.effects, italic: e.target.checked },
                              })
                            }
                          />
                        </td>
                        <td className="c">
                          <input
                            type="checkbox"
                            checked={!!f.effects?.bold}
                            onChange={(e) =>
                              patchField(i, {
                                ...f,
                                effects: { hidden: false, ...f.effects, bold: e.target.checked },
                              })
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="ze-lp-fieldbtns">
                <IconButton icon="small_plus" title="Add field" onClick={addField} />
                <IconButton
                  icon="small_up"
                  title="Move up"
                  disabled={selRow === null || selRow === 0}
                  onClick={() => moveRow(-1)}
                />
                <IconButton
                  icon="small_down"
                  title="Move down"
                  disabled={selRow === null || selRow === fields.length - 1}
                  onClick={() => moveRow(1)}
                />
                <span className="ze-lp-gap" />
                <IconButton
                  icon="small_trash"
                  title="Delete field"
                  disabled={selRow === null}
                  onClick={deleteField}
                />
              </div>
            </fieldset>
          )}

          {/* optionsSizer: Shape beside Formatting. */}
          <div className="ze-lp-options">
            {hasShape && (
              <fieldset className="ze-lp-shape">
                <legend>Shape</legend>
                {(isDirective ? DIRECTIVE_SHAPES : SHAPES).map((s) => (
                  <label key={s.value}>
                    <input
                      type="radio"
                      name="ze-lp-shape"
                      checked={shape === s.value}
                      onChange={() => setShape(s.value)}
                    />
                    {s.label}
                  </label>
                ))}
              </fieldset>
            )}

            <fieldset className="ze-lp-formatting">
              <legend>Formatting</legend>
              <div className="ze-lp-fmt-grid">
                <span className="ze-lp-fmt-label">{isDirective ? 'Orientation:' : 'Font:'}</span>
                {isDirective ? (
                  <span />
                ) : (
                  <select
                    className="ze-lp-font"
                    disabled
                    title="The browser build draws all text with KiCad's own font."
                    value="Default Font"
                    onChange={() => undefined}
                  >
                    <option>Default Font</option>
                    <option>KiCad Font</option>
                  </select>
                )}
                <div className="ze-lp-iconbar">
                  <span className="ze-lp-sep" />
                  {!isDirective && (
                    <>
                      <IconButton
                        icon="text_bold"
                        title="Bold"
                        checked={bold}
                        onClick={() => setBold(!bold)}
                      />
                      <IconButton
                        icon="text_italic"
                        title="Italic"
                        checked={italic}
                        onClick={() => setItalic(!italic)}
                      />
                      <span className="ze-lp-sep" />
                    </>
                  )}
                  {(isDirective ? DIRECTIVE_SPINS : SPINS).map((s) => (
                    <IconButton
                      key={s.spin}
                      icon={s.icon}
                      title={s.title}
                      checked={spin === s.spin}
                      onClick={() => setSpin(s.spin)}
                    />
                  ))}
                  {hasAutoRotate && (
                    <label className="ze-lp-check ze-lp-auto">
                      <input
                        type="checkbox"
                        checked={autoRotate}
                        onChange={(e) => setAutoRotate(e.target.checked)}
                      />
                      Auto
                    </label>
                  )}
                  <span className="ze-lp-sep" />
                </div>

                <span className="ze-lp-fmt-label">
                  {isDirective ? 'Pin length:' : 'Text size:'}
                </span>
                <div className="ze-lp-sizerow">
                  <input
                    className="ze-lp-size"
                    value={sizeText}
                    onChange={(e) => setSizeText(e.target.value)}
                    onKeyDown={onKey}
                  />
                  <span className="ze-lp-units">mm</span>
                  <span className="ze-lp-colorlabel">Color:</span>
                  <span className="ze-lp-swatch-frame">
                    <input
                      type="color"
                      className="ze-lp-swatch"
                      title="Text color"
                      value={color ? toHex(color) : '#ffffff'}
                      onChange={(e) => setColor(fromHex(e.target.value))}
                    />
                  </span>
                  <button
                    type="button"
                    className="ze-btn ze-lp-clearcolor"
                    title="Clear color to use Schematic Editor colors."
                    disabled={!color}
                    onClick={() => setColor(undefined)}
                  >
                    Clear
                  </button>
                </div>
              </div>
            </fieldset>
          </div>
        </div>

        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="ze-btn primary" onClick={submit}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
