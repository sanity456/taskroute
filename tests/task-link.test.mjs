import assert from "node:assert/strict";
import test from "node:test";
import { rememberedTaskKey, taskStorageKey, validTaskKey } from "../src/task-link.ts";

const key = `0x${"a".repeat(40)}:my-task_1`;

test("accepts only creator-scoped task keys", () => {
  assert.equal(validTaskKey(key), true);
  assert.equal(validTaskKey("my-task_1"), false);
  assert.equal(validTaskKey(`0x${"z".repeat(40)}:my-task_1`), false);
});

test("deep link takes precedence over remembered task", () => {
  const other = `0x${"b".repeat(40)}:other-task`;
  assert.equal(rememberedTaskKey(`?task=${encodeURIComponent(other)}`, key), other);
  assert.equal(rememberedTaskKey("?task=invalid", key), key);
});

test("remembered task is isolated by contract deployment", () => {
  assert.notEqual(taskStorageKey(`0x${"a".repeat(40)}`), taskStorageKey(`0x${"b".repeat(40)}`));
  assert.equal(rememberedTaskKey("", null), "");
});
