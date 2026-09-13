# Ground Soul Economic Credit — Extended A V01

This patch promotes only the replicated **economic recipient-set** layer of Ground Soul / `AssignedGold` behavior.

## Added Extended-A metrics

- `ground_soul_economic_credit_events` — resolved isolated/targeted/completed `AssignedGold` lifecycle terminations with a high-confidence economic recipient set.
- `ground_soul_economic_recipient_transitions` — direct positive `CCitadelPlayerPawn.m_nCurrencies.0000` recipient transitions across resolved events.
- `ground_soul_multi_recipient_share` — share of **resolved** economic-credit events with more than one allied recipient.

Authority ledger target after installation: **Core A 68/68 | Extended A 8/8 | Total A 76/76**.

## Conservative production rule

A lifecycle is promoted only when it is completed, physically targeted, isolated from another completed `AssignedGold` termination by ±16 ticks, and has same-team positive `m_nCurrencies.0000` transitions on the exact termination tick. The observed recipient allocation must also form a clean integer partition. Ambiguous overlaps, targetless/censored episodes, no-delta cases, and contaminated/non-partition-clean cases remain unresolved.

## Explicitly NOT claimed

`m_hVacuumTarget` is **physical attraction target telemetry**, not the economic recipient set. This patch does not establish the physical collector, credited last hitter, damage source/method, melee last hit, canonical reward amount/formula, exact share radius, or exact vacuum radius. Raw observed currency deltas are retained as evidence but are not promoted as a canonical reward-value model.

## Visualizer integration

The Troopers & Souls tab gains a Ground Soul economic-credit section, a cumulative resolved-event timeline, an evidence drilldown, and a clearer legacy physical-vacuum-target label. Source Health and Authoritative Stats are updated in the same patch so the statistic never exists only in the backend.

The installer is transactional: it creates a timestamped backup and automatically restores the prior files if integration verification fails.
