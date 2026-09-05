import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';

import {
  EntityOperation,
  InterceptorStage,
  Logger,
  Parser,
  ParserConfiguration,
} from 'deadem';

import { requireClaim } from '../src/contracts/claim-registry.mjs';

const VERSION = 'RUNTIME_ITEM_VECTOR_SEMANTIC_VALIDATION_V02';
const TICKS_PER_SECOND = 64;
const INVALID_HANDLE = 16777215;
const SPENT_BUCKETS = [0, 1, 2, 3, 4, 5];
const WINDOWS = [4, 8, 16, 32, 64];
const PLACEBO_SHIFTS = [-512, -256, -128, 128, 256, 512];

// ============================================================
// PURPOSE
//
// Script140 established a very strong runtime substrate:
//   - m_vecUpgrades changes over time for all 12 players;
//   - every observed ID maps collision-free to the validated
//     standard-shop catalog for test.dem;
//   - the vector has real additions/removals/replacements.
//
// Script141 V02 asks the next semantic question:
//
//   Does m_vecUpgrades behave like CURRENT ITEM OWNERSHIP?
//
// We do NOT assume that from the field name alone. We independently
// compare vector transitions against replay transaction telemetry:
//   - pawn m_nSpentCurrencies.0000-.0005 cumulative changes;
//   - pawn m_nCurrencies.0000-.0005 wallet changes;
//   - pawn m_bInItemShopZone state;
//   - controller m_iGoldNetWorth state;
//   - mixed add/remove transitions and installed-resource item links.
//
// Spent-currency bucket semantics are calibrated empirically. We do
// not predeclare which bucket is item purchases. For each bucket we
// measure temporal association with item additions, amount agreement
// with full-price and component-credit hypotheses, and same-player
// shifted-time placebo association.
//
// V02 correction:
// Script141 V01 incorrectly made m_bInItemShopZone coverage a hard READY
// gate. test.dem showed overwhelming independent spend association while
// shop-zone state was known for only 77.44% of additions and was false for
// every known addition. That makes this particular replay field/timing
// representation unsuitable as a semantic gate. V02 retains shop-zone
// telemetry as a diagnostic only and instead requires strong exact amount
// agreement with the independently calibrated spend bucket.
//
// A READY result means the vector has earned strong single-replay
// semantic support as item ownership. It does NOT yet mean replicated
// across independent replays, and it does NOT claim every removal is
// a sale or every mixed transition is an upgrade.
// ============================================================

const replayArgument = process.argv[2] ?? resolve('replays', 'test.dem');
const replayPath = resolve(replayArgument);
const replayName = basename(replayPath, extname(replayPath));

const SCRIPT140_PATH = resolve('output', replayName, 'runtime_item_ownership_substrate_v01.json');
const CATALOG_PATH = resolve('output', 'cross_replay', 'current_purchasable_item_catalog_v02.json');
const OUTPUT_PATH = resolve('output', replayName, 'runtime_item_vector_semantic_validation_v02.json');

if (!existsSync(replayPath)) throw new Error(`Replay not found:\n${replayPath}`);
if (!existsSync(SCRIPT140_PATH)) throw new Error(`Script140 output missing:\n${SCRIPT140_PATH}`);
if (!existsSync(CATALOG_PATH)) throw new Error(`Script138 V02 catalog missing:\n${CATALOG_PATH}`);

const shopClaim = requireClaim('standard_shop_catalog_v02', { requireSemantic: true });
const effectClaim = requireClaim('shop_item_effect_contract', { requireSemantic: true });

const substrate = JSON.parse(readFileSync(SCRIPT140_PATH, 'utf8'));
const catalogArtifact = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));

if (substrate?.status !== 'RUNTIME_ITEM_VECTOR_SUBSTRATE_V01_READY_FOR_SEMANTIC_VALIDATION') {
  throw new Error(`Script140 substrate is not ready. status=${substrate?.status}`);
}
if (catalogArtifact?.status !== 'CURRENT_PURCHASABLE_ITEM_CATALOG_V02_STANDARD_SHOP_RESOURCE_READY') {
  throw new Error(`Script138 V02 catalog is not ready. status=${catalogArtifact?.status}`);
}

const catalogRows = Array.isArray(catalogArtifact.catalog) ? catalogArtifact.catalog : [];
const catalogByKey = new Map(catalogRows.map(row => [row.recordKey, row]));
const transitions = Array.isArray(substrate.transitions) ? substrate.transitions : [];
const itemAdditionTransitions = transitions.filter(row => Array.isArray(row.added) && row.added.length > 0);
const itemRemovalTransitions = transitions.filter(row => Array.isArray(row.removed) && row.removed.length > 0);
const mixedTransitions = transitions.filter(row => row.added?.length > 0 && row.removed?.length > 0);

