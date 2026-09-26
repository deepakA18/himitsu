'use client';
import { SiteNav } from '../../components/site-nav';
import Image from 'next/image';
import { WalletButton } from '../../components/connected-wallet';
import { useEffect, useRef, useState } from 'react';
import { formatUnits, isAddress } from 'viem';
import { ConnectKitButton } from 'connectkit';
import { useAccount, useConfig } from 'wagmi';
import { getAccount } from 'wagmi/actions';
import { guardDepositWallet } from '../../lib/deposit-wallet';
import { selectWalletNetwork } from '../../lib/wallet-network';
import { useWalletDeployment } from '../../components/wallet-provider';
import { Controller, Vault, IndexedVaultStore, type Wallet } from '../../lib/controller';
import { TransactionNotifications } from '../../components/transaction-notifications';
import { NoteDialog } from '../../components/note-dialog';
import { SwapPanel } from '../../components/swap-panel';
import {
  createPrivateNote,
  DEPOSIT_AMOUNTS,
  exportPrivateNote,
  importPrivateNote,
  privateNoteCacheKey,
} from '../../../../packages/client/src/private-note';
import type { SavedNote } from '../../../../packages/client/src/notes';
import type { Deployment } from '../../../../packages/client/src/chain';
import { readiness, minimumOutput, type Readiness } from '../../../../packages/client/src/market';
import { isActive } from '../../../../packages/client/src/vault';
import { RpcClient } from '../../../../packages/client/src/index';
const money = (v: string) =>
  Number(formatUnits(BigInt(v), 18)).toLocaleString(undefined, { maximumFractionDigits: 6 });
