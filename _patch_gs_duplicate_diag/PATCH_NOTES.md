# Ground Soul Lifecycle Duplicate Activation Diagnostic V01

Purpose: diagnose the `duplicateActivationKeys` integrity failure observed while preparing the V03 narrow-isolation replication cohort on `rep01`.

This patch is intentionally diagnostic only. It does **not** merge, suppress, discard, or reinterpret duplicate lifecycle episodes; it does **not** alter the Ground Soul resolver, the production authority ledger, or the 77/77 A metric count. The existing `duplicateActivationKeys` integrity guard still fails exactly as before.

When duplicates occur, the lifecycle producer now writes:

`output/<replay>/runtime_ground_soul_lifecycle_duplicate_activation_diagnostic_v01.json`

The artifact groups every duplicate `(activationTick, entityIndex)` identity and preserves all conflicting episodes plus the immediately adjacent episode for that entity. It summarizes zero-tick episodes, same-tick close/reopen signatures, differing end ticks, and differing target states. The first 20 groups are printed to the console before the producer intentionally throws.

Recommended run:

```powershell
cd G:\DeadlockBehavior
.\inspector-v04\test-inspector.ps1
.\inspector-v04\run-ground-soul-narrow-isolation-validation.ps1 -Prepare
```

The second command is expected to stop again on rep01. Paste the new diagnostic block; the failure itself is expected and is evidence that the integrity guard was preserved.