console.log('');
console.log('========================================================');
console.log('RUNTIME ITEM VECTOR SEMANTIC VALIDATION V0.2');
console.log('========================================================');
console.log('');
console.log(`Replay:          ${replayPath}`);
console.log(`Script140:       ${SCRIPT140_PATH}`);
console.log(`Catalog rows:    ${catalogRows.length}`);
console.log(`Vector changes:  ${transitions.length}`);
console.log(`Add transitions: ${itemAdditionTransitions.length}`);
console.log(`Mixed changes:   ${mixedTransitions.length}`);
console.log('');

const config = new ParserConfiguration({
  entityClasses: [
    'CCitadelPlayerController',
    'CCitadelPlayerPawn',
    'CCitadelGameRulesProxy',
  ],
});

const parser = new Parser(config, Logger.CONSOLE_INFO);

let matchClockOffsetSeconds = null;
let controllerEvents = 0;
let pawnEvents = 0;

// Final/observed ownership link between pawn entity index and controller.
const controllerState = new Map();
const pawnOwners = new Map();

// Economy events are initially keyed by pawn entity. After parsing they
// are mapped to a controller if that pawn has one unambiguous owner.
const pawnSpentEvents = [];
const pawnCurrencyEvents = [];
const pawnShopZoneChanges = [];
const controllerNetWorthChanges = [];

const pawnState = new Map();
const controllerNetWorthState = new Map();

parser.registerPostInterceptor(
  InterceptorStage.ENTITY_PACKET,
  (demoPacket, messagePacket, events) => {
    const tick = Number.isFinite(demoPacket?.tick) ? demoPacket.tick : null;
    const demo = parser.getDemo();

    for (const event of events) {
      if (event.operation !== EntityOperation.CREATE && event.operation !== EntityOperation.UPDATE) continue;

      const entity = event.entity;
      const className = entity?.class?.name;

      if (className === 'CCitadelGameRulesProxy') {
        const gameStartTime = entity.getField('m_pGameRules.m_flGameStartTime');
        const gameStateStartTime = entity.getField('m_pGameRules.m_flGameStateStartTime');
        if (
          matchClockOffsetSeconds === null
          && Number.isFinite(gameStartTime)
          && Number.isFinite(gameStateStartTime)
        ) {
          matchClockOffsetSeconds = gameStartTime - gameStateStartTime;
        }
        continue;
      }

      if (className === 'CCitadelPlayerController') {
        controllerEvents++;
        const changes = safeChanges(event);
        const state = getControllerState(controllerState, entity.index);

        const playerName = entity.getField('m_iszPlayerName');
        if (playerName !== undefined && playerName !== null) state.playerName = String(playerName);
        const steamId = entity.getField('m_steamID');
        if (steamId !== undefined && steamId !== null) state.steamId = safeValue(steamId);
        const heroId = entity.getField('m_nHeroID');
        if (heroId !== undefined && heroId !== null) state.heroId = heroId;
        const team = entity.getField('m_iTeamNum');
        if (team !== undefined && team !== null) state.team = team;

        let pawnHandle = entity.getField('m_hHeroPawn');
        if (!isValidHandle(pawnHandle)) pawnHandle = entity.getField('m_hPawn');
        if (isValidHandle(pawnHandle)) {
          state.pawnHandle = normalizeHandle(pawnHandle);
          try {
            const pawn = demo.getEntityByHandle(pawnHandle);
            if (pawn && Number.isInteger(pawn.index)) {
              state.pawnEntityIndex = pawn.index;
              addPawnOwner(pawnOwners, pawn.index, entity.index);
            }
          } catch {
            // Link will be retried on later controller updates.
          }
        }

        const currentNetWorth = entity.getField('m_iGoldNetWorth');
        if (Number.isFinite(currentNetWorth)) {
          const previous = controllerNetWorthState.get(entity.index);
          controllerNetWorthState.set(entity.index, currentNetWorth);
          if (event.operation === EntityOperation.UPDATE && Number.isFinite(previous) && currentNetWorth !== previous) {
            controllerNetWorthChanges.push({
              tick,
              controllerEntityIndex: entity.index,
              before: previous,
              after: currentNetWorth,
              delta: currentNetWorth - previous,
            });
          }
        }

        // Some builds/serializers can expose spent-currency fields on a
        // controller image. Preserve any such direct evidence as a
        // diagnostic, but primary calibration below uses the pawn fields.
        for (const [fieldName, rawValue] of Object.entries(changes)) {
          if (!/^m_nSpentCurrencies\.\d{4}$/.test(fieldName)) continue;
          // Do not merge these with pawn-calibrated events. They are kept
          // only so the artifact can report that the representation exists.
          state.directControllerSpentFieldsSeen.add(fieldName);
          state.directControllerSpentLast.set(fieldName, safeValue(rawValue));
        }
        continue;
      }

      if (className !== 'CCitadelPlayerPawn') continue;
      pawnEvents++;

      const state = getPawnState(pawnState, entity.index);

      // On every pawn update, current values are read from the entity image.
      // CREATE establishes baselines; only UPDATE deltas are transaction
      // candidates. This avoids interpreting entity initialization as spend.
      for (const bucket of SPENT_BUCKETS) {
        const field = `m_nSpentCurrencies.${pad4(bucket)}`;
        const current = entity.getField(field);
        if (!Number.isFinite(current)) continue;
        const previous = state.spent[bucket];
        state.spent[bucket] = current;
        if (event.operation !== EntityOperation.UPDATE || !Number.isFinite(previous) || current === previous) continue;
        pawnSpentEvents.push({
          tick,
          pawnEntityIndex: entity.index,
          bucket,
          before: previous,
          after: current,
          delta: current - previous,
        });
      }

      for (const bucket of SPENT_BUCKETS) {
        const field = `m_nCurrencies.${pad4(bucket)}`;
        const current = entity.getField(field);
        if (!Number.isFinite(current)) continue;
        const previous = state.currency[bucket];
        state.currency[bucket] = current;
        if (event.operation !== EntityOperation.UPDATE || !Number.isFinite(previous) || current === previous) continue;
        pawnCurrencyEvents.push({
          tick,
          pawnEntityIndex: entity.index,
          bucket,
          before: previous,
          after: current,
          delta: current - previous,
        });
      }

      const zone = entity.getField('m_bInItemShopZone');
      if (typeof zone === 'boolean') {
        if (state.inItemShopZone === null || zone !== state.inItemShopZone) {
          state.inItemShopZone = zone;
          pawnShopZoneChanges.push({
            tick,
            pawnEntityIndex: entity.index,
            inItemShopZone: zone,
          });
        }
      }
    }
  }
);

