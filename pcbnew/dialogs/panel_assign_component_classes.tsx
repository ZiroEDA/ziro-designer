// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_ASSIGN_COMPONENT_CLASSES`, `PANEL_COMPONENT_CLASS_ASSIGNMENT` and the seven
 * `PANEL_COMPONENT_CLASS_CONDITION_*` (pcbnew/dialogs/panel_assign_component_classes.cpp), Board
 * Setup > Design Rules > Component Classes, on their bases.
 *
 * Each assignment names a component class, Match all / Match any, and its conditions; a
 * condition is CONDITION_DATA, a primary field and for a footprint-field condition a secondary
 * one. The constructor reads the board's field names, sheet names and the selected footprints'
 * references; Highlight brightens the footprints the compiled rule matches, and the panel
 * unbrightens them all as it goes.
 */
import { type JSX, useEffect, useMemo, useState } from 'react';
import {
  COMPONENT_CLASS_ASSIGNMENT_DATA,
  CONDITION_TYPE,
  CONDITIONS_OPERATOR,
} from '@ziroeda/common/project/component_class_settings.js';
import type { PROJECT } from '@ziroeda/common/project.js';
import type { MenuItem } from '@ziroeda/wx/menu.js';
import { ContextMenu } from '@ziroeda/wx/menu_ui.js';
import { wxALL, wxBOTTOM, wxEXPAND, wxLEFT, wxRIGHT } from '@ziroeda/wx/defs.js';
import { SizerItem } from '@ziroeda/wx/sizer.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { COMPONENT_CLASS_MANAGER } from '../component_classes/component_class_manager.js';
import type { FOOTPRINT } from '../footprint.js';
import type { PCB_EDIT_FRAME } from '../pcb_edit_frame.js';
import {
  PANEL_ASSIGN_COMPONENT_CLASSES_BASE,
  PANEL_COMPONENT_CLASS_ASSIGNMENT_BASE,
  PANEL_COMPONENT_CLASS_CONDITION_CUSTOM_BASE,
  PANEL_COMPONENT_CLASS_CONDITION_FIELD_BASE,
  PANEL_COMPONENT_CLASS_CONDITION_FOOTPRINT_BASE,
  PANEL_COMPONENT_CLASS_CONDITION_REFERENCE_BASE,
  PANEL_COMPONENT_CLASS_CONDITION_ROTATION_BASE,
  PANEL_COMPONENT_CLASS_CONDITION_SHEET_BASE,
  PANEL_COMPONENT_CLASS_CONDITION_SIDE_BASE,
} from './panel_assign_component_classes_base.js';
import { wxGetTranslation } from '@ziroeda/wx/translation.js';
import { _HKI } from '@ziroeda/include/i18n_utility.js';

