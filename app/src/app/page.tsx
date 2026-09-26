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
function Arrow() {
  return <span aria-hidden="true">↗</span>;
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
    'Himitsu is an experimental private swap app. Deposit into a shared privacy pool, keep your private note, and use it to trade through Uniswap or withdraw your funds.',
  ],
  [
    'Why do I need a private note?',
    'Your note holds the secrets that let you spend your deposit. Save it before depositing and save the new output note before swapping. Anyone with a valid unspent note can spend it; a connected wallet cannot recover a lost note.',
  ],
  [
    'Who submits my transaction and pays for gas?',
    'Your browser creates a proof and submits the frame transaction directly to the node through RPC. There is no app-operated relayer or bundler signing each spend. The demo uses a prefunded paymaster to pay gas; gas is not free.',
  ],
  [
    'Do I give Uniswap an allowance?',
    'No. The swap sends the exact input to a Uniswap V2 pair, rather than giving an exchange permission to pull funds from your wallet. Contracts may still use a scoped allowance when depositing output into the privacy pool.',
  ],
  [
    'Is everything about my trade private?',
    'No. Zero-knowledge proofs hide which deposit you are spending. Trade amounts, timing and onchain swap activity remain visible, and an RPC provider can observe network metadata. This is a devnet prototype with test assets, not an audited product for real funds.',
  ],
];

export default function Home() {
  return (
    <div className={styles.home}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <header className={styles.nav}>
        <Link className={styles.brand} href="/" aria-label="Himitsu home">
          <Mark />
          himitsu<span className={styles.japanese}>秘密</span>
        </Link>
        <nav className={styles.navLinks} aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#why-himitsu">Why Himitsu</a>
          <a href="#faq">FAQ</a>
        </nav>
        <Link className={styles.button} href="/app" prefetch={false}>
          Launch app <Arrow />
        </Link>
      </header>
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
              A private balance. A direct path to Uniswap.
              <br className={styles.desktopBreak} /> Make your next move yours.
            </p>
            <div className={styles.actions}>
              <Link className={styles.button} href="/app" prefetch={false}>
                Try Himitsu <Arrow />
              </Link>
              <a className={styles.textLink} href="#how-it-works">
                See how it works <span aria-hidden="true">↓</span>
              </a>
            </div>
            <p className={styles.demoNote}>
              An Ethereum frame-transaction experiment. Test assets only.
            </p>
          </div>
          <div
            className={styles.stage}
            role="img"
            aria-label="Illustration of an ETH to gUSD private swap and a user-held private note. Not a live quote."
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
                  <span className={styles.tokenName}>gUSD</span>
                  <strong>•••</strong>
                  <small>You receive</small>
                </div>
              </div>
              <div className={styles.previewRoute}>
                <span>Liquidity</span>
                <strong>Uniswap V2 ↗</strong>
              </div>
              <div className={styles.previewSubmit}>
                Your proof. Your permission. <span>↗</span>
              </div>
              <p className={styles.previewFoot}>No exchange allowance · No app relayer</p>
            </div>
            <span className={styles.stageCaption}>PRODUCT PREVIEW / NOT A LIVE QUOTE</span>
          </div>
        </section>
        <div className={styles.stack}>
          <span>BUILT ON OPEN PROTOCOLS</span>
          <span>
            Ethereum <small>Frame transactions</small>
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
            <p className={styles.eyebrow}>LESS PERMISSION. MORE POSSIBILITY.</p>
            <h2 id="features-title">
              Keep control.
              <br />
              Skip the middleman.
            </h2>
            <p>
              Access public liquidity from a private balance, with permission to execute exactly
              your trade.
            </p>
          </div>
          <div className={styles.featureGrid}>
            <article>
              <span className={styles.featureIcon} aria-hidden="true">
                ↗
              </span>
              <h3>A direct route.</h3>
              <p>
                Your browser builds the proof and sends the transaction to the network. No
                application relayer or bundler needs to approve your move.
              </p>
              <span className={styles.featureTag}>BROWSER → NETWORK</span>
            </article>
            <article>
              <span className={styles.featureIcon} aria-hidden="true">
                ⊘
              </span>
              <h3>Your trade. No allowance.</h3>
              <p>
                Swap with Uniswap without giving an exchange permission to pull from your wallet.
                Only the exact input goes to the pair.
              </p>
              <span className={styles.featureTag}>EXACT INPUT. NO OPEN APPROVAL.</span>
            </article>
            <article>
              <span className={styles.featureIcon} aria-hidden="true">
                ∗
              </span>
              <h3>Prove it. Don’t reveal it.</h3>
              <p>
                A zero-knowledge proof shows you can spend a deposit without pointing to which one.
                Your note secrets stay with you.
              </p>
              <span className={styles.featureTag}>YOUR NOTE IS YOUR KEY</span>
            </article>
          </div>
        </section>
        <section id="how-it-works" className={styles.how} aria-labelledby="how-title">
          <div className={styles.howHeading}>
            <p className={styles.eyebrow}>SIMPLE ON THE SURFACE.</p>
            <h2 id="how-title">
              One note.
              <br />
              Your next move.
            </h2>
            <Link className={styles.textLink} href="/app" prefetch={false}>
              Explore the demo <Arrow />
            </Link>
          </div>
          <ol className={styles.steps}>
            <li>
              <span>01</span>
              <div>
                <h3>Deposit. Save your note.</h3>
                <p>
                  Put ETH into the shared pool and save your private note. It’s your key to spending
                  that balance.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Swap from the pool.</h3>
                <p>
                  Import your note, choose your trade, and save the output note. Your browser proves
                  the spend; Uniswap executes the swap.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Withdraw when you’re ready.</h3>
                <p>
                  Use your unspent note to find your balance and withdraw to a recipient address. No
                  account or recovery phrase to create.
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
              Launch Himitsu <Arrow />
            </Link>
          </div>
          <span className={styles.closingGlyph} aria-hidden="true">
            秘密
          </span>
        </section>
      </main>
      <footer className={styles.footer}>
        <Link className={styles.brand} href="/" aria-label="Himitsu home">
          <Mark />
          himitsu
        </Link>
        <span>Your trade. Your secret.</span>
        <div>
          <a href="#how-it-works">How it works</a>
          <a href="#faq">FAQ</a>
          <Link href="/app" prefetch={false}>
            Open demo ↗
          </Link>
        </div>
        <p>Experimental devnet prototype · Test assets only · Not audited</p>
      </footer>
    </div>
  );
}
