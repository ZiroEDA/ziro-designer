// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * pcbnew/dialogs/panel_assign_component_classes_base.cpp, Add() for Add(): the Component Classes
 * page (PANEL_ASSIGN_COMPONENT_CLASSES_BASE), one assignment (PANEL_COMPONENT_CLASS_ASSIGNMENT_BASE)
 * and the seven condition rows (PANEL_COMPONENT_CLASS_CONDITION_*_BASE). The assignment and the
 * conditions are panels on wxSYS_COLOUR_3DLIGHT. The behaviour is the classes'
 * (panel_assign_component_classes.tsx).
 */
import type { JSX, ReactNode } from 'react';
import { StdBitmapButton } from '@ziroeda/common/widgets/std_bitmap_button.js';
import { Combo, TextCombo } from '@ziroeda/wx/combobox.js';
import {
  Button,
  CheckBox,
  type CHECK,
  Panel,
  RadioButton,
  StaticLine,
  StaticText,
  TextCtrl,
} from '@ziroeda/wx/controls.js';
import {
  wxALIGN_CENTER_VERTICAL,
  wxALL,
  wxBOTTOM,
  wxEXPAND,
  wxHORIZONTAL,
  wxLEFT,
  wxRIGHT,
  wxTOP,
  wxVERTICAL,
} from '@ziroeda/wx/defs.js';
import { ScrolledWindow } from '@ziroeda/wx/scrolwin.js';
import { BoxSizer, FlexGridSizer, SizerItem, Spacer } from '@ziroeda/wx/sizer.js';
import { _ } from '@ziroeda/wx/translation.js';

const CV = wxALIGN_CENTER_VERTICAL;

type ENTRY = { value: string; onChange: (aText: string) => void };

/** `PANEL_ASSIGN_COMPONENT_CLASSES_BASE` */
export function PANEL_ASSIGN_COMPONENT_CLASSES_BASE(p: {
  m_assignSheetClasses: CHECK;
  onAddAssignmentClick: () => void;
  /** What the class Add()s to m_assignmentsList: the assignment panels. */
  m_assignmentsList: ReactNode;
}): JSX.Element {
  return (
    // bSizerMain
    <BoxSizer orient={wxVERTICAL}>
      <SizerItem flag={wxALL} border={10}>
        <CheckBox label={_('Assign component class per sheet')} check={p.m_assignSheetClasses} />
      </SizerItem>
      <SizerItem flag={wxEXPAND | wxLEFT | wxRIGHT} border={5}>
        <StaticLine />
      </SizerItem>
      <SizerItem flag={wxEXPAND | wxALL} border={5}>
        {/* bSizer12 */}
        <BoxSizer orient={wxHORIZONTAL}>
          <SizerItem flag={CV | wxLEFT | wxRIGHT} border={5}>
            <StaticText label={_('Custom Assignments:')} />
          </SizerItem>
          <Spacer width={0} height={0} proportion={1} flag={wxBOTTOM | wxEXPAND} border={5} />
          <SizerItem border={5}>
            <Button label={_('Add Custom Assignment')} onClick={p.onAddAssignmentClick} />
          </SizerItem>
        </BoxSizer>
      </SizerItem>
      <SizerItem proportion={1} flag={wxALL | wxEXPAND} border={5}>
        {/* m_assignmentsScrollWindow, wxHSCROLL|wxVSCROLL */}
        <ScrolledWindow>
          {/* m_assignmentsList */}
          <BoxSizer orient={wxVERTICAL}>{p.m_assignmentsList}</BoxSizer>
        </ScrolledWindow>
      </SizerItem>
    </BoxSizer>
  );
}

/** The assignment and condition panels' SetBackgroundColour( wxSYS_COLOUR_3DLIGHT ). */
function LightPanel({ children }: { children: ReactNode }): JSX.Element {
  return <Panel background="3dlight">{children}</Panel>;
}

