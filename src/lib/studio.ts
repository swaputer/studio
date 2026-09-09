import { AbiCoder } from "ethers";

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
  readonly functions: readonly StudioFunction[];
  readonly abi: string;
  readonly manifest: string;
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

function signatureTypes(signature: string, prefix: string): readonly string[] {
  if (!signature.startsWith(`${prefix}(`) || !signature.endsWith(")")) return [];
  const body = signature.slice(prefix.length + 1, -1).trim();
  return body ? Object.freeze(body.split(",").map((item) => item.trim())) : [];
}

export async function compileStudioSource(source: string, fileName: string): Promise<StudioBuild> {
  const compiler = await import("@swaputer-labs/tinysol");
  const result = compiler.compileTinySol(source, { sourceName: fileName });
  return Object.freeze({
    contractName: result.abi.contract,
    fileName: `${result.abi.contract}.svm`,
    packageBytes: new Uint8Array(result.packageBytes),
    packageLength: result.packageBytes.length,
    codeLength: result.code.length,
    codeHash: result.codeHash,
    abiHash: result.abi.abiHash,
    constructorSignature: result.abi.constructor,
    constructorTypes: signatureTypes(result.abi.constructor, "constructor"),
    functions: Object.freeze(result.abi.functions.map((fn) => Object.freeze({
      name: fn.name,
      signature: fn.signature,
      selector: fn.selector,
      inputs: Object.freeze([...fn.inputs]),
      outputs: Object.freeze([...fn.outputs]),
      view: fn.view
    }))),
    abi: compiler.encodeCompilerArtifact(result.abi),
    manifest: compiler.encodeCompilerArtifact(result.manifest)
  });
}

export function encodeConstructorArguments(types: readonly string[], values: readonly string[]): string {
  if (types.length === 0) return "0x";
  if (types.length !== values.length || values.some((entry) => entry.trim() === "")) throw new Error("Complete every constructor argument before deploying.");
  return AbiCoder.defaultAbiCoder().encode([...types], values.map((entry, index) => parseScalar(types[index]!, entry)));
}

export function parseScalar(type: string, value: string): unknown {
  const input = value.trim();
  if (type === "bool") {
    if (input !== "true" && input !== "false") throw new Error("Boolean arguments must be true or false.");
    return input === "true";
  }
  if (type === "uint256" || type === "int256") return BigInt(input);
  return input;
}

export async function formatStudioError(error: unknown): Promise<string> {
  if (error instanceof Error && !("code" in error)) return error.message;
  const compiler = await import("@swaputer-labs/tinysol");
  return compiler.formatDiagnostics(error) || (error instanceof Error ? error.message : "Compilation failed.");
}
