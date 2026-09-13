DeadlockBehavior - Primary Fire Production V01b

This is the repaired installer for Primary Fire Production V01.

Why V01b exists
- V01 used an overly exact text anchor in inspector-v04/tests/production-pipeline.test.mjs.
- On the user's local tree that formatting did not match, so the installer aborted after some earlier edits had already applied.
- V01b is intentionally idempotent: it detects edits already made by V01, skips them, repairs the remaining fixture edits, recopies the production payload, and verifies all expected markers before reporting success.
- No manual rollback is required before running V01b.

Purpose
- Productionizes five current A-status Primary Fire metrics for arbitrary replay imports:
  primary_discharges, primary_attack_rate, inter_attack_interval, next_primary_ready, ready_delay.
- Uses observed m_nShotNumber advances plus m_flLastAttackTime corroboration.
- Uses m_flNextPrimaryAttack - m_flLastAttackTime as the replicated runtime readiness carrier.
- Does NOT productionize ammo, magazine capacity, DPS, static effective fire-rate formulas, trigger pulls, generic accuracy, or projectile travel.

Expected milestone after successful run
- Authoritative coverage: 67/68
- Not supported: 1 (health_regen)
- Blocked: 0
- Failed: 0

Installer backups are written under patch-backups/primary-fire-production-v01b-<timestamp>.
