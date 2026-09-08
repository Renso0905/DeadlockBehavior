// Script182 helpers.
//
// Goal: discover, without assuming a field name, a runtime pawn-state carrier
// for the universal Deadlock slide state using the already-observed ammo
// consequence:
//
//   attack while slide-infinite-ammo is active -> attack occurs but the
//   transformed whole clip counter does not decrement.
//
// Vyper (hero 58) is treated as a positive-control exposure case, NOT as the
// semantic definition. Serious candidates must retain association outside
// hero 58 and across multiple heroes.
//
// No slide claim or magazine-capacity claim is promoted here.

export const SLIDE_DISCOVERY_THRESHOLDS = Object.freeze({
  minFieldCoverageRate: 0.90,
  minPooledPresent: 100,

  minNonVyperPresent: 25,
  minNonVyperPresentZeroRate: 0.70,
  maxNonVyperAbsentZeroRate: 0.08,
  minNonVyperRiskDifference: 0.60,

  minSupportingNonVyperHeroes: 2,
  minPerHeroPresent: 8,
  minPerHeroPresentZeroRate: 0.70,

  maxExactDistinctValuesPerField: 64,
});

export const MOVEMENT_FIELD_PATTERN =
  /(slide|sliding|crouch|duck|move|ground|velocity|speed|dash|stamina|sprint|input|button|flag|locomotion|movement|air|jump)/i;

export function zigzagReencode(raw) {
  if (!Number.isFinite(raw)) return null;
  return raw >= 0 ? 2 * raw : -2 * raw - 1;
}

export function normalizeWeaponEvent(row, sourceIndex = 0) {
  const observed = row?.observedWeaponState ?? {};
  const rawClip = finite(firstDefined(
    observed?.clip,
    deepFindExactKey(row, 'clip'),
    deepFindExactKey(row, 'm_iClip'),
  ));

  return {
    sourceIndex,
    tick: finite(firstDefined(
      row?.tick,
      row?.demoTick,
      deepFindExactKey(row, 'tick'),
    )),
    heroId: finite(firstDefined(
      row?.heroId,
      deepFindExactKey(row, 'heroId'),
    )),
    playerKey: stringOrNull(firstDefined(
      row?.playerKey,
      row?.playerName,
      deepFindExactKey(row, 'playerKey'),
      deepFindExactKey(row, 'playerName'),
    )),
    weaponEntityIndex: finite(firstDefined(
      row?.weaponEntityIndex,
      deepFindExactKey(row, 'weaponEntityIndex'),
    )),
    effectContextId: stringOrNull(firstDefined(
      row?.effectContextId,
      deepFindExactKey(row, 'effectContextId'),
    )) ?? 'NO_EFFECT_CONTEXT_ID',
    activeFireMode: finite(firstDefined(
      observed?.activeFireMode,
      deepFindExactKey(row, 'activeFireMode'),
      deepFindExactKey(row, 'm_eActiveFireMode'),
    )) ?? 0,

    wholeClip: zigzagReencode(rawClip),

    inReload: booleanOrNull(firstDefined(
      observed?.inReload,
      deepFindExactKey(row, 'inReload'),
      deepFindExactKey(row, 'm_bInReload'),
    )),
    shotNumber: finite(firstDefined(
      observed?.shotNumber,
      deepFindExactKey(row, 'shotNumber'),
      deepFindExactKey(row, 'm_nShotNumber'),
    )),
  };
}

export function groupWeaponEventsByContext(events) {
  const map = new Map();

  for (const row of events) {
    const key = [
      row.playerKey ?? 'UNKNOWN_PLAYER',
      row.weaponEntityIndex ?? 'UNKNOWN_WEAPON',
      row.effectContextId ?? 'NO_EFFECT_CONTEXT_ID',
      row.activeFireMode ?? 0,
    ].join('|');

    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }

  for (const rows of map.values()) {
    rows.sort((a, b) =>
      a.tick - b.tick || a.sourceIndex - b.sourceIndex
    );
  }

  return map;
}

