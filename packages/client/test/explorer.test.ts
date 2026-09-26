import { expect, test } from 'bun:test';
import {
  decodeLog,
  frameLabel,
  frameStatus,
  parseSearch,
  type Frame,
} from '../../../app/src/lib/explorer';
import type { Deployment } from '../src/chain';
import { encodeAbiParameters, encodeEventTopics, parseAbi, type Hex } from 'viem';
const pool = `0x${'11'.repeat(20)}` as Hex;
const token = `0x${'22'.repeat(20)}` as Hex;
const d = {
  pool,
  outputPool: `0x${'33'.repeat(20)}`,
  sponsor: `0x${'44'.repeat(20)}`,
  token,
  weth: `0x${'55'.repeat(20)}`,
  noteVersion: 2,
} as Deployment;
test('search accepts only transaction hashes and bounded decimal block numbers', () => {
  expect(parseSearch(' 00012 ')).toEqual({ block: '12' });
  expect(parseSearch(`0x${'aa'.repeat(32)}`)).toEqual({ tx: `0x${'aa'.repeat(32)}` });
  for (const input of ['-1', '0x12', '1.2', 'https://node', '9'.repeat(21)])
    expect(() => parseSearch(input)).toThrow();
});
test('missing and skipped frame receipts are never shown as success', () => {
  expect(frameStatus()).toBe('Not reported');
  expect(frameStatus('0x0')).toBe('Reverted');
  expect(frameStatus('0x1')).toBe('Success');
  expect(frameStatus('0x2')).toBe('Skipped');
});
test('frame labels resolve null targets from sender and do not assume arbitrary frames are Himitsu', () => {
  const frame: Frame = {
    mode: '0x1',
    to: null,
    data: '0x',
    flags: '0x2',
    gasLimit: '0x7a120',
    stateGasLimit: '0x0',
    value: '0x0',
  };
  expect(frameLabel(frame, d, pool)).toBe('Verify note & authorize spend');
  expect(frameLabel(frame, d, token)).toBe('Contract execution');
  expect(frameLabel({ ...frame, mode: '0x2', data: '0x45615bcc' }, d, pool)).toBe('Withdraw');
});
test('decodes zero allowance accurately and does not assign symbols to unknown tokens', () => {
  const abi = parseAbi([
    'event Approval(address indexed owner,address indexed spender,uint256 value)',
  ]);
  const log = {
    address: token,
    topics: encodeEventTopics({
      abi,
      eventName: 'Approval',
      args: { owner: pool, spender: d.outputPool },
    }) as Hex[],
    data: encodeAbiParameters([{ type: 'uint256' }], [0n]),
  };
  expect(decodeLog(log, d)?.fields).toContainEqual(['Allowance', '0 gUSD']);
  expect(decodeLog({ ...log, address: `0x${'66'.repeat(20)}` }, d)).toBeNull();
});
