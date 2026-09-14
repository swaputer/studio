import assert from "node:assert/strict";
import test from "node:test";
import { STUDIO_TEMPLATES, compileStudioSource, encodeConstructorArguments, parseScalar } from "../src/lib/studio.ts";

test("published TinySol compiler builds the default Studio template", async () => {
  assert.equal(STUDIO_TEMPLATES.length, 1);
  assert.equal(STUDIO_TEMPLATES[0].id, "counter");
  const template = STUDIO_TEMPLATES[0];
  const build = await compileStudioSource(template.source, template.fileName);
  assert.equal(build.contractName, "Counter");
  assert.deepEqual(build.constructorTypes, ["uint256"]);
  assert.deepEqual(build.constructorNames, ["initial"]);
  assert.equal(build.languageVersion, "1.1");
  assert.equal(build.compilerVersion, "0.4.0");
  assert.ok(build.packageLength > build.codeLength);
  assert.match(build.codeHash, /^0x[0-9a-f]{64}$/i);
});

test("Studio exposes the canonical flattened ABI for TinySol v1.1 values", async () => {
  const build = await compileStudioSource(`contract Modern {
    struct Pair { uint24 left; bool ok; }
    function echo(string<4> text, bytes<3> blob, uint24[2] values, Pair pair) external view returns(string<4>,bytes<3>,uint24[2],Pair) {
      return text,blob,values,pair;
    }
  }`, "modern.tsol");
  const fn = build.functions[0];
  assert.equal(fn.signature, "echo(uint256,uint8,uint8,uint8,uint8,uint256,uint8,uint8,uint8,uint24,uint24,uint24,bool)");
  assert.deepEqual(fn.inputNames, [
    "text.length", "text.data[0]", "text.data[1]", "text.data[2]", "text.data[3]",
    "blob.length", "blob.data[0]", "blob.data[1]", "blob.data[2]",
    "values[0]", "values[1]", "pair.left", "pair.ok"
  ]);
  assert.deepEqual(fn.inputs, fn.outputs);
});

test("account values use their canonical bytes32 ABI type", async () => {
  const build = await compileStudioSource("contract Accounts { constructor(account owner) {} function echo(account value) external view returns(account) { return value; } }", "accounts.tsol");
  assert.deepEqual(build.constructorTypes, ["bytes32"]);
  assert.deepEqual(build.functions[0].inputs, ["bytes32"]);
  assert.deepEqual(build.functions[0].outputs, ["bytes32"]);
});

test("Studio validates every TinySol scalar ABI width", () => {
  assert.equal(parseScalar("uint8", "255"), 255n);
  assert.equal(parseScalar("int24", "-8388608"), -8388608n);
  assert.equal(parseScalar("bool", "true"), true);
  assert.equal(parseScalar("address", "0x1111111111111111111111111111111111111111"), "0x1111111111111111111111111111111111111111");
  assert.equal(parseScalar("bytes2", "0xabcd"), "0xabcd");
  assert.throws(() => parseScalar("uint8", "256"), /outside the uint8 range/);
  assert.throws(() => parseScalar("int24", "1.5"), /whole numbers/);
  assert.throws(() => parseScalar("bytes2", "0xab"), /exactly 2 bytes/);
});

test("constructor arguments are ABI encoded deterministically", () => {
  assert.equal(encodeConstructorArguments([], []), "0x");
  assert.equal(encodeConstructorArguments(["uint256"], ["1"]), `0x${"0".repeat(63)}1`);
  assert.throws(() => encodeConstructorArguments(["uint256"], [""]), /Complete every constructor argument/);
});
