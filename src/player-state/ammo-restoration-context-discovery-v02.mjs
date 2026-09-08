const INTERESTING_KEY =
  /(item|upgrade|effect|ability|modifier|context|owner|shop|ammo|reload|clip|weapon|hero)/i;

export function eventKey(row) {
  return `${Number(row?.heroId)}|${Number(row?.tick)}`;
}

export function mergeCoherentRestorationRows({
  script197Rows,
  script198v03Rows,
}) {
  const coherent =
    script198v03Rows.filter(
      row => row?.coherentGain === true,
    );

  const coherentByKey =
    new Map(
      coherent.map(
        row => [eventKey(row), row],
      ),
    );

  const merged =
    script197Rows
      .filter(
        row =>
          row?.residualClass === 'ATTACK_COUPLED_AMMO_GAIN'
          && coherentByKey.has(eventKey(row)),
      )
      .map(
        row => ({
          ...row,
          ...coherentByKey.get(eventKey(row)),
        }),
      );

  const missing =
    coherent.filter(
      row =>
        !script197Rows.some(
          candidate =>
            candidate?.residualClass === 'ATTACK_COUPLED_AMMO_GAIN'
            && eventKey(candidate) === eventKey(row),
        ),
    );

  return {
    coherentCount: coherent.length,
    mergedCount: merged.length,
    missingCount: missing.length,
    missing,
    merged,
  };
}

export function indexObjectsByScalar(root, wantedScalars) {
  const wanted =
    new Set(
      [...wantedScalars]
        .filter(value => value !== null && value !== undefined)
        .map(String),
    );

  const index =
    new Map(
      [...wanted].map(value => [value, []]),
    );

  const seen = new WeakSet();

  function visit(value, path = '$') {
    if (value === null || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);

    if (!Array.isArray(value)) {
      const scalarValues =
        Object.values(value)
          .filter(
            child =>
              child === null
              || ['string', 'number', 'boolean'].includes(typeof child),
          )
          .map(String);

      for (const target of wanted) {
        if (scalarValues.includes(target)) {
          index.get(target).push({
            path,
            object: value,
          });
        }
      }
    }

    if (Array.isArray(value)) {
      value.forEach(
        (child, i) => visit(child, `${path}[${i}]`),
      );
    } else {
      for (const [key, child] of Object.entries(value)) {
        visit(child, `${path}.${key}`);
      }
    }
  }

  visit(root);
  return index;
}

export function collectInterestingStrings(value) {
  const strings = new Set();
  const seen = new WeakSet();

  function visit(node, key = '') {
    if (node === null || node === undefined) return;

    if (typeof node === 'string') {
      if (
        INTERESTING_KEY.test(key)
        || /(item|modifier|ability|ammo|reload|clip|weapon)/i.test(node)
      ) {
        strings.add(node);
      }
      return;
    }

    if (typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const child of node) visit(child, key);
      return;
    }

    for (const [childKey, child] of Object.entries(node)) {
      visit(child, childKey);
    }
  }

  visit(value);
  return [...strings].sort();
}

export function interestingProjection(
  value,
  {
    maxDepth = 5,
    maxArray = 50,
  } = {},
) {
  function project(node, depth) {
    if (
      node === null
      || ['string', 'number', 'boolean'].includes(typeof node)
    ) {
      return node;
    }

    if (depth > maxDepth || typeof node !== 'object') {
      return '[TRUNCATED]';
    }

    if (Array.isArray(node)) {
      return node
        .slice(0, maxArray)
        .map(child => project(child, depth + 1));
    }

    const result = {};

    for (const [key, child] of Object.entries(node)) {
      if (
        INTERESTING_KEY.test(key)
        || (child !== null && typeof child === 'object')
      ) {
        const projected = project(child, depth + 1);

        if (
          INTERESTING_KEY.test(key)
          || containsInteresting(projected)
        ) {
          result[key] = projected;
        }
      }
    }

    return result;
  }

  return project(value, 0);
}

export function summarizeRestorationContextsV02({
  coherentRows,
  contextMatches,
  rawEventMatches,
}) {
  const byContext = new Map();

  for (const row of coherentRows) {
    const key = String(
      row.effectContextId ?? 'UNKNOWN_CONTEXT',
    );

    if (!byContext.has(key)) {
      byContext.set(key, []);
    }

    byContext.get(key).push(row);
  }

  const contexts =
    [...byContext.entries()]
      .map(([effectContextId, rows]) => {
        const staticMatches =
          contextMatches.get(effectContextId) ?? [];

        const rowKeys =
          new Set(rows.map(eventKey));

        const rawMatches =
          rawEventMatches.filter(
            event => rowKeys.has(eventKey(event)),
          );

        const strings = new Set();

        for (const match of staticMatches) {
          for (
            const string
            of collectInterestingStrings(match.object)
          ) {
            strings.add(string);
          }
        }

        for (const match of rawMatches) {
          for (
            const string
            of collectInterestingStrings(match.raw)
          ) {
            strings.add(string);
          }
        }

        return {
          effectContextId,
          eventCount: rows.length,
          heroes: [...new Set(rows.map(row => String(row.heroId)))],
          ticks: rows.map(row => row.tick),
          netGains: rows.map(row => row.logicalGain),
          grossRestorationCandidates:
            rows.map(row => row.grossRestorationIfOneShotConsumed),
          staticMatchCount: staticMatches.length,
          staticMatchPaths: staticMatches.map(match => match.path),
          rawEventMatchCount: rawMatches.length,
          interestingStrings: [...strings],
          staticProjections:
            staticMatches
              .slice(0, 10)
              .map(match => ({
                path: match.path,
                projection: interestingProjection(match.object),
              })),
          rawEventProjections:
            rawMatches
              .slice(0, 10)
              .map(match => ({
                tick: match.tick,
                heroId: match.heroId,
                projection: interestingProjection(match.raw),
              })),
        };
      })
      .sort(
        (a, b) =>
          b.eventCount - a.eventCount
          || a.effectContextId.localeCompare(b.effectContextId),
      );

  const repeatedContexts =
    contexts.filter(row => row.eventCount >= 2);

  return {
    coherentEventCount: coherentRows.length,
    contextCount: contexts.length,
    repeatedContextCount: repeatedContexts.length,
    contexts,
    repeatedContexts,
    classification:
      repeatedContexts.length > 0
        ? 'REPEATED_RESTORATION_CONTEXTS_AVAILABLE_FOR_ATTRIBUTION_V02'
        : 'RESTORATION_EVENTS_REMAIN_CONTEXT_DISPERSED_V02',
  };
}

function containsInteresting(value) {
  if (value === null || value === undefined) return false;
  if (typeof value !== 'object') return true;
  if (Array.isArray(value)) return value.length > 0;
  return Object.keys(value).length > 0;
}
