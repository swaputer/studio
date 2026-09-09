import {
  AbiCoder,
  BrowserProvider,
  Contract,
  Interface,
  JsonRpcProvider,
  concat,
  getAddress,
  hexlify,
  id,
  keccak256,
  toBeHex,
  type ContractRunner,
  type ContractTransactionReceipt,
  type Signer
} from "ethers";
import { decodeVMReceipt } from "@swaputer-labs/receipt-codec";
import { KERNEL_ABI, NETWORK, SWAPVM, TRANSACTION_CONFIRMATIONS } from "./config";
import { assertCanonicalTransactionReceipt } from "./transactionFinality";
import {
  UNIVERSAL_ROUTER_ABI,
  encodeDirectSVMUniversalRouterSwap,
  resolveVMExecutionBinding,
  type VMExecutionRoute,
  type VMEnvelope
} from "./universalRouter";
export type { VMExecutionRoute } from "./universalRouter";

const abi = AbiCoder.defaultAbiCoder();
const kernelInterface = new Interface(KERNEL_ABI);
export const readProvider = new JsonRpcProvider(NETWORK.rpcUrl, NETWORK.chainId, { staticNetwork: true });

export interface WalletConnection { readonly provider: BrowserProvider; readonly signer: Signer; readonly address: string }

export function friendlyError(error: unknown): string {
  if (error instanceof Error) {
    const nested = error as Error & { shortMessage?: string; reason?: string };
    return nested.shortMessage || nested.reason || nested.message;
  }
  return "The requested operation could not be completed.";
}

export function short(value: string, start = 6, end = 4): string {
  return value ? `${value.slice(0, start)}…${value.slice(-end)}` : "—";
}

export async function connectWallet(): Promise<WalletConnection> {
  if (!window.ethereum) throw new Error("No compatible browser wallet was detected.");
  const provider = new BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(NETWORK.chainId)) {
    try {
      await provider.send("wallet_switchEthereumChain", [{ chainId: NETWORK.chainIdHex }]);
    } catch (error) {
      if ((error as { code?: number }).code !== 4902) throw error;
      await provider.send("wallet_addEthereumChain", [{
        chainId: NETWORK.chainIdHex,
        chainName: NETWORK.chainName,
        nativeCurrency: NETWORK.nativeCurrency,
        rpcUrls: [NETWORK.rpcUrl],
        blockExplorerUrls: [NETWORK.explorerUrl]
      }]);
    }
  }
  const signer = await provider.getSigner();
  return { provider, signer, address: await signer.getAddress() };
}

function requireProtocol(): void {
  if (!SWAPVM.enabled) throw new Error("Protocol addresses are not configured for this build.");
}

function requireDirectProtocol(): void {
  requireProtocol();
  if (!SWAPVM.directEnabled) {
    throw new Error("The official Uniswap Universal Router is not configured for this Swaputer release.");
  }
}

export function kernelContract(runner: ContractRunner = readProvider): Contract {
  requireProtocol();
  return new Contract(SWAPVM.kernel, KERNEL_ABI, runner);
}

export async function readAccountId(address: string, runner: ContractRunner = readProvider): Promise<string> {
  return await kernelContract(runner).getFunction("eoaAccountId").staticCall(getAddress(address)) as string;
}

async function vmRead(target: string, signature: string, inputTypes: readonly string[] = [], values: readonly unknown[] = [], limit = 3_000, caller?: string | null) {
  requireProtocol();
  if (!/^0x[0-9a-fA-F]{64}$/.test(target)) throw new Error("Enter a valid 32-byte Mini Contract address.");
  const encoded = inputTypes.length ? abi.encode([...inputTypes], [...values]) : "0x";
  const payload = `${id(signature).slice(0, 10)}${encoded.slice(2)}`;
  const overrides = caller ? { from: getAddress(caller) } : {};
  const [output, bytesUsed] = await kernelContract().getFunction("staticCall").staticCall(SWAPVM.worldId, target, payload, limit, overrides) as [string, bigint];
  return { output, bytesUsed };
}

