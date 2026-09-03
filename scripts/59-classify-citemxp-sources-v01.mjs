import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Parser, InterceptorStage } from 'deadem';

const replayName = process.argv[2] ?? 'test';
const TICK_RATE = 64;
const MATCH_CLOCK_OFFSET_SECONDS = 30;

const XP_CLASS = 'CItemXP';
const URN_CLASS = 'CCitadelItemPickupIdol';

const TROOPER_MIN_TICK_DELTA = -1;
const TROOPER_MAX_TICK_DELTA = 4;
const TROOPER_MAX_DISTANCE_3D = 250;

const REUSE_POSITION_JUMP_THRESHOLD = 500;
const MIN_TICKS_BEFORE_POSITION_REUSE = 4;

const URN_BURST_NEIGHBOR_TICKS = 128;       // 2 sec
const URN_BURST_MAX_TOTAL_SPAN_TICKS = 512; // 8 sec
const URN_BURST_NEIGHBOR_DISTANCE = 700;
const URN_BURST_MAX_RADIUS = 900;
const URN_BURST_MIN_ORBS = 4;

const URN_IDOL_MAX_TIME_DELTA_TICKS = 192;   // 3 sec
const URN_IDOL_MAX_DISTANCE = 1500;

const MAX_BURST_EXAMPLES = 100;
const MAX_OTHER_EXAMPLES = 100;
const MAX_IDOL_EVENT_SAMPLES = 200;
const MAX_DISCOVERED_FIELDS = 120;

const replayPath = resolve('replays', `${replayName}.dem`);
const deathStreamPath = resolve('output', replayName, 'trooper_ground_soul_one_to_one_v01.jsonl');
const discoveryPath = resolve('output', replayName, 'trooper_flying_soul_orb_discovery_v01.json');
const summaryPath = resolve('output', replayName, 'citemxp_source_classification_v01.json');
const episodePath = resolve('output', replayName, 'citemxp_source_classification_v01.jsonl');

for (const path of [replayPath, deathStreamPath, discoveryPath]) {
  if (!existsSync(path)) throw new Error(`Missing required input:\n${path}`);
}

const discovery = JSON.parse(readFileSync(discoveryPath, 'utf8'));
if (discovery?.validation?.pass !== true) throw new Error('Script 58 flying-orb discovery did not PASS.');

console.log('\nLoading validated Trooper soul-producing deaths...');
const deaths = (await loadJsonl(deathStreamPath)).map(normalizeDeath).filter(row => row?.groundSoulMatched);
deaths.forEach((d, i) => { d.deathIndexLocal = i; });
console.log(`Trooper anchors: ${deaths.length}`);

// -------------------- CItemXP state --------------------
const previousXpByEntity = new Map();
const openXpEpisodeByEntity = new Map();
const sequenceByXpEntity = new Map();
const xpEpisodes = [];
const xpEntityIndexes = new Set();
const xpSubclassCounts = new Map();
const xpFieldNames = new Set();
const xpChangedFieldCounts = new Map();
let xpEvents = 0;
let xpCreates = 0;
let xpLeaves = 0;
let xpLaunchNumChanges = 0;
let xpLaunchTimeChanges = 0;
let xpLargeReuseJumps = 0;

// -------------------- Urn state --------------------
const previousUrnByEntity = new Map();
const urnEntityIndexes = new Set();
const urnEvents = [];
const urnFieldNames = new Set();
const urnChangedFieldCounts = new Map();
let urnEntityEvents = 0;

const parser = new Parser();
parser.registerPostInterceptor(InterceptorStage.ENTITY_PACKET, (demoPacket, messagePacket, events) => {
  const tick = finite(demoPacket?.tick);
  if (tick === null) return;
  for (const event of events ?? []) {
    const entity = event.entity;
    if (!entity) continue;
    const className = getEntityClassName(entity);
    if (className === XP_CLASS) processCItemXP(event, entity, tick);
    else if (className === URN_CLASS) processUrnEntity(event, entity, tick);
  }
});

console.log('\n=========================================');
console.log('CITEMXP SOURCE CLASSIFICATION V0.1');
console.log('=========================================');
console.log(`\nReplay: ${replayName}`);
console.log(`Trooper anchor deaths: ${deaths.length}\n`);

await parser.parse(createReadStream(replayPath));
await parser.dispose();

for (const episode of openXpEpisodeByEntity.values()) finalizeXpEpisode(episode, null, 'REPLAY_END');
openXpEpisodeByEntity.clear();

xpEpisodes.sort((a, b) => a.startTick - b.startTick);
xpEpisodes.forEach((e, i) => {
  e.episodeIndex = i;
  e.source = { type: 'UNCLASSIFIED', confidence: 'UNRESOLVED', sourceId: null };
});

// -------------------- Trooper -> XP candidate graph --------------------
const episodesByStartTick = new Map();
for (const e of xpEpisodes) pushMapArray(episodesByStartTick, e.startTick, e.episodeIndex);

const trooperEdges = [];
const deathEdges = new Map();
const episodeTrooperEdges = new Map();

for (let deathIndex = 0; deathIndex < deaths.length; deathIndex++) {
  const death = deaths[deathIndex];

  for (
    let tick = death.tick + TROOPER_MIN_TICK_DELTA;
    tick <= death.tick + TROOPER_MAX_TICK_DELTA;
    tick++
  ) {
    for (const episodeIndex of episodesByStartTick.get(tick) ?? []) {
      const episode = xpEpisodes[episodeIndex];

      if (!death.position || !episode.startPosition) continue;

      const distance3D = getDistance3D(
        death.position,
        episode.startPosition
      );

      if (distance3D > TROOPER_MAX_DISTANCE_3D) continue;

      const tickDelta =
        episode.startTick -
        death.tick;

      const distanceXY =
        getDistanceXY(
          death.position,
          episode.startPosition
        );

      const verticalDelta =
        episode.startPosition.z -
        death.position.z;

      const sameTeam =
        isGameTeam(death.team) &&
        isGameTeam(episode.team)
          ? death.team === episode.team
          : null;

      const cost =
        Math.abs(tickDelta) * 1_000_000 +
        (sameTeam === false ? 100_000 : 0) +
        Math.round(distance3D * 100);

      const edgeIndex =
        trooperEdges.length;

      trooperEdges.push({
        deathIndex,
        episodeIndex,
        tickDelta,
        distance3D,
        distanceXY,
        verticalDelta,
        sameTeam,
        cost
      });

      pushMapArray(
        deathEdges,
        deathIndex,
        edgeIndex
      );

      pushMapArray(
        episodeTrooperEdges,
        episodeIndex,
        edgeIndex
      );
    }
  }
}

const trooperComponents =
  buildCandidateComponents(
    trooperEdges,
    deathEdges,
    episodeTrooperEdges
  );

const trooperMatches =
  trooperComponents.flatMap(
    c =>
      solveComponentMinCostMatching(
        c,
        trooperEdges
      )
  );

const trooperMatchByDeath =
  new Map();

const trooperMatchByEpisode =
  new Map();

for (const match of trooperMatches) {
  if (
    trooperMatchByDeath.has(
      match.deathIndex
    )
  ) {
    throw new Error(
      `Trooper death assigned twice: ${match.deathIndex}`
    );
  }

  if (
    trooperMatchByEpisode.has(
      match.episodeIndex
    )
  ) {
    throw new Error(
      `CItemXP episode assigned twice: ${match.episodeIndex}`
    );
  }

  trooperMatchByDeath.set(
    match.deathIndex,
    match
  );

  trooperMatchByEpisode.set(
    match.episodeIndex,
    match
  );

  const episode =
    xpEpisodes[
      match.episodeIndex
    ];

  const death =
    deaths[
      match.deathIndex
    ];

  episode.source = {
    type:
      'TROOPER_DEATH',

    confidence:
      match.edge.tickDelta === 0 &&
      match.edge.distanceXY <= 30
        ? 'VERY_HIGH'
        : 'HIGH',

    sourceId:
      death.deathKey,

    trooperDeathIndex:
      match.deathIndex,

    trooperDeathKey:
      death.deathKey,

    trooperEntityIndex:
      death.entityIndex,

    trooperBaseType:
      death.baseType,

    trooperVariantLabel:
      death.variantLabel,

    trooperTeam:
      death.team,

    lane:
      death.lane,

    match:
      match.edge
  };
}

// -------------------- Unassigned burst discovery --------------------
const unassignedEpisodeIndexes =
  xpEpisodes
    .filter(
      e =>
        e.source.type ===
        'UNCLASSIFIED'
    )
    .map(
      e =>
        e.episodeIndex
    );