export function coalesceFinalWeaponStatePerTick(events) {
  const byTick = new Map();

  for (const row of events) {
    if (Number.isFinite(row.tick)) byTick.set(row.tick, row);
  }

  return [...byTick.values()].sort((a, b) =>
    a.tick - b.tick || a.sourceIndex - b.sourceIndex
  );
}

export function deriveAttackSamples(groupedContexts) {
  const samples = [];

  for (const rows of groupedContexts.values()) {
    const settled = coalesceFinalWeaponStatePerTick(rows);

    for (let index = 1; index < settled.length; index++) {
      const previous = settled[index - 1];
      const current = settled[index];

      if (
        previous.inReload === true
        || current.inReload === true
        || !Number.isFinite(previous.shotNumber)
        || !Number.isFinite(current.shotNumber)
        || !Number.isFinite(previous.wholeClip)
        || !Number.isFinite(current.wholeClip)
      ) {
        continue;
      }

      const shotAdvance =
        current.shotNumber - previous.shotNumber;

      if (shotAdvance <= 0) continue;

      const wholeDrop =
        previous.wholeClip - current.wholeClip;

      samples.push({
        tick: current.tick,
        heroId: current.heroId,
        playerKey: current.playerKey,
        shotAdvance,
        wholeDrop,
        label:
          wholeDrop > 0
            ? 'POSITIVE'
            : wholeDrop < 0
              ? 'NEGATIVE'
              : 'ZERO',
      });
    }
  }

  return samples.sort((a, b) =>
    a.tick - b.tick || (a.heroId ?? 0) - (b.heroId ?? 0)
  );
}

export function indexAttackSamplesByTick(samples) {
  const map = new Map();

  for (const sample of samples) {
    if (!Number.isFinite(sample.tick)) continue;
    if (!map.has(sample.tick)) map.set(sample.tick, []);
    map.get(sample.tick).push(sample);
  }

  return map;
}

export function createCandidateAccumulator(
  thresholds = SLIDE_DISCOVERY_THRESHOLDS,
) {
  return {
    thresholds,
    sampleTotals: emptyCounts(),
    heroTotals: new Map(),

    fieldCoverage: new Map(),
    fieldHeroCoverage: new Map(),

    candidates: new Map(),

    exactDistinct: new Map(),
    exactHighCardinality: new Set(),

    numericMovementSamples: new Map(),
  };
}

export function observePawnSample(
  accumulator,
  {
    heroId,
    label,
    fields,
  },
) {
  if (!['ZERO', 'POSITIVE', 'NEGATIVE'].includes(label)) return;

  incrementCounts(accumulator.sampleTotals, label);

  if (!accumulator.heroTotals.has(heroId)) {
    accumulator.heroTotals.set(heroId, emptyCounts());
  }
  incrementCounts(accumulator.heroTotals.get(heroId), label);

  for (const [field, rawValue] of Object.entries(fields ?? {})) {
    const value = normalizeScalar(rawValue);
    if (value === undefined) continue;

    incrementFieldCoverage(accumulator, field, heroId, label);

    if (
      typeof value === 'number'
      && Number.isFinite(value)
      && MOVEMENT_FIELD_PATTERN.test(field)
    ) {
      observeNumericMovement(
        accumulator,
        field,
        heroId,
        label,
        value,
      );
    }

    if (isExactCandidateScalar(value)) {
      observeExactCandidate(
        accumulator,
        field,
        value,
        heroId,
        label,
      );
    }

    if (
      typeof value === 'number'
      && Number.isInteger(value)
      && value >= 0
      && value <= 0x7fffffff
    ) {
      observeSetBits(
        accumulator,
        field,
        value,
        heroId,
        label,
      );
    }
  }
}

