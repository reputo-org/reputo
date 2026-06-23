import type { WalletLotsState } from '../types.js';

export {
  buildWalletDidsIndex,
  getDids,
  getWalletsForChain,
  getWalletsForSelectedResources,
  loadDidInputMap as loadWalletAddressMap,
} from '../../shared/did-input.js';

export function initializeWalletLots(wallets: string[]): WalletLotsState {
  return new Map(wallets.map((wallet) => [wallet, []]));
}
