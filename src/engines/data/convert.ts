import { ConversionError } from '../types';

/**
 * Structured data (JSON, YAML, TOML, XML) conversions. Pure functions over
 * strings, so they run anywhere and are easy to test.
 */

export type StructuredFormat = 'json' | 'yaml' | 'toml' | 'xml';

const XML_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  cdataPropName: '#cdata',
  commentPropName: '#comment',
} as const;

export async function parseStructured(text: string, format: StructuredFormat): Promise<unknown> {
  const source = text.replace(/^﻿/, '');
  try {
    switch (format) {
      case 'json':
        return JSON.parse(source);
      case 'yaml': {
        const YAML = await import('yaml');
        const docs = YAML.parseAllDocuments(source);
        const list = Array.isArray(docs) ? docs : [docs];
        for (const doc of list) if (doc.errors.length > 0) throw doc.errors[0];
        const values = list.map((doc) => doc.toJS({ maxAliasCount: 1000 }));
        return values.length === 1 ? values[0] : values;
      }
      case 'toml': {
        const { parse } = await import('smol-toml');
        return parse(source);
      }
      case 'xml': {
        const { XMLParser, XMLValidator } = await import('fast-xml-parser');
        const valid = XMLValidator.validate(source);
        if (valid !== true) throw new Error(`${valid.err.msg} (line ${valid.err.line})`);
        return new XMLParser({
          ...XML_OPTIONS,
          parseTagValue: true,
          parseAttributeValue: true,
          // Keep values like "007" or "0x1F" as written.
          numberParseOptions: { leadingZeros: false, hex: false, eNotation: false },
          trimValues: true,
          ignoreDeclaration: true,
          ignorePiTags: true,
        }).parse(source);
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message.split('\n')[0] : '';
    throw new ConversionError(
      `This ${format.toUpperCase()} file has a syntax error${detail ? `: ${detail}` : '.'}`,
      'syntax',
    );
  }
}

export async function stringifyStructured(value: unknown, format: StructuredFormat): Promise<string> {
  switch (format) {
    case 'json':
      return `${JSON.stringify(value, null, 2)}\n`;
    case 'yaml': {
      const YAML = await import('yaml');
      return YAML.stringify(value, { lineWidth: 0 });
    }
    case 'toml': {
      // TOML documents are tables; a top-level list becomes an array of tables named "items".
      const table = Array.isArray(value) ? { items: value } : value;
      if (table === null || typeof table !== 'object') {
        throw new ConversionError(
          'TOML needs named keys at the top level, but this data is a single value. Try JSON or YAML instead.',
          'shape',
        );
      }
      if (containsNull(table)) {
        throw new ConversionError(
          'TOML can’t store empty (null) values, and this data has some. Try JSON or YAML instead.',
          'shape',
        );
      }
      const { stringify } = await import('smol-toml');
      return `${stringify(table).trim()}\n`;
    }
    case 'xml': {
      const { XMLBuilder } = await import('fast-xml-parser');
      const root = xmlRoot(value);
      const body = new XMLBuilder({ ...XML_OPTIONS, format: true, indentBy: '  ', suppressEmptyNode: true }).build(
        root,
      );
      return `<?xml version="1.0" encoding="UTF-8"?>\n${String(body).trim()}\n`;
    }
  }
}

/** XML needs exactly one root element; wrap anything else. */
function xmlRoot(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value).filter((k) => !k.startsWith('?'));
    if (
      keys.length === 1 &&
      !keys[0]?.startsWith('@_') &&
      !Array.isArray((value as Record<string, unknown>)[keys[0] as string])
    ) {
      return value as Record<string, unknown>;
    }
    return { root: value };
  }
  if (Array.isArray(value)) return { root: { item: value } };
  return { root: value };
}

function containsNull(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.some(containsNull);
  if (typeof value === 'object' && !(value instanceof Date)) return Object.values(value).some(containsNull);
  return false;
}

/**
 * Turns JSON into spreadsheet rows. Accepts a list of records, a list of lists,
 * or an object of named lists (one sheet each). Nested objects are flattened to
 * dotted column names so nothing is lost.
 */
export function jsonToTables(value: unknown): { name: string; rows: unknown[] }[] {
  if (Array.isArray(value)) return [{ name: 'Sheet1', rows: normaliseRows(value) }];
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length > 0 && entries.every(([, v]) => Array.isArray(v))) {
      return entries.map(([name, rows]) => ({ name: sheetName(name), rows: normaliseRows(rows as unknown[]) }));
    }
    return [{ name: 'Sheet1', rows: [flatten(value as Record<string, unknown>)] }];
  }
  throw new ConversionError('To become a spreadsheet, this JSON needs to be a list of records.', 'shape');
}

function normaliseRows(rows: unknown[]): unknown[] {
  if (rows.every((row) => Array.isArray(row))) return rows;
  return rows.map((row) =>
    row && typeof row === 'object' && !Array.isArray(row) ? flatten(row as Record<string, unknown>) : { value: row },
  );
}

export function flatten(
  record: Record<string, unknown>,
  prefix = '',
  out: Record<string, unknown> = {},
): Record<string, unknown> {
  for (const [key, value] of Object.entries(record)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      flatten(value as Record<string, unknown>, name, out);
    } else if (Array.isArray(value)) {
      out[name] = JSON.stringify(value);
    } else {
      out[name] = value;
    }
  }
  return out;
}

/** Excel limits sheet names to 31 characters and forbids a few symbols. */
export function sheetName(name: string): string {
  const cleaned = name
    .replace(/[\\/?*[\]:]/g, ' ')
    .trim()
    .slice(0, 31);
  return cleaned || 'Sheet';
}

/** "92.5" → 92.5, but "007" and "1e5x" stay text: only plain decimal numbers are converted. */
export function inferNumber(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return /^-?(0|[1-9]\d*)(\.\d+)?$/.test(value) && value.length < 16 ? Number(value) : value;
}

/**
 * Spreadsheet dates have no time zone, so they are written as they appear
 * ("2021-04-01", "2021-04-01T09:30:00") rather than shifted to UTC.
 */
export function plainValue(value: unknown): unknown {
  if (!(value instanceof Date)) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  const h = value.getHours();
  const m = value.getMinutes();
  const sec = value.getSeconds();
  return h || m || sec ? `${date}T${pad(h)}:${pad(m)}:${pad(sec)}` : date;
}
