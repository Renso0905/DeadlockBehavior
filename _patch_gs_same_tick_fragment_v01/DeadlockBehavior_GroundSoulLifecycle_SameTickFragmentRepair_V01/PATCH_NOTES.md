# Ground Soul lifecycle same-tick fragment repair V01

Purpose: unblock cross-replay preparation when Source 2 entity updates produce a very narrow duplicate activation-key signature: a zero-duration `REACTIVATED_WITHOUT_INACTIVE_CENSORED` fragment immediately followed, on the same entity and tick, by the continuing lifecycle episode.

The repair is intentionally conservative:

- It does **not** permit arbitrary duplicate activation keys.
- It removes only the exact two-record same-tick fragment signature described above.
- The discarded fragment is retained in diagnostic metadata returned by the canonicalizer.
- Any other duplicate activation-key shape remains in the event set and therefore still fails the existing production integrity check.
- No A metric is added, removed, or promoted. The scientific meaning of Ground Soul lifecycle remains unchanged.

After installation, rerun tests and then rerun:

```powershell
.\inspector-v04\run-ground-soul-narrow-isolation-validation.ps1 -Prepare
```
