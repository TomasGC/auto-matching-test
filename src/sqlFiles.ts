import fs from 'fs';
import path from 'path';

type Queryable = { query: (sql: string) => Promise<unknown> };

// Runs every .sql file of a directory, in name order.
export async function runSqlFiles(target: Queryable, directory: string): Promise<void> {
  for (const file of fs.readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()) {
    await target.query(fs.readFileSync(path.join(directory, file), 'utf8'));
  }
}