try {
  await parser.parse(createReadStream(replayPath));
} finally {
  await parser.dispose();
}

const uniquePawnOwner = new Map();
const ambiguousPawnOwners = [];
for (const [pawnEntityIndex, owners] of pawnOwners.entries()) {
  if (owners.size === 1) uniquePawnOwner.set(pawnEntityIndex, [...owners][0]);
  else if (owners.size > 1) ambiguousPawnOwners.push({ pawnEntityIndex, controllerEntityIndexes: [...owners].sort((a, b) => a - b) });
}

const spentEvents = pawnSpentEvents
  .map(row => ({ ...row, controllerEntityIndex: uniquePawnOwner.get(row.pawnEntityIndex) ?? null }))
  .filter(row => Number.isInteger(row.controllerEntityIndex));
const currencyEvents = pawnCurrencyEvents
  .map(row => ({ ...row, controllerEntityIndex: uniquePawnOwner.get(row.pawnEntityIndex) ?? null }))
  .filter(row => Number.isInteger(row.controllerEntityIndex));
const shopZoneChanges = pawnShopZoneChanges
  .map(row => ({ ...row, controllerEntityIndex: uniquePawnOwner.get(row.pawnEntityIndex) ?? null }))
  .filter(row => Number.isInteger(row.controllerEntityIndex));

const positiveSpentEvents = spentEvents.filter(row => row.delta > 0);
const negativeSpentEvents = spentEvents.filter(row => row.delta < 0);

const spentByControllerBucket = indexEvents(positiveSpentEvents, row => `${row.controllerEntityIndex}:${row.bucket}`);
const currencyByControllerBucket = indexEvents(currencyEvents, row => `${row.controllerEntityIndex}:${row.bucket}`);
const shopByController = indexEvents(shopZoneChanges, row => String(row.controllerEntityIndex));
const netWorthByController = indexEvents(controllerNetWorthChanges, row => String(row.controllerEntityIndex));

const analyzedTransitions = transitions.map(row => analyzeTransition(row));
const analyzedAdditions = analyzedTransitions.filter(row => row.added.length > 0);
const analyzedMixed = analyzedTransitions.filter(row => row.added.length > 0 && row.removed.length > 0);

const bucketCalibration = SPENT_BUCKETS.map(bucket => calibrateSpentBucket(bucket));
const bestBucket = [...bucketCalibration].sort(compareBucketCalibration)[0] ?? null;

const bestBucketIndex = bestBucket?.bucket ?? null;
const trueWithin8 = bestBucket?.association?.within8 ?? null;
const trueWithin32 = bestBucket?.association?.within32 ?? null;
const placeboWithin8 = bestBucket?.placebo?.within8 ?? null;
const placeboWithin32 = bestBucket?.placebo?.within32 ?? null;
const advantageWithin8 = bothFinite(trueWithin8, placeboWithin8) ? trueWithin8 - placeboWithin8 : null;
const advantageWithin32 = bothFinite(trueWithin32, placeboWithin32) ? trueWithin32 - placeboWithin32 : null;
const exactAmountAgreementRate = bestBucket?.amountAgreement?.exactEitherRateAmongAssociated ?? null;
const exactAmountAgreementCount = bestBucket?.amountAgreement?.exactEitherWithin32 ?? null;
const associatedBestBucketWithin32 = bestBucket?.amountAgreement?.associatedWithin32 ?? null;

