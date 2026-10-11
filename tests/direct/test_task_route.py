import json
import re

TASK = "Create a fact-safe comparison table for three laptop models."
REQUIREMENTS = ["Include price, battery life and warranty for each model.", "Use only facts present in the source material.", "Clearly mark missing values as unknown."]
CANDIDATES = [
    {"id": "fact-table", "name": "FactTable", "address": "0x1111111111111111111111111111111111111111", "output": "A table with price, battery life and warranty. Missing values are marked unknown and no facts are invented."},
    {"id": "summary", "name": "Summary", "address": "0x2222222222222222222222222222222222222222", "output": "A short summary with prices, but warranty is missing for one model."},
]
ROUTE_RESPONSE = {"coverage": [{"id": "fact-table", "missing_indices": []}, {"id": "summary", "missing_indices": [1, 3]}]}


def _mock(direct_vm, value, marker="Select an AI agent"):
    direct_vm.mock_llm(rf".*{re.escape(marker)}.*", json.dumps(value))


def _create(contract, direct_vm, task_id="laptop-facts"):
    return contract.create_task(task_id, TASK, json.dumps(REQUIREMENTS),
                                json.dumps([{k: item[k] for k in ("id", "name", "address")} for item in CANDIDATES]))


def _attest(contract, direct_vm, key):
    for candidate in CANDIDATES:
        with direct_vm.prank(candidate["address"]):
            contract.submit_trial(key, candidate["id"], candidate["output"])


def _route(contract, direct_vm, value=ROUTE_RESPONSE, task_id="laptop-facts"):
    key = _create(contract, direct_vm, task_id)
    _attest(contract, direct_vm, key)
    _mock(direct_vm, value)
    contract.route_task(key, json.dumps([item["id"] for item in CANDIDATES]))
    return key


def test_trials_are_bound_to_candidate_wallets(contract, direct_vm):
    key = _create(contract, direct_vm)
    with direct_vm.expect_revert("only_candidate_can_attest_trial"):
        contract.submit_trial(key, CANDIDATES[0]["id"], CANDIDATES[0]["output"])
    _attest(contract, direct_vm, key)
    trial = contract.get_task(key)["trials"]["fact-table"]
    assert trial["submitted_by"] == CANDIDATES[0]["address"]
    assert trial["output_hash"].startswith("sha256:")
    assert trial["submitted_at"] > 0


def test_route_uses_attested_trials_and_persists_evidence(contract, direct_vm):
    key = _route(contract, direct_vm)
    record = contract.get_task(key)
    assert record["status"] == "ROUTED"
    assert record["decision"]["selected_id"] == "fact-table"
    assert record["decision"]["scores"] == [
        {"id": "fact-table", "score": 100, "missing_indices": []},
        {"id": "summary", "score": 30, "missing_indices": [1, 3]},
    ]
    assert record["candidates"][0]["submitted_by"] == CANDIDATES[0]["address"]
    assert record["candidates"][0]["output_hash"] == record["trials"]["fact-table"]["output_hash"]
    assert record["deadline"] > record["created_at"]
    assert contract.get_policy()["decision_schema"] == "taskroute/v4-deterministic-coverage"
    assert contract.get_policy()["score_source"] == "requirement_coverage"


def test_missing_trial_cannot_route(contract, direct_vm):
    key = _create(contract, direct_vm)
    with direct_vm.prank(CANDIDATES[0]["address"]):
        contract.submit_trial(key, CANDIDATES[0]["id"], CANDIDATES[0]["output"])
    with direct_vm.expect_revert("candidate_trial_missing"):
        contract.route_task(key, json.dumps([item["id"] for item in CANDIDATES]))


def test_stalled_trial_collection_can_expire(contract, direct_vm, direct_bob):
    key = _create(contract, direct_vm, "stalled-trials")
    direct_vm.warp("2026-10-15T12:00:00Z")
    with direct_vm.prank(direct_bob):
        contract.expire_task(key)
    record = contract.get_task(key)
    assert record["status"] == "EXPIRED"
    assert record["expired_from"] == "DRAFT"


def test_creator_cannot_reassign_candidate_or_route_as_another_wallet(contract, direct_vm, direct_bob):
    key = _create(contract, direct_vm, "protected-candidates")
    with direct_vm.expect_revert("candidate_conflict"):
        contract.authorize_candidate(key, "fact-table", "Impostor", str(direct_bob))
    _attest(contract, direct_vm, key)
    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert("only_creator_can_route"):
            contract.route_task(key, json.dumps(["fact-table", "summary"]))


def test_task_spec_is_immutable_and_creator_scoped(contract, direct_vm, direct_bob):
    first = _create(contract, direct_vm)
    specs = json.dumps([{k: item[k] for k in ("id", "name", "address")} for item in CANDIDATES])
    assert contract.create_task("laptop-facts", TASK, json.dumps(REQUIREMENTS), specs) == first
    with direct_vm.expect_revert("task_conflict"):
        contract.create_task("laptop-facts", TASK + " with shipping time.", json.dumps(REQUIREMENTS), specs)
    with direct_vm.prank(direct_bob):
        second = contract.create_task("laptop-facts", TASK, json.dumps(REQUIREMENTS), specs)
    assert first != second


