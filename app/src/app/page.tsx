'use client';
import { useEffect, useState, useRef } from 'react';
import type { Hex } from 'viem';
import { Controller, Vault, IndexedVaultStore } from '../lib/controller';
import type { Deployment } from '../../../packages/client/src/chain';
const short = (s: string) => s.slice(0, 10) + '…' + s.slice(-6);
export default function Page() {
  const [config, setConfig] = useState<Deployment | null>(null),
    [controller, setController] = useState<Controller | null>(null),
    [password, setPassword] = useState(''),
    [showPassword, setShowPassword] = useState(false),
    [account, setAccount] = useState<Hex | null>(null),
    [recipient, setRecipient] = useState(''),
    [selected, setSelected] = useState(''),
    [busy, setBusy] = useState(''),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [, render] = useState(0);
  const working = useRef(false);
  const walletRef = useRef<import('../lib/controller').Wallet | null>(null);
  useEffect(() => {
    fetch('/deployment.json', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok)
          throw new Error('Deployment missing. Run bun run deploy:app against the local node.');
        setConfig(await r.json());
      })
      .catch((e) => setError(e.message));
  }, []);
  async function run(label: string, fn: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(label);
    setError('');
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      working.current = false;
      setBusy('');
      render((x) => x + 1);
    }
  }
  async function unlock(backup?: string) {
    if (!config) throw new Error('Load a deployment first');
    const store = new IndexedVaultStore();
    const vault = backup
      ? await Vault.restore(store, password, backup)
      : await Vault.open(store, password);
    const c = new Controller(config, vault);
    setController(c);
    setPassword('');
    await navigator.storage?.persist?.();
    await c.refresh();
    setMessage('Vault unlocked and synchronized. Export a backup after creating notes.');
  }
  async function refresh() {
    if (!controller) return;
    await controller.refresh();
    setMessage('Reconciled against canonical chain events and receipts.');
  }
  async function connect() {
    if (!window.ethereum)
      throw new Error('Install an Ethereum wallet and add the local RPC shown below.');
    const accounts = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as Hex[];
    if (!accounts[0]) throw new Error('No wallet account selected');
    if (
      BigInt((await window.ethereum.request({ method: 'eth_chainId' })) as string) !==
      BigInt(config!.chainId)
    )
      throw new Error('Switch wallet to chain 9 using the RPC below, then reconnect');
    walletRef.current = window.ethereum;
    setAccount(accounts[0]);
    setRecipient(accounts[0]);
    setMessage('Deposit wallet connected. Private spends do not need wallet signatures.');
  }
  const notes = controller?.vault.data.notes ?? [],
    attempts = controller?.vault.data.attempts ?? [];
  const available = notes.filter((n) => controller?.noteState(n) === 'Available');
  const chosen = available.find((n) => n.id === selected);
  async function spend(kind: 'swap' | 'withdraw') {
    if (!controller || !chosen) throw new Error('Choose an available note');
    const result = await controller.spend(chosen.id, kind, recipient, setBusy);
    setMessage(
      result.state === 'submitted'
        ? `Transaction submitted: ${result.hash}. Refresh after a few blocks.`
        : 'Submission uncertain. Keep this vault and refresh before retrying.',
    );
    setSelected('');
  }
  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">LOCAL DEVNET · TEST ASSETS</p>
          <h1>Himitsu</h1>
          <p className="muted">Deposit, swap a private note, and recover your transaction state.</p>
        </div>
        <span className="badge">Test interface</span>
      </header>
      <div role="status" aria-live="polite" className="status">
        {busy || message || 'Connect to the local devnet to begin.'}
      </div>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      <section>
        <h2>1. Note vault</h2>
        <p className="muted">
          Notes and transaction history are encrypted in this browser. Keep an encrypted backup and
          its password; clearing browser data without a backup loses your notes.
        </p>
        {!controller ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run('Unlocking vault…', () => unlock());
            }}
          >
            <label htmlFor="password">Vault password</label>
            <div className="row">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                minLength={12}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={!!busy}
                aria-describedby="password-hint"
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <p id="password-hint" className="hint">
              Use at least 12 characters for a new vault. This password never leaves your browser.
            </p>
            <div className="row">
              <button disabled={!!busy || !config} type="submit">
                Create / unlock vault
              </button>
              <label className="file">
                Restore encrypted backup
                <input
                  aria-label="Restore encrypted backup"
                  type="file"
                  accept="application/json,.json"
                  disabled={!!busy || !password || !config}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f)
                      void run('Restoring backup…', async () => {
                        if (f.size > 5_000_000) throw new Error('Backup is too large');
                        await unlock(await f.text());
                      });
                  }}
                />
              </label>
            </div>
            <p className="hint">
              Restore is available only when this browser has no existing vault; it never overwrites
              notes.
            </p>
          </form>
        ) : (
          <div className="row">
            <span>Vault unlocked · {notes.length} saved notes</span>
            <button
              disabled={!!busy}
              onClick={() =>
                void run('Exporting encrypted backup…', async () => {
                  const blob = new Blob([await controller.vault.backup()], {
                    type: 'application/json',
                  });
                  const url = URL.createObjectURL(blob),
                    a = document.createElement('a');
                  a.href = url;
                  a.download = 'himitsu-vault.json';
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                  setMessage(
                    'Encrypted backup downloaded. Store it with your vault password separately.',
                  );
                })
              }
            >
              Export backup
            </button>
            <button
              className="secondary"
              disabled={!!busy}
              onClick={() => {
                setController(null);
                setSelected('');
                setAccount(null);
                walletRef.current = null;
                setMessage('Vault locked.');
              }}
            >
              Lock
            </button>
          </div>
        )}
      </section>
      <div className="columns">
        <section>
          <h2>2. Deposit</h2>
          <p>
            Each deposit creates one <strong>0.1 WETH</strong> note.
          </p>
          <p className="hint">
            Your wallet pays deposit gas. The prefunded paymaster pays private swaps and
            withdrawals.
          </p>
          <div className="row">
            <button
              className="secondary"
              disabled={!config || !!busy}
              onClick={() => void run('Connecting wallet…', connect)}
            >
              {account ? short(account) : 'Connect deposit wallet'}
            </button>
            <button
              disabled={!controller || !account || !!busy}
              onClick={() =>
                void run('Save note, then approve deposit in your wallet…', async () => {
                  const a = await controller!.deposit(walletRef.current!, account!);
                  setMessage(
                    a.hash
                      ? `Deposit submitted: ${a.hash}. Refresh after a few blocks.`
                      : 'Wallet outcome uncertain. Your note is saved; refresh to reconcile.',
                  );
                })
              }
            >
              Deposit 0.1 ETH
            </button>
            <button
              className="secondary"
              disabled={!controller || !!busy}
              onClick={() =>
                void run('Opening encrypted local test wallet…', async () => {
                  const local = await controller!.localTestWallet();
                  walletRef.current = local.wallet;
                  setAccount(local.account);
                  setRecipient(local.account);
                  setMessage(
                    'Local test wallet ready. Fund this address with devnet ETH before depositing.',
                  );
                })
              }
            >
              Use local test wallet
            </button>
          </div>
          {account && (
            <>
              <label htmlFor="deposit-address">Deposit wallet address</label>
              <input id="deposit-address" readOnly value={account} />
              <p className="hint">
                For the local test wallet, send devnet ETH to this address using your existing
                funded account. Its key is saved inside the encrypted vault.
              </p>
            </>
          )}
        </section>
        <section>
          <h2>3. Spend a note</h2>
          <label htmlFor="note">Available note</label>
          <select
            id="note"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={!controller || !!busy}
          >
            <option value="">Choose a note</option>
            {available.map((n) => (
              <option key={n.id} value={n.id}>
                {n.pool.toLowerCase() === config?.pool.toLowerCase() ? '0.1 WETH' : '150 gUSD'} ·{' '}
                {short(n.commitment)}
              </option>
            ))}
          </select>
          <label htmlFor="recipient">Withdrawal recipient</label>
          <input
            id="recipient"
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            disabled={!!busy}
          />
          <div className="row">
            <button
              disabled={
                !!busy || !chosen || chosen.pool.toLowerCase() !== config?.pool.toLowerCase()
              }
              onClick={() => void run('Preparing private swap…', () => spend('swap'))}
            >
              Swap to 150 gUSD note
            </button>
            <button
              className="secondary"
              disabled={!!busy || !chosen}
              onClick={() => void run('Preparing withdrawal…', () => spend('withdraw'))}
            >
              Withdraw note
            </button>
          </div>
          <p className="hint">
            Fixed test quote: 0.1 WETH → 150 gUSD. Proof generation happens locally. Outputs remain
            private notes until withdrawal.
          </p>
        </section>
      </div>
      <section>
        <div className="row between">
          <h2>Notes & recovery</h2>
          <button
            disabled={!controller || !!busy}
            onClick={() => void run('Synchronizing canonical chain…', refresh)}
          >
            Refresh / reconcile
          </button>
        </div>
        {notes.length === 0 ? (
          <p className="muted">No notes yet. Unlock your vault, then make a deposit.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Note</th>
                  <th>Asset</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {notes.map((n) => (
                  <tr key={n.id}>
                    <td title={n.commitment}>{short(n.commitment)}</td>
                    <td>
                      {n.pool.toLowerCase() === config?.pool.toLowerCase()
                        ? '0.1 WETH'
                        : n.pool.toLowerCase() === config?.outputPool.toLowerCase()
                          ? '150 gUSD'
                          : 'Other deployment'}
                    </td>
                    <td>{controller!.noteState(n)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {attempts.length > 0 && (
          <>
            <h3>Transaction journal</h3>
            <ul className="journal">
              {[...attempts].reverse().map((a) => (
                <li key={a.id}>
                  <strong>
                    {a.kind} · {a.state}
                  </strong>
                  <code>{a.hash ? short(a.hash) : 'No transaction hash yet'}</code>
                  <p className="hint">{a.detail || 'Refresh to check canonical inclusion.'}</p>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="hint">
          Two successor blocks are required before a note becomes available. A missing receipt alone
          never releases a reserved note. If another user consumes the pool nonce or a transaction
          expires, reconcile before explicitly retrying.
        </p>
      </section>
      <footer>
        <h2>Local network</h2>
        {config ? (
          <dl>
            <dt>RPC · chain {config.chainId}</dt>
            <dd>{config.rpcUrl}</dd>
            <dt>WETH pool</dt>
            <dd>{config.pool}</dd>
            <dt>gUSD pool</dt>
            <dd>{config.outputPool}</dd>
            <dt>Paymaster</dt>
            <dd>{config.sponsor}</dd>
          </dl>
        ) : (
          <p>Waiting for deployment configuration.</p>
        )}
        <p className="hint">
          Private authorization does not hide deposits, withdrawals, swap amounts, or RPC metadata.
          Development ceremony and test tokens only.
        </p>
      </footer>
    </main>
  );
}
