// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/project/tuning_profiles.h` / `common/project/tuning_profiles.cpp`:
 * the project file's `tuning_profiles` nested settings, which the length /
 * delay calculation reads for propagation delays.
 */
import { IsCopperLayerLowerThan, type PCB_LAYER_ID, UNDEFINED_LAYER } from '../layer_id.js';
import { LSET } from '../lset.js';
import {
  type JSON_SETTINGS,
  type JsonObject,
  type JsonValue,
  NESTED_SETTINGS,
  PARAM_LAMBDA,
} from '../settings/json_settings.js';

const tuningParametersSchemaVersion = 0;

export class DELAY_PROFILE_VIA_OVERRIDE_ENTRY {
  constructor(
    public m_SignalLayerFrom: PCB_LAYER_ID,
    public m_SignalLayerTo: PCB_LAYER_ID,
    public m_ViaLayerFrom: PCB_LAYER_ID,
    public m_ViaLayerTo: PCB_LAYER_ID,
    public m_Delay: number,
  ) {}

  /** `operator<`. */
  lt(other: DELAY_PROFILE_VIA_OVERRIDE_ENTRY): boolean {
    if (this.m_SignalLayerFrom !== other.m_SignalLayerFrom) {
      return IsCopperLayerLowerThan(this.m_SignalLayerFrom, other.m_SignalLayerFrom);
    }

    if (this.m_SignalLayerTo !== other.m_SignalLayerTo)
      return IsCopperLayerLowerThan(this.m_SignalLayerTo, other.m_SignalLayerTo);

    if (this.m_ViaLayerFrom !== other.m_ViaLayerFrom)
      return IsCopperLayerLowerThan(this.m_ViaLayerFrom, other.m_ViaLayerFrom);

    if (this.m_ViaLayerTo !== other.m_ViaLayerTo)
      return IsCopperLayerLowerThan(this.m_ViaLayerTo, other.m_ViaLayerTo);

    return this.m_Delay < other.m_Delay;
  }

  equals(other: DELAY_PROFILE_VIA_OVERRIDE_ENTRY): boolean {
    if (this.m_SignalLayerFrom !== other.m_SignalLayerFrom) return false;

    if (this.m_SignalLayerTo !== other.m_SignalLayerTo) return false;

    if (this.m_ViaLayerFrom !== other.m_ViaLayerFrom) return false;

    if (this.m_ViaLayerTo !== other.m_ViaLayerTo) return false;

    if (this.m_Delay !== other.m_Delay) return false;

    return true;
  }
}

export class DELAY_PROFILE_TRACK_PROPAGATION_ENTRY {
  m_signalLayer: PCB_LAYER_ID = UNDEFINED_LAYER;
  m_topReferenceLayer: PCB_LAYER_ID = UNDEFINED_LAYER;
  m_bottomReferenceLayer: PCB_LAYER_ID = UNDEFINED_LAYER;
  m_width = 0;
  m_diffPairGap = 0;
  m_delay = 0;
  m_enableTimeDomainTuning = false;

  SetSignalLayer(aLayer: PCB_LAYER_ID): void {
    this.m_signalLayer = aLayer;
  }
  SetTopReferenceLayer(aLayer: PCB_LAYER_ID): void {
    this.m_topReferenceLayer = aLayer;
  }
  SetBottomReferenceLayer(aLayer: PCB_LAYER_ID): void {
    this.m_bottomReferenceLayer = aLayer;
  }
  SetWidth(aWidth: number): void {
    this.m_width = aWidth;
  }
  SetDiffPairGap(aDiffPairGap: number): void {
    this.m_diffPairGap = aDiffPairGap;
  }
  SetDelay(aDelay: number): void {
    this.m_delay = aDelay;
  }
  SetEnableTimeDomainTuning(aEnable: boolean): void {
    this.m_enableTimeDomainTuning = aEnable;
  }

  GetSignalLayer(): PCB_LAYER_ID {
    return this.m_signalLayer;
  }
  GetTopReferenceLayer(): PCB_LAYER_ID {
    return this.m_topReferenceLayer;
  }
  GetBottomReferenceLayer(): PCB_LAYER_ID {
    return this.m_bottomReferenceLayer;
  }
  GetWidth(): number {
    return this.m_width;
  }
  GetDiffPairGap(): number {
    return this.m_diffPairGap;
  }
  GetDelay(aForce = false): number {
    return this.m_enableTimeDomainTuning || aForce ? this.m_delay : 0;
  }

  equals(other: DELAY_PROFILE_TRACK_PROPAGATION_ENTRY): boolean {
    if (this.m_signalLayer !== other.m_signalLayer) return false;

    if (this.m_topReferenceLayer !== other.m_topReferenceLayer) return false;

    if (this.m_bottomReferenceLayer !== other.m_bottomReferenceLayer) return false;

    if (this.m_width !== other.m_width) return false;

    if (this.m_diffPairGap !== other.m_diffPairGap) return false;

    if (this.m_delay !== other.m_delay) return false;

    if (this.m_enableTimeDomainTuning !== other.m_enableTimeDomainTuning) return false;

    return true;
  }
}

