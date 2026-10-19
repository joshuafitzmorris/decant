import { describe, expect, it } from 'vitest';
import {
  flatten,
  inferNumber,
  jsonToTables,
  parseStructured,
  plainValue,
  sheetName,
  stringifyStructured,
} from '../../src/engines/data/convert';
import { ConversionError } from '../../src/engines/types';

const sample = {
  service: 'decant',
  version: 1,
  features: ['images', 'audio'],
  limits: { maxFiles: 50, offline: true },
};

describe('structured data', () => {
  it.each(['json', 'yaml', 'toml', 'xml'] as const)('round-trips through %s', async (format) => {
    const text = await stringifyStructured(sample, format);
    const parsed = await parseStructured(text, format);
    if (format === 'xml') {
      // XML has a single root element, so the object comes back wrapped.
      expect(parsed).toEqual({ root: sample });
    } else {
      expect(parsed).toEqual(sample);
    }
  });

  it('turns a list into TOML tables instead of refusing', async () => {
    const toml = await stringifyStructured([{ name: 'Ada' }, { name: 'Grace' }], 'toml');
    expect(toml).toBe('[[items]]\nname = "Ada"\n\n[[items]]\nname = "Grace"\n');
  });

  it('explains why TOML cannot hold nulls', async () => {
    await expect(stringifyStructured({ a: null }, 'toml')).rejects.toThrow(/null/);
  });

  it('drops the XML declaration rather than treating it as data', async () => {
    const parsed = await parseStructured('<?xml version="1.0"?>\n<a x="1"><b>2</b><zip>007</zip></a>', 'xml');
    expect(parsed).toEqual({ a: { b: 2, zip: '007', '@_x': 1 } });
  });

  it('reads multi-document YAML as a list', async () => {
    expect(await parseStructured('a: 1\n---\na: 2\n', 'yaml')).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('reports syntax errors in plain words', async () => {
    const error = await parseStructured('{"a": ', 'json').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConversionError);
    expect((error as ConversionError).message).toMatch(/^This JSON file has a syntax error/);
  });

  it('ignores a byte-order mark', async () => {
    expect(await parseStructured('﻿{"a":1}', 'json')).toEqual({ a: 1 });
  });
});

describe('spreadsheet values', () => {
  it('converts plain numbers but keeps codes and identifiers as text', () => {
    expect(inferNumber('92.5')).toBe(92.5);
    expect(inferNumber('-3')).toBe(-3);
    expect(inferNumber('0')).toBe(0);
    expect(inferNumber('007')).toBe('007');
    expect(inferNumber('1e5')).toBe('1e5');
    expect(inferNumber('12345678901234567890')).toBe('12345678901234567890');
    expect(inferNumber('2021-04-01')).toBe('2021-04-01');
    expect(inferNumber(null)).toBeNull();
  });

  it('writes dates without shifting them into another time zone', () => {
    expect(plainValue(new Date(2021, 3, 1))).toBe('2021-04-01');
    expect(plainValue(new Date(2021, 3, 1, 9, 30, 5))).toBe('2021-04-01T09:30:05');
    expect(plainValue('text')).toBe('text');
  });

  it('flattens nested records into dotted columns', () => {
    expect(flatten({ a: 1, b: { c: 2, d: { e: 3 } }, list: [1, 2] })).toEqual({
      a: 1,
      'b.c': 2,
      'b.d.e': 3,
      list: '[1,2]',
    });
  });

  it('accepts records, rows, or named lists of records', () => {
    expect(jsonToTables([{ a: 1 }])).toEqual([{ name: 'Sheet1', rows: [{ a: 1 }] }]);
    expect(
      jsonToTables([
        [1, 2],
        [3, 4],
      ]),
    ).toEqual([
      {
        name: 'Sheet1',
        rows: [
          [1, 2],
          [3, 4],
        ],
      },
    ]);
    expect(jsonToTables({ People: [{ a: 1 }], 'Q1/Q2': [{ b: 2 }] }).map((t) => t.name)).toEqual(['People', 'Q1 Q2']);
    expect(jsonToTables({ a: 1 })).toEqual([{ name: 'Sheet1', rows: [{ a: 1 }] }]);
    expect(() => jsonToTables(42)).toThrow(ConversionError);
  });

  it('keeps sheet names within Excel’s rules', () => {
    expect(sheetName('A'.repeat(40))).toHaveLength(31);
    expect(sheetName('a/b:c')).toBe('a b c');
    expect(sheetName('   ')).toBe('Sheet');
  });
});
