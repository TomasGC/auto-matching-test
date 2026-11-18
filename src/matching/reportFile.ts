import fs from 'fs/promises';
import path from 'path';

const DEFAULT_DIRECTORY = path.join(__dirname, '..', '..', 'reports');

// reports/ in the project, or the folder in REPORT_DIRECTORY. Read at each call, like the database settings.
const reportDirectory = () => process.env.REPORT_DIRECTORY ?? DEFAULT_DIRECTORY;

// reports/auto-matching-<siren>-<date>.log. The date has no ":" so the name is valid on Windows too.
export async function writeReport(
  lines: string[],
  siren: string,
  runAt: Date,
  directory: string = reportDirectory(),
): Promise<string> {
  await fs.mkdir(directory, { recursive: true });
  const stamp = runAt.toISOString().replace(/[:.]/g, '-');
  const file = path.join(directory, `auto-matching-${siren.replace(/\W/g, '_')}-${stamp}.log`);
  await fs.writeFile(file, `${lines.join('\n')}\n`);
  return file;
}
