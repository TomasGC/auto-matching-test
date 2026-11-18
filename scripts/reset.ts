import path from 'path';
import { db } from '../src/db';
import { runSqlFiles } from '../src/sqlFiles';

async function reset() {
  await db.query('drop schema public cascade');
  await db.query('create schema public');
  await runSqlFiles(db, path.join(__dirname, '..', 'migrations'));
  await runSqlFiles(db, path.join(__dirname, '..', 'seeds'));
  await db.end();
}

reset().catch(async (e) => {
  console.error(e);
  await db.end();
  process.exit(1);
});
