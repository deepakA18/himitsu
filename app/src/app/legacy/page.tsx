'use client';
import { useEffect, useState, useRef } from 'react';
import { formatUnits, type Hex } from 'viem';
import { RpcClient } from '../../../../packages/client/src/index';
import { readiness, minimumOutput, type Readiness } from '../../../../packages/client/src/market';
import { SwapPanel } from '../../components/swap-panel';
import { Controller, Vault, IndexedVaultStore } from '../../lib/controller';
import type { Deployment } from '../../../../packages/client/src/chain';
const short = (s: string) => s.slice(0, 10) + '…' + s.slice(-6);
export default function Page() {
  const [config, setConfig] = useState<Deployment | null>(null),
    [deployments, setDeployments] = useState<{ name: string; url: string }[]>([]),
    [deploymentUrl, setDeploymentUrl] = useState('/deployment-v2.json'),
    [slippage, setSlippage] = useState('50'),
    [swapWorking, setSwapWorking] = useState(false),
    [swapAttemptId, setSwapAttemptId] = useState(''),
    [controller, setController] = useState<Controller | null>(null),
    [password, setPassword] = useState(''),
    [showPassword, setShowPassword] = useState(false),
    [mode, setMode] = useState<'create' | 'unlock' | 'restore' | 'backup'>('create'),
    [hasVault, setHasVault] = useState<boolean | null>(null),
    [confirmPassword, setConfirmPassword] = useState(''),
    [health, setHealth] = useState<Readiness | null>(null),
    [monitorError, setMonitorError] = useState(''),
    [monitoring, setMonitoring] = useState(false),
    [phrase, setPhrase] = useState(''),
    [showPhrase, setShowPhrase] = useState(false),
    [account, setAccount] = useState<Hex | null>(null),
    [recipient, setRecipient] = useState(''),
    [selected, setSelected] = useState(''),
    [busy, setBusy] = useState(''),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [, render] = useState(0);
  const restoreMode = mode === 'restore';
  const working = useRef(false);
  const syncing = useRef(false);
  const notified = useRef(new Map<string, string>());
  const money = (value: string) =>
    Number(formatUnits(BigInt(value), 18)).toLocaleString(undefined, { maximumFractionDigits: 6 });
  const walletRef = useRef<import('../../lib/controller').Wallet | null>(null);
  useEffect(() => {
    new IndexedVaultStore()
      .read()
      .then((v) => {
        setHasVault(!!v);
        setMode(v ? 'unlock' : 'create');
      })
      .catch((e) => setError(e.message));
    fetch('/deployments.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then(setDeployments)
      .catch(() => {});
    const savedUrl = localStorage.getItem('himitsu-deployment-url');
    const url =
      savedUrl && /^\/(deployment-v[12]\.json|deployments\/0x[0-9a-f]{40}\.json)$/.test(savedUrl)
        ? savedUrl
        : '/deployment.json';
    setDeploymentUrl(url === '/deployment.json' ? '/deployment-v2.json' : url);
    fetch(url, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok)
          throw new Error('Deployment missing. Run bun run deploy:app against the local node.');
        const d = (await r.json()) as Deployment;
        setConfig(d);
        setDeploymentUrl('/deployments/' + d.pool.toLowerCase() + '.json');
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    async function update() {
      if (working.current || syncing.current || document.hidden) return;
      syncing.current = true;
      setMonitoring(true);
      try {
        let checked: Readiness;
        if (controller) {
          await controller.refresh();
          checked = controller.health!;
        } else checked = await readiness(new RpcClient(config!.rpcUrl), config!);
        if (!cancelled) {
          setHealth(checked);
          setMonitorError('');
          const latest = controller?.vault.data.attempts
            .filter((a) => a.deployment === config!.id)
            .at(-1);
          if (
            latest &&
            Date.now() - latest.createdAt < 600000 &&
            notified.current.get(latest.id) !== latest.state
          ) {
            notified.current.set(latest.id, latest.state);
            setMessage(
              `${latest.kind === 'swap' ? 'Swap' : latest.kind === 'withdraw' ? 'Withdrawal' : 'Deposit'}: ${latest.state}. ${latest.detail ?? 'Watching chain confirmations automatically.'}`,
            );
          }
          render((x) => x + 1);
        }
      } catch (e) {
        if (!cancelled) {
          setHealth(null);
          setMonitorError(
            e instanceof Error ? e.message : 'Cannot reach the devnet. Retrying automatically.',
          );
        }
      } finally {
        syncing.current = false;
        if (!cancelled) setMonitoring(false);
      }
    }
    void update();
    const timer = setInterval(() => void update(), 3000);
    const wake = () => void update();
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [config, controller]);
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
    if (!backup && mode !== 'unlock' && password !== confirmPassword)
      throw new Error('Local passwords do not match');
    const store = new IndexedVaultStore();
    const vault = backup
      ? await Vault.restore(store, password, backup)
      : restoreMode
        ? await Vault.restorePhrase(store, password, phrase)
        : mode === 'create'
          ? await Vault.create(store, password)
          : await Vault.unlock(store, password);
    const c = new Controller(config, vault);
    setController(c);
    setHasVault(true);
    setConfirmPassword('');
    setPassword('');
    setPhrase('');
    setShowPhrase(false);
    await navigator.storage?.persist?.();
    await c.refresh();
    setHealth(c.health);
    setMessage(
      vault.data.recovery?.confirmed
        ? `Recovery scan complete: ${vault.data.notes.length} saved notes. No matches can mean a different phrase or deployment, or deposits still awaiting confirmation.`
        : 'Vault unlocked. Back up and confirm your recovery phrase before depositing.',
    );
  }
  async function refresh() {
    if (!controller) return;
    await controller.refresh();
    setHealth(controller.health);
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
  const notes = (controller?.vault.data.notes ?? []).filter((n) => n.deployment === config?.id),
    attempts = (controller?.vault.data.attempts ?? []).filter((a) => a.deployment === config?.id);
  const noteLabel = (n: (typeof notes)[number]) =>
    `${n.amount ? money(n.amount) : n.pool.toLowerCase() === config?.pool.toLowerCase() ? money(config.denomination) : config?.noteVersion === 2 ? 'Pending amount' : money(config?.outputDenomination ?? '0')} ${n.pool.toLowerCase() === config?.pool.toLowerCase() ? 'WETH' : 'gUSD'}`;
  const available = notes.filter((n) => controller?.noteState(n) === 'Available');
  const chosen = available.find((n) => n.id === selected);
  async function spend(kind: 'swap' | 'withdraw') {
    if (!controller || !chosen) throw new Error('Choose an available note');
    if (!health) throw new Error('Wait for readiness checks to complete');
    const quote =
      kind === 'swap' && config?.noteVersion === 2
        ? {
            expected: health.quote,
            minimum: minimumOutput(BigInt(health.quote), Number(slippage)).toString(),
            quotedAt: health.checkedAt,
          }
        : undefined;
    if (kind === 'swap') {
      setSwapWorking(true);
      setSwapAttemptId('');
    }
    let result;
    try {
      result = await controller.spend(chosen.id, kind, recipient, setBusy, quote);
      if (kind === 'swap') setSwapAttemptId(result.id);
    } finally {
      setSwapWorking(false);
    }
    setMessage(
      result.state === 'submitted'
        ? `Transaction submitted: ${result.hash}. Watching for confirmation automatically.`
        : 'Submission uncertain. Keep this vault and refresh before retrying.',
    );
    setSelected('');
  }
  const swapAttempt = attempts.find((a) => a.id === swapAttemptId);
  const swapPending =
    swapWorking ||
    (!!swapAttempt && ['broadcasting', 'submitted', 'mined'].includes(swapAttempt.state));
  const swapNotes = available.filter((n) => n.pool.toLowerCase() === config?.pool.toLowerCase());
  const swapChosen = swapNotes.find((n) => n.id === selected);
  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">LOCAL DEVNET · TEST ASSETS</p>
          <h1>Legacy recovery</h1>
          <a href="/">Back to private notes</a>
          <p className="muted">Your private balance. Permissionless swaps.</p>
        </div>
        <span className="badge">EIP-8141 · Uniswap V2</span>
      </header>
      {deployments.length > 0 && (
        <div className="deployment-choice">
          <label htmlFor="deployment">Pool deployment</label>
          <select
            id="deployment"
            value={deploymentUrl}
            disabled={!!busy}
            onChange={(e) => {
              const url = e.target.value;
              void run('Switching deployment…', async () => {
                const r = await fetch(url, { cache: 'no-store' });
                if (!r.ok) throw new Error('Deployment unavailable');
                const d = (await r.json()) as Deployment;
                setConfig(d);
                setDeploymentUrl(url);
                localStorage.setItem('himitsu-deployment-url', url);
                setHealth(null);
                setSelected('');
                setAccount(null);
                walletRef.current = null;
                if (controller) setController(new Controller(d, controller.vault));
              });
            }}
          >
            {deployments.map((d) => (
              <option key={d.url} value={d.url}>
                {d.name}
              </option>
            ))}
          </select>
          <p className="hint">
            Old notes remain in their original deployment. Switch here to access them.
          </p>
        </div>
      )}
      <div role="status" aria-live="polite" className="status">
        {busy || message || 'Connect to the local devnet to begin.'}
      </div>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      <SwapPanel
        inputAmount={money(config?.denomination ?? '100000000000000000')}
        outputAmount={
          health
            ? money(config?.noteVersion === 2 ? health.quote : (config?.outputDenomination ?? '0'))
            : ''
        }
        balance={money(
          swapNotes
            .reduce((sum, n) => sum + BigInt(n.amount ?? config!.denomination), 0n)
            .toString(),
        )}
        notes={swapNotes.map((n) => ({
          id: n.id,
          label: `${noteLabel(n)} · ${short(n.commitment)}`,
        }))}
        selected={swapChosen?.id ?? ''}
        onSelect={setSelected}
        slippage={slippage}
        onSlippage={setSlippage}
        minimum={
          health
            ? money(
                config?.noteVersion === 2
                  ? minimumOutput(BigInt(health.quote), Number(slippage)).toString()
                  : (config?.outputDenomination ?? '0'),
              )
            : ''
        }
        market={config?.noteVersion === 2}
        locked={!controller}
        busy={!!busy || swapPending}
        rolling={swapPending}
        status={
          swapWorking
            ? busy
            : swapAttempt
              ? `Swap ${swapAttempt.state}${swapAttempt.state === 'confirmed' ? ' · Your output note is ready.' : swapAttempt.state === 'unknown' ? ' · Checking the chain before you retry.' : '.'}`
              : ''
        }
        error={error}
        reason={
          !controller
            ? 'Unlock your private wallet below to swap.'
            : !controller.vault.data.recovery?.confirmed
              ? 'Confirm your recovery phrase below to continue.'
              : !swapNotes.length
                ? 'Deposit ETH below to create your first available WETH note.'
                : !swapChosen
                  ? 'Choose a private note to spend.'
                  : !health
                    ? 'Waiting for the network and a live quote.'
                    : health.swapIssues.join(' ')
        }
        disabled={
          !!busy ||
          swapPending ||
          !controller?.vault.data.recovery?.confirmed ||
          !swapChosen ||
          !health ||
          !!health.swapIssues.length
        }
        onSwap={() => void run('Preparing private swap…', () => spend('swap'))}
      />
      <section>
        <h2>1. Private wallet</h2>
        <p className="muted">
          Back up your Himitsu recovery phrase once to recover confirmed new private notes on a new
          browser. Your local password encrypts this browser. Anyone with the phrase can spend your
          notes. Use a separate phrase from your Ethereum wallet and keep it offline.
        </p>
        {!controller ? (
          <div>
            <div className="row" aria-label="Private wallet options">
              <button
                className={mode === 'create' ? '' : 'secondary'}
                disabled={!!busy || hasVault !== false}
                onClick={() => {
                  setMode('create');
                  setPhrase('');
                  setError('');
                }}
              >
                Create private wallet
              </button>
              <button
                className={mode === 'unlock' ? '' : 'secondary'}
                disabled={!!busy || hasVault !== true}
                onClick={() => {
                  setMode('unlock');
                  setPhrase('');
                  setError('');
                }}
              >
                Unlock
              </button>
              <button
                className={mode === 'restore' ? '' : 'secondary'}
                disabled={!!busy || hasVault !== false}
                onClick={() => {
                  setMode('restore');
                  setPhrase('');
                  setError('');
                }}
              >
                Restore from phrase
              </button>
              <button
                className={mode === 'backup' ? '' : 'secondary'}
                disabled={!!busy || hasVault !== false}
                onClick={() => {
                  setMode('backup');
                  setPhrase('');
                  setError('');
                }}
              >
                Restore encrypted backup
              </button>
            </div>
            {hasVault === null ? (
              <p>Checking this browser for a saved private wallet…</p>
            ) : (
              <>
                <h3>
                  {mode === 'create'
                    ? 'Create a new private wallet'
                    : mode === 'unlock'
                      ? 'Unlock your saved private wallet'
                      : mode === 'restore'
                        ? 'Restore your Himitsu notes'
                        : 'Import an encrypted backup'}
                </h3>
                <p className="hint">
                  {mode === 'create'
                    ? 'Choose a local password. Himitsu will generate your recovery phrase next—you do not need to supply one.'
                    : mode === 'unlock'
                      ? 'Enter the local password you previously chose. Your recovery phrase is not needed to unlock this browser.'
                      : mode === 'restore'
                        ? 'Use the 24 words previously generated by Himitsu and choose a new local password.'
                        : 'Use the password that encrypted your backup file.'}
                </p>
                <form
                  aria-busy={!!busy}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(
                      mode === 'create'
                        ? 'Creating your private wallet…'
                        : restoreMode
                          ? 'Restoring notes from the chain…'
                          : 'Unlocking your private wallet…',
                      () => unlock(),
                    );
                  }}
                >
                  <label htmlFor="password">
                    {mode === 'unlock' || mode === 'backup'
                      ? 'Vault password'
                      : 'New local vault password'}
                  </label>
                  <div className="row">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={
                        mode === 'unlock' || mode === 'backup' ? 'current-password' : 'new-password'
                      }
                      minLength={12}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={!!busy}
                    />
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? 'Hide password' : 'Show password'}
                    </button>
                  </div>
                  {(mode === 'create' || restoreMode) && (
                    <>
                      <label htmlFor="confirm-password">Confirm local password</label>
                      <input
                        id="confirm-password"
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={12}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        disabled={!!busy}
                      />
                    </>
                  )}
                  {restoreMode && (
                    <>
                      <label htmlFor="restore-phrase">24-word Himitsu recovery phrase</label>
                      <textarea
                        id="restore-phrase"
                        rows={4}
                        value={phrase}
                        onChange={(e) => setPhrase(e.target.value)}
                        autoComplete="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        required
                        disabled={!!busy}
                      />
                      <p className="hint">
                        Never enter an Ethereum wallet seed phrase here. Restores confirmed Himitsu
                        notes; pending history and test wallet keys need your encrypted backup.
                      </p>
                    </>
                  )}
                  {mode !== 'backup' ? (
                    <button disabled={!!busy || !config} type="submit">
                      {busy ||
                        (mode === 'create'
                          ? 'Create and generate phrase'
                          : restoreMode
                            ? 'Restore phrase and scan'
                            : 'Unlock private wallet')}
                    </button>
                  ) : (
                    <>
                      <label htmlFor="backup-file">Encrypted backup file</label>
                      <input
                        id="backup-file"
                        type="file"
                        accept="application/json,.json"
                        disabled={!!busy || !password || !config}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f)
                            void run('Restoring encrypted backup…', async () => {
                              if (f.size > 5000000) throw new Error('Backup is too large');
                              await unlock(await f.text());
                            });
                        }}
                      />
                    </>
                  )}
                </form>
                {hasVault && (
                  <p className="hint">
                    This browser already has a wallet. To test restoration without overwriting it,
                    use a separate browser profile.
                  </p>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="row">
            <span>Vault unlocked · {notes.length} notes in this deployment</span>
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
                setPhrase('');
                setShowPhrase(false);
                setMode('unlock');
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
        {controller && (
          <div>
            {!controller.vault.data.recovery ? (
              <button
                disabled={!!busy}
                onClick={() =>
                  void run('Preparing recovery phrase…', () => controller.vault.enableRecovery())
                }
              >
                Enable recovery for new notes
              </button>
            ) : (
              <>
                <p>
                  {controller.vault.data.recovery.confirmed
                    ? 'Recovery phrase confirmed.'
                    : 'Write down all 24 words in order, then hide them and re-enter them to confirm your backup.'}
                </p>
                <button disabled={!!busy} onClick={() => setShowPhrase(!showPhrase)}>
                  {showPhrase ? 'Hide recovery phrase' : 'Reveal recovery phrase'}
                </button>
                {showPhrase && (
                  <p className="recovery-phrase">{controller.vault.data.recovery.phrase}</p>
                )}
                {!controller.vault.data.recovery.confirmed && !showPhrase && (
                  <>
                    <label htmlFor="confirm-phrase">Re-enter your saved recovery phrase</label>
                    <textarea
                      id="confirm-phrase"
                      rows={4}
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={phrase}
                      onChange={(e) => setPhrase(e.target.value)}
                      disabled={!!busy}
                    />
                    <button
                      disabled={!!busy || !phrase}
                      onClick={() =>
                        void run('Confirming backup and scanning…', async () => {
                          await controller.vault.confirmRecovery(phrase);
                          setPhrase('');
                          await controller.refresh();
                          setMessage('Recovery phrase confirmed. You can create private notes.');
                        })
                      }
                    >
                      Confirm backup
                    </button>
                  </>
                )}
              </>
            )}
            {notes.some((n) => !n.recovery) && (
              <p className="error">
                Legacy notes require your encrypted backup. This phrase cannot recover them.
              </p>
            )}
            <p className="hint">
              Use one active browser for each phrase. Recovery scans confirmed pool events directly
              through RPC; no hosted indexer is required. Keep an encrypted backup for pending
              transactions and local test-wallet keys.
            </p>
          </div>
        )}
      </section>
      <section aria-label="Demo readiness">
        <div className="row between">
          <h2>Demo readiness</h2>
          <span>
            {monitoring ? 'Checking…' : health ? 'Updates every 3 seconds' : 'Waiting for node'}
          </span>
        </div>
        {monitorError ? (
          <p className="error">{monitorError} Automatic checks will retry.</p>
        ) : !health ? (
          <p>Checking network, deployed contracts, liquidity and gas funding…</p>
        ) : (
          <>
            <p>Network and deployed contracts verified · block {health.block}</p>
            <p>
              Paymaster balance: <strong>{money(health.sponsorBalance)} test ETH</strong> ·
              conservative swap budget: {money(health.swapFunding)} ETH
            </p>
            <p>
              Pool quote: <strong>{money(health.quote)} gUSD</strong> per 0.1 WETH
            </p>
            {[
              ...new Set([
                ...health.depositIssues,
                ...health.swapIssues,
                ...health.withdrawalIssues,
              ]),
            ].map((issue) => (
              <p className="error" key={issue}>
                {issue}
              </p>
            ))}
            {!health.swapIssues.length &&
              !health.depositIssues.length &&
              !health.withdrawalIssues.length && (
                <p className="hint">
                  Ready for deposit, swap and withdrawal. Readiness checks do not reserve gas
                  funding or liquidity.
                </p>
              )}
          </>
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
              disabled={
                !controller?.vault.data.recovery?.confirmed ||
                !account ||
                !!busy ||
                !health ||
                !!health.depositIssues.length
              }
              onClick={() =>
                void run('Save note, then approve deposit in your wallet…', async () => {
                  const a = await controller!.deposit(walletRef.current!, account!);
                  setMessage(
                    a.hash
                      ? `Deposit submitted: ${a.hash}. Watching for confirmation automatically.`
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
          <h2>3. Withdraw</h2>
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
                {noteLabel(n)} · {short(n.commitment)}
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
              className="secondary"
              disabled={!!busy || !chosen || !health || !!health.withdrawalIssues.length}
              onClick={() => void run('Preparing withdrawal…', () => spend('withdraw'))}
            >
              Withdraw note
            </button>
          </div>
          <p className="hint">
            {config?.noteVersion === 2
              ? 'The live AMM rate includes the Uniswap V2 0.3% fee. Proof generation happens locally. Quote and minimum output are bound to your authorization.'
              : 'Legacy fixed quote: 0.1 WETH → 150 gUSD. This older test flow leaves excess AMM output in the pair; select v2 for full output.'}
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
            Check now
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
                    <td>{noteLabel(n)}</td>
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
                  <p className="hint">
                    {a.detail || 'Watching for canonical inclusion automatically.'}
                  </p>
                  <details>
                    <summary>Transaction details</summary>
                    <dl>
                      <dt>Transaction hash</dt>
                      <dd>{a.hash || 'Awaiting wallet response'}</dd>
                      <dt>Submission</dt>
                      <dd>
                        {a.kind === 'deposit'
                          ? 'Deposit wallet → RPC'
                          : 'Browser → RPC directly; no relayer or bundler signature'}
                      </dd>
                      <dt>Gas payer</dt>
                      <dd>{a.kind === 'deposit' ? a.sender : config?.sponsor}</dd>
                    </dl>
                    {a.quote && (
                      <p>
                        Quoted: {money(a.quote.expected)} gUSD · minimum: {money(a.quote.minimum)}{' '}
                        gUSD. Actual output is shown in your recovered note.
                      </p>
                    )}
                    {a.kind !== 'deposit' && (
                      <>
                        <p>
                          The ZK proof authorizes the exact transaction. The prefunded paymaster
                          approves gas payment onchain.
                        </p>
                        <ol>
                          {(a.frameDetails ?? []).map((f, i) => (
                            <li key={i}>
                              <strong>
                                {f.mode}: {f.purpose}
                              </strong>
                              <div className="hint">
                                Target: {f.target} · execution budget {f.executionGas} · state
                                budget {f.stateGas}
                              </div>
                            </li>
                          ))}
                        </ol>
                        <p className="hint">
                          {a.frameDetails
                            ? 'Frame budgets are limits, not measured fees.'
                            : 'Detailed frame metadata is unavailable for this legacy journal entry.'}
                        </p>
                      </>
                    )}
                    {controller?.current?.receipts.get(a.id) && (
                      <p>
                        Receipt gas used:{' '}
                        {BigInt(controller.current.receipts.get(a.id)!.receipt.gasUsed).toString()}{' '}
                        ·{' '}
                        {controller.current.receipts.get(a.id)!.confirmed
                          ? 'Confirmed'
                          : 'Included; awaiting two successor blocks'}
                      </p>
                    )}
                  </details>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="hint">
          Notes and transaction status update automatically. Two successor blocks are required
          before a note becomes available. A missing receipt alone never releases a reserved note.
          If another user consumes the pool nonce or a transaction expires, reconcile before
          explicitly retrying.
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
          Distinctive amounts can correlate activity; private note ownership is not a guarantee
          against timing or amount analysis. Development ceremony and test tokens only.
        </p>
      </footer>
    </main>
  );
}
