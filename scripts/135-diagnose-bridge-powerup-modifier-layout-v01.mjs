import {
    existsSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync
} from 'node:fs';

import {
    tmpdir
} from 'node:os';

import {
    basename,
    join,
    resolve
} from 'node:path';

import {
    spawnSync
} from 'node:child_process';


// ============================================================
// VERSION
// ============================================================

const VERSION =
    'BRIDGE_POWERUP_MODIFIER_LAYOUT_DIAGNOSTIC_V01';


// ============================================================
// PURPOSE
//
// Script134 V01 successfully found:
//
//   gun_powerup_pickup
//   survival_powerup_pickup
//   casting_powerup_pickup
//   movement_powerup_pickup
//
// and successfully resolved:
//
//   modifier classes
//   modifier stat-token names
//   m_flDuration = 160
//   m_flTimeMin = 5
//   m_flTimeMax = 40
//
// But Script134 failed to parse the actual time-scaled modifier
// values because it assumed those values lived in
// m_vecScriptValues.
//
// This script does NOT try another speculative parser.
//
// It prints the exact raw modifier layout from the installed
// game resources.
//
// Questions:
//
//   1. Where are the bridge modifier values actually stored?
//
//   2. Are they scalar fields, vectors, arrays, nested objects,
//      or a dedicated time-scaling structure?
//
//   3. Which values correspond to match-time minimum / maximum?
//
//   4. Is there one scaling pair per MODIFIER_VALUE_* token?
//
// NO REPLAY PARSING.
//
// NO OUTPUT FILE.
//
// This is a temporary diagnostic only.
// ============================================================


// ============================================================
// PATHS
// ============================================================

const SOURCE2VIEWER_PATH =
    resolve(
        'tools',
        'source2viewer',
        'Source2Viewer-CLI.exe'
    );


const RESOURCE_PATH =
    'scripts/misc.vdata_c';


// ============================================================
// TARGETS
// ============================================================

const TARGETS =
    [
        'gun_powerup_pickup',
        'survival_powerup_pickup',
        'casting_powerup_pickup',
        'movement_powerup_pickup'
    ];


// ============================================================
// INTERESTING TERMS
// ============================================================

const INTERESTING_TERMS =
    [
        'm_sModifer',
        'm_sModifier',

        'm_vecScriptValues',

        'm_eModifierValue',

        'MODIFIER_VALUE_',

        'm_value',

        'm_flDuration',
        'm_flTimeMin',
        'm_flTimeMax',

        'm_flBase',
        'm_flPerMinuteAfterStart',

        'Min',
        'Max',
        'Scale',
        'Bonus',
        'Value'
    ];


// ============================================================
// DEADLOCK INSTALL CANDIDATES
// ============================================================

const installCandidates =
    [
        process.env.DEADLOCK_CITADEL_DIR
            ? resolve(
                process.env.DEADLOCK_CITADEL_DIR,
                'pak01_dir.vpk'
            )
            : null,

        'G:\\SteamLibrary\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk',

        'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk',

        'C:\\Program Files\\Steam\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk',

        'D:\\SteamLibrary\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk',

        'E:\\SteamLibrary\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk',

        'F:\\SteamLibrary\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk'
    ]
        .filter(
            Boolean
        );


// ============================================================
// GUARDS
// ============================================================

if (
    !existsSync(
        SOURCE2VIEWER_PATH
    )
) {

    throw new Error(
        `Source2Viewer CLI not found:\n${SOURCE2VIEWER_PATH}`
    );
}


const pakPath =
    installCandidates.find(
        path =>
            existsSync(
                path
            )
    )
    ??
    null;


if (
    !pakPath
) {

    throw new Error(
        [
            'Could not locate Deadlock pak01_dir.vpk.',
            '',
            ...installCandidates.map(
                path =>
                    `  ${path}`
            )
        ].join(
            '\n'
        )
    );
}


// ============================================================
// HEADER
// ============================================================

console.log('');

console.log(
    '========================================================'
);

console.log(
    'BRIDGE POWERUP MODIFIER LAYOUT DIAGNOSTIC V0.1'
);

console.log(
    '========================================================'
);

console.log('');

console.log(
    `Deadlock VPK:    ${pakPath}`
);

console.log(
    `Resource:        ${RESOURCE_PATH}`
);

