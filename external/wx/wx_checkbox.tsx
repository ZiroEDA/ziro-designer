// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `wxCheckBox` with `wxCHK_3STATE | wxCHK_ALLOW_3RD_STATE_FOR_USER`, the box KiCad's
 * multi-item dialogs use where the items disagree or a setting is to be left alone.
 */
import { type JSX, useEffect, useRef } from 'react';
import { _ } from './translation.js';
import { useTranslations } from './translation_ui.js';

/** `wxCheckBoxState`: true is wxCHK_CHECKED, false wxCHK_UNCHECKED, null wxCHK_UNDETERMINED. */
export type CHECK_STATE = boolean | null;

/** A three-state wxCheckBox member (`wxCHK_3STATE`), as a `_base` takes it. */
export interface CHECK3 {
  value: CHECK_STATE;
  enabled?: boolean;
  onChange: (aValue: CHECK_STATE) => void;
}

/**
 * A wxCHK_3STATE wxCheckBox. With `wxCHK_ALLOW_3RD_STATE_FOR_USER` (the default) a click walks
 * unchecked -> checked -> undetermined -> unchecked, as wxCheckBoxBase's next state does; without
 * it the user only toggles between the two, and undetermined is the program's to set.
 */
export function TriStateCheck({
  label,
  value: aValue,
  onChange: aOnChange,
  check,
  allowThirdStateForUser = true,
  disabled: aDisabled,
  title,
}: {
  label: string;
  value?: CHECK_STATE;
  onChange?: (aValue: CHECK_STATE) => void;
  /** The `_base` member instead of `value` / `onChange` / `disabled`. */
  check?: CHECK3;
  allowThirdStateForUser?: boolean;
  disabled?: boolean;
  title?: string;
}): JSX.Element {
  const value = check ? check.value : (aValue ?? false);
  const onChange = check ? check.onChange : (aOnChange ?? (() => {}));
  const disabled = check ? check.enabled === false : aDisabled;
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = value === null;
  }, [value]);

  const next = (): CHECK_STATE =>
    value === false ? true : value === true ? (allowThirdStateForUser ? null : false) : false;

  useTranslations();

  return (
    <label className="ze-check" title={title === undefined ? undefined : _(title)}>
      <input
        ref={ref}
        type="checkbox"
        checked={value === true}
        aria-checked={value === null ? 'mixed' : value}
        disabled={disabled}
        onChange={() => onChange(next())}
      />
      {_(label)}
    </label>
  );
}
