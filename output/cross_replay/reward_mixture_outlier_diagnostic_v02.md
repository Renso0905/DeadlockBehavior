# Reward Mixture / Outlier Diagnostic V0.2

Status: **POST_JUNE_30_BASELINE_WITH_SECOND_COMPONENT_STRONGLY_SUPPORTED**

## V01 correction

V01 omitted the `printReplayResult()` console helper and therefore crashed after completing the first replay analysis. V02 restores that helper. No telemetry or extraction data were affected.

## Script105 audit

The Script105 pre-June-30 conclusion remains withdrawn because it selected patch era using RMSE alone despite contradictory MAE and near-exact accuracy.

## Replay results

### rep01

- Eligible cases: 299
- POST ground-only median absolute error: 1
- PRE ground-only median absolute error: 18
- POST case-level win rate: 68.23%
- POST mixture within ±2: 97.99%
- POST mixture second-component rate: 31.77%
- PRE mixture within ±2: 5.02%
- Robust era winner: **POST_JUNE_30_2026**

### rep02

- Eligible cases: 344
- POST ground-only median absolute error: 0
- PRE ground-only median absolute error: 16
- POST case-level win rate: 73.26%
- POST mixture within ±2: 96.22%
- POST mixture second-component rate: 26.16%
- PRE mixture within ±2: 4.36%
- Robust era winner: **POST_JUNE_30_2026**

### rep03

- Eligible cases: 365
- POST ground-only median absolute error: 0
- PRE ground-only median absolute error: 15
- POST case-level win rate: 73.70%
- POST mixture within ±2: 96.71%
- POST mixture second-component rate: 24.66%
- PRE mixture within ±2: 1.64%
- Robust era winner: **POST_JUNE_30_2026**

### rep04

- Eligible cases: 331
- POST ground-only median absolute error: 0
- PRE ground-only median absolute error: 16
- POST case-level win rate: 79.76%
- POST mixture within ±2: 96.68%
- POST mixture second-component rate: 20.24%
- PRE mixture within ±2: 1.51%
- Robust era winner: **POST_JUNE_30_2026**

### rep05

- Eligible cases: 316
- POST ground-only median absolute error: 0
- PRE ground-only median absolute error: 16
- POST case-level win rate: 80.38%
- POST mixture within ±2: 98.10%
- POST mixture second-component rate: 19.30%
- PRE mixture within ±2: 2.85%
- Robust era winner: **POST_JUNE_30_2026**

## Interpretation

The bulk of eligible events follow the post-June-30 ground-reward model. A second reward component explains much of the positive-residual tail substantially better than treating the entire replay cohort as pre-June-30.

A coincident flying-soul payout is a mechanically plausible candidate because the post-June-30 ground/flying split is 50/50, but this script does not directly identify the second reward source.

Next question: Can the high-reward component be directly associated with flying CItemXP acquisition or another exact-tick economic event?
