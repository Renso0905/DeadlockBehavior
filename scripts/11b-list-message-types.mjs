import {
    createReadStream,
    writeFileSync
} from 'node:fs';

import {
    resolve
} from 'node:path';

import {
    Parser,
    InterceptorStage,
    MessagePacketType
} from 'deadem';


const replayName =
    process.argv[2] ?? 'test';

const replayPath =
    resolve(
        'replays',
        `${replayName}.dem`
    );

const outputPath =
    resolve(
        'output',
        replayName,
        'message_type_diagnostic.json'
    );


const parser =
    new Parser();


const counts =
    new Map();

const samples =
    new Map();


// ============================================================
// BUILD REVERSE LOOKUP FROM EXPORTED MessagePacketType
// ============================================================

const exportedTypes =
    Object.entries(
        MessagePacketType
    );


function identifyType(
    value
) {

    for (
        const [
            name,
            exportedValue
        ]
        of exportedTypes
    ) {

        if (
            exportedValue === value
        ) {

            return name;
        }
    }


    return null;
}


// ============================================================
// CAPTURE EVERY UNIQUE MESSAGE TYPE
// ============================================================

parser.registerPostInterceptor(

    InterceptorStage.MESSAGE_PACKET,

    (
        demoPacket,
        messagePacket
    ) => {

        const name =
            identifyType(
                messagePacket.type
            );


        const fallback =
            safeDescribe(
                messagePacket.type
            );


        const key =
            name
            ??
            JSON.stringify(
                fallback
            );


        counts.set(
            key,
            (
                counts.get(key)
                ?? 0
            )
            +
            1
        );


        if (
            !samples.has(key)
        ) {

            samples.set(
                key,
                {
                    resolvedName:
                        name,

                    typeof:
                        typeof messagePacket.type,

                    stringValue:
                        String(
                            messagePacket.type
                        ),

                    representation:
                        fallback,

                    dataKeys:
                        messagePacket.data
                            &&
                            typeof messagePacket.data === 'object'
                                ? Object.keys(
                                    messagePacket.data
                                ).slice(
                                    0,
                                    30
                                )
                                : []
                }
            );
        }
    }
);


// ============================================================
// PARSE
// ============================================================

console.log('');
console.log(
    'Inspecting message packet types...'
);
console.log('');


await parser.parse(
    createReadStream(
        replayPath
    )
);


// ============================================================
// FORMAT
// ============================================================

const result =
    [...counts.entries()]
        .map(
            (
                [
                    key,
                    count
                ]
            ) => ({

                key,

                count,

                sample:
                    samples.get(key)
            })
        )
        .sort(
            (a, b) =>
                b.count -
                a.count
        );


const exportedNames =
    exportedTypes
        .map(
            ([name]) =>
                name
        )
        .filter(
            name =>

                /anim|fire|bullet|gameevent|usercmd|melee/i
                    .test(name)
        );


const output = {

    replay:
        replayName,

    interestingExportedMessageTypes:
        exportedNames,

    observedMessageTypes:
        result
};


writeFileSync(

    outputPath,

    JSON.stringify(
        output,
        null,
        2
    ),

    'utf8'
);


console.log(
    'Interesting exported MessagePacketType names:'
);

console.log('');


for (
    const name
    of exportedNames
) {

    console.log(
        `  ${name}`
    );
}


console.log('');
console.log(
    'Top observed types:'
);
console.log('');


for (
    const row
    of result.slice(
        0,
        50
    )
) {

    console.log(
        `${row.count}  ${row.sample.resolvedName ?? row.key}`
    );
}


console.log('');
console.log(
    `Output:\n${outputPath}`
);
console.log('');


await parser.dispose();


// ============================================================

function safeDescribe(
    value
) {

    if (
        value === null
        ||
        value === undefined
    ) {

        return value;
    }


    if (
        typeof value !==
        'object'
    ) {

        return value;
    }


    const result = {};


    for (
        const key
        of Object.keys(value)
    ) {

        const item =
            value[key];


        if (
            typeof item ===
            'string'
            ||
            typeof item ===
            'number'
            ||
            typeof item ===
            'boolean'
            ||
            item === null
        ) {

            result[key] =
                item;
        }
    }


    result.constructorName =
        value.constructor?.name
        ?? null;


    return result;
}