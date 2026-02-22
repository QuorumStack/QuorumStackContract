;; title: QuorumStack Multisig Wallet
;; version: 1.0.0
;; summary: A decentralized M-of-N multisignature wallet on the Stacks blockchain.
;; description:
;;   QuorumStack requires a configurable quorum of owner approvals before any
;;   STX or SIP-010 token transaction executes. All state lives on-chain.
;;   Owner management (add/remove) and threshold changes also require quorum.

;; ============================================================
;;  SIP-010 Fungible Token Trait
;; ============================================================

(define-trait sip-010-trait
  (
    ;; Transfer tokens from sender to recipient
    (transfer (uint principal principal (optional (buff 34))) (response bool uint))
    ;; Get the token balance of an address
    (get-balance (principal) (response uint uint))
    ;; Get the total supply of the token
    (get-total-supply () (response uint uint))
    ;; Get the token name
    (get-name () (response (string-ascii 32) uint))
    ;; Get the token symbol
    (get-symbol () (response (string-ascii 10) uint))
    ;; Get the number of decimals
    (get-decimals () (response uint uint))
    ;; Get token URI
    (get-token-uri () (response (optional (string-utf8 256)) uint))
  )
)

;; ============================================================
;;  Error Constants
;; ============================================================

(define-constant err-not-owner             (err u100))
(define-constant err-already-approved      (err u101))
(define-constant err-not-approved          (err u102))
(define-constant err-tx-not-found         (err u103))
(define-constant err-tx-expired           (err u104))
(define-constant err-tx-executed          (err u105))
(define-constant err-below-threshold      (err u106))
(define-constant err-invalid-threshold    (err u107))
(define-constant err-owner-exists         (err u108))
(define-constant err-insufficient-balance (err u109))
(define-constant err-self-approval        (err u110))
(define-constant err-tx-cancelled         (err u111))
(define-constant err-owner-not-found      (err u112))
(define-constant err-min-owners           (err u113))

;; ============================================================
;;  Transaction Type Constants
;; ============================================================

;; tx-type values stored in the transaction map
(define-constant TX-TYPE-STX-TRANSFER     u1)
(define-constant TX-TYPE-TOKEN-TRANSFER   u2)
(define-constant TX-TYPE-ADD-OWNER        u3)
(define-constant TX-TYPE-REMOVE-OWNER     u4)
(define-constant TX-TYPE-CHANGE-THRESHOLD u5)

;; ============================================================
;;  Data Variables
;; ============================================================

;; Number of approvals required to execute any transaction
(define-data-var threshold uint u2)

;; Total number of active owners
(define-data-var owner-count uint u0)

;; Auto-incrementing ID counter for transaction proposals
(define-data-var tx-nonce uint u0)

;; ============================================================
;;  Data Maps
;; ============================================================

;; Registered owners: principal → bool
(define-map owners principal bool)

;; Transaction proposals
;; Stores all metadata for a proposal. token-contract is non-none only for
;; TX-TYPE-TOKEN-TRANSFER proposals. new-principal is used for add/remove owner.
;; new-value is used for change-threshold.
(define-map transactions
  uint  ;; tx-id
  {
    proposer:        principal,
    tx-type:         uint,
    recipient:       (optional principal),
    amount:          (optional uint),
    memo:            (optional (buff 34)),
    token-contract:  (optional principal),
    new-principal:   (optional principal),
    new-value:       (optional uint),
    approval-count:  uint,
    executed:        bool,
    cancelled:       bool,
    expires-at:      uint
  }
)

;; Per-owner approval tracking: {tx-id, owner} → bool
(define-map approvals
  { tx-id: uint, owner: principal }
  bool
)

;; ============================================================
;;  Deployment-time Initialization
;; ============================================================
;; The contract deployer is automatically registered as the first owner.
;; Additional owners and a new threshold should be set immediately after
;; deployment via propose-add-owner + approve + execute flows, OR the
;; deployer can call the one-time init function below before any other
;; transaction is submitted.

(map-set owners tx-sender true)
(var-set owner-count u1)

;; ============================================================
;;  Private Helper Functions
;; ============================================================

