import type { JSONValidationResult, JsonIoItem } from './types/index.js';

const ETHEREUM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const CARDANO_PAYMENT_ADDRESS_PATTERN = /^addr1[0-9a-z]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getAllowedChains(jsonConfig: JsonIoItem['json']): string[] {
  return jsonConfig?.allowedChains ?? ['ethereum', 'cardano'];
}

function validateChainWalletMap(params: {
  chainMap: Record<string, unknown>;
  pathPrefix: string;
  allowedChains: string[];
  errors: string[];
}): number {
  const chainKeys = Object.keys(params.chainMap);
  const unsupportedChains = chainKeys.filter((chain) => !params.allowedChains.includes(chain));
  if (unsupportedChains.length > 0) {
    params.errors.push(
      `Unsupported wallet chain key(s): ${unsupportedChains.join(', ')}. Allowed chains: ${params.allowedChains.join(', ')}`,
    );
  }

  let walletCount = 0;

  for (const chain of chainKeys) {
    const chainValue = params.chainMap[chain];

    if (!Array.isArray(chainValue)) {
      params.errors.push(`"${params.pathPrefix}.${chain}" must be an array of wallet addresses`);
      continue;
    }

    walletCount += chainValue.length;
    const seen = new Set<string>();

    for (let index = 0; index < chainValue.length; index++) {
      const address = chainValue[index];

      if (typeof address !== 'string' || address.trim() === '') {
        params.errors.push(`"${params.pathPrefix}.${chain}[${index}]" must be a non-empty string`);
        continue;
      }

      const normalizedAddress = chain === 'ethereum' ? address.toLowerCase() : address;
      if (seen.has(normalizedAddress)) {
        params.errors.push(`"${params.pathPrefix}.${chain}" contains a duplicate address: ${address}`);
        continue;
      }
      seen.add(normalizedAddress);

      if (chain === 'ethereum' && !ETHEREUM_ADDRESS_PATTERN.test(address)) {
        params.errors.push(`"${params.pathPrefix}.${chain}[${index}]" must be a valid Ethereum address`);
      }

      if (chain === 'cardano' && !CARDANO_PAYMENT_ADDRESS_PATTERN.test(address)) {
        params.errors.push(`"${params.pathPrefix}.${chain}[${index}]" must be a valid Cardano payment address`);
      }
    }
  }

  return walletCount;
}

async function readContent(file: File | string | Buffer): Promise<{ text: string; sizeBytes: number }> {
  if (typeof file === 'string') {
    return { text: file, sizeBytes: Buffer.byteLength(file, 'utf-8') };
  }

  if (Buffer.isBuffer(file)) {
    return { text: file.toString('utf-8'), sizeBytes: file.byteLength };
  }

  const text = await file.text();
  return {
    text,
    sizeBytes: file.size,
  };
}

function validateWalletAddressMap(parsed: unknown, jsonConfig: JsonIoItem['json'], errors: string[]): void {
  if (!isRecord(parsed)) {
    errors.push('JSON root must be an object');
    return;
  }

  const rootKey = jsonConfig?.rootKey ?? 'wallets';
  const topLevelKeys = Object.keys(parsed);
  const extraTopLevelKeys = topLevelKeys.filter((key) => key !== rootKey);
  if (extraTopLevelKeys.length > 0) {
    errors.push(`JSON must only contain the top-level key "${rootKey}"`);
  }

  const walletsValue = parsed[rootKey];
  if (!isRecord(walletsValue)) {
    errors.push(`"${rootKey}" must be an object`);
    return;
  }

  const walletCount = validateChainWalletMap({
    chainMap: walletsValue,
    pathPrefix: rootKey,
    allowedChains: getAllowedChains(jsonConfig),
    errors,
  });

  if (walletCount === 0) {
    errors.push('Wallet JSON must contain at least one wallet address');
  }
}

export async function validateJSONContent(
  file: File | string | Buffer,
  jsonConfig?: JsonIoItem['json'],
): Promise<JSONValidationResult> {
  const errors: string[] = [];

  try {
    const { text, sizeBytes } = await readContent(file);

    if (jsonConfig?.maxBytes !== undefined && sizeBytes > jsonConfig.maxBytes) {
      errors.push(`JSON file size ${sizeBytes} bytes exceeds algorithm limit of ${jsonConfig.maxBytes} bytes`);
    }

    if (text.trim() === '') {
      errors.push('JSON file is empty');
      return { valid: false, errors };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      errors.push(`Failed to parse JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { valid: false, errors };
    }

    if (jsonConfig?.schema === 'wallet_address_map') {
      validateWalletAddressMap(parsed, jsonConfig, errors);
    } else if (!isRecord(parsed)) {
      errors.push('JSON root must be an object');
    }
  } catch (error) {
    errors.push(`Failed to parse JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