const burstClusters =
  buildXpBurstClusters(
    unassignedEpisodeIndexes
  );

const burstSummaries =
  burstClusters
    .map(
      (indexes, i) =>
        summarizeBurst(
          indexes,
          i
        )
    )
    .sort(
      (a, b) =>
        a.firstTick -
        b.firstTick
    );

for (const burst of burstSummaries) {
  burst.nearestUrnEntityEvent =
    findNearestUrnEvent(
      burst
    );

  burst.structuralUrnBurst =
    burst.orbCount >=
      URN_BURST_MIN_ORBS &&
    burst.tickSpan <=
      URN_BURST_MAX_TOTAL_SPAN_TICKS &&
    (
      burst.maxRadius === null ||
      burst.maxRadius <=
        URN_BURST_MAX_RADIUS
    );

  burst.idolCorrelated =
    Boolean(
      burst.nearestUrnEntityEvent
    );

  if (
    burst.structuralUrnBurst &&
    burst.idolCorrelated
  ) {
    burst.classification =
      'URN_BURST_WITH_IDOL_CORRELATION';

    burst.confidence =
      'HIGH';

  } else if (
    burst.structuralUrnBurst
  ) {
    burst.classification =
      'URN_BURST_CANDIDATE';

    burst.confidence =
      'MODERATE';

  } else {
    burst.classification =
      'OTHER_BURST_OR_PVS_CLUSTER';

    burst.confidence =
      'LOW';
  }
}

for (const burst of burstSummaries) {
  if (
    ![
      'URN_BURST_WITH_IDOL_CORRELATION',
      'URN_BURST_CANDIDATE'
    ].includes(
      burst.classification
    )
  ) {
    continue;
  }

  for (
    const episodeIndex
    of burst.episodeIndexes
  ) {
    const episode =
      xpEpisodes[
        episodeIndex
      ];

    if (
      episode.source.type !==
      'UNCLASSIFIED'
    ) {
      continue;
    }

    episode.source = {
      type:
        burst.classification,

      confidence:
        burst.confidence,

      sourceId:
        burst.burstId,

      urnBurstId:
        burst.burstId,

      urnOrbCount:
        burst.orbCount,

      urnBurstClock:
        burst.firstClock,

      urnBurstCenter:
        burst.centroid,

      idolCorrelated:
        burst.idolCorrelated,

      nearestUrnEntityEvent:
        burst.nearestUrnEntityEvent
    };
  }
}

for (const episode of xpEpisodes) {
  if (
    episode.source.type ===
    'UNCLASSIFIED'
  ) {
    episode.source = {
      type:
        'OTHER_UNRESOLVED',

      confidence:
        'UNRESOLVED',

      sourceId:
        null
    };
  }
}

// -------------------- Summaries --------------------
const trooperEpisodes =
  xpEpisodes.filter(
    e =>
      e.source.type ===
      'TROOPER_DEATH'
  );

const urnCorrelatedEpisodes =
  xpEpisodes.filter(
    e =>
      e.source.type ===
      'URN_BURST_WITH_IDOL_CORRELATION'
  );

const urnCandidateEpisodes =
  xpEpisodes.filter(
    e =>
      e.source.type ===
      'URN_BURST_CANDIDATE'
  );

const allUrnEpisodes = [
  ...urnCorrelatedEpisodes,
  ...urnCandidateEpisodes
];

const otherEpisodes =
  xpEpisodes.filter(
    e =>
      e.source.type ===
      'OTHER_UNRESOLVED'
  );

const trooperGeometry = {
  tickDelta:
    summarizeNumbers(
      trooperMatches.map(
        m =>
          m.edge.tickDelta
      )
    ),

  distance3D:
    summarizeNumbers(
      trooperMatches.map(
        m =>
          m.edge.distance3D
      )
    ),

  distanceXY:
    summarizeNumbers(
      trooperMatches.map(
        m =>
          m.edge.distanceXY
      )
    ),

  verticalDelta:
    summarizeNumbers(
      trooperMatches.map(
        m =>
          m.edge.verticalDelta
      )
    )
};

const trooperExactTick =
  trooperMatches.filter(
    m =>
      m.edge.tickDelta ===
      0
  ).length;

const trooperExactTickRate =
  rate(
    trooperExactTick,
    trooperMatches.length
  );

const trooperKnownTeamMatches =
  trooperMatches.filter(
    m =>
      m.edge.sameTeam !==
      null
  );

const trooperSameTeamMatches =
  trooperKnownTeamMatches.filter(
    m =>
      m.edge.sameTeam ===
      true
  );

const trooperSameTeamRate =
  rate(
    trooperSameTeamMatches.length,
    trooperKnownTeamMatches.length
  );

const trooperSubclassCounts =
  countBy(
    trooperEpisodes,
    e =>
      e.subclassId
  );

const urnSubclassCounts =
  countBy(
    allUrnEpisodes,
    e =>
      e.subclassId
  );

const otherSubclassCounts =
  countBy(
    otherEpisodes,
    e =>
      e.subclassId
  );

const dominantTrooperSubclass =
  getDominantKey(
    trooperSubclassCounts
  );

const dominantUrnSubclass =
  getDominantKey(
    urnSubclassCounts
  );

const sameDominantSubclass =
  dominantTrooperSubclass !== null &&
  dominantUrnSubclass !== null &&
  dominantTrooperSubclass ===
    dominantUrnSubclass;

const trooperTiming =
  summarizeEpisodeTiming(
    trooperEpisodes
  );

const urnTiming =
  summarizeEpisodeTiming(
    allUrnEpisodes
  );

const otherTiming =
  summarizeEpisodeTiming(
    otherEpisodes
  );

const timingComparison = {
  trooperLaunchToAttackableMedian:
    trooperTiming
      .launchToAttackableSeconds
      .median,

  urnLaunchToAttackableMedian:
    urnTiming
      .launchToAttackableSeconds
      .median,

  launchToAttackableMedianDifference:
    differenceIfFinite(
      trooperTiming
        .launchToAttackableSeconds
        .median,

      urnTiming
        .launchToAttackableSeconds
        .median
    ),

  trooperAttackableDurationMedian:
    trooperTiming
      .attackableDurationSeconds
      .median,

  urnAttackableDurationMedian:
    urnTiming
      .attackableDurationSeconds
      .median,

  attackableDurationMedianDifference:
    differenceIfFinite(
      trooperTiming
        .attackableDurationSeconds
        .median,

      urnTiming
        .attackableDurationSeconds
        .median
    )
};

const urnBurstsWithIdol =
  burstSummaries.filter(
    b =>
      b.classification ===
      'URN_BURST_WITH_IDOL_CORRELATION'
  );

const urnBurstsWithoutIdol =
  burstSummaries.filter(
    b =>
      b.classification ===
      'URN_BURST_CANDIDATE'
  );

const sourceCounts =
  countBy(
    xpEpisodes,
    e =>
      e.source.type
  );

// -------------------- Write episode stream --------------------
mkdirSync(
  dirname(
    episodePath
  ),
  {
    recursive:
      true
  }
);

const episodeWriter =
  createWriteStream(
    episodePath,
    {
      encoding:
        'utf8'
    }
  );

for (const episode of xpEpisodes) {
  episodeWriter.write(
    JSON.stringify({
      schemaVersion:
        1,

      canonical:
        false,

      episode:
        {
          episodeIndex:
            episode.episodeIndex,

          episodeId:
            episode.episodeId,

          entityIndex:
            episode.entityIndex,

          sequence:
            episode.sequence,

          subclassId:
            episode.subclassId,

          team:
            episode.team,

          startTick:
            episode.startTick,

          startTimeSeconds:
            episode.startTimeSeconds,

          startClock:
            episode.startClock,

          startPosition:
            episode.startPosition,

          startSignals:
            episode.startSignals,

          startOperation:
            episode.startOperation,

          launchNum:
            episode.launchNum,

          timeLaunch:
            episode.timeLaunch,

          attackableTime:
            episode.attackableTime,

          endAttackableTime:
            episode.endAttackableTime,

          launchToAttackableSeconds:
            getLaunchToAttackable(
              episode
            ),

          attackableDurationSeconds:
            getAttackableDuration(
              episode
            ),

          launchToEndAttackableSeconds:
            getLaunchToEndAttackable(
              episode
            ),

          firstLeaveTick:
            episode.firstLeaveTick,

          logicalEndTick:
            episode.logicalEndTick,

          logicalEndReason:
            episode.logicalEndReason
        },

      source:
        episode.source
    }) +
    '\n'
  );
}

