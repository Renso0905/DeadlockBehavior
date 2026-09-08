import test from 'node:test';
import assert from 'node:assert/strict';

import {
  controllerPawnHandle,
  createAttackTickGuard,
  resolvePawnForHero,
  validEntityHandle,
} from '../src/player-state/slide-carrier-controller-join.mjs';

function entity({
  className,
  fields = {},
  index = 1,
}) {
  return {
    index,
    class: {
      name: className,
    },
    getField(name) {
      return fields[name];
    },
  };
}

test('invalid Source2 entity handles are rejected', () => {
  assert.equal(
    validEntityHandle(undefined),
    false,
  );

  assert.equal(
    validEntityHandle(null),
    false,
  );

  assert.equal(
    validEntityHandle(16777215),
    false,
  );

  assert.equal(
    validEntityHandle(1234),
    true,
  );
});

test('controller prefers m_hHeroPawn and falls back to m_hPawn', () => {
  const heroPawnController =
    entity({
      className:
        'CCitadelPlayerController',
      fields: {
        m_hHeroPawn: 111,
        m_hPawn: 222,
      },
    });

  assert.deepEqual(
    controllerPawnHandle(
      heroPawnController,
    ),
    {
      handle: 111,
      field: 'm_hHeroPawn',
    },
  );

  const fallbackController =
    entity({
      className:
        'CCitadelPlayerController',
      fields: {
        m_hHeroPawn: 16777215,
        m_hPawn: 222,
      },
    });

  assert.deepEqual(
    controllerPawnHandle(
      fallbackController,
    ),
    {
      handle: 222,
      field: 'm_hPawn',
    },
  );
});

test('hero id resolves through controller to pawn handle', () => {
  const pawn =
    entity({
      className:
        'CCitadelPlayerPawn',
      index: 77,
    });

  const controller =
    entity({
      className:
        'CCitadelPlayerController',
      fields: {
        m_nHeroID: 58,
        m_hHeroPawn: 500,
      },
    });

  const demo = {
    getEntityByHandle(handle) {
      assert.equal(handle, 500);
      return pawn;
    },
  };

  const result =
    resolvePawnForHero({
      demo,
      controllers: [
        controller,
      ],
      heroId: 58,
    });

  assert.equal(
    result.pawn,
    pawn,
  );

  assert.equal(
    result.provenance,
    'CONTROLLER_HERO_TO_PAWN_HANDLE',
  );

  assert.equal(
    result.pawnHandleField,
    'm_hHeroPawn',
  );
});

test('ambiguous same-hero controllers are not silently joined', () => {
  const controllers = [
    entity({
      className:
        'CCitadelPlayerController',
      fields: {
        m_nHeroID: 10,
        m_hHeroPawn: 100,
      },
    }),
    entity({
      className:
        'CCitadelPlayerController',
      fields: {
        m_nHeroID: 10,
        m_hHeroPawn: 200,
      },
    }),
  ];

  const result =
    resolvePawnForHero({
      demo: {
        getEntityByHandle() {
          throw new Error(
            'should not resolve',
          );
        },
      },
      controllers,
      heroId: 10,
    });

  assert.equal(
    result.pawn,
    null,
  );

  assert.equal(
    result.provenance,
    'AMBIGUOUS_CONTROLLERS_FOR_HERO',
  );
});

test('attack tick guard permits each target tick exactly once', () => {
  const guard =
    createAttackTickGuard();

  assert.equal(
    guard.shouldProcess(100),
    true,
  );

  assert.equal(
    guard.shouldProcess(100),
    false,
  );

  assert.equal(
    guard.shouldProcess(101),
    true,
  );

  assert.equal(
    guard.processedTickCount,
    2,
  );

  assert.equal(
    guard.duplicateDemoPacketHits,
    1,
  );
});