console.log(
    'Replay parsing:  NONE'
);

console.log(
    'Persistent file: NONE'
);

console.log('');


// ============================================================
// TEMP EXTRACTION
// ============================================================

const temporaryDirectory =
    mkdtempSync(
        join(
            tmpdir(),
            'deadlock-bridge-powerup-layout-'
        )
    );


try {

    const extraction =
        extractSingleResource({
            source2ViewerPath:
                SOURCE2VIEWER_PATH,

            pakPath,

            resourcePath:
                RESOURCE_PATH,

            temporaryDirectory
        });


    if (
        !extraction.success
    ) {

        throw new Error(
            `Failed to extract ${RESOURCE_PATH}`
        );
    }


    console.log(
        `Extracted bytes: ${extraction.bytes}`
    );

    console.log('');


    const text =
        readFileSync(
            extraction.localPath,
            'utf8'
        );


    const root =
        extractKv3Root(
            text
        );


    if (
        !root
    ) {

        throw new Error(
            'Could not locate KV3 document root.'
        );
    }


    const records =
        new Map();


    for (
        const entry
        of parseTopLevelEntries(
            root.inner
        )
    ) {

        if (
            entry.type !==
            'object'
        ) {

            continue;
        }


        records.set(
            entry.key,
            entry.inner
        );
    }


    console.log(
        `Top-level object records: ${records.size}`
    );

    console.log('');


    for (
        const target
        of TARGETS
    ) {

        console.log(
            '========================================================'
        );

        console.log(
            target.toUpperCase()
        );

        console.log(
            '========================================================'
        );

        console.log('');


        const recordText =
            records.get(
                target
            );


        if (
            !recordText
        ) {

            console.log(
                'TARGET RECORD MISSING'
            );

            console.log('');

            continue;
        }


        // ----------------------------------------------------
        // Modifier block
        // ----------------------------------------------------

        const modifierBlock =
            extractNamedObjectField(
                recordText,
                'm_sModifer'
            )
            ??
            extractNamedObjectField(
                recordText,
                'm_sModifier'
            );


        console.log(
            'MODIFIER BLOCK FOUND'
        );

        console.log(
            '--------------------'
        );

        console.log(
            Boolean(
                modifierBlock
            )
        );

        console.log('');


        if (
            modifierBlock
        ) {

            const modifierLines =
                modifierBlock.inner.split(
                    /\r?\n/
                );


            console.log(
                `Modifier block lines: ${modifierLines.length}`
            );

            console.log('');


            console.log(
                'RAW MODIFIER BLOCK'
            );

            console.log(
                '------------------'
            );


            for (
                let index =
                    0;

                index <
                    modifierLines.length;

                index++
            ) {

                console.log(
                    `${String(index + 1).padStart(4)} | ${modifierLines[index]}`
                );
            }


            console.log('');


            // ------------------------------------------------
            // Interesting lines only
            // ------------------------------------------------

            console.log(
                'INTERESTING MODIFIER LINES'
            );

            console.log(
                '--------------------------'
            );


            const interestingModifierLines =
                findInterestingLines(
                    modifierLines,
                    INTERESTING_TERMS,
                    2
                );


            if (
                interestingModifierLines.length ===
                0
            ) {

                console.log(
                    'NONE'
                );

            } else {

                for (
                    const row
                    of interestingModifierLines
                ) {

                    console.log(
                        `${String(row.lineNumber).padStart(4)} | ${row.text}`
                    );
                }
            }


            console.log('');

        } else {

            console.log(
                'No m_sModifer / m_sModifier object could be extracted.'
            );

            console.log('');
        }


        // ----------------------------------------------------
        // Full-record modifier-related lines
        // ----------------------------------------------------

        const recordLines =
            recordText.split(
                /\r?\n/
            );


        console.log(
            'FULL RECORD: MODIFIER / SCALE / VALUE CONTEXT'
        );

        console.log(
            '---------------------------------------------'
        );


        const interestingRecordLines =
            findInterestingLines(
                recordLines,
                INTERESTING_TERMS,
                3
            );


        if (
            interestingRecordLines.length ===
            0
        ) {

            console.log(
                'NONE'
            );

        } else {

            for (
                const row
                of interestingRecordLines
            ) {

                console.log(
                    `${String(row.lineNumber).padStart(4)} | ${row.text}`
                );
            }
        }


        console.log('');


        // ----------------------------------------------------
        // MODIFIER_VALUE occurrences with local context
        // ----------------------------------------------------

        console.log(
            'MODIFIER_VALUE TOKEN CONTEXT'
        );

        console.log(
            '----------------------------'
        );


        const tokenRows =
            findRegexContext(
                recordLines,
                /\bMODIFIER_VALUE_[A-Z0-9_]+\b/,
                6
            );


        if (
            tokenRows.length ===
            0
        ) {

            console.log(
                'NONE'
            );

        } else {

            for (
                const group
                of tokenRows
            ) {

                console.log(
                    `--- occurrence near line ${group.matchLine} ---`
                );


                for (
                    const row
                    of group.lines
                ) {

                    console.log(
                        `${String(row.lineNumber).padStart(4)} | ${row.text}`
                    );
                }


                console.log('');
            }
        }


        // ----------------------------------------------------
        // Structural field names
        // ----------------------------------------------------

        console.log(
            'NESTED FIELD-NAME INVENTORY'
        );

        console.log(
            '---------------------------'
        );


        const fieldNames =
            extractAssignmentFieldNames(
                modifierBlock
                    ? modifierBlock.inner
                    : recordText
            );


        for (
            const fieldName
            of fieldNames
        ) {

            console.log(
                fieldName
            );
        }


        console.log('');
    }


    // ========================================================
    // CROSS-POWERUP SHARED FIELD INVENTORY
    // ========================================================

    console.log(
        '========================================================'
    );

    console.log(
        'CROSS-POWERUP FIELD COMPARISON'
    );

    console.log(
        '========================================================'
    );

    console.log('');


    const fieldPresence =
        new Map();


    for (
        const target
        of TARGETS
    ) {

        const recordText =
            records.get(
                target
            );


        if (
            !recordText
        ) {

            continue;
        }


        const modifierBlock =
            extractNamedObjectField(
                recordText,
                'm_sModifer'
            )
            ??
            extractNamedObjectField(
                recordText,
                'm_sModifier'
            );


        if (
            !modifierBlock
        ) {

            continue;
        }


        for (
            const fieldName
            of extractAssignmentFieldNames(
                modifierBlock.inner
            )
        ) {

            if (
                !fieldPresence.has(
                    fieldName
                )
            ) {

                fieldPresence.set(
                    fieldName,
                    new Set()
                );
            }


            fieldPresence.get(
                fieldName
            ).add(
                target
            );
        }
    }


    const comparisonRows =
        [
            ...fieldPresence.entries()
        ]
            .map(
                ([
                    fieldName,
                    targets
                ]) => ({
                    fieldName,

                    targets:
                        [
                            ...targets
                        ],

                    count:
                        targets.size
                })
            )
            .sort(
                (
                    a,
                    b
                ) =>
                    b.count -
                    a.count
                    ||
                    a.fieldName.localeCompare(
                        b.fieldName
                    )
            );


    for (
        const row
        of comparisonRows
    ) {

        console.log(
            `${row.fieldName.padEnd(52)} ` +
            `${row.count}/4 ` +
            `${row.targets.join(', ')}`
        );
    }


    console.log('');

    console.log(
        '========================================================'
    );

    console.log(
        'FINAL STATUS'
    );

    console.log(
        '========================================================'
    );

    console.log('');

    console.log(
        'BRIDGE_POWERUP_MODIFIER_LAYOUT_PRINTED_FOR_MANUAL_INTERPRETATION'
    );

    console.log('');

    console.log(
        'No persistent output file was created.'
    );

    console.log('');

} finally {

    rmSync(
        temporaryDirectory,
        {
            recursive:
                true,

            force:
                true
        }
    );
}


