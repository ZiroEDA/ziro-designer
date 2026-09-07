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

import type { JSX } from 'react';
import { Combo } from '../../../../ui/Combo.js';
import { Icon } from '../../../../ui/icons.js';
import type {
  ClassCondition,
  ComponentClassAssignment,
  ComponentClassesData,
  ConditionType,
} from '../../board_settings.js';

// The data model lives in board_settings.ts (KiCad's data/UI split);
// re-exported so panel users keep importing from the panel module.
export {
  defaultComponentClasses,
  type ClassCondition,
  type ComponentClassAssignment,
  type ComponentClassesData,
  type ConditionType,
} from '../../board_settings.js';

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
      <label className="ze-pref-check">
        <input
          type="checkbox"
          checked={value.assignPerSheet}
          onChange={(e) => onChange({ ...value, assignPerSheet: e.target.checked })}
        />
        Assign component class per sheet
      </label>
      <div className="ze-pref-group-title ze-compclass-title">
        <span>Custom Assignments:</span>
        <button className="ze-btn" onClick={addAssignment}>
          Add Custom Assignment
        </button>
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
                  <button className="ze-btn" title="Not implemented yet">
                    Highlight matching footprints
                  </button>
                  <button
                    className="ze-gridbtn"
                    title="Delete assignment"
                    onClick={() => setAssignments(value.assignments.filter((_, j) => j !== i))}
                  >
                    <Icon name="delete" />
                  </button>
                </div>

                <div className="ze-pref-radiorow">
                  <label className="ze-pref-radio">
                    <input
                      type="radio"
                      name={`match-${i}`}
                      checked={a.matchMode === 'all'}
                      onChange={() => setAssignment(i, { matchMode: 'all' })}
                    />
                    Match all
                  </label>
                  <label className="ze-pref-radio">
                    <input
                      type="radio"
                      name={`match-${i}`}
                      checked={a.matchMode === 'any'}
                      onChange={() => setAssignment(i, { matchMode: 'any' })}
                    />
                    Match any
                  </label>
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
                      className="ze-gridbtn"
                      title="Delete row"
                      onClick={() => setConditions(a.conditions.filter((_, j) => j !== ci))}
                    >
                      <Icon name="delete" />
                    </button>
                  </div>
                ))}
                <button
                  className="ze-btn ze-compclass-addcond"
                  onClick={() => setConditions([...a.conditions, { type: 'Reference', value: '' }])}
                >
                  + Add condition
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