/** One condition panel's CONDITION_DATA: its type and the two controls' text. */
export interface ClassCondition {
  type: CONDITION_TYPE;
  primary: string;
  secondary: string;
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

/**
 * `CONDITION_DATA::GetPrimaryField` / `GetSecondaryField`: trimmed, and with every quote dropped
 * unless the condition is a custom expression.
 */
function conditionField(aType: CONDITION_TYPE, aText: string): string {
  const data = aText.trim();
  return aType === CONDITION_TYPE.CUSTOM ? data : data.replace(/["']/g, '');
}

/** `PANEL_COMPONENT_CLASS_ASSIGNMENT::GenerateAssignmentData`. */
export function GenerateAssignmentData(
  a: ComponentClassAssignment,
): COMPONENT_CLASS_ASSIGNMENT_DATA {
  const data = new COMPONENT_CLASS_ASSIGNMENT_DATA();
  data.SetComponentClass(a.componentClass);
  data.SetConditionsOperation(
    a.matchMode === 'any' ? CONDITIONS_OPERATOR.ANY : CONDITIONS_OPERATOR.ALL,
  );
  for (const c of a.conditions)
    data.AddCondition(
      c.type,
      conditionField(c.type, c.primary),
      conditionField(c.type, c.secondary),
    );
  return data;
}

/** PANEL_ASSIGN_COMPONENT_CLASSES's transfers and Validate. */
export const PANEL_ASSIGN_COMPONENT_CLASSES = {
  TransferDataToWindow(aProject: PROJECT): ComponentClassesData {
    const ccs = aProject.GetProjectFile().ComponentClassSettings();
    return {
      assignPerSheet: ccs.GetEnableSheetComponentClasses(),
      assignments: ccs.GetComponentClassAssignments().map((a) => ({
        componentClass: a.GetComponentClass(),
        matchMode: a.GetConditionsOperator() === CONDITIONS_OPERATOR.ANY ? 'any' : 'all',
        conditions: a
          .GetConditions()
          .map(([type, primary, secondary]) => ({ type, primary, secondary })),
      })),
    };
  },

  TransferDataFromWindow(v: ComponentClassesData, aProject: PROJECT): void {
    const ccs = aProject.GetProjectFile().ComponentClassSettings();
    ccs.SetEnableSheetComponentClasses(v.assignPerSheet);
    ccs.ClearComponentClassAssignments();
    for (const a of v.assignments) ccs.AddComponentClassAssignment(GenerateAssignmentData(a));
  },

  /** `Validate`: the first assignment whose rule does not compile, or null. */
  Validate(v: ComponentClassesData): { index: number; message: string } | null {
    for (const [index, a] of v.assignments.entries()) {
      if (!COMPONENT_CLASS_MANAGER.CompileAssignmentRule(GenerateAssignmentData(a)))
        return {
          index,
          message: `Error with conditions for component class assignment ${a.componentClass}`,
        };
    }
    return null;
  },
};

/** The condition panels' constructors' starting text. */
function newCondition(aType: CONDITION_TYPE): ClassCondition {
  // m_side->SetValue( "Any" ), m_rotation->SetValue( "Any" ).
  const primary = aType === CONDITION_TYPE.SIDE || aType === CONDITION_TYPE.ROTATION ? 'Any' : '';
  return { type: aType, primary, secondary: '' };
}

/** `OnAddConditionClick`'s menu, in its order. */
const ADD_CONDITION_MENU: readonly [CONDITION_TYPE, string][] = [
  [CONDITION_TYPE.REFERENCE, _HKI('Add Reference Condition')],
  [CONDITION_TYPE.FOOTPRINT, _HKI('Add Footprint Condition')],
  [CONDITION_TYPE.SIDE, _HKI('Add Side Condition')],
  [CONDITION_TYPE.ROTATION, _HKI('Add Rotation Condition')],
  [CONDITION_TYPE.FOOTPRINT_FIELD, _HKI('Add Footprint Field Value Condition')],
  [CONDITION_TYPE.SHEET_NAME, _HKI('Add Sheet Condition')],
  [CONDITION_TYPE.CUSTOM, _HKI('Add Custom Expression Condition')],
];

/** The labels' common minimum: `GetTextExtent( _( "Footprint Field:" ) + "M" )`. */
const TITLE_MIN = 'Footprint Field:M';

/** `wxString::Cmp( b ) < 0`: by code unit. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

interface Props {
  value: ComponentClassesData;
  onChange: (next: ComponentClassesData) => void;
  /** m_frame: the board the constructor reads, its selection, and the canvas Highlight paints. */
  frame?: PCB_EDIT_FRAME | null;
}

/** PANEL_ASSIGN_COMPONENT_CLASSES's window. */
export function PanelPcbComponentClasses({ value, onChange, frame = null }: Props): JSX.Element {
  // The constructor: the footprints' field names and sheet names, and the selection's references,
  // each sorted.
  const { fieldNames, sheetNames, selectionRefs } = useMemo(() => {
    const fields = new Set<string>();
    const sheets = new Set<string>();
    const refs = new Set<string>();
    for (const fp of frame?.GetBoard()?.Footprints() ?? []) {
      // It strips the quotes from sheetName and then inserts GetSheetname() as it was.
      if (fp.GetSheetname() !== '') sheets.add(fp.GetSheetname());
      for (const field of fp.GetFields()) fields.add(field.GetName());
    }
    for (const item of frame?.GetSelectionTool().GetSelection().Items() ?? [])
      if (item.Type() === KICAD_T.PCB_FOOTPRINT_T)
        refs.add((item as unknown as FOOTPRINT).GetReferenceAsString());
    return {
      fieldNames: [...fields].sort(cmp),
      sheetNames: [...sheets].sort(cmp),
      selectionRefs: [...refs].sort(cmp),
    };
  }, [frame]);

  // The destructor: every footprint unbrightened, and the canvas refreshed.
  useEffect(
    () => () => {
      if (!frame) return;
      const selTool = frame.GetSelectionTool();
      for (const fp of frame.GetBoard()?.Footprints() ?? []) selTool.UnbrightenItem(fp);
      frame.GetCanvas()?.Refresh();
    },
    [frame],
  );

  const [menu, setMenu] = useState<{ items: MenuItem[]; x: number; y: number } | null>(null);
  const popup = (aAnchor: HTMLElement, aItems: MenuItem[]): void => {
    const r = aAnchor.getBoundingClientRect();
    setMenu({ items: aItems, x: r.left, y: r.bottom });
  };

  const setAssignments = (aNext: ComponentClassAssignment[]): void =>
    onChange({ ...value, assignments: aNext });
  const setAssignment = (i: number, aPatch: Partial<ComponentClassAssignment>): void =>
    setAssignments(value.assignments.map((a, j) => (j === i ? { ...a, ...aPatch } : a)));

  /** `OnHighlightItemsClick`. */
  const highlight = (a: ComponentClassAssignment): void => {
    const board = frame?.GetBoard();
    if (!frame || !board) return;
    const rule = COMPONENT_CLASS_MANAGER.CompileAssignmentRule(GenerateAssignmentData(a));
    if (!rule) return;
    const selTool = frame.GetSelectionTool();
    for (const fp of board.Footprints()) {
      if (rule.Matches(fp)) selTool.BrightenItem(fp);
      else selTool.UnbrightenItem(fp);
    }
    frame.GetCanvas()?.Refresh();
  };

  const condition = (
    i: number,
    a: ComponentClassAssignment,
    k: number,
    c: ClassCondition,
  ): JSX.Element => {
    const setC = (aPatch: Partial<ClassCondition>): void =>
      setAssignment(i, {
        conditions: a.conditions.map((x, j) => (j === k ? { ...x, ...aPatch } : x)),
      });
    const primary = { value: c.primary, onChange: (aText: string) => setC({ primary: aText }) };
    const common = {
      key: k,
      titleMinWidth: TITLE_MIN,
      // RemoveCondition
      onDeleteConditionClick: () =>
        setAssignment(i, { conditions: a.conditions.filter((_, j) => j !== k) }),
    };

    switch (c.type) {
      case CONDITION_TYPE.REFERENCE:
        return (
          <PANEL_COMPONENT_CLASS_CONDITION_REFERENCE_BASE
            {...common}
            m_refs={primary}
            onImportRefsClick={(aAnchor) =>
              popup(aAnchor, [
                {
                  label: wxGetTranslation('Import references from selection'),
                  disabled: selectionRefs.length === 0,
                  // onMenu: the selection's references, comma separated.
                  action: () =>
                    selectionRefs.length > 0 && setC({ primary: selectionRefs.join(',') }),
                },
              ])
            }
          />
        );
      case CONDITION_TYPE.FOOTPRINT:
        return (
          <PANEL_COMPONENT_CLASS_CONDITION_FOOTPRINT_BASE
            {...common}
            m_footprint={primary}
            // OnShowLibraryClick: the footprint chooser, on the current text.
            onShowLibraryClick={() =>
              void frame
                ?.selectFootprintFromChooser?.(c.primary)
                .then((fpId) => fpId !== null && setC({ primary: fpId }))
            }
          />
        );
      case CONDITION_TYPE.SIDE:
        return (
          <PANEL_COMPONENT_CLASS_CONDITION_SIDE_BASE
            {...common}
            m_side={primary}
            choices={['Any', 'Front', 'Back']}
          />
        );
      case CONDITION_TYPE.ROTATION:
        return (
          <PANEL_COMPONENT_CLASS_CONDITION_ROTATION_BASE
            {...common}
            m_rotation={primary}
            choices={['Any', '0', '90', '180', '-90']}
            // m_rotUnit->SetLabel( "°" )
            m_rotUnit="°"
          />
        );
      case CONDITION_TYPE.FOOTPRINT_FIELD:
        return (
          <PANEL_COMPONENT_CLASS_CONDITION_FIELD_BASE
            {...common}
            m_fieldName={primary}
            fields={fieldNames}
            m_fieldValue={{ value: c.secondary, onChange: (aText) => setC({ secondary: aText }) }}
          />
        );
      case CONDITION_TYPE.CUSTOM:
        return (
          <PANEL_COMPONENT_CLASS_CONDITION_CUSTOM_BASE {...common} m_customCondition={primary} />
        );
      case CONDITION_TYPE.SHEET_NAME:
        return (
          <PANEL_COMPONENT_CLASS_CONDITION_SHEET_BASE
            {...common}
            m_sheetName={primary}
            sheets={sheetNames}
          />
        );
    }
  };

  return (
    <>
      <PANEL_ASSIGN_COMPONENT_CLASSES_BASE
        m_assignSheetClasses={{
          value: value.assignPerSheet,
          onChange: (aOn) => onChange({ ...value, assignPerSheet: aOn }),
        }}
        // OnAddAssignmentClick: a new, empty assignment at the end.
        onAddAssignmentClick={() =>
          setAssignments([
            ...value.assignments,
            { componentClass: '', matchMode: 'all', conditions: [] },
          ])
        }
        m_assignmentsList={value.assignments.map((a, i) => (
          // addAssignment: Add( panel, 0, wxEXPAND | wxLEFT | wxRIGHT | wxBOTTOM, 5 ).
          <SizerItem key={i} flag={wxEXPAND | wxLEFT | wxRIGHT | wxBOTTOM} border={5}>
            <PANEL_COMPONENT_CLASS_ASSIGNMENT_BASE
              m_componentClass={{
                value: a.componentClass,
                onChange: (aText) => setAssignment(i, { componentClass: aText }),
              }}
              // RemoveAssignment
              onDeleteAssignmentClick={() =>
                setAssignments(value.assignments.filter((_, j) => j !== i))
              }
              // AddCondition: Insert( numItems - 1, panel, 0, wxEXPAND | wxALL, 5 ), before bSizer3.
              conditions={a.conditions.map((c, k) => (
                <SizerItem key={k} flag={wxEXPAND | wxALL} border={5}>
                  {condition(i, a, k, c)}
                </SizerItem>
              ))}
              onAddConditionClick={(aAnchor) =>
                popup(
                  aAnchor,
                  ADD_CONDITION_MENU.map(([type, label]) => ({
                    label,
                    action: () =>
                      setAssignment(i, { conditions: [...a.conditions, newCondition(type)] }),
                  })),
                )
              }
              onHighlightItemsClick={() => highlight(a)}
              matchAll={a.matchMode === 'all'}
              onMatchAll={(aAll) => setAssignment(i, { matchMode: aAll ? 'all' : 'any' })}
              groupName={`ze-ccassign-${i}`}
            />
          </SizerItem>
        ))}
      />
      {menu && (
        <ContextMenu items={menu.items} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />
      )}
    </>
  );
}