export const VM_ACTION_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  VMAction: [
    { name: "op", type: "uint8" }, { name: "worldId", type: "bytes32" },
    { name: "actor", type: "address" }, { name: "targetOrCodeHash", type: "bytes32" },
    { name: "payloadHash", type: "bytes32" }, { name: "byteGasLimit", type: "uint32" },
    { name: "minNetTokenOut", type: "uint128" }, { name: "exactEthAmountIn", type: "uint128" },
    { name: "sqrtPriceLimitX96", type: "uint160" }, { name: "recipient", type: "address" },
    { name: "router", type: "address" }, { name: "authorizedExecutor", type: "address" },
    { name: "nonce", type: "uint64" }, { name: "deadline", type: "uint64" }
  ]
};

export interface CallOptions {
  readonly recipient?: string;
  readonly authorizedExecutor?: string;
  readonly exactEthAmountIn?: bigint;
  readonly byteGasLimit?: number;
  readonly executionRoute?: VMExecutionRoute;
}

async function signedEnvelope(
  signer: Signer,
  actorAddress: string,
  operation: 1 | 2,
  target: string,
  payload: string,
  options: CallOptions = {}
) {
  const executionRoute = options.executionRoute ?? "universal-router";
  if (executionRoute === "universal-router") requireDirectProtocol();
  else requireProtocol();
  const actor = getAddress(actorAddress);
  const actorId = await readAccountId(actor, signer);
  const nonce = await kernelContract(signer).getFunction("nonces").staticCall(SWAPVM.worldId, actorId) as bigint;
  const deadline = BigInt(Math.floor(Date.now() / 1_000) + 20 * 60);
  const vmInput = options.exactEthAmountIn ?? SWAPVM.vmInputWei!;
  const binding = resolveVMExecutionBinding(
    executionRoute,
    actor,
    SWAPVM.universalRouter,
    SWAPVM.router,
    options.authorizedExecutor
  );
  const action = {
    op: operation,
    worldId: SWAPVM.worldId,
    actor,
    targetOrCodeHash: target,
    payloadHash: keccak256(payload),
    byteGasLimit: options.byteGasLimit ?? 20_000,
    minNetTokenOut: SWAPVM.minNetTokenOut,
    exactEthAmountIn: vmInput,
    sqrtPriceLimitX96: SWAPVM.sqrtPriceLimitX96!,
    recipient: options.recipient ?? actor,
    router: binding.router,
    authorizedExecutor: binding.authorizedExecutor,
    nonce,
    deadline
  };
  const signature = await signer.signTypedData({
    name: "Swaputer", version: SWAPVM.protocolVersion, chainId: NETWORK.chainId,
    verifyingContract: SWAPVM.kernel, salt: SWAPVM.worldId
  }, VM_ACTION_TYPES, action);
  return {
    envelope: {
      op: action.op, worldId: action.worldId, actor: action.actor, targetOrCodeHash: action.targetOrCodeHash,
      payload, byteGasLimit: action.byteGasLimit, minNetTokenOut: action.minNetTokenOut,
      nonce: action.nonce, deadline: action.deadline, recipient: action.recipient,
      authorizedExecutor: action.authorizedExecutor, signature
    },
    vmInput,
    deadline,
    executionRoute
  };
}

async function signedCallEnvelope(signer: Signer, actorAddress: string, target: string, payload: string, options: CallOptions = {}) {
  return signedEnvelope(signer, actorAddress, 2, target, payload, options);
}

export async function buildSignedCallEnvelope(signer: Signer, actorAddress: string, target: string, payload: string, options: CallOptions = {}) {
  return signedCallEnvelope(signer, actorAddress, target, payload, options);
}

async function executeDirectSVMEnvelope(
  signer: Signer,
  envelope: VMEnvelope,
  vmInput: bigint,
  deadline: bigint,
  onSubmitted?: (hash: string) => void
): Promise<ContractTransactionReceipt> {
  requireDirectProtocol();
  const swap = encodeDirectSVMUniversalRouterSwap(envelope, {
    gasToken: SWAPVM.gasToken,
    hook: SWAPVM.hook,
    fee: SWAPVM.poolFee,
    tickSpacing: SWAPVM.tickSpacing
  }, vmInput);
  const router = new Contract(SWAPVM.universalRouter, UNIVERSAL_ROUTER_ABI, signer);
  const transaction = await router.getFunction("execute")(
    swap.commands,
    swap.inputs,
    deadline,
    { value: swap.value }
  );
  return waitForConfirmation(transaction, onSubmitted);
}