// ============================================================
// INTERESTING LINE FINDER
// ============================================================

function findInterestingLines(
    lines,
    terms,
    contextRadius
) {

    const indexes =
        new Set();


    for (
        let index =
            0;

        index <
            lines.length;

        index++
    ) {

        const lower =
            lines[
                index
            ].toLowerCase();


        const matches =
            terms.some(
                term =>
                    lower.includes(
                        term.toLowerCase()
                    )
            );


        if (
            !matches
        ) {

            continue;
        }


        const start =
            Math.max(
                0,
                index -
                contextRadius
            );


        const end =
            Math.min(
                lines.length -
                1,
                index +
                contextRadius
            );


        for (
            let contextIndex =
                start;

            contextIndex <=
                end;

            contextIndex++
        ) {

            indexes.add(
                contextIndex
            );
        }
    }


    return [
        ...indexes
    ]
        .sort(
            (
                a,
                b
            ) =>
                a -
                b
        )
        .map(
            index => ({
                lineNumber:
                    index +
                    1,

                text:
                    lines[
                        index
                    ]
            })
        );
}


// ============================================================
// REGEX CONTEXT
// ============================================================

function findRegexContext(
    lines,
    regex,
    radius
) {

    const groups =
        [];


    for (
        let index =
            0;

        index <
            lines.length;

        index++
    ) {

        if (
            !regex.test(
                lines[
                    index
                ]
            )
        ) {

            regex.lastIndex =
                0;

            continue;
        }


        regex.lastIndex =
            0;


        const start =
            Math.max(
                0,
                index -
                radius
            );


        const end =
            Math.min(
                lines.length -
                1,
                index +
                radius
            );


        groups.push(
            {
                matchLine:
                    index +
                    1,

                lines:
                    lines
                        .slice(
                            start,
                            end +
                            1
                        )
                        .map(
                            (
                                text,
                                offset
                            ) => ({
                                lineNumber:
                                    start +
                                    offset +
                                    1,

                                text
                            })
                        )
            }
        );
    }


    return groups;
}


