// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * `common/clipboard.ts`, `common/io/csv.ts` and `common/wx/buffer.ts`. The CSV
 * rows are `rapidcsv::Document::ParseCsv` walked by hand with the parameters
 * `AutoDecodeCSV` passes it: trim on, comment lines ('#') and empty lines
 * skipped, auto-quote on, no quoted line breaks, no label row or column.
 */
import { describe, expect, it } from 'vitest';
import {
  AddTransparentImageToClipboardData,
  EncodeImageToPng,
  GetClipboardUTF8,
  GetImageFromClipboard,
  GetTabularDataFromClipboard,
  SaveClipboard,
  SaveTabularDataToClipboard,
  SetClipboardData,
  SetClipboardFromPaste,
  wxDataObjectComposite,
} from '@ziroeda/common/clipboard.js';
import { AutoDecodeCSV, CSV_WRITER } from '@ziroeda/common/io/csv.js';
import { wxMemoryBuffer } from '@ziroeda/common/wx/buffer.js';
import { WX_IMAGE } from '@ziroeda/common/wx_image.js';

const decode = (aInput: string): { ok: boolean; rows: string[][] } => {
  const rows: string[][] = [['stale']];
  const ok = AutoDecodeCSV(aInput, rows);
  return { ok, rows };
};

const write = (aRows: string[][], aSetup?: (w: CSV_WRITER) => void): string => {
  const out: string[] = [];
  const w = new CSV_WRITER(out);
  aSetup?.(w);
  w.WriteLines(aRows);
  return out.join('');
};

describe('CSV_WRITER', () => {
  it('quotes every cell and doubles a quote inside one', () => {
    expect(
      write([
        ['a', 'b"c'],
        ['', '1'],
      ]),
    ).toBe('"a","b""c"\n"","1"\n');
  });

  it('escapes a quote with the escape string when one is set', () => {
    expect(write([['b"c']], (w) => w.SetEscape('\\'))).toBe('"b\\"c"\n');
  });

  it('joins with the delimiter it is given', () => {
    expect(write([['a', 'b']], (w) => w.SetDelimiter('\t'))).toBe('"a"\t"b"\n');
  });
});

