import { abi, createAccount, createClient, createFeesDistribution, normalizeMessageFeeAllocations } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { TransactionHashVariant } from "genlayer-js/types";
import { readFile } from "node:fs/promises";

if (studioDevnet.id !== 61997) throw new Error("Studio Next chain changed.");
const deployerKey = process.env.TASKROUTE_DEPLOYER_KEY;
const agentKey = process.env.TASKROUTE_AGENT_KEY;
if (!/^0x[0-9a-fA-F]{64}$/.test(deployerKey ?? "") || !/^0x[0-9a-fA-F]{64}$/.test(agentKey ?? ""))
  throw new Error("Set disposable TASKROUTE_DEPLOYER_KEY and TASKROUTE_AGENT_KEY.");
const owner = createAccount(deployerKey);
const agent = createAccount(agentKey);
const ownerClient = createClient({ chain: studioDevnet, account: owner });
const agentClient = createClient({ chain: studioDevnet, account: agent });
const manifest = JSON.parse(await readFile(new URL("../.sites-runtime/studio-next.json", import.meta.url), "utf8"));
const address = manifest.contract_address;
const policy = await ownerClient.readContract({ address, functionName: "get_policy", args: [] });
if (policy.decision_schema !== "taskroute/v2-banded-consensus" || Number(policy.rules_version) !== 2)
  throw new Error("Live smoke requires a deployed TaskRoute v2 contract.");
const json = value => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v, 2);

async function feeQuote(client, functionName, args) {
  const baseline = await client.estimateTransactionFees();
  const block = await client.request({ method: "eth_getBlockByNumber", params: ["latest", false] });
  const data = abi.transactions.serialize([abi.calldata.encode(abi.calldata.makeCalldataObject(functionName, args, undefined)), false]);
  const fees = JSON.parse(JSON.stringify({ distribution: baseline.distribution, feeValue: baseline.feeValue,
    messageAllocations: baseline.messageAllocations }, (_, v) => typeof v === "bigint" ? v.toString() : v));
  const simulation = await client.request({ method: "sim_estimateTransactionFees", params: [{ type: "write", to: address,
    from: client.account.address, data, transaction_hash_variant: "latest-final", fees,
    sim_config: { genvm_datetime: new Date(Number(BigInt(block.timestamp)) * 1000).toISOString() } }] });
  if (simulation.receipt?.execution_result !== "SUCCESS") throw new Error("Live smoke fee simulation failed.");
  const preset = simulation.recommendedPreset;
  if (!preset?.distribution || !/^\d+$/.test(String(preset.feeValue))) throw new Error("Invalid live fee quote.");
  const feeValue = BigInt(preset.feeValue);
  const balance = BigInt(await client.request({ method: "eth_getBalance", params: [client.account.address, "pending"] }));
  if (balance < feeValue) throw new Error(`Insufficient test GEN for ${client.account.address}.`);
  return { distribution: createFeesDistribution(preset.distribution), feeValue,
    messageAllocations: preset.messageAllocations ? normalizeMessageFeeAllocations(preset.messageAllocations) : undefined };
}

async function write(client, functionName, args) {
  const fees = await feeQuote(client, functionName, args);
  const hash = await client.writeContract({ address, functionName, args, value: 0n, leaderOnly: false, fees });
  for (let attempt = 0; attempt < 120; attempt++) {
    const receipt = await client.getTransaction({ hash });
    const status = String(receipt.statusName ?? receipt.status ?? "UNKNOWN").toUpperCase();
    if (attempt % 5 === 0) console.log(JSON.stringify({ functionName, hash, status }));
    if (status === "FINALIZED") {
      if (receipt.txExecutionResult !== 1 && receipt.txExecutionResultName !== "FINISHED_WITH_RETURN" && receipt.txExecutionResultName !== "SUCCESS")
        throw new Error(`${functionName} finalized with execution error.`);
      return hash;
    }
    if (status === "CANCELED" || status === "UNDETERMINED") throw new Error(`${functionName} ${status.toLowerCase()}.`);
    await new Promise(resolve => setTimeout(resolve, 6000));
  }
  throw new Error(`${functionName} remains pending.`);
}

const taskId = process.env.TASKROUTE_TASK_ID || `smoke-${Date.now().toString(36)}`;
const task = "Return the deterministic TaskRoute smoke-test result.";
const requirements = ["Include the exact marker TASKROUTE_SMOKE_OK.", "State that CSV output is ready."];
const candidates = [
  { id: "route_a", name: "Route A", address: owner.address, output: "TASKROUTE_SMOKE_OK. CSV output is ready." },
  { id: "route_b", name: "Route B", address: agent.address, output: "I can summarize wallet activity in plain text, but I do not provide a CSV or a selectable date range." },
];
const storageId = `${owner.address.toLowerCase()}:${taskId}`;
let record;
try {
  record = await ownerClient.readContract({ address, functionName: "get_task", args: [storageId], transactionHashVariant: TransactionHashVariant.LATEST_FINAL });
  console.log(JSON.stringify({ action: "resume_existing_task", storageId, status: record.status }));
} catch {
  await write(ownerClient, "route_task", [taskId, task, JSON.stringify(requirements), JSON.stringify(candidates)]);
  record = await ownerClient.readContract({ address, functionName: "get_task", args: [storageId], transactionHashVariant: TransactionHashVariant.LATEST_FINAL });
}
if (record.decision.status === "NO_MATCH") {
  const revisedCandidates = [
    { id: "route_a", name: "Route A", address: owner.address, output: "TASKROUTE_SMOKE_OK. CSV output is ready." },
    { id: "route_b", name: "Route B", address: agent.address, output: "I return a plain-text summary only; no CSV and no date-range coverage." },
  ];
  await write(ownerClient, "reroute_task", [storageId, JSON.stringify(revisedCandidates)]);
  record = await ownerClient.readContract({ address, functionName: "get_task", args: [storageId], transactionHashVariant: TransactionHashVariant.LATEST_FINAL });
}
if (record.decision.status !== "ROUTED" || !record.decision.selected_id) throw new Error(`Unexpected route decision: ${record.decision.status}`);
const selected = record.decision.selected_id === "route_a" ? ownerClient : agentClient;
const selectedAddress = record.selected_address;
await write(selected, "claim_task", [storageId]);
const delivery = "TASKROUTE_SMOKE_OK. CSV output is ready.";
await write(selected, "submit_delivery", [storageId, delivery]);
await write(ownerClient, "verify_delivery", [storageId]);
record = await ownerClient.readContract({ address, functionName: "get_task", args: [storageId], transactionHashVariant: TransactionHashVariant.LATEST_FINAL });
if (record.status !== "ACCEPTED") throw new Error(`Delivery was not accepted: ${record.status}`);
console.log(json({ verified: true, chain_id: 61997, contract_address: address, task_id: taskId, storage_id: storageId,
  selected_id: record.decision.selected_id, selected_address: selectedAddress, final_status: record.status,
  revision: record.revision }));
