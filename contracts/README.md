# DeadlockBehavior claim authority layer

The numbered `scripts/` directory remains the project's computational laboratory notebook: it preserves discovery order, failed hypotheses, supersessions, and validation history.

This directory serves a different purpose. It records the **current authority state of the major findings produced by those scripts** so downstream code does not need to remember which historical script is still trustworthy.

## Rule for downstream code

Future runtime, behavioral, and prediction code should consume a claim only when the registry says that claim is usable for the intended purpose. Do not promote a historical script merely because its output contains `validation.pass === true`.

Each claim keeps three validation dimensions separate:

- `integrityValidation`: did the computation/schema/invariants execute correctly?
- `semanticValidation`: is the game-mechanical interpretation independently supported?
- `replicationStatus`: has the interpretation reproduced outside the discovery replay/build?

`authorityStatus` has four values:

- `current`: current authority for its stated scope.
- `provisional`: useful, but not yet strong enough to be treated as unrestricted authority.
- `withdrawn`: explicitly superseded/rejected; never use downstream as current truth.
- `missing`: a required construct that has not yet been resolved.

## Build-bound resource contracts

Static VData/resource claims are version-bound. Their meaning is current only for the resource hashes/build from which they were extracted. A Deadlock patch should trigger re-extraction/revalidation rather than silently carrying the old values forward.

## Historical scripts are not discarded

The registry references the numbered scripts that established, challenged, or superseded each claim. The scripts remain the evidence trail. The registry is the operational index that says which conclusion future code should use.

## V02 update

Script139 V03 promotes `shop_item_effect_contract` to current **resource-contract** authority. This does not promote runtime item ownership, modifier activation, or effective stat composition; those remain separate claims.


## V03 update

Scripts140–142 promote `runtime_item_ownership` to current **cross-replay replicated** authority. `CCitadelPlayerController.m_vecUpgrades` set membership is now the operational standard-shop ownership state for downstream `PlayerState(t)` work. This promotion is intentionally narrower than transaction-subtype semantics: a removal is not automatically a sale, because component consumption/replacement and other vector transitions still require separate classification.
