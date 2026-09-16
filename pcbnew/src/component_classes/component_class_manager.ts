// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/component_classes/component_class_manager.h` + `.cpp`: the board's
 * component classes — the static ones the netlist assigns, the dynamic ones
 * the project's assignment rules generate, and the effective (combined)
 * classes footprints carry.
 *
 * `CompileAssignmentRule` compiles an assignment through DRC_RULES_PARSER,
 * which lands with the DRC engine (#636 stage 4); until then every rule
 * fails to compile, as an unparsable rule does in the C++.
 */
import {
  COMPONENT_CLASS_ASSIGNMENT_DATA,
  CONDITION_TYPE,
} from '@ziroeda/common/src/project/component_class_settings.js';
import type { BOARD } from '../board.js';
import type { FOOTPRINT } from '../footprint.js';
import { COMPONENT_CLASS, USAGE } from './component_class.js';
import type { COMPONENT_CLASS_ASSIGNMENT_RULE } from './component_class_assignment_rule.js';

export class COMPONENT_CLASS_MANAGER {
  /// The board these component classes are assigned to / from
  protected m_board: BOARD;

  /// The class to represent an unassigned component class
  protected m_noneClass: COMPONENT_CLASS;

  /// All individual component classes from static assignments
  protected m_constituentClasses = new Map<string, COMPONENT_CLASS>();

  /// Generated effective (composite) static component classes
  protected m_effectiveClasses = new Map<string, COMPONENT_CLASS>();

  /// Cache of in-use static component class names
  /// Used for cleanup following netlist updates
  protected m_staticClassNamesCache = new Set<string>();

  /// Active component class assignment rules
  protected m_assignmentRules: COMPONENT_CLASS_ASSIGNMENT_RULE[] = [];

  /// Monotonically increasing ticker to test cached component class validity
  protected m_ticker = 0;

  constructor(board: BOARD) {
    this.m_board = board;
    this.m_noneClass = new COMPONENT_CLASS('', USAGE.STATIC);
  }

  /**
   * Computes and returns an effective component class for a (possibly empty) set of constituent
   * class names. This is called by the netlist updater to set static component classes on footprints.
   *
   * Where constituent or effective component classes already exist, they are re-used. This allows
   * efficient comparison of (effective) component classes by pointer in DRC checks.
   *
   * Preconditions: InitNetlistUpdate() must be called before invoking this method.
   * @param classNames The constitent component class names
   * @return A pointer to an effective COMPONENT_CLASS representing all constituent component classes
   */
  GetEffectiveStaticComponentClass(classNames: ReadonlySet<string>): COMPONENT_CLASS {
    // Handle no component class condition
    if (classNames.size === 0) return this.m_noneClass;

    // Handle single-assignment component classes
    if (classNames.size === 1) {
      const className = classNames.values().next().value as string;
      this.m_staticClassNamesCache.delete(className);
      return this.getOrCreateConstituentClass(className, USAGE.STATIC);
    }

    // Handle composite component classes
    const sortedClassNames = COMPONENT_CLASS_MANAGER.sortClassNames(classNames);

    const effectiveClass = this.getOrCreateEffectiveClass(sortedClassNames, USAGE.STATIC);

    for (const constituentClass of effectiveClass.GetConstituentClasses())
      this.m_staticClassNamesCache.delete(constituentClass.GetName());

    return effectiveClass;
  }

  /// Returns the unassigned component class
  GetNoneComponentClass(): COMPONENT_CLASS {
    return this.m_noneClass;
  }

  /// Prepare the manager for a board update
  /// Must be called prior to updating the PCB from the netlist
  InitNetlistUpdate(): void {
    for (const [className, classPtr] of this.m_constituentClasses) {
      if (
        classPtr.GetUsageContext() === USAGE.STATIC ||
        classPtr.GetUsageContext() === USAGE.STATIC_AND_DYNAMIC
      ) {
        this.m_staticClassNamesCache.add(className);
      }
    }

    ++this.m_ticker;
  }

  /// Cleans up the manager after a board update
  /// Must be called after updating the PCB from the netlist
  FinishNetlistUpdate(): void {
    // m_staticClassesCache now contains any static component classes that are unused from the
    // netlist update. Delete any effective component classes which refer to them in a static-only
    // context, or update their usage context.

    // First, collect all component classes that will be deleted so we can clear footprint pointers
    // before deletion. This prevents use-after-free when auto-save serializes footprints.
    const classesToDelete = new Set<COMPONENT_CLASS>();

    for (const className of this.m_staticClassNamesCache) {
      const staticClass = this.m_constituentClasses.get(className)!;

      if (staticClass.GetUsageContext() === USAGE.STATIC) {
        classesToDelete.add(staticClass);

        for (const [, combinedCompClass] of this.m_effectiveClasses) {
          if (combinedCompClass.ContainsClassName(className))
            classesToDelete.add(combinedCompClass);
        }
      }
    }

    // Clear footprint static component class pointers that reference classes being deleted
    if (classesToDelete.size > 0) {
      for (const footprint of this.m_board.Footprints()) {
        const cls = footprint.GetStaticComponentClass();
        if (cls && classesToDelete.has(cls)) footprint.SetStaticComponentClass(null);
      }
    }

    // Now perform the actual deletions
    for (const className of this.m_staticClassNamesCache) {
      const staticClass = this.m_constituentClasses.get(className)!;

      if (staticClass.GetUsageContext() === USAGE.STATIC) {
        // Any static-only classes can be deleted, along with effective classes which refer to them
        const effectiveClassesToDelete = new Set<string>();

        for (const [combinedFullName, combinedCompClass] of this.m_effectiveClasses) {
          if (combinedCompClass.ContainsClassName(className))
            effectiveClassesToDelete.add(combinedFullName);
        }

        for (const classNameToDelete of effectiveClassesToDelete)
          this.m_effectiveClasses.delete(classNameToDelete);

        this.m_constituentClasses.delete(className);
      } else {
        // Set the component class to dynamic-only scope
        console.assert(staticClass.GetUsageContext() === USAGE.STATIC_AND_DYNAMIC);
        staticClass.SetUsageContext(USAGE.DYNAMIC);
      }
    }

    // Clear the caches
    this.m_staticClassNamesCache.clear();
  }

  /// @brief Gets the full effective class name for the given set of constituent classes
  static GetFullClassNameForConstituents(
    classNames: ReadonlySet<string> | readonly string[],
  ): string {
    if (classNames instanceof Set) {
      const sortedClassNames = COMPONENT_CLASS_MANAGER.sortClassNames(classNames);
      return COMPONENT_CLASS_MANAGER.GetFullClassNameForConstituents(sortedClassNames);
    }

    const names = classNames as readonly string[];

    if (names.length === 0) return '';

    let fullName = names[0]!;

    for (let i = 1; i < names.length; ++i) {
      fullName += ',';
      fullName += names[i];
    }

    return fullName;
  }

  /// Synchronises all dynamic component class assignment rules
  /// @returns false if rules fail to parse, true if successful
  SyncDynamicComponentClassAssignments(
    aAssignments: readonly COMPONENT_CLASS_ASSIGNMENT_DATA[],
    aGenerateSheetClasses: boolean,
    aNewSheetPaths: ReadonlySet<string>,
  ): boolean {
    let success = true;

    // Invalidate component class cache entries
    ++this.m_ticker;

    // Save previous dynamically assigned component class names
    const prevClassNames = new Set<string>();

    for (const rule of this.m_assignmentRules) prevClassNames.add(rule.GetComponentClass());

    this.m_assignmentRules.length = 0;

    // Parse all assignment rules
    const rules: COMPONENT_CLASS_ASSIGNMENT_RULE[] = [];

    for (const assignment of aAssignments) {
      const rule = COMPONENT_CLASS_MANAGER.CompileAssignmentRule(assignment);

      if (rule) rules.push(rule);
      else success = false;
    }

    // Generate sheet classes if required
    if (aGenerateSheetClasses) {
      const sheetNames = new Set<string>(aNewSheetPaths);

      for (const footprint of this.m_board.Footprints()) sheetNames.add(footprint.GetSheetname());

      for (let sheetName of sheetNames) {
        // Don't generate a class for empty sheets (e.g. manually placed footprints) or the root
        // sheet
        if (sheetName === '' || sheetName === '/') continue;

        sheetName = sheetName.replaceAll('"', '');
        sheetName = sheetName.replaceAll("'", '');

        const assignment = new COMPONENT_CLASS_ASSIGNMENT_DATA();
        assignment.SetComponentClass(sheetName);
        assignment.AddCondition(CONDITION_TYPE.SHEET_NAME, sheetName, '');

        const rule = COMPONENT_CLASS_MANAGER.CompileAssignmentRule(assignment);

        if (rule) rules.push(rule);
        else success = false;
      }
    }

    // Set the assignment rules
    if (success) this.m_assignmentRules = rules;

    // Re-use or create component classes which may be output by assignment rules
    for (const rule of this.m_assignmentRules) {
      const className = rule.GetComponentClass();
      prevClassNames.delete(className);
      this.getOrCreateConstituentClass(className, USAGE.DYNAMIC);
    }

    // prevClassNames now contains all dynamic component class names no longer in use. Remove any
    // effective component classes no longer in use.
    for (const className of prevClassNames) {
      const dynamicClass = this.m_constituentClasses.get(className)!;

      if (dynamicClass.GetUsageContext() === USAGE.DYNAMIC) {
        // Any dynamic-only classes can be deleted, along with effective classes which refer to them
        const classesToDelete = new Set<string>();

        for (const [combinedFullName, combinedCompClass] of this.m_effectiveClasses) {
          if (combinedCompClass.ContainsClassName(className)) classesToDelete.add(combinedFullName);
        }

        for (const classNameToDelete of classesToDelete)
          this.m_effectiveClasses.delete(classNameToDelete);

        this.m_constituentClasses.delete(className);
      } else {
        // Set the component class to dynamic-only scope
        console.assert(dynamicClass.GetUsageContext() === USAGE.STATIC_AND_DYNAMIC);
        dynamicClass.SetUsageContext(USAGE.STATIC);
      }
    }

    return success;
  }

  static CompileAssignmentRule(
    aAssignment: COMPONENT_CLASS_ASSIGNMENT_DATA,
  ): COMPONENT_CLASS_ASSIGNMENT_RULE | null {
    const ruleSource = aAssignment.GetAssignmentInDRCLanguage();

    // Ignore incomplete rules (e.g. no component class name specified)
    if (ruleSource === '') return null;

    // DRC_RULES_PARSER::ParseComponentClassAssignmentRules: pending (#636 stage 4)
    return null;
  }

  /// Gets the combined component class with the given static and dynamic constituent component classes
  GetCombinedComponentClass(
    staticClass: COMPONENT_CLASS | null,
    dynamicClass: COMPONENT_CLASS | null,
  ): COMPONENT_CLASS {
    const classNames = new Set<string>();

    if (staticClass) {
      for (const compClass of staticClass.GetConstituentClasses())
        classNames.add(compClass.GetName());
    }

    if (dynamicClass) {
      for (const compClass of dynamicClass.GetConstituentClasses())
        classNames.add(compClass.GetName());
    }

    if (classNames.size === 0) return this.GetNoneComponentClass();

    if (classNames.size === 1) {
      const name = classNames.values().next().value as string;
      console.assert(this.m_constituentClasses.has(name));
      return this.m_constituentClasses.get(name)!;
    }

    const sortedClassNames = COMPONENT_CLASS_MANAGER.sortClassNames(classNames);
    const fullCombinedName =
      COMPONENT_CLASS_MANAGER.GetFullClassNameForConstituents(sortedClassNames);

    if (!this.m_effectiveClasses.has(fullCombinedName)) {
      const combinedClass = new COMPONENT_CLASS(fullCombinedName, USAGE.EFFECTIVE);

      for (const className of sortedClassNames) {
        console.assert(this.m_constituentClasses.has(className));
        combinedClass.AddConstituentClass(this.m_constituentClasses.get(className)!);
      }

      this.m_effectiveClasses.set(fullCombinedName, combinedClass);
    }

    return this.m_effectiveClasses.get(fullCombinedName)!;
  }

  /// Invalidates any caches component classes and recomputes caches if required. This will force
  /// recomputation of component classes on next access
  InvalidateComponentClasses(): void {
    ++this.m_ticker;
  }

  /// Forces the component class for all footprints to be recalculated. This should be called before running DRC as
  /// checking for valid component class cache entries is threadsafe, but computing them is not. Blocking during this
  /// check would be a negative performance impact for DRC computation, so we force recalculation instead.
  ForceComponentClassRecalculation(): void {
    for (const footprint of this.m_board.Footprints()) {
      footprint.RecomputeComponentClass();
    }
  }

  /// Gets the dynamic component classes which match the given footprint
  GetDynamicComponentClassesForFootprint(footprint: FOOTPRINT): COMPONENT_CLASS | null {
    const classNames = new Set<string>();

    // Assemble matching component class names
    for (const rule of this.m_assignmentRules) {
      if (rule.Matches(footprint)) classNames.add(rule.GetComponentClass());
    }

    // Handle composite component classes
    const sortedClassNames = COMPONENT_CLASS_MANAGER.sortClassNames(classNames);

    // No matching component classes
    if (classNames.size === 0) return null;

    // One matching component class
    if (classNames.size === 1)
      return this.getOrCreateConstituentClass(
        classNames.values().next().value as string,
        USAGE.DYNAMIC,
      );

    // Multiple matching component classes
    return this.getOrCreateEffectiveClass(sortedClassNames, USAGE.DYNAMIC);
  }

  /// Gets the component class validity ticker
  /// Used to check validity of cached component classes
  GetTicker(): number {
    return this.m_ticker;
  }

  /// Sorts the given class names in to canonical order
  protected static sortClassNames(classNames: ReadonlySet<string>): string[] {
    const sortedClassNames = [...classNames];

    // wxString::Cmp: by code unit
    sortedClassNames.sort((str1, str2) => (str1 < str2 ? -1 : str1 > str2 ? 1 : 0));

    return sortedClassNames;
  }

  /// Returns a constituent component class, re-using an existing instantiation where possible
  protected getOrCreateConstituentClass(aClassName: string, aContext: USAGE): COMPONENT_CLASS {
    if (aContext === USAGE.STATIC_AND_DYNAMIC || aContext === USAGE.EFFECTIVE) {
      console.assert(
        false,
        "Can't create a STATIC_AND_DYNAMIC or EFFECTIVE constituent component class",
      );
      return this.m_noneClass;
    }

    const existing = this.m_constituentClasses.get(aClassName);

    if (existing) {
      if (aContext !== existing.GetUsageContext())
        existing.SetUsageContext(USAGE.STATIC_AND_DYNAMIC);

      return existing;
    }

    const newClass = new COMPONENT_CLASS(aClassName, aContext);
    newClass.AddConstituentClass(newClass);
    this.m_constituentClasses.set(aClassName, newClass);

    return newClass;
  }

  /// Returns an effective component class for the given set of constituent class names
  /// Precondition: aClassNames is sorted by sortClassNames
  protected getOrCreateEffectiveClass(
    aClassNames: readonly string[],
    aContext: USAGE,
  ): COMPONENT_CLASS {
    const fullClassName = COMPONENT_CLASS_MANAGER.GetFullClassNameForConstituents(aClassNames);

    const existing = this.m_effectiveClasses.get(fullClassName);

    if (existing) {
      for (const constituentClass of existing.GetConstituentClasses()) {
        if (constituentClass.GetUsageContext() !== aContext)
          constituentClass.SetUsageContext(USAGE.STATIC_AND_DYNAMIC);
      }
    } else {
      const effectiveClass = new COMPONENT_CLASS(fullClassName, USAGE.EFFECTIVE);

      for (const className of aClassNames) {
        const constituentClass = this.getOrCreateConstituentClass(className, aContext);
        effectiveClass.AddConstituentClass(constituentClass);
      }

      this.m_effectiveClasses.set(fullClassName, effectiveClass);
    }

    return this.m_effectiveClasses.get(fullClassName)!;
  }

  /// Fetches a read-only map of the fundamental component classes
  GetClassNames(): Set<string> {
    return new Set(this.m_constituentClasses.keys());
  }

  /// Rebuilds any caches that may be required by custom assignment rules
  /// @param fp the footprint to rebuild. If null, rebuilds all footprint caches
  RebuildRequiredCaches(aFootprint: FOOTPRINT | null = null): void {
    if (aFootprint) {
      aFootprint.BuildCourtyardCaches();
    } else {
      for (const fp of this.m_board.Footprints()) fp.BuildCourtyardCaches();
    }
  }
}