await finishWriter(
  episodeWriter
);

// -------------------- Validation --------------------
const uniqueTrooperDeaths =
  new Set(
    trooperMatches.map(
      m =>
        m.deathIndex
    )
  );

const uniqueTrooperEpisodes =
  new Set(
    trooperMatches.map(
      m =>
        m.episodeIndex
    )
  );

const validation = {
  discoveryPassed:
    check(
      discovery
        ?.validation
        ?.pass,

      true,

      discovery
        ?.validation
        ?.pass ===
        true
    ),

  validatedTrooperAnchors:
    check(
      deaths.length,

      replayName ===
        'test'
        ? 1388
        : '>0',

      replayName ===
        'test'
        ? deaths.length ===
          1388
        : deaths.length >
          0
    ),

  citemxpEventsObserved:
    check(
      xpEvents,
      '>0',
      xpEvents >
      0
    ),

  logicalXpEpisodesObserved:
    check(
      xpEpisodes.length,
      '>0',
      xpEpisodes.length >
      0
    ),

  trooperLinkedEpisodesObserved:
    check(
      trooperEpisodes.length,
      '>0',
      trooperEpisodes.length >
      0
    ),

  trooperDeathAssignmentsUnique:
    check(
      uniqueTrooperDeaths.size,
      trooperMatches.length,
      uniqueTrooperDeaths.size ===
      trooperMatches.length
    ),

  trooperEpisodeAssignmentsUnique:
    check(
      uniqueTrooperEpisodes.size,
      trooperMatches.length,
      uniqueTrooperEpisodes.size ===
      trooperMatches.length
    ),

  trooperExactTickDominant:
    check(
      trooperExactTickRate,
      '>=0.75',
      Number.isFinite(
        trooperExactTickRate
      ) &&
      trooperExactTickRate >=
      0.75
    ),

  trooperTightPlanarGeometry:
    check(
      trooperGeometry
        .distanceXY
        .median,

      '<=50',

      Number.isFinite(
        trooperGeometry
          .distanceXY
          .median
      ) &&
      trooperGeometry
        .distanceXY
        .median <=
      50
    ),

  dominantTrooperSubclassObserved:
    check(
      dominantTrooperSubclass,
      'non-null',
      dominantTrooperSubclass !==
      null
    )
};

const validationPass =
  Object
    .values(
      validation
    )
    .every(
      v =>
        v.pass
    );

let genericOrbInterpretation =
  'CITEMXP_TROOPER_SIGNATURE_VALIDATED_URN_SOURCE_UNRESOLVED';

if (
  allUrnEpisodes.length >
    0 &&
  sameDominantSubclass
) {
  genericOrbInterpretation =
    'SAME_CITEMXP_SUBCLASS_SUPPORTS_GENERIC_CONTESTABLE_SOUL_ORB_OBJECT';
}

if (
  urnBurstsWithIdol.length >
    0 &&
  sameDominantSubclass
) {
  genericOrbInterpretation =
    'TROOPER_AND_URN_SOURCES_STRONGLY_SUPPORT_SHARED_GENERIC_CONTESTABLE_SOUL_ORB_OBJECT';
}

const summary = {
  replay:
    replayName,

  version:
    'CITEMXP_SOURCE_CLASSIFICATION_V01',

  canonical:
    false,

  status:
    validationPass
      ? 'WORKING_SOURCE_CLASSIFICATION'
      : 'DIAGNOSTIC_ONLY',

  purpose:
    [
      'Avoid treating CItemXP as Trooper-specific.',
      'Identify one-to-one CItemXP launches associated with validated Trooper deaths.',
      'Search remaining CItemXP launches for compact multi-orb bursts consistent with Soul Urn delivery.',
      'Correlate candidate Urn bursts with CCitadelItemPickupIdol telemetry.',
      'Compare subclass and attackability timing across Trooper and Urn sources.'
    ],

  rawCItemXP:
    {
      entityEvents:
        xpEvents,

      uniqueEntityIndexes:
        xpEntityIndexes.size,

      operationCreates:
        xpCreates,

      operationLeaves:
        xpLeaves,

      launchNumChanges:
        xpLaunchNumChanges,

      launchTimeChanges:
        xpLaunchTimeChanges,

      largeReusePositionJumps:
        xpLargeReuseJumps,

      logicalEpisodes:
        xpEpisodes.length,

      subclassCounts:
        mapToSortedObject(
          xpSubclassCounts
        ),

      discoveredFieldNames:
        [
          ...xpFieldNames
        ].sort(),

      changedFields:
        mapToSortedObject(
          xpChangedFieldCounts
        )
    },

  trooperSource:
    {
      anchorDeaths:
        deaths.length,

      matchedCItemXPEpisodes:
        trooperEpisodes.length,

      matchRate:
        rate(
          trooperEpisodes.length,
          deaths.length
        ),

      exactTickMatches:
        trooperExactTick,

      exactTickRate:
        trooperExactTickRate,

      sameTeamMatches:
        trooperSameTeamMatches.length,

      knownTeamMatches:
        trooperKnownTeamMatches.length,

      sameTeamRate:
        trooperSameTeamRate,

      geometry:
        trooperGeometry,

      subclassCounts:
        mapToSortedObject(
          trooperSubclassCounts
        ),

      dominantSubclass:
        dominantTrooperSubclass,

      teamCounts:
        mapToSortedObject(
          countBy(
            trooperEpisodes,
            e =>
              String(
                e.team ??
                'UNKNOWN'
              )
          )
        ),

      timing:
        trooperTiming
    },

  urnSourceDiscovery:
    {
      unassignedEpisodesAfterTrooperMatching:
        unassignedEpisodeIndexes.length,

      allBurstClusters:
        burstSummaries.length,

      urnBurstsWithIdolCorrelation:
        urnBurstsWithIdol.length,

      urnBurstsWithoutIdolCorrelation:
        urnBurstsWithoutIdol.length,

      urnEpisodes:
        allUrnEpisodes.length,

      idolCorrelatedEpisodes:
        urnCorrelatedEpisodes.length,

      nonIdolCandidateEpisodes:
        urnCandidateEpisodes.length,

      subclassCounts:
        mapToSortedObject(
          urnSubclassCounts
        ),

      dominantSubclass:
        dominantUrnSubclass,

      teamCounts:
        mapToSortedObject(
          countBy(
            allUrnEpisodes,
            e =>
              String(
                e.team ??
                'UNKNOWN'
              )
          )
        ),

      timing:
        urnTiming,

      burstExamples:
        burstSummaries
          .filter(
            b =>
              [
                'URN_BURST_WITH_IDOL_CORRELATION',
                'URN_BURST_CANDIDATE'
              ].includes(
                b.classification
              )
          )
          .slice(
            0,
            MAX_BURST_EXAMPLES
          )
    },

  urnEntityTelemetry:
    {
      entityEvents:
        urnEntityEvents,

      uniqueEntityIndexes:
        urnEntityIndexes.size,

      fieldNames:
        [
          ...urnFieldNames
        ].sort(),

      changedFields:
        mapToSortedObject(
          urnChangedFieldCounts
        ),

      eventSamples:
        urnEvents.slice(
          0,
          MAX_IDOL_EVENT_SAMPLES
        )
    },

  sourceComparison:
    {
      dominantTrooperSubclass,

      dominantUrnSubclass,

      sameDominantSubclass,

      timingComparison,

      interpretation:
        genericOrbInterpretation
    },

  sourceCounts:
    mapToSortedObject(
      sourceCounts
    ),

  unresolved:
    {
      otherEpisodeCount:
        otherEpisodes.length,

      otherSubclassCounts:
        mapToSortedObject(
          otherSubclassCounts
        ),

      timing:
        otherTiming,

      examples:
        otherEpisodes
          .slice(
            0,
            MAX_OTHER_EXAMPLES
          )
          .map(
            compactEpisode
          )
    },

  validation:
    {
      pass:
        validationPass,

      checks:
        validation
    },

  nextStep:
    'If Urn and Trooper sources share the same dominant CItemXP subclass and timing, reconstruct shot/deny/claim/auto-award outcomes by source context.',

  outputs:
    {
      summary:
        summaryPath,

      episodes:
        episodePath
    }
};

mkdirSync(
  dirname(
    summaryPath
  ),
  {
    recursive:
      true
  }
);

