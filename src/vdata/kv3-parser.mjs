/**
 * Minimal text-KV3 parser helpers used by Deadlock VData discovery scripts.
 *
 * This is intentionally not a full Valve KV3 implementation. It provides the
 * structural operations repeatedly needed by the research scripts while
 * preserving raw strings for semantics that have not been interpreted yet.
 *
 * Regression targets:
 * - Script132 V01: never select a brace from the KV3 metadata header.
 * - Script136 V01: preserve nested arrays/objects so modifier values can be
 *   explicitly validated rather than silently becoming null.
 */

export function extractKv3Root(text) {
    const source = String(text ?? '');
    const headerPresent = /<!--\s*kv3/i.test(source);
    const headerEnd = headerPresent ? source.indexOf('-->') : -1;
    const searchStart = headerPresent && headerEnd >= 0 ? headerEnd + 3 : 0;
    const rootStart = findNextUnquotedCharacter(source, '{', searchStart);
    if (rootStart === null) return null;
    const rootEnd = findMatchingDelimiter(source, rootStart, '{', '}');
    if (rootEnd === null) return null;
    return {
        start: rootStart,
        end: rootEnd,
        inner: source.slice(rootStart + 1, rootEnd)
    };
}

export function parseTopLevelEntries(text) {
    const source = String(text ?? '');
    const rows = [];
    let index = 0;

    while (index < source.length) {
        index = skipWhitespaceAndComments(source, index);
        if (index >= source.length) break;

        const key = readKey(source, index);
        if (!key) {
            index += 1;
            continue;
        }

        index = skipWhitespaceAndComments(source, key.end);
        if (source[index] !== '=') {
            index += 1;
            continue;
        }

        index += 1;
        index = skipWhitespaceAndComments(source, index);
        if (index >= source.length) break;

        // Valve's text KV3 frequently prefixes object values with `subclass:`.
        const subclass = readOptionalSubclassPrefix(source, index);
        if (subclass) index = skipWhitespaceAndComments(source, subclass.end);

        const first = source[index];

        if (first === '{') {
            const close = findMatchingDelimiter(source, index, '{', '}');
            if (close === null) break;
            rows.push({
                key: key.key,
                type: 'object',
                subclass: subclass?.name ?? null,
                inner: source.slice(index + 1, close),
                rawValue: source.slice(index, close + 1)
            });
            index = close + 1;
            continue;
        }

        if (first === '[') {
            const close = findMatchingDelimiter(source, index, '[', ']');
            if (close === null) break;
            rows.push({
                key: key.key,
                type: 'array',
                subclass: subclass?.name ?? null,
                inner: source.slice(index + 1, close),
                rawValue: source.slice(index, close + 1)
            });
            index = close + 1;
            continue;
        }

        const scalar = readScalarUntilLineEnd(source, index);
        rows.push({
            key: key.key,
            type: 'scalar',
            subclass: subclass?.name ?? null,
            rawValue: scalar.value
        });
        index = scalar.end;
    }

    return rows;
}

export function parseFlatScalarMap(text) {
    const output = {};
    for (const row of parseTopLevelEntries(text)) {
        if (row.type !== 'scalar') continue;
        output[row.key] = parseScalar(row.rawValue);
    }
    return output;
}

export function parseScalar(rawValue) {
    if (rawValue === null || rawValue === undefined) return null;
    let raw = String(rawValue).trim();
    if (raw.endsWith(',')) raw = raw.slice(0, -1).trim();

    if (raw === '') return '';
    if (/^true$/i.test(raw)) return true;
    if (/^false$/i.test(raw)) return false;
    if (/^null$/i.test(raw)) return null;

    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) {
        const number = Number(raw);
        if (Number.isFinite(number)) return number;
    }

    if (raw.startsWith('"') && raw.endsWith('"')) {
        try {
            return JSON.parse(raw);
        } catch {
            return raw.slice(1, -1);
        }
    }

    return raw;
}

export function extractNamedObjectField(text, fieldName) {
    const row = parseTopLevelEntries(text).find(
        entry => entry.key === fieldName && entry.type === 'object'
    );
    return row ?? null;
}

export function extractNamedArrayField(text, fieldName) {
    const row = parseTopLevelEntries(text).find(
        entry => entry.key === fieldName && entry.type === 'array'
    );
    return row ?? null;
}

export function extractObjectBodies(text) {
    const source = String(text ?? '');
    const rows = [];
    let index = 0;

    while (index < source.length) {
        const open = findNextUnquotedCharacter(source, '{', index);
        if (open === null) break;
        const close = findMatchingDelimiter(source, open, '{', '}');
        if (close === null) break;
        rows.push(source.slice(open + 1, close));
        index = close + 1;
    }

    return rows;
}