export enum TUNING_PROFILE_TYPE {
  SINGLE,
  DIFFERENTIAL,
}

export class TUNING_PROFILE {
  m_ProfileName = '';
  m_Type: TUNING_PROFILE_TYPE = TUNING_PROFILE_TYPE.SINGLE;
  m_TargetImpedance = 0;
  m_EnableTimeDomainTuning = false;
  m_TrackPropagationEntries: DELAY_PROFILE_TRACK_PROPAGATION_ENTRY[] = [];
  m_ViaPropagationDelay = 0;
  m_ViaOverrides: DELAY_PROFILE_VIA_OVERRIDE_ENTRY[] = [];
  m_TrackPropagationEntriesMap = new Map<PCB_LAYER_ID, DELAY_PROFILE_TRACK_PROPAGATION_ENTRY>();

  equals(aOther: TUNING_PROFILE): boolean {
    if (this.m_ProfileName !== aOther.m_ProfileName) return false;

    if (this.m_Type !== aOther.m_Type) return false;

    if (this.m_TargetImpedance !== aOther.m_TargetImpedance) return false;

    if (this.m_EnableTimeDomainTuning !== aOther.m_EnableTimeDomainTuning) return false;

    if (
      this.m_TrackPropagationEntries.length !== aOther.m_TrackPropagationEntries.length ||
      !this.m_TrackPropagationEntries.every((e, i) =>
        e.equals(aOther.m_TrackPropagationEntries[i]!),
      )
    ) {
      return false;
    }

    if (this.m_ViaPropagationDelay !== aOther.m_ViaPropagationDelay) return false;

    if (
      this.m_ViaOverrides.length !== aOther.m_ViaOverrides.length ||
      !this.m_ViaOverrides.every((e, i) => e.equals(aOther.m_ViaOverrides[i]!))
    ) {
      return false;
    }

    return true;
  }
}

const readViaOverrideConfigurationLine = (
  entry: Record<string, unknown>,
): DELAY_PROFILE_VIA_OVERRIDE_ENTRY => {
  const signalLayerFromId = LSET.NameToLayer(String(entry.signal_layer_from));
  const signalLayerToId = LSET.NameToLayer(String(entry.signal_layer_to));
  const viaLayerFromId = LSET.NameToLayer(String(entry.via_layer_from));
  const viaLayerToId = LSET.NameToLayer(String(entry.via_layer_to));
  const delay = Number(entry.delay);

  return new DELAY_PROFILE_VIA_OVERRIDE_ENTRY(
    signalLayerFromId as PCB_LAYER_ID,
    signalLayerToId as PCB_LAYER_ID,
    viaLayerFromId as PCB_LAYER_ID,
    viaLayerToId as PCB_LAYER_ID,
    delay,
  );
};

const readUserDefinedProfileConfigurationLine = (
  entry: Record<string, unknown>,
): TUNING_PROFILE => {
  const profileName = String(entry.profile_name);
  const profileType = Number(entry.type) as TUNING_PROFILE_TYPE;
  const targetImpedance = Number(entry.target_impedance);
  const enableTimeDomainTuning = Boolean(entry.enable_time_domain_tuning);
  const viaPropDelay = Number(entry.via_prop_delay);

  const trackEntries: DELAY_PROFILE_TRACK_PROPAGATION_ENTRY[] = [];
  const trackEntriesMap = new Map<PCB_LAYER_ID, DELAY_PROFILE_TRACK_PROPAGATION_ENTRY>();

  for (const layerEntry of Array.isArray(entry.layer_entries)
    ? (entry.layer_entries as unknown[])
    : []) {
    if (layerEntry === null || typeof layerEntry !== 'object') continue;

    const le = layerEntry as Record<string, unknown>;
    const signalLayerId = LSET.NameToLayer(String(le.signal_layer));
    const topRefLayerId = LSET.NameToLayer(String(le.top_reference_layer));
    const bottomRefLayerId = LSET.NameToLayer(String(le.bottom_reference_layer));

    const trackEntry = new DELAY_PROFILE_TRACK_PROPAGATION_ENTRY();
    trackEntry.m_signalLayer = signalLayerId as PCB_LAYER_ID;
    trackEntry.m_topReferenceLayer = topRefLayerId as PCB_LAYER_ID;
    trackEntry.m_bottomReferenceLayer = bottomRefLayerId as PCB_LAYER_ID;
    trackEntry.m_width = Number(le.width);
    trackEntry.m_diffPairGap = Number(le.diff_pair_gap);
    trackEntry.m_delay = Number(le.delay);
    trackEntry.m_enableTimeDomainTuning = enableTimeDomainTuning;

    trackEntries.push(trackEntry);
    trackEntriesMap.set(signalLayerId as PCB_LAYER_ID, trackEntry);
  }

  const viaOverrides: DELAY_PROFILE_VIA_OVERRIDE_ENTRY[] = [];

  for (const viaEntry of Array.isArray(entry.via_overrides)
    ? (entry.via_overrides as unknown[])
    : []) {
    if (viaEntry === null || typeof viaEntry !== 'object' || !('signal_layer_from' in viaEntry))
      continue;

    viaOverrides.push(readViaOverrideConfigurationLine(viaEntry as Record<string, unknown>));
  }

  const item = new TUNING_PROFILE();
  item.m_ProfileName = profileName;
  item.m_Type = profileType;
  item.m_TargetImpedance = targetImpedance;
  item.m_EnableTimeDomainTuning = enableTimeDomainTuning;
  item.m_TrackPropagationEntries = trackEntries;
  item.m_ViaPropagationDelay = viaPropDelay;
  item.m_ViaOverrides = viaOverrides;
  item.m_TrackPropagationEntriesMap = trackEntriesMap;
  return item;
};