export function finalizeCandidates(
  accumulator,
  thresholds = accumulator.thresholds,
) {
  const totalSemantic =
    accumulator.sampleTotals.ZERO
    + accumulator.sampleTotals.POSITIVE;

  const rows = [];

  for (const candidate of accumulator.candidates.values()) {
    if (
      candidate.kind === 'EXACT'
      && accumulator.exactHighCardinality.has(candidate.field)
    ) {
      continue;
    }

    const coverage =
      accumulator.fieldCoverage.get(candidate.field)
      ?? emptyCounts();

    const pooled = metricFromCounts(
      candidate.present,
      coverage,
    );

    const nonVyperPresent = sumCountsExcludingHero(
      candidate.byHero,
      58,
    );

    const nonVyperCoverage = sumFieldCoverageExcludingHero(
      accumulator,
      candidate.field,
      58,
    );

    const nonVyper = metricFromCounts(
      nonVyperPresent,
      nonVyperCoverage,
    );

    const heroSupport = [];
    const heroDiagnostics = [];

    for (const [heroId, coverageCounts] of heroCoverageEntries(
      accumulator,
      candidate.field,
    )) {
      if (heroId === 58) continue;

      const present =
        candidate.byHero.get(heroId)
        ?? emptyCounts();

      const metric =
        metricFromCounts(
          present,
          coverageCounts,
        );

      const semanticPresent =
        present.ZERO + present.POSITIVE;

      const support =
        semanticPresent >= thresholds.minPerHeroPresent
        && metric.presentZeroRate !== null
        && metric.presentZeroRate
          >= thresholds.minPerHeroPresentZeroRate;

      if (support) heroSupport.push(heroId);

      heroDiagnostics.push({
        heroId,
        present: semanticPresent,
        presentZeroRate: metric.presentZeroRate,
        absentZeroRate: metric.absentZeroRate,
        riskDifference: metric.riskDifference,
        support,
      });
    }

    const fieldSemanticCoverage =
      coverage.ZERO + coverage.POSITIVE;

    const coverageRate =
      totalSemantic > 0
        ? fieldSemanticCoverage / totalSemantic
        : null;

    const pooledPresent =
      candidate.present.ZERO + candidate.present.POSITIVE;

    const nonVyperPresentN =
      nonVyperPresent.ZERO + nonVyperPresent.POSITIVE;

    const serious =
      coverageRate !== null
      && coverageRate >= thresholds.minFieldCoverageRate
      && pooledPresent >= thresholds.minPooledPresent
      && nonVyperPresentN >= thresholds.minNonVyperPresent
      && nonVyper.presentZeroRate !== null
      && nonVyper.presentZeroRate
        >= thresholds.minNonVyperPresentZeroRate
      && nonVyper.absentZeroRate !== null
      && nonVyper.absentZeroRate
        <= thresholds.maxNonVyperAbsentZeroRate
      && nonVyper.riskDifference !== null
      && nonVyper.riskDifference
        >= thresholds.minNonVyperRiskDifference
      && heroSupport.length
        >= thresholds.minSupportingNonVyperHeroes;

    rows.push({
      candidateId: candidate.id,
      field: candidate.field,
      kind: candidate.kind,
      value: candidate.value ?? null,
      bit: candidate.bit ?? null,
      movementNameHint:
        MOVEMENT_FIELD_PATTERN.test(candidate.field),

      coverageRate,
      pooledPresent,
      nonVyperPresent: nonVyperPresentN,

      pooled,
      nonVyper,

      supportingNonVyperHeroes: heroSupport,
      supportingNonVyperHeroCount: heroSupport.length,
      heroDiagnostics:
        heroDiagnostics.sort((a, b) =>
          b.present - a.present
        ),

      seriousUniversalSlideCandidate: serious,

      score:
        candidateScore(
          serious,
          nonVyper,
          heroSupport.length,
          nonVyperPresentN,
          MOVEMENT_FIELD_PATTERN.test(candidate.field),
        ),
    });
  }

  rows.sort((a, b) =>
    b.score - a.score
    || b.supportingNonVyperHeroCount
      - a.supportingNonVyperHeroCount
    || b.nonVyperPresent - a.nonVyperPresent
  );

  const serious = rows.filter(
    row => row.seriousUniversalSlideCandidate
  );

  const numericMovement =
    finalizeNumericMovement(accumulator);

  return {
    serious,
    ranked: rows,
    numericMovement,
    classification:
      serious.length > 0
        ? 'UNIVERSAL_SLIDE_RUNTIME_CARRIER_CANDIDATE_DISCOVERED'
        : 'UNIVERSAL_SLIDE_RUNTIME_CARRIER_REQUIRES_DIAGNOSIS',
  };
}

