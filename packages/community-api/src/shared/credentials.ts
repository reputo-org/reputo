import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Sealed-credential envelope: `ccv1:{key_id}:{iv}:{tag}:{ciphertext}`, every
 * segment base64url. AES-256-GCM with the AAD bound to the owning connection,
 * so a ciphertext copied onto another row fails to open. The key id names the
 * sealing key, letting decryption pick between the current and previous key
 * during rotation without trial decryption.
 */
const ENVELOPE_VERSION = 'ccv1';
const ENVELOPE_SEGMENTS = 5;
const IV_LENGTH = 12;
const KEY_ID_LENGTH = 8;
const MIN_SECRET_LENGTH = 32;

/**
 * Sealing secrets, injected by the consuming app. The current secret seals;
 * the previous one only opens, so the key rotates without reconnecting
 * servers.
 */
export interface CommunityCredentialKeyring {
  currentSecret: string;
  previousSecret?: string;
}

/** The connection a credential belongs to; sealing binds the ciphertext to it. */
export interface CommunityCredentialBinding {
  platform: string;
  externalId: string;
}

/** Messages never carry key material, plaintext, or ciphertext. */
export class CommunityCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommunityCredentialError';
  }
}

interface DerivedKey {
  key: Buffer;
  keyId: string;
}

function deriveKey(secret: string): DerivedKey {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new CommunityCredentialError(
      `Credential encryption secrets must be at least ${MIN_SECRET_LENGTH} characters.`,
    );
  }
  const key = createHash('sha256').update(secret, 'utf8').digest();
  const keyId = createHash('sha256').update(key).digest('base64url').slice(0, KEY_ID_LENGTH);
  return { key, keyId };
}

function additionalData(binding: CommunityCredentialBinding): Buffer {
  return Buffer.from(`${binding.platform}:${binding.externalId}`, 'utf8');
}

export function sealCommunityCredential(
  keyring: CommunityCredentialKeyring,
  binding: CommunityCredentialBinding,
  plaintext: string,
): string {
  const { key, keyId } = deriveKey(keyring.currentSecret);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(additionalData(binding));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return [
    ENVELOPE_VERSION,
    keyId,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

export function openCommunityCredential(
  keyring: CommunityCredentialKeyring,
  binding: CommunityCredentialBinding,
  envelope: string,
): string {
  const segments = envelope.split(':');
  if (segments.length !== ENVELOPE_SEGMENTS || segments[0] !== ENVELOPE_VERSION) {
    throw new CommunityCredentialError(`The sealed credential is not a ${ENVELOPE_VERSION} envelope.`);
  }
  const [, keyId, iv, tag, ciphertext] = segments;

  const keys = [deriveKey(keyring.currentSecret)];
  if (keyring.previousSecret !== undefined) keys.push(deriveKey(keyring.previousSecret));
  const match = keys.find((candidate) => candidate.keyId === keyId);
  if (!match) {
    throw new CommunityCredentialError('The sealed credential names a key this deployment does not hold.');
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', match.key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(additionalData(binding));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new CommunityCredentialError(
      'The sealed credential failed authentication — it was tampered with or belongs to another connection.',
    );
  }
}
