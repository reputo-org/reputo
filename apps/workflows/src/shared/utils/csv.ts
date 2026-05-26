import { stringify } from 'csv-stringify';

export function stringifyCsvAsync(
  records: Parameters<typeof stringify>[0],
  options: { header: boolean; columns: string[] },
): Promise<string> {
  return new Promise((resolve, reject) => {
    stringify(records, options, (err, output) => {
      if (err) reject(err);
      else resolve(output);
    });
  });
}
