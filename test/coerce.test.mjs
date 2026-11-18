// 0.5.4: freeSearch / checkQuery / checkCount tolerate tool-input objects and other wrong-typed args.
import { test } from "node:test";
import assert from "node:assert/strict";
import { freeSearch, checkQuery, checkCount, coerceCount, InvalidInputError } from "../dist/index.js";

function counter() {
  const calls = [];
  const f = async (url, init) => { calls.push(JSON.parse(init.body)); return new Response(JSON.stringify({ results: [] }), { status: 200 }); };
  return { f, calls };
}

test("freeSearch: whole tool-input object as query is unwrapped", async () => {
  const { f, calls } = counter();
  await freeSearch({ query: "langchain release", max_results: 3 }, undefined, f);
  assert.deepEqual(calls, [{ query: "langchain release" }]);
});

test("freeSearch: RunnableConfig-like object in the max_results slot is ignored (default)", async () => {
  const { f, calls } = counter();
  await freeSearch("hello world", { callbacks: [], tags: [], configurable: {} }, f);
  assert.deepEqual(calls, [{ query: "hello world" }]);
});

test("freeSearch: max_results as tool-input object, nested value, numeric string, float, junk", async () => {
  const { f, calls } = counter();
  await freeSearch("hello", { max_results: 3 }, f);
  await freeSearch("hello", { value: { max_results: "2" } }, f);
  await freeSearch("hello", "4", f);
  await freeSearch("hello", 99.7, f);
  await freeSearch("hello", "lots", f);
  await freeSearch("hello", 0, f);
  assert.deepEqual(calls.map((c) => c.max_results), [3, 2, 4, 5, undefined, 1]);
});

test("freeSearch: empty / missing / non-string query fails locally, no request", async () => {
  const { f, calls } = counter();
  for (const q of [undefined, null, "", "   ", {}, { query: "" }, { max_results: 3 }, [], true]) {
    await assert.rejects(() => freeSearch(q, undefined, f), (e) => e instanceof InvalidInputError && /query/.test(e.message) && /Nothing was sent or charged/.test(e.message));
  }
  assert.equal(calls.length, 0);
});

test("checkQuery: unwraps objects and arrays, stringifies numbers", () => {
  assert.equal(checkQuery({ query: " abc " }), "abc");
  assert.equal(checkQuery({ input: { q: "xyz" } }), "xyz");
  assert.equal(checkQuery(["one two"]), "one two");
  assert.equal(checkQuery(2026), "2026");
  assert.throws(() => checkQuery({ query: 5 }) && checkQuery(5), InvalidInputError); // 1 char
});

test("checkCount / coerceCount", () => {
  assert.equal(checkCount({ max_results: 3 }, "n"), 3);
  assert.equal(checkCount({ foo: 1 }, "n"), undefined);
  assert.equal(checkCount(" 7 ", "n"), 5);
  assert.equal(checkCount(true, "n"), undefined);
  assert.throws(() => checkCount("x", "n"), InvalidInputError);
  assert.equal(coerceCount("x"), undefined);
  assert.equal(coerceCount({ num_results: "12" }, "n", 1, 10), 10);
});