const shopZoneKnown = analyzedAdditions.filter(row => row.shopZone.known).length;
const shopZoneTrue = analyzedAdditions.filter(row => row.shopZone.value === true).length;
const shopZoneKnownRate = safeRatio(shopZoneKnown, analyzedAdditions.length);
const shopZoneTrueAmongKnownRate = safeRatio(shopZoneTrue, shopZoneKnown);

const mixedWithCatalogReference = analyzedMixed.filter(row => row.relationEvidence.catalogReferenceLinks.length > 0).length;
const mixedWithSameSlotTierIncrease = analyzedMixed.filter(row => row.relationEvidence.sameSlotTierIncreasePairs.length > 0).length;

const mappedControllerTransitions = analyzedTransitions.filter(row => row.identityMapped).length;
const additionPricesResolved = analyzedAdditions.filter(row => row.expectedSpend.fullAddedPrice !== null).length;

// These gates intentionally require three independent transaction signals:
//   1) tight same-player temporal association,
//   2) strong separation from shifted-time placebo, and
//   3) substantial exact amount agreement with full-price/component-credit
//      hypotheses.
//
// m_bInItemShopZone is retained below as diagnostic context only. V01 showed
// that its replay representation is not synchronized/reliable enough to act
// as an ownership-semantic gate.
const checks = {
  registryStandardCatalogCurrent: check(shopClaim.authorityStatus, 'current', shopClaim.authorityStatus === 'current'),
  registryItemEffectContractCurrent: check(effectClaim.authorityStatus, 'current', effectClaim.authorityStatus === 'current'),
  script140Ready: check(substrate.status, 'RUNTIME_ITEM_VECTOR_SUBSTRATE_V01_READY_FOR_SEMANTIC_VALIDATION', substrate.status === 'RUNTIME_ITEM_VECTOR_SUBSTRATE_V01_READY_FOR_SEMANTIC_VALIDATION'),
  catalogRowsExpected: check(catalogRows.length, 156, catalogRows.length === 156),
  vectorTransitionsSubstantial: check(transitions.length, '>=100', transitions.length >= 100),
  additionTransitionsSubstantial: check(analyzedAdditions.length, '>=100', analyzedAdditions.length >= 100),
  transitionControllersMapped: check(mappedControllerTransitions, transitions.length, mappedControllerTransitions === transitions.length),
  positiveSpentCurrencyEventsObserved: check(positiveSpentEvents.length, '>50', positiveSpentEvents.length > 50),
  bestSpentBucketResolved: check(bestBucketIndex, '0-5', Number.isInteger(bestBucketIndex) && bestBucketIndex >= 0 && bestBucketIndex <= 5),
  bestBucketAdditionAssociationImmediate: check(trueWithin8, '>=0.80', trueWithin8 !== null && trueWithin8 >= 0.80),
  bestBucketAdditionAssociationStrong: check(trueWithin32, '>=0.70', trueWithin32 !== null && trueWithin32 >= 0.70),
  bestBucketBeatsShiftedPlacebo: check(advantageWithin32, '>=0.30', advantageWithin32 !== null && advantageWithin32 >= 0.30),
  additionPricesResolved: check(additionPricesResolved, analyzedAdditions.length, additionPricesResolved === analyzedAdditions.length),
  bestBucketExactAmountAgreementStrong: check(exactAmountAgreementRate, '>=0.70 among associated additions', exactAmountAgreementRate !== null && exactAmountAgreementRate >= 0.70),
};

const validationPass = Object.values(checks).every(row => row.pass);
const status = validationPass
  ? 'RUNTIME_ITEM_VECTOR_V02_STRONG_SINGLE_REPLAY_OWNERSHIP_SEMANTICS'
  : 'RUNTIME_ITEM_VECTOR_V02_SEMANTIC_VALIDATION_REQUIRES_DIAGNOSIS';