writeFileSync(
  summaryPath,
  JSON.stringify(
    summary,
    null,
    2
  ),
  'utf8'
);

console.log('\n=========================================');
console.log('CITEMXP SOURCE CLASSIFICATION RESULTS');
console.log('=========================================');

console.log(
  `\nCItemXP events: ${xpEvents.toLocaleString()}`
);

console.log(
  `Logical episodes: ${xpEpisodes.length}`
);

console.log('\nTROOPER SOURCE');

console.log(
  `Matched: ${trooperEpisodes.length}/${deaths.length} = ${
    formatPercent(
      rate(
        trooperEpisodes.length,
        deaths.length
      )
    )
  }`
);

console.log(
  `Exact tick: ${
    formatPercent(
      trooperExactTickRate
    )
  }`
);

console.log(
  `Median XY: ${
    formatNumber(
      trooperGeometry
        .distanceXY
        .median
    )
  }`
);

console.log(
  `Median vertical: ${
    formatNumber(
      trooperGeometry
        .verticalDelta
        .median
    )
  }`
);

console.log(
  `Same-team relation: ${
    formatPercent(
      trooperSameTeamRate
    )
  }`
);

console.log(
  `Dominant subclass: ${dominantTrooperSubclass}`
);

console.log('\nURN BURSTS');

console.log(
  `With Idol correlation: ${urnBurstsWithIdol.length}`
);

console.log(
  `Structural candidates without Idol correlation: ${urnBurstsWithoutIdol.length}`
);

console.log(
  `Episodes assigned to Urn candidates: ${allUrnEpisodes.length}`
);

console.log(
  `Dominant Urn subclass: ${dominantUrnSubclass}`
);

console.log('\nURN CANDIDATE BURSTS');

for (
  const burst
  of burstSummaries
    .filter(
      b =>
        [
          'URN_BURST_WITH_IDOL_CORRELATION',
          'URN_BURST_CANDIDATE'
        ].includes(
          b.classification
        )
    )
    .slice(
      0,
      30
    )
) {
  console.log(
    `${
      burst.burstId.padEnd(
        14
      )
    } time=${
      String(
        burst.firstClock
      ).padStart(
        6
      )
    } n=${
      String(
        burst.orbCount
      ).padStart(
        3
      )
    } span=${
      (
        burst.tickSpan /
        TICK_RATE
      ).toFixed(
        2
      )
    }s radius=${
      formatNumber(
        burst.maxRadius
      ).padStart(
        8
      )
    } idol=${
      burst.idolCorrelated
        ? 'YES'
        : 'NO '
    } subclass=${
      burst.dominantSubclass
    }`
  );
}

console.log('\nSOURCE COMPARISON');

console.log(
  `Trooper dominant subclass: ${dominantTrooperSubclass}`
);

console.log(
  `Urn dominant subclass:     ${dominantUrnSubclass}`
);

console.log(
  `Same dominant subclass:    ${sameDominantSubclass}`
);

console.log(
  `Interpretation: ${genericOrbInterpretation}`
);

console.log('\nVALIDATION');

for (
  const [
    key,
    result
  ]
  of Object.entries(
    validation
  )
) {
  console.log(
    `${
      result.pass
        ? 'PASS'
        : 'FAIL'
    }  ${
      key.padEnd(
        38
      )
    } actual=${
      JSON.stringify(
        result.actual
      )
    } expected=${
      JSON.stringify(
        result.expected
      )
    }`
  );
}

console.log(
  `\nOVERALL: ${
    validationPass
      ? 'PASS'
      : 'FAIL'
  }`
);

console.log(
  `\nSummary:\n${summaryPath}`
);

console.log(
  `\nEpisode stream:\n${episodePath}\n`
);

// ============================================================
// CItemXP processing
// ============================================================
function processCItemXP(
  event,
  entity,
  tick
) {
  xpEvents++;

  const entityIndex =
    getEntityIndex(
      entity
    );

  if (
    entityIndex ===
    null
  ) {
    return;
  }

  xpEntityIndexes.add(
    entityIndex
  );

  const changedFields =
    extractChangedFields(
      safeGetChanges(
        event
      )
    );

  for (
    const name
    of changedFields
  ) {
    increment(
      xpChangedFieldCounts,
      name
    );
  }

  if (
    xpFieldNames.size <
    MAX_DISCOVERED_FIELDS
  ) {
    for (
      const [
        fieldName
      ]
      of getFieldEntries(
        entity
      )
    ) {
      xpFieldNames.add(
        fieldName
      );

      if (
        xpFieldNames.size >=
        MAX_DISCOVERED_FIELDS
      ) {
        break;
      }
    }
  }

  const current = {
    tick,

    entityIndex,

    operation:
      decodeOperation(
        event.operation
      ),

    subclassId:
      String(
        serializeScalar(
          safeGetField(
            entity,
            'm_nSubclassID'
          )
        ) ??
        'UNKNOWN'
      ),

    team:
      finite(
        safeGetField(
          entity,
          'm_iTeamNum'
        )
      ),

    position:
      getBestPosition(
        entity
      ),

    launchNum:
      finite(
        safeGetField(
          entity,
          'm_nLaunchNum'
        )
      ),

    timeLaunch:
      finite(
        safeGetField(
          entity,
          'm_timeLaunch'
        )
      ),

    attackableTime:
      finite(
        safeGetField(
          entity,
          'm_flAttackableTime'
        )
      ),

    endAttackableTime:
      finite(
        safeGetField(
          entity,
          'm_flEndAttackableTime'
        )
      )
  };

  increment(
    xpSubclassCounts,
    current.subclassId
  );

  if (
    current.operation ===
    'CREATE'
  ) {
    xpCreates++;
  }

  if (
    current.operation ===
    'LEAVE'
  ) {
    xpLeaves++;
  }

  const previous =
    previousXpByEntity.get(
      entityIndex
    ) ??
    null;

  const open =
    openXpEpisodeByEntity.get(
      entityIndex
    ) ??
    null;

  const firstObservation =
    previous ===
    null;

  const launchNumChanged =
    Boolean(
      previous &&
      current.launchNum !==
        null &&
      previous.launchNum !==
        null &&
      current.launchNum !==
        previous.launchNum
    );

  const launchTimeChanged =
    Boolean(
      previous &&
      current.timeLaunch !==
        null &&
      previous.timeLaunch !==
        null &&
      Math.abs(
        current.timeLaunch -
        previous.timeLaunch
      ) >
      0.0001
    );

  if (
    launchNumChanged
  ) {
    xpLaunchNumChanges++;
  }

  if (
    launchTimeChanged
  ) {
    xpLaunchTimeChanges++;
  }

  let largeReuseJump =
    false;

  if (
    previous?.position &&
    current.position
  ) {
    const jumpDistance =
      getDistance3D(
        previous.position,
        current.position
      );

    if (
      jumpDistance >=
      REUSE_POSITION_JUMP_THRESHOLD
    ) {
      largeReuseJump =
        true;

      xpLargeReuseJumps++;
    }
  }

  const oldEnoughForReuse =
    open
      ? (
        tick -
        open.startTick
      ) >=
        MIN_TICKS_BEFORE_POSITION_REUSE
      : true;

  const relaunch =
    Boolean(
      open &&
      (
        launchNumChanged ||
        launchTimeChanged ||
        (
          largeReuseJump &&
          oldEnoughForReuse
        )
      )
    );

  if (
    relaunch
  ) {
    finalizeXpEpisode(
      open,
      tick - 1,
      'ENTITY_RELAUNCH_OR_REUSE'
    );

    openXpEpisodeByEntity.delete(
      entityIndex
    );
  }

  let episode =
    openXpEpisodeByEntity.get(
      entityIndex
    ) ??
    null;

  if (
    !episode
  ) {
    const startSignals =
      [];

    if (
      firstObservation
    ) {
      startSignals.push(
        'FIRST_OBSERVATION'
      );
    }

    if (
      current.operation ===
      'CREATE'
    ) {
      startSignals.push(
        'OPERATION_CREATE'
      );
    }

    if (
      launchNumChanged
    ) {
      startSignals.push(
        'LAUNCH_NUM_CHANGED'
      );
    }

    if (
      launchTimeChanged
    ) {
      startSignals.push(
        'TIME_LAUNCH_CHANGED'
      );
    }

    if (
      largeReuseJump
    ) {
      startSignals.push(
        'LARGE_POSITION_REUSE_JUMP'
      );
    }

    episode =
      startXpEpisode(
        current,
        startSignals
      );

    openXpEpisodeByEntity.set(
      entityIndex,
      episode
    );
  }

  episode.lastObservedTick =
    tick;

  episode.lastPosition =
    current.position ??
    episode.lastPosition;

  if (
    current.team !==
    null
  ) {
    episode.team =
      current.team;
  }

  if (
    current.subclassId !==
    'UNKNOWN'
  ) {
    episode.subclassId =
      current.subclassId;
  }

  if (
    current.launchNum !==
    null
  ) {
    episode.launchNum =
      current.launchNum;
  }

  if (
    current.timeLaunch !==
    null
  ) {
    episode.timeLaunch =
      current.timeLaunch;
  }

  if (
    current.attackableTime !==
    null
  ) {
    episode.attackableTime =
      current.attackableTime;
  }

  if (
    current.endAttackableTime !==
    null
  ) {
    episode.endAttackableTime =
      current.endAttackableTime;
  }

  if (
    current.operation ===
      'LEAVE' &&
    episode.firstLeaveTick ===
      null
  ) {
    episode.firstLeaveTick =
      tick;
  }

  previousXpByEntity.set(
    entityIndex,
    current
  );
}