/** `PANEL_COMPONENT_CLASS_ASSIGNMENT_BASE` */
export function PANEL_COMPONENT_CLASS_ASSIGNMENT_BASE(p: {
  m_componentClass: ENTRY;
  onDeleteAssignmentClick: () => void;
  /** What the class Insert()s before bSizer3: the condition panels. */
  conditions: ReactNode;
  onAddConditionClick: (aAnchor: HTMLElement) => void;
  onHighlightItemsClick: () => void;
  /** m_radioAll / m_radioAny: true is Match all. */
  matchAll: boolean;
  onMatchAll: (aAll: boolean) => void;
  /** The radio pair's DOM group name, unique per assignment. */
  groupName: string;
}): JSX.Element {
  return (
    <LightPanel>
      {/* bSizer13 */}
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxEXPAND | wxTOP} border={5}>
          {/* bSizer131 */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={CV | wxLEFT | wxRIGHT} border={5}>
              <StaticText label={_('Component class:')} ellipsize />
            </SizerItem>
            <SizerItem proportion={1} flag={wxEXPAND} border={5}>
              <TextCtrl
                value={p.m_componentClass.value}
                onChange={p.m_componentClass.onChange}
                ariaLabel="Component class"
              />
            </SizerItem>
            <Spacer width={20} height={0} flag={wxEXPAND} border={5} />
            <SizerItem flag={CV | wxRIGHT | wxLEFT} border={5}>
              <StdBitmapButton
                bitmap="small_trash"
                title={_('Delete row')}
                onClick={p.onDeleteAssignmentClick}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
        {p.conditions}
        <SizerItem flag={wxEXPAND | wxTOP | wxBOTTOM} border={5}>
          {/* bSizer3 */}
          <BoxSizer orient={wxHORIZONTAL}>
            <SizerItem flag={CV | wxLEFT} border={5}>
              <StdBitmapButton
                bitmap="small_plus"
                title="Add condition"
                tooltip={null}
                onClick={(e) => p.onAddConditionClick(e.currentTarget)}
              />
            </SizerItem>
            <Spacer width={30} height={0} proportion={1} flag={wxEXPAND} border={5} />
            <SizerItem flag={CV | wxRIGHT | wxLEFT} border={5}>
              <StdBitmapButton
                bitmap="net_highlight"
                title={_('Highlight matching footprints')}
                onClick={p.onHighlightItemsClick}
              />
            </SizerItem>
            <SizerItem flag={wxALL | wxEXPAND} border={5}>
              <StaticLine vertical />
            </SizerItem>
            <Spacer width={5} height={0} flag={wxEXPAND} border={5} />
            <SizerItem flag={CV | wxLEFT} border={5}>
              <RadioButton
                label={_('Match all')}
                name={p.groupName}
                checked={p.matchAll}
                onChange={() => p.onMatchAll(true)}
              />
            </SizerItem>
            <SizerItem flag={CV | wxLEFT | wxRIGHT} border={5}>
              <RadioButton
                label={_('Match any')}
                name={p.groupName}
                checked={!p.matchAll}
                onChange={() => p.onMatchAll(false)}
              />
            </SizerItem>
          </BoxSizer>
        </SizerItem>
      </BoxSizer>
    </LightPanel>
  );
}

/**
 * One PANEL_COMPONENT_CLASS_CONDITION_*_BASE: bSizerN around m_conditionSizer, a flex grid growing
 * column 1, the title first and the delete button last. `cells` are the grid's middle cells.
 */
function ConditionBase({
  cols,
  growableCols = [1],
  title,
  titleMinWidth,
  cells,
  onDeleteConditionClick,
  deleteFlag = CV | wxRIGHT,
}: {
  cols: number;
  growableCols?: number[];
  title: string;
  /** The class's m_title->SetMinSize( GetTextExtent( "Footprint Field:" + "M" ) ). */
  titleMinWidth: string;
  cells: ReactNode;
  onDeleteConditionClick: () => void;
  deleteFlag?: number;
}): JSX.Element {
  return (
    <LightPanel>
      <BoxSizer orient={wxVERTICAL}>
        <SizerItem flag={wxBOTTOM | wxEXPAND | wxTOP} border={5}>
          <FlexGridSizer cols={cols} growableCols={growableCols}>
            <SizerItem flag={CV | wxLEFT} border={5}>
              <StaticText label={title} ellipsize minWidthText={titleMinWidth} />
            </SizerItem>
            {cells}
            <SizerItem flag={deleteFlag} border={5}>
              <StdBitmapButton
                bitmap="small_trash"
                title={_('Delete row')}
                onClick={onDeleteConditionClick}
              />
            </SizerItem>
          </FlexGridSizer>
        </SizerItem>
      </BoxSizer>
    </LightPanel>
  );
}

