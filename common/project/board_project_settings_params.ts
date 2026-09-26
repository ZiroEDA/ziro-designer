// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/project/board_project_settings_params.h`, bodies in
 * `common/project/board_project_settings.cpp`: the four `PARAM_LAMBDA<json>`
 * subclasses `PROJECT_FILE` uses for its per-board lists.
 */
import { BOX2D } from '@ziroeda/kimath/src/math/box2.js';
import { BoardLayerFromLegacyId, GAL_LAYER_ID, PCB_LAYER_ID } from '../layer_id.js';
import { type JsonObject, type JsonValue, PARAM_LAMBDA } from '../settings/json_settings.js';
import {
  RenderLayerFromVisbilityString,
  VisibilityLayerFromRenderLayer,
  VisibilityLayerToString,
} from '../settings/layer_settings_utils.js';
import {
  LAYER_PAIR,
  LAYER_PAIR_INFO,
  LAYER_PRESET,
  VIEWPORT,
  VIEWPORT3D,
} from './board_project_settings.js';

function isObject(v: JsonValue | undefined): v is JsonObject {
  return v !== undefined && v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** `nlohmann::json::empty()` on an array is `size() == 0`. */
function isNonEmptyArray(v: JsonValue): v is JsonValue[] {
  return Array.isArray(v) && v.length > 0;
}

export class PARAM_LAYER_PRESET extends PARAM_LAMBDA<JsonValue> {
  private m_presets: LAYER_PRESET[];

  constructor(aPath: string, aPresetList: LAYER_PRESET[]) {
    super(
      aPath,
      () => this.presetsToJson(),
      (v) => this.jsonToPresets(v),
      {},
    );
    this.m_presets = aPresetList;
  }

  private presetsToJson(): JsonValue {
    const ret: JsonValue[] = [];

    for (const preset of this.m_presets) {
      const js: JsonObject = {
        name: preset.name,
        activeLayer: preset.activeLayer,
        flipBoard: preset.flipBoard,
      };

      const layers: JsonValue[] = [];

      for (const layer of preset.layers.Seq()) layers.push(layer as number);

      js.layers = layers;

      const renderLayers: JsonValue[] = [];

      for (const layer of preset.renderLayers.Seq()) {
        const vl = VisibilityLayerFromRenderLayer(layer);

        if (vl !== undefined) renderLayers.push(VisibilityLayerToString(vl));
      }

      js.renderLayers = renderLayers;

      ret.push(js);
    }

    return ret;
  }

  private jsonToPresets(aJson: JsonValue): void {
    if (!isNonEmptyArray(aJson)) return;

    this.m_presets.length = 0;

    for (const preset of aJson) {
      if (isObject(preset) && 'name' in preset) {
        const p = new LAYER_PRESET(String(preset.name));

        if (typeof preset.flipBoard === 'boolean') p.flipBoard = preset.flipBoard;

        if (typeof preset.activeLayer === 'number' && Number.isInteger(preset.activeLayer)) {
          const active = preset.activeLayer;

          if (active >= 0 && active < PCB_LAYER_ID.PCB_LAYER_ID_COUNT)
            p.activeLayer = active as PCB_LAYER_ID;
        }

        if (Array.isArray(preset.layers)) {
          p.layers.reset();

          for (const layer of preset.layers) {
            if (typeof layer === 'number' && Number.isInteger(layer)) {
              if (layer >= 0 && layer < PCB_LAYER_ID.PCB_LAYER_ID_COUNT) p.layers.set(layer);
            }
          }
        }

        if (Array.isArray(preset.renderLayers)) {
          p.renderLayers.reset();

          for (const layer of preset.renderLayers) {
            if (typeof layer === 'string') {
              const rl = RenderLayerFromVisbilityString(layer);

              if (rl !== undefined) p.renderLayers.setLayer(rl);
            }
          }
        }

        this.m_presets.push(p);
      }
    }
  }

  static MigrateToV9Layers(aJson: JsonObject): void {
    if (!Array.isArray(aJson.layers)) return;

    const newLayers: number[] = [];

    for (const layer of aJson.layers) {
      if (typeof layer !== 'number' || !Number.isInteger(layer)) continue;
      newLayers.push(BoardLayerFromLegacyId(layer));
    }

    aJson.layers = newLayers;

    if (typeof aJson.activeLayer === 'number')
      aJson.activeLayer = BoardLayerFromLegacyId(aJson.activeLayer);
  }

  static MigrateToNamedRenderLayers(aJson: JsonObject): void {
    const V8_GAL_LAYER_ID_START = 125;

    if (!Array.isArray(aJson.renderLayers)) return;

    const newLayers: string[] = [];

    for (const layer of aJson.renderLayers) {
      if (typeof layer !== 'number' || !Number.isInteger(layer)) continue;
      const layerId = (GAL_LAYER_ID.GAL_LAYER_ID_START +
        (layer - V8_GAL_LAYER_ID_START)) as GAL_LAYER_ID;

      const vl = VisibilityLayerFromRenderLayer(layerId);

      if (vl !== undefined) newLayers.push(VisibilityLayerToString(vl));
    }

    aJson.renderLayers = newLayers;
  }
}

export class PARAM_VIEWPORT extends PARAM_LAMBDA<JsonValue> {
  private m_viewports: VIEWPORT[];

  constructor(aPath: string, aViewportList: VIEWPORT[]) {
    super(
      aPath,
      () => this.viewportsToJson(),
      (v) => this.jsonToViewports(v),
      {},
    );
    this.m_viewports = aViewportList;
  }

  private viewportsToJson(): JsonValue {
    const ret: JsonValue[] = [];

    for (const viewport of this.m_viewports) {
      ret.push({
        name: viewport.name,
        x: viewport.rect.GetX(),
        y: viewport.rect.GetY(),
        w: viewport.rect.GetWidth(),
        h: viewport.rect.GetHeight(),
      });
    }

    return ret;
  }

  private jsonToViewports(aJson: JsonValue): void {
    if (!isNonEmptyArray(aJson)) return;

    this.m_viewports.length = 0;

    for (const viewport of aJson) {
      if (isObject(viewport) && 'name' in viewport) {
        const v = new VIEWPORT(String(viewport.name));

        if ('x' in viewport) v.rect.SetX(Number(viewport.x));
        if ('y' in viewport) v.rect.SetY(Number(viewport.y));
        if ('w' in viewport) v.rect.SetWidth(Number(viewport.w));
        if ('h' in viewport) v.rect.SetHeight(Number(viewport.h));

        this.m_viewports.push(v);
      }
    }
  }
}

/** The sixteen keys, row-major: `xx xy xz xw yx ...`. */
const MAT4_ROWS = ['x', 'y', 'z', 'w'] as const;

export class PARAM_VIEWPORT3D extends PARAM_LAMBDA<JsonValue> {
  private m_viewports: VIEWPORT3D[];

  constructor(aPath: string, aViewportList: VIEWPORT3D[]) {
    super(
      aPath,
      () => this.viewportsToJson(),
      (v) => this.jsonToViewports(v),
      {},
    );
    this.m_viewports = aViewportList;
  }

  private viewportsToJson(): JsonValue {
    const ret: JsonValue[] = [];

    for (const viewport of this.m_viewports) {
      const js: JsonObject = { name: viewport.name };

      MAT4_ROWS.forEach((r, i) => {
        for (const c of MAT4_ROWS) js[r + c] = viewport.matrix[i]![c];
      });

      ret.push(js);
    }

    return ret;
  }

  private jsonToViewports(aJson: JsonValue): void {
    if (!isNonEmptyArray(aJson)) return;

    this.m_viewports.length = 0;

    for (const viewport of aJson) {
      if (isObject(viewport) && 'name' in viewport) {
        const v = new VIEWPORT3D(String(viewport.name));

        MAT4_ROWS.forEach((r, i) => {
          for (const c of MAT4_ROWS) {
            if (r + c in viewport) v.matrix[i]![c] = Number(viewport[r + c]);
          }
        });

        this.m_viewports.push(v);
      }
    }
  }
}

export class PARAM_LAYER_PAIRS extends PARAM_LAMBDA<JsonValue> {
  private m_layerPairInfos: LAYER_PAIR_INFO[];

  constructor(aPath: string, aLayerPairInfos: LAYER_PAIR_INFO[]) {
    super(
      aPath,
      () => this.layerPairsToJson(),
      (v) => this.jsonToLayerPairs(v),
      {},
    );
    this.m_layerPairInfos = aLayerPairInfos;
  }

  private layerPairsToJson(): JsonValue {
    const ret: JsonValue[] = [];

    for (const pairInfo of this.m_layerPairInfos) {
      const pair = pairInfo.GetLayerPair();
      const js: JsonObject = {
        topLayer: pair.GetLayerA(),
        bottomLayer: pair.GetLayerB(),
        enabled: pairInfo.IsEnabled(),
      };

      const name = pairInfo.GetName();

      if (name !== undefined) js.name = name;

      ret.push(js);
    }

    return ret;
  }

  private jsonToLayerPairs(aJson: JsonValue): void {
    if (!isNonEmptyArray(aJson)) return;

    this.m_layerPairInfos.length = 0;

    for (const pairJson of aJson) {
      if (isObject(pairJson) && 'topLayer' in pairJson && 'bottomLayer' in pairJson) {
        const pair = new LAYER_PAIR(
          Number(pairJson.topLayer) as PCB_LAYER_ID,
          Number(pairJson.bottomLayer) as PCB_LAYER_ID,
        );

        let enabled = true;
        if ('enabled' in pairJson) enabled = Boolean(pairJson.enabled);

        let name: string | undefined;
        if ('name' in pairJson) name = String(pairJson.name);

        this.m_layerPairInfos.push(new LAYER_PAIR_INFO(pair, enabled, name));
      }
    }
  }
}