function startXpEpisode(
  current,
  startSignals
) {
  const sequence =
    (
      sequenceByXpEntity.get(
        current.entityIndex
      ) ??
      0
    ) +
    1;

  sequenceByXpEntity.set(
    current.entityIndex,
    sequence
  );

  return {
    episodeId:
      `${current.entityIndex}|${sequence}`,

    entityIndex:
      current.entityIndex,

    sequence,

    subclassId:
      current.subclassId,

    team:
      current.team,

    startTick:
      current.tick,

    startTimeSeconds:
      tickToMatchTime(
        current.tick
      ),

    startClock:
      formatClock(
        tickToMatchTime(
          current.tick
        )
      ),

    startPosition:
      current.position,

    lastPosition:
      current.position,

    startSignals:
      startSignals.length
        ? startSignals
        : [
          'OPEN_EPISODE_WITHOUT_STRONG_START_SIGNAL'
        ],

    startOperation:
      current.operation,

    launchNum:
      current.launchNum,

    timeLaunch:
      current.timeLaunch,

    attackableTime:
      current.attackableTime,

    endAttackableTime:
      current.endAttackableTime,

    firstLeaveTick:
      current.operation ===
        'LEAVE'
        ? current.tick
        : null,

    lastObservedTick:
      current.tick,

    logicalEndTick:
      null,

    logicalEndReason:
      null,

    finalized:
      false,

    source:
      null
  };
}

function finalizeXpEpisode(
  episode,
  endTick,
  reason
) {
  if (
    episode.finalized
  ) {
    return;
  }

  episode.logicalEndTick =
    endTick ??
    episode.lastObservedTick;

  episode.logicalEndReason =
    reason;

  episode.finalized =
    true;

  xpEpisodes.push(
    episode
  );
}

// ============================================================
// Urn processing
// ============================================================
function processUrnEntity(
  event,
  entity,
  tick
) {
  urnEntityEvents++;

  const entityIndex =
    getEntityIndex(
      entity
    );

  if (
    entityIndex ===
    null
  ) {
    return;
  }

  urnEntityIndexes.add(
    entityIndex
  );

  const changedFields =
    extractChangedFields(
      safeGetChanges(
        event
      )
    );

  for (
    const name
    of changedFields
  ) {
    increment(
      urnChangedFieldCounts,
      name
    );
  }

  if (
    urnFieldNames.size <
    MAX_DISCOVERED_FIELDS
  ) {
    for (
      const [
        fieldName
      ]
      of getFieldEntries(
        entity
      )
    ) {
      urnFieldNames.add(
        fieldName
      );

      if (
        urnFieldNames.size >=
        MAX_DISCOVERED_FIELDS
      ) {
        break;
      }
    }
  }

  const current = {
    tick,

    entityIndex,

    operation:
      decodeOperation(
        event.operation
      ),

    team:
      finite(
        safeGetField(
          entity,
          'm_iTeamNum'
        )
      ),

    position:
      getBestPosition(
        entity
      ),

    active:
      booleanOrNull(
        safeGetField(
          entity,
          'm_bActive'
        )
      ),

    owner:
      serializeScalar(
        safeGetField(
          entity,
          'm_hOwner'
        )
      ),

    ownerEntity:
      serializeScalar(
        safeGetField(
          entity,
          'm_hOwnerEntity'
        )
      ),

    changedFields
  };

  const previous =
    previousUrnByEntity.get(
      entityIndex
    ) ??
    null;

  const meaningful =
    previous ===
      null ||
    current.operation !==
      'UPDATE' ||
    changedFields.length >
      0 ||
    (
      previous?.position &&
      current.position &&
      getDistance3D(
        previous.position,
        current.position
      ) >
      128
    );

  if (
    meaningful
  ) {
    urnEvents.push({
      tick,

      timeSeconds:
        tickToMatchTime(
          tick
        ),

      clock:
        formatClock(
          tickToMatchTime(
            tick
          )
        ),

      entityIndex,

      operation:
        current.operation,

      team:
        current.team,

      position:
        current.position,

      active:
        current.active,

      owner:
        current.owner,

      ownerEntity:
        current.ownerEntity,

      changedFields
    });
  }

  previousUrnByEntity.set(
    entityIndex,
    current
  );
}

// ============================================================
// Burst classification
// ============================================================
function buildXpBurstClusters(
  episodeIndexes
) {
  const remaining =
    new Set(
      episodeIndexes
    );

  const clusters =
    [];

  while (
    remaining.size
  ) {
    const first =
      remaining
        .values()
        .next()
        .value;

    remaining.delete(
      first
    );

    const cluster =
      [];

    const queue =
      [
        first
      ];

    while (
      queue.length
    ) {
      const currentIndex =
        queue.shift();

      cluster.push(
        currentIndex
      );

      const current =
        xpEpisodes[
          currentIndex
        ];

      for (
        const candidateIndex
        of [
          ...remaining
        ]
      ) {
        const candidate =
          xpEpisodes[
            candidateIndex
          ];

        if (
          Math.abs(
            candidate.startTick -
            current.startTick
          ) >
          URN_BURST_NEIGHBOR_TICKS
        ) {
          continue;
        }

        if (
          !current.startPosition ||
          !candidate.startPosition
        ) {
          continue;
        }

        if (
          getDistance3D(
            current.startPosition,
            candidate.startPosition
          ) >
          URN_BURST_NEIGHBOR_DISTANCE
        ) {
          continue;
        }

        remaining.delete(
          candidateIndex
        );

        queue.push(
          candidateIndex
        );
      }
    }

    clusters.push(
      cluster
    );
  }

  return clusters;
}

function summarizeBurst(
  episodeIndexes,
  index
) {
  const eps =
    episodeIndexes
      .map(
        i =>
          xpEpisodes[
            i
          ]
      )
      .sort(
        (a, b) =>
          a.startTick -
          b.startTick
      );

  const first =
    eps[
      0
    ];

  const last =
    eps.at(
      -1
    );

  const positions =
    eps
      .map(
        e =>
          e.startPosition
      )
      .filter(
        Boolean
      );

  const centroid =
    getCentroid(
      positions
    );

  const radii =
    centroid
      ? positions.map(
        p =>
          getDistance3D(
            p,
            centroid
          )
      )
      : [];

  const subclassCounts =
    countBy(
      eps,
      e =>
        e.subclassId
    );

  const teamCounts =
    countBy(
      eps,
      e =>
        String(
          e.team ??
          'UNKNOWN'
        )
    );

  return {
    burstId:
      `XP_BURST_${
        String(
          index +
          1
        ).padStart(
          4,
          '0'
        )
      }`,

    episodeIndexes,

    episodeIds:
      eps.map(
        e =>
          e.episodeId
      ),

    orbCount:
      eps.length,

    firstTick:
      first.startTick,

    lastTick:
      last.startTick,

    tickSpan:
      last.startTick -
      first.startTick,

    firstTimeSeconds:
      first.startTimeSeconds,

    firstClock:
      first.startClock,

    lastTimeSeconds:
      last.startTimeSeconds,

    lastClock:
      last.startClock,

    centroid,

    maxRadius:
      radii.length
        ? Math.max(
          ...radii
        )
        : null,

    medianRadius:
      summarizeNumbers(
        radii
      ).median,

    subclassCounts:
      mapToSortedObject(
        subclassCounts
      ),

    dominantSubclass:
      getDominantKey(
        subclassCounts
      ),

    teamCounts:
      mapToSortedObject(
        teamCounts
      ),

    dominantTeam:
      getDominantKey(
        teamCounts
      ),

    timing:
      summarizeEpisodeTiming(
        eps
      ),

    nearestUrnEntityEvent:
      null,

    structuralUrnBurst:
      false,

    idolCorrelated:
      false,

    classification:
      'UNCLASSIFIED_BURST',

    confidence:
      'UNRESOLVED'
  };
}

