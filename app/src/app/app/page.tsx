'use client';
import { SiteNav } from '../../components/site-nav';
import { useEffect, useRef, useState } from 'react';
import { formatUnits, isAddress } from 'viem';
import { ConnectKitButton } from 'connectkit';
import { useAccount, useConfig, useSwitchChain } from 'wagmi';
import { getAccount } from 'wagmi/actions';
import { guardDepositWallet } from '../../lib/deposit-wallet';
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
  const { address: account, chainId: walletChainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const walletReady = isConnected && walletChainId === Number(config?.chainId);
  const [catalog, setCatalog] = useState<{ name: string; url: string }[]>([]);
  const [tab, setTab] = useState<'deposit' | 'swap' | 'withdraw'>('deposit');
  const [health, setHealth] = useState<Readiness | null>(null);
  const [controller, setController] = useState<Controller | null>(null);
  const [noteId, setNoteId] = useState('');
  const [input, setInput] = useState('');
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
  const [draft, setDraft] = useState<Draft | null>(null);
  const [copyMessage, setCopyMessage] = useState('');
  const [downloaded, setDownloaded] = useState(false);
  const [backedUp, setBackedUp] = useState(false);
  const [busy, setBusy] = useState('');
  const [swapPreparing, setSwapPreparing] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [networkError, setNetworkError] = useState('');
  const [, rerender] = useState(0);
  const working = useRef(false),
    syncing = useRef(false);
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
  useEffect(() => {
    fetch('/deployments.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then(setCatalog)
      .catch(() => {});
  }, []);
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
  const disabled = !!busy || !!draft || !!withdrawReview || pending;
  const latestSwap = attempts.filter((a) => a.kind === 'swap' && a.source === noteId).at(-1);
  const swapPending = swapPreparing || !!(latestSwap && isActive(latestSwap));
  const swapCompleted =
    !swapPreparing &&
    latestSwap?.state === 'confirmed' &&
    note?.pool.toLowerCase() === (reverse ? config?.outputPool : config?.pool)?.toLowerCase();
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
    setStatus('Note checked against the chain.');
  }
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
      throw new Error('Import an available note for the selected token first');
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
    setStatus('Save the new private note before continuing.');
  }
  async function submitDraft() {
    if (!draft || !downloaded || !backedUp)
      throw new Error('Save your private note and confirm the backup first');
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
        throw new Error('Switch to the Himitsu devnet before depositing');
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
      if (!health) throw new Error('Wait for a live quote');
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
        ? 'Submitted. Watching for confirmation; keep your downloaded note.'
        : 'Submission uncertain. Keep both notes and check status before retrying.',
    );
  }
  const inputAsset = reverse ? 'hUSD' : 'WETH';
  const outputAsset = reverse ? 'WETH' : 'hUSD';
  const swapReason = !note
    ? `Import a ${inputAsset} private note above to swap.`
    : noteState !== 'Available'
      ? `Note: ${noteState}.`
      : asset !== inputAsset
        ? `Import a ${inputAsset} private note for this direction.`
        : !health ||
            health.sourcePool?.toLowerCase() !==
              (reverse ? config?.outputPool : config?.pool)?.toLowerCase() ||
            (note.amount && health.inputAmount !== note.amount)
          ? 'Waiting for a live quote.'
          : health.swapIssues.join(' ');
  const noteEntry = (
    <>
      <p className="eyebrow">01 / YOUR PRIVATE BALANCE</p>
      <h2>{tab === 'withdraw' ? 'Withdraw your balance.' : 'Bring your note.'}</h2>
      <p className="muted">Import the note you saved to find your available funds.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run('Checking private note…', () => loadNote(input));
        }}
      >
        <label htmlFor="private-note">Paste your Himitsu note</label>
        <textarea
          id="private-note"
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="none"
          placeholder="himitsu-note-v1:…"
        />
        <div className="row">
          <button disabled={!input.trim() || !config || disabled}>Check note</button>
          <label className="note-upload" data-disabled={!config || disabled}>
            <span className="note-upload-icon" aria-hidden="true">
              ↑
            </span>
            <span className="note-upload-copy">
              <strong>Upload private note</strong>
              <span>Choose your saved .txt file · up to 4 KB</span>
            </span>
            <span className="note-upload-browse" aria-hidden="true">
              Browse
            </span>
            <input
              type="file"
              aria-label="Upload a private note file"
              accept=".txt,text/plain"
              disabled={!config || disabled}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file)
                  void run('Reading private note…', async () => {
                    if (file.size > 4096) throw new Error('Private note file is too large');
                    await loadNote(await file.text());
                  });
              }}
            />
          </label>
        </div>
      </form>
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
                'Note removed from this session. Encrypted transaction records remain for reconciliation.',
              );
            }}
          >
            Clear note
          </button>
        </div>
      )}
      <p className="hint">
        Notes stay secret in this client. Imported notes unlock encrypted local transaction
        records. Use one active client per note; do not retry an uncertain transaction from another
        device.
      </p>
    </>
  );
  const withdrawalFields = (
    <>
      <p className="eyebrow">02 / YOUR DESTINATION</p>

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
          <strong>Privacy warning:</strong> Withdrawing to the same address you used to deposit can
          link your deposit and withdrawal. Use a fresh address you control to reduce address-based
          linkage.
        </p>
        <p className="hint">
          The full note amount goes to this public address. WETH notes withdraw as WETH. The
          paymaster pays gas.
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
      <SiteNav page="app" />
      <main data-action={tab}>
        <TransactionNotifications
          key={config?.id ?? 'loading'}
          attempts={attempts}
          pool={config?.pool ?? ''}
          error={error}
        />

        <div className="trade-intro">
          <h1>
            {tab === 'deposit' ? (
              <>
                Make it <em>private.</em>
              </>
            ) : tab === 'swap' ? (
              <>
                Your trade. Your <em>secret.</em>
              </>
            ) : (
              <>
                Your funds. Your <em>move.</em>
              </>
            )}
          </h1>
          <p>
            {tab === 'deposit'
              ? 'Deposit ETH. Save a note. Keep control of what comes next.'
              : tab === 'swap'
                ? 'Trade through Uniswap, straight from your private balance.'
                : 'Bring your private balance back to an address you choose.'}
          </p>
        </div>
        {fixedMode && (
          <p className="hint">
            Fixed-denomination pool · Deposit 0.1 ETH, withdraw 0.1 WETH. Equal amounts reduce
            amount-based matching. Deposit and recipient addresses remain public; timing and a small
            number of users can still reveal links. Keep your note secret.
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
                {t[0].toUpperCase() + t.slice(1)}
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
              <p className="eyebrow">REVIEW YOUR WITHDRAWAL</p>
              <h2 id="withdraw-review-heading" tabIndex={-1}>
                Confirm withdrawal
              </h2>
              <p id="withdraw-review-description">
                Check the amount and recipient. Confirming will generate your proof and submit the
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
                <dt>Gas payment</dt>
                <dd>Paid by the paymaster</dd>
              </dl>
              <p className="withdraw-privacy-warning">
                <strong>Privacy warning:</strong> Using your deposit address can link your deposit
                and withdrawal. A fresh address reduces address reuse; amounts and timing can still
                reveal a connection.
              </p>
              <p className="hint">
                The full note will be spent. WETH is received as WETH, not native ETH.
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
        <div className="trade-workspace">
          {draft && (
            <NoteDialog
              busy={!!busy}
              onClose={() => {
                setDraft(null);
                setStatus('Cancelled. No transaction submitted.');
              }}
            >
              <section className="note-backup">
                <p className="eyebrow">KEEP THIS SAFE</p>
                <h2 id="backup-heading" tabIndex={-1}>
                  Your private note
                </h2>
                <p id="backup-description">
                  Back up this note. You will need it to{' '}
                  {draft.kind === 'swap'
                    ? 'spend or withdraw your swap output'
                    : 'swap or withdraw your deposit'}
                  . Treat it like a private key: anyone with this note can spend the funds. Never
                  share it, including with the Himitsu team. A lost note cannot be replaced.
                </p>
                {draft.kind === 'swap' && (
                  <p>
                    The new note recovers the actual swap output. Keep your input note too until the
                    swap confirms. If it fails, the input note remains yours.
                  </p>
                )}
                {draft.kind === 'deposit' && (
                  <p>
                    <strong>Deposit: {money(draft.note.amount ?? config!.denomination)} ETH</strong>
                  </p>
                )}
                <label htmlFor="new-note">Private note</label>
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
                        setCopyMessage(
                          'Copied. Keep it private and save the backup file before continuing.',
                        );
                      } catch {
                        setCopyMessage(
                          'Could not copy. Select the note manually or download the file.',
                        );
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
                <p className="hint" role="status">
                  {copyMessage}
                </p>
                <p className="note-filename">
                  Backup file:{' '}
                  <code>{`himitsu-${draft.kind}-${draft.note.id.slice(2, 10)}.txt`}</code>
                </p>
                <p className="hint">
                  {downloaded
                    ? 'Download requested. Check that the file was saved before confirming below.'
                    : 'Download the backup file, then confirm you have saved it safely.'}
                </p>
                <p className="note-gas-info">
                  {draft.kind === 'deposit'
                    ? 'Your connected wallet pays the deposit gas fee. Review the fee in your wallet.'
                    : 'The paymaster pays swap gas. Keep both notes until the swap is confirmed.'}
                </p>
                {draft.kind === 'deposit' &&
                  (!walletReady ||
                    account?.toLowerCase() !== draft.depositAccount?.toLowerCase()) && (
                    <p className="error">
                      The deposit wallet disconnected, changed accounts, or changed networks.
                      Restore the original wallet connection, or cancel and prepare a new deposit
                      note.
                    </p>
                  )}
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={backedUp}
                    disabled={!downloaded}
                    onChange={(e) => setBackedUp(e.target.checked)}
                  />
                  I saved the file somewhere safe and understand it controls my funds.
                </label>
                <div className="row">
                  <button
                    disabled={
                      !downloaded ||
                      !backedUp ||
                      !!busy ||
                      (draft.kind === 'deposit' &&
                        (!walletReady ||
                          account?.toLowerCase() !== draft.depositAccount?.toLowerCase()))
                    }
                    onClick={() =>
                      void run(
                        draft.kind === 'deposit'
                          ? 'Approve the deposit in your wallet…'
                          : 'Preparing private swap…',
                        submitDraft,
                      )
                    }
                  >
                    {draft.kind === 'deposit' ? 'Send deposit' : 'Confirm swap'}
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
              </section>
            </NoteDialog>
          )}
          {tab === 'deposit' ? (
            <section className="note-action">
              <p className="eyebrow">START WITH ETH</p>
              <h2>Deposit into the pool.</h2>
              <p>
                {fixedMode
                  ? 'Each note holds exactly 0.1 WETH. Save your note to withdraw later.'
                  : 'Create a private WETH note to swap or withdraw later.'}
              </p>
              <label htmlFor="deposit-amount">Amount · ETH</label>
              <input id="deposit-amount" value={config ? money(depositValue) : ''} readOnly />
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
                  ? 'This pool accepts only its fixed denomination. '
                  : 'Choose a standard deposit amount. '}
                ETH is wrapped into WETH. Your connected wallet pays deposit gas.
              </p>
              <div className="row">
                {!isConnected ? (
                  <ConnectKitButton.Custom>
                    {({ show }) => (
                      <button type="button" disabled={disabled || !show} onClick={show}>
                        Connect wallet
                      </button>
                    )}
                  </ConnectKitButton.Custom>
                ) : !walletReady ? (
                  <button
                    type="button"
                    disabled={disabled || !config}
                    onClick={() =>
                      void run('Switching wallet network…', async () => {
                        await switchChainAsync({ chainId: Number(config!.chainId) });
                      })
                    }
                  >
                    Switch network
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!account || !health || !!health.depositIssues.length || disabled}
                    onClick={() =>
                      void run('Preparing your private note…', () => prepare('deposit'))
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
              <p className="hint">
                You’ll save a private note before approving the deposit. No recovery phrase or vault
                password.
              </p>
            </section>
          ) : tab === 'swap' ? (
            <section className="combined-swap-card" aria-label="Swap from your private note">
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
                onSwap={() => void run('Preparing your output note…', () => prepare('swap'))}
              />
            </section>
          ) : (
            <section className="note-action withdrawal-card">
              {noteEntry}
              <div className="withdrawal-destination">{withdrawalFields}</div>
            </section>
          )}
        </div>
        {attempts.length > 0 && (
          <section className="trade-activity">
            <h2>Activity for this note</h2>
            <button
              className="secondary"
              disabled={!!busy || !!draft}
              onClick={() =>
                void run('Checking chain status…', async () => {
                  await controller!.refresh();
                  setHealth(controller!.health);
                })
              }
            >
              Check status
            </button>
            <ul className="journal">
              {[...attempts].reverse().map((a) => (
                <li key={a.id}>
                  <strong>
                    {a.kind} · {a.state}
                  </strong>
                  {a.hash && (
                    <>
                      <code>{a.hash}</code>
                      <a
                        href={`/explorer?tx=${a.hash}&pool=${config!.pool}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View transaction ↗
                      </a>
                    </>
                  )}
                  {a.detail && <p>{a.detail}</p>}
                  {a.output && controller!.vault.data.notes.find((n) => n.id === a.output) && (
                    <button
                      className="secondary"
                      onClick={() =>
                        download(
                          exportPrivateNote(
                            controller!.vault.data.notes.find((n) => n.id === a.output)!,
                            config!,
                          ),
                          `himitsu-output-${a.id.slice(0, 8)}.txt`,
                        )
                      }
                    >
                      Download output note again
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        <details className="trade-network">
          <summary>Pool details & network status</summary>
          <section>
            <label htmlFor="deployment">Pool deployment</label>
            <select
              id="deployment"
              value={config ? '/deployments/' + config.pool.toLowerCase() + '.json' : ''}
              disabled={disabled}
              onChange={(e) =>
                void run('Loading deployment…', async () => {
                  const r = await fetch(e.target.value, { cache: 'no-store' });
                  if (!r.ok) throw new Error('Deployment unavailable');
                  const d = await r.json();
                  setConfig(d);
                  setTab('deposit');
                  setController(null);
                  setNoteId('');
                  setReverse(false);
                  setHealth(null);
                  setInput('');
                  setHealth(null);
                  setStatus('Deployment changed. Import a note for this pool.');
                })
              }
            >
              {catalog.map((d) => (
                <option key={d.url} value={d.url}>
                  {d.name}
                </option>
              ))}
            </select>
            {config && (
              <>
                <p>
                  Chain {config.chainId} · <code>{config.rpcUrl}</code>
                </p>
                <p>
                  Input pool <code>{config.pool}</code>
                </p>
              </>
            )}
            {health ? (
              <>
                <p>
                  Verified block {health.block} · paymaster {money(health.sponsorBalance)} ETH
                </p>
                <p>
                  Swap quote: {money(health.quote)} {outputAsset} per{' '}
                  {money(health.inputAmount ?? config!.denomination)} {inputAsset}
                </p>
              </>
            ) : (
              <p>Checking network and pool liquidity…</p>
            )}
          </section>
        </details>
        <footer className="hint">
          Test assets only. Swap amounts are public. Keep private notes offline; sharing a note
          gives access to its funds.
        </footer>
      </main>
    </>
  );
}
