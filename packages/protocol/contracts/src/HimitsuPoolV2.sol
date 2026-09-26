// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IHasher {
    function poseidon(bytes32[2] calldata input) external pure returns (bytes32);
}

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IWETH is IERC20 {
    function deposit() external payable;
}

interface IPair {
    function getReserves() external view returns (uint112,uint112,uint32);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

interface IGhostPool {
    function depositTokenAmount(bytes32 tag, uint256 amount) external returns (uint32);
    function token() external view returns (IERC20);
    function denomination() external view returns (uint256);
}

/// @title HimitsuPoolV2 -- an amount-bound note pool that is ALSO an
/// EIP-8141 account.
///
/// The pool is the transaction's `sender`, so a SENDER frame executes AS THE
/// POOL. That is what makes the design work and also what makes it dangerous:
///
///   APPROVE GRANTS AUTHORITY OVER THE TRANSACTION, NOT OVER ONE CALL.
///
/// Binding the proof to sig_hash stops an already-proved transaction from being
/// altered. It does not stop a note owner from proving a malicious transaction
/// in the first place -- they can run the prover over any transaction they like.
/// Without `_requireSanctionedLayout`, a valid proof for one 0.1 WETH note
/// authorises the pool to execute ANY call, including
/// `WETH.transfer(attacker, entirePoolBalance)`. `attack.mjs` demonstrates
/// exactly that against the version of this contract that lacked the check.
///
/// So validation does two things, and needs both:
///   1. verifies the Groth16 proof (ownership + membership + this transaction)
///   2. requires the transaction to contain exactly ONE execution frame, which
///      must target this pool and call one of two sanctioned entry points
///
/// Everything a spend needs to do -- pay out, swap, mint the output note -- is
/// therefore inside a single pool function that runs atomically, rather than
/// spread over frames that would each have to be validated.
contract HimitsuPoolV2 {
    uint32 public constant LEVELS = 10;
    uint32 public constant ROOT_HISTORY_SIZE = 30;
    /// Bounds the introspection loops below, so a spend's gas cannot be blown up
    /// by padding the transaction with frames.
    uint256 public constant MAX_FRAMES = 8;
    uint256 private constant FIELD_SIZE =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 private constant ZERO_VALUE =
        uint256(keccak256("himitsu.empty.leaf")) %
            21888242871839275222246405745257275088548364400416034343698204186575808495617;

    // TXPARAM ids
    uint256 private constant TX_FRAME_COUNT = 0x09;
    uint256 private constant TX_CURRENT_FRAME = 0x0A;
    // FRAMEPARAM ids
    uint256 private constant FP_TARGET = 0x00;
    uint256 private constant FP_MODE = 0x02;
    uint256 private constant FP_STATUS = 0x05;
    uint256 private constant FP_SCOPE = 0x06;
    // EIP-8141 execution modes
    uint256 private constant MODE_DEFAULT = 0;
    uint256 private constant MODE_VERIFY = 1;
    uint256 private constant MODE_SENDER = 2;
    uint256 private constant APPROVE_EXECUTION = 0x02;

    /// The only two calls a spend may make. Anything else fails validation.
    bytes4 private constant SEL_SPEND = bytes4(keccak256("spend()"));
    bytes4 private constant SEL_SPEND_AND_SWAP =
        bytes4(keccak256("spendAndSwapQuoted(address,uint256,address,bytes32)"));

    IHasher public immutable hasher;
    IERC20 public immutable token;
    /// True for the WETH pool, which can take ETH deposits and wrap them.
    bool public immutable wrapsEth;
    uint256 public immutable denomination;
    address public immutable spendValidator;
    address public immutable introspector;

    bytes32[LEVELS] public filledSubtrees;
    bytes32[LEVELS] public zeros;
    uint32 public nextIndex;
    uint32 public currentRootIndex;
    bytes32[ROOT_HISTORY_SIZE] public rootHistory;
    mapping(bytes32 => bool) public isKnownRoot;
    mapping(bytes32 => bool) public spent;
    mapping(bytes32 => bool) public commitments;
    mapping(bytes32 => bool) public usedTags;

    /// Tokens backing outstanding notes. Unsolicited transfers never mint credit.
    uint256 public accounted;

    event DepositV2(bytes32 indexed commitment, uint32 leafIndex, bytes32 root, bytes32 recoveryTag, uint256 amount);
    event Spent(bytes32 indexed nullifierHash, address indexed recipient, uint256 amount);

    constructor(
        IHasher _hasher,
        IERC20 _token,
        bool _wrapsEth,
        uint256 _denomination,
        address _spendValidator,
        address _introspector
    ) {
        hasher = _hasher;
        token = _token;
        wrapsEth = _wrapsEth;
        denomination = _denomination;
        spendValidator = _spendValidator;
        introspector = _introspector;

        bytes32 current = bytes32(ZERO_VALUE);
        for (uint32 i = 0; i < LEVELS; i++) {
            zeros[i] = current;
            filledSubtrees[i] = current;
            current = _hashPair(current, current);
        }
        rootHistory[0] = current;
        isKnownRoot[current] = true;
    }

    /// Plain ETH, so the pool can hold gas money. Carries no calldata and so
    /// never reaches the validation path.
    receive() external payable {}

    // ------------------------------------------------------------- deposit

    function _checkAmount(uint256 amount) private view {
        require(amount > 0 && amount <= type(uint128).max, "amount: outside range");
        require(denomination == 0 || amount == denomination, "amount: wrong denomination");
    }
    function depositETH(bytes32 recoveryTag) external payable nonReentrant returns (uint32) {
        require(wrapsEth, "deposit: not an ETH pool");
        _checkAmount(msg.value);
        IWETH(address(token)).deposit{value: msg.value}();
        accounted += msg.value;
        return _insertAmount(recoveryTag, msg.value);
    }
    function depositTokenAmount(bytes32 recoveryTag, uint256 amount) external nonReentrant returns (uint32) {
        _checkAmount(amount);
        uint256 beforeBalance = token.balanceOf(address(this));
        require(token.transferFrom(msg.sender, address(this), amount), "deposit: transfer failed");
        require(token.balanceOf(address(this)) == beforeBalance + amount, "deposit: wrong received amount");
        accounted += amount;
        return _insertAmount(recoveryTag, amount);
    }
    function _insertAmount(bytes32 recoveryTag, uint256 amount) private returns (uint32 index) {
        require(uint256(recoveryTag) < FIELD_SIZE && !usedTags[recoveryTag], "deposit: invalid or reused tag");
        usedTags[recoveryTag] = true;
        bytes32 commitment = _hashPair(recoveryTag, bytes32(amount));
        index = _insertNote(commitment);
        emit DepositV2(commitment, index, getLastRoot(), recoveryTag, amount);
    }

    /// Legacy entry point deliberately fails closed: a donation conveys no note ownership.
    function depositCredited(bytes32) external pure returns (uint32) {
        revert("deposit: use depositToken");
    }

    // Transient storage is available on the pinned Prague/Hegota development chain.
    modifier nonReentrant() {
        assembly { if tload(0) { revert(0, 0) } tstore(0, 1) }
        _;
        assembly { tstore(0, 0) }
    }

    function _insertNote(bytes32 commitment) private returns (uint32 leafIndex) {
        require(uint256(commitment) < FIELD_SIZE, "deposit: noncanonical commitment");
        require(!commitments[commitment], "deposit: duplicate commitment");
        commitments[commitment] = true;
        leafIndex = _insert(commitment);

    }

    // ---------------------------------------------- EIP-8141 VERIFY frame

    /// Entry point for the VERIFY frame. Static, so it may check state but
    /// change none; the nullifier is marked spent later, during execution.
    function validateSpend(bytes32 root, bytes32 nullifierHash, address recipient, uint256 amount) external {
        _checkAmount(amount);
        require(isKnownRoot[root], "validate: unknown root");
        require(!spent[nullifierHash], "validate: already spent");
        require(recipient != address(0), "validate: no recipient");

        // Constrain WHAT the approval will authorise before granting it.
        _requireSanctionedLayout();

        // delegatecall keeps `to` == address(this), which is what makes the
        // APPROVE inside the validator legal: APPROVE requires the executing
        // contract to be the frame's target.
        (bool ok, ) = spendValidator.delegatecall(msg.data);
        require(ok, "validate: proof rejected");
    }

    /// Require the transaction to consist of validation frames plus exactly one
    /// execution frame, and require that frame to be a call into this pool's
    /// sanctioned entry points.
    ///
    /// DEFAULT frames are refused outright. They execute as ENTRY_POINT rather
    /// than as the pool, so they cannot move the pool's tokens, but they spend
    /// gas the pool is paying for and there is no reason a spend needs one.
    function _requireSanctionedLayout() private view {
        uint256 frameCount = _txParam(TX_FRAME_COUNT);
        require(frameCount <= MAX_FRAMES, "layout: too many frames");

        uint256 senderFrames = 0;
        for (uint256 i = 0; i < frameCount; i++) {
            uint256 mode = _frameParam(i, FP_MODE);
            require(mode != MODE_DEFAULT, "layout: DEFAULT frame");
            if (mode != MODE_SENDER) continue; // a VERIFY frame: static, harmless

            senderFrames += 1;
            require(senderFrames == 1, "layout: more than one execution frame");
            require(
                address(uint160(_frameParam(i, FP_TARGET))) == address(this),
                "layout: execution frame leaves the pool"
            );
            bytes4 selector = bytes4(_frameData(i, 0));
            require(
                selector == SEL_SPEND || selector == SEL_SPEND_AND_SWAP,
                "layout: selector not sanctioned"
            );
        }
        require(senderFrames == 1, "layout: no execution frame");
    }

    // ---------------------------------------------- EIP-8141 SENDER frame

    /// Withdraw the note authorised by this transaction's verification frame.
    function spend() external nonReentrant {
        (bytes32 nullifierHash, address recipient, uint256 amount) = _settle();
        _payOut(recipient, amount);
        emit Spent(nullifierHash, recipient, amount);
    }

    /// Spend a note straight into a swap, and mint the output as a new note in
    /// `outPool` -- all in one call, so there is no intermediate holder, no
    /// persistent allowance, and nothing to roll back separately.
    ///
    /// The arguments are not proof signals, but they are covered by sig_hash,
    /// which the proof commits to: changing any of them invalidates the proof.
    /// `pair` is additionally required to equal the recipient the proof names.
    /// Exact-input swap: the entire live AMM output becomes one amount-bound note.
    /// minOut and recoveryTag are covered by the proof's transaction digest.
    function spendAndSwapQuoted(address pair, uint256 minOut, address outPool, bytes32 recoveryTag) external nonReentrant {
        (bytes32 nullifierHash, address recipient, uint256 inputAmount) = _settle();
        require(pair == recipient, "swap: pair is not proved recipient");
        IERC20 outputToken = IGhostPool(outPool).token();
        require(address(outputToken) != address(token), "swap: same token");
        (bool inputIs0, uint256 outputAmount) = _quote(pair, address(outputToken), inputAmount);
        require(outputAmount > 0 && outputAmount >= minOut, "swap: slippage exceeded");
        uint256 beforeBalance = outputToken.balanceOf(address(this));
        _payOut(pair, inputAmount);
        IPair(pair).swap(inputIs0 ? 0 : outputAmount, inputIs0 ? outputAmount : 0, address(this), "");
        require(outputToken.balanceOf(address(this)) == beforeBalance + outputAmount, "swap: wrong output");
        require(outputToken.approve(outPool, outputAmount), "swap: approve failed");
        IGhostPool(outPool).depositTokenAmount(recoveryTag, outputAmount);
        require(outputToken.approve(outPool, 0), "swap: clear approval failed");
        require(outputToken.balanceOf(address(this)) == beforeBalance, "swap: output not consumed");
        emit Spent(nullifierHash, pair, inputAmount);
    }

    function _quote(address pair, address outputToken, uint256 inputAmount) private view returns (bool inputIs0, uint256 outputAmount) {
        inputIs0 = IPair(pair).token0() == address(token);
        require((inputIs0 ? IPair(pair).token1() : IPair(pair).token0()) == outputToken, "swap: wrong output token");
        require((inputIs0 ? IPair(pair).token0() : IPair(pair).token1()) == address(token), "swap: wrong input token");
        (uint112 reserve0, uint112 reserve1,) = IPair(pair).getReserves();
        uint256 reserveIn = inputIs0 ? reserve0 : reserve1;
        uint256 reserveOut = inputIs0 ? reserve1 : reserve0;
        require(reserveIn > 0 && reserveOut > 0, "swap: no liquidity");
        uint256 amountWithFee = inputAmount * 997;
        outputAmount = amountWithFee * reserveOut / (reserveIn * 1000 + amountWithFee);
    }

    /// Shared prologue: only reachable from a SENDER frame of this pool's own
    /// transaction, and consumes the nullifier exactly once.
    function _settle() private returns (bytes32 nullifierHash, address recipient, uint256 amount) {
        require(msg.sender == address(this), "spend: not a SENDER frame");

        uint256 verifyFrame = _findVerificationFrame();
        // Offsets are past the 4-byte selector of validateSpend(...).
        nullifierHash = _frameData(verifyFrame, 36);
        recipient = address(uint160(uint256(_frameData(verifyFrame, 68))));

        amount = uint256(_frameData(verifyFrame, 100));
        _checkAmount(amount);

        // Validation checked this too, but validation ran before any execution
        // frame: two execution frames in one transaction would both pass that
        // check and only this one stops the second. (The layout rule now allows
        // just one, so this is defence in depth rather than the only guard.)
        require(!spent[nullifierHash], "spend: already spent");
        spent[nullifierHash] = true;
    }

    function _payOut(address to, uint256 amount) private {
        accounted -= amount;
        require(token.transfer(to, amount), "spend: transfer failed");
    }

    /// Locate the VERIFY frame that authorised this spend.
    ///
    /// NOT hardcoded to frame 0: EIP-8141 lets an expiry-verifier frame precede
    /// the validation prefix, which shifts everything down by one. Scanning for
    /// "a VERIFY frame targeting this pool" keeps the contract working under any
    /// prefix layout, and requiring exactly one keeps it unambiguous.
    ///
    /// Only frames before the current one are examined: FRAMEPARAM's status is
    /// an exceptional halt for the current or a later frame.
    function _findVerificationFrame() private view returns (uint256) {
        uint256 current = _txParam(TX_CURRENT_FRAME);
        require(current <= MAX_FRAMES, "layout: too many frames");

        uint256 found = type(uint256).max;
        for (uint256 i = 0; i < current; i++) {
            if (_frameParam(i, FP_MODE) != MODE_VERIFY) continue;
            if (address(uint160(_frameParam(i, FP_TARGET))) != address(this)) continue;
            require(found == type(uint256).max, "spend: ambiguous verification frames");
            require(_frameParam(i, FP_STATUS) == 1, "spend: verification frame failed");
            require(
                _frameParam(i, FP_SCOPE) & APPROVE_EXECUTION != 0,
                "spend: verification granted no execution"
            );
            found = i;
        }
        require(found != type(uint256).max, "spend: no verification frame");
        return found;
    }

    // ------------------------------------------------------ introspection

    function _txParam(uint256 id) private view returns (uint256) {
        return uint256(_ask(0, id, 0));
    }

    function _frameParam(uint256 index, uint256 param) private view returns (uint256) {
        return uint256(_ask(1, index, param));
    }

    function _frameData(uint256 index, uint256 offset) private view returns (bytes32) {
        return _ask(2, index, offset);
    }

    /// The introspector takes three raw words and no selector; it is ~100 bytes
    /// of assembly, so a dispatcher would cost more than the opcodes it wraps.
    function _ask(uint256 op, uint256 a, uint256 b) private view returns (bytes32 out) {
        address target = introspector;
        uint256[3] memory args = [op, a, b];
        uint256 success;
        assembly ("memory-safe") {
            // Literal gas: during validation the GAS opcode is legal only
            // immediately before a *CALL. See SpendVerifier.sol.
            success := staticcall(30000, target, args, 96, args, 32)
            out := mload(args)
        }
        require(success == 1, "introspection failed");
    }

    // -------------------------------------------------------- merkle tree

    function _hashPair(bytes32 left, bytes32 right) private view returns (bytes32) {
        return hasher.poseidon([left, right]);
    }

    function _insert(bytes32 leaf) private returns (uint32 index) {
        index = nextIndex;
        require(index < uint32(2) ** LEVELS, "tree is full");

        uint32 currentIndex = index;
        bytes32 currentHash = leaf;
        for (uint32 i = 0; i < LEVELS; i++) {
            bytes32 left;
            bytes32 right;
            if (currentIndex % 2 == 0) {
                left = currentHash;
                right = zeros[i];
                filledSubtrees[i] = currentHash;
            } else {
                left = filledSubtrees[i];
                right = currentHash;
            }
            currentHash = _hashPair(left, right);
            currentIndex /= 2;
        }

        uint32 newRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        currentRootIndex = newRootIndex;
        rootHistory[newRootIndex] = currentHash;
        isKnownRoot[currentHash] = true;
        nextIndex = index + 1;
    }

    function getLastRoot() public view returns (bytes32) {
        return rootHistory[currentRootIndex];
    }
}
