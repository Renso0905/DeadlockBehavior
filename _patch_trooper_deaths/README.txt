DeadlockBehavior — Trooper Deaths Extended A V01c Integration Repair

Purpose:
- repairs Authoritative Stats from 68 -> 70 by adding real Trooper death/death-timing mappings
- replaces the brittle production integration fixture with a clean 68 Core A + 2 Extended A contract
- preserves the already-passing Trooper producer/helper logic
- creates a timestamped backup before editing

Run INSTALL.ps1 with -RepoRoot "G:\DeadlockBehavior", then rerun the full Node test suite.
