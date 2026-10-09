export const REQUIRED_DECISION_SCHEMA = "taskroute/v2-banded-consensus";

export function isCompatiblePolicy(policy: { decision_schema?: string; rules_version?: number }): boolean {
  return policy.decision_schema === REQUIRED_DECISION_SCHEMA && Number(policy.rules_version) >= 2;
}
