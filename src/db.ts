import { Pool, types } from 'pg';

// Dates stay as 'YYYY-MM-DD' text. A JavaScript Date would be shifted by the machine timezone.
types.setTypeParser(types.builtins.DATE, (value) => value);

export const connectionConfig = {
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'matching',
  options: '-c timezone=UTC',
};

export const db = new Pool(connectionConfig);
