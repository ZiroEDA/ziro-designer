// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Appearance panel's layer presets: the eight built-ins, the order the
 * combo lists them in, and which one the combo is showing.
 *
 * Split out of `PcbEditor.tsx` because qa's tsconfig sets no `--jsx`, so
 * nothing inside a `.tsx` can be tested — and the ordering rule below is
 * exactly the kind of thing that drifts when nothing is watching it.
 */

/** One built-in preset (appearance_controls.cpp:382-403). */
export interface LayerPreset {
  name: string;
  /** LSET of visible layers, resolved against this board's layer list. */
  layers: (all: string[], copper: string[]) => string[];
  /** LAYER_PRESET::flipBoard — the two Back presets view the board flipped. */
  flipBoard: boolean;
  /** LAYER_PRESET::activeLayer, UNSELECTED_LAYER for all but the two assemblies. */
  activeLayer?: string;
}

const FRONT_TECH = ['F.SilkS', 'F.Mask', 'F.Adhes', 'F.Paste', 'F.CrtYd', 'F.Fab'];
const BACK_TECH = ['B.SilkS', 'B.Mask', 'B.Adhes', 'B.Paste', 'B.CrtYd', 'B.Fab'];

/**
 * [data] The eight built-ins, in the order appearance_controls.cpp declares
 * them (`:382-403`) with the masks from common/lset.cpp. Declaration order is
 * NOT display order — see `presetComboItems`.
 */
export const BUILTIN_PRESETS: readonly LayerPreset[] = [
  { name: 'All Layers', layers: (all) => all, flipBoard: false },
  { name: 'No Layers', layers: () => [], flipBoard: false },
  { name: 'All Copper Layers', layers: (_a, cu) => [...cu, 'Edge.Cuts'], flipBoard: false },
  {
    name: 'Inner Copper Layers',
    layers: (_a, cu) => [...cu.filter((c) => /^In/.test(c)), 'Edge.Cuts'],
    flipBoard: false,
  },
  { name: 'Front Layers', layers: () => ['F.Cu', ...FRONT_TECH, 'Edge.Cuts'], flipBoard: false },
  {
    name: 'Front Assembly View',
    layers: () => ['F.SilkS', 'F.Mask', 'F.Fab', 'F.CrtYd', 'Edge.Cuts'],
    flipBoard: false,
    activeLayer: 'F.SilkS',
  },
  // presetBack and presetBackAssembly pass aFlipBoard = true.
  { name: 'Back Layers', layers: () => ['B.Cu', ...BACK_TECH, 'Edge.Cuts'], flipBoard: true },
  {
    name: 'Back Assembly View',
    layers: () => ['B.SilkS', 'B.Mask', 'B.Fab', 'B.CrtYd', 'Edge.Cuts'],
    flipBoard: true,
    activeLayer: 'B.SilkS',
  },
];

/** The separator wxChoice entry, and the selection when nothing matches. */
export const PRESET_SEPARATOR = '---';

/**
 * The combo's entries, in order (`rebuildLayerPresetsWidget`, `:2725-2771`).
 *
 * The built-ins come out **alphabetical**, not in declaration order, because
 * upstream holds them in a `std::map<wxString, LAYER_PRESET>`
 * (appearance_controls.h:426) and iterates it — so the list opens on "All
 * Copper Layers", not "All Layers". User presets follow after a separator of
 * their own, alphabetically for the same reason, and only if there are any.
 *
 * There is no "(unsaved)" entry. It exists in the wxFormBuilder stub
 * (appearance_controls_base.cpp:163) and `Clear()` deletes it before the combo
 * is ever shown.
 */
export function presetComboItems(userPresetNames: readonly string[] = []): string[] {
  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const builtins = BUILTIN_PRESETS.map((p) => p.name).sort(cmp);
  const users = [...userPresetNames].sort(cmp);
  return [
    ...builtins,
    ...(users.length > 0 ? [PRESET_SEPARATOR, ...users] : []),
    PRESET_SEPARATOR,
    'Save preset...',
    'Delete preset...',
  ];
}

/** What `syncLayerPresetSelection` needs to compare against a preset. */
export interface PresetMatchInput {
  visibleLayers: ReadonlySet<string>;
  /** True when every Objects row is at its default visibility. */
  objectsAtDefault: boolean;
  flipBoard: boolean;
  allLayers: readonly string[];
  copperLayers: readonly string[];
  userPresets?: readonly { name: string; layers: readonly string[] }[];
}

const sameSet = (a: ReadonlySet<string>, b: readonly string[]): boolean =>
  a.size === new Set(b).size && b.every((l) => a.has(l));

/**
 * Which entry the combo shows, `APPEARANCE_CONTROLS::syncLayerPresetSelection`
 * (`:2785-2815`).
 *
 * It is derived, never stored: upstream searches m_layerPresets for one whose
 * layers, renderLayers AND flipBoard all equal the current view, and when
 * none does it selects `m_cbLayerPresets->GetCount() - 3` — the separator.
 * Every built-in carries `renderLayers = GAL_SET::DefaultVisible()`
 * (board_project_settings.h:159-187), so "renderLayers match" is "the Objects
 * tab is untouched".
 */
export function matchPresetName(input: PresetMatchInput): string {
  const { visibleLayers, objectsAtDefault, flipBoard, allLayers, copperLayers } = input;

  for (const name of presetComboItems((input.userPresets ?? []).map((u) => u.name))) {
    if (name === PRESET_SEPARATOR) continue;
    const user = (input.userPresets ?? []).find((u) => u.name === name);
    if (user) {
      if (sameSet(visibleLayers, [...user.layers])) return name;
      continue;
    }
    const preset = BUILTIN_PRESETS.find((p) => p.name === name);
    if (preset === undefined) continue;
    if (!objectsAtDefault || preset.flipBoard !== flipBoard) continue;
    const want = preset
      .layers([...allLayers], [...copperLayers])
      .filter((l) => allLayers.includes(l));
    if (sameSet(visibleLayers, want)) return name;
  }
  return PRESET_SEPARATOR;
}
