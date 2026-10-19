import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import type { FormatId } from '../../src/core/formats';
import { getFormat } from '../../src/core/formats';
import { detectFormat } from '../../src/core/sniff';

export const fixture = (name: string) => join(import.meta.dirname, '..', 'fixtures', name);

export interface Converted {
  name: string;
  bytes: Uint8Array;
  /** Every file inside, when the download was a ZIP of several outputs. */
  entries?: Record<string, Uint8Array>;
}

export interface FilePayload {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** Adds files (fixture names or in-memory files) through the real file input, picks a target and converts. */
export async function convert(
  page: Page,
  files: (string | FilePayload)[],
  target: FormatId,
  setOptions?: (page: Page) => Promise<void>,
): Promise<void> {
  await page.goto('./');
  const inputs = files.map((f) => (typeof f === 'string' ? fixture(f) : f));
  await page.locator('input[type=file]').setInputFiles(inputs as string[] | FilePayload[]);
  const label = getFormat(target).label;
  await page.getByRole('button', { name: label, exact: true }).first().click();
  await expect(page.getByRole('button', { name: label, exact: true }).first()).toHaveAttribute('aria-pressed', 'true');
  if (setOptions) await setOptions(page);
  await page.getByRole('button', { name: /^Convert .*to / }).click();
  // Done when a save button appears for every result, or an error shows.
  await expect(page.getByRole('button', { name: /^Save/ }).or(page.getByRole('alert')).first()).toBeVisible();
  const errors = await page.getByRole('alert').allTextContents();
  expect(errors, 'conversion errors').toEqual([]);
}

/** Clicks the primary save button and returns the downloaded file. */
export async function saveResult(page: Page): Promise<Converted> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /^Save/ }).first().click(),
  ]);
  const path = await download.path();
  const bytes = new Uint8Array(readFileSync(path));
  const name = download.suggestedFilename();
  if (name.endsWith('.zip')) return { name, bytes, entries: unzipSync(bytes) };
  return { name, bytes };
}

/** Uses the app's own content sniffer to check the output really is the target format. */
export async function expectFormat(file: { name: string; bytes: Uint8Array }, target: FormatId) {
  const detected = await detectFormat(new File([file.bytes as BlobPart], file.name));
  expect(detected, `${file.name} should be ${target}`).toBe(target);
  expect(file.bytes.byteLength).toBeGreaterThan(0);
}

export const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes).replace(/^﻿/, '');
