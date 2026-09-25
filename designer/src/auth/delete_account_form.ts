// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The delete-account dialog's form rules, as the reference has them.
 *
 * ente `web/apps/photos/src/components/DeleteAccount.tsx`: a reason from a
 * fixed list and a free-text "Anything else?", both required, with the nudge
 * for a missing feedback worded differently when the reason is that another
 * service is better - the one answer they most want spelled out. Kept out of
 * the component so the rules can be tested without rendering it.
 */

/** ente's `delete_reason`, in its order and wording. Data, not chrome. */
export const DELETE_REASONS = [
  { value: 'missing_feature', label: "It's missing a key feature that I need" },
  {
    value: 'behaviour',
    label: 'The app or a certain feature does not behave as I think it should',
  },
  { value: 'found_another_service', label: 'I found another service that I like better' },
  { value: 'not_listed', label: "My reason isn't listed" },
] as const;

export type DeleteReason = (typeof DELETE_REASONS)[number]['value'];

export const isDeleteReason = (v: string): v is DeleteReason =>
  DELETE_REASONS.some((r) => r.value === v);

/** `validate` in ente's `useFormik`: the field errors, or none. */
export function validateDeleteAccountForm(values: { reason: string; feedback: string }): {
  reason?: string;
  feedback?: string;
} {
  if (!isDeleteReason(values.reason)) return { reason: 'Required' };
  if (!values.feedback.trim().length) {
    return {
      feedback:
        values.reason === 'found_another_service'
          ? 'What does the other service do better?'
          : 'Kindly help us with this information',
    };
  }
  return {};
}
