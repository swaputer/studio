import assert from "node:assert/strict";
import test from "node:test";
import { STUDIO_TEMPLATES, compileStudioSource, encodeConstructorArguments } from "../src/lib/studio.ts";

test("published TinySol compiler builds the default Studio template", async () => {
  assert.equal(STUDIO_TEMPLATES.length, 1);
  assert.equal(STUDIO_TEMPLATES[0].id, "counter");
  const template = STUDIO_TEMPLATES[0];
  const build = await compileStudioSource(template.source, template.fileName);
  assert.equal(build.contractName, "Counter");
  assert.deepEqual(build.constructorTypes, ["uint256"]);
  assert.ok(build.packageLength > build.codeLength);
  assert.match(build.codeHash, /^0x[0-9a-f]{64}$/i);
});

test("constructor arguments are ABI encoded deterministically", () => {
  assert.equal(encodeConstructorArguments([], []), "0x");
  assert.equal(encodeConstructorArguments(["uint256"], ["1"]), `0x${"0".repeat(63)}1`);
  assert.throws(() => encodeConstructorArguments(["uint256"], [""]), /Complete every constructor argument/);
});
