DeadlockBehavior — Source Health Semantics V01

Purpose
-------
Fix the inspector's misleading Source Health headline. The old view counted every
research/legacy source file equally, so a replay with 67/68 authoritative production
coverage appeared as only 9/24 "healthy" sources.

This patch:
- exposes production_manifest_v01.json in the replay model;
- invalidates the replay-model cache when that manifest changes;
- shows authoritative production coverage separately from source-file availability;
- separates current production files, research/diagnostic backlog, and legacy/superseded files;
- adds a regression test so missing legacy/research files cannot be confused with production failure.

No replay extraction semantics or metric definitions are changed.
