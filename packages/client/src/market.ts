import { decodeFunctionResult, encodeFunctionData, parseAbi, type Hex } from 'viem';
import { RpcClient } from './index';
import { verifyConfig, type Block, type Deployment } from './chain';
const abi = parseAbi([
  'function getReserves() view returns (uint112,uint112,uint32)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function token() view returns (address)',
  'function denomination() view returns (uint256)',
  'function nextIndex() view returns (uint32)',
  'function accounted() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
]);
export async function readMarket(
  rpc: RpcClient,
  to: Hex,
  name: string,
  args: unknown[] = [],
  block: Hex | 'latest' = 'latest',
): Promise<any> {
  const data = encodeFunctionData({ abi, functionName: name, args } as never);
  return decodeFunctionResult({
    abi,
    functionName: name,
    data: await rpc.request<Hex>('eth_call', [{ to, data }, block]),
  } as never);
}
export function amountOut(input: bigint, reserveIn: bigint, reserveOut: bigint) {
  if (input <= 0n || reserveIn <= 0n || reserveOut <= 0n)
    throw new Error('Swap liquidity is unavailable');
  return (input * 997n * reserveOut) / (reserveIn * 1000n + input * 997n);
}
export function minimumOutput(quote: bigint, slippageBps: number) {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 500)
    throw new Error('Choose slippage between 0% and 5%');
  return (quote * BigInt(10000 - slippageBps)) / 10000n;
}
export const executionBudget = (swap: boolean) => (swap ? 900000n : 200000n);
export const stateBudget = (swap: boolean) => (swap ? 1500000n : 300000n);
export function fundingRequired(baseFee: bigint, swap: boolean) {
  const fee = baseFee * 2n + 1000000000n;
  if (fee > 10000000000n) throw new Error('Network fee exceeds the paymaster limit');
  // Conservative allowance for intrinsic calldata/transaction overhead in addition to all frame budgets.
  const maximum = (555000n + executionBudget(swap) + stateBudget(swap) + 100000n) * fee;
  if (maximum > 20000000000000000n)
    throw new Error('Transaction budget exceeds the paymaster limit');
  return { fee, maximum };
}
export interface Readiness {
  sourcePool?: Hex;
  inputAmount?: string;
  checkedAt: number;
  block: string;
  sponsorBalance: string;
  swapFunding: string;
  quote: string;
  reserveIn: string;
  reserveOut: string;
  depositIssues: string[];
  swapIssues: string[];
  withdrawalIssues: string[];
}
export async function readiness(
  rpc: RpcClient,
  d: Deployment,
  sourcePool: Hex = d.pool,
  inputAmount = d.defaultDepositAmount ?? d.denomination,
): Promise<Readiness> {
  const reverse = sourcePool.toLowerCase() === d.outputPool.toLowerCase();
  if (!reverse && sourcePool.toLowerCase() !== d.pool.toLowerCase())
    throw new Error('Unknown swap source pool');
  await verifyConfig(rpc, d);
  const head = await rpc.request<Block>('eth_getBlockByNumber', ['latest', false]);
  if (Math.abs(Date.now() / 1000 - Number(BigInt(head.timestamp))) > 120)
    throw new Error(
      'Network is not producing recent blocks. Check the network clock and connection.',
    );
  const tag = head.number;
  const [
    reserves,
    token0,
    token1,
    balance,
    inputIndex,
    outputIndex,
    inputToken,
    outputToken,
    inputDenom,
    outputDenom,
    inputAccounted,
    outputAccounted,
    inputBalance,
    outputBalance,
  ] = await Promise.all([
    readMarket(rpc, d.pair, 'getReserves', [], tag),
    readMarket(rpc, d.pair, 'token0', [], tag),
    readMarket(rpc, d.pair, 'token1', [], tag),
    rpc.request<Hex>('eth_getBalance', [d.sponsor, tag]),
    readMarket(rpc, d.pool, 'nextIndex', [], tag),
    readMarket(rpc, d.outputPool, 'nextIndex', [], tag),
    readMarket(rpc, d.pool, 'token', [], tag),
    readMarket(rpc, d.outputPool, 'token', [], tag),
    readMarket(rpc, d.pool, 'denomination', [], tag),
    readMarket(rpc, d.outputPool, 'denomination', [], tag),
    readMarket(rpc, d.pool, 'accounted', [], tag),
    readMarket(rpc, d.outputPool, 'accounted', [], tag),
    readMarket(rpc, d.weth, 'balanceOf', [d.pool], tag),
    readMarket(rpc, d.token, 'balanceOf', [d.outputPool], tag),
  ]);
  if (
    inputToken.toLowerCase() !== d.weth.toLowerCase() ||
    outputToken.toLowerCase() !== d.token.toLowerCase() ||
    inputDenom !== BigInt(d.denomination) ||
    outputDenom !== BigInt(d.outputDenomination)
  )
    throw new Error('Pool configuration does not match the deployment');
  if (
    token0.toLowerCase() !== (d.wethIsToken0 ? d.weth : d.token).toLowerCase() ||
    token1.toLowerCase() !== (d.wethIsToken0 ? d.token : d.weth).toLowerCase()
  )
    throw new Error('Liquidity pair tokens do not match the deployment');
  if (inputBalance < inputAccounted || outputBalance < outputAccounted)
    throw new Error('Pool backing is below outstanding note value');
  const reserveIn: bigint = reserves[d.wethIsToken0 !== reverse ? 0 : 1],
    reserveOut: bigint = reserves[d.wethIsToken0 !== reverse ? 1 : 0];
  const depositIssues: string[] = [],
    swapIssues: string[] = [],
    withdrawalIssues: string[] = [];
  let quote = 0n,
    swapFunding = 0n;
  if (d.mode === 'fixed')
    swapIssues.push(
      'Fixed notes support deposits and withdrawals only. Select the bidirectional deployment to swap.',
    );
  if (inputIndex >= 1024) depositIssues.push('WETH note pool is full');
  if ((reverse ? inputIndex : outputIndex) >= 1024) swapIssues.push('Output note pool is full');
  if (reverse && (d.noteVersion !== 2 || BigInt(d.denomination) !== 0n))
    swapIssues.push('Select the bidirectional deployment to swap hUSD to WETH');
  try {
    quote = amountOut(BigInt(inputAmount), reserveIn, reserveOut);
  } catch (e) {
    swapIssues.push((e as Error).message);
  }
  if (quote <= 0n || quote < BigInt(reverse ? d.denomination : d.outputDenomination))
    swapIssues.push('Liquidity cannot cover the output note');
  for (const swap of [true, false]) {
    const issues = swap ? swapIssues : withdrawalIssues;
    try {
      const required = fundingRequired(BigInt(head.baseFeePerGas), swap).maximum;
      if (swap) swapFunding = required;
      if (BigInt(balance) < required) issues.push('Paymaster needs more ETH');
    } catch (e) {
      issues.push((e as Error).message);
    }
  }
  const checked = await rpc.request<Block>('eth_getBlockByNumber', [tag, false]);
  if (checked.hash !== head.hash) throw new Error('Chain changed during readiness checks; retry');
  return {
    sourcePool,
    inputAmount,
    checkedAt: Date.now(),
    block: BigInt(tag).toString(),
    sponsorBalance: BigInt(balance).toString(),
    swapFunding: swapFunding.toString(),
    quote: quote.toString(),
    reserveIn: reserveIn.toString(),
    reserveOut: reserveOut.toString(),
    depositIssues,
    swapIssues,
    withdrawalIssues,
  };
}
