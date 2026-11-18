import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeReport } from './reportFile';

const RUN_AT = new Date('2026-11-18T09:12:03.456Z');

let directory: string;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reports-'));
});

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

describe('writeReport', () => {
  it('writes the lines in a file named after the company and the date', async () => {
    const file = await writeReport(['first', 'second'], '900997767', RUN_AT, directory);
    expect(path.basename(file)).toBe('auto-matching-900997767-2026-11-18T09-12-03-456Z.log');
    expect(await fs.readFile(file, 'utf8')).toBe('first\nsecond\n');
  });

  it('creates the directory when it does not exist', async () => {
    const inner = path.join(directory, 'inner');
    const file = await writeReport(['line'], '900997767', RUN_AT, inner);
    expect(path.dirname(file)).toBe(inner);
  });

  it('keeps the file in the directory whatever the company value', async () => {
    const file = await writeReport(['line'], '../x', RUN_AT, directory);
    expect(path.dirname(file)).toBe(directory);
    expect(path.basename(file)).toMatch(/^auto-matching-___x-/);
  });
});
