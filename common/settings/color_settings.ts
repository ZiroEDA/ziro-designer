// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `settings/color_settings.h` + `common/settings/color_settings.cpp`:
 * `COLOR_SETTINGS`, one colour theme as a map from layer id to colour. The
 * PARAM registration (the `CLR( "schematic.anchor", LAYER_SCHEMATIC_ANCHOR )`
 * lines) is the `SCHEMATIC_COLOR_KEYS` / `BOARD_COLOR_KEYS` tables of
 * `color_theme_file.ts`; the default theme is `builtin_color_themes.ts`. A
 * theme file's contents load through {@link COLOR_SETTINGS.LoadFromContents}
 * with `aResetIfMissing`, as `COLOR_MAP_PARAM::Load` does.
 */

import { type Color4d, COLOR4D_UNSPECIFIED, parseColor4d } from '../color4d.js';
import {
  GAL_LAYER_ID,
  GERBER_DRAWLAYERS_COUNT,
  GERBVIEW_LAYER_ID,
  IsCopperLayer,
  LAYER_3D_ID,
  NETNAMES_LAYER_ID,
  PCB_LAYER_ID,
  SCH_LAYER_ID,
} from '../layer_id.js';
import {
  BUILTIN_CLASSIC_THEME,
  BUILTIN_DEFAULT_THEME,
  type BuiltinThemeLayer,
  COPPER_LOOP_COLORS,
  USER_LOOP_COLORS,
} from './builtin_color_themes.js';
import {
  BOARD_COLOR_KEYS,
  type ColorThemeContents,
  SCHEMATIC_COLOR_KEYS,
  type ThemeLayerId,
} from './color_theme_file.js';

/**
 * The layer id a `builtin_color_themes.h` key names: the enum's own name, or
 * the `GERBVIEW_LAYER_ID_START+n` / `NETNAMES_LAYER_ID_START+n` forms the
 * generated table spells the looped ones in.
 */
export function layerIdFromThemeKey(aKey: string): number | undefined {
  const plus = aKey.indexOf('+');
  const base = plus === -1 ? aKey : aKey.slice(0, plus);
  const offset = plus === -1 ? 0 : Number(aKey.slice(plus + 1));

  const enums: Record<string, number | undefined>[] = [
    PCB_LAYER_ID as unknown as Record<string, number>,
    NETNAMES_LAYER_ID as unknown as Record<string, number>,
    GAL_LAYER_ID as unknown as Record<string, number>,
    SCH_LAYER_ID as unknown as Record<string, number>,
    GERBVIEW_LAYER_ID as unknown as Record<string, number>,
    LAYER_3D_ID as unknown as Record<string, number>,
  ];

  for (const e of enums) {
    const v = e[base];
    if (typeof v === 'number') return v + offset;
  }

  return undefined;
}

/** `s_defaultTheme` / `s_classicTheme`, keyed by layer id. */
function themeById(theme: Record<string, Color4d>): Map<number, Color4d> {
  const out = new Map<number, Color4d>();

  for (const [key, color] of Object.entries(theme)) {
    const id = layerIdFromThemeKey(key);
    if (id !== undefined) out.set(id, color);
  }

  return out;
}

let s_defaultTheme: Map<number, Color4d> | null = null;

function defaultTheme(): Map<number, Color4d> {
  if (!s_defaultTheme) s_defaultTheme = themeById(BUILTIN_DEFAULT_THEME);
  return s_defaultTheme;
}

/** A `COLOR_MAP_PARAM`: the JSON path, the layer, the default. */
interface COLOR_MAP_PARAM {
  m_path: string;
  m_key: number;
  m_default: Color4d;
}

export class COLOR_SETTINGS {
  // Names for the built-in color settings
  static readonly COLOR_BUILTIN_DEFAULT = '_builtin_default';
  static readonly COLOR_BUILTIN_CLASSIC = '_builtin_classic';

  private m_filename: string;
  private m_displayName: string;
  private m_overrideSchItemColors: boolean;

  private m_colors: Map<number, Color4d> = new Map();
  private m_defaultColors: Map<number, Color4d> = new Map();

  /** `JSON_SETTINGS::m_writeFile`: false for the built-in themes. */
  private m_writeFile = true;

  /** The registered `COLOR_MAP_PARAM`s, in the constructor's order. */
  private m_params: COLOR_MAP_PARAM[] = [];

  constructor(aFilename = 'user') {
    this.m_filename = aFilename;
    this.m_displayName = 'KiCad Default';
    this.m_overrideSchItemColors = false;

    const defaults = defaultTheme();

    const CLR = (aPath: string, aLayerName: ThemeLayerId): void => {
      const id = layerIdFromThemeKey(aLayerName);
      console.assert(id !== undefined && defaults.has(id));
      if (id === undefined) return;
      this.m_params.push({ m_path: aPath, m_key: id, m_default: defaults.get(id)! });
    };

    for (const [path, layer] of SCHEMATIC_COLOR_KEYS) CLR(`schematic.${path}`, layer);

    for (const [path, layer] of BOARD_COLOR_KEYS) CLR(`board.${path}`, layer);

    for (
      let i = 0, id = GERBVIEW_LAYER_ID.GERBVIEW_LAYER_ID_START;
      id < GERBER_DRAWLAYERS_COUNT + GERBVIEW_LAYER_ID.GERBVIEW_LAYER_ID_START;
      ++i, ++id
    ) {
      if (!defaults.has(id)) continue;

      this.m_params.push({
        m_path: `gerbview.layers.${i}`,
        m_key: id,
        m_default: defaults.get(id)!,
      });
    }

    // Load(): the params at their defaults
    for (const p of this.m_params) this.m_colors.set(p.m_key, p.m_default);
  }