function findNearestUrnEvent(
  burst
) {
  if (
    !burst.centroid
  ) {
    return null;
  }

  let best =
    null;

  for (
    const event
    of urnEvents
  ) {
    const tickDelta =
      event.tick -
      burst.firstTick;

    if (
      Math.abs(
        tickDelta
      ) >
      URN_IDOL_MAX_TIME_DELTA_TICKS ||
      !event.position
    ) {
      continue;
    }

    const distance3D =
      getDistance3D(
        burst.centroid,
        event.position
      );

    if (
      distance3D >
      URN_IDOL_MAX_DISTANCE
    ) {
      continue;
    }

    const score =
      Math.abs(
        tickDelta
      ) *
      10000 +
      distance3D;

    if (
      !best ||
      score <
      best.score
    ) {
      best = {
        score,

        tick:
          event.tick,

        timeSeconds:
          event.timeSeconds,

        clock:
          event.clock,

        tickDelta,

        secondsDelta:
          tickDelta /
          TICK_RATE,

        entityIndex:
          event.entityIndex,

        operation:
          event.operation,

        team:
          event.team,

        position:
          event.position,

        distance3D,

        active:
          event.active,

        owner:
          event.owner,

        ownerEntity:
          event.ownerEntity,

        changedFields:
          event.changedFields
      };
    }
  }

  return best;
}

// ============================================================
// Timing
// ============================================================
function summarizeEpisodeTiming(
  episodes
) {
  const launchToAttackable =
    [];

  const attackableDuration =
    [];

  const launchToEnd =
    [];

  let completeTimingCount =
    0;

  for (
    const e
    of episodes
  ) {
    const a =
      getLaunchToAttackable(
        e
      );

    const b =
      getAttackableDuration(
        e
      );

    const c =
      getLaunchToEndAttackable(
        e
      );

    if (
      Number.isFinite(
        a
      )
    ) {
      launchToAttackable.push(
        a
      );
    }

    if (
      Number.isFinite(
        b
      )
    ) {
      attackableDuration.push(
        b
      );
    }

    if (
      Number.isFinite(
        c
      )
    ) {
      launchToEnd.push(
        c
      );
    }

    if (
      [
        a,
        b,
        c
      ].every(
        Number.isFinite
      )
    ) {
      completeTimingCount++;
    }
  }

  return {
    episodeCount:
      episodes.length,

    completeTimingCount,

    completeTimingRate:
      rate(
        completeTimingCount,
        episodes.length
      ),

    launchToAttackableSeconds:
      summarizeNumbers(
        launchToAttackable
      ),

    attackableDurationSeconds:
      summarizeNumbers(
        attackableDuration
      ),

    launchToEndAttackableSeconds:
      summarizeNumbers(
        launchToEnd
      )
  };
}

function getLaunchToAttackable(
  e
) {
  return boundedDelta(
    e.attackableTime,
    e.timeLaunch
  );
}

function getAttackableDuration(
  e
) {
  return boundedDelta(
    e.endAttackableTime,
    e.attackableTime
  );
}

function getLaunchToEndAttackable(
  e
) {
  return boundedDelta(
    e.endAttackableTime,
    e.timeLaunch
  );
}

function boundedDelta(
  a,
  b
) {
  if (
    !Number.isFinite(
      a
    ) ||
    !Number.isFinite(
      b
    )
  ) {
    return null;
  }

  const v =
    a -
    b;

  return (
    v >=
      0 &&
    v <=
      20
  )
    ? v
    : null;
}

// ============================================================
// Matching components + min-cost maximum matching
// ============================================================
function buildCandidateComponents(
  edges,
  deathAdj,
  episodeAdj
) {
  const visitedD =
    new Set();

  const visitedE =
    new Set();

  const components =
    [];

  for (
    const startDeath
    of deathAdj.keys()
  ) {
    if (
      visitedD.has(
        startDeath
      )
    ) {
      continue;
    }

    const queue = [
      {
        type:
          'D',

        index:
          startDeath
      }
    ];

    const deathIndexes =
      new Set();

    const episodeIndexes =
      new Set();

    const edgeIndexes =
      new Set();

    while (
      queue.length
    ) {
      const node =
        queue.shift();

      if (
        node.type ===
        'D'
      ) {
        if (
          visitedD.has(
            node.index
          )
        ) {
          continue;
        }

        visitedD.add(
          node.index
        );

        deathIndexes.add(
          node.index
        );

        for (
          const edgeIndex
          of deathAdj.get(
            node.index
          ) ??
          []
        ) {
          edgeIndexes.add(
            edgeIndex
          );

          const episodeIndex =
            edges[
              edgeIndex
            ].episodeIndex;

          if (
            !visitedE.has(
              episodeIndex
            )
          ) {
            queue.push({
              type:
                'E',

              index:
                episodeIndex
            });
          }
        }

      } else {
        if (
          visitedE.has(
            node.index
          )
        ) {
          continue;
        }

        visitedE.add(
          node.index
        );

        episodeIndexes.add(
          node.index
        );

        for (
          const edgeIndex
          of episodeAdj.get(
            node.index
          ) ??
          []
        ) {
          edgeIndexes.add(
            edgeIndex
          );

          const deathIndex =
            edges[
              edgeIndex
            ].deathIndex;

          if (
            !visitedD.has(
              deathIndex
            )
          ) {
            queue.push({
              type:
                'D',

              index:
                deathIndex
            });
          }
        }
      }
    }

    components.push({
      deathIndexes:
        [
          ...deathIndexes
        ],

      episodeIndexes:
        [
          ...episodeIndexes
        ],

      edgeIndexes:
        [
          ...edgeIndexes
        ]
    });
  }

  return components;
}

function solveComponentMinCostMatching(
  component,
  globalEdges
) {
  const deathsLocal =
    component.deathIndexes;

  const episodesLocal =
    component.episodeIndexes;

  if (
    !deathsLocal.length ||
    !episodesLocal.length
  ) {
    return [];
  }

  const dMap =
    new Map(
      deathsLocal.map(
        (v, i) =>
          [
            v,
            i
          ]
      )
    );

  const eMap =
    new Map(
      episodesLocal.map(
        (v, i) =>
          [
            v,
            i
          ]
      )
    );

  const source =
    0;

  const deathOffset =
    1;

  const episodeOffset =
    deathOffset +
    deathsLocal.length;

  const sink =
    episodeOffset +
    episodesLocal.length;

  const graph =
    Array.from(
      {
        length:
          sink +
          1
      },
      () => []
    );

  for (
    let i =
      0;
    i <
      deathsLocal.length;
    i++
  ) {
    addFlowEdge(
      graph,
      source,
      deathOffset +
        i,
      1,
      0,
      null
    );
  }

  for (
    let i =
      0;
    i <
      episodesLocal.length;
    i++
  ) {
    addFlowEdge(
      graph,
      episodeOffset +
        i,
      sink,
      1,
      0,
      null
    );
  }

  for (
    const edgeIndex
    of component.edgeIndexes
  ) {
    const e =
      globalEdges[
        edgeIndex
      ];

    addFlowEdge(
      graph,

      deathOffset +
        dMap.get(
          e.deathIndex
        ),

      episodeOffset +
        eMap.get(
          e.episodeIndex
        ),

      1,

      e.cost,

      {
        edgeIndex,

        deathIndex:
          e.deathIndex,

        episodeIndex:
          e.episodeIndex
      }
    );
  }

  while (
    true
  ) {
    const shortest =
      shortestPathSPFA(
        graph,
        source,
        sink
      );

    if (
      !shortest.reachable
    ) {
      break;
    }

    let node =
      sink;

    while (
      node !==
      source
    ) {
      const prev =
        shortest.previousNode[
          node
        ];

      const ei =
        shortest.previousEdge[
          node
        ];

      const edge =
        graph[
          prev
        ][
          ei
        ];

      edge.capacity--;

      graph[
        node
      ][
        edge.reverseIndex
      ].capacity++;

      node =
        prev;
    }
  }

  const matches =
    [];

  for (
    let localDeath =
      0;
    localDeath <
      deathsLocal.length;
    localDeath++
  ) {
    for (
      const edge
      of graph[
        deathOffset +
        localDeath
      ]
    ) {
      if (
        !edge.meta ||
        edge.capacity !==
          0
      ) {
        continue;
      }

      matches.push({
        deathIndex:
          edge.meta.deathIndex,

        episodeIndex:
          edge.meta.episodeIndex,

        edge:
          globalEdges[
            edge.meta.edgeIndex
          ]
      });
    }
  }

  return matches;
}

