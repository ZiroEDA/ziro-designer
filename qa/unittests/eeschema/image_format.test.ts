// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * An embedded bitmap is handed to the browser as the format it actually is.
 *
 * `(image … (data …))` holds base64 of the *original file's bytes*, whatever
 * format that file was. KiCad's Place Image accepts five —
 *
 *     AddFileExtListToFilter( { "png", "jpg", "jpeg", "bmp", "gif" } )
 *
 * — and `REFERENCE_IMAGE` works the format out when it decodes. We stripped the
 * data URL's prefix on the way in and hardcoded `data:image/png;base64,` on the
 * way out, so a JPEG, GIF or BMP was labelled PNG. Chrome sniffs its way past
 * that most of the time, which is exactly why it survived: it works until it
 * doesn't, and then it fails on someone else's file rather than on ours.
 *
 * Read from the payload rather than from a remembered mime type, so it is right
 * for an image loaded out of a `.kicad_sch` we never saw chosen.
 */
import { describe, it, expect } from 'vitest';
import { imageDataUrl, imageMimeType } from '@ziroeda/eeschema/src/import_gfx/image_format.js';

/** The first bytes of each format, base64'd the way the file stores them. */
const b64 = (bytes: number[]): string => Buffer.from(Uint8Array.from(bytes)).toString('base64');

const PNG = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = b64([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const GIF = b64([...Buffer.from('GIF89a'), 1, 0, 1, 0, 0, 0]);
const BMP = b64([...Buffer.from('BM'), 0x36, 0, 0, 0, 0, 0, 0, 0, 0x36, 0]);
const SVG = b64([...Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">')]);

describe('the format of embedded data', () => {
  it('reads a PNG', () => {
    expect(imageMimeType(PNG)).toBe('image/png');
  });

  it('a JPEG, which used to be labelled PNG', () => {
    expect(imageMimeType(JPEG)).toBe('image/jpeg');
  });

  it('a GIF', () => {
    expect(imageMimeType(GIF)).toBe('image/gif');
  });

  it('a BMP', () => {
    expect(imageMimeType(BMP)).toBe('image/bmp');
  });

  it('and an SVG, which Place Image should never produce but a file might hold', () => {
    expect(imageMimeType(SVG)).toBe('image/svg+xml');
  });

  it('anything unrecognised stays PNG, which is what this always assumed', () => {
    // The safe default: it is what KiCad writes, and it is what every image
    // already in a project was being decoded as.
    expect(imageMimeType('bm90aGluZyByZWFsbHk=')).toBe('image/png');
    expect(imageMimeType('')).toBe('image/png');
  });

  it('and leading whitespace does not hide the signature', () => {
    expect(imageMimeType(`  ${JPEG}`)).toBe('image/jpeg');
  });
});

describe('the data URL', () => {
  it('carries the detected type', () => {
    expect(imageDataUrl(JPEG).startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('and the payload unchanged', () => {
    // The bytes are the file's own; only the label was ever wrong.
    expect(imageDataUrl(GIF).endsWith(GIF)).toBe(true);
  });
});
