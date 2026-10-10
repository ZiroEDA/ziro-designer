// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Design Rules > Component Classes. Counterpart:
 * `pcbnew/dialogs/panel_assign_component_classes_base.cpp`
 * (PANEL_ASSIGN_COMPONENT_CLASSES + PANEL_COMPONENT_CLASS_ASSIGNMENT), an
 * "Assign component class per sheet" option and a list of custom assignments.
 * Each assignment names a component class, a Match all / Match any mode, and a
 * set of conditions (Reference / Side / Rotation / Footprint) that select the
 * footprints it applies to.
 *
 * NO FONT SIZES AND NO COLOURS: nothing in either panel calls SetFont, so the
 * 12.5px on six rows here, the `var(--ze-muted, #888)` empty state and the two
 * native `<select>`s were all ours. The condition rows are the shared `Combo`
 * (`ui/Combo.tsx`), the radio pair is `.ze-pref-radiorow` and the heading is
 * `.ze-pref-group-title`, which draws the wxStaticLine this had inline.
 */

import { Button, CheckBox, RadioButton } from '@ziroeda/common/wx/controls.js';
import type { JSX } from 'react';
import { Combo } from '@ziroeda/common/widgets/wx_combobox.js';
import { Icon } from '@ziroeda/common/widgets/icons.js';
import type { PROJECT } from '@ziroeda/common/project.js';
import {
  COMPONENT_CLASS_ASSIGNMENT_DATA,
  CONDITION_TYPE,
  CONDITIONS_OPERATOR,
} from '@ziroeda/common/project/component_class_settings.js';

export type ConditionType = 'Reference' | 'Side' | 'Rotation' | 'Footprint';

export interface ClassCondition {
  type: ConditionType;
  value: string;
}
export interface ComponentClassAssignment {
  componentClass: string;
  matchMode: 'all' | 'any';
  conditions: ClassCondition[];
}
export interface ComponentClassesData {
  assignPerSheet: boolean;
  assignments: ComponentClassAssignment[];
}

/** `COMPONENT_CLASS_ASSIGNMENT_DATA::GetConditionName` <-> the panel's labels. */
const CONDITION_LABELS: readonly [CONDITION_TYPE, string][] = [
  [CONDITION_TYPE.REFERENCE, 'Reference'],
  [CONDITION_TYPE.SIDE, 'Side'],
  [CONDITION_TYPE.ROTATION, 'Rotation'],
  [CONDITION_TYPE.FOOTPRINT, 'Footprint'],
  [CONDITION_TYPE.FOOTPRINT_FIELD, 'Footprint Field'],
  [CONDITION_TYPE.CUSTOM, 'Custom'],
  [CONDITION_TYPE.SHEET_NAME, 'Sheet Name'],
];

/** PANEL_ASSIGN_COMPONENT_CLASSES's transfers (panel_assign_component_classes.cpp). */
export const PANEL_ASSIGN_COMPONENT_CLASSES = {
  TransferDataToWindow(aProject: PROJECT): ComponentClassesData {
    const ccs = aProject.GetProjectFile().ComponentClassSettings();
    return {
      assignPerSheet: ccs.GetEnableSheetComponentClasses(),
      assignments: ccs.GetComponentClassAssignments().map((a) => ({
        componentClass: a.GetComponentClass(),
        matchMode: a.GetConditionsOperator() === CONDITIONS_OPERATOR.ANY ? 'any' : 'all',
        conditions: a.GetConditions().map(([type, primary]) => ({
          type: (CONDITION_LABELS.find(([t]) => t === type)?.[1] ?? 'Reference') as ConditionType,
          value: primary,
        })),
      })),
    };
  },

  TransferDataFromWindow(v: ComponentClassesData, aProject: PROJECT): void {
    const ccs = aProject.GetProjectFile().ComponentClassSettings();
    ccs.SetEnableSheetComponentClasses(v.assignPerSheet);
    ccs.ClearComponentClassAssignments();
    for (const a of v.assignments) {
      const data = new COMPONENT_CLASS_ASSIGNMENT_DATA();
      data.SetComponentClass(a.componentClass);
      data.SetConditionsOperation(
        a.matchMode === 'any' ? CONDITIONS_OPERATOR.ANY : CONDITIONS_OPERATOR.ALL,
      );
      for (const c of a.conditions) {
        const type =
          CONDITION_LABELS.find(([, label]) => label === c.type)?.[0] ?? CONDITION_TYPE.REFERENCE;
        data.AddCondition(type, c.value, '');
      }
      ccs.AddComponentClassAssignment(data);
    }
  },
};

