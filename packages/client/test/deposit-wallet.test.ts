import { expect, test } from 'bun:test';
import { guardDepositWallet, type Connection } from '../../../app/src/lib/deposit-wallet';
test('deposit wallet refuses stale account, chain, connector and disconnect before forwarding', async () => {
  const initial: Connection = {
    address: '0x1234',
    chainId: 9,
    connectorId: 'wallet-a',
    connected: true,
  };
  let live = { ...initial },
    calls = 0;
  const wallet = guardDepositWallet(
    {
      request: async () => {
        calls++;
        return 'ok';
      },
    },
    initial,
    () => live,
  );
  expect(await wallet.request({ method: 'eth_accounts' })).toBe('ok');
  for (const change of [
    { address: '0x5678' },
    { chainId: 1 },
    { connectorId: 'wallet-b' },
    { connected: false },
  ]) {
    live = { ...initial, ...change };
    await expect(wallet.request({ method: 'eth_sendTransaction' })).rejects.toThrow();
  }
  expect(calls).toBe(1);
});
