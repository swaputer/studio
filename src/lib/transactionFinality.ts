export interface CanonicalReceiptProvider {
  getTransactionReceipt(hash: string): Promise<{
    readonly hash: string;
    readonly status: number | null;
    readonly blockHash: string;
    readonly blockNumber: number;
    readonly index: number;
  } | null>;
  getTransaction(hash: string): Promise<{
    readonly hash: string;
    readonly blockHash: string | null;
    readonly blockNumber: number | null;
    readonly index: number;
  } | null>;
  getBlock(blockNumber: number): Promise<{
    readonly hash: string | null;
    readonly number: number;
  } | null>;
  getBlockNumber(): Promise<number>;
}

export interface CanonicalReceiptCandidate {
  readonly hash: string;
  readonly status: number | null;
  readonly blockHash: string;
  readonly blockNumber: number;
  readonly index: number;
  readonly provider: CanonicalReceiptProvider;
}

export class TransactionFinalityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransactionFinalityError";
  }
}

function sameHex(left: string | null | undefined, right: string | null | undefined): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

/**
 * Re-reads the mined transaction by both hash and block height. Waiting for a
 * confirmation count alone is insufficient if an RPC has retained an orphaned
 * receipt after a short reorganisation.
 */
export async function assertCanonicalTransactionReceipt<T extends CanonicalReceiptCandidate>(
  receipt: T,
  requiredConfirmations: number
): Promise<T> {
  if (!Number.isSafeInteger(requiredConfirmations) || requiredConfirmations < 1) {
    throw new TransactionFinalityError("The transaction confirmation policy is invalid.");
  }
  if (receipt.status !== 1 || !Number.isSafeInteger(receipt.blockNumber) || receipt.blockNumber < 0) {
    throw new TransactionFinalityError("The transaction does not have a successful mined receipt.");
  }

  const [canonicalReceipt, transaction, canonicalBlock, latestBlockNumber] = await Promise.all([
    receipt.provider.getTransactionReceipt(receipt.hash),
    receipt.provider.getTransaction(receipt.hash),
    receipt.provider.getBlock(receipt.blockNumber),
    receipt.provider.getBlockNumber()
  ]);

  if (!canonicalReceipt
    || canonicalReceipt.status !== 1
    || !sameHex(canonicalReceipt.hash, receipt.hash)
    || !sameHex(canonicalReceipt.blockHash, receipt.blockHash)
    || canonicalReceipt.blockNumber !== receipt.blockNumber
    || canonicalReceipt.index !== receipt.index) {
    throw new TransactionFinalityError("The submitted transaction receipt is no longer canonical.");
  }
  if (!transaction
    || !sameHex(transaction.hash, receipt.hash)
    || !sameHex(transaction.blockHash, receipt.blockHash)
    || transaction.blockNumber !== receipt.blockNumber
    || transaction.index !== receipt.index) {
    throw new TransactionFinalityError("The submitted transaction is not linked to its canonical receipt.");
  }
  if (!canonicalBlock
    || canonicalBlock.number !== receipt.blockNumber
    || !sameHex(canonicalBlock.hash, receipt.blockHash)) {
    throw new TransactionFinalityError("The containing block is no longer canonical.");
  }

  const confirmations = latestBlockNumber - receipt.blockNumber + 1;
  if (!Number.isSafeInteger(latestBlockNumber) || confirmations < requiredConfirmations) {
    throw new TransactionFinalityError(`The transaction has ${Math.max(confirmations, 0)} of ${requiredConfirmations} required confirmations.`);
  }
  return receipt;
}
