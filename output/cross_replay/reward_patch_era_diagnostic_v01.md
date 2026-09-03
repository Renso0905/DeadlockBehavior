# Cross-Replay Reward Patch-Era Diagnostic

Status: **PRE_JUNE_30_REWARD_REGIME_STRONGLY_SUPPORTED**

## Historical models

- Pre-June-30-2026 ground reward: `69.6 + 0.696 × matchMinute`.
- Post-June-30-2026 ground reward: `50 + 1 × matchMinute`.

## Replay results

### rep01

- Eligible cases: 299
- Empirical curve: 67.639 + 1.1567 × minute
- Pre-June-30 RMSE: 33.5882
- Post-June-30 RMSE: 38.8783
- Winner: **PRE_JUNE_30_2026**

### rep02

- Eligible cases: 344
- Empirical curve: 72.4107 + 0.6797 × minute
- Pre-June-30 RMSE: 30.4428
- Post-June-30 RMSE: 35.0716
- Winner: **PRE_JUNE_30_2026**

### rep03

- Eligible cases: 365
- Empirical curve: 76.1781 + 0.3458 × minute
- Pre-June-30 RMSE: 27.4635
- Post-June-30 RMSE: 31.9801
- Winner: **PRE_JUNE_30_2026**

### rep04

- Eligible cases: 331
- Empirical curve: 69.1387 + 0.5752 × minute
- Pre-June-30 RMSE: 26.017
- Post-June-30 RMSE: 28.8883
- Winner: **PRE_JUNE_30_2026**

### rep05

- Eligible cases: 316
- Empirical curve: 65.2027 + 0.8163 × minute
- Pre-June-30 RMSE: 27.5702
- Post-June-30 RMSE: 30.1076
- Winner: **PRE_JUNE_30_2026**

## Interpretation

The replication cohort strongly expresses the documented pre-June-30-2026 Trooper economy signature: total bounty 116 + 1.16/min with 40% flying / 60% ground, yielding ground reward 69.6 + 0.696/min.

The test.dem post-June-30 reward curve and the independent replay cohort should be treated as different game-version strata rather than failed replications of one invariant reward formula.
