import type { Wallet } from './controller';
export type Connection = {
  address?: string | undefined;
  chainId?: number | undefined;
  connectorId?: string | undefined;
  connected: boolean;
};
/** Recheck the live connector before every request, including after async preparation. */
export function guardDepositWallet(
  provider: Wallet,
  expected: Connection,
  current: () => Connection,
): Wallet {
  return {
    request: async (args) => {
      const live = current();
      if (
        !live.connected ||
        !live.address ||
        live.address.toLowerCase() !== expected.address?.toLowerCase() ||
        live.connectorId !== expected.connectorId
      )
        throw new Error(
          'Deposit wallet changed or disconnected. Reconnect and prepare a new deposit.',
        );
      if (live.chainId !== expected.chainId)
        throw new Error('Wallet network changed. Switch to the Himitsu network.');
      return provider.request(args);
    },
  };
}