;; Assert the caller is a registered owner
(define-private (assert-owner)
  (if (default-to false (map-get? owners tx-sender))
    (ok true)
    err-not-owner)
)

;; Assert the transaction exists and return it
(define-private (get-tx-or-err (tx-id uint))
  (match (map-get? transactions tx-id)
    tx (ok tx)
    err-tx-not-found)
)

;; Assert the tx is still pending (not executed, not cancelled, not expired)
(define-private (assert-pending (tx { proposer: principal, tx-type: uint, recipient: (optional principal), amount: (optional uint), memo: (optional (buff 34)), token-contract: (optional principal), new-principal: (optional principal), new-value: (optional uint), approval-count: uint, executed: bool, cancelled: bool, expires-at: uint }))
  (if (get executed tx)
    err-tx-executed
    (if (get cancelled tx)
      err-tx-cancelled
      (if (>= block-height (get expires-at tx))
        err-tx-expired
        (ok true))))
)

;; ============================================================
;;  Public Functions
;; ============================================================

;;  propose-transfer
;;  Any owner proposes an STX transfer from the contract wallet
(define-public (propose-transfer
    (recipient principal)
    (amount    uint)
    (memo      (optional (buff 34)))
    (expires-at uint))
  (begin
    (try! (assert-owner))
    (asserts! (> amount u0) (err u120))
    (asserts! (> expires-at block-height) err-tx-expired)
    (let ((tx-id (+ (var-get tx-nonce) u1)))
      (var-set tx-nonce tx-id)
      (map-set transactions tx-id {
        proposer:       tx-sender,
        tx-type:        TX-TYPE-STX-TRANSFER,
        recipient:      (some recipient),
        amount:         (some amount),
        memo:           memo,
        token-contract: none,
        new-principal:  none,
        new-value:      none,
        approval-count: u0,
        executed:       false,
        cancelled:      false,
        expires-at:     expires-at
      })
      (print { event: "propose-transfer", tx-id: tx-id, proposer: tx-sender, recipient: recipient, amount: amount, expires-at: expires-at })
      (ok tx-id)))
)

;;  propose-token-transfer
;;  Any owner proposes a SIP-010 token transfer from the contract wallet
(define-public (propose-token-transfer
    (token-contract principal)
    (recipient      principal)
    (amount         uint)
    (memo           (optional (buff 34)))
    (expires-at     uint))
  (begin
    (try! (assert-owner))
    (asserts! (> amount u0) (err u120))
    (asserts! (> expires-at block-height) err-tx-expired)
    (let ((tx-id (+ (var-get tx-nonce) u1)))
      (var-set tx-nonce tx-id)
      (map-set transactions tx-id {
        proposer:       tx-sender,
        tx-type:        TX-TYPE-TOKEN-TRANSFER,
        recipient:      (some recipient),
        amount:         (some amount),
        memo:           memo,
        token-contract: (some token-contract),
        new-principal:  none,
        new-value:      none,
        approval-count: u0,
        executed:       false,
        cancelled:      false,
        expires-at:     expires-at
      })
      (print { event: "propose-token-transfer", tx-id: tx-id, proposer: tx-sender, token-contract: token-contract, recipient: recipient, amount: amount, expires-at: expires-at })
      (ok tx-id)))
)

;;  propose-add-owner
;;  Propose adding a new owner address to the wallet
(define-public (propose-add-owner
    (new-owner  principal)
    (expires-at uint))
  (begin
    (try! (assert-owner))
    (asserts! (not (default-to false (map-get? owners new-owner))) err-owner-exists)
    (asserts! (> expires-at block-height) err-tx-expired)
    (let ((tx-id (+ (var-get tx-nonce) u1)))
      (var-set tx-nonce tx-id)
      (map-set transactions tx-id {
        proposer:       tx-sender,
        tx-type:        TX-TYPE-ADD-OWNER,
        recipient:      none,
        amount:         none,
        memo:           none,
        token-contract: none,
        new-principal:  (some new-owner),
        new-value:      none,
        approval-count: u0,
        executed:       false,
        cancelled:      false,
        expires-at:     expires-at
      })
      (print { event: "propose-add-owner", tx-id: tx-id, proposer: tx-sender, new-owner: new-owner, expires-at: expires-at })
      (ok tx-id)))
)

