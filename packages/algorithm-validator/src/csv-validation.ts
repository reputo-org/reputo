import type { CSVValidationResult, CsvIoItem } from './types/index.js';

function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/^\uFEFF/, '')
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .replace(/[\s\-\u2011\u2013\u2014]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function readContent(file: File | string | Buffer): Promise<{ text: string; fileInfo: Record<string, unknown> }> {
  if (typeof file === 'string') {
    return { text: file, fileInfo: { kind: 'string' } };
  }

  if (Buffer.isBuffer(file)) {
    return { text: file.toString('utf-8'), fileInfo: { kind: 'buffer' } };
  }

  return {
    text: await file.text(),
    fileInfo: {
      kind: 'file',
      name: file.name,
      type: file.type,
      size: file.size,
    },
  };
}

/**
 * Validates CSV content against column definitions and constraints.
 *
 * This function works identically on both client and server, supporting:
 * - File objects (browser environment)
 * - String content (universal)
 * - Buffer objects (Node.js environment)
 *
 * Validation includes:
 * - Required column presence (with alias support)
 * - Row count limits
 * - Column count consistency
 * - Enum value validation
 * - Delimiter detection
 * - BOM and line ending normalization
 *
 * @param file - File object (browser), string content, or Buffer (Node.js)
 * @param csvConfig - CSV configuration from CsvIoItem defining expected columns and constraints
 * @returns Promise resolving to a CSVValidationResult with validation status and any errors
 *
 * @example
 * ```typescript
 * const csvConfig: CsvIoItem['csv'] = {
 *   hasHeader: true,
 *   delimiter: ',',
 *   maxRows: 10000,
 *   columns: [
 *     { key: 'user_id', type: 'string', required: true, aliases: ['userId'] },
 *     { key: 'vote', type: 'enum', required: true, enum: ['upvote', 'downvote'] }
 *   ]
 * }
 *
 * // Browser
 * const result = await validateCSVContent(fileInput.files[0], csvConfig)
 *
 * // Node.js
 * const result = await validateCSVContent(csvString, csvConfig)
 * ```
 */
export async function validateCSVContent(
  file: File | string | Buffer,
  csvConfig: CsvIoItem['csv'],
): Promise<CSVValidationResult> {
  const errors: string[] = [];

  try {
    const { text: rawText, fileInfo } = await readContent(file);

    const hadBom = rawText.startsWith('\uFEFF');
    let text = rawText.replace(/^\uFEFF/, '');
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const rawLines = text.split('\n');
    const lines = rawLines.filter((line) => line.trim().length > 0);

    const hasHeader = csvConfig.hasHeader ?? true;
    const dataLines = hasHeader ? lines.slice(1) : lines;
    if (csvConfig.maxRows !== undefined && dataLines.length > csvConfig.maxRows) {
      errors.push(`CSV has ${dataLines.length} rows, but maximum is ${csvConfig.maxRows}`);
    }

    const headerLine = hasHeader ? lines[0] : null;
    if (!headerLine && hasHeader) {
      errors.push('CSV is missing header row');
      return { valid: false, errors };
    }

    const configuredDelimiter = csvConfig.delimiter ?? ',';
    const candidateDelimiters = [configuredDelimiter, ',', ';', '\t', '|'].filter(
      (d, idx, arr) => d !== undefined && arr.indexOf(d) === idx,
    );
    let delimiter = configuredDelimiter;
    if (headerLine) {
      let bestSplit = headerLine.split(delimiter);
      if (bestSplit.length <= 1) {
        for (const cand of candidateDelimiters) {
          const split = headerLine.split(cand);
          if (split.length > bestSplit.length) {
            bestSplit = split;
            delimiter = cand;
          }
        }
      }
    }

    const headers = headerLine ? headerLine.split(delimiter) : [];
    const headersSanitized = headers.map((h) =>
      h
        .replace(/^\uFEFF/, '')
        .replace(/\u00a0/g, ' ')
        .trim()
        .replace(/^["']+|["']+$/g, ''),
    );
    const headersLower = headersSanitized.map((h) => h.toLowerCase());
    const headersNormalized = headersSanitized.map((h) => normalizeKey(h));

    console.groupCollapsed?.('[CSV Validation] Debug');
    console.log?.('Input', fileInfo);
    console.log?.('Had BOM', hadBom);
    console.log?.('Configured delimiter', configuredDelimiter);
    console.log?.('Chosen delimiter', delimiter);
    console.log?.('Candidate delimiters', candidateDelimiters);
    console.log?.('Lines count (raw/non-empty)', rawLines.length, '/', lines.length);
    console.log?.('Header line (first 200 chars)', headerLine?.slice(0, 200));
    console.log?.('Headers (raw)', headers);
    console.log?.('Headers (sanitized)', headersSanitized);
    console.log?.('Headers (lower)', headersLower);
    console.log?.('Headers (normalized)', headersNormalized);
    console.log?.(
      'Required columns',
      csvConfig.columns.filter((c) => c.required !== false),
    );
    console.groupEnd?.();

    const requiredColumns = csvConfig.columns.filter((col) => col.required !== false);

    for (const column of requiredColumns) {
      const candidateKeys = [column.key, ...(column.aliases ?? [])];
      const candidateLower = candidateKeys.map((k) => k.toLowerCase());
      const candidateNormalized = candidateKeys.map((k) => normalizeKey(k));
      const found =
        candidateLower.some((k) => headersLower.includes(k)) ||
        candidateNormalized.some((k) => headersNormalized.includes(k));

      if (!found) {
        errors.push(
          `Missing required column: ${column.key}${
            column.aliases?.length ? ` (or aliases: ${column.aliases.join(', ')})` : ''
          }`,
        );
      }
    }

    if (dataLines.length === 0) {
      errors.push('CSV must contain at least one data row');
    }

    const sampleSize = Math.min(5, dataLines.length);
    for (let i = 0; i < sampleSize; i++) {
      const row = dataLines[i];
      if (row === undefined) continue;

      const values = row.split(delimiter);

      if (values.length !== headers.length) {
        errors.push(`Row ${i + 1} has ${values.length} values but header has ${headers.length} columns`);
      }

      for (const col of csvConfig.columns.filter((c) => c.type === 'enum')) {
        const colIndex = headersLower.findIndex((h) =>
          [col.key, ...(col.aliases ?? [])].map((k) => k.toLowerCase()).includes(h),
        );
        if (colIndex >= 0) {
          const value = values[colIndex]?.trim().replace(/^["']+|["']+$/g, '');
          if (value && col.enum && !col.enum.includes(value)) {
            errors.push(
              `Row ${i + 1}, column ${col.key}: "${value}" is not a valid value. Expected one of: ${col.enum.join(
                ', ',
              )}`,
            );
          }
        }
      }
    }
  } catch (error) {
    errors.push(`Failed to parse CSV: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
