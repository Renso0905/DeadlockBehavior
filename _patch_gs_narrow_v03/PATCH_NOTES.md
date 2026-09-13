# DeadlockBehavior — Ground Soul Narrow-Isolation Validation V03

## Purpose

This patch validates the narrower Ground Soul economic-isolation hypothesis across the independent replication cohort `rep01`–`rep05`.

V02 showed that many current `UNRESOLVED_NONISOLATED_TERMINATION` rows have distinct exact resolution ticks and clean same-team `m_nCurrencies.0000` transitions. V03 does **not** change production. It asks whether a same-team isolation rule remains mechanically deterministic across independent replays when the isolation radius is swept across `0, 1, 2, 4, 8, 16` ticks.

## Authority boundary

- Research / validation tier: **B**.
- Does **not** modify `runtime-assigned-gold-economic-credit.mjs`.
- Does **not** modify any production producer or `pipeline.json`.
- Does **not** add any A metric.
- The existing **77/77 A ledger remains unchanged**.
- A V03 recovered candidate is not automatically promoted into authoritative economic attribution.

## Validation checks

For each replay V03 verifies:

- Coverage Audit V01 and Collision Audit V02 agree on the current nonisolated set.
- The V03 exact-tick recomputation exactly matches V02's declared counterfactual-pass set.
- Existing A rows still satisfy the exact-tick currency and integer-partition contract.
- Recovered candidates have complete exact-tick same-team positive currency context and clean integer partitions.
- No recovered candidate has another same-team Ground Soul on the same resolution tick.
- No two accepted events reuse the same `(team, resolutionTick)` economic boundary.
- No two accepted events reuse the same `(team, resolutionTick, pawnEntityIndex)` recipient transition.
- Same-team radius sensitivity is monotonic across `0, 1, 2, 4, 8, 16` ticks.

## Cross-replay decision

V03 emits `GROUND_SOUL_NARROW_ISOLATION_VALIDATION_V03_READY` only when all five expected independent replays are present and every replay passes the mechanical integrity checks.

A READY result is reported as:

- `integrityValidation: pass`
- `semanticValidation: strong_support`
- `replicationStatus: cross_replay_supported_5_of_5`
- production recommendation: `candidate_for_production_resolver_review_not_promoted`

That recommendation means a separate production-promotion decision can be considered. V03 itself does not modify A attribution.

## New files

- `scripts/208-validate-ground-soul-narrow-isolation-cross-replay-v03.mjs`
- `inspector-v04/lib/research-ground-soul-narrow-isolation-validation.mjs`
- `inspector-v04/run-ground-soul-narrow-isolation-validation.ps1`
- `inspector-v04/tests/ground-soul-narrow-isolation-validation.test.mjs`
- `inspector-v04/tests/ground-soul-narrow-isolation-validation-ui.test.mjs`

## Generated outputs

Per replay:

- `ground_soul_narrow_isolation_validation_v03.json`

Cross replay:

- `output/cross_replay/ground_soul_narrow_isolation_validation_v03.json`
- `output/cross_replay/ground_soul_narrow_isolation_recovered_candidates_v03.jsonl`

## Preparation mode

The runner can prepare the cohort automatically:

```powershell
.\inspector-v04\run-ground-soul-narrow-isolation-validation.ps1 -Prepare
```

For each `rep01`–`rep05`, preparation:

1. Reuses runtime Ground Soul lifecycle production if already present, otherwise generates it.
2. Reuses current conservative economic-credit production if already present, otherwise generates it.
3. Refreshes Coverage Audit V01, including the direct `currency0` rescan.
4. Refreshes Collision Audit V02.
5. Runs cross-replay V03.

Because Coverage Audit V01 rescans five `.dem` files, `-Prepare` can take several minutes.

If all V01/V02 prerequisites are already fresh, run without `-Prepare` for a fast aggregation:

```powershell
.\inspector-v04\run-ground-soul-narrow-isolation-validation.ps1
```

## Workspace

Adds **+ GS isolation validation** to Workspace. It shows:

- pooled current A events;
- pooled exact-tick recovered candidates;
- hypothetical resolved total and lifecycle share;
- radius-sensitivity curve as bars;
- per-replay recovered candidate counts;
- selected replay result when the open replay is in `rep01`–`rep05`;
- duplicate-boundary / duplicate-recipient integrity counts;
- the V03 production recommendation.