/** The cells every condition panel shares. */
interface CONDITION_PROPS {
  titleMinWidth: string;
  onDeleteConditionClick: () => void;
}

const gap = <Spacer width={20} height={0} proportion={1} flag={wxEXPAND} border={5} />;

/** `PANEL_COMPONENT_CLASS_CONDITION_REFERENCE_BASE` */
export function PANEL_COMPONENT_CLASS_CONDITION_REFERENCE_BASE(
  p: CONDITION_PROPS & { m_refs: ENTRY; onImportRefsClick: (aAnchor: HTMLElement) => void },
): JSX.Element {
  return (
    <ConditionBase
      cols={5}
      title={_('Reference:')}
      titleMinWidth={p.titleMinWidth}
      onDeleteConditionClick={p.onDeleteConditionClick}
      cells={
        <>
          <SizerItem flag={wxEXPAND | wxLEFT} border={5}>
            <TextCtrl value={p.m_refs.value} onChange={p.m_refs.onChange} ariaLabel="Reference" />
          </SizerItem>
          <SizerItem flag={CV | wxLEFT} border={5}>
            <StdBitmapButton
              bitmap="config"
              title={_('Import references')}
              onClick={(e) => p.onImportRefsClick(e.currentTarget)}
            />
          </SizerItem>
          {gap}
        </>
      }
    />
  );
}

/** `PANEL_COMPONENT_CLASS_CONDITION_SIDE_BASE`: m_side, a read-only wxComboBox. */
export function PANEL_COMPONENT_CLASS_CONDITION_SIDE_BASE(
  p: CONDITION_PROPS & { m_side: ENTRY; choices: readonly string[] },
): JSX.Element {
  return (
    <ConditionBase
      cols={4}
      title={_('Side:')}
      titleMinWidth={p.titleMinWidth}
      onDeleteConditionClick={p.onDeleteConditionClick}
      deleteFlag={CV | wxLEFT | wxRIGHT}
      cells={
        <>
          <SizerItem flag={wxEXPAND | wxLEFT} border={5}>
            <Combo
              value={p.m_side.value}
              options={p.choices.map((c) => ({ value: c, label: c }))}
              onChange={p.m_side.onChange}
              ariaLabel="Side"
            />
          </SizerItem>
          {gap}
        </>
      }
    />
  );
}

/** `PANEL_COMPONENT_CLASS_CONDITION_ROTATION_BASE`: m_rotation, an editable wxComboBox. */
export function PANEL_COMPONENT_CLASS_CONDITION_ROTATION_BASE(
  p: CONDITION_PROPS & { m_rotation: ENTRY; choices: readonly string[]; m_rotUnit: string },
): JSX.Element {
  return (
    <ConditionBase
      cols={5}
      title={_('Rotation:')}
      titleMinWidth={p.titleMinWidth}
      onDeleteConditionClick={p.onDeleteConditionClick}
      cells={
        <>
          <SizerItem flag={wxEXPAND | wxLEFT} border={5}>
            <TextCombo
              value={p.m_rotation.value}
              options={p.choices}
              onChange={p.m_rotation.onChange}
              ariaLabel={_('Rotation')}
            />
          </SizerItem>
          <SizerItem flag={CV | wxLEFT} border={5}>
            <StaticText label={p.m_rotUnit} />
          </SizerItem>
          {gap}
        </>
      }
    />
  );
}

