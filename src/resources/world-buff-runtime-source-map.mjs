import { murmurHash2 } from '../source2/murmurhash2.mjs';

// Build the set of Source2 string-token candidates that can plausibly
// identify the static world-buff resources at runtime. We intentionally
// include BOTH modifier class names and pickup record keys because the
// replay field is named m_SourceModifierID but we do not assume, before
// replay validation, which resource namespace Valve serializes there.
export function buildWorldBuffRuntimeSourceMap(contract) {
  if (contract?.status !== 'WORLD_STAT_BUFF_RESOURCE_CONTRACT_V02_READY') {
    throw new Error(`World-buff resource contract is not V02 READY. status=${contract?.status}`);
  }

  const candidates = [];

  for (const family of contract?.permanentPickups?.families ?? []) {
    for (const tierRow of family?.tiers ?? []) {
      if (!tierRow?.found) continue;

      if (tierRow.modifierClass) {
        candidates.push({
          token: String(tierRow.modifierClass),
          tokenKind: 'MODIFIER_CLASS',
          buffClass: 'PERMANENT_PICKUP',
          family: family.family ?? null,
          tier: tierRow.tier ?? null,
          recordKey: tierRow.recordKey ?? null,
        });
      }

      if (tierRow.recordKey) {
        candidates.push({
          token: String(tierRow.recordKey),
          tokenKind: 'PICKUP_RECORD_KEY',
          buffClass: 'PERMANENT_PICKUP',
          family: family.family ?? null,
          tier: tierRow.tier ?? null,
          recordKey: tierRow.recordKey ?? null,
        });
      }
    }
  }

  for (const powerup of contract?.bridgePowerups?.powerups ?? []) {
    if (!powerup?.found) continue;

    if (powerup.modifierClass) {
      candidates.push({
        token: String(powerup.modifierClass),
        tokenKind: 'MODIFIER_CLASS',
        buffClass: 'BRIDGE_POWERUP',
        family: powerup.recordKey ?? null,
        tier: null,
        recordKey: powerup.recordKey ?? null,
      });
    }

    if (powerup.recordKey) {
      candidates.push({
        token: String(powerup.recordKey),
        tokenKind: 'PICKUP_RECORD_KEY',
        buffClass: 'BRIDGE_POWERUP',
        family: powerup.recordKey ?? null,
        tier: null,
        recordKey: powerup.recordKey ?? null,
      });
    }
  }

  const byId = new Map();
  const byToken = new Map();

  for (const candidate of candidates) {
    const sourceId = murmurHash2(candidate.token);
    const row = { ...candidate, sourceId };

    if (!byId.has(sourceId)) byId.set(sourceId, []);
    byId.get(sourceId).push(row);

    if (!byToken.has(candidate.token)) byToken.set(candidate.token, row);
  }

  const collisions = [...byId.entries()]
    .filter(([, rows]) => new Set(rows.map(row => row.token)).size > 1)
    .map(([sourceId, rows]) => ({
      sourceId,
      tokens: [...new Set(rows.map(row => row.token))].sort(),
    }));

  return {
    candidates,
    byId,
    byToken,
    collisions,
  };
}

export function summarizeWorldBuffSourceResolution(sourceId, sourceMap) {
  const rows = sourceMap?.byId?.get(sourceId) ?? [];
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
