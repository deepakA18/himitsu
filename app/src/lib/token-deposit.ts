import { decodeFunctionResult, encodeFunctionData, parseAbi, type Hex } from 'viem';
import type { RpcClient } from '../../../packages/client/src/index';
import type { Wallet } from './controller';
export const tokenDepositAbi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function decimals() view returns (uint8)',
]);
export async function prepareTokenDeposit(
  rpc: RpcClient, wallet: Wallet, account: Hex, token: Hex, pool: Hex, amount: bigint,
  onApproval: (hash: Hex) => Promise<void>, onProgress: (message: string) => void,
) {
  const read = async (name: string, args: unknown[] = []) => decodeFunctionResult({
    abi: tokenDepositAbi, functionName: name,
    data: await rpc.request<Hex>('eth_call', [{ to: token, data: encodeFunctionData({ abi: tokenDepositAbi, functionName: name, args } as never) }, 'latest']),
  } as never);
  if (Number(await read('decimals')) !== 18) throw new Error('This hUSD deployment must use 18 decimals');
  if (BigInt(await read('balanceOf', [account]) as bigint) < amount) throw new Error('Insufficient hUSD balance');
  const allowance = BigInt(await read('allowance', [account, pool]) as bigint);
  if (allowance !== amount) {
    onProgress('Approve the exact hUSD deposit amount in your wallet…');
    const hash = await wallet.request({ method: 'eth_sendTransaction', params: [{
      from: account, to: token, value: '0x0',
      data: encodeFunctionData({ abi: tokenDepositAbi, functionName: 'approve', args: [pool, amount] }),
    }] }) as Hex;
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('Invalid approval transaction hash');
    await onApproval(hash);
    onProgress('Waiting for hUSD approval confirmation…');
    let confirmed = false;
    for (let i = 0; i < 60; i++) {
      const receipt = await rpc.request<{ status: Hex; blockHash: Hex; blockNumber: Hex } | null>('eth_getTransactionReceipt', [hash]);
      if (receipt) {
        const block = await rpc.request<{ hash: Hex } | null>('eth_getBlockByNumber', [receipt.blockNumber, false]);
        const head = await rpc.request<Hex>('eth_blockNumber');
        if (block?.hash === receipt.blockHash && BigInt(head) >= BigInt(receipt.blockNumber) + 2n) {
          if (BigInt(receipt.status) !== 1n) throw new Error('hUSD approval reverted');
          confirmed = true;
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!confirmed) throw new Error('Approval is not confirmed yet. No deposit was sent. Check your wallet before trying again');
  }
  if (BigInt(await read('allowance', [account, pool]) as bigint) !== amount)
    throw new Error('Pool allowance changed; no deposit was sent');
  if (BigInt(await read('balanceOf', [account]) as bigint) < amount)
    throw new Error('hUSD balance changed; no deposit was sent');
}
