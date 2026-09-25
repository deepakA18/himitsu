import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createWalletClient, createPublicClient, http, defineChain, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
// This is the public local-devnet fixture, never a production key.
import { FUNDER_KEY } from '../packages/protocol/ghost.mjs';
const d = JSON.parse(readFileSync('app/public/deployment.json', 'utf8'));
const chain = defineChain({
  id: 9,
  name: 'Ethrex local',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [d.rpcUrl] } },
});
const password = 'himitsu browser test vault 2026';
async function unlock(page: Page) {
  await page.getByLabel('Vault password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create / unlock vault' }).click();
  await expect(page.getByRole('button', { name: 'Export backup' })).toBeEnabled({ timeout: 20000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
}
async function reconcile(page: Page) {
  await page.getByRole('button', { name: 'Refresh / reconcile' }).click();
  await expect(page.getByRole('status')).toContainText('Reconciled', { timeout: 20000 });
}
async function waitAvailable(page: Page, count: number) {
  await expect
    .poll(
      async () => {
        await reconcile(page);
        return page.locator('tbody tr').filter({ hasText: 'Available' }).count();
      },
      { timeout: 30000, intervals: [1000, 2000] },
    )
    .toBe(count);
}
test('browser deposit, durable reload, local proof swap, backup and withdrawal', async ({
  page,
  context,
}) => {
  const account = privateKeyToAccount(generatePrivateKey()),
    wallet = createWalletClient({ account, chain, transport: http(d.rpcUrl) });
  execFileSync(
    'cast',
    [
      'send',
      '--rpc-url',
      d.rpcUrl,
      '--private-key',
      FUNDER_KEY,
      '--value',
      '1ether',
      account.address,
    ],
    { stdio: 'pipe' },
  );
  await page.exposeBinding(
    'walletRequest',
    async (_source, args: { method: string; params?: any[] }) => {
      if (['eth_requestAccounts', 'eth_accounts'].includes(args.method)) return [account.address];
      if (args.method === 'eth_chainId') return '0x9';
      if (args.method === 'eth_sendTransaction') {
        const tx = args.params![0];
        return wallet.sendTransaction({ to: tx.to, data: tx.data, value: BigInt(tx.value) });
      }
      throw new Error('Unexpected wallet request');
    },
  );
  await page.addInitScript(() => {
    (window as any).ethereum = { request: (args: unknown) => (window as any).walletRequest(args) };
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await unlock(page);
  await page.getByRole('button', { name: 'Connect deposit wallet' }).click();
  await expect(page.getByRole('status')).toContainText('wallet connected');
  await page.getByRole('button', { name: 'Deposit 0.1 ETH' }).click();
  await expect(page.getByRole('status')).toContainText('Deposit submitted', { timeout: 20000 });
  await waitAvailable(page, 1);
  await page.reload();
  await expect(page.getByLabel('Vault password', { exact: true })).toBeVisible();
  await unlock(page);
  await waitAvailable(page, 1);
  await page.getByLabel('Available note').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Swap to 150 gUSD note' }).click();
  await expect(page.getByRole('status')).toContainText('Transaction submitted', {
    timeout: 120000,
  });
  await waitAvailable(page, 1);
  await expect(page.locator('tbody tr').filter({ hasText: '150 gUSD' })).toContainText('Available');
  await expect(page.locator('tbody tr').filter({ hasText: '0.1 WETH' })).toContainText('Spent');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup' }).click();
  const backup = await download;
  const path = await backup.path();
  expect(path).toBeTruthy();
  const encrypted = JSON.parse(readFileSync(path!, 'utf8'));
  expect(encrypted.format).toBe('himitsu-vault');
  expect(encrypted.secret).toBeUndefined();
  const second = await context.newPage();
  await second.goto('/');
  await unlock(second);
  await expect(second.locator('tbody tr')).toHaveCount(2);
  await second.close();
  await page.getByLabel('Available note').selectOption({ index: 1 });
  await page.getByLabel('Withdrawal recipient').fill(account.address);
  await page.getByRole('button', { name: 'Withdraw note', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Transaction submitted', {
    timeout: 120000,
  });
  await waitAvailable(page, 0);
  await expect(page.locator('tbody tr').filter({ hasText: 'Spent' })).toHaveCount(2);
  const client = createPublicClient({ chain, transport: http(d.rpcUrl) });
  const balance = await client.readContract({
    address: d.token,
    abi: [
      {
        name: 'balanceOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'owner', type: 'address' }],
        outputs: [{ type: 'uint256' }],
      },
    ],
    functionName: 'balanceOf',
    args: [account.address],
  });
  expect(balance).toBe(BigInt(d.outputDenomination));
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await page.screenshot({ path: '.local/app-tested.png', fullPage: true });
  expect(errors).toEqual([]);
});
