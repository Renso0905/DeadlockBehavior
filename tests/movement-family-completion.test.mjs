import test from 'node:test';
import assert from 'node:assert/strict';

import {
  existsSync,
  readFileSync
} from 'node:fs';

import {
  resolve
} from 'node:path';

const root =
  resolve(
    process.cwd()
  );

const movementIds = [
  'xy_distance',
  'xyz_distance',
  'distance_per_min',
  'distance_per_alive_min',
  'mean_xy_speed',
  'mean_xyz_speed',
  'moving_time',
  'moving_share',
  'low_motion_time',
  'low_motion_share',
  'position_trajectory'
];

const validation =
  JSON.parse(
    readFileSync(
      resolve(
        root,
        'output',
        'cross_replay',
        'movement_family_validation_v01.json'
      ),
      'utf8'
    )
  );

const claims =
  JSON.parse(
    readFileSync(
      resolve(
        root,
        'contracts',
        'claim_registry_v03.json'
      ),
      'utf8'
    )
  );

const contract =
  JSON.parse(
    readFileSync(
      resolve(
        root,
        'contracts',
        'production_metric_registry_v01.json'
      ),
      'utf8'
    )
  );

const modelSource =
  readFileSync(
    resolve(
      root,
      'inspector-v04',
      'lib',
      'replay-model.mjs'
    ),
    'utf8'
  );

const authSource =
  readFileSync(
    resolve(
      root,
      'inspector-v04',
      'public',
      'authoritative.js'
    ),
    'utf8'
  );

const registrySource =
  readFileSync(
    resolve(
      root,
      'inspector-v04',
      'lib',
      'metric-registry.mjs'
    ),
    'utf8'
  );

test(
  'Script 226 complete movement-family evidence passes',
  () => {
    assert.equal(
      validation.version,
      'MOVEMENT_FAMILY_VALIDATION_V01'
    );

    assert.equal(
      validation.validationPass,
      true
    );

    assert.equal(
      validation.aggregate.successfulReplays,
      6
    );

    assert.equal(
      validation.aggregate.playerReplayCount,
      72
    );

    assert.equal(
      validation.calibration.movementPass,
      true
    );

    assert.equal(
      validation.calibration.aliveDenominatorPass,
      true
    );

    assert.equal(
      validation.calibration.mismatchCount,
      0
    );

    assert.equal(
      validation.aggregate.nonpositiveDtTransitions,
      0
    );

    assert.equal(
      validation.aggregate.nonfinitePositionTransitions,
      0
    );

    assert.ok(
      validation.aggregate.maxAcceptedStep3D <=
        2000
    );

    assert.ok(
      validation.aggregate.minRejectedStep3D >
        2000
    );
  }
);

test(
  'movement observation and derived claims are current/pass/pass/cross-replay',
  () => {
    for (
      const claimId
      of [
        'player_movement_observation_substrate_v01',
        'player_movement_derived_metrics_v01'
      ]
    ) {
      const claim =
        claims.claims.find(
          row =>
            row.claimId ===
              claimId
        );

      assert.ok(
        claim,
        `${claimId} missing`
      );

      assert.equal(
        claim.authorityStatus,
        'current'
      );

      assert.equal(
        claim.integrityValidation,
        'pass'
      );

      assert.equal(
        claim.semanticValidation,
        'pass'
      );

      assert.equal(
        claim.replicationStatus,
        'cross_replay_replicated'
      );
    }
  }
);

test(
  'all eleven movement metrics are canonical core A metrics',
  () => {
    assert.equal(
      contract.expectedAuthoritativeMetricCount,
      contract.metrics.length
    );

    for (const id of movementIds) {
      const metric =
        contract.metrics.find(
          row =>
            row.metricId ===
              id
        );

      assert.ok(
        metric,
        `${id} missing from canonical contract`
      );

      assert.equal(
        metric.status,
        'A'
      );

      assert.equal(
        metric.capabilityId,
        'core_state_economy'
      );

      assert.equal(
        metric.producerStageId,
        'core-player-state'
      );

      assert.equal(
        metric.authorityLayer,
        'core'
      );
    }
  }
);

test(
  'movement registry section has no remaining B metrics',
  () => {
    for (const id of movementIds) {
      const line =
        registrySource
          .split(
            /\r?\n/
          )
          .find(
            row =>
              row.includes(
                `m('${id}'`
              )
          );

      assert.ok(
        line,
        `${id} missing from metric registry`
      );

      // Works for either static-status or canonical-derived architecture:
      // the source definition is explicitly updated to A.
      assert.match(
        line,
        /,A,/
      );
    }
  }
);

test(
  'replay model computes movement from raw PlayerState rather than requiring behavioral_metrics_v02',
  () => {
    assert.match(
      modelSource,
      /MAX_ACCEPTED_MOVEMENT_STEP_3D=2000/
    );

    assert.match(
      modelSource,
      /MOVING_SPEED_THRESHOLD_3D=25/
    );

    assert.match(
      modelSource,
      /positionValidForMovement:pawn\.positionValidForMovement===true/
    );

    assert.match(
      modelSource,
      /recordMovementTrajectorySample\(p,state\)/
    );

    assert.match(
      modelSource,
      /accumulateMovementStep\(p,p\.prev,state\)/
    );

    assert.match(
      modelSource,
      /movementAliveSeconds\+=dt/
    );

    assert.match(
      modelSource,
      /xyz>MAX_ACCEPTED_MOVEMENT_STEP_3D/
    );

    assert.match(
      modelSource,
      /speed3D>=MOVING_SPEED_THRESHOLD_3D/
    );

    assert.match(
      modelSource,
      /distancePerAliveMinute:safeDiv/
    );

    assert.doesNotMatch(
      modelSource,
      /const mv=p\.behavioral\?\.movement/
    );
  }
);

test(
  'position trajectory is retained as a raw compact sample series',
  () => {
    assert.match(
      modelSource,
      /trajectory:\[\]/
    );

    assert.match(
      modelSource,
      /p\.movementCore\.trajectory\.push/
    );

    assert.match(
      modelSource,
      /state\.positionValidForMovement===true\?1:0/
    );

    assert.match(
      modelSource,
      /trajectory:movement\.trajectory\?\?\[\]/
    );
  }
);

test(
  'all eleven movement metrics are explicitly wired in Authoritative Stats',
  () => {
    for (const id of movementIds) {
      assert.ok(
        authSource.includes(
          `'${id}'`
        ),
        `${id} missing from AUTH_IDS`
      );

      assert.ok(
        authSource.includes(
          `case '${id}':`
        ),
        `${id} missing from metricValue`
      );
    }

    assert.match(
      authSource,
      /function movementTrajectoryAt/
    );
  }
);

test(
  'movement formulas preserve literal null denominator behavior',
  () => {
    assert.equal(
      validation.operationalContract.zeroDenominator,
      'null'
    );

    assert.equal(
      validation.gates.syntheticZeroDenominatorContract,
      true
    );

    assert.ok(
      validation.aggregate.movementPartitionMaxAbsoluteError <=
        1e-9
    );

    assert.ok(
      validation.aggregate.shareComplementMaxAbsoluteError <=
        1e-12
    );
  }
);
