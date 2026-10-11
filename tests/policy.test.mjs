import assert from "node:assert/strict";
import test from "node:test";
import { isCompatiblePolicy, REQUIRED_DECISION_SCHEMA } from "../src/policy.ts";

test("current contract policy is accepted", () => {
  assert.equal(isCompatiblePolicy({ decision_schema: REQUIRED_DECISION_SCHEMA, rules_version: 4 }), true);
  assert.equal(isCompatiblePolicy({ decision_schema: "taskroute/v3-provenance-liveness", rules_version: 3 }), false);
});

test("legacy or incomplete contract policy is rejected", () => {
  assert.equal(isCompatiblePolicy({ rules_version: 1 }), false);
  assert.equal(isCompatiblePolicy({ decision_schema: REQUIRED_DECISION_SCHEMA, rules_version: 1 }), false);
  assert.equal(isCompatiblePolicy({ decision_schema: "taskroute/v2-banded-consensus", rules_version: 2 }), false);
  assert.equal(isCompatiblePolicy({ decision_schema: "other", rules_version: 2 }), false);
});