describe('AutoDecodeCSV', () => {
  it('splits rows and cells', () => {
    expect(decode('a,b\n1,2')).toEqual({
      ok: true,
      rows: [
        ['a', 'b'],
        ['1', '2'],
      ],
    });
  });

  it('is TSV when there is a tab anywhere, and a comma is then text', () => {
    expect(decode('a\tb, c\n').rows).toEqual([['a', 'b, c']]);
  });

  it('trims cells', () => {
    expect(decode(' a , b ').rows).toEqual([['a', 'b']]);
  });

  it('keeps a separator inside quotes, and undoubles quotes', () => {
    expect(decode('"x,y",z\n"he said ""hi""",q').rows).toEqual([
      ['x,y', 'z'],
      ['he said "hi"', 'q'],
    ]);
  });

  it('opens a quote after leading spaces, and not after text', () => {
    expect(decode(' "a,b",c').rows).toEqual([['a,b', 'c']]);
    expect(decode('ab"c,d').rows).toEqual([['ab"c', 'd']]);
  });

  it('ends a row at a line break even inside quotes', () => {
    expect(decode('"a\nb",c').rows).toEqual([['"a'], ['b"']]);
  });

  it('skips comment lines, judged after trimming, and empty lines', () => {
    expect(decode('# note\na,b\n\n  #x,1\n1,2\n').rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('gives every row the first row’s column count', () => {
    expect(decode('a,b,c\n1\n1,2,3,4').rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '', ''],
      ['1', '2', '3'],
    ]);
  });

  it('drops CRs and a UTF-8 byte order mark', () => {
    expect(decode('﻿a,b\r\n1,2\r\n').rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('is false, and empty, for nothing', () => {
    expect(decode('')).toEqual({ ok: false, rows: [] });
    expect(decode('\n\n# only a comment\n')).toEqual({ ok: false, rows: [] });
  });
});

describe('wxMemoryBuffer', () => {
  it('appends, truncates and zero-extends', () => {
    const b = new wxMemoryBuffer(new Uint8Array([1, 2]));
    b.AppendData(new Uint8Array([3, 4, 5]));
    expect([...b.GetData()]).toEqual([1, 2, 3, 4, 5]);

    b.SetDataLen(1);
    b.SetDataLen(3);
    expect([...b.GetData()]).toEqual([1, 0, 0]);
    expect(b.GetDataLen()).toBe(3);
  });
});

describe('the clipboard', () => {
  it('reads back the text it saved', () => {
    expect(SaveClipboard('héllo')).toBe(true);
    expect(GetClipboardUTF8()).toBe('héllo');
    expect(GetImageFromClipboard()).toBeNull();
  });

  it('prefers the application/kicad payload to the text', () => {
    SaveClipboard('plain', [
      {
        m_mimeType: 'application/kicad',
        m_data: new wxMemoryBuffer(new TextEncoder().encode('(kicad_sch)')),
      },
    ]);
    expect(GetClipboardUTF8()).toBe('(kicad_sch)');
  });

  it('skips an entry with no data and no image', () => {
    SaveClipboard('plain', [{ m_mimeType: 'application/kicad', m_data: new wxMemoryBuffer() }]);
    expect(GetClipboardUTF8()).toBe('plain');
  });

  it('offers an entry’s image as a PNG', () => {
    SaveClipboard('', [
      { m_mimeType: 'image/png', m_data: new wxMemoryBuffer(), m_image: new WX_IMAGE(4, 5) },
    ]);
    const img = GetImageFromClipboard()!;
    expect([img.GetWidth(), img.GetHeight()]).toEqual([4, 5]);
  });

  it('forgets an image when text is saved over it', () => {
    SaveClipboard('', [
      { m_mimeType: 'image/png', m_data: new wxMemoryBuffer(), m_image: new WX_IMAGE(4, 5) },
    ]);
    SaveClipboard('text');
    expect(GetImageFromClipboard()).toBeNull();
  });

  it('round-trips a table as CSV', () => {
    SaveTabularDataToClipboard([
      ['Ref', 'Value'],
      ['R1', '10 "k"'],
    ]);
    expect(GetClipboardUTF8()).toBe('"Ref","Value"\n"R1","10 ""k"""\n');

    const rows: string[][] = [];
    expect(GetTabularDataFromClipboard(rows)).toBe(true);
    expect(rows).toEqual([
      ['Ref', 'Value'],
      ['R1', '10 "k"'],
    ]);
  });

  it('has no table when it holds no text', async () => {
    await SetClipboardFromPaste(fakePaste({}));
    const rows: string[][] = [['untouched']];
    expect(GetTabularDataFromClipboard(rows)).toBe(false);
    expect(rows).toEqual([['untouched']]);
  });

  it('builds a composite with a transparent image', () => {
    const data = new wxDataObjectComposite();
    data.text = 't';
    expect(AddTransparentImageToClipboardData(data, new WX_IMAGE())).toBe(false);
    expect(AddTransparentImageToClipboardData(data, new WX_IMAGE(3, 2))).toBe(true);
    SetClipboardData(data);

    expect(GetClipboardUTF8()).toBe('t');
    expect(GetImageFromClipboard()?.GetWidth()).toBe(3);
  });

  it('encodes nothing for an image that is not OK', () => {
    const out = new wxMemoryBuffer(new Uint8Array([9]));
    expect(EncodeImageToPng(new WX_IMAGE(), out)).toBe(false);
    expect(out.GetDataLen()).toBe(1);

    expect(EncodeImageToPng(new WX_IMAGE(1, 1), out)).toBe(true);
    expect([...out.GetData().subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]); // "PNG"
  });

  it('becomes what a paste event carries', async () => {
    const png = new WX_IMAGE(6, 7).SaveFilePng()!;
    await SetClipboardFromPaste(fakePaste({ text: 'pasted', png }));

    expect(GetClipboardUTF8()).toBe('pasted');
    expect(GetImageFromClipboard()?.GetHeight()).toBe(7);

    await SetClipboardFromPaste(fakePaste({ text: 'only text' }));
    expect(GetImageFromClipboard()).toBeNull();
  });
});

/** The part of a paste event's `DataTransfer` the clipboard reads. */
function fakePaste(aWith: { text?: string; png?: Uint8Array }): DataTransfer {
  const items = aWith.png
    ? [
        {
          kind: 'file',
          type: 'image/png',
          getAsFile: () => new File([aWith.png as BlobPart], 'x.png', { type: 'image/png' }),
        },
      ]
    : [];

  return {
    types: aWith.text === undefined ? [] : ['text/plain'],
    getData: (aType: string) => (aType === 'text/plain' ? (aWith.text ?? '') : ''),
    items,
  } as unknown as DataTransfer;
}
