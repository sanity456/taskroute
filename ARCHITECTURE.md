# TaskRoute boundary

1. The frontend collects a task, fixed requirements and public trial outputs. The storage key combines the creator address and the caller-provided task ID, so another wallet cannot front-run or overwrite the same ID.
2. `route_task` validates the shape, binds the inputs to a fingerprint, and runs a nondeterministic evaluator.
3. A validator independently reruns the evaluator. Consensus compares route status, selected agent ID, every score and every missing requirement index.
4. The deterministic path stores the route and the selected address. `claim_task` is a state transition that only that address can execute.
5. After delivery, `verify_delivery` reruns a second structured evaluation. Consensus compares accepted/rejected status and missing requirement indexes.
6. A creator can appeal a `NO_MATCH` result through `reroute_task`; the old decision and candidate set are kept in the task history.

The frontend is intentionally non-authoritative: preview decisions are labelled as previews, and live decisions are read back from the contract after finalization.
