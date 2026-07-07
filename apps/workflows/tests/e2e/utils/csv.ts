import { parse } from 'csv-parse/sync';

/**
 * Parses a result CSV (header row + records) into row objects, matching the
 * options the algorithms use when reading their own CSV inputs. Use to assert on
 * the bytes a compute function wrote back to storage.
 */
export function parseCsv(text: string): Record<string, string>[] {
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];
}

/** Builds CSV text from a header and rows (handy for seeding input CSVs). */
export function toCsv(header: string[], rows: Array<Array<string | number>>): string {
  const lines = [header.join(','), ...rows.map((row) => row.join(','))];
  return `${lines.join('\n')}\n`;
}
