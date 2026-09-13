DeadlockBehavior — Health Regen Production V01b

Promotes the final unsupported A metric, health_regen, into replay-generic production.

Authoritative runtime carrier:
  CCitadelPlayerController.m_flHealthRegen

Semantics:
- Direct observed networked runtime field.
- Sampled every 16 ticks, matching PlayerState cadence.
- Raw pregame values are preserved as evidence.
- Gameplay distribution excludes matchTimeSeconds < 0 to avoid pregame transients contaminating gameplay summaries.
- Change evidence is emitted only when the observed value changes.

Does NOT claim:
- realized HP restored from health deltas
- total healing received
- causal decomposition into hero/item/buff/zone/ability sources
- reconstructed effective regen from loadout

Expected successful production result on a normal replay:
  Status: COMPLETE
  Authoritative coverage: 68/68
  Not supported: 0
  Blocked: 0
  Failed: 0

V01b installer repair:
- Fixes PowerShell parsing of a colon immediately following the $rel variable in an error message.
- Production payload and health-regeneration semantics are unchanged from V01.
