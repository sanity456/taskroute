import json
import re


TASK = "Create a fact-safe comparison table for three laptop models."
REQUIREMENTS = [
    "Include price, battery life and warranty for each model.",
    "Use only facts present in the source material.",
    "Clearly mark missing values as unknown.",
]
CANDIDATES = [
    {"id": "fact-table", "name": "FactTable", "address": "0x1111111111111111111111111111111111111111", "output": "A table with price, battery life and warranty. Missing values are marked unknown and no facts are invented."},
    {"id": "summary", "name": "Summary", "address": "0x2222222222222222222222222222222222222222", "output": "A short summary with prices, but warranty is missing for one model."},
]
ROUTE_RESPONSE = {
    "status": "ROUTED",
    "selected_id": "fact-table",
    "scores": [
        {"id": "fact-table", "score": 96, "missing_indices": []},
        {"id": "summary", "score": 58, "missing_indices": [1, 3]},
    ],
    "reason": "FactTable covers every requirement without inventing facts.",
}


def _mock(direct_vm, value, marker="Select an AI agent"):
    direct_vm.mock_llm(rf".*{re.escape(marker)}.*", json.dumps(value))


def _route(contract, direct_vm, value=ROUTE_RESPONSE, task_id="laptop-facts"):
    _mock(direct_vm, value)
    return contract.route_task(task_id, TASK, json.dumps(REQUIREMENTS), json.dumps(CANDIDATES))


def test_routes_and_persists_consensus_evidence(contract, direct_vm):
    task_id = _route(contract, direct_vm)
    record = contract.get_task(task_id)
    assert record["status"] == "ROUTED"
    assert record["decision"]["selected_id"] == "fact-table"
    assert record["selected_address"].endswith("1111111111111111111111111111111111111111")
    assert record["fingerprint"].startswith("sha256:")
    assert contract.get_task_count() == 1
    policy = contract.get_policy()
    assert policy["decision_schema"] == "taskroute/v2-banded-consensus"
    assert policy["score_band_size"] == 10


def test_exact_retry_is_idempotent(contract, direct_vm):
    first = _route(contract, direct_vm)
    direct_vm.clear_mocks()
    assert contract.route_task("laptop-facts", TASK, json.dumps(REQUIREMENTS), json.dumps(CANDIDATES)) == first
    assert contract.get_task_count() == 1


def test_changed_task_is_rejected(contract, direct_vm):
    _route(contract, direct_vm)
    with direct_vm.expect_revert("task_conflict"):
        contract.route_task("laptop-facts", TASK + " with shipping time.", json.dumps(REQUIREMENTS), json.dumps(CANDIDATES))


def test_no_match_fails_closed(contract, direct_vm):
    no_match = {"status": "NO_MATCH", "selected_id": "", "scores": [{"id": "fact-table", "score": 60, "missing_indices": [1]}, {"id": "summary", "score": 58, "missing_indices": [1, 3]}], "reason": "No candidate covers all requirements."}
    task_id = _route(contract, direct_vm, no_match, "no-match")
    assert contract.get_task(task_id)["status"] == "NO_MATCH"
    assert contract.get_task(task_id)["selected_address"] == ""


def test_qualified_agent_cannot_be_overridden_by_model_no_match(contract, direct_vm):
    inconsistent = {
        "status": "NO_MATCH", "selected_id": "",
        "scores": [
            {"id": "fact-table", "score": 75, "missing_indices": []},
            {"id": "summary", "score": 95, "missing_indices": [1]},
        ],
    }
    task_id = _route(contract, direct_vm, inconsistent, "qualified-agent")
    decision = contract.get_task(task_id)["decision"]
    assert decision["status"] == "ROUTED"
    assert decision["selected_id"] == "fact-table"
    assert [item["score"] for item in decision["scores"]] == [70, 90]


def test_contract_chooses_highest_eligible_band_not_model_choice(contract, direct_vm):
    inconsistent = {
        "status": "ROUTED", "selected_id": "fact-table",
        "scores": [
            {"id": "fact-table", "score": 81, "missing_indices": []},
            {"id": "summary", "score": 91, "missing_indices": []},
        ],
    }
    task_id = _route(contract, direct_vm, inconsistent, "highest-band")
    decision = contract.get_task(task_id)["decision"]
    assert decision["selected_id"] == "summary"
    assert decision["reason"].startswith("summary has the highest eligible score band")


def test_selected_agent_can_claim_and_delivery_can_be_reviewed(contract, direct_vm, direct_alice):
    task_id = _route(contract, direct_vm, task_id="delivery-check")
    selected = CANDIDATES[0]["address"]
    with direct_vm.prank(selected):
        contract.claim_task(task_id)
        contract.submit_delivery(task_id, "A complete table with unknown markers for missing warranty values.")
    accepted = {"status": "ACCEPTED", "missing_indices": [], "reason": "Every requirement is present and no facts are invented."}
    direct_vm.mock_llm(r".*Evaluate whether an AI-agent delivery.*", json.dumps(accepted))
    assert contract.verify_delivery(task_id) == "ACCEPTED"
    assert contract.get_task(task_id)["status"] == "ACCEPTED"


def test_rejected_delivery_resubmission_keeps_history_and_clears_stale_review(contract, direct_vm):
    task_id = _route(contract, direct_vm, task_id="delivery-retry")
    selected = CANDIDATES[0]["address"]
    first_delivery = "A first attempt that omits warranty information for all models."
    second_delivery = "A revised table includes prices, battery life, and unknown warranty values."
    with direct_vm.prank(selected):
        contract.claim_task(task_id)
        contract.submit_delivery(task_id, first_delivery)
    rejected = {"status": "REJECTED", "missing_indices": [1], "reason": "Warranty information is missing from the first attempt."}
    direct_vm.mock_llm(r".*Evaluate whether an AI-agent delivery.*", json.dumps(rejected))
    assert contract.verify_delivery(task_id) == "REJECTED"
    with direct_vm.prank(selected):
        contract.submit_delivery(task_id, second_delivery)
    record = contract.get_task(task_id)
    assert record["status"] == "DELIVERED"
    assert record["evaluation"] == {}
    assert record["delivery"] == second_delivery
    assert record["delivery_history"] == [{"delivery": first_delivery, "evaluation": rejected}]


def test_bad_route_shape_fails_without_storage(contract, direct_vm):
    bad = {"status": "ROUTED", "selected_id": "fact-table", "scores": [], "reason": "Missing scores."}
    with direct_vm.expect_revert("[LLM_ERROR]"):
        _route(contract, direct_vm, bad, "bad-route")
    assert contract.get_task_count() == 0


def test_task_ids_are_creator_scoped_and_no_match_can_be_rerouted(contract, direct_vm, direct_alice, direct_bob):
    no_match = {"status": "NO_MATCH", "selected_id": "", "scores": [{"id": "fact-table", "score": 60, "missing_indices": [1]}, {"id": "summary", "score": 58, "missing_indices": [1, 3]}], "reason": "No candidate covers all requirements."}
    first = _route(contract, direct_vm, no_match, "shared-id")
    with direct_vm.prank(direct_bob):
        second = _route(contract, direct_vm, ROUTE_RESPONSE, "shared-id")
    assert first != second
    direct_vm.clear_mocks()
    _mock(direct_vm, ROUTE_RESPONSE)
    contract.reroute_task(first, json.dumps(CANDIDATES))
    record = contract.get_task(first)
    assert record["revision"] == 2
    assert len(record["history"]) == 1
    assert record["status"] == "ROUTED"
