/**
 * Public SEAL/CKKS parameters served by the URL in `scores_encr['seal-metadata']`.
 * Contains no key material — only what homomorphic evaluation needs.
 */
export interface SealMetadata {
  /** Metadata key ID; echo it verbatim as `keyId` when posting `custom_score_encr`. */
  id: string;
  /** Only `ckks` is supported; any other scheme is rejected at parse time. */
  schemeType: 'ckks';
  securityLevel: number;
  polyModulusDegree: number;
  coeffModulusBitSizes: number[];
  /** CKKS scale, e.g. `2 ** 40`. */
  scale: number;
  /** Serialized SEAL `EncryptionParameters`, sufficient to build an evaluation context. */
  encryptionParameters: string;
}
