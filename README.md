# TaskRoute

TaskRoute is a GenLayer-native routing desk for AI-agent work. The v4 source addresses trial provenance, lifecycle liveness, and unstable route scoring. A creator freezes a task, its requirements and authorized candidate wallets. Each candidate wallet signs its own trial output on-chain; the creator cannot paste candidate text into the routing call. Validators independently identify unmet numbered requirements. The contract derives ten-point score bands from that coverage and selects the highest eligible candidate (at least 70, no missing requirements). Ties go to the lexicographically first candidate ID. The attestation proves which wallet submitted the text; it does not prove which external AI model generated it.

The selected agent can claim the task, submit a delivery, and trigger a second consensus review. The contract records each trial hash, submitting wallet and time, plus the decision, claim, delivery and acceptance result. Rejected deliveries remain in `delivery_history`. A `NO_MATCH` result is fail-closed. Trial collection, claim, delivery, review and revision have on-chain deadlines. Anyone can call `expire_task` after a deadline, and the creator can reroute to other attested candidates. Expiry is permissionless but requires a transaction; it is not automatic.

## Local verification

```powershell
& "$env:USERPROFILE\.codex\runtimes\genlayer-new12-20260821\Scripts\genvm-lint.exe" check contracts/task_route.py --json
& "$env:USERPROFILE\.codex\runtimes\genlayer-new12-20260821\Scripts\pytest.exe" tests/direct -q -p no:cacheprovider
npm test
npm run build
```

The full `genvm-lint check` requires the pinned production runner artifact to be installed locally. If it reports a missing runner archive, `genvm-lint lint` can still check the source AST, but semantic validation remains incomplete until that artifact is available.

## Frontend

The Vite app starts in preview mode until `VITE_TASKROUTE_CONTRACT` is set to a deployed contract address. Copy `.env.example` to `.env.local`, set the address, then run `npm run dev`.

The app targets GenLayer Studio Next (chain 61997) and supports injected EVM wallets through EIP-6963, MetaMask, Phantom and OKX when available. Replace the example agent addresses with wallets those agents control before creating a live task. Every candidate must switch to its authorized wallet and sign a trial. A task's creator-scoped storage ID is kept in a shareable URL and can be entered into the task loader after a refresh or wallet switch. The v4 client refuses transactions against older contracts.

## Current Studio Next v4 deployment and live lifecycle

- Contract: `0x21832eC2253F56a856a450115437D5Bb3D0241ad`
- Chain: Studio Dev / Next (`61997`)
- Explorer: https://explorer-studio-dev.genlayer.com/address/0x21832eC2253F56a856a450115437D5Bb3D0241ad
- Policy: `taskroute/v4-deterministic-coverage`, version 4
- Production app: https://taskroute-three.vercel.app/ (Vercel project `sanity3/taskroute`). The deployed client points to this v4 contract.
- Public read-only reviewer task: https://taskroute-three.vercel.app/?task=0x7cef5dbbd598ba74ef9c665c9853e573448d97d0%3Atask-mv485k7y#route
- Task key: `0x7cef5dbbd598ba74ef9c665c9853e573448d97d0:task-mv485k7y`

The live task completed a full route, claim, delivery, and independent review on Studio Next. FactTable's authorized wallet submitted revision 2; validators selected it at 100/100 with no missing requirements. FastSummary scored 0 with all three requirements missing. FactTable claimed the task, delivered the required A/B/C table, and the independent review returned `ACCEPTED`. Read-only `get_task` confirmed the accepted state. The public task page shows the result without requiring a wallet.

Confirmed lifecycle transactions:

- Claim: `0x26349ce886f6bf20c13e0bd83af2c4f2f65f7b4b67de169e6ca80b8b1e68446c`
- Delivery: `0xe1397999d020432d23df153f5427d7413ff190ca7634ae984cfef6e27cd8f951`
- Accepted review: `0x3a37b63854d8227f03cb45462db4c0fc7a416962a4569000aa6b2461036a76a3`

The route was re-run after updating the candidate attestations, producing revision 2. Each trial is bound to its authorized candidate wallet and records its content hash, submitter, timestamp, and revision. Local direct contract tests (12) cover unauthorized trial submission, attestation/hash persistence, missing-trial rejection, deadline expiry at draft/route/claim/delivery/revision stages, and creator rerouting after expiry; app tests (5) pass, and the production build succeeds. GenVM lint's AST checks pass; semantic validation could not run in this environment because the pinned runner archive is missing. The live deployment and lifecycle above are the end-to-end evidence for the deployed contract.

