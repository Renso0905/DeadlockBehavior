# DeadlockBehavior Modular Workspace Replay + Heat Map V02

This patch extends **Modular Workspace V01** with a replay-oriented spatial panel. It does **not** change extraction, claim authority, or the 77/77 A-stat ledger.

## New workspace features

- **+ Replay / heat map** creates a draggable spatial panel alongside ordinary metric cards.
- Independent player selector per replay panel.
- Display modes: current position, trail, heat map, or heat map + trail.
- Heat windows: cumulative through the current scrubber time, last 30 s, last 60 s, last 2 min, or last 5 min.
- Global Workspace playback controls: Play/Pause, 0.5×/1×/2×/4×, and ±5-second steps.
- Heat maps evolve as the global replay scrubber advances.
- Occupancy is **time-weighted**, not just sample-count weighted: each valid alive position contributes its observed interval duration to a spatial bin.
- Dead-time occupancy is excluded so a corpse/stale death position does not become a false dwell hotspot.
- Position gaps longer than 3 seconds are excluded rather than assuming the player remained at the last observed coordinate.
- Spatial summary shows observed alive-position time represented, occupied cells, peak-cell dwell, and usable position intervals.

## Important semantic boundary

This is a **derived diagnostic spatial view**, not a new A statistic. The replay model currently exposes sampled world coordinates (roughly one retained point per second). Therefore the heat map estimates observed positional dwell at that sampling resolution; it is not frame-perfect occupancy.

The visual is also still a **world-coordinate plane**, not a validated Midtown map. We should not place the heat map over a Deadlock map image until the world-coordinate → map-image transform has been independently validated.

## Install

Install Modular Workspace V01 first. Then extract this ZIP and run:

```powershell
& ".\INSTALL.ps1" -RepoRoot "G:\DeadlockBehavior"
```

Then:

```powershell
cd G:\DeadlockBehavior
.\inspector-v04\test-inspector.ps1
.\inspector-v04\run-inspector.ps1
```

Open **Workspace** and click **+ Replay / heat map**.