const output = {
  version: VERSION,
  supersedes: 'RUNTIME_ITEM_VECTOR_SEMANTIC_VALIDATION_V01',
  canonical: false,
  createdAt: new Date().toISOString(),
  status,
  replay: {
    replayName,
    replayPath,
    ticksPerSecond: TICKS_PER_SECOND,
    matchClockOffsetSeconds,
  },
  foundations: {
    script140Artifact: SCRIPT140_PATH,
    standardShopCatalogArtifact: CATALOG_PATH,
    standardShopClaim: shopClaim.claimId,
    itemEffectClaim: effectClaim.claimId,
  },
  counts: {
    controllerEvents,
    pawnEvents,
    controllersObserved: [...controllerState.values()].filter(row => row.playerName && row.playerName !== 'SourceTV').length,
    uniquePawnOwnerLinks: uniquePawnOwner.size,
    ambiguousPawnOwnerLinks: ambiguousPawnOwners.length,
    rawSpentCurrencyDeltas: pawnSpentEvents.length,
    mappedSpentCurrencyDeltas: spentEvents.length,
    positiveSpentCurrencyDeltas: positiveSpentEvents.length,
    negativeSpentCurrencyDeltas: negativeSpentEvents.length,
    mappedCurrencyDeltas: currencyEvents.length,
    mappedShopZoneChanges: shopZoneChanges.length,
    controllerNetWorthChanges: controllerNetWorthChanges.length,
    vectorTransitions: analyzedTransitions.length,
    additionTransitions: analyzedAdditions.length,
    removalTransitions: itemRemovalTransitions.length,
    mixedTransitions: analyzedMixed.length,
  },
  spentCurrencyCalibration: {
    method: 'SAME_PLAYER_NEAREST_POSITIVE_SPENT_CURRENCY_DELTA_WITH_SHIFTED_TIME_PLACEBO',
    windowsTicks: WINDOWS,
    placeboShiftTicks: PLACEBO_SHIFTS,
    buckets: bucketCalibration,
    selectedBestBucket: bestBucket,
    selectionRule: 'Maximize exact candidate amount matches within 32 ticks, then true-vs-placebo temporal association advantage, then true association.',
  },
  ownershipSemanticEvidence: {
    bestSpentBucket: bestBucketIndex,
    additionAssociationWithin8: trueWithin8,
    additionAssociationWithin32: trueWithin32,
    shiftedPlaceboAssociationWithin32: placeboWithin32,
    temporalAdvantageWithin32: advantageWithin32,
    exactAmountAgreementCountWithin32: exactAmountAgreementCount,
    associatedAdditionsWithin32: associatedBestBucketWithin32,
    exactAmountAgreementRateAmongAssociated: exactAmountAgreementRate,
    interpretation: 'Primary ownership-semantic evidence. Membership additions are tested against independently observed same-player cumulative spend, shifted-time placebo, and exact catalog-price/component-credit amounts.',
  },
  shopZoneEvidence: {
    additionTransitions: analyzedAdditions.length,
    knownState: shopZoneKnown,
    inShopZone: shopZoneTrue,
    knownRate: shopZoneKnownRate,
    trueAmongKnownRate: shopZoneTrueAmongKnownRate,
    interpretation: 'DIAGNOSTIC_ONLY. In test.dem this replay field was false at every known addition despite overwhelming spend/price evidence. Do not use m_bInItemShopZone as an item-ownership semantic gate until its exact timing/meaning is independently resolved.',
  },
  mixedTransitionEvidence: {
    mixedTransitions: analyzedMixed.length,
    withCatalogReferenceLink: mixedWithCatalogReference,
    withSameSlotTierIncrease: mixedWithSameSlotTierIncrease,
    catalogReferenceRate: safeRatio(mixedWithCatalogReference, analyzedMixed.length),
    sameSlotTierIncreaseRate: safeRatio(mixedWithSameSlotTierIncrease, analyzedMixed.length),
    interpretation: 'Mixed add/remove transitions are not automatically labeled upgrades. Resource references and same-slot tier increases are reported as independent supporting structure.',
  },
  pawnOwnershipMapping: {
    uniqueLinks: [...uniquePawnOwner.entries()].map(([pawnEntityIndex, controllerEntityIndex]) => ({ pawnEntityIndex, controllerEntityIndex })),
    ambiguousLinks: ambiguousPawnOwners,
  },
  transitions: analyzedTransitions,
  interpretation: {
    supported: validationPass
      ? 'In this replay, m_vecUpgrades has strong single-replay semantic support as the player runtime item-ownership vector because catalog-resolved additions are tightly associated with same-player spend telemetry, strongly exceed shifted-time placebo, and substantially match exact catalog/component-credit amounts.'
      : 'The artifact independently measures whether m_vecUpgrades transitions align with same-player transaction telemetry. Failed gates must be diagnosed before promoting runtime item ownership.',
    notYetSupported: 'This script does not label every addition as a purchase, every removal as a sale, or every mixed transition as a component upgrade. It also does not establish cross-replay replication.',
    playerStateUse: validationPass
      ? 'Vector membership can be used as a provisional single-replay PlayerState(t) item-ownership source, subject to replication before global canonical use.'
      : 'Do not consume vector membership as item ownership authority until failed semantic gates are explained.',
  },
  validation: {
    pass: validationPass,
    checks,
  },
  nextStage: validationPass
    ? 'REPLICATE_RUNTIME_ITEM_VECTOR_SEMANTICS_ACROSS_INDEPENDENT_REPLAYS_THEN_PROMOTE_RUNTIME_ITEM_OWNERSHIP_CONTRACT'
    : 'DIAGNOSE_SPEND_BUCKET_AMOUNT_AGREEMENT_OR_PAWN_MAPPING_BEFORE_OWNERSHIP_PROMOTION',
};

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');

