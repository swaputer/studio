import { AbiCoder, getAddress, isHexString } from "ethers";

export interface StudioTemplate {
  readonly id: string;
  readonly name: string;
  readonly fileName: string;
  readonly description: string;
  readonly source: string;
}

export interface StudioFunction {
  readonly name: string;
  readonly signature: string;
  readonly selector: string;
  readonly inputs: readonly string[];
  readonly inputNames: readonly string[];
  readonly outputs: readonly string[];
  readonly view: boolean;
}

export interface StudioBuild {
  readonly contractName: string;
  readonly fileName: string;
  readonly packageBytes: Uint8Array;
  readonly packageLength: number;
  readonly codeLength: number;
  readonly codeHash: string;
  readonly abiHash: string;
  readonly constructorSignature: string;
  readonly constructorTypes: readonly string[];
  readonly constructorNames: readonly string[];
  readonly functions: readonly StudioFunction[];
  readonly abi: string;
  readonly manifest: string;
  readonly languageVersion: string;
  readonly compilerVersion: string;
}

const COUNTER = `contract Counter {
  event Changed(account indexed by, uint256 value);
  uint256 value;

  constructor(uint256 initial) {
    value = initial;
  }

  function increment() external returns (uint256) {
    value = value + 1;
    emit Changed(msg.sender, value);
    return value;
  }

  function get() external view returns (uint256) {
    return value;
  }
}
`;

export const STUDIO_TEMPLATES: readonly StudioTemplate[] = Object.freeze([
  { id: "counter", name: "Counter", fileName: "counter.tsol", description: "State and return values", source: COUNTER }
]);

export const EMPTY_CONTRACT = `contract MyContract {
  constructor() {
  }

  function hello() external view returns (uint256) {
    return 1;
  }
}
`;

function canonicalAbiType(type: string): string {
  return type === "account" ? "bytes32" : type;
}

function readableParameterName(name: string, fallback: string): string {
  if (!name) return fallback;
  return name.split("$").reduce((result, part, index) => {
    if (index === 0) return part;
    return /^\d+$/.test(part) ? `${result}[${part}]` : `${result}.${part}`;
  }, "");
}

export async function compileStudioSource(source: string, fileName: string): Promise<StudioBuild> {
  const compiler = await import("@swaputer-labs/tinysol");
  const result = compiler.compileTinySol(source, { sourceName: fileName });
  const checked = compiler.checkTinySol(source, { sourceName: fileName });
  const constructorTypes = compiler.parseCanonicalSignature(result.abi.constructor).parameterTypes;
  const checkedConstructor = checked.program.contract.constructor?.kind === "ConstructorDeclaration"
    ? checked.program.contract.constructor
    : undefined;
  const checkedFunctions = new Map(checked.program.contract.functions
    .filter((fn) => fn.visibility === "external")
    .map((fn) => [fn.name, fn]));
  return Object.freeze({
    contractName: result.abi.contract,
    fileName: `${result.abi.contract}.svm`,
    packageBytes: new Uint8Array(result.packageBytes),
    packageLength: result.packageBytes.length,
    codeLength: result.code.length,
    codeHash: result.codeHash,
    abiHash: result.abi.abiHash,
    constructorSignature: result.abi.constructor,
    constructorTypes,
    constructorNames: Object.freeze(constructorTypes.map((_, index) => readableParameterName(
      checkedConstructor?.parameters[index]?.name ?? "",
      `Argument ${index + 1}`
    ))),
    functions: Object.freeze(result.abi.functions.map((fn) => Object.freeze({
      name: fn.name,
      signature: fn.signature,
      selector: fn.selector,
      inputs: compiler.parseCanonicalSignature(fn.signature).parameterTypes,
      inputNames: Object.freeze(fn.inputs.map((_, index) => readableParameterName(
        checkedFunctions.get(fn.name)?.parameters[index]?.name ?? "",
        `Argument ${index + 1}`
      ))),
      outputs: Object.freeze(fn.outputs.map(canonicalAbiType)),
      view: fn.view
    }))),
    abi: compiler.encodeCompilerArtifact(result.abi),
    manifest: compiler.encodeCompilerArtifact(result.manifest),
    languageVersion: result.compilerIdentity.languageVersion,
    compilerVersion: result.compilerIdentity.compilerVersion
  });
}

export function encodeConstructorArguments(types: readonly string[], values: readonly string[]): string {
  if (types.length === 0) return "0x";
  if (types.length !== values.length || values.some((entry) => entry.trim() === "")) throw new Error("Complete every constructor argument before deploying.");
  return AbiCoder.defaultAbiCoder().encode([...types], values.map((entry, index) => parseScalar(types[index]!, entry)));
}

export function parseScalar(type: string, value: string): unknown {
  const input = value.trim();
  if (!input) throw new Error(`${type} arguments cannot be empty.`);
  if (type === "bool") {
    if (input !== "true" && input !== "false") throw new Error("Boolean arguments must be true or false.");
    return input === "true";
  }
  const integer = /^(u?)int(\d+)$/.exec(type);
  if (integer) {
    const width = Number(integer[2]);
    if (width < 8 || width > 256 || width % 8 !== 0) throw new Error(`Unsupported TinySol ABI type: ${type}.`);
    let parsed: bigint;
    try { parsed = BigInt(input); }
    catch { throw new Error(`${type} arguments must be whole numbers.`); }
    const bits = BigInt(width);
    const minimum = integer[1] === "u" ? 0n : -(1n << (bits - 1n));
    const maximum = integer[1] === "u" ? (1n << bits) - 1n : (1n << (bits - 1n)) - 1n;
    if (parsed < minimum || parsed > maximum) throw new Error(`${input} is outside the ${type} range.`);
    return parsed;
  }
  if (type === "address") {
    try { return getAddress(input); }
    catch { throw new Error("Address arguments must be valid 20-byte hex addresses."); }
  }
  const fixedBytes = /^bytes([1-9]|[12]\d|3[0-2])$/.exec(type);
  if (fixedBytes) {
    const length = Number(fixedBytes[1]);
    if (!isHexString(input, length)) throw new Error(`${type} arguments must contain exactly ${length} bytes of hex data.`);
    return input;
  }
  if (type === "bytes") {
    if (!isHexString(input)) throw new Error("bytes arguments must be 0x-prefixed hex data.");
    return input;
  }
  if (type === "string") return input;
  throw new Error(`Unsupported TinySol ABI type: ${type}.`);
}

export async function formatStudioError(error: unknown): Promise<string> {
  if (error instanceof Error && !("code" in error)) return error.message;
  const compiler = await import("@swaputer-labs/tinysol");
  return compiler.formatDiagnostics(error) || (error instanceof Error ? error.message : "Compilation failed.");
}
