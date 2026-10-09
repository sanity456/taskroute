import { abi, createAccount, createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";

if (studioDevnet.id !== 61997) throw new Error("Studio Next chain changed.");
const key = process.env.TASKROUTE_DEPLOYER_KEY;
if (!/^0x[0-9a-fA-F]{64}$/.test(key ?? "")) {
  throw new Error("Set TASKROUTE_DEPLOYER_KEY to a funded disposable Studio Next private key.");
}
const account = createAccount(key);
const client = createClient({ chain: studioDevnet, account });
const code = await readFile(new URL("../contracts/task_route.py", import.meta.url), "utf8");
const sourceHash = createHash("sha256").update(code).digest("hex");
const chainId = Number(await client.request({ method: "eth_chainId" }));
if (chainId !== 61997) throw new Error(`Unexpected RPC chain ${chainId}.`);

const runtime = new URL("../.sites-runtime/", import.meta.url);
await mkdir(runtime, { recursive: true });
const manifestPath = new URL("studio-next.json", runtime);
let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (manifest?.source_sha256 !== sourceHash) manifest = undefined;

if (!manifest?.contract_address) {
  const fees = await client.estimateTransactionFees();
  const balance = BigInt(await client.request({ method: "eth_getBalance", params: [account.address, "pending"] }));
  if (balance < fees.feeValue) throw new Error(`Insufficient test GEN: need ${fees.feeValue}, have ${balance}.`);
  const hash = await client.deployContract({ code, args: [2], leaderOnly: false, fees });
  console.log(JSON.stringify({ action: "deploy_submitted", hash, deployer: account.address }));
  let receipt;
  for (let attempt = 0; attempt < 120; attempt++) {
    receipt = await client.getTransaction({ hash });
    const status = String(receipt.statusName ?? receipt.status ?? "UNKNOWN").toUpperCase();
    if (attempt % 5 === 0) console.log(JSON.stringify({ action: "deploy_wait", hash, status }));
    if (status === "FINALIZED") break;
    if (status === "CANCELED" || status === "UNDETERMINED") throw new Error(`Deployment ${status.toLowerCase()}.`);
    await new Promise(resolve => setTimeout(resolve, 6000));
  }
  const status = String(receipt?.statusName ?? receipt?.status ?? "UNKNOWN").toUpperCase();
  if (status !== "FINALIZED") throw new Error("Deployment is still pending; rerun this script to resume tracking.");
  const result = receipt?.txExecutionResultName ?? receipt?.txExecutionResult;
  if (!(result === 1 || result === "SUCCESS" || result === "FINISHED_WITH_RETURN")) throw new Error("Deployment finalized with an execution error.");
  const address = receipt.recipient || receipt.to_address || receipt.txDataDecoded?.contractAddress;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? "")) throw new Error("Deployment receipt did not include a contract address.");
  manifest = { chain_id: 61997, rpc: studioDevnet.rpcUrls.default.http[0], contract_address: address,
    deployer: account.address, deployment_tx: hash, source_sha256: sourceHash, deployed_at: new Date().toISOString() };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
}

const deployed = await client.getContractCode(manifest.contract_address);
const deployedBytes = deployed.startsWith("0x") ? Buffer.from(deployed.slice(2), "hex") : Buffer.from(deployed);
const deployedHash = createHash("sha256").update(deployedBytes).digest("hex");
if (deployedHash !== sourceHash) throw new Error(`On-chain source hash mismatch: ${deployedHash}`);
const policy = await client.readContract({ address: manifest.contract_address, functionName: "get_policy", args: [] });
if (policy.decision_schema !== "taskroute/v2-banded-consensus" || Number(policy.rules_version) !== 2)
  throw new Error("The deployed contract did not report the TaskRoute v2 decision policy.");
console.log(JSON.stringify({ verified: true, chain_id: 61997, contract_address: manifest.contract_address,
  deployment_tx: manifest.deployment_tx, source_sha256: sourceHash, policy }, null, 2));