  /** `COLOR_SETTINGS( const COLOR_SETTINGS& )`. */
  static copy(aOther: COLOR_SETTINGS): COLOR_SETTINGS {
    const c = new COLOR_SETTINGS(aOther.m_filename);
    c.initFromOther(aOther);
    return c;
  }

  /** `operator=( const COLOR_SETTINGS& )`: the filename comes across too. */
  assign(aOther: COLOR_SETTINGS): this {
    this.m_filename = aOther.m_filename;
    this.initFromOther(aOther);
    return this;
  }

  private initFromOther(aOther: COLOR_SETTINGS): void {
    this.m_displayName = aOther.m_displayName;
    this.m_overrideSchItemColors = aOther.m_overrideSchItemColors;
    this.m_colors = new Map(aOther.m_colors);
    this.m_defaultColors = new Map(aOther.m_defaultColors);
    this.m_writeFile = aOther.m_writeFile;

    // Ensure default colors are present
    for (const cmp of aOther.m_params) this.m_defaultColors.set(cmp.m_key, cmp.m_default);
  }

  GetFilename(): string {
    return this.m_filename;
  }

  SetFilename(aFilename: string): void {
    this.m_filename = aFilename;
  }

  /** `JSON_SETTINGS::IsReadOnly` / `SetReadOnly`: whether the file is written back. */
  IsReadOnly(): boolean {
    return !this.m_writeFile;
  }

  SetReadOnly(aReadOnly: boolean): void {
    this.m_writeFile = !aReadOnly;
  }

  GetColor(aLayer: number): Color4d {
    const c = this.m_colors.get(aLayer);
    if (c !== undefined) return c;

    return COLOR4D_UNSPECIFIED;
  }

  GetDefaultColor(aLayer: number): Color4d {
    if (!this.m_defaultColors.has(aLayer)) {
      let p: COLOR_MAP_PARAM | null = null;

      for (const param of this.m_params) {
        if (param.m_key === aLayer) p = param;
      }

      if (p) this.m_defaultColors.set(aLayer, p.m_default);
      else if (IsCopperLayer(aLayer))
        this.m_defaultColors.set(aLayer, COPPER_LOOP_COLORS[aLayer % COPPER_LOOP_COLORS.length]!);
      else this.m_defaultColors.set(aLayer, USER_LOOP_COLORS[aLayer % USER_LOOP_COLORS.length]!);
    }

    return this.m_defaultColors.get(aLayer)!;
  }

  SetColor(aLayer: number, aColor: Color4d): void {
    this.m_colors.set(aLayer, aColor);
  }

  GetName(): string {
    return this.m_displayName;
  }
  SetName(aName: string): void {
    this.m_displayName = aName;
  }

  GetOverrideSchItemColors(): boolean {
    return this.m_overrideSchItemColors;
  }
  SetOverrideSchItemColors(aFlag: boolean): void {
    this.m_overrideSchItemColors = aFlag;
  }

  /**
   * `JSON_SETTINGS::Load` over the registered params: every colour the file
   * names is taken, every other one is reset to its default
   * (`COLOR_MAP_PARAM::Load` with `aResetIfMissing`).
   */
  LoadFromContents(aContents: ColorThemeContents): void {
    this.m_displayName = aContents.name;
    this.m_overrideSchItemColors = aContents.override;

    const named = new Map<number, Color4d>();

    for (const [layerName, css] of Object.entries(aContents.colors)) {
      const id = layerIdFromThemeKey(layerName);
      if (id !== undefined && css) named.set(id, parseColor4d(css));
    }

    if (aContents.board) {
      for (const [layerName, css] of Object.entries(aContents.board)) {
        const id = layerIdFromThemeKey(layerName);
        if (id !== undefined && css) named.set(id, parseColor4d(css));
      }
    }

    for (const p of this.m_params) {
      const v = named.get(p.m_key);
      this.m_colors.set(p.m_key, v !== undefined ? v : p.m_default);
    }
  }

  /**
   * `JSON_SETTINGS::Load` over a flat `{ "<param path>": "<css>" }` table —
   * the theme file as the params see it: every registered `COLOR_MAP_PARAM`
   * takes the row at its path, and one without a row is reset to its
   * default (`aResetIfMissing`).
   */
  LoadFromJsonPaths(aColors: Readonly<Record<string, string>>): void {
    for (const p of this.m_params) {
      const css = aColors[p.m_path];
      this.m_colors.set(p.m_key, css !== undefined ? parseColor4d(css) : p.m_default);
    }
  }

  static CreateBuiltinColorSettings(): COLOR_SETTINGS[] {
    const defaultTheme = new COLOR_SETTINGS(COLOR_SETTINGS.COLOR_BUILTIN_DEFAULT);
    defaultTheme.SetName('KiCad Default');
    defaultTheme.m_writeFile = false;
    // Load(): we can just get the colors out of the param defaults for this one

    const classicTheme = new COLOR_SETTINGS(COLOR_SETTINGS.COLOR_BUILTIN_CLASSIC);
    classicTheme.SetName('KiCad Classic');
    classicTheme.m_writeFile = false;
    classicTheme.m_params = []; // Disable load/store

    for (const [key, color] of Object.entries(BUILTIN_CLASSIC_THEME)) {
      const id = layerIdFromThemeKey(key);
      if (id !== undefined) classicTheme.m_colors.set(id, color);
    }

    return [defaultTheme, classicTheme];
  }
}

export type { BuiltinThemeLayer };