;;  propose-remove-owner
;;  Propose removing an existing owner from the wallet
(define-public (propose-remove-owner
    (owner      principal)
    (expires-at uint))
  (begin
    (try! (assert-owner))
    (asserts! (default-to false (map-get? owners owner)) err-owner-not-found)
    ;; Prevent removing last owner or making threshold unreachable
    (asserts! (> (var-get owner-count) u1) err-min-owners)
    (asserts! (> expires-at block-height) err-tx-expired)
    (let ((tx-id (+ (var-get tx-nonce) u1)))
      (var-set tx-nonce tx-id)
      (map-set transactions tx-id {
        proposer:       tx-sender,
        tx-type:        TX-TYPE-REMOVE-OWNER,
        recipient:      none,
        amount:         none,
        memo:           none,
        token-contract: none,
        new-principal:  (some owner),
        new-value:      none,
        approval-count: u0,
        executed:       false,
        cancelled:      false,
        expires-at:     expires-at
      })
      (print { event: "propose-remove-owner", tx-id: tx-id, proposer: tx-sender, owner: owner, expires-at: expires-at })
      (ok tx-id)))
)

;;  propose-change-threshold
;;  Propose changing the quorum signature threshold
(define-public (propose-change-threshold
    (new-threshold uint)
    (expires-at    uint))
  (begin
    (try! (assert-owner))
    (asserts! (> new-threshold u0) err-invalid-threshold)
    (asserts! (<= new-threshold (var-get owner-count)) err-invalid-threshold)
    (asserts! (> expires-at block-height) err-tx-expired)
    (let ((tx-id (+ (var-get tx-nonce) u1)))
      (var-set tx-nonce tx-id)
      (map-set transactions tx-id {
        proposer:       tx-sender,
        tx-type:        TX-TYPE-CHANGE-THRESHOLD,
        recipient:      none,
        amount:         none,
        memo:           none,
        token-contract: none,
        new-principal:  none,
        new-value:      (some new-threshold),
        approval-count: u0,
        executed:       false,
        cancelled:      false,
        expires-at:     expires-at
      })
      (print { event: "propose-change-threshold", tx-id: tx-id, proposer: tx-sender, new-threshold: new-threshold, expires-at: expires-at })
      (ok tx-id)))
)

;;  approve
;;  An owner casts their approval for a pending transaction proposal.
;;  The proposer cannot self-approve their own proposal (reduces unilateral risk).
(define-public (approve (tx-id uint))
  (begin
    (try! (assert-owner))
    (let ((tx (try! (get-tx-or-err tx-id))))
      (try! (assert-pending tx))
      ;; Self-approval prevention: proposer cannot be the first approver
      (asserts! (not (is-eq tx-sender (get proposer tx))) err-self-approval)
      ;; Double-approval prevention
      (asserts!
        (not (default-to false (map-get? approvals { tx-id: tx-id, owner: tx-sender })))
        err-already-approved)
      ;; Record approval
      (map-set approvals { tx-id: tx-id, owner: tx-sender } true)
      (let ((new-count (+ (get approval-count tx) u1)))
        (map-set transactions tx-id (merge tx { approval-count: new-count }))
        (print { event: "approved", tx-id: tx-id, owner: tx-sender, approval-count: new-count })
        (ok new-count))))
)

;;  revoke
;;  An owner withdraws their approval from a pending transaction before execution.
(define-public (revoke (tx-id uint))
  (begin
    (try! (assert-owner))
    (let ((tx (try! (get-tx-or-err tx-id))))
      (try! (assert-pending tx))
      ;; Must have already approved
      (asserts!
        (default-to false (map-get? approvals { tx-id: tx-id, owner: tx-sender }))
        err-not-approved)
      ;; Remove approval
      (map-delete approvals { tx-id: tx-id, owner: tx-sender })
      (let ((new-count (- (get approval-count tx) u1)))
        (map-set transactions tx-id (merge tx { approval-count: new-count }))
        (print { event: "revoked", tx-id: tx-id, owner: tx-sender, approval-count: new-count })
        (ok new-count))))
)

