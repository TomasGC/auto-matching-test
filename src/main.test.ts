import { spawnSync } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectionConfig } from './db';
import { runSqlFiles } from './sqlFiles';

// main.ts runs as a real process, as `npm start` does, on a database of its own.
const DATABASE = 'matching_main_test';
const PROJECT = path.join(__dirname, '..');
const SLOW = 30_000;

let reportDirectory: string;

async function withAdmin(work: (admin: Client) => Promise<unknown>): Promise<void> {
  const admin = new Client({ ...connectionConfig, database: 'postgres' });
  await admin.connect();
  try {
    await work(admin);
  } finally {
    await admin.end();
  }
}

beforeAll(async () => {
  await withAdmin(async (admin) => {
    await admin.query(`drop database if exists ${DATABASE} with (force)`);
    await admin.query(`create database ${DATABASE}`);
  });
  const client = new Client({ ...connectionConfig, database: DATABASE });
  await client.connect();
  await runSqlFiles(client, path.join(PROJECT, 'migrations'));
  await client.query(
    `insert into company (id, siren, name) values ('10000000-0000-4000-8000-000000000001', '900997767', 'Company')`,
  );
  await client.end();
});

afterAll(async () => {
  await withAdmin((admin) => admin.query(`drop database if exists ${DATABASE} with (force)`));
});

beforeEach(async () => {
  reportDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'main-reports-'));
});

afterEach(async () => {
  await fs.rm(reportDirectory, { recursive: true, force: true });
});

function runMain(env: Record<string, string> = {}) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'main.ts'], {
    cwd: PROJECT,
    env: { ...process.env, PGDATABASE: DATABASE, REPORT_DIRECTORY: reportDirectory, ...env },
    encoding: 'utf8',
  });
}

async function readReport(): Promise<string> {
  const files = await fs.readdir(reportDirectory);
  expect(files).toHaveLength(1);
  return fs.readFile(path.join(reportDirectory, files[0]), 'utf8');
}

describe('main.ts', () => {
  it('runs the job, prints the summary and the report path, and exits with 0', async () => {
    const result = runMain();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Matched 0 of 0 transactions');
    expect(result.stdout).toContain('Report:');
    expect(await readReport()).toContain('Status: completed');
  }, SLOW);

  it('exits with 1 and leaves a failure report when the database cannot be reached', async () => {
    const result = runMain({ PGPORT: '1' });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/ECONNREFUSED/);
    expect(await readReport()).toContain('Status: FAILED, nothing was saved');
  }, SLOW);
});