/** `PANEL_COMPONENT_CLASS_CONDITION_FOOTPRINT_BASE` */
export function PANEL_COMPONENT_CLASS_CONDITION_FOOTPRINT_BASE(
  p: CONDITION_PROPS & { m_footprint: ENTRY; onShowLibraryClick: () => void },
): JSX.Element {
  return (
    <ConditionBase
      cols={6}
      title={_('Footprint:')}
      titleMinWidth={p.titleMinWidth}
      onDeleteConditionClick={p.onDeleteConditionClick}
      cells={
        <>
          <SizerItem flag={wxEXPAND | wxLEFT} border={5}>
            <TextCtrl
              value={p.m_footprint.value}
              onChange={p.m_footprint.onChange}
              ariaLabel="Footprint"
            />
          </SizerItem>
          <SizerItem flag={CV | wxLEFT} border={5}>
            <StdBitmapButton
              bitmap="small_library"
              title={_('Show library')}
              onClick={p.onShowLibraryClick}
            />
          </SizerItem>
          {gap}
        </>
      }
    />
  );
}

/** `PANEL_COMPONENT_CLASS_CONDITION_FIELD_BASE`: m_fieldName an editable wxComboBox. */
export function PANEL_COMPONENT_CLASS_CONDITION_FIELD_BASE(
  p: CONDITION_PROPS & { m_fieldName: ENTRY; fields: readonly string[]; m_fieldValue: ENTRY },
): JSX.Element {
  return (
    <ConditionBase
      cols={7}
      growableCols={[1, 4]}
      title={_('Footprint field:')}
      titleMinWidth={p.titleMinWidth}
      onDeleteConditionClick={p.onDeleteConditionClick}
      cells={
        <>
          <SizerItem flag={wxEXPAND | wxLEFT} border={5}>
            <TextCombo
              value={p.m_fieldName.value}
              options={p.fields}
              onChange={p.m_fieldName.onChange}
              ariaLabel="Footprint field"
            />
          </SizerItem>
          <Spacer width={10} height={0} proportion={1} flag={wxEXPAND} border={5} />
          <SizerItem flag={CV | wxLEFT} border={5}>
            <StaticText label={_('Field value:')} ellipsize />
          </SizerItem>
          <SizerItem flag={wxEXPAND | wxLEFT} border={5}>
            <TextCtrl
              value={p.m_fieldValue.value}
              onChange={p.m_fieldValue.onChange}
              ariaLabel="Field value"
            />
          </SizerItem>
          {gap}
        </>
      }
    />
  );
}

/** `PANEL_COMPONENT_CLASS_CONDITION_CUSTOM_BASE` */
export function PANEL_COMPONENT_CLASS_CONDITION_CUSTOM_BASE(
  p: CONDITION_PROPS & { m_customCondition: ENTRY },
): JSX.Element {
  return (
    <ConditionBase
      cols={4}
      title={_('Custom:')}
      titleMinWidth={p.titleMinWidth}
      onDeleteConditionClick={p.onDeleteConditionClick}
      cells={
        <>
          <SizerItem flag={wxEXPAND | wxLEFT} border={5}>
            <TextCtrl
              value={p.m_customCondition.value}
              onChange={p.m_customCondition.onChange}
              ariaLabel="Custom"
            />
          </SizerItem>
          <Spacer width={20} height={0} flag={wxEXPAND} border={5} />
        </>
      }
    />
  );
}

/** `PANEL_COMPONENT_CLASS_CONDITION_SHEET_BASE`: m_sheetName, a read-only wxComboBox. */
export function PANEL_COMPONENT_CLASS_CONDITION_SHEET_BASE(
  p: CONDITION_PROPS & { m_sheetName: ENTRY; sheets: readonly string[] },
): JSX.Element {
  return (
    <ConditionBase
      cols={4}
      title={_('Sheet name:')}
      titleMinWidth={p.titleMinWidth}
      onDeleteConditionClick={p.onDeleteConditionClick}
      cells={
        <>
          <SizerItem flag={wxEXPAND | wxLEFT} border={5}>
            <Combo
              value={p.m_sheetName.value}
              options={p.sheets.map((c) => ({ value: c, label: c }))}
              onChange={p.m_sheetName.onChange}
              ariaLabel="Sheet name"
            />
          </SizerItem>
          {gap}
        </>
      }
    />
  );
}
