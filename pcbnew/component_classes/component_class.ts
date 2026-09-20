// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** `pcbnew/component_classes/component_class.h` + `.cpp`. */

/// The assignment context in which this component class is used
export enum USAGE {
  STATIC,
  DYNAMIC,
  STATIC_AND_DYNAMIC,
  EFFECTIVE,
}

/**
 * A lightweight representation of a component class. The membership within
 * m_constituentClasses allows determination of the type of class this is
 * (i.e. if it is an effective class composed of multiple constituent classes,
 * or if it is a single constituent class).
 */
export class COMPONENT_CLASS {
  static readonly USAGE = USAGE;

  /// The full name of the component class
  private m_name: string;

  /// The COMPONENT_CLASS objects contributing to this complete component class
  private m_constituentClasses: COMPONENT_CLASS[] = [];

  /// The assignment context in which this component class is being used
  private m_usageContext: USAGE;

  /// Construct a new component class
  constructor(name: string, aUsageContext: USAGE) {
    this.m_name = name;
    this.m_usageContext = aUsageContext;
  }

  /// @brief Gets the consolidated name of this component class (which may be an aggregate). This is
  /// intended for display to users (e.g. in infobars or messages). WARNING: Do not use this
  /// to compare equivalence, or to export to other tools)
  GetHumanReadableName(): string {
    if (this.m_constituentClasses.length === 0) return '<None>';

    if (this.m_constituentClasses.length === 1) return this.m_name;

    console.assert(this.m_constituentClasses.length >= 2);

    let name = '';

    if (this.m_constituentClasses.length === 2) {
      name = `${this.m_constituentClasses[0]!.GetName()} and ${this.m_constituentClasses[1]!.GetName()}`;
    } else if (this.m_constituentClasses.length === 3) {
      name = `${this.m_constituentClasses[0]!.GetName()}, ${this.m_constituentClasses[1]!.GetName()} and ${this.m_constituentClasses[2]!.GetName()}`;
    } else if (this.m_constituentClasses.length > 3) {
      name = `${this.m_constituentClasses[0]!.GetName()}, ${this.m_constituentClasses[1]!.GetName()} and ${this.m_constituentClasses.length - 2} more`;
    }

    return name;
  }

  /// Fetches the full name of this component class
  GetName(): string {
    return this.m_name;
  }

  /// Adds a constituent component class to an effective component class
  AddConstituentClass(componentClass: COMPONENT_CLASS): void {
    this.m_constituentClasses.push(componentClass);
  }

  /// Returns a named constituent class of this component class, or nullptr if not found
  GetConstituentClass(className: string): COMPONENT_CLASS | null {
    return this.m_constituentClasses.find((testClass) => testClass.GetName() === className) ?? null;
  }

  /// Determines if this (effective) component class contains a specific constituent class
  ContainsClassName(className: string): boolean {
    return this.GetConstituentClass(className) !== null;
  }

  /// Determines if this (effective) component class is empty (i.e. no classes defined)
  IsEmpty(): boolean {
    return this.m_constituentClasses.length === 0;
  }

  /// Fetches a vector of the constituent classes for this (effective) class
  GetConstituentClasses(): readonly COMPONENT_CLASS[] {
    return this.m_constituentClasses;
  }

  /// Gets the assignment context in which this component class is being used
  GetUsageContext(): USAGE {
    return this.m_usageContext;
  }

  /// Sets the assignment context in which this component class is being used
  SetUsageContext(aUsageContext: USAGE): void {
    this.m_usageContext = aUsageContext;
  }

  /// Tests two component classes for equality based on full class name
  equals(aComponent: COMPONENT_CLASS): boolean {
    return this.GetName() === aComponent.GetName();
  }
}