// ============================================================
// FIELD INVENTORY
// ============================================================

function extractAssignmentFieldNames(
    text
) {

    const names =
        new Set();


    for (
        const line
        of text.split(
            /\r?\n/
        )
    ) {

        const match =
            line.match(
                /^\s*"?([A-Za-z_][A-Za-z0-9_]*)"?\s*=/
            );


        if (
            !match
        ) {

            continue;
        }


        names.add(
            match[
                1
            ]
        );
    }


    return [
        ...names
    ].sort();
}


// ============================================================
// NAMED OBJECT
// ============================================================

function extractNamedObjectField(
    text,
    fieldName
) {

    const match =
        new RegExp(
            `${escapeRegex(fieldName)}\\s*=\\s*(?:subclass:\\s*)?\\{`,
            'm'
        ).exec(
            text
        );


    if (
        !match
    ) {

        return null;
    }


    const open =
        text.indexOf(
            '{',
            match.index
        );


    if (
        open <
        0
    ) {

        return null;
    }


    const close =
        findMatchingDelimiter(
            text,
            open,
            '{',
            '}'
        );


    if (
        close ===
        null
    ) {

        return null;
    }


    return {
        inner:
            text.slice(
                open +
                1,
                close
            )
    };
}


// ============================================================
// RESOURCE EXTRACTION
// ============================================================

