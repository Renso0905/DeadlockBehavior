import {
    parseTopLevelEntries,
    parseFlatScalarMap,
    extractNamedObjectField,
    extractAssignmentFieldNames
} from './kv3-parser.mjs';

export function parseAbilityProperties(recordText) {
    const block = extractNamedObjectField(recordText, 'm_mapAbilityProperties');
    if (!block) return [];

    const rows = [];

    for (const entry of parseTopLevelEntries(block.inner)) {
        if (entry.type !== 'object') continue;

        const flat = parseFlatScalarMap(entry.inner);
        const rawValue = firstPresent(flat, [
            'm_strValue',
            'm_strVAlue',
            'm_flValue',
            'm_nValue'
        ]);

        rows.push({
            propertyKey: entry.key,
            providedPropertyType: firstPresent(flat, ['m_eProvidedPropertyType']),
            value: rawValue,
            numericValue: numericIfPlain(rawValue),
            displayUnits: firstPresent(flat, ['m_eDisplayUnits']),
            usageFlags: firstPresent(flat, ['m_eStatsUsageFlags']),
            negativeAttribute: firstPresent(flat, ['m_bIsNegativeAttribute']),
            nestedFieldNames: extractAssignmentFieldNames(entry.inner),
            modifierValueTokens: uniqueMatches(entry.inner, /\bMODIFIER_VALUE_[A-Z0-9_]+\b/g)
        });
    }

    return rows;
}

export function analyzeItemEffectRecord(recordText) {
    const abilityProperties = parseAbilityProperties(recordText);
    const directProvidedStats = abilityProperties.filter(row => row.providedPropertyType !== null);
    const directProvidedTokens = new Set(
        directProvidedStats
            .map(row => row.providedPropertyType)
            .filter(Boolean)
    );

    const recordModifierTokens = uniqueMatches(recordText, /\bMODIFIER_VALUE_[A-Z0-9_]+\b/g);

    // Location-aware separation: remove the actual m_mapAbilityProperties object
    // text, then inspect what remains. This deliberately preserves a token in
    // the non-direct substrate when the SAME token also appears in a direct
    // provided property. V01 incorrectly subtracted by token identity and could
    // therefore hide conditional/passive/active occurrences.
    const abilityPropertiesBlock = extractNamedObjectField(recordText, 'm_mapAbilityProperties');
    const outsideAbilityPropertiesText = abilityPropertiesBlock
        ? removeFirstExact(recordText, abilityPropertiesBlock.rawValue)
        : String(recordText ?? '');
    const nonDirectModifierTokens = uniqueMatches(
        outsideAbilityPropertiesText,
        /\bMODIFIER_VALUE_[A-Z0-9_]+\b/g
    );

    return {
        abilityProperties,
        directProvidedStats,
        directProvidedTokens: [...directProvidedTokens].sort(),
        recordModifierTokens,
        nonDirectModifierTokens,
        nestedModifierClasses: extractNestedModifierClasses(recordText),
        assignmentFieldNames: extractAssignmentFieldNames(recordText)
    };
}

export function extractNestedModifierClasses(recordText) {
    const classes = new Set();

    for (const match of String(recordText ?? '').matchAll(
        /(?:_class|_my_subclass_name)\s*=\s*"([^"]*modifier[^"]*)"/gi
    )) {
        classes.add(match[1]);
    }

    return [...classes].sort();
}

export function numericIfPlain(value) {
    if (Number.isFinite(value)) return value;
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) return null;
    const number = Number(trimmed);
    return Number.isFinite(number) ? number : null;
}

export function isMeaningfulProvidedStat(row) {
    if (!row || row.providedPropertyType == null) return false;

    if (Number.isFinite(row.numericValue)) {
        return Math.abs(row.numericValue) > 1e-12;
    }

    if (row.value == null) return false;
    const raw = String(row.value).trim();
    if (!raw) return false;

    if (/^[+-]?(?:0+(?:\.0*)?|\.0+)(?:\s*(?:%|ms|s|m|hu))?$/i.test(raw)) {
        return false;
    }

    return true;
}

export function uniqueMatches(text, regex) {
    return [...new Set([...String(text ?? '').matchAll(regex)].map(match => match[0]))].sort();
}

function firstPresent(object, keys) {
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(object, key)) return object[key];
    }
    return null;
}

function removeFirstExact(text, fragment) {
    const source = String(text ?? '');
    const needle = String(fragment ?? '');
    if (!needle) return source;
    const index = source.indexOf(needle);
    if (index < 0) return source;
    return source.slice(0, index) + source.slice(index + needle.length);
}