console.log('========================================================');
console.log('RUNTIME ITEM VECTOR SEMANTIC RESULT');
console.log('========================================================');
console.log('');
console.log(`status:                    ${status}`);
console.log(`controllers:               ${output.counts.controllersObserved}`);
console.log(`pawn-owner links:          ${uniquePawnOwner.size} unique / ${ambiguousPawnOwners.length} ambiguous`);
console.log(`positive spent deltas:     ${positiveSpentEvents.length}`);
console.log(`addition transitions:      ${analyzedAdditions.length}`);
console.log(`mixed transitions:         ${analyzedMixed.length}`);
console.log(`best spent bucket:         ${bestBucketIndex ?? 'n/a'}`);
console.log(`true spend assoc <=8t:     ${formatPercent(trueWithin8)}`);
console.log(`placebo assoc <=8t:        ${formatPercent(placeboWithin8)}`);
console.log(`true spend assoc <=32t:    ${formatPercent(trueWithin32)}`);
console.log(`placebo assoc <=32t:       ${formatPercent(placeboWithin32)}`);
console.log(`advantage <=32t:           ${formatPercentagePoints(advantageWithin32)}`);
console.log(`exact amount agree <=32t:  ${exactAmountAgreementCount ?? 'n/a'}/${associatedBestBucketWithin32 ?? 'n/a'} (${formatPercent(exactAmountAgreementRate)})`);
console.log(`shop-zone state known*:    ${formatPercent(shopZoneKnownRate)}`);
console.log(`in shop among known*:      ${formatPercent(shopZoneTrueAmongKnownRate)}`);
console.log('* diagnostic only; not a READY gate');
console.log(`in shop among known:       ${formatPercent(shopZoneTrueAmongKnownRate)}`);
console.log(`mixed catalog refs:        ${mixedWithCatalogReference}/${analyzedMixed.length}`);
console.log(`mixed same-slot tier-up:   ${mixedWithSameSlotTierIncrease}/${analyzedMixed.length}`);
console.log('');
console.log('SPENT BUCKETS');
console.log('-------------');
for (const row of bucketCalibration) {
  console.log(
    `bucket ${row.bucket}: events=${String(row.positiveEvents).padStart(4)} `
    + `assoc8=${formatPercent(row.association.within8)} `
    + `assoc32=${formatPercent(row.association.within32)} `
    + `placebo32=${formatPercent(row.placebo.within32)} `
    + `exactFull=${row.amountAgreement.exactFullPriceWithin32} `
    + `exactNet=${row.amountAgreement.exactNetUpgradePriceWithin32}`
  );
}
console.log('');
console.log('VALIDATION');
console.log('----------');
for (const [name, row] of Object.entries(checks)) {
  console.log(`${name.padEnd(38)} ${String(row.pass).padEnd(5)} actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`);
}
console.log('');
console.log(`JSON:\n${OUTPUT_PATH}`);
console.log('');

function analyzeTransition(row) {
  const controllerEntityIndex = row.controllerEntityIndex;
  const added = Array.isArray(row.added) ? row.added : [];
  const removed = Array.isArray(row.removed) ? row.removed : [];
  const fullAddedPrice = sumResolvedPrices(added);
  const fullRemovedPrice = sumResolvedPrices(removed);
  const netUpgradePrice = fullAddedPrice === null || fullRemovedPrice === null
    ? null
    : Math.max(0, fullAddedPrice - fullRemovedPrice);

  const spentEvidence = {};
  for (const bucket of SPENT_BUCKETS) {
    const events = spentByControllerBucket.get(`${controllerEntityIndex}:${bucket}`) ?? [];
    spentEvidence[bucket] = nearestEventSummary(events, row.tick, WINDOWS);
  }

  const currencyEvidence = {};
  for (const bucket of SPENT_BUCKETS) {
    const events = currencyByControllerBucket.get(`${controllerEntityIndex}:${bucket}`) ?? [];
    currencyEvidence[bucket] = nearestAnyDeltaSummary(events, row.tick, 32);
  }

  const zoneTimeline = shopByController.get(String(controllerEntityIndex)) ?? [];
  const zoneState = stateAtTick(zoneTimeline, row.tick, event => event.inItemShopZone);

  const netWorthTimeline = netWorthByController.get(String(controllerEntityIndex)) ?? [];
  const netWorth = latestEventAtOrBefore(netWorthTimeline, row.tick);

  return {
    ...row,
    identityMapped: controllerState.has(controllerEntityIndex),
    expectedSpend: {
      fullAddedPrice,
      fullRemovedPrice,
      netUpgradePrice,
    },
    spentCurrencyEvidence: spentEvidence,
    walletCurrencyEvidence: currencyEvidence,
    shopZone: zoneState,
    netWorthAtOrBefore: netWorth,
    relationEvidence: buildRelationEvidence(added, removed),
  };
}

