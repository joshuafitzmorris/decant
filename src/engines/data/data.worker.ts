import { unzipSync, type Zippable, zipSync } from 'fflate';
import * as XLSX from 'xlsx';
import * as cptable from 'xlsx/dist/cpexcel.full.mjs';
import type { FormatId } from '../../core/formats';
import { serve } from '../../lib/worker-host';
import { ConversionError } from '../types';
import {
  inferNumber,
  jsonToTables,
  parseStructured,
  plainValue,
  type StructuredFormat,
  sheetName,
  stringifyStructured,
} from './convert';

XLSX.set_cptable(cptable);

export interface DataTask {
  file: File;
  from: FormatId;
  to: FormatId;
}

export interface DataOutput {
  blob: Blob;
  suffix?: string;
}

const STRUCTURED = new Set<string>(['json', 'yaml', 'toml', 'xml']);
const MIME: Record<string, string> = {
  csv: 'text/csv;charset=utf-8',
  tsv: 'text/tab-separated-values;charset=utf-8',
  json: 'application/json;charset=utf-8',
  yaml: 'application/yaml;charset=utf-8',
  toml: 'application/toml;charset=utf-8',
  xml: 'application/xml;charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
};

serve<DataTask, DataOutput[]>(async ({ file, from, to }, progress) => {
  progress(null, 'Reading');
  if (STRUCTURED.has(from) && STRUCTURED.has(to)) {
    const value = await parseStructured(await file.text(), from as StructuredFormat);
    const text = await stringifyStructured(value, to as StructuredFormat);
    return { result: [{ blob: new Blob([text], { type: MIME[to] }) }] };
  }

  // Text-to-text conversions keep every value exactly as written; only real
  // spreadsheet targets get numbers and dates recognised.
  const literal = (from === 'csv' || from === 'tsv') && (to === 'csv' || to === 'tsv' || to === 'json');
  const workbook = await readWorkbook(file, from, literal);
  progress(null, 'Writing');
  return { result: writeWorkbook(workbook, to, literal) };
});

async function readWorkbook(file: File, from: FormatId, literal: boolean): Promise<XLSX.WorkBook> {
  if (from === 'json') {
    const tables = jsonToTables(await parseStructured(await file.text(), 'json'));
    const book = XLSX.utils.book_new();
    for (const table of tables) {
      const sheet = table.rows.every((row) => Array.isArray(row))
        ? XLSX.utils.aoa_to_sheet(table.rows as unknown[][])
        : XLSX.utils.json_to_sheet(table.rows as Record<string, unknown>[]);
      XLSX.utils.book_append_sheet(book, sheet, uniqueSheetName(book, table.name));
    }
    return book;
  }
  try {
    if (from === 'csv' || from === 'tsv') {
      const text = (await file.text()).replace(/^﻿/, '');
      return XLSX.read(text, {
        type: 'string',
        raw: literal,
        cellDates: true,
        dateNF: 'yyyy-mm-dd',
        ...(from === 'tsv' ? { FS: '\t' } : {}),
      });
    }
    return XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/password|encrypt/i.test(message)) {
      throw new ConversionError(
        'This spreadsheet is password-protected. Remove the password and try again.',
        'password',
      );
    }
    throw new ConversionError("This spreadsheet couldn't be read. It may be damaged.", 'invalid');
  }
}

function writeWorkbook(book: XLSX.WorkBook, to: FormatId, literal: boolean): DataOutput[] {
  const sheets = book.SheetNames.filter((name) => {
    const ref = book.Sheets[name]?.['!ref'];
    return ref !== undefined && ref !== '';
  });
  if (sheets.length === 0) throw new ConversionError('This spreadsheet is empty.', 'empty');

  switch (to) {
    case 'xlsx':
    case 'ods': {
      const data = XLSX.write(book, { bookType: to, type: 'array', compression: false }) as ArrayBuffer;
      return [{ blob: new Blob([recompress(data)], { type: MIME[to] }) }];
    }
    case 'csv':
    case 'tsv':
      return sheets.map((name) => {
        const sheet = book.Sheets[name] as XLSX.WorkSheet;
        const text = XLSX.utils.sheet_to_csv(sheet, { FS: to === 'tsv' ? '\t' : ',', blankrows: false });
        // A BOM makes Excel read UTF-8 CSVs correctly.
        return {
          blob: new Blob([`﻿${text}\n`], { type: MIME[to] }),
          suffix: sheets.length > 1 ? `-${slug(name)}` : undefined,
        };
      });
    case 'json': {
      const rowsOf = (name: string) =>
        XLSX.utils
          .sheet_to_json<Record<string, unknown>>(book.Sheets[name] as XLSX.WorkSheet, { defval: null, raw: true })
          .map((row) =>
            Object.fromEntries(Object.entries(row).map(([k, v]) => [k, literal ? inferNumber(v) : plainValue(v)])),
          );
      const tables = Object.fromEntries(sheets.map((name) => [name, rowsOf(name)]));
      const value = sheets.length === 1 ? tables[sheets[0] as string] : tables;
      return [{ blob: new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: MIME.json }) }];
    }
    default:
      throw new ConversionError(`Decant can't write ${to.toUpperCase()} from a spreadsheet.`);
  }
}

function uniqueSheetName(book: XLSX.WorkBook, name: string): string {
  let candidate = sheetName(name);
  for (let n = 2; book.SheetNames.includes(candidate); n++) candidate = `${sheetName(name).slice(0, 28)} ${n}`;
  return candidate;
}

function slug(name: string): string {
  return (
    name
      .trim()
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'sheet'
  );
}

/**
 * SheetJS's built-in deflate is quick but weak. Writing uncompressed and
 * re-packing with fflate gives files two to three times smaller in about the
 * same time. ODF requires the "mimetype" entry to stay first and uncompressed.
 */
function recompress(data: ArrayBuffer): Uint8Array<ArrayBuffer> {
  const entries = unzipSync(new Uint8Array(data));
  const packed: Zippable = {};
  for (const [name, bytes] of Object.entries(entries)) {
    packed[name] = [bytes, { level: name === 'mimetype' ? 0 : 6 }];
  }
  return zipSync(packed) as Uint8Array<ArrayBuffer>;
}