export function flattenPrimitiveChanges(
  changes,
  maxDepth = 2,
) {
  const output = {};

  for (const [field, value] of Object.entries(changes ?? {})) {
    flattenValue(output, field, value, 0, maxDepth);
  }

  return output;
}

function flattenValue(output, path, value, depth, maxDepth) {
  const scalar = normalizeScalar(value);

  if (scalar !== undefined) {
    output[path] = scalar;
    return;
  }

  if (
    depth >= maxDepth
    || !value
    || typeof value !== 'object'
  ) {
    return;
  }

  if (Array.isArray(value)) {
    if (value.length > 8) return;

    for (let i = 0; i < value.length; i++) {
      flattenValue(
        output,
        `${path}.${String(i).padStart(4, '0')}`,
        value[i],
        depth + 1,
        maxDepth,
      );
    }
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    flattenValue(
      output,
      `${path}.${key}`,
      child,
      depth + 1,
      maxDepth,
    );
  }
}

function observeExactCandidate(
  accumulator,
  field,
  value,
  heroId,
  label,
) {
  if (!accumulator.exactDistinct.has(field)) {
    accumulator.exactDistinct.set(field, new Set());
  }

  const distinct =
    accumulator.exactDistinct.get(field);

  const encoded =
    encodeValue(value);

  if (!distinct.has(encoded)) {
    distinct.add(encoded);

    if (
      distinct.size
      > accumulator.thresholds.maxExactDistinctValuesPerField
    ) {
      accumulator.exactHighCardinality.add(field);
    }
  }

  if (accumulator.exactHighCardinality.has(field)) return;

  const id =
    `EXACT|${field}|${encoded}`;

  const candidate =
    getOrCreateCandidate(
      accumulator,
      id,
      {
        field,
        kind: 'EXACT',
        value,
      },
    );

  incrementCandidate(candidate, heroId, label);
}

function observeSetBits(
  accumulator,
  field,
  value,
  heroId,
  label,
) {
  if (value === 0) return;

  for (let bit = 0; bit <= 30; bit++) {
    const mask = 2 ** bit;

    if ((value & mask) === 0) continue;

    const id =
      `BIT|${field}|${bit}`;

    const candidate =
      getOrCreateCandidate(
        accumulator,
        id,
        {
          field,
          kind: 'BIT_SET',
          bit,
          value: mask,
        },
      );

    incrementCandidate(candidate, heroId, label);
  }
}

function getOrCreateCandidate(
  accumulator,
  id,
  seed,
) {
  if (!accumulator.candidates.has(id)) {
    accumulator.candidates.set(
      id,
      {
        id,
        ...seed,
        present: emptyCounts(),
        byHero: new Map(),
      },
    );
  }

  return accumulator.candidates.get(id);
}

function incrementCandidate(candidate, heroId, label) {
  incrementCounts(candidate.present, label);

  if (!candidate.byHero.has(heroId)) {
    candidate.byHero.set(heroId, emptyCounts());
  }

  incrementCounts(
    candidate.byHero.get(heroId),
    label,
  );
}

function incrementFieldCoverage(
  accumulator,
  field,
  heroId,
  label,
) {
  if (!accumulator.fieldCoverage.has(field)) {
    accumulator.fieldCoverage.set(field, emptyCounts());
  }

  incrementCounts(
    accumulator.fieldCoverage.get(field),
    label,
  );

  if (!accumulator.fieldHeroCoverage.has(field)) {
    accumulator.fieldHeroCoverage.set(
      field,
      new Map(),
    );
  }

  const byHero =
    accumulator.fieldHeroCoverage.get(field);

  if (!byHero.has(heroId)) {
    byHero.set(heroId, emptyCounts());
  }

  incrementCounts(
    byHero.get(heroId),
    label,
  );
}