function extractSingleResource({
    source2ViewerPath,
    pakPath,
    resourcePath,
    temporaryDirectory
}) {

    const safeName =
        resourcePath
            .replace(
                /[\\/:*?"<>|]/g,
                '_'
            )
            .replace(
                /_c$/,
                ''
            );


    const desiredOutput =
        join(
            temporaryDirectory,
            safeName
        );


    const result =
        spawnSync(
            source2ViewerPath,
            [
                '--input',
                pakPath,

                '--vpk_filepath',
                resourcePath,

                '--output',
                desiredOutput,

                '--vpk_decompile'
            ],
            {
                encoding:
                    'utf8',

                windowsHide:
                    true,

                maxBuffer:
                    256 *
                    1024 *
                    1024
            }
        );


    if (
        result.status !==
        0
    ) {

        return {
            success:
                false,

            resourcePath
        };
    }


    let localPath =
        existsSync(
            desiredOutput
        )
            ? desiredOutput
            : null;


    if (
        !localPath
    ) {

        localPath =
            findFileRecursive(
                temporaryDirectory,
                fileName =>
                    fileName
                        .toLowerCase()
                        .includes(
                            basename(
                                safeName
                            ).toLowerCase()
                        )
            );
    }


    if (
        !localPath
        ||
        !existsSync(
            localPath
        )
    ) {

        return {
            success:
                false,

            resourcePath
        };
    }


    const buffer =
        readFileSync(
            localPath
        );


    return {
        success:
            true,

        resourcePath,

        localPath,

        bytes:
            buffer.length
    };
}


// ============================================================
// KV3 ROOT
// ============================================================

function extractKv3Root(
    text
) {

    const headerPresent =
        /<!--\s*kv3/i.test(
            text
        );


    const headerEnd =
        text.indexOf(
            '-->'
        );


    const searchStart =
        (
            headerPresent
            &&
            headerEnd >=
            0
        )
            ? headerEnd +
                3
            : 0;


    const rootStart =
        findNextUnquotedCharacter(
            text,
            '{',
            searchStart
        );


    if (
        rootStart ===
        null
    ) {

        return null;
    }


    const rootEnd =
        findMatchingDelimiter(
            text,
            rootStart,
            '{',
            '}'
        );


    if (
        rootEnd ===
        null
    ) {

        return null;
    }


    return {
        inner:
            text.slice(
                rootStart +
                1,
                rootEnd
            )
    };
}


// ============================================================
// TOP-LEVEL PARSER
// ============================================================

function parseTopLevelEntries(
    text
) {

    const rows =
        [];


    let index =
        0;


    while (
        index <
        text.length
    ) {

        index =
            skipWhitespaceAndComments(
                text,
                index
            );


        if (
            index >=
            text.length
        ) {

            break;
        }


        const key =
            readKey(
                text,
                index
            );


        if (
            !key
        ) {

            index++;

            continue;
        }


        index =
            skipWhitespaceAndComments(
                text,
                key.end
            );


        if (
            text[
                index
            ] !==
            '='
        ) {

            index++;

            continue;
        }


        index++;


        index =
            skipWhitespaceAndComments(
                text,
                index
            );


        if (
            index >=
            text.length
        ) {

            break;
        }


        const first =
            text[
                index
            ];


        if (
            first ===
            '{'
        ) {

            const close =
                findMatchingDelimiter(
                    text,
                    index,
                    '{',
                    '}'
                );


            if (
                close ===
                null
            ) {

                break;
            }


            rows.push(
                {
                    key:
                        key.key,

                    type:
                        'object',

                    inner:
                        text.slice(
                            index +
                            1,
                            close
                        )
                }
            );


            index =
                close +
                1;

            continue;
        }


        if (
            first ===
            '['
        ) {

            const close =
                findMatchingDelimiter(
                    text,
                    index,
                    '[',
                    ']'
                );


            if (
                close ===
                null
            ) {

                break;
            }


            rows.push(
                {
                    key:
                        key.key,

                    type:
                        'array',

                    inner:
                        text.slice(
                            index +
                            1,
                            close
                        )
                }
            );


            index =
                close +
                1;

            continue;
        }


        const scalar =
            readScalarUntilLineEnd(
                text,
                index
            );


        rows.push(
            {
                key:
                    key.key,

                type:
                    'scalar',

                rawValue:
                    scalar.value,

                inner:
                    null
            }
        );


        index =
            scalar.end;
    }


    return rows;
}


// ============================================================
// MATCHING DELIMITER
// ============================================================

function findMatchingDelimiter(
    text,
    openIndex,
    openChar,
    closeChar
) {

    let depth =
        0;


    let inQuote =
        false;


    let escaped =
        false;


    for (
        let index =
            openIndex;

        index <
            text.length;

        index++
    ) {

        const char =
            text[
                index
            ];


        if (
            inQuote
        ) {

            if (
                escaped
            ) {

                escaped =
                    false;

                continue;
            }


            if (
                char ===
                '\\'
            ) {

                escaped =
                    true;

                continue;
            }


            if (
                char ===
                '"'
            ) {

                inQuote =
                    false;
            }


            continue;
        }


        if (
            char ===
            '"'
        ) {

            inQuote =
                true;

            continue;
        }


        if (
            char ===
            openChar
        ) {

            depth++;

        } else if (
            char ===
            closeChar
        ) {

            depth--;


            if (
                depth ===
                0
            ) {

                return index;
            }
        }
    }


    return null;
}


// ============================================================
// FIND NEXT UNQUOTED CHARACTER
// ============================================================

function findNextUnquotedCharacter(
    text,
    target,
    start
) {

    let inQuote =
        false;


    let escaped =
        false;


    for (
        let index =
            start;

        index <
            text.length;

        index++
    ) {

        const char =
            text[
                index
            ];


        if (
            inQuote
        ) {

            if (
                escaped
            ) {

                escaped =
                    false;

                continue;
            }


            if (
                char ===
                '\\'
            ) {

                escaped =
                    true;

                continue;
            }


            if (
                char ===
                '"'
            ) {

                inQuote =
                    false;
            }


            continue;
        }


        if (
            char ===
            '"'
        ) {

            inQuote =
                true;

            continue;
        }


        if (
            char ===
            target
        ) {

            return index;
        }
    }


    return null;
}


// ============================================================
// WHITESPACE
// ============================================================

function skipWhitespaceAndComments(
    text,
    start
) {

    let index =
        start;


    while (
        index <
        text.length
    ) {

        if (
            /\s/.test(
                text[
                    index
                ]
            )
        ) {

            index++;

            continue;
        }


        if (
            text[
                index
            ] ===
            '/'
            &&
            text[
                index +
                1
            ] ===
            '/'
        ) {

            const newline =
                text.indexOf(
                    '\n',
                    index +
                    2
                );


            if (
                newline <
                0
            ) {

                return text.length;
            }


            index =
                newline +
                1;

            continue;
        }


        break;
    }


    return index;
}


// ============================================================
// KEY READER
// ============================================================

function readKey(
    text,
    start
) {

    if (
        start >=
        text.length
    ) {

        return null;
    }


    if (
        text[
            start
        ] ===
        '"'
    ) {

        let index =
            start +
            1;


        let value =
            '';


        let escaped =
            false;


        while (
            index <
            text.length
        ) {

            const char =
                text[
                    index
                ];


            if (
                escaped
            ) {

                value +=
                    char;

                escaped =
                    false;

                index++;

                continue;
            }


            if (
                char ===
                '\\'
            ) {

                escaped =
                    true;

                index++;

                continue;
            }


            if (
                char ===
                '"'
            ) {

                return {
                    key:
                        value,

                    end:
                        index +
                        1
                };
            }


            value +=
                char;

            index++;
        }


        return null;
    }


    const match =
        text
            .slice(
                start
            )
            .match(
                /^([A-Za-z0-9_:.\/\-]+)/
            );


    if (
        !match
    ) {

        return null;
    }


    return {
        key:
            match[
                1
            ],

        end:
            start +
            match[
                1
            ].length
    };
}


// ============================================================
// SCALAR READER
// ============================================================

function readScalarUntilLineEnd(
    text,
    start
) {

    let index =
        start;


    let inQuote =
        false;


    let escaped =
        false;


    while (
        index <
        text.length
    ) {

        const char =
            text[
                index
            ];


        if (
            inQuote
        ) {

            if (
                escaped
            ) {

                escaped =
                    false;

            } else if (
                char ===
                '\\'
            ) {

                escaped =
                    true;

            } else if (
                char ===
                '"'
            ) {

                inQuote =
                    false;
            }


            index++;

            continue;
        }


        if (
            char ===
            '"'
        ) {

            inQuote =
                true;

            index++;

            continue;
        }


        if (
            char ===
            '\n'
            ||
            char ===
            '\r'
        ) {

            break;
        }


        index++;
    }


    return {
        value:
            text
                .slice(
                    start,
                    index
                )
                .trim()
                .replace(
                    /,$/,
                    ''
                )
                .trim(),

        end:
            index +
            1
    };
}


// ============================================================
// REGEX
// ============================================================

function escapeRegex(
    value
) {

    return String(
        value
    ).replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
    );
}


// ============================================================
// FILE SEARCH
// ============================================================

function findFileRecursive(
    directory,
    predicate
) {

    if (
        !existsSync(
            directory
        )
    ) {

        return null;
    }


    for (
        const entry
        of readdirSync(
            directory,
            {
                withFileTypes:
                    true
            }
        )
    ) {

        const path =
            join(
                directory,
                entry.name
            );


        if (
            entry.isDirectory()
        ) {

            const nested =
                findFileRecursive(
                    path,
                    predicate
                );


            if (
                nested
            ) {

                return nested;
            }


            continue;
        }


        if (
            predicate(
                entry.name,
                path
            )
        ) {

            return path;
        }
    }


    return null;
}