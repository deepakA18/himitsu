'use client';
import { useEffect, useRef } from 'react';

type Props = {
  inputAsset: 'WETH' | 'hUSD';
  outputAsset: 'WETH' | 'hUSD';
  onReverse: () => void;
  privateNoteMode?: boolean;
  inputAmount: string;
  outputAmount: string;
  balance: string;
  notes: { id: string; label: string }[];
  selected: string;
  onSelect: (id: string) => void;
  slippage: string;
  onSlippage: (value: string) => void;
  minimum: string;
  recipient: string;
  onRecipient: (value: string) => void;
  market: boolean;
  locked: boolean;
  busy: boolean;
  rolling: boolean;
  completed?: boolean;
  animationKey?: string;
  settledOutput?: string;
  status: string;
  error: string;
  reason: string;
  disabled: boolean;
  onSwap: () => void;
};

export function SwapPanel(p: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const progress = useRef(0);
  const previousKey = useRef(p.animationKey);
  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    if (previousKey.current !== p.animationKey) {
      previousKey.current = p.animationKey;
      progress.current = 0;
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    const start = performance.now(),
      from = progress.current;
    const paint = (value: number) => {
      progress.current = value;
      // Match the two visible cubic SVG tracks exactly, at any container width.
      const u = 1 - value;
      const x =
        88 * u ** 3 + 3 * 150 * u ** 2 * value + 3 * 250 * u * value ** 2 + 312 * value ** 3;
      node.style.setProperty('--coin-x', `${x / 4}%`);
      node.style.setProperty('--coin-lift', `${240 * value * u}px`);
      node.style.setProperty('--coin-turn', `${value * 360}deg`);
    };
    const tick = (now: number) => {
      const elapsed = now - start;
      if (reduced.matches) {
        paint(p.completed ? 1 : 0);
        return;
      }
      if (p.rolling) {
        // Illustrative motion, not a transaction progress estimate. Never reaches
        // the final position until the canonical journal confirms the swap.
        const value = from + (0.88 - from) * (1 - Math.exp(-elapsed / 18000));
        paint(value);
      } else {
        const t = Math.min(elapsed / (p.completed ? 1400 : 500), 1);
        paint(from + ((p.completed ? 1 : 0) - from) * (1 - Math.pow(1 - t, 3)));
        if (t === 1) return;
      }
      frame = requestAnimationFrame(tick);
    };
    const onPreference = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    };
    reduced.addEventListener('change', onPreference);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      reduced.removeEventListener('change', onPreference);
    };
  }, [p.rolling, p.completed, p.animationKey]);
  return (
    <section className="swap-card" aria-labelledby="swap-heading">
      <div className="swap-heading">
        <div>
          <p className="eyebrow">02 / SWAP AND WITHDRAW</p>
          <h2 id="swap-heading">{p.completed ? 'Swap and withdrawal confirmed.' : 'Swap and withdraw.'}</h2>
        </div>
        <span className="badge">Uniswap V2</span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!p.disabled) p.onSwap();
        }}
      >
        <div
          ref={stage}
          className="swap-stage animated-swap-stage"
          data-moving={p.rolling}
          data-complete={!!p.completed}
        >
          <div className="swap-route">
            <div className="route-caption">
              <span>YOUR SWAP</span>
              <span>
                {p.completed
                  ? 'Arrived ✓'
                  : p.rolling
                    ? 'In motion · awaiting confirmation'
                    : `${p.inputAsset} → ${p.outputAsset}`}
              </span>
            </div>
            <div className="coin-track" aria-hidden="true">
              <svg
                className="coin-route-lines"
                viewBox="0 0 400 180"
                preserveAspectRatio="none"
                fill="none"
              >
                <path
                  className="route-rail"
                  d="M88 90 C150 10 250 10 312 90"
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  className="route-rail route-rail-return"
                  d="M312 90 C250 170 150 170 88 90"
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  className="route-direction"
                  d="m196 25 6 5-6 5 M204 145l-6 5 6 5"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <span className="coin-dock dock-left" />
              <span className="coin-dock dock-right" />
              <div className="coin-carrier coin-from">
                <TokenCoin asset={p.inputAsset} />
              </div>
              <div className="coin-carrier coin-to">
                <TokenCoin asset={p.outputAsset} />
              </div>
            </div>
            <div className="route-destinations">
              <span>
                {p.completed ? `${p.outputAsset} received` : `${p.inputAsset} starts here`}
              </span>
              <span>{p.completed ? `${p.inputAsset} spent` : `${p.outputAsset} starts here`}</span>
            </div>
          </div>
          <button
            className="swap-direction-toggle"
            type="button"
            onClick={p.onReverse}
            disabled={p.busy || p.rolling}
            aria-label={`Switch to ${p.outputAsset} to ${p.inputAsset}`}
            title={`Switch to ${p.outputAsset} to ${p.inputAsset}`}
          >
            <span>Switch pair</span>
          </button>
          <div className="swap-amount-panel">
            <span className="swap-token-name">{p.completed ? p.outputAsset : p.inputAsset}</span>
            <label htmlFor="swap-input">{p.completed ? 'You received' : 'You pay'}</label>
            <input
              id="swap-input"
              type="text"
              inputMode="decimal"
              readOnly
              value={p.completed ? p.settledOutput || '—' : p.inputAmount}
              aria-describedby="swap-input-hint"
            />
            <p id="swap-input-hint" className="hint">
              {p.completed ? 'Your new saved file' : 'From your saved file'}
            </p>
          </div>
          <div className="swap-amount-panel receive-panel">
            <span className="swap-token-name">{p.completed ? p.inputAsset : p.outputAsset}</span>
            <label htmlFor="swap-output">
              {p.completed ? 'You spent' : `You receive${p.market ? ' ≈' : ''}`}{' '}
            </label>
            <input
              id="swap-output"
              type="text"
              inputMode="decimal"
              readOnly
              value={p.completed ? p.inputAmount : p.outputAmount}
              placeholder="—"
              aria-describedby="swap-output-hint"
            />
            <p id="swap-output-hint" className="hint">
              {p.completed
                ? 'Input note spent'
                : p.outputAmount
                  ? 'Into your new saved file'
                  : 'Waiting for a quote'}
            </p>
          </div>
        </div>
        {!p.privateNoteMode && (
          <>
            <div className="swap-balance">
              <span>Available balance</span>
              <strong>{p.locked ? 'Unlock to view' : `${p.balance} ${p.inputAsset}`}</strong>
            </div>
            <label htmlFor="swap-note">Use these funds</label>
            <select
              id="swap-note"
              value={p.selected}
              onChange={(e) => p.onSelect(e.target.value)}
              disabled={p.locked || p.busy || !p.notes.length}
            >
              <option value="">
                {p.locked
                  ? 'Connect your wallet'
                  : p.notes.length
                    ? 'Choose saved funds'
                    : `No saved ${p.inputAsset} funds`}
              </option>
              {p.notes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
          </>
        )}
        {!p.completed && (
          <div className="swap-settings">
            <div>
              <label htmlFor="slippage">Price movement limit</label>
              <select
                id="slippage"
                value={p.slippage}
                onChange={(e) => p.onSlippage(e.target.value)}
                disabled={p.busy || !p.market}
              >
                <option value="10">0.1%</option>
                <option value="50">0.5%</option>
                <option value="100">1%</option>
              </select>
            </div>
            <div className="swap-minimum">
              <span className="hint">At least</span>
              <strong>{p.minimum ? `${p.minimum} ${p.outputAsset}` : '—'}</strong>
            </div>
          </div>
        )}
        {!p.completed && (
          <div className="swap-recipient">
            <label htmlFor="swap-recipient">Send output to</label>
            <input
              id="swap-recipient"
              value={p.recipient}
              onChange={(e) => p.onRecipient(e.target.value)}
              placeholder="Recipient address · 0x…"
              autoComplete="off"
              spellCheck={false}
              disabled={p.busy}
            />
            <p className="withdraw-privacy-warning">
              The swap output goes to this public address; it is not placed in another private pool.
            </p>
          </div>
        )}
        <button className="swap-submit" type="submit" disabled={p.disabled} aria-busy={p.rolling}>
          {p.rolling
            ? 'Swapping and withdrawing…'
            : p.completed
              ? 'Swap confirmed'
              : `Swap and withdraw ${p.outputAsset}`}
        </button>
        <p className="swap-feedback" role="status" aria-live="polite">
          {p.status || p.reason || 'Ready when you are.'}
        </p>
        {p.error && <p className="error">{p.error}</p>}
        <div className="swap-benefits">
          <span>Only the approved amount goes to Uniswap</span>
          <span>Network fee covered by sponsor</span>
        </div>
      </form>
    </section>
  );
}

function TokenCoin({ asset }: { asset: 'WETH' | 'hUSD' }) {
  return asset === 'WETH' ? (
    <div className="token-coin eth-coin">
      <svg viewBox="0 0 32 48" fill="none">
        <path d="M16 2 2 24l14 8 14-8L16 2Z" fill="currentColor" />
        <path d="m2 27 14 19 14-19-14 8L2 27Z" fill="currentColor" />
        <path d="M16 2v30l14-8L16 2Z" fill="var(--coin-facet)" />
      </svg>
    </div>
  ) : (
    <div className="token-coin usd-coin">
      <span>$</span>
    </div>
  );
}