function observeNumericMovement(
  accumulator,
  field,
  heroId,
  label,
  value,
) {
  if (!accumulator.numericMovementSamples.has(field)) {
    accumulator.numericMovementSamples.set(
      field,
      {
        ZERO: [],
        POSITIVE: [],
        NEGATIVE: [],
        byHero: new Map(),
      },
    );
  }

  const entry =
    accumulator.numericMovementSamples.get(field);

  entry[label].push(value);

  if (!entry.byHero.has(heroId)) {
    entry.byHero.set(heroId, {
      ZERO: [],
      POSITIVE: [],
      NEGATIVE: [],
    });
  }

  entry.byHero.get(heroId)[label].push(value);
}

function finalizeNumericMovement(accumulator) {
  const rows = [];

  for (const [field, entry] of accumulator.numericMovementSamples) {
    if (
      entry.ZERO.length < 25
      || entry.POSITIVE.length < 100
    ) {
      continue;
    }

    const zeroMedian = median(entry.ZERO);
    const positiveMedian = median(entry.POSITIVE);

    const zeroMean = mean(entry.ZERO);
    const positiveMean = mean(entry.POSITIVE);

    const pooledSd =
      pooledStandardDeviation(
        entry.ZERO,
        entry.POSITIVE,
      );

    const standardizedMeanDifference =
      pooledSd > 1e-12
        ? (zeroMean - positiveMean) / pooledSd
        : 0;

    rows.push({
      field,
      zeroN: entry.ZERO.length,
      positiveN: entry.POSITIVE.length,
      zeroMedian,
      positiveMedian,
      zeroMean,
      positiveMean,
      standardizedMeanDifference,
      absoluteStandardizedDifference:
        Math.abs(standardizedMeanDifference),
    });
  }

  return rows
    .sort((a, b) =>
      b.absoluteStandardizedDifference
      - a.absoluteStandardizedDifference
    );
}

function metricFromCounts(present, coverage) {
  const absent = {
    ZERO: Math.max(0, coverage.ZERO - present.ZERO),
    POSITIVE: Math.max(0, coverage.POSITIVE - present.POSITIVE),
    NEGATIVE: Math.max(0, coverage.NEGATIVE - present.NEGATIVE),
  };

  const presentSemantic =
    present.ZERO + present.POSITIVE;

  const absentSemantic =
    absent.ZERO + absent.POSITIVE;

  const presentZeroRate =
    presentSemantic > 0
      ? present.ZERO / presentSemantic
      : null;

  const absentZeroRate =
    absentSemantic > 0
      ? absent.ZERO / absentSemantic
      : null;

  return {
    present: {
      ...present,
      semantic: presentSemantic,
    },
    absent: {
      ...absent,
      semantic: absentSemantic,
    },
    presentZeroRate,
    absentZeroRate,
    riskDifference:
      presentZeroRate !== null
      && absentZeroRate !== null
        ? presentZeroRate - absentZeroRate
        : null,
    zeroPrevalenceAmongZero:
      coverage.ZERO > 0
        ? present.ZERO / coverage.ZERO
        : null,
    prevalenceAmongPositive:
      coverage.POSITIVE > 0
        ? present.POSITIVE / coverage.POSITIVE
        : null,
  };
}

function candidateScore(
  serious,
  nonVyper,
  heroSupportCount,
  nonVyperPresent,
  movementNameHint,
) {
  let score = serious ? 1000 : 0;

  score +=
    300 * Math.max(
      0,
      nonVyper.riskDifference ?? 0,
    );

  score +=
    50 * heroSupportCount;

  score +=
    Math.log10(
      Math.max(1, nonVyperPresent),
    ) * 10;

  if (movementNameHint) score += 25;

  return score;
}

function sumCountsExcludingHero(byHero, excludedHero) {
  const result = emptyCounts();

  for (const [heroId, counts] of byHero) {
    if (heroId === excludedHero) continue;

    result.ZERO += counts.ZERO;
    result.POSITIVE += counts.POSITIVE;
    result.NEGATIVE += counts.NEGATIVE;
  }

  return result;
}