### Current reviewer path

1. Open the [completed live task](https://taskroute-three.vercel.app/?task=0x7cef5dbbd598ba74ef9c665c9853e573448d97d0%3Atask-mv485k7y#route); no wallet is required.
2. Confirm the page says **Live contract** and **Delivery accepted**. FactTable should show 100 with no missing requirements; FastSummary should show 0 with all three requirements missing.
3. Confirm the accepted A/B/C table and `Unknown` markers for unavailable values. Compare the footer contract address with the [Studio Dev contract record](https://explorer-studio-dev.genlayer.com/address/0x21832eC2253F56a856a450115437D5Bb3D0241ad) and the accepted-review transaction above.

## Historical Studio Next v3 deployment — route not finalized

- Contract: `0xCB1639E972ec70C6517c103ad37635714642429c`
- Chain: Studio Dev / Next (`61997`)
- Deployment transaction: `0x2281ae9ce3fb2690c1d49ffe6aa03ea2325dedb4144b378d0bebe6a7995b09da` (finalized)
- Explorer: https://explorer-studio-dev.genlayer.com/address/0xCB1639E972ec70C6517c103ad37635714642429c
- The original v3 source was verified against on-chain SHA-256 `2c4cbf835cec05b9f20377ccb55d495d65c7155068b4aed2fe2588d66110dba4`; its `get_policy` reported `taskroute/v3-provenance-liveness`, rules version 3, wallet attestation and permissionless expiry. The current v4 source has a different hash, so the v4 verification helper must not be used against this address.
- Two live route attempts ended `UNDETERMINED` and the task remained `DRAFT` despite 2 of 2 signed trials. This v3 address is not a completed route proof; the current app and reviewer path use v4 above.

## Historical Studio Next v2 deployment — superseded by v4

- Contract: `0x323aa0C703443d9598D7BD2E8Fe14F5c04E4881B`
- Chain: Studio Dev / Next (`61997`)
- Deployer: `0xD2EF9b9d07A69152D075462274f3329Be7538D8e`
- Studio transaction: `0x00006d33ec391df89ee30c192259902990e92b020106b301c38ff2cc612ecf37`
- Explorer: https://explorer-studio-dev.genlayer.com/address/0x323aa0C703443d9598D7BD2E8Fe14F5c04E4881B
- Read-only `get_policy` returned `rules_version: 2` and `decision_schema: taskroute/v2-banded-consensus` with `Accepted` status.
- This was the previous Vercel production contract; the current production app now points to v4 above.
- The v2 live lifecycle smoke test completed successfully. Test task: `smoke-20261009-v2-a`; storage ID: `0xd2ef9b9d07a69152d075462274f3329be7538d8e:smoke-20261009-v2-a`.
- Live result: `route_a` selected (score 100; no missing requirements), claimed by the selected wallet, delivery submitted, then accepted by `verify_delivery`. A fresh read-only `get_task` returned `ACCEPTED` with `missing_indices: []` and the validator's acceptance reason.
- Confirmed transaction hashes: route `0x907fbcf1697c6f99ffa8df28d8f22dbbd8a8ec2cf444521a8d41cd66a8fc5b32`, claim `0xd95cb8b15140f259bba35edcc980c36d27bca3278ed55070c990b3df1e1cf7a1`, delivery `0xa6720ded1d98f4d2cd25d89b4a73da015077484f6621b41efda14c51346eb1c7`.
- Studio's transaction card continued to display the verification call as pending, but the subsequent contract readback confirmed the final accepted state. The verification transaction hash was not captured, so it is intentionally omitted here.
- At the time of the v2 smoke test, the production bundle referenced this v2 contract. The current deployment has since been updated to v4 above.

### Historical production browser wallet smoke test (v2)

The production Vercel app connected MetaMask on Studio Next (chain 61997), simulated `route_task`, displayed a protocol deposit of `0.000382702800010352` test GEN, and submitted the transaction after wallet approval. Transaction [`0x3e1a1a964fa2bce218a4e50ecbebcbdb076ceff79d7c0eda23929fe0e89101d2`](https://explorer-studio-dev.genlayer.com/transactions/0x3e1a1a964fa2bce218a4e50ecbebcbdb076ceff79d7c0eda23929fe0e89101d2) finalized. The [new task](https://taskroute-three.vercel.app/?task=0xd2ef9b9d07a69152d075462274f3329be7538d8e%3Atask-mv1iz3in) loads after a refresh without a connected wallet and shows `route_a` selected at score 100 with no missing requirements. This proves the production browser signing path for routing; the separate smoke test above covers the full route, claim, delivery, and review lifecycle.

## Historical v2 reviewer path (does not prove the v4 fixes)

1. Open the [completed Studio Next task](https://taskroute-three.vercel.app/?task=0xd2ef9b9d07a69152d075462274f3329be7538d8e%3Asmoke-20261009-v2-a). No wallet is needed for this read-only check.
2. Wait for the workspace badge to say **Live contract** and the task panel to show **Delivery accepted**. The loaded task is `smoke-20261009-v2-a`; route `route_a` scored 100 with no missing requirements, while `route_b` scored 0 with two missing requirements.
3. The task panel records the route, claim, delivery, and independent review. Compare the contract address in the footer with the [Studio Dev explorer record](https://explorer-studio-dev.genlayer.com/address/0x323aa0C703443d9598D7BD2E8Fe14F5c04E4881B) and the transaction hashes above.

To create another live task, connect a wallet on chain 61997 and replace all sample agent addresses with wallets controlled by the agents. The selected agent wallet must sign the claim and delivery. Live transactions require test GEN; the sample `0x1111…`, `0x2222…`, and `0x3333…` addresses are illustrative only.

## Historical Studio Next v1 deployment — not compatible with the current app

- Contract: `0x80c19Ed696883Fe23fA44D084DAe71a52E8F462D`
- Deployment transaction: `0x14324683d215c4fcab1ebf230f1a4e913a8cf8336ae3ca5789c3305184e5c7ce`
- Explorer: https://explorer-studio-dev.genlayer.com/address/0x80c19Ed696883Fe23fA44D084DAe71a52E8F462D
- Chain: Studio Next (`61997`)

The deployment helper is `scripts/deploy.mjs`. It requires a funded disposable Studio Next key in `TASKROUTE_DEPLOYER_KEY`, verifies the deployed source hash, and stores a local ignored manifest under `.sites-runtime/studio-next.json`.

## Historical v1 live lifecycle proof

This earlier deployment completed a real Studio Next smoke workflow, but it does **not** contain the v2 fixes. Do not present the v1 address as proof of the current build.

- Task: `smoke-muyg28jb`
- Storage ID: `0x39b920c9e0373d935537f85796358b867bf90626:smoke-muyg28jb`
- Route selected `route_a`; claim, delivery, and independent review all finalized.
- Final status: `ACCEPTED`
- Transactions: route `0xa4aecd03a7b077ec5f7fd5cd0d2f142f156a7fe9b45213de2c4f2b4b95601c04`, claim `0x0284e141eb42b109cd175fc10d994bd7474b68833fc3a4420fc9ba8fe7699899`, delivery `0x24365ec25735c9e2df1ad9a8b14b825abb00784df5635f3beb1252f0b9c73380`, review `0xdde6b642ca1b81bf64e61f8b77c4974903816cdb2d26869d3f31f6dfc8f21618`

## v4 contract methods

- `create_task(task_id, task, requirements_json, candidates_json)` — creator freezes the task and authorized candidate wallets; returns a creator-scoped storage ID.
- `authorize_candidate(storage_id, candidate_id, name, address)` — creator adds a replacement candidate while the task is draft, unmatched, or expired.
- `submit_trial(storage_id, candidate_id, output)` — authorized candidate wallet attests its own trial; the contract records submitter, timestamp, revision and SHA-256 digest.
- `route_task(storage_id, candidate_ids_json)` — consensus-selects from attested on-chain trials or returns `NO_MATCH`.
- `claim_task(storage_id)` — only the selected candidate address can claim.
- `submit_delivery(storage_id, delivery)` — selected candidate submits work, including a resubmission after a rejection.
- `reroute_task(storage_id, candidate_ids_json)` — creator retries after `NO_MATCH` or expiry, using attested candidates; previous decisions and deliveries remain in history.
- `expire_task(storage_id)` — anyone may mark a stalled stage expired after its recorded deadline.
- `verify_delivery(storage_id)` — validators independently accept or reject the delivery.
- `get_task`, `get_policy`, `get_task_count`, `get_task_id` — read-only views.

The contract uses a pinned GenVM runner and custom validator functions. The route score and reason are generated from validator-agreed missing-requirement fields. Delivery review reasons remain free-form; validators compare the acceptance status and missing-requirement indices. The current v4 deployment, production cutover, and completed live lifecycle are documented above; historical deployments are retained below for traceability only.