export class TransactionStatusUnknownError extends Error {
  readonly transactionHash: string;
  constructor(transactionHash: string, cause?: unknown) {
    super(`Transaction ${transactionHash} was submitted, but its confirmation status could not be checked. Inspect it in Explorer before retrying.`, { cause });
    this.name = "TransactionStatusUnknownError";
    this.transactionHash = transactionHash;
  }
}

export function isTransactionStatusUnknown(error: unknown): error is TransactionStatusUnknownError {
  return error instanceof TransactionStatusUnknownError;
}

async function requireCanonicalConfirmation(receipt: ContractTransactionReceipt): Promise<ContractTransactionReceipt> {
  try {
    return await assertCanonicalTransactionReceipt(receipt, TRANSACTION_CONFIRMATIONS);
  } catch (cause) {
    throw new TransactionStatusUnknownError(receipt.hash, cause);
  }
}

export async function waitForConfirmation(transaction: { hash: string; wait(confirmations?: number): Promise<ContractTransactionReceipt | null> }, onSubmitted?: (hash: string) => void) {
  onSubmitted?.(transaction.hash);
  let receipt: ContractTransactionReceipt | null;
  try {
    receipt = await transaction.wait(TRANSACTION_CONFIRMATIONS);
  } catch (cause) {
    if (cause instanceof TransactionStatusUnknownError) throw cause;
    const replacement = cause as {
      code?: string;
      cancelled?: boolean;
      replacement?: { hash?: string };
      receipt?: ContractTransactionReceipt | null;
    };
    if (replacement.code === "TRANSACTION_REPLACED") {
      if (!replacement.cancelled && replacement.receipt?.status === 1) {
        const replacementHash = replacement.replacement?.hash || replacement.receipt.hash;
        if (replacementHash && replacementHash !== transaction.hash) onSubmitted?.(replacementHash);
        return requireCanonicalConfirmation(replacement.receipt);
      }
      if (replacement.cancelled) throw new Error("The transaction was cancelled in the wallet.");
      if (replacement.receipt?.status === 0) throw new Error("The replacement transaction was confirmed but failed.");
    }
    if (replacement.receipt?.status === 0) throw new Error("The transaction was confirmed but failed.");
    throw new TransactionStatusUnknownError(replacement.replacement?.hash || transaction.hash, cause);
  }
  if (!receipt) throw new TransactionStatusUnknownError(transaction.hash);
  if (receipt.status !== 1) throw new Error("The transaction was confirmed but failed.");
  return requireCanonicalConfirmation(receipt);
}

export async function writeMiniContract(
  signer: Signer,
  actor: string,
  target: string,
  signature: string,
  inputTypes: readonly string[],
  values: readonly unknown[],
  byteGasLimit = 20_000,
  onSubmitted?: (hash: string) => void
): Promise<ContractTransactionReceipt> {
  const encoded = inputTypes.length ? abi.encode([...inputTypes], [...values]) : "0x";
  const payload = `${id(signature).slice(0, 10)}${encoded.slice(2)}`;
  const { envelope, vmInput, deadline } = await signedCallEnvelope(signer, actor, target, payload, { byteGasLimit });
  return executeDirectSVMEnvelope(signer, envelope, vmInput, deadline, onSubmitted);
}

export async function readMiniContract(target: string, signature: string, inputTypes: readonly string[], outputTypes: readonly string[], values: readonly unknown[], caller?: string | null) {
  const { output, bytesUsed } = await vmRead(target, signature, inputTypes, values, 20_000, caller);
  const decoded = outputTypes.length ? abi.decode([...outputTypes], output) : [];
  return { values: Array.from(decoded).map((item) => typeof item === "bigint" ? item.toString() : String(item)), bytesUsed };
}

const PACKAGE_HEADER_BYTES = 44;
export interface PackageInspection { readonly packageHex: string; readonly packageLength: number; readonly codeLength: number; readonly codeHash: string; readonly abiHash: string }
export interface DeploymentPreview { readonly actorId: string; readonly creatorNonce: bigint; readonly programId: string; readonly codeHash: string }
export interface DeploymentConfirmation extends DeploymentPreview {
  readonly confirmedProgramId: string | null;
  readonly receipt: ContractTransactionReceipt;
}

