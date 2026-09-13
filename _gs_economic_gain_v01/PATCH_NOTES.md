# Ground Soul Economic Gain + Evidence UX V01

Prerequisite: Ground Soul Economic Credit Extended A V01 already installed and accepted.

This patch adds one derived Extended-A metric from the existing authoritative economic-recipient event stream:

- `ground_soul_economic_gain` — **Total Ground Soul Economic Gain**
  - cumulative selected-player sum of observed positive `m_nCurrencies.0000` deltas from resolved Ground Soul economic-credit events;
  - follows the global match-time scrubber;
  - excludes unresolved / ineligible events rather than estimating them.

It also upgrades the economic-credit evidence drawer:

- recognizes `resolutionMatchTimeSeconds` as the event timestamp;
- collapsed rows show timestamp, exact resolution tick, recipient count, and observed event credit;
- expanded rows show each resolved recipient and that player's observed `currency0` increase;
- shows total observed same-team credit for the event and whether the physical vacuum target is in the economic recipient set;
- preserves raw JSON underneath for auditability.

Semantic boundary: displayed amounts remain **observed currency0 economic credit on an authoritatively resolved event**, not a promoted canonical Ground Soul reward formula. Physical vacuum target, collector, last hitter, damage source, melee method, exact reward schedule, and exact radii remain separate/unresolved claims.

Authority ledger target after production rerun:

- Core A: 68/68
- Extended A: 9/9
- Total A: 77/77