;;  execute
;;  Execute a transaction once quorum of approvals has been reached.
;;  Any owner can trigger execution.
(define-public (execute (tx-id uint))
  (begin
    (try! (assert-owner))
    (let ((tx (try! (get-tx-or-err tx-id))))
      (try! (assert-pending tx))
      (asserts! (>= (get approval-count tx) (var-get threshold)) err-below-threshold)
      ;; Mark as executed immediately to prevent re-entrancy / double execution
      (map-set transactions tx-id (merge tx { executed: true }))
      (print { event: "executing", tx-id: tx-id, executor: tx-sender, tx-type: (get tx-type tx) })
      ;; Dispatch based on transaction type
      (if (is-eq (get tx-type tx) TX-TYPE-STX-TRANSFER)
        (execute-stx-transfer tx tx-id)
        (if (is-eq (get tx-type tx) TX-TYPE-TOKEN-TRANSFER)
          ;; Token transfers: caller must pass token contract as trait — see execute-token
          ;; For now, mark as executed and fire an event that the off-chain handler finishes
          (begin
            (print { event: "token-transfer-pending-finalization", tx-id: tx-id })
            (ok true))
          (if (is-eq (get tx-type tx) TX-TYPE-ADD-OWNER)
            (execute-add-owner tx tx-id)
            (if (is-eq (get tx-type tx) TX-TYPE-REMOVE-OWNER)
              (execute-remove-owner tx tx-id)
              (if (is-eq (get tx-type tx) TX-TYPE-CHANGE-THRESHOLD)
                (execute-change-threshold tx tx-id)
                (err u199))))))))  ;; unknown type guard
)

;;  execute-token
;;  Separate entry point for SIP-010 token transfer execution.
;;  The caller passes in the token contract as a trait reference so Clarity
;;  can call it dynamically. The tx must already have quorum; execution state
;;  is managed here to prevent double-execution.
(define-public (execute-token (tx-id uint) (token <sip-010-trait>))
  (begin
    (try! (assert-owner))
    (let ((tx (try! (get-tx-or-err tx-id))))
      ;; tx-type must be token transfer
      (asserts! (is-eq (get tx-type tx) TX-TYPE-TOKEN-TRANSFER) (err u198))
      (try! (assert-pending tx))
      (asserts! (>= (get approval-count tx) (var-get threshold)) err-below-threshold)
      ;; Verify the passed-in token contract matches what was proposed
      (asserts!
        (is-eq (some (contract-of token)) (get token-contract tx))
        (err u197))
      ;; Mark as executed first (reentrancy guard)
      (map-set transactions tx-id (merge tx { executed: true }))
      (let (
        (recipient (unwrap! (get recipient tx) (err u196)))
        (amount    (unwrap! (get amount tx)    (err u195)))
        (tx-memo   (get memo tx))
      )
        (try! (as-contract (contract-call? token transfer amount tx-sender recipient tx-memo)))
        (print { event: "token-transfer-executed", tx-id: tx-id, executor: tx-sender, recipient: recipient, amount: amount })
        (ok true))))
)

;; ============================================================
;;  Private Execution Helpers
;; ============================================================

(define-private (execute-stx-transfer
    (tx { proposer: principal, tx-type: uint, recipient: (optional principal), amount: (optional uint), memo: (optional (buff 34)), token-contract: (optional principal), new-principal: (optional principal), new-value: (optional uint), approval-count: uint, executed: bool, cancelled: bool, expires-at: uint })
    (tx-id uint))
  (let (
    (recipient (unwrap! (get recipient tx) (err u194)))
    (amount    (unwrap! (get amount tx)    (err u193)))
  )
    (asserts! (<= amount (stx-get-balance (as-contract tx-sender))) err-insufficient-balance)
    (match (get memo tx)
      memo-bytes
        (try! (as-contract (stx-transfer-memo? amount tx-sender recipient memo-bytes)))
      ;; no memo
        (try! (as-contract (stx-transfer? amount tx-sender recipient))))
    (print { event: "stx-transfer-executed", tx-id: tx-id, recipient: recipient, amount: amount })
    (ok true))
)

