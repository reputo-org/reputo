import { describe, expect, it } from 'vitest';
import { ENCRYPTION_VERSION } from '../../../src/shared/constants';
import { decryptValue, encryptValue } from '../../../src/shared/utils';

const SECRET = '0123456789abcdef0123456789abcdef';
const DIFFERENT_SECRET = 'abcdef0123456789abcdef0123456789';

describe('auth.crypto', () => {
  describe('encryptValue / decryptValue roundtrip', () => {
    it('encrypts and decrypts a plaintext value correctly', () => {
      const plaintext = 'provider-access-token';

      const encrypted = encryptValue(SECRET, plaintext);
      const decrypted = decryptValue(SECRET, encrypted);

      expect(decrypted).toBe(plaintext);
      expect(encrypted).not.toBe(plaintext);
    });

    it('handles short strings', () => {
      const encrypted = encryptValue(SECRET, 'a');
      const decrypted = decryptValue(SECRET, encrypted);

      expect(decrypted).toBe('a');
    });

    it('handles unicode content', () => {
      const plaintext = '日本語テスト 🔑';

      const encrypted = encryptValue(SECRET, plaintext);
      const decrypted = decryptValue(SECRET, encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it('produces different ciphertexts for the same plaintext (random IV)', () => {
      const plaintext = 'same-token';

      const encrypted1 = encryptValue(SECRET, plaintext);
      const encrypted2 = encryptValue(SECRET, plaintext);

      expect(encrypted1).not.toBe(encrypted2);
      expect(decryptValue(SECRET, encrypted1)).toBe(plaintext);
      expect(decryptValue(SECRET, encrypted2)).toBe(plaintext);
    });
  });

  describe('encrypted value format', () => {
    it('produces the enc:v1:<iv>:<tag>:<ciphertext> format', () => {
      const encrypted = encryptValue(SECRET, 'test');
      const parts = encrypted.split(':');

      expect(parts).toHaveLength(5);
      expect(`${parts[0]}:${parts[1]}`).toBe(ENCRYPTION_VERSION);
      expect(parts[2]).toBeTruthy(); // IV
      expect(parts[3]).toBeTruthy(); // auth tag
      expect(parts[4]).toBeTruthy(); // ciphertext
    });

    it('uses base64url-safe characters in all segments', () => {
      const encrypted = encryptValue(SECRET, 'some-long-provider-token-value');
      const parts = encrypted.split(':');

      for (const part of parts.slice(2)) {
        expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
      }
    });
  });

  describe('wrong key', () => {
    it('fails to decrypt with a different secret', () => {
      const encrypted = encryptValue(SECRET, 'sensitive-token');

      expect(() => decryptValue(DIFFERENT_SECRET, encrypted)).toThrow();
    });
  });

  describe('tampered ciphertext', () => {
    it('rejects a ciphertext with a modified auth tag', () => {
      const encrypted = encryptValue(SECRET, 'token');
      const parts = encrypted.split(':');
      parts[3] = 'AAAAAAAAAAAAAAAAAAAAAA'; // tampered auth tag
      const tampered = parts.join(':');

      expect(() => decryptValue(SECRET, tampered)).toThrow();
    });

    it('rejects a ciphertext with a modified IV', () => {
      const encrypted = encryptValue(SECRET, 'token');
      const parts = encrypted.split(':');
      parts[2] = 'BBBBBBBBBBBBBBBB'; // tampered IV
      const tampered = parts.join(':');

      expect(() => decryptValue(SECRET, tampered)).toThrow();
    });

    it('rejects a ciphertext with modified payload', () => {
      const encrypted = encryptValue(SECRET, 'token');
      const parts = encrypted.split(':');
      parts[4] = 'CCCCCCCC'; // tampered ciphertext
      const tampered = parts.join(':');

      expect(() => decryptValue(SECRET, tampered)).toThrow();
    });
  });

  describe('invalid format', () => {
    it('rejects a value with the wrong version prefix', () => {
      expect(() => decryptValue(SECRET, 'enc:v2:aaa:bbb:ccc')).toThrow('Invalid encrypted value format.');
    });

    it('rejects a value with missing segments', () => {
      expect(() => decryptValue(SECRET, 'enc:v1:onlytwo')).toThrow('Invalid encrypted value format.');
    });

    it('rejects a completely invalid string', () => {
      expect(() => decryptValue(SECRET, 'not-encrypted')).toThrow('Invalid encrypted value format.');
    });
  });
});
