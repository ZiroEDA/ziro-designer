// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `wxCheckBox` with `wxCHK_3STATE | wxCHK_ALLOW_3RD_STATE_FOR_USER`, the box KiCad's
 * multi-item dialogs use where the items disagree or a setting is to be left alone.
 */
import { type JSX, useEffect, useRef } from 'react';

/** `wxCheckBoxState`: true is wxCHK_CHECKED, false wxCHK_UNCHECKED, null wxCHK_UNDETERMINED. */
export type CHECK_STATE = boolean | null;

/** A wxCHK_3STATE wxCheckBox: a click cycles checked, unchecked, undetermined. */
export function TriStateCheck({
  label,
  value,
  onChange,
}: {
  label: string;
  value: CHECK_STATE;
  onChange: (aValue: CHECK_STATE) => void;
}): JSX.Element {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = value === null;
  }, [value]);

  return (
    <label className="ze-check">
      <input
        ref={ref}
        type="checkbox"
        checked={value === true}
        onChange={() => onChange(value === false ? true : value === true ? null : false)}
      />
      {label}
    </label>
  );
}