const CONDITION_TYPES: ConditionType[] = ['Reference', 'Side', 'Rotation', 'Footprint'];
const SIDES = ['Front', 'Back'];

interface Props {
  value: ComponentClassesData;
  onChange: (next: ComponentClassesData) => void;
}

export function PanelPcbComponentClasses({ value, onChange }: Props): JSX.Element {
  const setAssignments = (assignments: ComponentClassAssignment[]): void =>
    onChange({ ...value, assignments });
  const setAssignment = (i: number, patch: Partial<ComponentClassAssignment>): void =>
    setAssignments(value.assignments.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const addAssignment = (): void =>
    setAssignments([
      ...value.assignments,
      { componentClass: '', matchMode: 'all', conditions: [{ type: 'Reference', value: '' }] },
    ]);

  return (
    <div className="ze-compclass">
      <CheckBox
        label="Assign component class per sheet"
        checked={value.assignPerSheet}
        className="ze-pref-check"
        onChange={(aChecked) => onChange({ ...value, assignPerSheet: aChecked })}
      />
      <div className="ze-pref-group-title ze-compclass-title">
        <span>Custom Assignments:</span>
        <Button label="Add Custom Assignment" onClick={addAssignment} />
      </div>

      {/* Assignment cards */}
      <div className="ze-compclass-list">
        {value.assignments.length === 0 ? (
          <div className="ze-compclass-empty">
            No custom assignments. Use “Add Custom Assignment” to create one.
          </div>
        ) : (
          value.assignments.map((a, i) => {
            const setConditions = (conditions: ClassCondition[]): void =>
              setAssignment(i, { conditions });
            return (
              <div key={i} className="ze-compclass-card">
                <div className="ze-compclass-row">
                  <span>Component class:</span>
                  <input
                    className="ze-search ze-compclass-name"
                    value={a.componentClass}
                    onChange={(e) => setAssignment(i, { componentClass: e.target.value })}
                  />
                  <span className="ze-compclass-spacer" />
                  <Button label="Highlight matching footprints" title="Not implemented yet" />
                  <button
                    type="button"
                    className="ze-gridbtn"
                    title="Delete assignment"
                    onClick={() => setAssignments(value.assignments.filter((_, j) => j !== i))}
                  >
                    <Icon name="delete" />
                  </button>
                </div>

                <div className="ze-pref-radiorow">
                  <RadioButton
                    label="Match all"
                    name={`match-${i}`}
                    checked={a.matchMode === 'all'}
                    className="ze-pref-radio"
                    onChange={() => setAssignment(i, { matchMode: 'all' })}
                  />
                  <RadioButton
                    label="Match any"
                    name={`match-${i}`}
                    checked={a.matchMode === 'any'}
                    className="ze-pref-radio"
                    onChange={() => setAssignment(i, { matchMode: 'any' })}
                  />
                </div>

                {/* Condition rows */}
                {a.conditions.map((c, ci) => (
                  <div key={ci} className="ze-compclass-row">
                    <Combo
                      value={c.type}
                      ariaLabel="Condition type"
                      options={CONDITION_TYPES.map((t) => ({ value: t, label: t }))}
                      onChange={(t) =>
                        setConditions(
                          a.conditions.map((x, j) =>
                            j === ci ? { ...x, type: t as ConditionType } : x,
                          ),
                        )
                      }
                    />
                    {c.type === 'Side' ? (
                      <Combo
                        className="ze-compclass-grow"
                        value={c.value || 'Front'}
                        ariaLabel="Side"
                        options={SIDES.map((x) => ({ value: x, label: x }))}
                        onChange={(val) =>
                          setConditions(
                            a.conditions.map((x, j) => (j === ci ? { ...x, value: val } : x)),
                          )
                        }
                      />
                    ) : (
                      <input
                        className="ze-search ze-compclass-grow"
                        value={c.value}
                        placeholder={
                          c.type === 'Rotation'
                            ? 'degrees'
                            : c.type === 'Footprint'
                              ? 'Library:Footprint'
                              : 'e.g. R*'
                        }
                        onChange={(e) =>
                          setConditions(
                            a.conditions.map((x, j) =>
                              j === ci ? { ...x, value: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    )}
                    <button
                      type="button"
                      className="ze-gridbtn"
                      title="Delete row"
                      onClick={() => setConditions(a.conditions.filter((_, j) => j !== ci))}
                    >
                      <Icon name="delete" />
                    </button>
                  </div>
                ))}
                <Button
                  label="+ Add condition"
                  className="ze-compclass-addcond"
                  onClick={() => setConditions([...a.conditions, { type: 'Reference', value: '' }])}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