function addFlowEdge(
  graph,
  from,
  to,
  capacity,
  cost,
  meta
) {
  const forward = {
    to,

    reverseIndex:
      graph[
        to
      ].length,

    capacity,

    cost,

    meta
  };

  const reverse = {
    to:
      from,

    reverseIndex:
      graph[
        from
      ].length,

    capacity:
      0,

    cost:
      -cost,

    meta:
      null
  };

  graph[
    from
  ].push(
    forward
  );

  graph[
    to
  ].push(
    reverse
  );
}

function shortestPathSPFA(
  graph,
  source,
  sink
) {
  const distance =
    Array(
      graph.length
    ).fill(
      Infinity
    );

  const previousNode =
    Array(
      graph.length
    ).fill(
      -1
    );

  const previousEdge =
    Array(
      graph.length
    ).fill(
      -1
    );

  const inQueue =
    Array(
      graph.length
    ).fill(
      false
    );

  const queue = [
    source
  ];

  distance[
    source
  ] =
    0;

  inQueue[
    source
  ] =
    true;

  let head =
    0;

  while (
    head <
    queue.length
  ) {
    const node =
      queue[
        head++
      ];

    inQueue[
      node
    ] =
      false;

    for (
      let i =
        0;
      i <
        graph[
          node
        ].length;
      i++
    ) {
      const edge =
        graph[
          node
        ][
          i
        ];

      if (
        edge.capacity <=
        0
      ) {
        continue;
      }

      const nd =
        distance[
          node
        ] +
        edge.cost;

      if (
        nd >=
        distance[
          edge.to
        ]
      ) {
        continue;
      }

      distance[
        edge.to
      ] =
        nd;

      previousNode[
        edge.to
      ] =
        node;

      previousEdge[
        edge.to
      ] =
        i;

      if (
        !inQueue[
          edge.to
        ]
      ) {
        queue.push(
          edge.to
        );

        inQueue[
          edge.to
        ] =
          true;
      }
    }
  }

  return {
    reachable:
      Number.isFinite(
        distance[
          sink
        ]
      ),

    previousNode,

    previousEdge
  };
}

// ============================================================
// Entity/change helpers
// ============================================================
function safeGetChanges(
  event
) {
  try {
    return typeof event.getChanges ===
      'function'
      ? event.getChanges()
      : null;

  } catch {
    return null;
  }
}

function extractChangedFields(
  raw
) {
  if (
    raw == null
  ) {
    return [];
  }

  if (
    raw instanceof Map
  ) {
    return [
      ...raw.keys()
    ].map(
      String
    );
  }

  if (
    Array.isArray(
      raw
    )
  ) {
    return [
      ...new Set(
        raw
          .map(
            r =>
              Array.isArray(
                r
              )
                ? r[0]
                : (
                  r?.fieldName ??
                  r?.name ??
                  r?.key ??
                  r?.path
                )
          )
          .filter(
            Boolean
          )
          .map(
            String
          )
      )
    ];
  }

  return typeof raw ===
    'object'
    ? Object.keys(
      raw
    )
    : [];
}

function getFieldEntries(
  entity
) {
  try {
    if (
      typeof entity.fieldEntries !==
      'function'
    ) {
      return [];
    }

    return [
      ...entity.fieldEntries()
    ].map(
      row =>
        Array.isArray(
          row
        )
          ? [
            String(
              row[
                0
              ]
            ),
            row[
              1
            ]
          ]
          : [
            String(
              row?.name ??
              row?.key ??
              row?.fieldName ??
              row?.path ??
              'UNKNOWN'
            ),
            row?.value
          ]
    );

  } catch {
    return [];
  }
}

function safeGetField(
  entity,
  fieldName
) {
  try {
    return typeof entity.getField ===
      'function'
      ? entity.getField(
        fieldName
      )
      : undefined;

  } catch {
    return undefined;
  }
}

function getEntityClassName(
  entity
) {
  try {
    if (
      typeof entity.getClassName ===
      'function'
    ) {
      const v =
        entity.getClassName();

      if (
        v
      ) {
        return String(
          v
        );
      }
    }

  } catch {}

  return (
    entity.className ??
    entity?.class?.name ??
    entity?._className ??
    null
  );
}

function getEntityIndex(
  entity
) {
  const direct =
    finite(
      entity?.index ??
      entity?.entityIndex
    );

  if (
    direct !==
    null
  ) {
    return direct;
  }

  try {
    return typeof entity.getIndex ===
      'function'
      ? finite(
        entity.getIndex()
      )
      : null;

  } catch {
    return null;
  }
}

function decodeOperation(
  operation
) {
  const text =
    String(
      operation?._code ??
      operation?.code ??
      operation ??
      'UNKNOWN'
    ).toUpperCase();

  for (
    const name
    of [
      'CREATE',
      'UPDATE',
      'LEAVE',
      'DELETE'
    ]
  ) {
    if (
      text.includes(
        name
      )
    ) {
      return name;
    }
  }

  return text;
}

// ============================================================
// Position helpers
// ============================================================
function getBestPosition(
  entity
) {
  const cell =
    getCellWorldPosition(
      entity
    );

  if (
    cell
  ) {
    return cell;
  }

  for (
    const fieldName
    of [
      'CGameSceneNode.m_vecOrigin',
      'CBodyComponent.m_vecAbsOrigin',
      'm_vecAbsOrigin',
      'm_vecOrigin'
    ]
  ) {
    const v =
      normalizeVector(
        safeGetField(
          entity,
          fieldName
        )
      );

    if (
      v
    ) {
      return v;
    }
  }

  return null;
}

function getCellWorldPosition(
  entity
) {
  const cellX =
    finite(
      safeGetField(
        entity,
        'CBodyComponent.m_cellX'
      )
    );

  const cellY =
    finite(
      safeGetField(
        entity,
        'CBodyComponent.m_cellY'
      )
    );

  const cellZ =
    finite(
      safeGetField(
        entity,
        'CBodyComponent.m_cellZ'
      )
    );

  const vecX =
    finite(
      safeGetField(
        entity,
        'CBodyComponent.m_vecX'
      )
    );

  const vecY =
    finite(
      safeGetField(
        entity,
        'CBodyComponent.m_vecY'
      )
    );

  const vecZ =
    finite(
      safeGetField(
        entity,
        'CBodyComponent.m_vecZ'
      )
    );

  if (
    cellX ===
      null ||
    cellY ===
      null ||
    vecX ===
      null ||
    vecY ===
      null
  ) {
    return null;
  }

  return {
    x:
      cellX * 512 -
      16384 +
      vecX,

    y:
      cellY * 512 -
      16384 +
      vecY,

    z:
      cellZ !==
        null &&
      vecZ !==
        null
        ? cellZ * 512 -
          16384 +
          vecZ
        : 0
  };
}

function normalizeVector(
  value
) {
  if (
    !value
  ) {
    return null;
  }

  if (
    Array.isArray(
      value
    ) &&
    value.length >=
      2
  ) {
    return normalizePosition({
      x:
        value[
          0
        ],

      y:
        value[
          1
        ],

      z:
        value[
          2
        ] ??
        0
    });
  }

  if (
    typeof value ===
    'object'
  ) {
    return normalizePosition({
      x:
        value.x ??
        value.X ??
        value[
          0
        ],

      y:
        value.y ??
        value.Y ??
        value[
          1
        ],

      z:
        value.z ??
        value.Z ??
        value[
          2
        ] ??
        0
    });
  }

  return null;
}

function normalizePosition(
  value
) {
  if (
    !value ||
    typeof value !==
      'object'
  ) {
    return null;
  }

  const x =
    finite(
      value.x
    );

  const y =
    finite(
      value.y
    );

  const z =
    finite(
      value.z
    ) ??
    0;

  return x ===
    null ||
    y ===
    null
    ? null
    : {
      x,
      y,
      z
    };
}

function getDistance3D(
  a,
  b
) {
  return Math.hypot(
    a.x -
      b.x,

    a.y -
      b.y,

    (
      a.z ??
      0
    ) -
    (
      b.z ??
      0
    )
  );
}