const saveViaOverrideConfigurationLine = (
  json_array: JsonValue[],
  item: DELAY_PROFILE_VIA_OVERRIDE_ENTRY,
): void => {
  json_array.push({
    signal_layer_from: LSET.Name(item.m_SignalLayerFrom),
    signal_layer_to: LSET.Name(item.m_SignalLayerTo),
    via_layer_from: LSET.Name(item.m_ViaLayerFrom),
    via_layer_to: LSET.Name(item.m_ViaLayerTo),
    delay: item.m_Delay,
  });
};

const saveUserDefinedProfileConfigurationLine = (
  json_array: JsonValue[],
  item: TUNING_PROFILE,
): void => {
  const layer_entries: JsonValue[] = [];

  for (const trackEntry of item.m_TrackPropagationEntries) {
    const layer_json: JsonObject = {};

    layer_json.signal_layer = LSET.Name(trackEntry.m_signalLayer);
    layer_json.top_reference_layer = LSET.Name(trackEntry.m_topReferenceLayer);
    layer_json.bottom_reference_layer = LSET.Name(trackEntry.m_bottomReferenceLayer);
    layer_json.width = trackEntry.m_width;
    layer_json.diff_pair_gap = trackEntry.m_diffPairGap;
    layer_json.delay = trackEntry.m_delay;

    layer_entries.push(layer_json);
  }

  const via_overrides: JsonValue[] = [];

  for (const viaOverride of item.m_ViaOverrides)
    saveViaOverrideConfigurationLine(via_overrides, viaOverride);

  json_array.push({
    profile_name: item.m_ProfileName,
    type: item.m_Type as number,
    target_impedance: item.m_TargetImpedance,
    enable_time_domain_tuning: item.m_EnableTimeDomainTuning,
    layer_entries,
    via_prop_delay: item.m_ViaPropagationDelay,
    via_overrides,
  });
};

/**
 * `TUNING_PROFILES`, the `tuning_profiles` nested settings of the project
 * file: one param, `tuning_profiles_impedance_geometric`.
 */
export class TUNING_PROFILES extends NESTED_SETTINGS {
  private m_tuningProfiles: TUNING_PROFILE[] = [];
  private readonly m_nullDelayProfile = new TUNING_PROFILE();

  constructor(aParent: JSON_SETTINGS | null = null, aPath = 'tuning_profiles') {
    super('tuning_profiles', tuningParametersSchemaVersion, aParent, aPath, false);

    this.m_params.push(
      new PARAM_LAMBDA<JsonValue>(
        'tuning_profiles_impedance_geometric',
        () => {
          const ret: JsonValue[] = [];

          for (const entry of this.m_tuningProfiles)
            saveUserDefinedProfileConfigurationLine(ret, entry);

          return ret;
        },
        (aJson) => {
          if (!Array.isArray(aJson)) return;

          this.ClearTuningProfiles();

          for (const entry of aJson) {
            if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
            if (!('profile_name' in entry)) continue;

            this.m_tuningProfiles.push(readUserDefinedProfileConfigurationLine(entry));
          }
        },
        {},
      ),
    );

    if (aParent) this.LoadFromFile();
  }

  equals(aOther: TUNING_PROFILES): boolean {
    return (
      this.m_tuningProfiles.length === aOther.m_tuningProfiles.length &&
      this.m_tuningProfiles.every((p, i) => p.equals(aOther.m_tuningProfiles[i]!))
    );
  }

  ClearTuningProfiles(): void {
    this.m_tuningProfiles.length = 0;
  }

  AddTuningProfile(aTraceEntry: TUNING_PROFILE): void {
    this.m_tuningProfiles.push(aTraceEntry);
  }

  GetTuningProfiles(): readonly TUNING_PROFILE[] {
    return this.m_tuningProfiles;
  }

  GetTuningProfile(aProfileName: string): TUNING_PROFILE {
    const itr = this.m_tuningProfiles.find((aProfile) => aProfile.m_ProfileName === aProfileName);

    if (itr === undefined) return this.m_nullDelayProfile;

    return itr;
  }
}
