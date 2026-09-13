**Reliability work and findings for review — 2026-09-12**

Backup: `G:\DeadlockBehavior-backup-before-reliability-20260912`. SHA-256 verified 4,542 files / 10,749,693,828 bytes before application edits. Verification is recorded in the backup's `BACKUP_VERIFICATION.json`.

The implementation preserves the research notebook, validated all original 108 A metrics, and then promoted one narrowly supported B metric. The current contract is 109 A metrics: 99 core and 10 extended. All promotions require evidence, producer ownership, availability, and display/export coverage.

| Finding | Action / review status |
|---|---|
| Pregame included in alive/dead, health and firing aggregates | Gameplay integration and primary-fire events exclude time below zero; regression tests check time partitions and baselines. |
| Fixed 30-second team tick reconstruction | Uses the replay's observed offset; non-30-second fixture tested. |
| Checkpoints beyond the replay | Only reached checkpoints are emitted. |
| Missing telemetry converted to zero/dead | Explicit nullable fields, unknown-state duration, source/field availability, strict JSONL parsing. |
| Duplicate player names merged | Model and UI use controller-based player IDs; melee producer grouping and evidence identity filters corrected. |
| Next-primary-ready read obsolete fields and looked beyond scrubber | Shared metric evaluator uses production readiness timeline at or before selected time. |
| A mapping count presented without source validity | Availability is separate from wiring, with per-player reasons and published-run provenance. |
| Stale contract did not trigger processing | Exact metric IDs, input fingerprints, and output hashes gate readiness; failed unchanged inputs require deliberate retry. |
| Partial runs could mix old and new artifacts | Isolated workspaces, immutable published run directories, manifest publication after validation. Flat compatibility files remain for historical scripts; the visualizer reads the published snapshot. |
| Stale disk/in-memory model | Model cache includes schema, code and input fingerprints; requests recheck before reusing cache. |
| Melee/scoreboard evidence routes stale | Dedicated runtime melee and player-state scoreboard routes; controller-scoped filtering. |
| Existing producer-count test expected nine | Updated to ten; current root suite passes. |
| Full sample stream reduced to one-second samples in UI | State queries now retain the observed sample cadence, avoiding omitted within-second changes. |
| Final fractional second of team advantage omitted | Team series includes observed fractional end boundary. |
| Some legacy A summary cards bypassed availability | Fixed: canonical cards use the shared evaluator; legacy A summaries fail closed when the published run or required field is unavailable. Browser checked at 109/109 with zero unavailable/unmapped cards. |
| Comparison panels reset distinct same-name/player selections | Fixed: workspace persistence and validation use stable controller-based player IDs. |
| No visible retry for a failed or stale replay | Fixed: Process / retry invokes the same serialized production path as import and the filesystem watcher. |
| B metric `ground_soul_vacuum_target` mixed research matching with a broad label | Promoted narrowly as per-player resolved first physical `m_hVacuumTarget` links. Across all seven local replays, 12,181/12,183 links resolved (99.98%); two stale identities remain unresolved. All seven AssignedGold-index negative controls resolved zero. This is not economic receipt, collection, payout, ownership, reward value, or last-hit identity. |
| Original broad Ground Soul resolver promotion candidate | HELD FOR REVIEW: V03 deterministic recovery and no-reuse gates do not independently prove economic attribution; negative/control evidence is still needed. |
| Official/pause-adjusted game clock | OPEN SCIENTIFIC LIMIT: current axis is observed demo ticks minus the observed offset; official pause-adjusted clock authority is not established. |
| Resource compatibility across future game patches | OPEN SCIENTIFIC LIMIT: frozen resource contracts are fingerprinted and producer gates reject unknown carriers; unseen builds still require validation. |
| Prediction readiness | OPEN: final-match aggregates are explicitly retrospective. A future feature dataset needs observation-time cutoffs, stable player identity across matches, and held-out player/match/build evaluation. |

The backup includes pre-existing uncommitted research outputs. They were not reset. A review finding does not automatically authorize a scientific promotion.

Final validation: all seven local replays published 109/109 (`test`, `rep01`–`rep05`, `104373259`). The reliability validator passed 84 players and 27,468 start/mid/end probes with no errors. The research/contract suite passed 362/362 and the inspector/pipeline suite passed 96/96. Browser validation showed 109/109 available and mapped, including the promoted stat.

Validation command: `node scripts/228-validate-production-reliability.mjs --process <replay-name> ...`. Reports go to `output/cross_replay/production_reliability_*_v02.json`. The promotion replication report is `output/cross_replay/ground_soul_physical_target_promotion_validation_v01.json`. The validator checks the entire canonical A set for every player at start, midpoint and end, plus time, movement, melee, scoreboard and team reconciliations. `available=false` and a measured zero are distinct.