type Draft = {
  kind: 'deposit' | 'swap';
  note: SavedNote;
  text: string;
  controller: Controller;
  source?: string;
  depositAccount?: string;
};
export default function Page() {
  const initialDeployment = useWalletDeployment();
  const [config, setConfig] = useState<Deployment | null>(initialDeployment);
  const [selectedDeposit, setSelectedDeposit] = useState('100000000000000000');
  const depositValue =
    config && BigInt(config.denomination) > 0n ? config.denomination : selectedDeposit;
  const fixedMode = config?.mode === 'fixed';
  const wagmiConfig = useConfig();
  const { address: account, chainId: walletChainId, isConnected, connector } = useAccount();
  const walletReady = isConnected && walletChainId === Number(config?.chainId);
  const [tab, setTab] = useState<'deposit' | 'swap' | 'withdraw'>('deposit');
  const [health, setHealth] = useState<Readiness | null>(null);
  const [controller, setController] = useState<Controller | null>(null);
  const [noteId, setNoteId] = useState('');
  const [input, setInput] = useState('');
  const [noteError, setNoteError] = useState('');
  const checkedInput = useRef('');
  function updateNoteInput(value: string) {
    setInput(value);
    checkedInput.current = '';
    setNoteError('');
    setNoteId('');
    setController(null);
    setHealth(null);
    setStatus('');
  }
  const [recipient, setRecipient] = useState('');
  const [reverse, setReverse] = useState(false);
  const [slippage, setSlippage] = useState('50');
  const [withdrawReview, setWithdrawReview] = useState<{
    controller: Controller;
    source: string;
    recipient: string;
    amount: string;
    asset: string;
  } | null>(null);
  const [swapReview, setSwapReview] = useState<{
    controller: Controller;
    source: string;
    recipient: string;
    expected: string;
    minimum: string;
    inputAmount: string;
    inputAsset: string;
    outputAsset: string;
    quotedAt: number;
  } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [copyMessage, setCopyMessage] = useState('');
  const [downloaded, setDownloaded] = useState(false);
  const [backedUp, setBackedUp] = useState(false);
  const [busy, setBusy] = useState('');
  const [swapPreparing, setSwapPreparing] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [networkError, setNetworkError] = useState('');
  const [networkSwitching, setNetworkSwitching] = useState(false);
  const [networkSwitchError, setNetworkSwitchError] = useState('');
  const [, rerender] = useState(0);
  const working = useRef(false),
    syncing = useRef(false);
  const networkSwitchAttempt = useRef('');
  const download = (text: string, name: string) => {
    const url = URL.createObjectURL(new Blob([text + '\n'], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  async function run(label: string, action: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(label);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      working.current = false;
      setBusy('');
      rerender((v) => v + 1);
    }
  }
  async function requestNetworkSwitch() {
    if (!config) return;
    const connection = getAccount(wagmiConfig);
    if (!connection.isConnected || !connection.connector) return;
    setNetworkSwitching(true);
    setNetworkSwitchError('');
    try {
      const provider = await connection.connector.getProvider();
      if (!provider || typeof (provider as Wallet).request !== 'function')
        throw new Error('The selected wallet cannot switch networks.');
      await selectWalletNetwork(provider as Wallet, config);
    } catch (e) {
      const code = e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined;
      setNetworkSwitchError(
        code === 4001
          ? 'Network change was declined. Approve the switch in your wallet to continue.'
          : e instanceof Error
            ? e.message
            : 'Could not switch networks. Approve the network request in your wallet and retry.',
      );
    } finally {
      setNetworkSwitching(false);
    }
  }
  async function connectWallet(show: () => void) {
    const injectedConnector = wagmiConfig.connectors.find((item) => item.id === 'injected');
    const hasWalletConnect = !!process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
    if (!config || !injectedConnector || hasWalletConnect) {
      show();
      return;
    }
    setNetworkSwitching(true);
    setNetworkSwitchError('');
    try {
      const provider = await injectedConnector.getProvider();
      if (!provider || typeof (provider as Wallet).request !== 'function') {
        show();
        return;
      }
      await selectWalletNetwork(provider as Wallet, config);
      show();
    } catch (e) {
      const code = e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined;
      setNetworkSwitchError(
        code === 4001
          ? 'Network change was declined. Approve the switch in your wallet to continue.'
          : e instanceof Error
            ? e.message
            : 'Could not select the configured network. Retry the wallet connection.',
      );
    } finally {
      setNetworkSwitching(false);
    }
  }
  useEffect(() => {
    if (!isConnected || !account || !connector || !config || walletReady) {
      if (!isConnected || walletReady) networkSwitchAttempt.current = '';
      return;
    }
    const attempt = `${connector.id}:${account.toLowerCase()}:${config.chainId}`;
    if (networkSwitchAttempt.current === attempt) return;
    networkSwitchAttempt.current = attempt;
    void requestNetworkSwitch();
  }, [account, config, connector, isConnected, walletReady]);
  useEffect(() => {
    if (!config) return;
    let stopped = false;
    const update = async () => {
      if (working.current || syncing.current || document.hidden) return;
      syncing.current = true;
      try {
        if (controller) await controller.refresh();
        const selected = controller?.vault.data.notes.find((n) => n.id === noteId);
        const sourcePool = reverse ? config.outputPool : config.pool;
        const checked = await readiness(
          new RpcClient(config.rpcUrl),
          config,
          sourcePool,
          selected?.pool.toLowerCase() === sourcePool.toLowerCase() && selected.amount
            ? selected.amount
            : reverse
              ? '100000000000000000000'
              : (config.defaultDepositAmount ?? config.denomination),
        );
        if (!stopped) {
          setHealth(checked);
          setNetworkError('');
          rerender((v) => v + 1);
        }
      } catch (e) {
        if (!stopped) {
          setHealth(null);
          setNetworkError(e instanceof Error ? e.message : 'Network unavailable');
        }
      } finally {
        syncing.current = false;
      }
    };
    void update();
    const timer = setInterval(update, 3000);
    window.addEventListener('focus', update);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener('focus', update);
    };
  }, [config, controller, noteId, reverse]);
  const note = controller?.vault.data.notes.find((n) => n.id === noteId);
  const noteState = note ? controller!.noteState(note) : '';
  const attempts = controller?.vault.data.attempts ?? [];
  const pending = attempts.some(isActive);
  const disabled = !!busy || !!draft || !!withdrawReview || !!swapReview || pending;
  const latestSwap = attempts.filter((a) => a.kind === 'swap' && a.source === noteId).at(-1);
  const swapPending = swapPreparing || !!(latestSwap && isActive(latestSwap));
  const swapCompleted = !swapPreparing && latestSwap?.state === 'confirmed';
  const settledOutput = latestSwap?.output
    ? controller?.vault.data.notes.find((n) => n.id === latestSwap.output)?.amount
    : undefined;
  const asset = note?.pool.toLowerCase() === config?.pool.toLowerCase() ? 'WETH' : 'hUSD';
  async function session(n: SavedNote, importing: boolean) {
    const v = await navigator.locks.request('himitsu-vault-actions', async () => {
      const v = await Vault.openPrivateNote(
        new IndexedVaultStore(`himitsu-note-cache-${n.id}`),
        privateNoteCacheKey(n),
      );
      if (
        importing &&
        !v.data.notes.some(
          (x) =>
            x.nullifierHash === n.nullifierHash && x.pool.toLowerCase() === n.pool.toLowerCase(),
        )
      )
        await v.save({ ...v.data, notes: [...v.data.notes, n] });
      return v;
    });
    const c = new Controller(config!, v);
    await c.refresh();
    setController(c);
    setHealth(c.health);
    return c;
  }
  async function loadNote(text: string) {
    if (!config) throw new Error('Wait for the deployment to load');
    const n = importPrivateNote(text, config);
    const c = await session(n, true);
    setNoteId(
      c.vault.data.notes.find(
        (x) => x.nullifierHash === n.nullifierHash && x.pool.toLowerCase() === n.pool.toLowerCase(),
      )!.id,
    );
    setReverse(n.pool.toLowerCase() === config.outputPool.toLowerCase());
    setHealth(null);
    setInput('');
    setStatus('File checked with the network.');
  }
  useEffect(() => {
    const text = input.trim();
    if (!text || !config || disabled || checkedInput.current === text) return;
    const timer = setTimeout(() => {
      if (working.current) return;
      checkedInput.current = text;
      void run('Checking your saved file…', async () => {
        setNoteError('');
        try {
          await loadNote(text);
        } catch (e) {
          setNoteError(e instanceof Error ? e.message : 'Could not check this note');
        }
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [input, config, disabled]);

  async function prepare(kind: 'deposit' | 'swap') {
    if (!config) throw new Error('Wait for the deployment to load');
    const n = createPrivateNote(
      config,
      kind === 'deposit' ? config.pool : reverse ? config.pool : config.outputPool,
      kind,
      kind === 'deposit' ? depositValue : undefined,
    );
    const text = exportPrivateNote(n, config);
    // Trigger the client download inside the original click, before async RPC work.
    if (kind === 'deposit') download(text, `himitsu-${kind}-${n.id.slice(2, 10)}.txt`);
    const c = kind === 'deposit' ? await session(n, false) : controller!;
    if (!c || (kind === 'swap' && (!note || noteState !== 'Available')))
      throw new Error('Add a saved file for this token first');
    setDraft({
      kind,
      note: n,
      text,
      controller: c,
      source: noteId,
      ...(kind === 'deposit' && account ? { depositAccount: account } : {}),
    });
    setCopyMessage('');
    setDownloaded(kind === 'deposit');
    setBackedUp(false);
    setStatus('Save your new file before continuing.');
  }
  async function submitDraft() {
    if (!draft || !downloaded || !backedUp)
      throw new Error('Save your file and confirm the backup first');
    const current = draft;
    // Remove the submission control before awaiting; retries must prepare a fresh output note.
    setDraft(null);
    let result;
    if (current.kind === 'deposit') {
      const connection = getAccount(wagmiConfig);
      if (!connection.address || !connection.connector || connection.status !== 'connected')
        throw new Error('Connect your deposit wallet first');
      if (connection.address.toLowerCase() !== current.depositAccount?.toLowerCase())
        throw new Error(
          'Wallet account changed. Prepare a new deposit note for the selected account.',
        );
      if (connection.chainId !== Number(current.controller.deployment.chainId))
        throw new Error('Switch to the Himitsu network before depositing');
      const provider = await connection.connector.getProvider();
      if (!provider || typeof (provider as Wallet).request !== 'function')
        throw new Error('Selected wallet cannot submit deposits');
      result = await current.controller.deposit(
        guardDepositWallet(
          provider as Wallet,
          {
            address: connection.address,
            chainId: connection.chainId,
            connectorId: connection.connector.uid,
            connected: true,
          },
          () => {
            const live = getAccount(wagmiConfig);
            return {
              address: live.address,
              chainId: live.chainId,
              connectorId: live.connector?.uid,
              connected: live.status === 'connected',
            };
          },
        ),
        connection.address,
        current.note,
      );
      setNoteId(current.note.id);
    } else {
      if (!health) throw new Error('Wait for the current price');
      setSwapPreparing(true);
      try {
        result = await current.controller.spend(
          current.source!,
          'swap',
          '',
          setBusy,
          config!.noteVersion === 2
            ? {
                expected: health.quote,
                minimum: minimumOutput(BigInt(health.quote), Number(slippage)).toString(),
                quotedAt: health.checkedAt,
              }
            : undefined,
          current.note,
        );
      } finally {
        setSwapPreparing(false);
      }
    }
    setController(current.controller);
    setStatus(
      result.state === 'submitted'
        ? 'Submitted.'
        : 'The network has not confirmed the swap yet. Keep both saved files and check its status before trying again.',
    );
  }
  const inputAsset = reverse ? 'hUSD' : 'WETH';
  const outputAsset = reverse ? 'WETH' : 'hUSD';
  const swapReason = !note
    ? `Add your saved ${inputAsset} file above to swap.`
    : noteState !== 'Available'
      ? `File status: ${noteState}.`
      : asset !== inputAsset
        ? `Add your saved ${inputAsset} file for this swap.`
        : !health ||
            health.sourcePool?.toLowerCase() !==
              (reverse ? config?.outputPool : config?.pool)?.toLowerCase() ||
            (note.amount && health.inputAmount !== note.amount)
          ? 'Waiting for the current price.'
          : health.swapIssues.join(' ');
  const noteEntry = (
    <>
      <h2>Your saved file</h2>
      <p className="muted">Choose the saved file for the funds you want to use.</p>
      <div>
        <label htmlFor="private-note">Paste your saved file</label>
        <textarea
          id="private-note"
          rows={3}
          value={input}
          onChange={(e) => updateNoteInput(e.target.value)}
          aria-describedby="note-check-status"
          aria-invalid={!!noteError}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="none"
          placeholder="himitsu-note-v1:…"
        />
        <p id="note-check-status" className={noteError ? 'error' : 'hint'} role="status" aria-live="polite">
          {busy === 'Checking your saved file…'
            ? 'Checking your file with the network…'
            : noteError || (note ? 'File checked with the network.' : input.trim() ? 'Checking your file…' : 'Paste or upload your file to check your balance.')}
        </p>
        <div className="note-upload-row">
          <label className="note-upload" data-disabled={!config || disabled}>
            <span className="note-upload-copy">
              <strong>Upload your saved file</strong>
              <span>Choose your saved .txt file · up to 4 KB</span>
            </span>
            <span className="note-upload-browse" aria-hidden="true">
              Browse
            </span>
            <input
              type="file"
              aria-label="Upload your saved file"
              accept=".txt,text/plain"
              disabled={!config || disabled}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file)
                  void run('Reading your saved file…', async () => {
                    if (file.size > 4096) throw new Error('This file is too large');
                    updateNoteInput(await file.text());
                  });
              }}
            />
          </label>
        </div>
      </div>
      {note && (
        <div className="note-summary">
          <strong>
            {note.amount
              ? money(note.amount)
              : config?.noteVersion === 2
                ? 'Amount awaiting confirmation'
                : money(asset === 'WETH' ? config!.denomination : config!.outputDenomination)}{' '}
            {asset}
          </strong>
          <span>{noteState}</span>
          <button
            className="secondary"
            disabled={disabled}
            onClick={() => {
              setController(null);
              setNoteId('');
              setReverse(false);
              setHealth(null);
              setInput('');
              setStatus(
                'Saved file removed from this session. The app will still check the transaction status.',
              );
            }}
          >
            Clear note
          </button>
        </div>
      )}
    </>
  );
  const withdrawalFields = (
    <>
      <h2>Send to</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (
            disabled ||
            !controller ||
            !note ||
            noteState !== 'Available' ||
            !health ||
            health.withdrawalIssues.length
          )
            return;
          const address = recipient.trim();
          if (!isAddress(address) || BigInt(address) === 0n) {
            setError('Enter a valid, nonzero recipient address.');
            return;
          }
          setError('');
          setWithdrawReview({
            controller,
            source: noteId,
            recipient: address,
            amount:
              note.amount ?? (asset === 'WETH' ? config!.denomination : config!.outputDenomination),
            asset,
          });
        }}
      >
        <label htmlFor="recipient">Recipient address</label>
        <input
          id="recipient"
          aria-describedby="withdraw-privacy-warning"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="0x…"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
        />
        <p id="withdraw-privacy-warning" className="withdraw-privacy-warning">
          <strong>Privacy:</strong> Withdrawing to the same address you used to deposit can
          link your deposit and withdrawal. Use a fresh address you control to reduce address-based
          linkage.
        </p>
        <button
          disabled={
            disabled ||
            noteState !== 'Available' ||
            !recipient ||
            !health ||
            !!health.withdrawalIssues.length
          }
        >
          Withdraw note
        </button>
      </form>
      {health?.withdrawalIssues.map((x) => (
        <p className="error" key={x}>
          {x}
        </p>
      ))}
    </>
  );
  return (
    <>
      <SiteNav
        page="app"
        wallet={<WalletButton />}
      />
      <main data-action={tab}>
        <TransactionNotifications
          key={config?.id ?? 'loading'}
          attempts={attempts}
          pool={config?.pool ?? ''}
          error={error}
        />

        {tab === 'swap' && (
          <div className="trade-intro">
            <div className="uniswap-credit" aria-label="Powered by Uniswap">
              <Image src="/uniswap-logo.svg" alt="" width={22} height={22} />
              <span>Powered by Uniswap</span>
            </div>
          </div>
        )}
        {fixedMode && (
          <p className="hint">
            This setup uses a fixed amount: deposit 0.1 ETH and withdraw 0.1 WETH. Matching amounts
            can make deposits harder to tell apart, but addresses and timing stay public. Activity
            may still be linked, especially when few people use the pool. Keep your saved file safe.
          </p>
        )}
        <nav className="note-tabs" aria-label="Actions">
          {(['deposit', 'swap', 'withdraw'] as const)
            .filter((t) => !fixedMode || t !== 'swap')
            .map((t) => (
              <button
                key={t}
                className={tab === t ? '' : 'secondary'}
                aria-pressed={tab === t}
                disabled={!!busy || !!draft}
                onClick={() => {
                  setTab(t);
                  setError('');
                }}
              >
                {t === 'swap' ? 'Swap & withdraw' : t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
        </nav>
        <p className="status" role="status">
          {busy || status}
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {networkError && (
          <p className="error">Network unavailable: {networkError}. Retrying automatically.</p>
        )}
        {withdrawReview && (
          <NoteDialog
            busy={!!busy}
            titleId="withdraw-review-heading"
            descriptionId="withdraw-review-description"
            closeLabel="Cancel withdrawal"
            onClose={() => setWithdrawReview(null)}
          >
            <section className="note-backup">
              <p className="eyebrow">CHECK YOUR WITHDRAWAL</p>
              <h2 id="withdraw-review-heading" tabIndex={-1}>
                Confirm withdrawal
              </h2>
              <p id="withdraw-review-description">
                Check the amount and recipient. Confirming checks your saved file and sends the
                withdrawal.
              </p>
              <dl className="withdraw-review-details">
                <dt>You receive</dt>
                <dd>
                  {money(withdrawReview.amount)} {withdrawReview.asset}
                </dd>
                <dt>Recipient</dt>
                <dd>
                  <code>{withdrawReview.recipient}</code>
                </dd>
                <dt>Network</dt>
                <dd>
                  {config?.name} · Chain {config?.chainId}
                </dd>
                <dt>Network fee</dt>
                <dd>Covered by the transaction sponsor</dd>
              </dl>
              <p className="withdraw-privacy-warning">
                <strong>Privacy:</strong> Using your deposit address can link your deposit
                and withdrawal. A fresh address reduces address reuse; amounts and timing can still
                reveal a connection.
              </p>
              <p className="hint">
                This uses your full balance. WETH is a token version of ETH.
              </p>
              <div className="row">
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => {
                    const review = withdrawReview;
                    setWithdrawReview(null);
                    void run('Preparing withdrawal…', async () => {
                      const a = await review.controller.spend(
                        review.source,
                        'withdraw',
                        review.recipient,
                        setBusy,
                      );
                      setStatus(`Withdrawal ${a.state}. Watching the chain automatically.`);
                    });
                  }}
                >
                  Confirm withdrawal
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={!!busy}
                  onClick={() => setWithdrawReview(null)}
                >
                  Cancel
                </button>
              </div>
            </section>
          </NoteDialog>
        )}
        {swapReview && (
          <NoteDialog
            busy={!!busy}
            titleId="swap-review-heading"
            descriptionId="swap-review-description"
            closeLabel="Cancel swap and withdrawal"
            onClose={() => setSwapReview(null)}
          >
            <section className="note-backup">
              <p className="eyebrow">CHECK YOUR SWAP AND WITHDRAWAL</p>
              <h2 id="swap-review-heading" tabIndex={-1}>
                Confirm swap and withdraw
              </h2>
              <p id="swap-review-description">
                The swap output will be sent directly to your recipient in this transaction.
              </p>
              <dl className="withdraw-review-details">
                <dt>You swap</dt>
                <dd>
                  {money(swapReview.inputAmount)} {swapReview.inputAsset}
                </dd>
                <dt>You receive at least</dt>
                <dd>
                  {money(swapReview.minimum)} {swapReview.outputAsset}
                </dd>
                <dt>Recipient</dt>
                <dd>
                  <code>{swapReview.recipient}</code>
                </dd>
                <dt>Network</dt>
                <dd>
                  {config?.name} · Chain {config?.chainId}
                </dd>
                <dt>Network fee</dt>
                <dd>Covered by the transaction sponsor</dd>
              </dl>
              <p className="withdraw-privacy-warning">
                <strong>Privacy:</strong> The public transaction shows the recipient and swap
                output. A fresh address reduces address reuse; amounts and timing can still reveal
                a connection.
              </p>
              <div className="row">
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => {
                    const review = swapReview;
                    setSwapReview(null);
                    void run('Preparing your swap and withdrawal…', async () => {
                      setSwapPreparing(true);
                      try {
                        const result = await review.controller.spend(
                          review.source,
                          'swap-withdraw',
                          review.recipient,
                          setBusy,
                          {
                            expected: review.expected,
                            minimum: review.minimum,
                            quotedAt: review.quotedAt,
                          },
                        );
                        setController(review.controller);
                        setStatus(
                          result.state === 'submitted'
                            ? 'Swap and withdrawal submitted.'
                            : 'The network has not confirmed this transaction yet. Check its status before retrying.',
                        );
                      } finally {
                        setSwapPreparing(false);
                      }
                    });
                  }}
                >
                  Confirm swap and withdraw
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={!!busy}
                  onClick={() => setSwapReview(null)}
                >
                  Cancel
                </button>
              </div>
            </section>
          </NoteDialog>
        )}
        <div className="trade-workspace">
          {draft?.kind === 'swap' && (
            <NoteDialog
              busy={!!busy}
              onClose={() => {
                setDraft(null);
                setStatus('Cancelled. No transaction submitted.');
              }}
            >
              <section className="note-backup">
                <h2 id="backup-heading" tabIndex={-1}>
                  Save your secret file
                </h2>
                <p id="backup-description" className="note-backup-warning">
                  Anyone with this file can spend these funds. Keep it safe. We cannot restore it
                  if it is lost.
                </p>
                {draft.kind === 'swap' && (
                  <details className="note-backup-detail">
                    <summary>About this saved file</summary>
                    <p>It gives access to the tokens from your swap. Keep your original file until the swap completes.</p>
                  </details>
                )}
                <label className="note-backup-label" htmlFor="new-note">Your secret file</label>
                <textarea
                  id="new-note"
                  className="private-note-value"
                  value={draft.text}
                  readOnly
                  rows={5}
                  spellCheck={false}
                  autoComplete="off"
                  autoCapitalize="off"
                />
                <div className="note-save-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(draft.text);
                        setCopyMessage('Copied to clipboard.');
                      } catch {
                        setCopyMessage('Copy failed. Download the note instead.');
                      }
                    }}
                  >
                    Copy note
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      download(
                        draft.text,
                        `himitsu-${draft.kind}-${draft.note.id.slice(2, 10)}.txt`,
                      );
                      setDownloaded(true);
                    }}
                  >
                    Download note
                  </button>
                </div>
                {copyMessage && <p className="note-copy-status" role="status">{copyMessage}</p>}
                <p className="note-backup-hint" role="status">
                  {downloaded
                    ? `Backup file: himitsu-${draft.kind}-${draft.note.id.slice(2, 10)}.txt`
                    : 'Download the note before continuing.'}
                </p>
                <label className="check-label note-backup-confirm">
                  <input
                    type="checkbox"
                    checked={backedUp}
                    disabled={!downloaded}
                    onChange={(e) => setBackedUp(e.target.checked)}
                  />
                  I saved the file and understand it controls my funds.
                </label>
                <div className="note-backup-footer">
                  <p>Keep your original file until the swap completes.</p>
                  <div className="row">
                  <button
                    disabled={!downloaded || !backedUp || !!busy}
                    onClick={() => void run('Preparing private swap…', submitDraft)}
                  >
                    Confirm swap
                  </button>
                  <button
                    className="secondary"
                    disabled={!!busy}
                    onClick={() => {
                      setDraft(null);
                      setStatus('Cancelled. No transaction submitted.');
                    }}
                  >
                    Cancel
                  </button>
                  </div>
                </div>
              </section>
            </NoteDialog>
          )}
          {tab === 'deposit' ? (
            <section className="note-action">
              {draft?.kind === 'deposit' ? (
                <div className="note-backup deposit-inline-backup">
                  <h3>Save your secret file</h3>
                  <p className="note-backup-warning">
                    Save a file to use or withdraw your WETH later. Anyone with this file can spend
                    these funds. Keep it safe; we cannot restore it if it is lost.
                  </p>
                  <p className="note-backup-amount">
                    <span>Deposit</span>
                    <strong>
                      {money(draft.note.amount ?? config!.denomination)} <small>ETH</small>
                    </strong>
                  </p>
                  <label className="note-backup-label" htmlFor="deposit-note-file">
                    Your secret file
                  </label>
                  <textarea
                    id="deposit-note-file"
                    className="private-note-value"
                    value={draft.text}
                    readOnly
                    rows={5}
                    spellCheck={false}
                    autoComplete="off"
                    autoCapitalize="off"
                  />
                  <div className="note-save-actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(draft.text);
                          setCopyMessage('Copied to clipboard.');
                        } catch {
                          setCopyMessage('Copy failed. Download the note instead.');
                        }
                      }}
                    >
                      Copy note
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        download(draft.text, `himitsu-deposit-${draft.note.id.slice(2, 10)}.txt`);
                        setDownloaded(true);
                      }}
                    >
                      Download note
                    </button>
                  </div>
                  {copyMessage && <p className="note-copy-status" role="status">{copyMessage}</p>}
                  <p className="note-backup-hint" role="status">
                    {downloaded
                      ? `Backup file: himitsu-deposit-${draft.note.id.slice(2, 10)}.txt`
                      : 'Download the note before continuing.'}
                  </p>
                  {(!walletReady ||
                    account?.toLowerCase() !== draft.depositAccount?.toLowerCase()) && (
                    <p className="error">
                      The deposit wallet disconnected, changed accounts, or changed networks.
                      Restore the original wallet connection, or cancel and prepare a new deposit
                      note.
                    </p>
                  )}
                  <label className="check-label note-backup-confirm">
                    <input
                      type="checkbox"
                      checked={backedUp}
                      disabled={!downloaded}
                      onChange={(e) => setBackedUp(e.target.checked)}
                    />
                    I saved the file and understand it controls my funds.
                  </label>
                  <div className="note-backup-footer">
                    <p>Review the network fee in your wallet.</p>
                    <div className="row">
                      <button
                        disabled={
                          !downloaded ||
                          !backedUp ||
                          !!busy ||
                          !walletReady ||
                          account?.toLowerCase() !== draft.depositAccount?.toLowerCase()
                        }
                        onClick={() =>
                          void run('Approve the deposit in your wallet…', submitDraft)
                        }
                      >
                        Deposit {money(draft.note.amount ?? config!.denomination)} ETH
                      </button>
                      <button
                        className="secondary"
                        disabled={!!busy}
                        onClick={() => {
                          setDraft(null);
                          setStatus('Cancelled. No transaction submitted.');
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
              {fixedMode && <p>Each saved file gives access to 0.1 WETH. Keep it to withdraw later.</p>}
              <input
                id="deposit-amount"
                aria-label="Deposit amount in ETH"
                value={config ? money(depositValue) : ''}
                readOnly
              />
              <div className="deposit-presets" role="group" aria-label="Deposit amount in ETH">
                {DEPOSIT_AMOUNTS.map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    aria-pressed={depositValue === amount}
                    disabled={
                      disabled ||
                      !config ||
                      (BigInt(config.denomination) > 0n && config.denomination !== amount)
                    }
                    onClick={() => setSelectedDeposit(amount)}
                  >
                    {money(amount)} ETH
                  </button>
                ))}
              </div>
              <p className="hint">
                {config && BigInt(config.denomination) > 0n
                  ? 'This deposit must use the amount shown.'
                  : 'Choose a standard deposit amount.'}
              </p>
              <div className="row">
                {!isConnected ? (
                  <ConnectKitButton.Custom>
                    {({ show }) => (
                      <>
                        <button
                          type="button"
                          disabled={disabled || networkSwitching || !show}
                          onClick={() => {
                            if (show) void connectWallet(show);
                          }}
                        >
                          {networkSwitching
                            ? 'Selecting network…'
                            : networkSwitchError
                              ? 'Retry wallet setup'
                              : 'Connect wallet'}
                        </button>
                        {networkSwitchError && (
                          <p className="hint" role="status">
                            {networkSwitchError}
                          </p>
                        )}
                      </>
                    )}
                  </ConnectKitButton.Custom>
                ) : !walletReady ? (
                  <>
                    <button
                      type="button"
                      disabled={disabled || networkSwitching || !config}
                      onClick={() => void requestNetworkSwitch()}
                    >
                      {networkSwitching ? 'Selecting network…' : 'Switch network'}
                    </button>
                    {networkSwitchError && (
                      <p className="hint" role="status">
                        {networkSwitchError}
                      </p>
                    )}
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={!account || !health || !!health.depositIssues.length || disabled}
                    onClick={() =>
                      void run('Preparing your saved file…', () => prepare('deposit'))
                    }
                  >
                    Deposit
                  </button>
                )}
              </div>
              {health?.depositIssues.map((issue) => (
                <p key={issue} className="error">
                  {issue}
                </p>
              ))}
                </>
              )}
            </section>
          ) : tab === 'swap' ? (
            <section className="combined-swap-card" aria-label="Swap and withdraw using your saved file">
              <div className="note-action swap-note-entry">{noteEntry}</div>
              <SwapPanel
                privateNoteMode
                inputAsset={inputAsset}
                outputAsset={outputAsset}
                onReverse={() => {
                  setReverse(!reverse);
                  setHealth(null);
                  setStatus('');
                }}
                inputAmount={money(
                  note && asset === inputAsset && note.amount
                    ? note.amount
                    : reverse
                      ? '100000000000000000000'
                      : (config?.defaultDepositAmount ??
                        config?.denomination ??
                        '100000000000000000'),
                )}
                outputAmount={
                  health
                    ? money(
                        config?.noteVersion === 2
                          ? health.quote
                          : (config?.outputDenomination ?? '0'),
                      )
                    : ''
                }
                balance="0"
                notes={[]}
                selected=""
                onSelect={() => {}}
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
                recipient={recipient}
                onRecipient={setRecipient}
                market={config?.noteVersion === 2}
                locked={false}
                busy={disabled}
                rolling={!!swapPending}
                completed={swapCompleted}
                animationKey={`${noteId}:${reverse}`}
                settledOutput={settledOutput ? money(settledOutput) : ''}
                status={busy || (swapPending || swapCompleted ? latestSwap?.state : '') || ''}
                error=""
                reason={swapReason}
                disabled={disabled || !!swapReason}
                onSwap={() => {
                  if (!controller || !note || !health) return;
                  const address = recipient.trim();
                  if (!isAddress(address) || BigInt(address) === 0n) {
                    setError('Enter a valid, nonzero recipient address.');
                    return;
                  }
                  const expected = BigInt(health.quote);
                  const minimum =
                    config?.noteVersion === 2
                      ? minimumOutput(expected, Number(slippage))
                      : BigInt(config?.outputDenomination ?? '0');
                  if (expected <= 0n || minimum <= 0n || minimum > expected) {
                    setError('The current quote cannot be used. Refresh and try again.');
                    return;
                  }
                  setError('');
                  setSwapReview({
                    controller,
                    source: noteId,
                    recipient: address,
                    expected: expected.toString(),
                    minimum: minimum.toString(),
                    inputAmount: note.amount ?? config?.denomination ?? '0',
                    inputAsset,
                    outputAsset,
                    quotedAt: health.checkedAt,
                  });
                }}
              />
            </section>
          ) : (
            <section className="note-action withdrawal-card">
              <div className="withdrawal-note-entry">{noteEntry}</div>
              <div className="withdrawal-destination">{withdrawalFields}</div>
            </section>
          )}
        </div>
      </main>
    </>
  );
}
