# TaskRoute

TaskRoute is a GenLayer-native routing desk for AI-agent work. A requester freezes a task and its requirements and supplies trial outputs from multiple agents. Validators independently score each output; the contract compares their ten-point score bands and missing-requirement indices, then deterministically routes to the highest eligible band (at least 70, no missing requirements). Ties go to the lexicographically first candidate ID.

The selected agent can claim the task, submit a delivery, and trigger a second consensus review. The contract records the task fingerprint, candidate evidence, structured decision, claim, delivery, and acceptance result. Rejected deliveries and their evaluations remain in `delivery_history` after resubmission. A `NO_MATCH` result is fail-closed: no agent is authorized to claim it.

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

The app targets GenLayer Studio Next (chain 61997) and supports injected EVM wallets through EIP-6963, MetaMask, Phantom and OKX when available. Replace the example agent addresses with wallets those agents control before live routing. A task's creator-scoped storage ID is kept in a shareable URL and can be entered into the task loader after a refresh or wallet switch. The client refuses transactions against a pre-v2 contract.

## Current Studio Next v2 deployment

- Contract: `0x323aa0C703443d9598D7BD2E8Fe14F5c04E4881B`
- Chain: Studio Dev / Next (`61997`)
- Deployer: `0xD2EF9b9d07A69152D075462274f3329Be7538D8e`
- Studio transaction: `0x00006d33ec391df89ee30c192259902990e92b020106b301c38ff2cc612ecf37`
- Explorer: https://explorer-studio-dev.genlayer.com/address/0x323aa0C703443d9598D7BD2E8Fe14F5c04E4881B
- Read-only `get_policy` returned `rules_version: 2` and `decision_schema: taskroute/v2-banded-consensus` with `Accepted` status.
- `.env.local` and the Vercel production and preview environments point to this deployment.
- Production site: https://taskroute-three.vercel.app/ (Vercel project `sanity3/taskroute`; deployment `dpl_621b21UCuVv4Nuyz8Lrvz9g31kSP`). The deployment is `READY`; an HTTP check returned 200 and the served JavaScript bundle contains the v2 contract address.
- The v2 live lifecycle smoke test completed successfully. Test task: `smoke-20261009-v2-a`; storage ID: `0xd2ef9b9d07a69152d075462274f3329be7538d8e:smoke-20261009-v2-a`.
- Live result: `route_a` selected (score 100; no missing requirements), claimed by the selected wallet, delivery submitted, then accepted by `verify_delivery`. A fresh read-only `get_task` returned `ACCEPTED` with `missing_indices: []` and the validator's acceptance reason.
- Confirmed transaction hashes: route `0x907fbcf1697c6f99ffa8df28d8f22dbbd8a8ec2cf444521a8d41cd66a8fc5b32`, claim `0xd95cb8b15140f259bba35edcc980c36d27bca3278ed55070c990b3df1e1cf7a1`, delivery `0xa6720ded1d98f4d2cd25d89b4a73da015077484f6621b41efda14c51346eb1c7`.
- Studio's transaction card continued to display the verification call as pending, but the subsequent contract readback confirmed the final accepted state. The verification transaction hash was not captured, so it is intentionally omitted here.
- Production deployment verified at https://taskroute-three.vercel.app/; its served bundle references the v2 contract address.

## Reviewer path

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

## Contract methods

- `route_task(task_id, task, requirements_json, candidates_json)` — consensus-select a candidate or return `NO_MATCH`. The returned storage ID is scoped to the creator wallet.
- `claim_task(storage_id)` — only the selected candidate address can claim.
- `submit_delivery(storage_id, delivery)` — selected candidate submits work, including a resubmission after a rejection.
- `reroute_task(storage_id, candidates_json)` — the creator can appeal a `NO_MATCH` result with a revised candidate set; previous decisions remain in history.
- `verify_delivery(storage_id)` — validators independently accept or reject the delivery.
- `get_task`, `get_policy`, `get_task_count`, `get_task_id` — read-only views.

The contract uses a pinned GenVM runner and custom validator functions. The route reason is generated deterministically from validator-agreed score bands and missing-requirement fields. Delivery review reasons remain free-form; validators compare the acceptance status and missing-requirement indices.
