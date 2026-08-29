// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * DIALOG_FIELD_PROPERTIES' title bar.
 *
 * `DIALOG_FIELD_PROPERTIES_BASE( aParent, wxID_ANY, aTitle )`
 * (eeschema/dialogs/dialog_field_properties.cpp:52) takes its caption from the
 * caller, and every eeschema caller is `SCH_EDIT_TOOL::editFieldText`, which
 * builds it per field (sch_edit_tool.cpp:2338-2353). So the dialog must NOT
 * carry a fixed heading: "Edit Value Field" and "Edit 'MPN' Field" are the
 * only thing on screen that says which field is being edited, since the Name
 * box is read-only on a mandatory field.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DialogFieldProperties } from '@ziroeda/designer/src/editors/schematic/dialogs/dialog_field_properties.js';
import { fieldEditCaption } from '@ziroeda/eeschema/src/tools/field_properties.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';

afterEach(cleanup);

const initialFor = (key: string, value: string) => ({
  key,
  value,
  at: { x: 0, y: mmToIU(1.27) },
  angle: 0,
  effects: { hidden: false, fontSize: [mmToIU(1.27), mmToIU(1.27)] as [number, number] },
  nameShown: false,
  doNotAutoplace: false,
});

const renderFor = (key: string, value: string): void => {
  render(
    <DialogFieldProperties
      initial={initialFor(key, value)}
      caption={fieldEditCaption(key)}
      onOk={() => {}}
      onCancel={() => {}}
    />,
  );
};

describe('the field dialog wears the caption its caller computed', () => {
  it('shows "Edit Value Field" for the Value field', () => {
    renderFor('Value', '10k');
    expect(screen.getByText('Edit Value Field')).toBeTruthy();
    // The heading it used to carry unconditionally.
    expect(screen.queryByText('Field Properties')).toBeNull();
  });

  it('shows "Edit \'MPN\' Field" for a user field', () => {
    renderFor('MPN', 'RC0402FR-0710KL');
    expect(screen.getByText("Edit 'MPN' Field")).toBeTruthy();
  });
});
