'use client';
import { useEffect, useRef, useState } from 'react';
import { formatUnits } from 'viem';
import { ConnectKitButton } from 'connectkit';
import { useAccount, useConfig, useSwitchChain } from 'wagmi';
import { getAccount } from 'wagmi/actions';
import { guardDepositWallet } from '../lib/deposit-wallet';
import { useWalletDeployment } from '../components/wallet-provider';
import { Controller, Vault, IndexedVaultStore, type Wallet } from '../lib/controller';
import { SwapPanel } from '../components/swap-panel';
import {
  createPrivateNote,
  exportPrivateNote,
  importPrivateNote,
  privateNoteCacheKey,
} from '../../../packages/client/src/private-note';
import type { SavedNote } from '../../../packages/client/src/notes';
import type { Deployment } from '../../../packages/client/src/chain';
import { readiness, minimumOutput, type Readiness } from '../../../packages/client/src/market';
import { isActive } from '../../../packages/client/src/vault';
import { RpcClient } from '../../../packages/client/src/index';
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
  const [slippage, setSlippage] = useState('50');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [backedUp, setBackedUp] = useState(false);
  const [busy, setBusy] = useState('');
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
        const checked = controller
          ? (await controller.refresh(), controller.health!)
          : await readiness(new RpcClient(config.rpcUrl), config);
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
  }, [config, controller]);
  const note = controller?.vault.data.notes.find((n) => n.id === noteId);
  const noteState = note ? controller!.noteState(note) : '';
  const attempts = controller?.vault.data.attempts ?? [];
  const pending = attempts.some(isActive);
  const disabled = !!busy || !!draft || pending;
  const swapPending =
    (!!busy && busy.toLowerCase().includes('proof')) ||
    attempts.some(
      (a) => a.kind === 'swap' && ['broadcasting', 'submitted', 'mined'].includes(a.state),
    );
  const asset = note?.pool.toLowerCase() === config?.pool.toLowerCase() ? 'WETH' : 'gUSD';
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
    setInput('');
    setStatus('Note checked against the chain.');
  }
  async function prepare(kind: 'deposit' | 'swap') {
    if (!config) throw new Error('Wait for the deployment to load');
    const n = createPrivateNote(config, kind === 'deposit' ? config.pool : config.outputPool);
    const c = kind === 'deposit' ? await session(n, false) : controller!;
    if (!c || (kind === 'swap' && (!note || noteState !== 'Available')))
      throw new Error('Import an available WETH note first');
    setDraft({
      kind,
      note: n,
      text: exportPrivateNote(n, config),
      controller: c,
      source: noteId,
      ...(kind === 'deposit' && account ? { depositAccount: account } : {}),
    });
    setDownloaded(false);
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
    }
    setController(current.controller);
    setStatus(
      result.state === 'submitted'
        ? 'Submitted. Watching for confirmation; keep your downloaded note.'
        : 'Submission uncertain. Keep both notes and check status before retrying.',
    );
  }
  const swapReason = !note
    ? 'Import a WETH private note above to swap.'
    : noteState !== 'Available'
      ? `Note: ${noteState}.`
      : asset !== 'WETH'
        ? 'This pool supports WETH → gUSD. You can withdraw this gUSD note.'
        : !health
          ? 'Waiting for a live quote.'
          : health.swapIssues.join(' ');
  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">LOCAL DEVNET · TEST ASSETS</p>
          <h1>Himitsu</h1>
          <p className="muted">Private notes. Permissionless swaps.</p>
        </div>
      </header>
      <nav className="note-tabs" aria-label="Actions">
        {(['deposit', 'swap', 'withdraw'] as const).map((t) => (
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
      {draft && (
        <section className="note-backup" aria-labelledby="backup-heading">
          <h2 id="backup-heading">
            Save your {draft.kind === 'swap' ? 'new gUSD' : 'deposit'} note
          </h2>
          <p>
            This file is the key to your funds. Anyone who has it can spend them. Himitsu cannot
            replace a lost note.
          </p>
          {draft.kind === 'swap' && (
            <p>
              The new note recovers the actual swap output. Keep your input note too until the swap
              confirms. If it fails, the input note remains yours.
            </p>
          )}
          <button
            onClick={() => {
              download(draft.text, `himitsu-${draft.kind}-${draft.note.id.slice(2, 10)}.txt`);
              setDownloaded(true);
            }}
          >
            Download private note
          </button>
          <details>
            <summary>Show private note</summary>
            <label htmlFor="new-note">Secret note — keep private</label>
            <textarea
              id="new-note"
              value={draft.text}
              readOnly
              rows={5}
              spellCheck={false}
              autoComplete="off"
            />
          </details>
          {draft.kind === 'deposit' &&
            (!walletReady || account?.toLowerCase() !== draft.depositAccount?.toLowerCase()) && (
              <p className="error">
                The deposit wallet disconnected, changed accounts, or changed networks. Restore the
                original connection below, or cancel and prepare a new deposit note.
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
                  (!walletReady || account?.toLowerCase() !== draft.depositAccount?.toLowerCase()))
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
              Continue with {draft.kind}
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
      )}
      {tab === 'deposit' ? (
        <section className="note-action">
          <h2>Deposit ETH</h2>
          <p>Create a private WETH note to swap or withdraw later.</p>
          <label htmlFor="deposit-amount">Amount · ETH</label>
          <input id="deposit-amount" value={config ? money(config.denomination) : ''} readOnly />
          <p className="hint">
            Fixed-size deposit. ETH is wrapped into WETH. Your connected wallet pays deposit gas.
          </p>
          <div className="row">
            <ConnectKitButton.Custom>
              {({ show, isConnected, truncatedAddress }) => (
                <button
                  type="button"
                  className="secondary"
                  disabled={!!busy || !show}
                  onClick={show}
                >
                  {isConnected ? truncatedAddress : 'Connect wallet'}
                </button>
              )}
            </ConnectKitButton.Custom>
            {isConnected && !walletReady && (
              <button
                className="secondary"
                disabled={!!busy}
                onClick={() =>
                  void run('Switching wallet network…', async () => {
                    await switchChainAsync({ chainId: Number(config!.chainId) });
                  })
                }
              >
                Switch to Himitsu devnet
              </button>
            )}
            <button
              disabled={
                !walletReady || !account || !health || !!health.depositIssues.length || disabled
              }
              onClick={() => void run('Preparing your private note…', () => prepare('deposit'))}
            >
              Create deposit note
            </button>
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
      ) : (
        <>
          <section className="note-action">
            <h2>Use a private note</h2>
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
                <label className="file">
                  Or import a note file
                  <input
                    type="file"
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
                      : money(
                          asset === 'WETH' ? config!.denomination : config!.outputDenomination,
                        )}{' '}
                  {asset}
                </strong>
                <span>{noteState}</span>
                <button
                  className="secondary"
                  disabled={disabled}
                  onClick={() => {
                    setController(null);
                    setNoteId('');
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
              Notes stay secret in this browser. Imported notes unlock encrypted local transaction
              records. Use one active browser per note; do not retry an uncertain transaction from
              another device.
            </p>
          </section>
          {tab === 'swap' ? (
            <SwapPanel
              privateNoteMode
              inputAmount={money(config?.denomination ?? '100000000000000000')}
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
              status={busy || attempts.filter((a) => a.kind === 'swap').at(-1)?.state || ''}
              error=""
              reason={swapReason}
              disabled={disabled || !!swapReason}
              onSwap={() => void run('Preparing your output note…', () => prepare('swap'))}
            />
          ) : (
            <section className="note-action">
              <h2>Withdraw</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run('Preparing withdrawal…', async () => {
                    const a = await controller!.spend(noteId, 'withdraw', recipient, setBusy);
                    setStatus(`Withdrawal ${a.state}. Watching the chain automatically.`);
                  });
                }}
              >
                <label htmlFor="recipient">Recipient address</label>
                <input
                  id="recipient"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="0x…"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={disabled}
                />
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
            </section>
          )}
        </>
      )}
      {attempts.length > 0 && (
        <section>
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
                {a.hash && <code>{a.hash}</code>}
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
      <details>
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
                setController(null);
                setNoteId('');
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
                Swap quote: {money(health.quote)} gUSD per {money(config!.denomination)} WETH
              </p>
            </>
          ) : (
            <p>Checking network and pool liquidity…</p>
          )}
        </section>
      </details>
      <footer className="hint">
        Test assets only. Swap amounts are public. Keep private notes offline; sharing a note gives
        access to its funds.
      </footer>
    </main>
  );
}
