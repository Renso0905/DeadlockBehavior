import { murmurHash2 } from '../source2/murmurhash2.mjs';

// Source2's StatViewerModifierValues_t declares m_SourceModifierID as an
// EntitySubclassID_t. Script143 showed that hashing the pickup record key and
// modifier class independently does not reproduce the replay IDs. The runtime
// IDs instead use the compound entity-subclass path:
//
//   <recordKey>/<modifierClass>
//
// Keep this helper separate from world-buff-runtime-source-map.mjs so the
// historical Script143 hypothesis remains reproducible.
export function buildWorldBuffRuntimeSubclassMap(contract) {
  if (contract?.status !== 'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02_READY') {
    throw new Error(`World-buff resource contract is not V02 READY. status=${contract?.status}`);
  }

  const candidates = [];

  for (const family of contract?.permanentPickups?.families ?? []) {
    for (const tierRow of family?.tiers ?? []) {
      if (!tierRow?.found || !tierRow?.recordKey || !tierRow?.modifierClass) continue;
      candidates.push(buildCandidate({
        recordKey: String(tierRow.recordKey),
        modifierClass: String(tierRow.modifierClass),
        buffClass: 'PERMANENT_PICKUP',
        family: family.family ?? null,
        tier: tierRow.tier ?? null,
        effects: Array.isArray(tierRow.effects) ? tierRow.effects : [],
      }));
    }
  }

  for (const powerup of contract?.bridgePowerups?.powerups ?? []) {
    if (!powerup?.found || !powerup?.recordKey || !powerup?.modifierClass) continue;
    candidates.push(buildCandidate({
      recordKey: String(powerup.recordKey),
      modifierClass: String(powerup.modifierClass),
      buffClass: 'BRIDGE_POWERUP',
      family: powerup.recordKey ?? null,
      tier: null,
      effects: Array.isArray(powerup.effects) ? powerup.effects : [],
      durationSeconds: Number.isFinite(powerup.durationSeconds) ? powerup.durationSeconds : null,
    }));
  }

  const byId = new Map();
  const byToken = new Map();

  for (const candidate of candidates) {
    if (!byId.has(candidate.sourceId)) byId.set(candidate.sourceId, []);
    byId.get(candidate.sourceId).push(candidate);
    byToken.set(candidate.token, candidate);
  }

  const collisions = [...byId.entries()]
    .filter(([, rows]) => new Set(rows.map(row => row.token)).size > 1)
    .map(([sourceId, rows]) => ({
      sourceId,
      tokens: [...new Set(rows.map(row => row.token))].sort(),
    }));

  return {
    namespace: 'ENTITY_SUBCLASS_PATH_RECORD_SLASH_MODIFIER',
    candidates,
    permanentCandidates: candidates.filter(row => row.buffClass === 'PERMANENT_PICKUP'),
    bridgeCandidates: candidates.filter(row => row.buffClass === 'BRIDGE_POWERUP'),
    byId,
    byToken,
    collisions,
  };
}

export function summarizeWorldBuffSubclassResolution(sourceId, subclassMap) {
  const rows = subclassMap?.byId?.get(sourceId) ?? [];
  if (rows.length === 0) {
    return {
      matched: false,
      sourceId,
      candidates: [],
      buffClasses: [],
    };
  }

  return {
    matched: true,
    sourceId,
    candidates: rows,
    buffClasses: [...new Set(rows.map(row => row.buffClass))].sort(),
  };
}

function buildCandidate({
  recordKey,
  modifierClass,
  buffClass,
  family,
  tier,
  effects,
  durationSeconds = null,
}) {
  const token = `${recordKey}/${modifierClass}`;
  const normalizedEffects = effects.map(effect => ({
    modifierValue: effect?.modifierValue ?? null,
    value: Number.isFinite(effect?.value) ? effect.value : null,
  }));

  return {
    token,
    tokenKind: 'ENTITY_SUBCLASS_PATH',
    sourceId: murmurHash2(token),
    buffClass,
    family,
    tier,
    recordKey,
    modifierClass,
    effects: normalizedEffects,
    durationSeconds,
  };
}