function calibrateSpentBucket(bucket) {
  const eventsForAllPlayers = positiveSpentEvents.filter(row => row.bucket === bucket);
  const associationCounts = Object.fromEntries(WINDOWS.map(window => [window, 0]));
  let exactFullPriceWithin32 = 0;
  let exactNetUpgradePriceWithin32 = 0;
  let exactEitherWithin32 = 0;
  let associatedWithin32 = 0;
  const tickDistances = [];

  for (const transition of analyzedAdditions) {
    const evidence = transition.spentCurrencyEvidence[bucket];
    for (const window of WINDOWS) {
      if (evidence[`within${window}`]) associationCounts[window]++;
    }
    if (!evidence.within32 || !evidence.nearest) continue;
    associatedWithin32++;
    tickDistances.push(Math.abs(evidence.nearest.tickDelta));
    const delta = evidence.nearest.delta;
    const full = transition.expectedSpend.fullAddedPrice;
    const net = transition.expectedSpend.netUpgradePrice;
    const fullMatch = Number.isFinite(full) && delta === full;
    const netMatch = Number.isFinite(net) && delta === net;
    if (fullMatch) exactFullPriceWithin32++;
    if (netMatch) exactNetUpgradePriceWithin32++;
    if (fullMatch || netMatch) exactEitherWithin32++;
  }

  const placeboRates = computePlaceboRates(bucket);

  return {
    bucket,
    positiveEvents: eventsForAllPlayers.length,
    association: {
      within4: safeRatio(associationCounts[4], analyzedAdditions.length),
      within8: safeRatio(associationCounts[8], analyzedAdditions.length),
      within16: safeRatio(associationCounts[16], analyzedAdditions.length),
      within32: safeRatio(associationCounts[32], analyzedAdditions.length),
      within64: safeRatio(associationCounts[64], analyzedAdditions.length),
      medianAbsoluteTickDistanceWithin32: median(tickDistances),
    },
    placebo: placeboRates,
    amountAgreement: {
      associatedWithin32,
      exactFullPriceWithin32,
      exactNetUpgradePriceWithin32,
      exactEitherWithin32,
      exactEitherRateAmongAssociated: safeRatio(exactEitherWithin32, associatedWithin32),
    },
    score: {
      exactEitherWithin32,
      temporalAdvantageWithin32: bothFinite(safeRatio(associationCounts[32], analyzedAdditions.length), placeboRates.within32)
        ? safeRatio(associationCounts[32], analyzedAdditions.length) - placeboRates.within32
        : null,
      trueAssociationWithin32: safeRatio(associationCounts[32], analyzedAdditions.length),
    },
  };
}

function computePlaceboRates(bucket) {
  let totalShifted = 0;
  let within8 = 0;
  let within32 = 0;

  for (const transition of analyzedAdditions) {
    const events = spentByControllerBucket.get(`${transition.controllerEntityIndex}:${bucket}`) ?? [];
    for (const shift of PLACEBO_SHIFTS) {
      totalShifted++;
      const targetTick = transition.tick + shift;
      const nearest = nearestEvent(events, targetTick, 32);
      if (!nearest) continue;
      const distance = Math.abs(nearest.tick - targetTick);
      if (distance <= 8) within8++;
      if (distance <= 32) within32++;
    }
  }

  return {
    shiftedComparisons: totalShifted,
    within8: safeRatio(within8, totalShifted),
    within32: safeRatio(within32, totalShifted),
  };
}

function compareBucketCalibration(a, b) {
  if ((b.score.exactEitherWithin32 ?? -1) !== (a.score.exactEitherWithin32 ?? -1)) {
    return (b.score.exactEitherWithin32 ?? -1) - (a.score.exactEitherWithin32 ?? -1);
  }
  if ((b.score.temporalAdvantageWithin32 ?? -Infinity) !== (a.score.temporalAdvantageWithin32 ?? -Infinity)) {
    return (b.score.temporalAdvantageWithin32 ?? -Infinity) - (a.score.temporalAdvantageWithin32 ?? -Infinity);
  }
  return (b.score.trueAssociationWithin32 ?? -Infinity) - (a.score.trueAssociationWithin32 ?? -Infinity);
}

