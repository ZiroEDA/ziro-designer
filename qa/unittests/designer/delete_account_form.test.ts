// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The delete-account form's rules, which are ente's (DeleteAccount.tsx
 * `validate`): a reason from the fixed list, feedback that is not blank, and
 * the feedback nudge worded for the reason that was picked.
 */
import { describe, expect, it } from 'vitest';
import {
  DELETE_REASONS,
  validateDeleteAccountForm,
} from '@ziroeda/designer/src/auth/delete_account_form.js';

describe('validateDeleteAccountForm', () => {
  it('needs a reason from the list', () => {
    expect(validateDeleteAccountForm({ reason: '', feedback: 'x' })).toEqual({ reason: 'Required' });
    expect(validateDeleteAccountForm({ reason: 'bored', feedback: 'x' })).toEqual({
      reason: 'Required',
    });
  });

  it('needs feedback that is not blank, and asks for it in ente\'s words', () => {
    expect(validateDeleteAccountForm({ reason: 'missing_feature', feedback: '  ' })).toEqual({
      feedback: 'Kindly help us with this information',
    });
    // The one reason they most want spelled out gets its own question.
    expect(validateDeleteAccountForm({ reason: 'found_another_service', feedback: '' })).toEqual({
      feedback: 'What does the other service do better?',
    });
  });

  it('passes with a listed reason and some feedback', () => {
    for (const r of DELETE_REASONS) {
      expect(validateDeleteAccountForm({ reason: r.value, feedback: 'because' })).toEqual({});
    }
  });

  it('carries ente\'s four reasons in its order', () => {
    expect(DELETE_REASONS.map((r) => r.value)).toEqual([
      'missing_feature',
      'behaviour',
      'found_another_service',
      'not_listed',
    ]);
  });
});
