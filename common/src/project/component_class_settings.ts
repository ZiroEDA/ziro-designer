// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/project/component_class_settings.h` + `common/project/component_class_settings.cpp`:
 * a dynamic component class assignment and the project's list of them. The
 * JSON side (NESTED_SETTINGS under the project file) lands with the project
 * (#636 stage 6).
 */

/// A condition match type
export enum CONDITION_TYPE {
  REFERENCE,
  FOOTPRINT,
  SIDE,
  ROTATION,
  FOOTPRINT_FIELD,
  CUSTOM,
  SHEET_NAME,
}

/// Whether conditions are applied with OR or AND logic
export enum CONDITIONS_OPERATOR {
  ALL,
  ANY,
}

/** `wxString::Trim( true ).Trim( false )`: both ends. */
function trim(s: string): string {
  return s.trim();
}

export class COMPONENT_CLASS_ASSIGNMENT_DATA {
  static readonly CONDITION_TYPE = CONDITION_TYPE;
  static readonly CONDITIONS_OPERATOR = CONDITIONS_OPERATOR;

  /// The name of the component class for this assignment rule
  protected m_componentClass = '';

  /// Set of conditions with type, primary and secondary data fields for the condition
  protected m_conditions: [CONDITION_TYPE, string, string][] = [];

  /// Whether conditions are applied with AND or OR logic
  /// Defaults to ALL
  protected m_conditionsOperator: CONDITIONS_OPERATOR = CONDITIONS_OPERATOR.ALL;

  /// Sets the given condition type with the assocated match data
  AddCondition(aCondition: CONDITION_TYPE, aPrimaryData: string, aSecondaryData: string): void {
    this.m_conditions.push([aCondition, aPrimaryData, aSecondaryData]);
  }

  /// Gets all conditions
  GetConditions(): readonly (readonly [CONDITION_TYPE, string, string])[] {
    return this.m_conditions;
  }

  /// Sets the resulting component class for matching footprints
  SetComponentClass(aComponentClass: string): void {
    this.m_componentClass = aComponentClass;
  }

  /// Gets the resulting component class for matching footprints
  GetComponentClass(): string {
    return this.m_componentClass;
  }

  /// Sets the boolean operation in use for all conditions
  SetConditionsOperation(aOperator: CONDITIONS_OPERATOR): void {
    this.m_conditionsOperator = aOperator;
  }

  /// Gets the boolean operation in use for all conditions
  GetConditionsOperator(): CONDITIONS_OPERATOR {
    return this.m_conditionsOperator;
  }

  /// Maps a CONDITION_TYPE to a descriptive string
  static GetConditionName(aCondition: CONDITION_TYPE): string {
    switch (aCondition) {
      case CONDITION_TYPE.REFERENCE:
        return 'REFERENCE';
      case CONDITION_TYPE.FOOTPRINT:
        return 'FOOTPRINT';
      case CONDITION_TYPE.SIDE:
        return 'SIDE';
      case CONDITION_TYPE.ROTATION:
        return 'ROTATION';
      case CONDITION_TYPE.FOOTPRINT_FIELD:
        return 'FOOTPRINT_FIELD';
      case CONDITION_TYPE.CUSTOM:
        return 'CUSTOM';
      case CONDITION_TYPE.SHEET_NAME:
        return 'SHEET_NAME';
    }

    console.assert(false);
    return '';
  }

  /// Maps a descriptive string to a CONDITION_TYPE
  static GetConditionType(aCondition: string): CONDITION_TYPE {
    if (aCondition === 'REFERENCE') return CONDITION_TYPE.REFERENCE;
    if (aCondition === 'FOOTPRINT') return CONDITION_TYPE.FOOTPRINT;
    if (aCondition === 'SIDE') return CONDITION_TYPE.SIDE;
    if (aCondition === 'ROTATION') return CONDITION_TYPE.ROTATION;
    if (aCondition === 'FOOTPRINT_FIELD') return CONDITION_TYPE.FOOTPRINT_FIELD;
    if (aCondition === 'CUSTOM') return CONDITION_TYPE.CUSTOM;
    if (aCondition === 'SHEET_NAME') return CONDITION_TYPE.SHEET_NAME;

    console.assert(false);
    return CONDITION_TYPE.REFERENCE;
  }

  /// Returns the DRC rules language for this component class assignment
  GetAssignmentInDRCLanguage(): string {
    if (this.m_componentClass === '') return '';

    if (this.m_conditions.length === 0) {
      // A condition which always applies the netclass
      return `(version 1) (assign_component_class "${this.m_componentClass}")`;
    }

    // Lambda to format a comma-separated list of references in to a DRC expression
    const getRefExpr = (aRefsIn: string): string => {
      const aRefs = trim(aRefsIn);

      // wxSplit keeps empty tokens and leaves each one untrimmed
      const refs = aRefs === '' ? [] : aRefs.split(',');

      if (refs.length === 0) return '';

      const exprs = refs.map((aRef) => `A.Reference == '${aRef}'`);

      let refsExpr = exprs[0]!;

      if (exprs.length > 1) {
        for (let i = 1; i < exprs.length; i++) refsExpr = `${refsExpr} || ${exprs[i]}`;
      }

      return `( ${refsExpr} )`;
    };

    // Lambda to format a footprint match DRC expression
    const getFootprintExpr = (aFootprintIn: string): string => {
      const aFootprint = trim(aFootprintIn);

      if (aFootprint === '') return '';

      return `( A.Library_Link == '${aFootprint}' )`;
    };

    // Lambda to format a layer side DRC expression
    const getSideExpr = (aSide: string): string => {
      if (aSide === 'Any') return '';

      return `( A.Layer == '${aSide === 'Front' ? 'F.Cu' : 'B.Cu'}' )`;
    };

    // Lambda to format a rotation DRC expression
    const getRotationExpr = (aRotationIn: string): string => {
      const aRotation = trim(aRotationIn);

      // wxString::ToInt: the whole string is a base-10 integer
      if (aRotation === '' || aRotation === 'Any' || !/^[+-]?\d+$/.test(aRotation)) return '';

      return `( A.Orientation == ${aRotation} deg )`;
    };

    // Lambda to format a footprint field DRC expression
    const getFootprintFieldExpr = (aFieldNameIn: string, aFieldMatchIn: string): string => {
      const aFieldName = trim(aFieldNameIn);
      const aFieldMatch = trim(aFieldMatchIn);

      if (aFieldName === '' || aFieldMatch === '') return '';

      return `( A.getField('${aFieldName}') == '${aFieldMatch}' )`;
    };

    // Lambda to format a custom DRC expression
    const getCustomFieldExpr = (aExprIn: string): string => {
      const aExpr = trim(aExprIn);

      if (aExpr === '') return '';

      return `( ${aExpr} )`;
    };

    // Lambda to format a sheet name expression
    const getSheetNameExpr = (aSheetNameIn: string): string => {
      const aSheetName = trim(aSheetNameIn);

      if (aSheetName === '') return '';

      return `( A.memberOfSheet('${aSheetName}') )`;
    };

    const conditionsExprs: string[] = [];

    for (const [conditionType, primaryData, secondaryData] of this.m_conditions) {
      let conditionExpr = '';

      switch (conditionType) {
        case CONDITION_TYPE.REFERENCE:
          conditionExpr = getRefExpr(primaryData);
          break;
        case CONDITION_TYPE.FOOTPRINT:
          conditionExpr = getFootprintExpr(primaryData);
          break;
        case CONDITION_TYPE.SIDE:
          conditionExpr = getSideExpr(primaryData);
          break;
        case CONDITION_TYPE.ROTATION:
          conditionExpr = getRotationExpr(primaryData);
          break;
        case CONDITION_TYPE.FOOTPRINT_FIELD:
          conditionExpr = getFootprintFieldExpr(primaryData, secondaryData);
          break;
        case CONDITION_TYPE.CUSTOM:
          conditionExpr = getCustomFieldExpr(primaryData);
          break;
        case CONDITION_TYPE.SHEET_NAME:
          conditionExpr = getSheetNameExpr(primaryData);
          break;
      }

      if (conditionExpr !== '') conditionsExprs.push(conditionExpr);
    }

    if (conditionsExprs.length === 0)
      return `(version 1) (assign_component_class "${this.m_componentClass}")`;

    let allConditionsExpr = conditionsExprs[0]!;

    if (conditionsExprs.length > 1) {
      const operatorExpr = this.m_conditionsOperator === CONDITIONS_OPERATOR.ALL ? ' && ' : ' || ';

      for (let i = 1; i < conditionsExprs.length; i++)
        allConditionsExpr = allConditionsExpr + operatorExpr + conditionsExprs[i];
    }

    return `(version 1) (assign_component_class "${this.m_componentClass}" (condition "${allConditionsExpr}" ) )`;
  }
}

/**
 * COMPONENT_CLASS_SETTINGS stores data for component classes, including rules for automatic
 * generation of component classes.
 */
export class COMPONENT_CLASS_SETTINGS {
  private m_enableSheetComponentClasses = false;
  private m_componentClassAssignments: COMPONENT_CLASS_ASSIGNMENT_DATA[] = [];

  /// Sets whether component classes should be generated for components in hierarchical sheets
  SetEnableSheetComponentClasses(aEnabled: boolean): void {
    this.m_enableSheetComponentClasses = aEnabled;
  }

  /// Gets whether component classes should be generated for components in hierarchical sheets
  GetEnableSheetComponentClasses(): boolean {
    return this.m_enableSheetComponentClasses;
  }

  /// Clear all dynamic component class assignments
  ClearComponentClassAssignments(): void {
    this.m_componentClassAssignments.length = 0;
  }

  /// Gets all dynamic component class assignments
  GetComponentClassAssignments(): readonly COMPONENT_CLASS_ASSIGNMENT_DATA[] {
    return this.m_componentClassAssignments;
  }

  // Adds a dynamic component class assignment
  AddComponentClassAssignment(aAssignment: COMPONENT_CLASS_ASSIGNMENT_DATA): void {
    this.m_componentClassAssignments.push(aAssignment);
  }
}
