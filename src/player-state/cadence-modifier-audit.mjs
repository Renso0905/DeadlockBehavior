const CADENCE_TOKEN_RE = /(?:^|_)(?:FIRE_RATE(?:_SLOW)?|CYCLE_TIME(?:_PERCENTAGE)?|INTRA_BURST_SHOT_CYCLE_TIME_OVERRIDE|BONUS_BURST_SHOT_(?:PERCENT|CONSTANT)|SPIN_UP_(?:RATE_OVERRIDE|DECAY_OVERRIDE|MAX_CYCLE_TIME_OVERRIDE|MAX_BURST_FIRE_COOLDOWN_OVERRIDE))(?:$|_)/i;

export function isCadenceModifierToken(value) {
  return CADENCE_TOKEN_RE.test(String(value ?? ''));
}

export function classifyItemCadenceEvidence(effect) {
  const directCadenceStats = (effect?.meaningfulDirectProvidedStats ?? effect?.directProvidedStats ?? [])
    .filter(row => isCadenceModifierToken(row?.providedPropertyType))
    .map(row => ({
      providedPropertyType: row?.providedPropertyType ?? null,
      numericValue: Number.isFinite(row?.numericValue) ? row.numericValue : null,
      value: row?.value ?? null,
    }));

  const nonDirectCadenceTokens = (effect?.nonDirectModifierTokens ?? [])
    .filter(isCadenceModifierToken)
    .map(String);

  const recordCadenceTokens = (effect?.recordModifierTokens ?? [])
    .filter(isCadenceModifierToken)
    .map(String);

  const oldOperationClassifier = effect?.weaponStateRelevant?.operation?.hasEffectEvidence === true;
  const hasDirectCadenceEvidence = directCadenceStats.length > 0;
  const hasNonDirectCadenceEvidence = nonDirectCadenceTokens.length > 0;
  const hasAnyCadenceEvidence = hasDirectCadenceEvidence || hasNonDirectCadenceEvidence || recordCadenceTokens.length > 0;
  const hiddenFromOldOperationClassifier = hasAnyCadenceEvidence && !oldOperationClassifier;

  return {
    recordKey: effect?.recordKey ?? null,
    hasDirectCadenceEvidence,
    hasNonDirectCadenceEvidence,
    hasAnyCadenceEvidence,
    oldOperationClassifier,
    hiddenFromOldOperationClassifier,
    directCadenceStats,
    nonDirectCadenceTokens,
    recordCadenceTokens,
  };
}

export function buildOwnedCadenceContext(playerState, effectsByKey) {
  const itemEvidence = [];
  const unresolvedOwnedItems = [];

  for (const owned of playerState?.authoritativeOwnership?.standardShopItems ?? []) {
    const recordKey = owned?.recordKey ?? null;
    if (!recordKey) continue;
    const effect = effectsByKey?.get(recordKey) ?? null;
    if (!effect) {
      unresolvedOwnedItems.push(recordKey);
      continue;
    }
    const evidence = classifyItemCadenceEvidence(effect);
    if (!evidence.hasAnyCadenceEvidence) continue;
    itemEvidence.push({
      recordKey,
      itemId: owned?.itemId ?? null,
      ...evidence,
    });
  }

  itemEvidence.sort((a, b) => a.recordKey.localeCompare(b.recordKey));
  unresolvedOwnedItems.sort();

  const directItems = itemEvidence.filter(row => row.hasDirectCadenceEvidence);
  const nonDirectItems = itemEvidence.filter(row => row.hasNonDirectCadenceEvidence);
  const hiddenItems = itemEvidence.filter(row => row.hiddenFromOldOperationClassifier);

  return {
    itemEvidence,
    directItems,
    nonDirectItems,
    hiddenItems,
    unresolvedOwnedItems,
    hasDirectCadenceEvidence: directItems.length > 0,
    hasAnyCadenceEvidence: itemEvidence.length > 0,
    hasHiddenCadenceEvidence: hiddenItems.length > 0,
  };
}

export function summarizeCadenceAuditRows(rows) {
  const total = rows?.length ?? 0;
  const withDirect = (rows ?? []).filter(row => row?.cadenceContext?.hasDirectCadenceEvidence).length;
  const withAny = (rows ?? []).filter(row => row?.cadenceContext?.hasAnyCadenceEvidence).length;
  const withHidden = (rows ?? []).filter(row => row?.cadenceContext?.hasHiddenCadenceEvidence).length;
  const unresolved = (rows ?? []).filter(row => (row?.cadenceContext?.unresolvedOwnedItems?.length ?? 0) > 0).length;
  return {
    total,
    withDirectCadenceEvidence: withDirect,
    withAnyCadenceEvidence: withAny,
    withHiddenCadenceEvidence: withHidden,
    withUnresolvedOwnedItems: unresolved,
    directCadenceEvidenceRate: ratio(withDirect, total),
    anyCadenceEvidenceRate: ratio(withAny, total),
    hiddenCadenceEvidenceRate: ratio(withHidden, total),
  };
}

export function summarizeCatalogCadenceGap(effects) {
  const rows = (effects ?? []).map(classifyItemCadenceEvidence).filter(row => row.hasAnyCadenceEvidence);
  return {
    cadenceItems: rows.length,
    oldOperationClassifierItems: rows.filter(row => row.oldOperationClassifier).length,
    hiddenFromOldOperationClassifierItems: rows.filter(row => row.hiddenFromOldOperationClassifier).length,
    directCadenceItems: rows.filter(row => row.hasDirectCadenceEvidence).length,
    nonDirectCadenceItems: rows.filter(row => row.hasNonDirectCadenceEvidence).length,
    rows,
  };
}

function ratio(a, b) {
  return b > 0 ? a / b : null;
}

export const CADENCE_MODIFIER_TOKEN_REGEX = CADENCE_TOKEN_RE;
