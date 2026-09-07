import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateCSVContent } from '../../src/csv-validation.js';
import type { CsvIoItem } from '../../src/types/index.js';

const csvConfig: CsvIoItem['csv'] = {
  hasHeader: true,
  delimiter: ',',
  maxRows: 2,
  columns: [
    {
      key: 'user_id',
      type: 'string',
      required: true,
      aliases: ['User ID'],
    },
    {
      key: 'vote',
      type: 'enum',
      required: true,
      enum: ['upvote', 'downvote'],
    },
  ],
};

describe('validateCSVContent', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a buffer input with BOM, alias matching, and delimiter fallback', async () => {
    const buffer = Buffer.from('\uFEFFUser ID;vote\n1;upvote\n2;downvote\n', 'utf-8');

    const result = await validateCSVContent(buffer, csvConfig);

    expect(result).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('reports a missing header row when headers are required', async () => {
    const result = await validateCSVContent('', csvConfig);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('The CSV file is missing a header row.');
  });

  it('reports row-count, column-count, and enum validation issues together', async () => {
    const csv = ['user_id,vote', '1,maybe,extra', '2,downvote', '3,upvote'].join('\n');

    const result = await validateCSVContent(csv, csvConfig);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('The CSV file has 3 data rows. The maximum is 2.');
    expect(result.errors).toContain('Row 1 has 3 values, but the header row has 2 columns.');
    expect(result.errors).toContain('Row 1, column vote: "maybe" is not valid. Use one of: upvote, downvote.');
  });

  it('returns a parse error when file text reading fails', async () => {
    const file = {
      name: 'broken.csv',
      type: 'text/csv',
      size: 10,
      text: vi.fn().mockRejectedValue(new Error('cannot read file')),
    } as unknown as File;

    const result = await validateCSVContent(file, csvConfig);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Could not read the CSV file: cannot read file');
  });
});
