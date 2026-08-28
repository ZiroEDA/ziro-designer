// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `APPEARANCE_CONTROLS` and `PANEL_SELECTION_FILTER`: one widget each, two
 * frames each.
 *
 * The bug this pins is the one this codebase keeps producing — right in the PCB
 * editor, wrong in the footprint editor. So every structural fact is asserted
 * **twice, per frame, against the rendered DOM of the same component**, and the
 * two renders differ only in the props the frame passes. A test that read the
 * source of one editor could not have caught any of it: the footprint editor's
 * Appearance panel had no tabs, no eye toggles, no Objects rows, no Layer
 * Display Options, no presets, no viewports and no Selection Filter, and every
 * one of those was present and correct in `PcbEditor.tsx`.
 *
 * Counterparts: `pcbnew/widgets/appearance_controls.cpp` (`:583-584` for the
 * removed page, `:2436` for the trimmed Objects rows, `:1859-1893` for the
 * layer rows) and `pcbnew/widgets/panel_selection_filter.cpp` (`:121-146`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import {
  AppearanceControls,
  appearanceTabs,
  type AppearanceControlsProps,
} from '@ziroeda/designer/src/widgets/appearance_controls.js';
import {
  appearanceObjectRows,
  DEFAULT_OBJECTS,
  DEFAULT_OPACITY,
  FP_EDITOR_OBJECT_KEYS,
  OBJECT_ROWS,
} from '@ziroeda/designer/src/widgets/appearance_objects.js';
import {
  DEFAULT_SELECTION_FILTER_OPTIONS,
  SELECTION_FILTER_ALL_KEYS,
  SELECTION_FILTER_ITEMS,
  SelectionFilterPanel,
  selectionFilterAll,
  toggleSelectionFilterAll,
} from '@ziroeda/designer/src/widgets/panel_selection_filter.js';
import { appearanceLayerRows } from '@ziroeda/designer/src/widgets/appearance_layers.js';
import {
  presetComboItems,
  viewportComboItems,
} from '@ziroeda/designer/src/widgets/appearance_presets.js';
import {
  FOOTPRINT_COPPER_STACK,
  FOOTPRINT_LAYERS,
} from '@ziroeda/designer/src/editors/footprint/footprintBoard.js';
import { GetLayerName } from '@ziroeda/pcbnew/src/layer_ids.js';

afterEach(cleanup);

// ---------------------------------------------------------------------------
// The two frames, as the props they pass. Nothing else differs.
// ---------------------------------------------------------------------------

/** A four-layer board, so the PCB frame's copper stack is not the fp frame's. */
const PCB_LAYERS = ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu', 'F.SilkS', 'B.SilkS', 'Edge.Cuts', 'F.Fab'];
const PCB_COPPER = ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu'];
const FP_LAYER_NAMES = FOOTPRINT_LAYERS.map((l) => l.name);

const noop = (): void => {};

function baseProps(): AppearanceControlsProps {
  return {
    tab: 'Layers',
    onTab: noop,
    layerRows: [],
    layerName: (n) => n,
    layerColor: () => 'rgb(1, 2, 3)',
    activeLayer: 'F.Cu',
    onActiveLayer: noop,
    visibleLayers: new Set<string>(),
    onToggleLayer: noop,
    objects: DEFAULT_OBJECTS,
    onToggleObject: noop,
    objectColor: () => undefined,
    opacity: DEFAULT_OPACITY,
    onOpacity: noop,
    contrast: 'normal',
    onContrast: noop,
    flipBoard: false,
    onFlipBoard: noop,
    layerOptionsOpen: false,
    onLayerOptionsOpen: noop,
    presetItems: presetComboItems(),
    preset: '---',
    onPreset: noop,
    viewportItems: viewportComboItems(),
    viewport: '---',
    onViewport: noop,
  };
}

/** `new APPEARANCE_CONTROLS( this, GetCanvas() )` — PCB_EDIT_FRAME. */
function pcbProps(over: Partial<AppearanceControlsProps> = {}): AppearanceControlsProps {
  return {
    ...baseProps(),
    layerRows: appearanceLayerRows(PCB_COPPER, PCB_LAYERS),
    visibleLayers: new Set(PCB_LAYERS),
    nets: {
      nets: [{ code: 1, name: 'GND', color: undefined, visible: true }],
      onNetColor: noop,
      onNetVisibility: noop,
      netclasses: [{ name: 'Default', color: undefined, visible: true }],
      onNetclassColor: noop,
      onNetclassVisibility: noop,
      onConfigureNetclasses: noop,
      netColorMode: 'ratsnest',
      onNetColorMode: noop,
      ratsnestMode: 'all',
      onRatsnestMode: noop,
      optionsOpen: false,
      onOptionsOpen: noop,
    },
    ...over,
  };
}

/** `new APPEARANCE_CONTROLS( this, GetCanvas(), true )` — FOOTPRINT_EDIT_FRAME. */
function fpProps(over: Partial<AppearanceControlsProps> = {}): AppearanceControlsProps {
  return {
    ...baseProps(),
    fpEditor: true,
    layerRows: appearanceLayerRows(FOOTPRINT_COPPER_STACK, FP_LAYER_NAMES),
    layerName: (n) => GetLayerName(FOOTPRINT_LAYERS, n),
    visibleLayers: new Set(FP_LAYER_NAMES),
    activeLayer: 'F.SilkS',
    ...over,
  };
}

const tabNames = (el: HTMLElement): string[] =>
  Array.from(el.querySelectorAll('.ze-nb-tabs button')).map((b) => b.textContent ?? '');

const rowLabels = (el: HTMLElement, cls: string): string[] =>
  Array.from(el.querySelectorAll(cls)).map(
    (r) => r.querySelector('span:last-of-type')?.textContent ?? '',
  );

// ---------------------------------------------------------------------------
// 1. The tab set.
// ---------------------------------------------------------------------------

describe('the notebook pages each frame gets', () => {
  /**
   * `APPEARANCE_CONTROLS_BASE` adds Layers, Objects and Nets in that order
   * (`appearance_controls_base.cpp:33, :46, :162`), and the constructor then
   * runs `if( m_isFpEditor ) m_notebook->RemovePage( 2 )` (`:583-584`).
   */
  it('pcbnew shows all three', () => {
    const { container } = render(<AppearanceControls {...pcbProps()} />);
    expect(tabNames(container)).toEqual(['Layers', 'Objects', 'Nets']);
  });

  it('the footprint editor shows Layers and Objects, and no Nets page', () => {
    const { container } = render(<AppearanceControls {...fpProps()} />);
    expect(tabNames(container)).toEqual(['Layers', 'Objects']);
  });

  it('is the same rule read directly', () => {
    expect(appearanceTabs(false)).toEqual(['Layers', 'Objects', 'Nets']);
    expect(appearanceTabs(true)).toEqual(['Layers', 'Objects']);
  });

  /** A removed page cannot be the current one; upstream this cannot arise. */
  it('the footprint editor cannot land on the page it does not have', () => {
    const { container } = render(<AppearanceControls {...fpProps({ tab: 'Nets' })} />);
    expect(container.querySelector('.ze-nets-box')).toBeNull();
    expect(container.querySelectorAll('.ze-layer-row').length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. The layer rows: same widget, each frame's own set.
// ---------------------------------------------------------------------------

describe('the Layers page, per frame, out of the one widget', () => {
  it('pcbnew lists this board’s copper stack, then non_cu_seq', () => {
    const { container } = render(<AppearanceControls {...pcbProps()} />);
    expect(rowLabels(container, '.ze-layer-row')).toEqual([
      'F.Cu',
      'In1.Cu',
      'In2.Cu',
      'B.Cu',
      'F.SilkS',
      'B.SilkS',
      'Edge.Cuts',
      'F.Fab',
    ]);
  });

  /**
   * The footprint editor's board is FOOTPRINT_EDIT_FRAME's own
   * (`updateEnabledLayers`): three copper rows and every technical, user and
   * User.1-4 layer, under `board->GetLayerName`'s spelling.
   */
  it('the footprint editor lists its own board, under KiCad’s names', () => {
    const { container } = render(<AppearanceControls {...fpProps()} />);
    const labels = rowLabels(container, '.ze-layer-row');
    expect(labels.slice(0, 5)).toEqual(['F.Cu', 'In1.Cu', 'B.Cu', 'F.Adhesive', 'B.Adhesive']);
    expect(labels).toContain('F.Silkscreen');
    expect(labels).toContain('User.Drawings');
    expect(labels).toContain('F.Courtyard');
    expect(labels.at(-1)).toBe('User.4');
    expect(labels).toHaveLength(25);
  });

  /** `INDICATOR_ICON` on the active row, in both frames. */
  it.each([
    ['pcbnew', pcbProps({ activeLayer: 'In1.Cu' }), 'In1.Cu'],
    ['the footprint editor', fpProps({ activeLayer: 'F.SilkS' }), 'F.Silkscreen'],
  ] as const)('%s marks the active layer', (_name, props, label) => {
    const { container } = render(<AppearanceControls {...props} />);
    const marked = Array.from(container.querySelectorAll('.ze-layer-row.active'));
    expect(marked).toHaveLength(1);
    expect(marked[0]?.textContent).toBe(label);
    expect(marked[0]?.querySelector('.ze-layer-indicator.on')).not.toBeNull();
  });

  /** `onLayerLeftClick` — clicking the row makes it the active layer. */
  it.each([
    ['pcbnew', pcbProps, 'In1.Cu', 'In1.Cu'],
    ['the footprint editor', fpProps, 'F.Courtyard', 'F.CrtYd'],
  ] as const)('%s selects a layer by clicking its row', (_name, make, label, layer) => {
    const onActiveLayer = vi.fn();
    const { container } = render(<AppearanceControls {...make({ onActiveLayer })} />);
    const row = Array.from(container.querySelectorAll('.ze-layer-row')).find(
      (r) => r.textContent === label,
    );
    expect(row, `no row labelled ${label}`).toBeDefined();
    fireEvent.click(row as HTMLElement);
    expect(onActiveLayer).toHaveBeenCalledWith(layer);
  });
});

// ---------------------------------------------------------------------------
// 3. The eye toggle. The footprint editor had NO way to hide a layer.
// ---------------------------------------------------------------------------

describe('the visibility toggle every row carries', () => {
  it.each([
    ['pcbnew', pcbProps, 'F.Cu', 8],
    ['the footprint editor', fpProps, 'F.Cu', 25],
  ] as const)('%s draws one eye per layer row', (_n, make, _first, count) => {
    const { container } = render(<AppearanceControls {...make()} />);
    const rows = Array.from(container.querySelectorAll('.ze-layer-row'));
    expect(rows).toHaveLength(count);
    for (const r of rows) expect(r.querySelector('.ze-eye-btn')).not.toBeNull();
  });

  it.each([
    ['pcbnew', pcbProps],
    ['the footprint editor', fpProps],
  ] as const)('%s toggles the layer, not the selection, when the eye is hit', (_n, make) => {
    const onToggleLayer = vi.fn();
    const onActiveLayer = vi.fn();
    const { container } = render(
      <AppearanceControls {...make({ onToggleLayer, onActiveLayer })} />,
    );
    const eye = container.querySelector('.ze-layer-row .ze-eye-btn') as HTMLElement;
    fireEvent.click(eye);
    expect(onToggleLayer).toHaveBeenCalledWith('F.Cu');
    // stopPropagation: the row's own click must not fire. Upstream the toggle
    // is a BITMAP_TOGGLE, a child window that consumes the click.
    expect(onActiveLayer).not.toHaveBeenCalled();
  });

  /** A hidden layer's eye is the struck-through bitmap, not the open one. */
  it.each([
    ['pcbnew', pcbProps],
    ['the footprint editor', fpProps],
  ] as const)('%s draws the hidden state when the layer is not visible', (_n, make) => {
    const { container } = render(
      <AppearanceControls {...make({ visibleLayers: new Set<string>() })} />,
    );
    const eyes = Array.from(container.querySelectorAll('.ze-layer-row .ze-eye'));
    expect(eyes.length).toBeGreaterThan(0);
    for (const e of eyes) expect(e.querySelector('line')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. The Objects page: s_objectSettings, trimmed by s_allowedInFpEditor.
// ---------------------------------------------------------------------------

describe('the Objects page, per frame', () => {
  const objectLabels = (el: HTMLElement): string[] =>
    Array.from(el.querySelectorAll('.ze-obj-label')).map((s) => s.textContent ?? '');

  /**
   * All twenty-three rows, spelled out rather than mapped off `OBJECT_ROWS` —
   * an expectation computed by calling the code under test cannot fail when
   * that table is wrong.
   */
  it('pcbnew draws every s_objectSettings row', () => {
    const { container } = render(<AppearanceControls {...pcbProps({ tab: 'Objects' })} />);
    expect(objectLabels(container)).toEqual([
      'Tracks',
      'Vias',
      'Pads',
      'Zones',
      'Filled Shapes',
      'Images',
      'Footprints Front',
      'Footprints Back',
      'Values',
      'References',
      'Footprint Text',
      'Ratsnest',
      'DRC Warnings',
      'DRC Errors',
      'DRC Exclusions',
      'Anchors',
      'Points',
      'Locked Item Shadow',
      'Colliding Courtyards',
      'Board Area Shadow',
      'Drawing Sheet',
      'Grid',
    ]);
  });

  /**
   * `if( m_isFpEditor && !s_allowedInFpEditor.count( s_setting.id ) ) continue;`
   * — eleven ids, and a spacer's id is -1, so the separators go too.
   */
  it('the footprint editor draws only s_allowedInFpEditor, and no separators', () => {
    const { container } = render(<AppearanceControls {...fpProps({ tab: 'Objects' })} />);
    expect(objectLabels(container)).toEqual([
      'Tracks',
      'Vias',
      'Pads',
      'Zones',
      'Filled Shapes',
      'Images',
      'Values',
      'References',
      'Footprint Text',
      'Points',
      'Grid',
    ]);
    expect(container.querySelectorAll('.ze-object-sep')).toHaveLength(0);
  });

  it('and pcbnew keeps the rows the footprint editor drops', () => {
    const { container } = render(<AppearanceControls {...pcbProps({ tab: 'Objects' })} />);
    for (const label of ['Footprints Front', 'Ratsnest', 'DRC Errors', 'Drawing Sheet']) {
      expect(objectLabels(container)).toContain(label);
    }
    expect(container.querySelectorAll('.ze-object-sep')).toHaveLength(3);
  });

  it('is the same rule read directly', () => {
    expect(appearanceObjectRows(false)).toEqual(OBJECT_ROWS);
    expect(appearanceObjectRows(true).map((r) => (r === 'sep' ? 'sep' : r.key))).toEqual([
      'tracks',
      'vias',
      'pads',
      'zones',
      'filledShapes',
      'images',
      'fpValues',
      'fpReferences',
      'fpText',
      'points',
      'grid',
    ]);
    expect(FP_EDITOR_OBJECT_KEYS.size).toBe(11);
  });

  /** `can_control_visibility = false` on Filled Shapes: a slider and no eye. */
  it.each([
    ['pcbnew', pcbProps],
    ['the footprint editor', fpProps],
  ] as const)('%s gives Filled Shapes a slider and no eye', (_n, make) => {
    const { container } = render(<AppearanceControls {...make({ tab: 'Objects' })} />);
    const row = Array.from(container.querySelectorAll('.ze-object-row')).find(
      (r) => r.querySelector('.ze-obj-label')?.textContent === 'Filled Shapes',
    ) as HTMLElement;
    expect(row).toBeDefined();
    expect(row.querySelector('.ze-eye-btn')).toBeNull();
    expect(row.querySelector('input[type="range"]')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. Layer Display Options, presets and viewports: both frames.
// ---------------------------------------------------------------------------

describe('the collapsible Layer Display Options', () => {
  it.each([
    ['pcbnew', pcbProps],
    ['the footprint editor', fpProps],
  ] as const)('%s carries the pane, collapsed', (_n, make) => {
    const { container } = render(<AppearanceControls {...make()} />);
    const toggle = container.querySelector('.ze-collapse-toggle') as HTMLElement;
    expect(toggle.textContent).toBe('Layer Display Options');
    expect(container.querySelector('.ze-collapse-body')).toBeNull();
  });

  it.each([
    ['pcbnew', pcbProps],
    ['the footprint editor', fpProps],
  ] as const)('%s expands to the three modes and the flip box', (_n, make) => {
    const { container } = render(<AppearanceControls {...make({ layerOptionsOpen: true })} />);
    const body = container.querySelector('.ze-collapse-body') as HTMLElement;
    expect(within(body).getByText('Inactive layers (H):')).toBeTruthy();
    for (const label of ['Normal', 'Dim', 'Hide', 'Flip board view']) {
      expect(body.textContent).toContain(label);
    }
    expect(body.querySelectorAll('input[type="radio"]')).toHaveLength(3);
    expect(body.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
  });
});

describe('the presets and viewports combos', () => {
  /**
   * `rebuildLayerPresetsWidget` and `rebuildViewportsWidget` are called from the
   * one constructor with no `m_isFpEditor` branch, and both combos live on the
   * PANEL rather than on a page (`appearance_controls_base.cpp:140-186`) — so
   * the footprint editor gets them too. It had neither.
   */
  it.each([
    ['pcbnew', pcbProps],
    ['the footprint editor', fpProps],
  ] as const)('%s shows both, labelled with their hotkeys', (_n, make) => {
    const { container, getByLabelText } = render(<AppearanceControls {...make()} />);
    const bottom = container.querySelector('.ze-appearance-bottom') as HTMLElement;
    expect(bottom.textContent).toContain('Presets (Ctrl+Tab):');
    expect(bottom.textContent).toContain('Viewports (Shift+Tab):');
    expect(getByLabelText('Presets')).toBeTruthy();
    expect(getByLabelText('Viewports')).toBeTruthy();
  });

  it.each([
    ['pcbnew', pcbProps],
    ['the footprint editor', fpProps],
  ] as const)('%s lists the eight built-in presets alphabetically', (_n, make) => {
    const { getByLabelText } = render(<AppearanceControls {...make()} />);
    const options = Array.from((getByLabelText('Presets') as HTMLSelectElement).options).map(
      (o) => o.text,
    );
    expect(options).toEqual([
      'All Copper Layers',
      'All Layers',
      'Back Assembly View',
      'Back Layers',
      'Front Assembly View',
      'Front Layers',
      'Inner Copper Layers',
      'No Layers',
      '---',
      'Save preset...',
      'Delete preset...',
    ]);
  });

  it.each([
    ['pcbnew', pcbProps],
    ['the footprint editor', fpProps],
  ] as const)('%s opens its viewports combo on the separator', (_n, make) => {
    const { getByLabelText } = render(<AppearanceControls {...make()} />);
    const sel = getByLabelText('Viewports') as HTMLSelectElement;
    expect(Array.from(sel.options).map((o) => o.text)).toEqual([
      '---',
      'Save viewport...',
      'Delete viewport...',
    ]);
    expect(sel.value).toBe('---');
  });
});

// ---------------------------------------------------------------------------
// 6. The Nets page belongs to pcbnew alone.
// ---------------------------------------------------------------------------

describe('the Nets page', () => {
  it('pcbnew draws the nets and netclasses boxes', () => {
    const { container } = render(<AppearanceControls {...pcbProps({ tab: 'Nets' })} />);
    const boxes = Array.from(container.querySelectorAll('.ze-nets-box'));
    expect(boxes).toHaveLength(2);
    expect(boxes[0]?.textContent).toContain('Nets');
    expect(boxes[1]?.textContent).toContain('Net Classes');
  });

  it('and its Net Display Options pane, which the Layers page does not carry', () => {
    const { container } = render(
      <AppearanceControls
        {...pcbProps({ tab: 'Nets', nets: { ...pcbProps().nets!, optionsOpen: true } })}
      />,
    );
    const toggle = container.querySelector('.ze-collapse-toggle') as HTMLElement;
    expect(toggle.textContent).toBe('Net Display Options');
    const body = container.querySelector('.ze-collapse-body') as HTMLElement;
    expect(body.textContent).toContain('Net colors:');
    expect(body.textContent).toContain('Ratsnest display:');
    expect(body.querySelectorAll('input[type="radio"]')).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// 7. PANEL_SELECTION_FILTER: identical in both frames, and absent from ours.
// ---------------------------------------------------------------------------

describe('the Selection Filter panel', () => {
  /**
   * The wxGridBagSizer's twelve category boxes read row-major, plus "All items"
   * at (0,0) (`panel_selection_filter_base.cpp:21-71`). Both frames construct
   * the identical widget — there is no `aFpEditor` here at all — and ours
   * existed only in the PCB editor.
   */
  it('lists All items then the twelve categories, in grid order', () => {
    const { container } = render(
      <SelectionFilterPanel filter={DEFAULT_SELECTION_FILTER_OPTIONS} onChange={noop} />,
    );
    expect(Array.from(container.querySelectorAll('label')).map((l) => l.textContent)).toEqual([
      'All items',
      'Locked items',
      'Footprints',
      'Text',
      'Tracks',
      'Vias',
      'Pads',
      'Graphics',
      'Zones',
      'Rule Areas',
      'Dimensions',
      'Other items',
      'Points',
    ]);
    expect(SELECTION_FILTER_ITEMS).toHaveLength(12);
  });

  /**
   * `PCB_SELECTION_FILTER_OPTIONS::All()` is "all the item types … excluding
   * 'locked items' which is special" (`board_project_settings.h:79-86`), and
   * `OnFilterChanged` sets exactly eleven boxes. Ours counted and drove all
   * twelve, so "All items" could not be ticked while "Locked items" was not —
   * which is the state a stock KiCad opens in.
   */
  it('computes All items over the eleven non-locked categories', () => {
    expect(SELECTION_FILTER_ALL_KEYS).toHaveLength(11);
    expect(SELECTION_FILTER_ALL_KEYS).not.toContain('lockedItems');
    expect(selectionFilterAll(DEFAULT_SELECTION_FILTER_OPTIONS)).toBe(true);
    expect(DEFAULT_SELECTION_FILTER_OPTIONS.has('lockedItems')).toBe(false);
  });

  it('ticks All items on a default filter that has Locked items off', () => {
    const { container } = render(
      <SelectionFilterPanel filter={DEFAULT_SELECTION_FILTER_OPTIONS} onChange={noop} />,
    );
    const boxes = Array.from(
      container.querySelectorAll('input[type="checkbox"]'),
    ) as HTMLInputElement[];
    expect(boxes[0]?.checked).toBe(true); // All items
    expect(boxes[1]?.checked).toBe(false); // Locked items
  });

  it('clearing All items leaves Locked items alone', () => {
    const withLocked = new Set([...SELECTION_FILTER_ALL_KEYS, 'lockedItems']);
    expect(toggleSelectionFilterAll(withLocked)).toEqual(new Set(['lockedItems']));
  });

  it('setting All items does not switch Locked items on', () => {
    expect(toggleSelectionFilterAll(new Set<string>())).toEqual(new Set(SELECTION_FILTER_ALL_KEYS));
  });

  it('unticking one category unticks All items', () => {
    const onChange = vi.fn();
    const { container } = render(
      <SelectionFilterPanel filter={DEFAULT_SELECTION_FILTER_OPTIONS} onChange={onChange} />,
    );
    const boxes = Array.from(
      container.querySelectorAll('input[type="checkbox"]'),
    ) as HTMLInputElement[];
    fireEvent.click(boxes[4]!); // Tracks
    const next = onChange.mock.calls[0]?.[0] as Set<string>;
    expect(next.has('tracks')).toBe(false);
    expect(selectionFilterAll(next)).toBe(false);
  });
});
