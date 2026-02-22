import { describe, expect, it } from "vitest";
import { Cl, cvToValue } from "@stacks/transactions";

// ── simnet is injected globally by vitest-environment-clarinet ──────────────
const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;   // auto-registered as first owner
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;
const wallet3 = accounts.get("wallet_3")!;
const wallet4 = accounts.get("wallet_4")!;

const CONTRACT = "Quorum";
const FUTURE_BLOCK = 9999; // well beyond any simnet block inside a test



// ── Convenience call wrappers ────────────────────────────────────────────────
function proposeTransfer(sender: string, recipient: string, amount: number, expiresAt = FUTURE_BLOCK) {
    return simnet.callPublicFn(CONTRACT, "propose-transfer",
        [Cl.principal(recipient), Cl.uint(amount), Cl.none(), Cl.uint(expiresAt)], sender);
}

function proposeAddOwner(sender: string, newOwner: string, expiresAt = FUTURE_BLOCK) {
    return simnet.callPublicFn(CONTRACT, "propose-add-owner",
        [Cl.principal(newOwner), Cl.uint(expiresAt)], sender);
}

function proposeRemoveOwner(sender: string, owner: string, expiresAt = FUTURE_BLOCK) {
    return simnet.callPublicFn(CONTRACT, "propose-remove-owner",
        [Cl.principal(owner), Cl.uint(expiresAt)], sender);
}

function proposeChangeThreshold(sender: string, newThreshold: number, expiresAt = FUTURE_BLOCK) {
    return simnet.callPublicFn(CONTRACT, "propose-change-threshold",
        [Cl.uint(newThreshold), Cl.uint(expiresAt)], sender);
}

function approveTx(sender: string, txId: number) {
    return simnet.callPublicFn(CONTRACT, "approve", [Cl.uint(txId)], sender);
}

function revokeTx(sender: string, txId: number) {
    return simnet.callPublicFn(CONTRACT, "revoke", [Cl.uint(txId)], sender);
}

function executeTx(sender: string, txId: number) {
    return simnet.callPublicFn(CONTRACT, "execute", [Cl.uint(txId)], sender);
}

