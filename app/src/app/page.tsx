import { SiteNav } from '../components/site-nav';
import Link from 'next/link';
import styles from './home.module.css';

function Mark() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M5 27V5h7v8h8V5h7v22h-7v-8h-8v8H5Z" fill="currentColor" />
      <path d="m13 2 6 28" stroke="var(--home-bg)" strokeWidth="2" />
    </svg>
  );
}
function Eth() {
  return (
    <svg width="24" height="38" viewBox="0 0 24 38" fill="none" aria-hidden="true">
      <path d="m12 0 12 20-12 7L0 20 12 0Z" fill="currentColor" />
      <path d="m0 23 12 7 12-7-12 15L0 23Z" fill="currentColor" />
      <path d="m12 0 12 20-12-5V0Z" fill="#999" />
    </svg>
  );
}
const faqs = [
  [
    'What is Himitsu?',
    'Himitsu is a private swap flow. Deposit into a shared privacy pool, keep your private note, and use it to trade through Uniswap V2 or withdraw your funds.',
  ],
  [
    'Why do I need a private note?',
    'Your note holds the secrets that let you spend your deposit. Save it before depositing and save the new output note before swapping. Anyone with a valid unspent note can spend it, a connected wallet cannot recover a lost note.',
  ],
  [
    'Who submits my transaction and pays for gas?',
    'Your client creates a proof and submits the frame transaction directly to the node through RPC. There is no app-operated relayer or bundler signing each spend.',
  ],
  [
    'Do I give Uniswap an allowance?',
    'No. The swap sends the exact input to a Uniswap V2 pair, rather than giving an exchange permission to pull funds from your wallet. Contracts may still use a scoped allowance when depositing output into the privacy pool.',
  ],
  [
    'Is everything about my trade private?',
    'No. Zero-knowledge proofs hide which deposit you are spending. Trade amounts, timing and onchain swap activity remain visible',
  ],
];