function readU16(bytes: Uint8Array, offset: number): number { return (bytes[offset]! << 8) | bytes[offset + 1]!; }
export function inspectPackage(input: Uint8Array): PackageInspection {
  const bytes = new Uint8Array(input);
  if (bytes.length < PACKAGE_HEADER_BYTES || hexlify(bytes.slice(0, 4)) !== "0x53564d31") throw new Error("Select a valid SVM1 package.");
  const codeLength = readU16(bytes, 10);
  if (codeLength !== bytes.length - PACKAGE_HEADER_BYTES || codeLength < 1 || codeLength > 16_384) throw new Error("The SVM code length is invalid.");
  return { packageHex: hexlify(bytes), packageLength: bytes.length, codeLength, abiHash: hexlify(bytes.slice(12, 44)), codeHash: keccak256(bytes) };
}

export async function previewDeployment(actorAddress: string, packageBytes: Uint8Array, runner: ContractRunner = readProvider): Promise<DeploymentPreview> {
  const inspected = inspectPackage(packageBytes);
  const actorId = await readAccountId(actorAddress, runner);
  const creatorNonce = await kernelContract(runner).getFunction("creatorNonce").staticCall(SWAPVM.worldId, actorId) as bigint;
  const programId = await kernelContract(runner).getFunction("contractAccountId").staticCall(SWAPVM.worldId, actorId, creatorNonce, inspected.codeHash) as string;
  return { actorId, creatorNonce, programId, codeHash: inspected.codeHash };
}

function deploymentFromReceipt(receipt: ContractTransactionReceipt, expectedCodeHash: string): string | null {
  const expectedKernel = SWAPVM.kernel.toLowerCase();
  const expectedWorld = SWAPVM.worldId.toLowerCase();
  const expectedHash = expectedCodeHash.toLowerCase();
  for (const log of receipt.logs ?? []) {
    if (log.address.toLowerCase() !== expectedKernel) continue;
    try {
      const parsed = kernelInterface.parseLog({ topics: [...log.topics], data: log.data });
      if (!parsed || parsed.name !== "Events" || String(parsed.args[0]).toLowerCase() !== expectedWorld) continue;
      const decoded = decodeVMReceipt(String(parsed.args[2]) as `0x${string}`);
      const rootTarget = decoded.worldExecution.rootTarget.toLowerCase();
      const deployment = decoded.records.find((record) => record.kind === "miniContractDeployed"
        && record.decoded.contractId.toLowerCase() === rootTarget
        && record.decoded.codeHash.toLowerCase() === expectedHash);
      if (deployment?.kind === "miniContractDeployed") return deployment.decoded.contractId;
    } catch {
      // The receipt can include unrelated Kernel logs. Only a fully decoded,
      // matching root deployment is authoritative for the deployed program ID.
    }
  }
  return null;
}

export async function deployMiniContract(
  signer: Signer, actorAddress: string, packageBytes: Uint8Array, constructorArgs = "0x", byteGasLimit = 20_000,
  onSubmitted?: (hash: string) => void
): Promise<DeploymentConfirmation> {
  requireProtocol();
  const preview = await previewDeployment(actorAddress, packageBytes, signer);
  const compactArgs = constructorArgs.trim() || "0x";
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(compactArgs)) throw new Error("Constructor arguments must be complete hexadecimal bytes.");
  const inspected = inspectPackage(packageBytes);
  const payload = hexlify(concat([toBeHex(inspected.packageLength, 4), inspected.packageHex, compactArgs]));
  const actor = getAddress(actorAddress);
  const { envelope, vmInput, deadline } = await signedEnvelope(
    signer,
    actor,
    1,
    preview.codeHash,
    payload,
    { byteGasLimit }
  );
  const receipt = await executeDirectSVMEnvelope(signer, envelope, vmInput, deadline, onSubmitted);
  return { ...preview, confirmedProgramId: deploymentFromReceipt(receipt, preview.codeHash), receipt };
}
