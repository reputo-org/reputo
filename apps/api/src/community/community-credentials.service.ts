import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CommunityAuthError,
  type CommunityCredentialBinding,
  CommunityCredentialError,
  type CommunityCredentialKeyring,
  openCommunityCredential,
  sealCommunityCredential,
} from '@reputo/community-api';

/**
 * Seals and opens platform credentials with the deployment keyring. Plaintext
 * exists only inside the call that needs it — nothing here logs, stores, or
 * returns it any other way.
 */
@Injectable()
export class CommunityCredentialsService {
  private readonly keyring: CommunityCredentialKeyring;

  constructor(configService: ConfigService) {
    this.keyring = configService.get<CommunityCredentialKeyring>('community.credentials') as CommunityCredentialKeyring;
  }

  seal(binding: CommunityCredentialBinding, plaintext: string): string {
    return sealCommunityCredential(this.keyring, binding, plaintext);
  }

  /**
   * A credential that no longer opens — rotated-away key, tampering, a copied
   * ciphertext — needs the admin to reconnect, which is what an auth failure
   * already means to the connection lifecycle.
   */
  open(binding: CommunityCredentialBinding, envelope: string): string {
    try {
      return openCommunityCredential(this.keyring, binding, envelope);
    } catch (error) {
      if (error instanceof CommunityCredentialError) {
        throw new CommunityAuthError('The sealed credential cannot be opened. Reconnect the community.', 401);
      }
      throw error;
    }
  }
}