function buildRelationEvidence(added, removed) {
  const catalogReferenceLinks = [];
  const sameSlotTierIncreasePairs = [];

  for (const add of added) {
    const addRow = catalogByKey.get(add.recordKey);
    if (!addRow) continue;
    const references = new Set(addRow?.relation?.catalogReferences ?? []);
    for (const remove of removed) {
      const removeRow = catalogByKey.get(remove.recordKey);
      if (!removeRow) continue;
      if (references.has(remove.recordKey)) {
        catalogReferenceLinks.push({ added: add.recordKey, removed: remove.recordKey });
      }
      if (
        addRow.itemSlot === removeRow.itemSlot
        && Number.isInteger(addRow.itemTier)
        && Number.isInteger(removeRow.itemTier)
        && addRow.itemTier > removeRow.itemTier
      ) {
        sameSlotTierIncreasePairs.push({
          added: add.recordKey,
          removed: remove.recordKey,
          itemSlot: addRow.itemSlot,
          fromTier: removeRow.itemTier,
          toTier: addRow.itemTier,
        });
      }
    }
  }

  return { catalogReferenceLinks, sameSlotTierIncreasePairs };
}

function nearestEventSummary(events, tick, windows) {
  const maxWindow = Math.max(...windows);
  const nearest = nearestEvent(events, tick, maxWindow);
  const output = {
    nearest: nearest ? { ...nearest, tickDelta: nearest.tick - tick } : null,
  };
  for (const window of windows) {
    output[`within${window}`] = Boolean(nearest && Math.abs(nearest.tick - tick) <= window);
  }
  return output;
}

function nearestAnyDeltaSummary(events, tick, window) {
  const nearest = nearestEvent(events, tick, window);
  return nearest ? { ...nearest, tickDelta: nearest.tick - tick } : null;
}

function nearestEvent(events, tick, maxDistance) {
  if (!Number.isFinite(tick) || events.length === 0) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const event of events) {
    if (!Number.isFinite(event.tick)) continue;
    const distance = Math.abs(event.tick - tick);
    if (distance > maxDistance) continue;
    if (distance < bestDistance || (distance === bestDistance && event.tick < best.tick)) {
      best = event;
      bestDistance = distance;
    }
  }
  return best;
}

function stateAtTick(timeline, tick, selector) {
  const event = latestEventAtOrBefore(timeline, tick);
  return {
    known: Boolean(event),
    value: event ? selector(event) : null,
    sourceTick: event?.tick ?? null,
    ageTicks: event && Number.isFinite(tick) ? tick - event.tick : null,
  };
}

function latestEventAtOrBefore(events, tick) {
  if (!Number.isFinite(tick)) return null;
  let best = null;
  for (const event of events) {
    if (!Number.isFinite(event.tick) || event.tick > tick) continue;
    if (!best || event.tick > best.tick) best = event;
  }
  return best;
}

function indexEvents(events, keyFn) {
  const map = new Map();
  for (const event of events) {
    const key = keyFn(event);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(event);
  }
  for (const rows of map.values()) rows.sort((a, b) => (a.tick ?? 0) - (b.tick ?? 0));
  return map;
}

function addPawnOwner(map, pawnEntityIndex, controllerEntityIndex) {
  if (!map.has(pawnEntityIndex)) map.set(pawnEntityIndex, new Set());
  map.get(pawnEntityIndex).add(controllerEntityIndex);
}

function getControllerState(map, entityIndex) {
  if (!map.has(entityIndex)) {
    map.set(entityIndex, {
      playerName: null,
      steamId: null,
      heroId: null,
      team: null,
      pawnHandle: null,
      pawnEntityIndex: null,
      directControllerSpentFieldsSeen: new Set(),
      directControllerSpentLast: new Map(),
    });
  }
  return map.get(entityIndex);
}

function getPawnState(map, entityIndex) {
  if (!map.has(entityIndex)) {
    map.set(entityIndex, {
      spent: Object.fromEntries(SPENT_BUCKETS.map(bucket => [bucket, null])),
      currency: Object.fromEntries(SPENT_BUCKETS.map(bucket => [bucket, null])),
      inItemShopZone: null,
    });
  }
  return map.get(entityIndex);
}

function isValidHandle(value) {
  const handle = normalizeHandle(value);
  return Number.isInteger(handle) && handle >= 0 && handle !== INVALID_HANDLE;
}

function normalizeHandle(value) {
  if (typeof value === 'bigint') {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

function sumResolvedPrices(items) {
  let total = 0;
  for (const item of items) {
    const price = item.standardShopPrice;
    if (!Number.isFinite(price)) return null;
    total += price;
  }
  return total;
}

function pad4(value) {
  return String(value).padStart(4, '0');
}

function median(values) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) return null;
  const mid = Math.floor(finite.length / 2);
  return finite.length % 2 ? finite[mid] : (finite[mid - 1] + finite[mid]) / 2;
}

function safeRatio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function bothFinite(a, b) {
  return Number.isFinite(a) && Number.isFinite(b);
}

function check(actual, expected, pass) {
  return { actual, expected, pass: Boolean(pass) };
}

function safeChanges(event) {
  try {
    return event.getChanges() ?? {};
  } catch {
    return {};
  }
}

function safeValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  try {
    return JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v));
  } catch {
    return String(value);
  }
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : 'n/a';
}

function formatPercentagePoints(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)} pp` : 'n/a';
}