export function parseNumericArray(text) {
    const source = String(text ?? '');
    const values = [];
    let token = '';
    let inQuote = false;
    let escaped = false;

    const flush = () => {
        const trimmed = token.trim();
        token = '';
        if (!trimmed) return;
        const value = parseScalar(trimmed);
        if (Number.isFinite(value)) values.push(value);
    };

    for (let i = 0; i < source.length; i++) {
        const char = source[i];
        if (inQuote) {
            token += char;
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inQuote = false;
            }
            continue;
        }
        if (char === '"') {
            inQuote = true;
            token += char;
            continue;
        }
        if (char === ',' || char === '\n' || char === '\r') {
            flush();
            continue;
        }
        token += char;
    }
    flush();
    return values;
}

export function captureScalarField(text, fieldName) {
    const row = parseTopLevelEntries(text).find(
        entry => entry.key === fieldName && entry.type === 'scalar'
    );
    return row ? parseScalar(row.rawValue) : null;
}

export function containsExactIdentifier(text, identifier) {
    return new RegExp(
        `(?<![A-Za-z0-9_])${escapeRegex(identifier)}(?![A-Za-z0-9_])`
    ).test(String(text ?? ''));
}

export function extractAssignmentFieldNames(text) {
    const output = new Set();
    for (const line of String(text ?? '').split(/\r?\n/)) {
        const match = line.match(/^\s*"?([A-Za-z_][A-Za-z0-9_]*)"?\s*=/);
        if (match) output.add(match[1]);
    }
    return [...output].sort();
}

export function findMatchingDelimiter(text, openIndex, openChar, closeChar) {
    const source = String(text ?? '');
    let depth = 0;
    let inQuote = false;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;

    for (let index = openIndex; index < source.length; index++) {
        const char = source[index];
        const next = source[index + 1];

        if (lineComment) {
            if (char === '\n') lineComment = false;
            continue;
        }
        if (blockComment) {
            if (char === '*' && next === '/') {
                blockComment = false;
                index += 1;
            }
            continue;
        }
        if (inQuote) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inQuote = false;
            }
            continue;
        }
        if (char === '/' && next === '/') {
            lineComment = true;
            index += 1;
            continue;
        }
        if (char === '/' && next === '*') {
            blockComment = true;
            index += 1;
            continue;
        }
        if (char === '"') {
            inQuote = true;
            continue;
        }
        if (char === openChar) depth += 1;
        else if (char === closeChar) {
            depth -= 1;
            if (depth === 0) return index;
        }
    }
    return null;
}

export function findNextUnquotedCharacter(text, target, startIndex = 0) {
    const source = String(text ?? '');
    let inQuote = false;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;

    for (let index = startIndex; index < source.length; index++) {
        const char = source[index];
        const next = source[index + 1];

        if (lineComment) {
            if (char === '\n') lineComment = false;
            continue;
        }
        if (blockComment) {
            if (char === '*' && next === '/') {
                blockComment = false;
                index += 1;
            }
            continue;
        }
        if (inQuote) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inQuote = false;
            continue;
        }
        if (char === '/' && next === '/') {
            lineComment = true;
            index += 1;
            continue;
        }
        if (char === '/' && next === '*') {
            blockComment = true;
            index += 1;
            continue;
        }
        if (char === '"') {
            inQuote = true;
            continue;
        }
        if (char === target) return index;
    }
    return null;
}

function readOptionalSubclassPrefix(text, startIndex) {
    const tail = text.slice(startIndex);
    const match = /^subclass\s*:\s*(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))?\s*/.exec(tail);
    if (!match) return null;
    return {
        name: match[1] ?? match[2] ?? null,
        end: startIndex + match[0].length
    };
}

function readKey(text, startIndex) {
    if (text[startIndex] === '"') {
        let escaped = false;
        for (let i = startIndex + 1; i < text.length; i++) {
            const char = text[i];
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') {
                return {
                    key: text.slice(startIndex + 1, i),
                    end: i + 1
                };
            }
        }
        return null;
    }

    const match = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(text.slice(startIndex));
    if (!match) return null;
    return {
        key: match[0],
        end: startIndex + match[0].length
    };
}

function readScalarUntilLineEnd(text, startIndex) {
    let inQuote = false;
    let escaped = false;
    let index = startIndex;

    for (; index < text.length; index++) {
        const char = text[index];
        if (inQuote) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === '"') inQuote = false;
            continue;
        }
        if (char === '"') {
            inQuote = true;
            continue;
        }
        if (char === '\n' || char === '\r') break;
    }

    return {
        value: text.slice(startIndex, index).trim().replace(/,$/, '').trim(),
        end: index + 1
    };
}

function skipWhitespaceAndComments(text, startIndex) {
    let index = startIndex;
    while (index < text.length) {
        if (/\s/.test(text[index])) {
            index += 1;
            continue;
        }
        if (text[index] === '/' && text[index + 1] === '/') {
            index += 2;
            while (index < text.length && text[index] !== '\n') index += 1;
            continue;
        }
        if (text[index] === '/' && text[index + 1] === '*') {
            const close = text.indexOf('*/', index + 2);
            return close < 0 ? text.length : skipWhitespaceAndComments(text, close + 2);
        }
        break;
    }
    return index;
}

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