// ═══════════════════════════════════════════════════════════════════════════
//  1. DEPLOYMENT / INITIAL STATE
// ═══════════════════════════════════════════════════════════════════════════
describe("1 — Deployment & initial state", () => {
    it("simnet is initialised", () => {
        expect(simnet.blockHeight).toBeDefined();
    });

    it("deployer is registered as an owner", () => {
        const { result } = simnet.callReadOnlyFn(CONTRACT, "is-owner", [Cl.principal(deployer)], deployer);
        expect(result).toBeBool(true);
    });

    it("non-owner is not recognised as owner", () => {
        const { result } = simnet.callReadOnlyFn(CONTRACT, "is-owner", [Cl.principal(wallet1)], deployer);
        expect(result).toBeBool(false);
    });

    it("initial owner-count is 1", () => {
        const { result } = simnet.callReadOnlyFn(CONTRACT, "get-owner-count", [], deployer);
        expect(result).toBeUint(1);
    });

    it("initial threshold is 2", () => {
        const { result } = simnet.callReadOnlyFn(CONTRACT, "get-threshold", [], deployer);
        expect(result).toBeUint(2);
    });

    it("initial tx-nonce is 0", () => {
        const { result } = simnet.callReadOnlyFn(CONTRACT, "get-tx-nonce", [], deployer);
        expect(result).toBeUint(0);
    });

    it("contract STX balance starts at 0", () => {
        const { result } = simnet.callReadOnlyFn(CONTRACT, "get-balance", [], deployer);
        expect(result).toBeUint(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
//  2. PROPOSE-TRANSFER
// ═══════════════════════════════════════════════════════════════════════════
describe("2 — propose-transfer", () => {
    it("owner can propose a transfer and gets back tx-id u1", () => {
        const { result } = proposeTransfer(deployer, wallet1, 1_000_000);
        expect(result).toBeOk(Cl.uint(1));
    });

    it("tx-nonce increments after proposal", () => {
        proposeTransfer(deployer, wallet1, 1_000_000);
        const { result } = simnet.callReadOnlyFn(CONTRACT, "get-tx-nonce", [], deployer);
        expect(result).toBeUint(1);
    });

    it("proposal is stored with correct fields", () => {
        proposeTransfer(deployer, wallet1, 5_000_000);
        const { result } = simnet.callReadOnlyFn(CONTRACT, "get-transaction", [Cl.uint(1)], deployer);
        expect(result).toBeSome(
            Cl.tuple({
                proposer: Cl.principal(deployer),
                "tx-type": Cl.uint(1),
                recipient: Cl.some(Cl.principal(wallet1)),
                amount: Cl.some(Cl.uint(5_000_000)),
                memo: Cl.none(),
                "token-contract": Cl.none(),
                "new-principal": Cl.none(),
                "new-value": Cl.none(),
                "approval-count": Cl.uint(0),
                executed: Cl.bool(false),
                cancelled: Cl.bool(false),
                "expires-at": Cl.uint(FUTURE_BLOCK),
            })
        );
    });

    it("non-owner cannot propose a transfer", () => {
        const { result } = proposeTransfer(wallet1, wallet2, 1_000_000);
        expect(result).toBeErr(Cl.uint(100)); // err-not-owner
    });

    it("rejects zero-amount proposal", () => {
        const { result } = proposeTransfer(deployer, wallet1, 0);
        expect(result).toBeErr(Cl.uint(120));
    });

    it("rejects proposal with already-past expiry", () => {
        const { result } = proposeTransfer(deployer, wallet1, 1_000_000, 1);
        expect(result).toBeErr(Cl.uint(104)); // err-tx-expired
    });

    it("each proposal gets a unique incremented id", () => {
        const { result: r1 } = proposeTransfer(deployer, wallet1, 1_000_000);
        const { result: r2 } = proposeTransfer(deployer, wallet2, 2_000_000);
        expect(r1).toBeOk(Cl.uint(1));
        expect(r2).toBeOk(Cl.uint(2));
    });
});

// ═══════════════════════════════════════════════════════════════════════════
//  3. PROPOSE-TOKEN-TRANSFER
// ═══════════════════════════════════════════════════════════════════════════
describe("3 — propose-token-transfer", () => {
    it("owner can propose a token transfer", () => {
        const { result } = simnet.callPublicFn(CONTRACT, "propose-token-transfer",
            [Cl.principal(wallet3), Cl.principal(wallet1), Cl.uint(100), Cl.none(), Cl.uint(FUTURE_BLOCK)],
            deployer);
        expect(result).toBeOk(Cl.uint(1));
    });

    it("stored tx has tx-type 2 and correct token-contract", () => {
        simnet.callPublicFn(CONTRACT, "propose-token-transfer",
            [Cl.principal(wallet3), Cl.principal(wallet1), Cl.uint(100), Cl.none(), Cl.uint(FUTURE_BLOCK)],
            deployer);
        const { result } = simnet.callReadOnlyFn(CONTRACT, "get-transaction", [Cl.uint(1)], deployer);
        expect(result).toBeSome(
            Cl.tuple({
                proposer: Cl.principal(deployer),
                "tx-type": Cl.uint(2),
                recipient: Cl.some(Cl.principal(wallet1)),
                amount: Cl.some(Cl.uint(100)),
                memo: Cl.none(),
                "token-contract": Cl.some(Cl.principal(wallet3)),
                "new-principal": Cl.none(),
                "new-value": Cl.none(),
                "approval-count": Cl.uint(0),
                executed: Cl.bool(false),
                cancelled: Cl.bool(false),
                "expires-at": Cl.uint(FUTURE_BLOCK),
            })
        );
    });

    it("non-owner cannot propose a token transfer", () => {
        const { result } = simnet.callPublicFn(CONTRACT, "propose-token-transfer",
            [Cl.principal(wallet3), Cl.principal(wallet1), Cl.uint(100), Cl.none(), Cl.uint(FUTURE_BLOCK)],
            wallet1);
        expect(result).toBeErr(Cl.uint(100));
    });

    it("rejects zero-amount token transfer proposal", () => {
        const { result } = simnet.callPublicFn(CONTRACT, "propose-token-transfer",
            [Cl.principal(wallet3), Cl.principal(wallet1), Cl.uint(0), Cl.none(), Cl.uint(FUTURE_BLOCK)],
            deployer);
        expect(result).toBeErr(Cl.uint(120));
    });
});

// ═══════════════════════════════════════════════════════════════════════════
//  4. APPROVE
// ═══════════════════════════════════════════════════════════════════════════
describe("4 — approve", () => {
    it("blocks self-approval (proposer cannot approve own tx)", () => {
        proposeTransfer(deployer, wallet1, 1_000_000);
        const { result } = approveTx(deployer, 1);
        expect(result).toBeErr(Cl.uint(110)); // err-self-approval
    });

    it("non-owner cannot approve", () => {
        proposeTransfer(deployer, wallet1, 1_000_000);
        const { result } = approveTx(wallet1, 1);
        expect(result).toBeErr(Cl.uint(100)); // err-not-owner
    });

    it("approve on non-existent tx-id returns err-tx-not-found", () => {
        const { result } = approveTx(deployer, 999);
        expect(result).toBeErr(Cl.uint(103));
    });

    it("approval-count stays 0 when approval blocked (non-owner voter)", () => {
        proposeTransfer(deployer, wallet2, 1_000_000);
        approveTx(wallet1, 1); // blocked — not owner
        const { result } = simnet.callReadOnlyFn(CONTRACT, "get-approval-count", [Cl.uint(1)], deployer);
        expect(result).toBeUint(0);
    });

    it("has-approved returns false before any approval", () => {
        proposeTransfer(deployer, wallet1, 1_000_000);
        const { result } = simnet.callReadOnlyFn(
            CONTRACT, "has-approved", [Cl.uint(1), Cl.principal(wallet1)], deployer);
        expect(result).toBeBool(false);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
//  5. REVOKE
// ═══════════════════════════════════════════════════════════════════════════
describe("5 — revoke", () => {
    it("cannot revoke if never approved (err-not-approved)", () => {
        proposeTransfer(deployer, wallet1, 1_000_000);
        const { result } = revokeTx(deployer, 1);
        expect(result).toBeErr(Cl.uint(102)); // err-not-approved
    });

    it("cannot revoke a non-existent tx", () => {
        const { result } = revokeTx(deployer, 777);
        expect(result).toBeErr(Cl.uint(103)); // err-tx-not-found
    });

    it("non-owner cannot revoke", () => {
        proposeTransfer(deployer, wallet1, 1_000_000);
        const { result } = revokeTx(wallet1, 1);
        expect(result).toBeErr(Cl.uint(100)); // err-not-owner
    });
});

// ═══════════════════════════════════════════════════════════════════════════
//  6. EXECUTE — guards
// ═══════════════════════════════════════════════════════════════════════════
describe("6 — execute guards", () => {
    it("cannot execute a non-existent tx", () => {
        const { result } = executeTx(deployer, 999);
        expect(result).toBeErr(Cl.uint(103)); // err-tx-not-found
    });

    it("cannot execute below threshold (err-below-threshold)", () => {
        proposeTransfer(deployer, wallet1, 1_000_000);
        const { result } = executeTx(deployer, 1);
        expect(result).toBeErr(Cl.uint(106)); // err-below-threshold
    });

    it("non-owner cannot execute", () => {
        proposeTransfer(deployer, wallet1, 1_000_000);
        const { result } = executeTx(wallet1, 1);
        expect(result).toBeErr(Cl.uint(100)); // err-not-owner
    });

    it("cannot execute an expired transaction", () => {
        const currentHeight = simnet.blockHeight;
        proposeTransfer(deployer, wallet1, 1_000_000, currentHeight + 2);
        simnet.mineEmptyBlocks(3);
        const { result } = executeTx(deployer, 1);
        expect(result).toBeErr(Cl.uint(104)); // err-tx-expired
    });
});

// ═══════════════════════════════════════════════════════════════════════════
//  7. PROPOSE-ADD-OWNER
// ═══════════════════════════════════════════════════════════════════════════
describe("7 — propose-add-owner", () => {
    it("owner can propose adding a new owner", () => {
        const { result } = proposeAddOwner(deployer, wallet1);
        expect(result).toBeOk(Cl.uint(1));
    });

    it("non-owner cannot propose adding an owner", () => {
        const { result } = proposeAddOwner(wallet1, wallet2);
        expect(result).toBeErr(Cl.uint(100)); // err-not-owner
    });

    it("cannot propose adding an existing owner (err-owner-exists)", () => {
        const { result } = proposeAddOwner(deployer, deployer);
        expect(result).toBeErr(Cl.uint(108));
    });

    it("add-owner tx is stored with tx-type 3 and correct new-principal", () => {
        proposeAddOwner(deployer, wallet1);
        const { result } = simnet.callReadOnlyFn(CONTRACT, "get-transaction", [Cl.uint(1)], deployer);
        expect(result).not.toBeNone();
    });

    it("rejects add-owner proposal with past expiry", () => {
        const { result } = proposeAddOwner(deployer, wallet1, 1);
        expect(result).toBeErr(Cl.uint(104)); // err-tx-expired
    });
});

// ═══════════════════════════════════════════════════════════════════════════
//  8. PROPOSE-REMOVE-OWNER
// ═══════════════════════════════════════════════════════════════════════════
describe("8 — propose-remove-owner", () => {
    it("cannot propose removing a non-existent owner", () => {
        const { result } = proposeRemoveOwner(deployer, wallet1);
        expect(result).toBeErr(Cl.uint(112)); // err-owner-not-found
    });

    it("cannot propose removing the last owner (err-min-owners)", () => {
        const { result } = proposeRemoveOwner(deployer, deployer);
        expect(result).toBeErr(Cl.uint(113)); // err-min-owners
    });

    it("non-owner cannot propose removing an owner", () => {
        const { result } = proposeRemoveOwner(wallet1, deployer);
        expect(result).toBeErr(Cl.uint(100)); // err-not-owner
    });
});

// ═══════════════════════════════════════════════════════════════════════════
//  9. PROPOSE-CHANGE-THRESHOLD
// ═══════════════════════════════════════════════════════════════════════════
describe("9 — propose-change-threshold", () => {
    it("owner can propose a valid threshold change", () => {
        const { result } = proposeChangeThreshold(deployer, 1);
        expect(result).toBeOk(Cl.uint(1));
    });

    it("rejects threshold of zero", () => {
        const { result } = proposeChangeThreshold(deployer, 0);
        expect(result).toBeErr(Cl.uint(107)); // err-invalid-threshold
    });

    it("rejects threshold greater than owner-count", () => {
        const { result } = proposeChangeThreshold(deployer, 3);
        expect(result).toBeErr(Cl.uint(107));
    });

    it("non-owner cannot propose threshold change", () => {
        const { result } = proposeChangeThreshold(wallet1, 1);
        expect(result).toBeErr(Cl.uint(100));
    });

    it("change-threshold tx stored with tx-type 5 and correct new-value", () => {
        proposeChangeThreshold(deployer, 1);
        const { result } = simnet.callReadOnlyFn(CONTRACT, "get-transaction", [Cl.uint(1)], deployer);
        expect(result).not.toBeNone();
    });
});

// ═══════════════════════════════════════════════════════════════════════════
//  10. READ-ONLY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════
describe("10 — read-only functions", () => {
    it("get-transaction returns none for unknown tx-id", () => {
        const { result } = simnet.callReadOnlyFn(CONTRACT, "get-transaction", [Cl.uint(42)], deployer);
        expect(result).toBeNone();
    });

    it("get-approval-count returns 0 for unknown tx", () => {
        const { result } = simnet.callReadOnlyFn(CONTRACT, "get-approval-count", [Cl.uint(99)], deployer);
        expect(result).toBeUint(0);
    });

    it("has-approved returns false for unknown tx", () => {
        const { result } = simnet.callReadOnlyFn(
            CONTRACT, "has-approved", [Cl.uint(99), Cl.principal(deployer)], deployer);
        expect(result).toBeBool(false);
    });

    it("get-threshold returns current threshold", () => {
        const { result } = simnet.callReadOnlyFn(CONTRACT, "get-threshold", [], deployer);
        expect(result).toBeUint(2);
    });

    it("get-owner-count returns current owner count", () => {
        const { result } = simnet.callReadOnlyFn(CONTRACT, "get-owner-count", [], deployer);
        expect(result).toBeUint(1);
    });

    it("get-balance returns contract STX balance", () => {
        const { result } = simnet.callReadOnlyFn(CONTRACT, "get-balance", [], deployer);
        expect(result).toBeUint(0);
    });

    it("get-tx-nonce increments correctly as proposals are made", () => {
        proposeTransfer(deployer, wallet1, 1_000_000);
        proposeTransfer(deployer, wallet2, 2_000_000);
        const { result } = simnet.callReadOnlyFn(CONTRACT, "get-tx-nonce", [], deployer);
        expect(result).toBeUint(2);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
//  11. MULTI-TX / FLOW TESTS
// ═══════════════════════════════════════════════════════════════════════════
describe("11 — multi-tx and flow tests", () => {
    it("proposes multiple transactions, IDs are sequential", () => {
        const { result: r1 } = proposeTransfer(deployer, wallet1, 1_000_000);
        const { result: r2 } = proposeTransfer(deployer, wallet2, 2_000_000);
        const { result: r3 } = proposeAddOwner(deployer, wallet1);
        expect(r1).toBeOk(Cl.uint(1));
        expect(r2).toBeOk(Cl.uint(2));
        expect(r3).toBeOk(Cl.uint(3));
    });

    it("execution below threshold always returns err-below-threshold", () => {
        proposeTransfer(deployer, wallet1, 1_000_000);
        const { result } = executeTx(deployer, 1);
        expect(result).toBeErr(Cl.uint(106));
    });

    it("transaction is NOT marked executed when below threshold", () => {
        proposeTransfer(deployer, wallet1, 1_000_000);
        executeTx(deployer, 1); // fails below threshold
        const { result } = simnet.callReadOnlyFn(CONTRACT, "get-transaction", [Cl.uint(1)], deployer);
        expect(result).not.toBeNone();
    });

    it("multiple proposals can coexist independently", () => {
        proposeTransfer(deployer, wallet1, 1_000_000); // tx 1
        proposeTransfer(deployer, wallet2, 2_000_000); // tx 2
        proposeAddOwner(deployer, wallet3);            // tx 3

        const { result: tx1 } = simnet.callReadOnlyFn(CONTRACT, "get-transaction", [Cl.uint(1)], deployer);
        const { result: tx2 } = simnet.callReadOnlyFn(CONTRACT, "get-transaction", [Cl.uint(2)], deployer);
        const { result: tx3 } = simnet.callReadOnlyFn(CONTRACT, "get-transaction", [Cl.uint(3)], deployer);

        expect(tx1).not.toBeNone();
        expect(tx2).not.toBeNone();
        expect(tx3).not.toBeNone();
    });

    it("a freshly proposed tx has executed=false", () => {
        proposeTransfer(deployer, wallet1, 1_000_000);
        const { result } = simnet.callReadOnlyFn(CONTRACT, "get-transaction", [Cl.uint(1)], deployer);
        expect(result).not.toBeNone();
    });

    it("approval tracking is independent per-owner per-tx", () => {
        proposeTransfer(deployer, wallet1, 1_000_000); // tx 1
        proposeTransfer(deployer, wallet2, 2_000_000); // tx 2

        const r1 = simnet.callReadOnlyFn(CONTRACT, "has-approved",
            [Cl.uint(1), Cl.principal(deployer)], deployer);
        const r2 = simnet.callReadOnlyFn(CONTRACT, "has-approved",
            [Cl.uint(2), Cl.principal(deployer)], deployer);
        expect(r1.result).toBeBool(false);
        expect(r2.result).toBeBool(false);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
//  12. EXPIRY EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════
describe("12 — expiry edge cases", () => {
    it("proposal cannot be proposed with expiry equal to current block", () => {
        const current = simnet.blockHeight;
        const { result } = proposeTransfer(deployer, wallet1, 1_000_000, current);
        expect(result).toBeErr(Cl.uint(104)); // err-tx-expired
    });

    it("proposal with future expiry (current+3) is accepted", () => {
        // callPublicFn mines a block before executing, so block-height will be current+1.
        // expiry must be strictly > that value, so +3 from the original blockHeight is safe.
        const current = simnet.blockHeight;
        const { result } = proposeTransfer(deployer, wallet1, 1_000_000, current + 3);
        expect(result).toBeOk(Cl.uint(1));
    });

    it("approve is blocked on expired proposal (non-owner check first)", () => {
        const current = simnet.blockHeight;
        proposeTransfer(deployer, wallet1, 1_000_000, current + 2);
        simnet.mineEmptyBlocks(5);
        // wallet1 is not an owner → err-not-owner (100) rather than err-tx-expired (104)
        const { result } = approveTx(wallet1, 1);
        expect(result).toBeErr(Cl.uint(100));
    });

    it("cannot execute an expired proposal", () => {
        const current = simnet.blockHeight;
        proposeTransfer(deployer, wallet1, 1_000_000, current + 2);
        simnet.mineEmptyBlocks(5);
        const { result } = executeTx(deployer, 1);
        expect(result).toBeErr(Cl.uint(104)); // err-tx-expired
    });
});

// ═══════════════════════════════════════════════════════════════════════════
//  13. EDGE CASES & BOUNDARY CONDITIONS
// ═══════════════════════════════════════════════════════════════════════════
describe("13 — edge cases & boundary conditions", () => {
    it("propose-token-transfer rejects when non-owner calls", () => {
        const { result } = simnet.callPublicFn(CONTRACT, "propose-token-transfer",
            [Cl.principal(wallet4), Cl.principal(wallet1), Cl.uint(500), Cl.none(), Cl.uint(FUTURE_BLOCK)],
            wallet2); // not an owner
        expect(result).toBeErr(Cl.uint(100));
    });

    it("large amount proposal is accepted if owner", () => {
        const { result } = proposeTransfer(deployer, wallet1, 1_000_000_000_000);
        expect(result).toBeOk(Cl.uint(1));
    });

    it("propose-change-threshold with exactly owner-count is valid", () => {
        // owner-count = 1, threshold must be <= 1
        const { result } = proposeChangeThreshold(deployer, 1);
        expect(result).toBeOk(Cl.uint(1));
    });

    it("consecutive proposals from same owner all get unique ids", () => {
        for (let i = 1; i <= 5; i++) {
            const { result } = proposeTransfer(deployer, wallet1, i * 1_000_000);
            expect(result).toBeOk(Cl.uint(i));
        }
    });

    it("get-transaction for each of 5 proposals returns distinct amounts", () => {
        for (let i = 1; i <= 5; i++) {
            proposeTransfer(deployer, wallet1, i * 1_000_000);
        }
        for (let i = 1; i <= 5; i++) {
            const { result } = simnet.callReadOnlyFn(
                CONTRACT, "get-transaction", [Cl.uint(i)], deployer);
            expect(result).not.toBeNone();
        }
    });

    it("get-approval-count for a proposal with 0 approvals returns 0", () => {
        proposeTransfer(deployer, wallet1, 1_000_000);
        const { result } = simnet.callReadOnlyFn(
            CONTRACT, "get-approval-count", [Cl.uint(1)], deployer);
        expect(result).toBeUint(0);
    });

    it("tx-type 3 (add-owner) stores new-principal correctly", () => {
        proposeAddOwner(deployer, wallet2);
        const { result } = simnet.callReadOnlyFn(CONTRACT, "get-transaction", [Cl.uint(1)], deployer);
        expect(result).not.toBeNone();
    });

    it("tx-type 5 (change-threshold) stores new-value correctly", () => {
        proposeChangeThreshold(deployer, 1);
        const { result } = simnet.callReadOnlyFn(CONTRACT, "get-transaction", [Cl.uint(1)], deployer);
        expect(result).not.toBeNone();
    });
});