function getDistanceXY(
  a,
  b
) {
  return Math.hypot(
    a.x -
      b.x,

    a.y -
      b.y
  );
}

function getCentroid(
  positions
) {
  if (
    !positions.length
  ) {
    return null;
  }

  return {
    x:
      average(
        positions.map(
          p =>
            p.x
        )
      ),

    y:
      average(
        positions.map(
          p =>
            p.y
        )
      ),

    z:
      average(
        positions.map(
          p =>
            p.z
        )
      )
  };
}

// ============================================================
// Data helpers
// ============================================================
async function loadJsonl(
  path
) {
  const rows =
    [];

  const reader =
    createInterface({
      input:
        createReadStream(
          path,
          {
            encoding:
              'utf8'
          }
        ),

      crlfDelay:
        Infinity
    });

  for await (
    const line
    of reader
  ) {
    if (
      !line.trim()
    ) {
      continue;
    }

    try {
      rows.push(
        JSON.parse(
          line
        )
      );

    } catch {}
  }

  return rows;
}

function normalizeDeath(
  row
) {
  const tick =
    finite(
      row
        ?.timing
        ?.tick
    );

  const timeSeconds =
    finite(
      row
        ?.timing
        ?.timeSeconds
    );

  const position =
    normalizePosition(
      row
        ?.trooper
        ?.position
    );

  if (
    tick ===
      null ||
    timeSeconds ===
      null ||
    !position
  ) {
    return null;
  }

  return {
    deathKey:
      row.deathKey ??
      null,

    entityIndex:
      finite(
        row
          ?.trooper
          ?.entityIndex
      ),

    tick,

    timeSeconds,

    clock:
      row
        ?.timing
        ?.clock ??
      formatClock(
        timeSeconds
      ),

    team:
      finite(
        row
          ?.trooper
          ?.team
      ),

    lane:
      finite(
        row
          ?.trooper
          ?.lane
      ),

    baseType:
      row
        ?.trooper
        ?.baseType ??
      'UNKNOWN',

    variantLabel:
      row
        ?.trooper
        ?.variantLabel ??
      'UNKNOWN',

    position,

    groundSoulMatched:
      row
        ?.match
        ?.status ===
        'ONE_TO_ONE_ASSIGNED_GOLD_MATCH' ||
      Boolean(
        row.groundSoul
      )
  };
}

function pushMapArray(
  map,
  key,
  value
) {
  if (
    !map.has(
      key
    )
  ) {
    map.set(
      key,
      []
    );
  }

  map
    .get(
      key
    )
    .push(
      value
    );
}

function increment(
  map,
  key
) {
  map.set(
    key,
    (
      map.get(
        key
      ) ??
      0
    ) +
    1
  );
}

function countBy(
  rows,
  keyFn
) {
  const m =
    new Map();

  for (
    const row
    of rows
  ) {
    increment(
      m,
      keyFn(
        row
      )
    );
  }

  return m;
}

function mapToSortedObject(
  map
) {
  return Object.fromEntries(
    [
      ...map.entries()
    ].sort(
      (a, b) =>
        b[
          1
        ] -
        a[
          1
        ]
    )
  );
}

function getDominantKey(
  map
) {
  return map.size
    ? [
      ...map.entries()
    ].sort(
      (a, b) =>
        b[
          1
        ] -
        a[
          1
        ]
    )[
      0
    ][
      0
    ]
    : null;
}

function summarizeNumbers(
  values
) {
  const clean =
    values
      .filter(
        Number.isFinite
      )
      .sort(
        (a, b) =>
          a -
          b
      );

  if (
    !clean.length
  ) {
    return {
      count:
        0,

      min:
        null,

      p10:
        null,

      p25:
        null,

      median:
        null,

      p75:
        null,

      p90:
        null,

      max:
        null,

      mean:
        null
    };
  }

  return {
    count:
      clean.length,

    min:
      clean[
        0
      ],

    p10:
      percentile(
        clean,
        .10
      ),

    p25:
      percentile(
        clean,
        .25
      ),

    median:
      percentile(
        clean,
        .50
      ),

    p75:
      percentile(
        clean,
        .75
      ),

    p90:
      percentile(
        clean,
        .90
      ),

    max:
      clean.at(
        -1
      ),

    mean:
      clean.reduce(
        (a, b) =>
          a +
          b,
        0
      ) /
      clean.length
  };
}

function percentile(
  sorted,
  p
) {
  if (
    sorted.length ===
    1
  ) {
    return sorted[
      0
    ];
  }

  const pos =
    (
      sorted.length -
      1
    ) *
    p;

  const lo =
    Math.floor(
      pos
    );

  const hi =
    Math.ceil(
      pos
    );

  return lo ===
    hi
    ? sorted[
      lo
    ]
    : sorted[
      lo
    ] *
      (
        1 -
        (
          pos -
          lo
        )
      ) +
      sorted[
        hi
      ] *
      (
        pos -
        lo
      );
}

function finite(
  value
) {
  if (
    value == null ||
    value ===
      ''
  ) {
    return null;
  }

  const n =
    Number(
      value
    );

  return Number.isFinite(
    n
  )
    ? n
    : null;
}

function booleanOrNull(
  value
) {
  if (
    value ===
      true ||
    value ===
      false
  ) {
    return value;
  }

  if (
    value ===
      1 ||
    value ===
      '1'
  ) {
    return true;
  }

  if (
    value ===
      0 ||
    value ===
      '0'
  ) {
    return false;
  }

  return null;
}

function serializeScalar(
  value
) {
  if (
    value == null
  ) {
    return null;
  }

  if (
    typeof value ===
    'bigint'
  ) {
    return value.toString();
  }

  if (
    [
      'string',
      'number',
      'boolean'
    ].includes(
      typeof value
    )
  ) {
    return value;
  }

  return String(
    value
  );
}

function average(
  values
) {
  const clean =
    values.filter(
      Number.isFinite
    );

  return clean.length
    ? clean.reduce(
      (a, b) =>
        a +
        b,
      0
    ) /
      clean.length
    : null;
}

function differenceIfFinite(
  a,
  b
) {
  return Number.isFinite(
    a
  ) &&
  Number.isFinite(
    b
  )
    ? Math.abs(
      a -
      b
    )
    : null;
}

function rate(
  n,
  d
) {
  return Number.isFinite(
    n
  ) &&
  Number.isFinite(
    d
  ) &&
  d !==
    0
    ? n /
      d
    : null;
}

function isGameTeam(
  v
) {
  return (
    v ===
    2 ||
    v ===
    3
  );
}

function tickToMatchTime(
  tick
) {
  return tick /
    TICK_RATE -
    MATCH_CLOCK_OFFSET_SECONDS;
}

function formatClock(
  seconds
) {
  if (
    !Number.isFinite(
      seconds
    )
  ) {
    return null;
  }

  const neg =
    seconds <
    0;

  const abs =
    Math.abs(
      seconds
    );

  const min =
    Math.floor(
      abs /
      60
    );

  const sec =
    Math.floor(
      abs %
      60
    );

  return `${
    neg
      ? '-'
      : ''
  }${min}:${
    String(
      sec
    ).padStart(
      2,
      '0'
    )
  }`;
}

function compactEpisode(
  e
) {
  return {
    episodeIndex:
      e.episodeIndex,

    episodeId:
      e.episodeId,

    entityIndex:
      e.entityIndex,

    subclassId:
      e.subclassId,

    team:
      e.team,

    startTick:
      e.startTick,

    startClock:
      e.startClock,

    startPosition:
      e.startPosition,

    launchNum:
      e.launchNum,

    timeLaunch:
      e.timeLaunch,

    attackableTime:
      e.attackableTime,

    endAttackableTime:
      e.endAttackableTime,

    source:
      e.source
  };
}

function formatPercent(
  v
) {
  return Number.isFinite(
    v
  )
    ? `${
      (
        v *
        100
      ).toFixed(
        2
      )
    }%`
    : 'n/a';
}

function formatNumber(
  v
) {
  return Number.isFinite(
    v
  )
    ? v.toFixed(
      3
    )
    : 'n/a';
}

function check(
  actual,
  expected,
  pass
) {
  return {
    actual,
    expected,
    pass
  };
}

function finishWriter(
  writer
) {
  return new Promise(
    (
      resolvePromise,
      rejectPromise
    ) => {
      writer.on(
        'error',
        rejectPromise
      );

      writer.end(
        resolvePromise
      );
    }
  );
}