(define-private (execute-add-owner
    (tx { proposer: principal, tx-type: uint, recipient: (optional principal), amount: (optional uint), memo: (optional (buff 34)), token-contract: (optional principal), new-principal: (optional principal), new-value: (optional uint), approval-count: uint, executed: bool, cancelled: bool, expires-at: uint })
    (tx-id uint))
  (let ((new-owner (unwrap! (get new-principal tx) (err u192))))
    ;; Guard: owner might have been added between proposal and execution
    (asserts! (not (default-to false (map-get? owners new-owner))) err-owner-exists)
    (map-set owners new-owner true)
    (var-set owner-count (+ (var-get owner-count) u1))
    (print { event: "owner-added", tx-id: tx-id, new-owner: new-owner, owner-count: (var-get owner-count) })
    (ok true))
)

(define-private (execute-remove-owner
    (tx { proposer: principal, tx-type: uint, recipient: (optional principal), amount: (optional uint), memo: (optional (buff 34)), token-contract: (optional principal), new-principal: (optional principal), new-value: (optional uint), approval-count: uint, executed: bool, cancelled: bool, expires-at: uint })
    (tx-id uint))
  (let (
    (owner     (unwrap! (get new-principal tx) (err u191)))
    (new-count (- (var-get owner-count) u1))
  )
    (asserts! (default-to false (map-get? owners owner)) err-owner-not-found)
    ;; After removal, threshold must remain reachable
    (asserts! (>= new-count (var-get threshold)) err-invalid-threshold)
    (asserts! (> new-count u0) err-min-owners)
    (map-delete owners owner)
    (var-set owner-count new-count)
    (print { event: "owner-removed", tx-id: tx-id, owner: owner, owner-count: new-count })
    (ok true))
)

(define-private (execute-change-threshold
    (tx { proposer: principal, tx-type: uint, recipient: (optional principal), amount: (optional uint), memo: (optional (buff 34)), token-contract: (optional principal), new-principal: (optional principal), new-value: (optional uint), approval-count: uint, executed: bool, cancelled: bool, expires-at: uint })
    (tx-id uint))
  (let ((new-threshold (unwrap! (get new-value tx) (err u190))))
    (asserts! (> new-threshold u0) err-invalid-threshold)
    (asserts! (<= new-threshold (var-get owner-count)) err-invalid-threshold)
    (var-set threshold new-threshold)
    (print { event: "threshold-changed", tx-id: tx-id, new-threshold: new-threshold })
    (ok true))
)

;; ============================================================
;;  Read-Only Functions
;; ============================================================

;;  get-transaction
;;  Returns the full details of a transaction proposal by ID
(define-read-only (get-transaction (tx-id uint))
  (map-get? transactions tx-id)
)

;;  has-approved
;;  Check whether a specific owner has approved a specific transaction
(define-read-only (has-approved (tx-id uint) (owner principal))
  (default-to false (map-get? approvals { tx-id: tx-id, owner: owner }))
)

;;  is-owner
;;  Check whether an address is a registered owner
(define-read-only (is-owner (address principal))
  (default-to false (map-get? owners address))
)

;;  get-threshold
;;  Returns the current quorum threshold
(define-read-only (get-threshold)
  (var-get threshold)
)

;;  get-owner-count
;;  Returns the total number of registered owners
(define-read-only (get-owner-count)
  (var-get owner-count)
)

;;  get-approval-count
;;  Returns the current number of approvals on a transaction
(define-read-only (get-approval-count (tx-id uint))
  (match (map-get? transactions tx-id)
    tx  (get approval-count tx)
    u0)
)

;;  get-balance
;;  Returns the contract's STX balance in microSTX
(define-read-only (get-balance)
  (stx-get-balance (as-contract tx-sender))
)

;;  get-tx-nonce
;;  Returns the latest transaction ID (total proposals submitted)
(define-read-only (get-tx-nonce)
  (var-get tx-nonce)
)