export default function Home() {
  return (
    <div className={styles.home}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <SiteNav page="home" />
      <main id="main" className={styles.main}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>
              <span className={styles.dot} /> PRIVATE SWAPS. OPEN LIQUIDITY.
            </p>
            <h1 id="hero-title">
              Your trade.
              <br />
              Your <span className={styles.serif}>secret.</span>
            </h1>
            <p className={styles.intro}>
              Swap from your private balance.
              <br className={styles.desktopBreak} /> Stay in control.
            </p>
            <div className={styles.actions}>
              <Link className={styles.button} href="/app" prefetch={false}>
                Try Himitsu
              </Link>
              <a className={styles.textLink} href="#how-it-works">
                See how it works
              </a>
            </div>
          </div>
          <div
            className={styles.stage}
            role="img"
            aria-label="Illustration of an ETH to hUSD private swap and a user-held private note. Not a live quote."
          >
            <div className={styles.stageGrid} />
            <span className={styles.stageLabel}>A LITTLE LESS PUBLIC.</span>
            <div className={styles.noteCard}>
              <div className={styles.previewTop}>
                <span>YOUR PRIVATE NOTE</span>
                <span>↗</span>
              </div>
              <div className={styles.noteGlyph}>秘密</div>
              <div className={styles.noteDots}>•••• •••• •••• ••••</div>
              <div className={styles.noteBottom}>
                <span>Held by you.</span>
                <span>Only you.</span>
              </div>
            </div>
            <div className={styles.swapPreview}>
              <div className={styles.previewTop}>
                <span className={styles.previewBrand}>
                  <Mark />
                  himitsu
                </span>
                <span className={styles.previewPill}>Private swap</span>
              </div>
              <div className={styles.previewPair}>
                <div>
                  <span className={styles.coin}>
                    <Eth />
                  </span>
                  <span className={styles.tokenName}>ETH</span>
                  <strong>0.1</strong>
                  <small>You send</small>
                </div>
                <span className={styles.pairArrow}>⇄</span>
                <div>
                  <span className={`${styles.coin} ${styles.darkCoin}`}>$</span>
                  <span className={styles.tokenName}>hUSD</span>
                  <strong>•••</strong>
                  <small>You receive</small>
                </div>
              </div>
              <div className={styles.previewRoute}>
                <span>Liquidity</span>
                <strong>Uniswap V2 ↗</strong>
              </div>
              <div className={styles.previewSubmit}>
                Your proof. Your permission.
              </div>
              <p className={styles.previewFoot}>No exchange allowance · No app relayer</p>
            </div>
            <span className={styles.stageCaption}>PRODUCT PREVIEW / NOT A LIVE QUOTE</span>
          </div>
        </section>
        <div className={styles.stack}>
          <span>BUILT ON OPEN PROTOCOLS</span>
          <span>
            Ethereum <small>Frame transactions EIP-8141</small>
          </span>
          <span>
            Uniswap <small>Shared liquidity</small>
          </span>
          <span>
            Zero knowledge <small>Proof, not identity</small>
          </span>
        </div>
        <section id="why-himitsu" className={styles.features} aria-labelledby="features-title">
          <div className={styles.sectionHead}>
            <p className={styles.eyebrow}>PRIVATE NOTES. DIRECT EXECUTION.</p>
            <h2 id="features-title">
              Private by proof.
              <br />
              Direct by design.
            </h2>
            <p>
              Himitsu connects a user-held private note to a real Uniswap V2 pair. Your client proves
              the spend, the pool enforces its scope, and a separate paymaster covers eligible gas.
            </p>
          </div>
          <div className={styles.featureGrid}>
            <article>
              <span className={styles.featureIcon} aria-hidden="true">
                ↗
              </span>
              <h3>No relayer or bundler service.</h3>
              <p>
                Your client builds the Groth16 proof and submits an EIP-8141 frame transaction
                directly to RPC, without an application relayer or bundler service. An onchain
                paymaster separately authorizes sponsored gas.
              </p>
              <span className={styles.featureTag}>GROTH16 · EIP-8141 · ONCHAIN SPONSOR</span>
            </article>
            <article>
              <span className={styles.featureIcon} aria-hidden="true">
                ⊘
              </span>
              <h3>Exact input to Uniswap.</h3>
              <p>
                The pool sends the authorized WETH amount straight to the Uniswap V2 pair, without
                an open exchange allowance.
              </p>
              <span className={styles.featureTag}>WETH → UNISWAP V2 → hUSD</span>
            </article>
            <article>
              <span className={styles.featureIcon} aria-hidden="true">
                ∗
              </span>
              <h3>Save and recover your output.</h3>
              <p>
                The proof hides which deposit backs your spend. Save the output note before sending;
                it recovers the actual hUSD received for later withdrawal.
              </p>
              <span className={styles.featureTag}>YOUR NOTE IS YOUR KEY · NO HOSTED INDEXER</span>
            </article>
          </div>
        </section>
        <section id="how-it-works" className={styles.how} aria-labelledby="how-title">
          <div className={styles.howHeading}>
            <p className={styles.eyebrow}>FROM ETH DEPOSIT TO PRIVATE WETH NOTE.</p>
            <h2 id="how-title">
              One note.
              <br />
              Your next move.
            </h2>
            <Link className={styles.textLink} href="/app" prefetch={false}>
              Open the app
            </Link>
          </div>
          <ol className={styles.steps}>
            <li>
              <span>01</span>
              <div>
                <h3>Deposit. Save your note.</h3>
                <p>
                  Connect your wallet to deposit 0.1 ETH. The pool wraps it to WETH, download the
                  private note before approving the deposit. The note is the key to that balance.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Swap from the pool.</h3>
                <p>
                  Import the WETH note, review the live quote and slippage, then save a fresh hUSD
                  note. Your client proves the spend, the pool swaps exact input through Uniswap V2
                  and deposits all actual output atomically.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Withdraw when you’re ready.</h3>
                <p>
                  Import the output note to recover its confirmed amount from pool events, then
                  withdraw the full balance to a recipient address. No app account or recovery
                  phrase is involved, keep your note file safe.
                </p>
              </div>
            </li>
          </ol>
        </section>
        <section id="faq" className={styles.faq} aria-labelledby="faq-title">
          <div className={styles.faqHeading}>
            <p className={styles.eyebrow}>A FEW THINGS TO KNOW.</p>
            <h2 id="faq-title">Good questions.</h2>
          </div>
          <div className={styles.faqList}>
            {faqs.map(([question, answer], i) => (
              <details key={question}>
                <summary>
                  <span className={styles.faqNumber}>0{i + 1}</span>
                  <span>{question}</span>
                  <span className={styles.plus} aria-hidden="true">
                    +
                  </span>
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section className={styles.closing} aria-labelledby="closing-title">
          <div>
            <p className={styles.eyebrow}>PUBLIC LIQUIDITY. PRIVATE POSSIBILITIES.</p>
            <h2 id="closing-title">Make your move.</h2>
            <Link className={styles.button} href="/app" prefetch={false}>
              Launch Himitsu
            </Link>
          </div>
          <span className={styles.closingGlyph} aria-hidden="true">
            秘密
          </span>
        </section>
      </main>
    </div>
  );
}
