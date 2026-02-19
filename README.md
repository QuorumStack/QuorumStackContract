# QuorumStack 🔐

> A decentralized multisig wallet on the Stacks blockchain — require M-of-N signatures before any transaction executes.

QuorumStack is an open-source multisignature wallet built in Clarity on Stacks. It lets groups of people — teams, DAOs, treasuries, families — collectively control STX and SIP-010 tokens, so no single person can move funds alone. Every transaction requires a defined quorum of approvals before it executes.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [How Multisig Works](#how-multisig-works)
- [Architecture](#architecture)
- [Contract Reference](#contract-reference)
- [Getting Started](#getting-started)
- [Creating a Wallet](#creating-a-wallet)
- [Submitting a Transaction](#submitting-a-transaction)
- [Approving & Executing](#approving--executing)
- [Owner Management](#owner-management)
- [Security Model](#security-model)
- [Project Structure](#project-structure)
- [Testing](#testing)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

Single-key wallets are a single point of failure. If one private key is lost, stolen, or compromised, all funds are gone. QuorumStack solves this by requiring multiple independent signers to agree before any transaction goes through.

**Example setups:**
- A startup with 3 founders uses a **2-of-3** wallet — any 2 can approve, protecting against one bad actor
- A DAO treasury uses **5-of-9** — a majority must agree on every spend
- A family uses **2-of-2** — both parents must sign to move savings
- A solo developer uses **2-of-3** with hardware keys — personal key recovery fallback

---

## Features

- 🔐 **M-of-N signature requirement** — fully configurable quorum threshold
- 💸 **STX transfers** — propose and execute STX sends with multisig approval
- 🪙 **SIP-010 token support** — manage fungible tokens held by the wallet
- 📋 **Transaction queue** — all pending proposals stored on-chain with full history
- ✅ **Per-owner approval tracking** — see exactly who has signed what
- ❌ **Revoke support** — change your mind and withdraw your approval
- 👥 **Owner management** — add or remove owners via multisig vote
- 🕒 **Expiry timestamps** — proposals expire if not executed within a time window
- 📣 **On-chain events** — emit print events for indexers and frontends
- 🧪 **Full Clarinet test suite** — comprehensive coverage of all flows

---

## How Multisig Works

```
Owner A ──┐
          │  propose tx  ┌─────────────────────┐
Owner B ──┼─────────────►│  Transaction Queue  │
          │              │  (on-chain storage) │
Owner C ──┘              └──────────┬──────────┘
                                    │
              Owner A approves ─────┤
              Owner B approves ─────┤  (threshold reached)
                                    │
                                    ▼
                          ┌──────────────────┐
                          │  execute-tx      │
                          │  STX / token     │
                          │  transfer fires  │
                          └──────────────────┘
```

**Step by step:**
1. Any owner **proposes** a transaction (recipient, amount, memo)
2. Owners independently **approve** the proposal on-chain
3. Once approvals reach the quorum threshold, any owner can **execute** it
4. The contract transfers the funds to the recipient
5. The transaction is marked complete and removed from the queue

---

## Architecture

QuorumStack is a single self-contained Clarity contract. There is no external dependency or oracle needed. All state — owners, threshold, proposals, approvals — lives on-chain.

```
┌────────────────────────────────────────────────────┐
│                quorumstack.clar                    │
│                                                    │
│  ┌──────────────┐   ┌───────────────────────────┐ │
│  │  Owner Map   │   │     Transaction Map        │ │
│  │  (principals)│   │  id → {recipient, amount,  │ │
│  │              │   │   memo, approvals, status} │ │
│  └──────────────┘   └───────────────────────────┘ │
│                                                    │
│  ┌──────────────────────────────────────────────┐ │
│  │             Approval Map                     │ │
│  │  {tx-id, owner} → bool                       │ │
│  └──────────────────────────────────────────────┘ │
│                                                    │
│  threshold: uint   │   owner-count: uint           │
└────────────────────────────────────────────────────┘
```

---

## Contract Reference

### Configuration

Set these at deployment time — they cannot be changed without an owner vote:

```clarity
;; Number of signatures required to execute a transaction
(define-data-var threshold uint u2)

;; Total number of current owners
(define-data-var owner-count uint u3)

;; Auto-incrementing transaction ID counter
(define-data-var tx-nonce uint u0)
```

---

### Public Functions

#### `propose-transfer`
Any owner can propose sending STX to a recipient.

```clarity
(define-public (propose-transfer
  (recipient principal)
  (amount uint)
  (memo (optional (buff 34)))
  (expires-at uint))
```

| Parameter | Description |
|---|---|
| `recipient` | Address to send STX to |
| `amount` | Amount in microSTX (1 STX = 1,000,000 uSTX) |
| `memo` | Optional 34-byte memo |
| `expires-at` | Block height after which proposal expires |

---

#### `propose-token-transfer`
Propose a SIP-010 token transfer from the wallet.

```clarity
(define-public (propose-token-transfer
  (token-contract principal)
  (recipient principal)
  (amount uint)
  (memo (optional (buff 34)))
  (expires-at uint))
```

---

#### `approve`
Approve a pending transaction proposal. Caller must be a registered owner.

```clarity
(define-public (approve (tx-id uint))
```

---

#### `revoke`
Withdraw your approval from a pending transaction before it executes.

```clarity
(define-public (revoke (tx-id uint))
```

---

#### `execute`
Execute a transaction once quorum is reached. Any owner can call this.

```clarity
(define-public (execute (tx-id uint))
```

---

#### `propose-add-owner`
Propose adding a new owner to the wallet. Requires quorum to execute.

```clarity
(define-public (propose-add-owner (new-owner principal))
```

---

#### `propose-remove-owner`
Propose removing an existing owner. Requires quorum to execute.

```clarity
(define-public (propose-remove-owner (owner principal))
```

---

#### `propose-change-threshold`
Propose changing the quorum threshold. Requires quorum to execute.

```clarity
(define-public (propose-change-threshold (new-threshold uint))
```

---

### Read-Only Functions

```clarity
;; Get full details of a transaction proposal
(define-read-only (get-transaction (tx-id uint)))

;; Check if a specific owner has approved a specific tx
(define-read-only (has-approved (tx-id uint) (owner principal)))

;; Check if an address is a registered owner
(define-read-only (is-owner (address principal)))

;; Get current quorum threshold
(define-read-only (get-threshold))

;; Get total owner count
(define-read-only (get-owner-count))

;; Get current approval count for a transaction
(define-read-only (get-approval-count (tx-id uint)))

;; Get wallet STX balance
(define-read-only (get-balance))
```

---

### Error Codes

| Code | Constant | Description |
|---|---|---|
| `u100` | `err-not-owner` | Caller is not a registered owner |
| `u101` | `err-already-approved` | Owner already approved this tx |
| `u102` | `err-not-approved` | Cannot revoke — not yet approved |
| `u103` | `err-tx-not-found` | Transaction ID does not exist |
| `u104` | `err-tx-expired` | Proposal has passed its expiry block |
| `u105` | `err-tx-executed` | Transaction already executed |
| `u106` | `err-below-threshold` | Not enough approvals to execute |
| `u107` | `err-invalid-threshold` | Threshold exceeds owner count |
| `u108` | `err-owner-exists` | Address is already an owner |
| `u109` | `err-insufficient-balance` | Wallet has insufficient funds |
| `u110` | `err-self-approval` | Owner cannot approve their own proposal |

---

## Getting Started

### Prerequisites

- [Clarinet](https://github.com/hirosystems/clarinet) — Clarity development environment
- [Hiro Wallet](https://wallet.hiro.so/) — for mainnet/testnet deployment
- Node.js v18+ — for deployment scripts
- STX in your wallet for gas fees

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/quorumstack.git
cd quorumstack

# Install dependencies
npm install

# Verify contracts
clarinet check

# Run tests
clarinet test
```

---

## Creating a Wallet

QuorumStack is deployed as a single contract instance per wallet. To create your multisig wallet:

### Step 1 — Configure your owners and threshold

Edit `contracts/quorumstack.clar` and set your initial owners and threshold in the deployment initialization:

```clarity
;; Set threshold (e.g. 2-of-3)
(var-set threshold u2)

;; Register initial owners
(map-set owners 'SP1ABC...owner1 true)
(map-set owners 'SP2DEF...owner2 true)
(map-set owners 'SP3GHI...owner3 true)
(var-set owner-count u3)
```

### Step 2 — Deploy to testnet

```bash
clarinet deployments apply --testnet
```

### Step 3 — Fund the wallet

Send STX to the deployed contract address. The contract principal acts as the wallet address:

```
SP1234...your-contract-address.quorumstack
```

### Step 4 — Verify on explorer

Check your wallet on [Hiro Explorer](https://explorer.hiro.so/) to confirm owners, threshold, and balance.

---

## Submitting a Transaction

Any owner can propose a transaction at any time:

```clarity
;; Propose sending 100 STX to a recipient, expires in 1000 blocks
(contract-call? .quorumstack propose-transfer
  'SP9876...recipient
  u100000000
  none
  (+ block-height u1000))
```

The proposal is stored on-chain and returns a `tx-id` used for approvals and execution.

---

## Approving & Executing

Once a proposal is submitted, owners approve independently:

```clarity
;; Owner A approves tx-id 1
(contract-call? .quorumstack approve u1)

;; Owner B approves tx-id 1
(contract-call? .quorumstack approve u1)

;; Quorum reached — any owner executes
(contract-call? .quorumstack execute u1)
```

If you change your mind before execution:

```clarity
;; Revoke your approval
(contract-call? .quorumstack revoke u1)
```

---

## Owner Management

All owner management actions go through the same propose → approve → execute flow, ensuring no single person can change the wallet configuration:

```clarity
;; Propose adding a new owner
(contract-call? .quorumstack propose-add-owner 'SPNewOwner...)

;; Propose removing an owner
(contract-call? .quorumstack propose-remove-owner 'SPOldOwner...)

;; Propose changing the threshold from 2 to 3
(contract-call? .quorumstack propose-change-threshold u3)
```

> ⚠️ Always ensure the new threshold does not exceed the owner count, or the wallet will be permanently locked.

---

## Security Model

QuorumStack is designed with the following security properties:

**On-chain enforcement** — all approval logic runs in Clarity, which is non-Turing-complete and decidable. No off-chain component can bypass the threshold requirement.

**No admin key** — once deployed, the contract has no privileged owner or admin. All changes require quorum.

**Expiry protection** — proposals expire at a defined block height, preventing stale transactions from executing unexpectedly in the future.

**Self-approval prevention** — the proposer cannot immediately approve their own transaction as the first signer, reducing unilateral risk.

**Replay protection** — each transaction has a unique auto-incremented ID. Executed transactions are permanently marked and cannot be re-executed.

**Threshold validation** — the contract rejects any threshold change that would exceed the current owner count.

### Audit Considerations

- QuorumStack has not yet been formally audited. Use on mainnet at your own risk until an audit is complete.
- Review the contract source carefully before deploying with significant funds.
- Start with testnet and small amounts before moving to production use.

---

## Project Structure

```
quorumstack/
├── contracts/
│   └── quorumstack.clar          # Main multisig wallet contract
├── tests/
│   └── quorumstack_test.ts       # Full Clarinet test suite
├── scripts/
│   ├── deploy.ts                 # Deployment helper
│   ├── propose.ts                # CLI: propose a transaction
│   ├── approve.ts                # CLI: approve a transaction
│   └── execute.ts                # CLI: execute a transaction
├── deployments/
│   ├── devnet.yaml
│   ├── testnet.yaml
│   └── mainnet.yaml
├── settings/
│   └── Devnet.toml
├── Clarinet.toml
├── package.json
└── README.md
```

---

## Testing

```bash
# Run all tests
clarinet test

# Run with coverage report
clarinet test --coverage

# Open interactive console
clarinet console
```

### Test coverage includes

- Wallet deployment with valid and invalid configurations
- Propose, approve, revoke, and execute full happy path
- Execution blocked below threshold
- Expired proposal rejection
- Non-owner action rejection
- Double approval prevention
- Self-approval prevention
- Add/remove owner via multisig vote
- Threshold change via multisig vote
- Threshold exceeds owner count guard
- STX and SIP-010 token transfers
- Insufficient balance handling
- Re-execution prevention

---

## Roadmap

- [x] Core M-of-N multisig logic
- [x] STX transfer proposals
- [x] SIP-010 token transfer proposals
- [x] Owner add/remove via vote
- [x] Threshold change via vote
- [x] Proposal expiry
- [ ] Web UI for wallet management
- [ ] Transaction history indexer
- [ ] Hardware wallet support (Ledger)
- [ ] Time-lock delay on execution (optional safety window)
- [ ] Emergency freeze mechanism (requires supermajority)
- [ ] Multiple wallet instances from a factory contract
- [ ] Integration with StacksMint tokens
- [ ] Mobile-friendly signing interface

---

## Contributing

We welcome contributions from the community. To get started:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Write tests for your changes
4. Ensure all tests pass (`clarinet test`)
5. Submit a pull request with a clear description of the change

Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before submitting.

---

## License

QuorumStack is open source under the [MIT License](./LICENSE).

---

Built with ❤️ on [Stacks](https://stacks.co) — Bitcoin's smart contract layer.
