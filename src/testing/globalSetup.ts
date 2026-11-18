import path from 'path';
import { Client } from 'pg';
import type { TestProject } from 'vitest/node';
import { connectionConfig } from '../db';
import { runSqlFiles } from '../sqlFiles';

const PROJECT_ROOT = path.join(__dirname, '..', '..');

let testDatabase = '';

async function withClient(database: string, work: (client: Client) => Promise<unknown>): Promise<void> {
  const client = new Client({ ...connectionConfig, database });
  await client.connect();
  try {
    await work(client);
  } finally {
    await client.end();
  }
}

async function dropTestDatabase(): Promise<void> {
  await withClient('postgres', (client) => client.query(`drop database if exists ${testDatabase} with (force)`));
}

// Runs once before all the tests: a fresh database with the real migrations and the seed.
export async function setup(project: TestProject): Promise<void> {
  const database = project.config.env.PGDATABASE;
  if (!database) {
    throw new Error('PGDATABASE must be set in the vitest config: the tests need their own database');
  }
  testDatabase = database;
  await dropTestDatabase();
  await withClient('postgres', (client) => client.query(`create database ${testDatabase}`));
  await withClient(testDatabase, async (client) => {
    await runSqlFiles(client, path.join(PROJECT_ROOT, 'migrations'));
    await runSqlFiles(client, path.join(PROJECT_ROOT, 'seeds'));
  });
}

export async function teardown(): Promise<void> {
  await dropTestDatabase();
}
