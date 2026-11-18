import { PoolClient } from 'pg';
import { db } from '../db';

// A client inside a database transaction, on the test database only.
export async function openTestTransaction(): Promise<PoolClient> {
  const client = await db.connect();
  const { rows } = await client.query<{ name: string }>('select current_database() as name');
  if (rows[0].name !== process.env.PGDATABASE) {
    client.release();
    throw new Error(`The tests must run on ${process.env.PGDATABASE}, not on ${rows[0].name}`);
  }
  await client.query('begin');
  return client;
}

// Nothing written by a test stays in the database.
export async function closeTestTransaction(client: PoolClient): Promise<void> {
  await client.query('rollback');
  client.release();
}