def test_claim_delivery_review_and_revision(contract, direct_vm):
    key = _route(contract, direct_vm, task_id="delivery-check")
    with direct_vm.prank(CANDIDATES[0]["address"]):
        contract.claim_task(key)
        contract.submit_delivery(key, "A first attempt that omits warranty information for all models.")
    rejected = {"status": "REJECTED", "missing_indices": [1], "reason": "Warranty information is missing from the first attempt."}
    _mock(direct_vm, rejected, "Evaluate whether an AI-agent delivery")
    assert contract.verify_delivery(key) == "REJECTED"
    assert contract.get_task(key)["deadline"] > 0
    with direct_vm.prank(CANDIDATES[0]["address"]):
        contract.submit_delivery(key, "A revised table includes prices, battery life, and unknown warranty values.")
    record = contract.get_task(key)
    assert record["status"] == "DELIVERED"
    assert record["evaluation"] == {}
    assert record["delivery_history"][0]["evaluation"] == rejected


def test_anyone_can_expire_unclaimed_route_and_creator_can_reroute(contract, direct_vm, direct_bob):
    key = _route(contract, direct_vm, task_id="expired-route")
    with direct_vm.expect_revert("deadline_not_reached"):
        contract.expire_task(key)
    direct_vm.warp("2026-10-09T12:00:00Z")
    with direct_vm.prank(direct_bob):
        contract.expire_task(key)
    assert contract.get_task(key)["expired_from"] == "ROUTED"
    with direct_vm.expect_revert("expired_agent_must_be_excluded"):
        contract.reroute_task(key, json.dumps(["fact-table", "summary"]))
    direct_vm.clear_mocks()
    _mock(direct_vm, {"coverage": [{"id": "summary", "missing_indices": []}]})
    contract.reroute_task(key, json.dumps(["summary"]))
    record = contract.get_task(key)
    assert record["status"] == "ROUTED"
    assert record["selected_address"] == CANDIDATES[1]["address"]
    assert record["history"][0]["expired_from"] == "ROUTED"


def test_claimed_stage_can_expire(contract, direct_vm):
    key = _route(contract, direct_vm, task_id="expired-claimed")
    with direct_vm.prank(CANDIDATES[0]["address"]):
        contract.claim_task(key)
    direct_vm.warp("2026-10-11T12:00:00Z")
    contract.expire_task(key)
    assert contract.get_task(key)["expired_from"] == "CLAIMED"


def test_unreviewed_delivery_fails_closed_then_expires(contract, direct_vm):
    key = _route(contract, direct_vm, task_id="expired-review")
    with direct_vm.prank(CANDIDATES[0]["address"]):
        contract.claim_task(key)
        contract.submit_delivery(key, "A complete table with prices and unknown warranty values.")
    direct_vm.warp("2026-10-09T12:00:00Z")
    with direct_vm.expect_revert("stage_expired_call_expire_task"):
        contract.verify_delivery(key)
    contract.expire_task(key)
    assert contract.get_task(key)["expired_from"] == "DELIVERED"


def test_rejected_revision_fails_closed_then_expires(contract, direct_vm):
    key = _route(contract, direct_vm, task_id="expired-revision")
    with direct_vm.prank(CANDIDATES[0]["address"]):
        contract.claim_task(key)
        contract.submit_delivery(key, "A first attempt with missing warranty and prices.")
    _mock(direct_vm, {"status": "REJECTED", "missing_indices": [1], "reason": "The first requirement is incomplete."}, "Evaluate whether an AI-agent delivery")
    contract.verify_delivery(key)
    direct_vm.warp("2026-10-11T12:00:00Z")
    with direct_vm.prank(CANDIDATES[0]["address"]):
        with direct_vm.expect_revert("stage_expired_call_expire_task"):
            contract.submit_delivery(key, "A revised complete table with all requested values.")
    contract.expire_task(key)
    assert contract.get_task(key)["expired_from"] == "REJECTED"


def test_no_match_revisions_keep_history(contract, direct_vm):
    no_match = {"coverage": [{"id": "fact-table", "missing_indices": [1]}, {"id": "summary", "missing_indices": [1, 3]}]}
    key = _route(contract, direct_vm, no_match, "no-match")
    with direct_vm.prank(CANDIDATES[0]["address"]):
        contract.submit_trial(key, "fact-table", "Updated fact-safe table with prices, battery life, warranty, and unknown markers.")
    direct_vm.clear_mocks()
    _mock(direct_vm, ROUTE_RESPONSE)
    contract.reroute_task(key, json.dumps(["fact-table", "summary"]))
    record = contract.get_task(key)
    assert record["revision"] == 2
    assert record["trials"]["fact-table"]["revision"] == 2
    assert record["history"][0]["status"] == "NO_MATCH"
