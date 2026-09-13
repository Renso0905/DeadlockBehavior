# DeadlockBehavior — Ground Soul Collision Resolution Audit V02

## Purpose

This patch is the second-stage diagnostic follow-up to `GROUND_SOUL_ECONOMIC_COVERAGE_AUDIT_V01`.

Coverage Audit V01 showed that the dominant exclusion stage is termination isolation. V02 does **not** loosen that production rule. Instead it dissects every `UNRESOLVED_NONISOLATED_TERMINATION` event so we can determine which collisions are genuinely ambiguous and which would only be excluded because the current ±16-tick isolation rule is broader than the exact-tick / same-team economic attribution rule.

## Authority boundary

- Research / diagnostic tier: **B**.
- Does **not** modify `runtime-assigned-gold-economic-credit.mjs`.
- Does **not** modify any production producer or `pipeline.json`.
- Does **not** add any A metric.
- The existing **77/77 A ledger remains unchanged**.
- A counterfactual-pass row is **not** a promoted reward event.

## New diagnostic dimensions

For each currently nonisolated Ground Soul lifecycle, V02 records:

- same-tick same-team AssignedGold neighbors;
- same-tick other-team neighbors;
- nearby different-tick same-team neighbors;
- nearby different-tick other-team neighbors;
- temporal collision-cluster membership and cluster size;
- exact-tick same-team positive `m_nCurrencies.0000` transitions already captured by Coverage Audit V01;
- the current integer-partition test applied to those exact-tick transitions;
- whether the physical target appears in that exact-tick recipient set, retained only as diagnostic context;
- nearby / same-tick Trooper-death concurrency, explicitly retained as temporal context rather than source-death identity.

## Counterfactual narrower-isolation test

V02 evaluates this algorithmic question:

> What would happen if the isolation rule rejected only another completed AssignedGold lifecycle from the **same team on the exact same tick**, while retaining the current exact-tick, same-team, positive-currency, integer-partition requirements?

Rows are classified as, for example:

- `WOULD_PASS_NARROWER_SAME_TICK_SAME_TEAM_ISOLATION`
- `STILL_AMBIGUOUS_SAME_TICK_SAME_TEAM`
- `NO_EXACT_TICK_SAME_TEAM_CURRENCY`
- `NONPARTITION_CLEAN_EXACT_TICK_CURRENCY`
- `CURRENCY_CONTEXT_TRUNCATED`

This is an **algorithmic counterfactual only**. The patch intentionally does not treat counterfactual-pass events as scientifically validated attribution.

## Calibration support

The runner accepts an optional focus time in seconds. For the manual simultaneous-death case at approximately **2:12**, run with focus `132`. It prints all nonisolated cases within ±2 seconds, including exact ticks, collision class, same-team currency context, and Trooper-concurrency class.

## Workspace

Adds **+ Ground Soul collisions** to the modular Workspace. The panel shows:

- current nonisolated count;
- collision-cluster count;
- how many events would pass the narrower algorithmic rule;
- how many remain same-tick / same-team ambiguous;
- collision-class distribution;
- counterfactual-result distribution;
- nearest collision events to the global replay scrubber, with click-to-jump behavior.

## New files

- `scripts/207-audit-ground-soul-collision-resolution-v02.mjs`
- `inspector-v04/lib/research-ground-soul-collision-resolution.mjs`
- `inspector-v04/run-ground-soul-collision-audit.ps1`
- `inspector-v04/tests/ground-soul-collision-resolution-audit.test.mjs`
- `inspector-v04/tests/ground-soul-collision-resolution-ui.test.mjs`

## Generated outputs

Per replay:

- `ground_soul_collision_resolution_audit_v02.json`
- `ground_soul_collision_resolution_audit_events_v02.jsonl`

Batch mode:

- `output/cross_replay/ground_soul_collision_resolution_audit_batch_v02.json`

## Run order

```powershell
.\inspector-v04\test-inspector.ps1
.\inspector-v04\run-ground-soul-collision-audit.ps1 104373259 132
.\inspector-v04\run-inspector.ps1
```

Then add **Ground Soul collisions** in Workspace.

For later cross-replay characterization, first ensure Coverage Audit V01 exists for the replication cohort, then run:

```powershell
.\inspector-v04\run-ground-soul-coverage-audit.ps1 all
.\inspector-v04\run-ground-soul-collision-audit.ps1 all
```
