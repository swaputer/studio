import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  TransactionFinalityError,
  assertCanonicalTransactionReceipt
} from "../src/lib/transactionFinality.ts";

const transactionHash = `0x${"12".repeat(32)}`;
const blockHash = `0x${"34".repeat(32)}`;

function candidate(overrides = {}) {
  const receipt = {
    hash: transactionHash,
    status: 1,
    blockHash,
    blockNumber: 100,
    index: 2,
    provider: {
      getTransactionReceipt: async () => ({ hash: transactionHash, status: 1, blockHash, blockNumber: 100, index: 2 }),
      getTransaction: async () => ({ hash: transactionHash, blockHash, blockNumber: 100, index: 2 }),
      getBlock: async () => ({ hash: blockHash, number: 100 }),
      getBlockNumber: async () => 111
    }
  };
  return { ...receipt, ...overrides, provider: { ...receipt.provider, ...overrides.provider } };
}

test("accepts a canonically linked receipt at exactly twelve confirmations", async () => {
  const receipt = candidate();
  assert.equal(await assertCanonicalTransactionReceipt(receipt, 12), receipt);
});

test("rejects a receipt before the release confirmation floor", async () => {
  await assert.rejects(
    assertCanonicalTransactionReceipt(candidate({ provider: { getBlockNumber: async () => 110 } }), 12),
    error => error instanceof TransactionFinalityError && /11 of 12/.test(error.message)
  );
});

test("rejects orphaned receipts, containing blocks and transaction links", async () => {
  await assert.rejects(
    assertCanonicalTransactionReceipt(candidate({ provider: { getTransactionReceipt: async () => null } }), 12),
    /receipt is no longer canonical/
  );
  await assert.rejects(
    assertCanonicalTransactionReceipt(candidate({ provider: { getBlock: async () => ({ hash: `0x${"56".repeat(32)}`, number: 100 }) } }), 12),
    /containing block is no longer canonical/
  );
  await assert.rejects(
    assertCanonicalTransactionReceipt(candidate({ provider: { getTransaction: async () => ({ hash: transactionHash, blockHash, blockNumber: 100, index: 3 }) } }), 12),
    /not linked to its canonical receipt/
  );
});

test("Studio waits for the manifest confirmation count without a second RPC recheck", () => {
  const protocol = readFileSync(new URL("../src/lib/protocol.ts", import.meta.url), "utf8");
  const config = readFileSync(new URL("../src/lib/config.ts", import.meta.url), "utf8");
  assert.match(protocol, /transaction\.wait\(TRANSACTION_CONFIRMATIONS\)/);
  assert.doesNotMatch(protocol, /assertCanonicalTransactionReceipt/);
  assert.match(config, /activeRelease\.indexer\.confirmations/);
  assert.match(config, /configuredConfirmations < 1/);
});