function sumFieldCoverageExcludingHero(
  accumulator,
  field,
  excludedHero,
) {
  const result = emptyCounts();

  const byHero =
    accumulator.fieldHeroCoverage.get(field)
    ?? new Map();

  for (const [heroId, counts] of byHero) {
    if (heroId === excludedHero) continue;

    result.ZERO += counts.ZERO;
    result.POSITIVE += counts.POSITIVE;
    result.NEGATIVE += counts.NEGATIVE;
  }

  return result;
}

function heroCoverageEntries(accumulator, field) {
  return accumulator.fieldHeroCoverage.get(field)
    ?? new Map();
}

function emptyCounts() {
  return {
    ZERO: 0,
    POSITIVE: 0,
    NEGATIVE: 0,
  };
}

function incrementCounts(counts, label) {
  counts[label] = (counts[label] ?? 0) + 1;
}

function isExactCandidateScalar(value) {
  return (
    typeof value === 'boolean'
    || typeof value === 'string'
    || (
      typeof value === 'number'
      && Number.isFinite(value)
      && Number.isInteger(value)
    )
  );
}

function encodeValue(value) {
  return `${typeof value}:${JSON.stringify(value)}`;
}

function normalizeScalar(value) {
  if (
    value === null
    || value === undefined
  ) {
    return undefined;
  }

  if (
    typeof value === 'string'
    || typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? value
      : undefined;
  }

  if (typeof value === 'bigint') {
    const number = Number(value);
    return Number.isSafeInteger(number)
      ? number
      : value.toString();
  }

  return undefined;
}

function median(values) {
  if (!values.length) return null;

  const sorted =
    [...values].sort((a, b) => a - b);

  const middle =
    Math.floor(sorted.length / 2);

  return sorted.length % 2
    ? sorted[middle]
    : (
      sorted[middle - 1]
      + sorted[middle]
    ) / 2;
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce(
    (sum, value) => sum + value,
    0,
  ) / values.length;
}

function pooledStandardDeviation(a, b) {
  const all = [...a, ...b];
  if (all.length < 2) return 0;

  const m = mean(all);
  const variance =
    all.reduce(
      (sum, value) =>
        sum + (value - m) ** 2,
      0,
    ) / (all.length - 1);

  return Math.sqrt(variance);
}

export function deepFindExactKey(
  root,
  key,
  maxDepth = 8,
) {
  if (!root || typeof root !== 'object') {
    return undefined;
  }

  const seen = new Set();
  const queue = [{ value: root, depth: 0 }];

  while (queue.length) {
    const { value, depth } = queue.shift();

    if (
      !value
      || typeof value !== 'object'
      || seen.has(value)
      || depth > maxDepth
    ) {
      continue;
    }

    seen.add(value);

    if (
      !Array.isArray(value)
      && Object.prototype.hasOwnProperty.call(
        value,
        key,
      )
    ) {
      return value[key];
    }

    for (
      const child
      of (
        Array.isArray(value)
          ? value
          : Object.values(value)
      )
    ) {
      if (
        child
        && typeof child === 'object'
      ) {
        queue.push({
          value: child,
          depth: depth + 1,
        });
      }
    }
  }

  return undefined;
}

function firstDefined(...values) {
  return values.find(
    value =>
      value !== undefined
      && value !== null,
  );
}

function finite(value) {
  if (
    value === null
    || value === undefined
    || value === ''
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function booleanOrNull(value) {
  if (
    value === true
    || value === false
  ) {
    return value;
  }

  if (
    value === 1
    || value === '1'
    || value === 'true'
  ) {
    return true;
  }

  if (
    value === 0
    || value === '0'
    || value === 'false'
  ) {
    return false;
  }

  return null;
}

function stringOrNull(value) {
  if (
    value === null
    || value === undefined
  ) {
    return null;
  }

  const text = String(value);
  return text.length > 0 ? text : null;
}
