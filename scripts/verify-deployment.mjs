import { createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const address = process.argv[2];
if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? "")) throw new Error("Pass the Studio Next contract address as the first argument.");
if (studioDevnet.id !== 61997) throw new Error("Studio Next chain changed.");
const client = createClient({ chain: studioDevnet });
const chainId = Number(await client.request({ method: "eth_chainId" }));
if (chainId !== 61997) throw new Error(`Unexpected RPC chain ${chainId}.`);
const source = await readFile(new URL("../contracts/task_route.py", import.meta.url));
const sourceSha256 = createHash("sha256").update(source).digest("hex");
const deployed = await client.getContractCode(address);
const deployedBytes = deployed.startsWith("0x") ? Buffer.from(deployed.slice(2), "hex") : Buffer.from(deployed);
const deployedSha256 = createHash("sha256").update(deployedBytes).digest("hex");
// Studio's browser editor stores pasted source with CRLF on Windows. Compare the
// source text after normalizing only line endings, while reporting raw hashes.
const normalizeLineEndings = value => value.toString("utf8").replace(/\r\n/g, "\n");
if (normalizeLineEndings(deployedBytes) !== normalizeLineEndings(source))
  throw new Error(`Source mismatch beyond line endings: local ${sourceSha256}, deployed ${deployedSha256}`);
const policy = await client.readContract({ address, functionName: "get_policy", args: [] });
if (policy.decision_schema !== "taskroute/v4-deterministic-coverage" || Number(policy.rules_version) !== 4 || policy.score_source !== "requirement_coverage")
  throw new Error("Deployed contract is not TaskRoute v4.");
console.log(JSON.stringify({ verified: true, chain_id: chainId, contract_address: address,
  source_sha256: sourceSha256, deployed_source_sha256: deployedSha256, line_endings_normalized: deployedSha256 !== sourceSha256, policy }, null, 2));
