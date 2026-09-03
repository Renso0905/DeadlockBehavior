import {
    createReadStream,
    mkdirSync,
    writeFileSync
} from 'node:fs';

import {
    basename,
    extname,
    join,
    resolve
} from 'node:path';

import {
    EntityOperation,
    InterceptorStage,
    Parser
} from 'deadem';

const replayPath = process.argv[2];

if (!replayPath) {
    console.error(
        'Usage: node scripts/02-discover-entities.mjs <path-to-dem>'
    );
    process.exit(1);
}

const absolutePath = resolve(replayPath);

const replayName =
    basename(absolutePath, extname(absolutePath));

const outputDir = resolve('output', replayName);

mkdirSync(outputDir, { recursive: true });

const parser = new Parser();

const classStats = new Map();

let mutationCount = 0;

parser.registerPostInterceptor(
    InterceptorStage.ENTITY_PACKET,
    (demoPacket, messagePacket, events) => {

        for (const event of events) {

            if (
                event.operation !== EntityOperation.CREATE &&
                event.operation !== EntityOperation.UPDATE
            ) {
                continue;
            }

            mutationCount++;

            const entity = event.entity;
            const className = entity.class.name;

            if (!classStats.has(className)) {
                classStats.set(className, {
                    className,
                    entityIndexes: new Set(),
                    createCount: 0,
                    updateCount: 0,
                    fields: new Map(),
                    exampleValues: new Map()
                });
            }

            const stats = classStats.get(className);

            stats.entityIndexes.add(entity.index);

            if (event.operation === EntityOperation.CREATE) {
                stats.createCount++;
            }

            if (event.operation === EntityOperation.UPDATE) {
                stats.updateCount++;
            }

            const changes = event.getChanges();

            for (const [fieldName, value] of Object.entries(changes)) {

                stats.fields.set(
                    fieldName,
                    (stats.fields.get(fieldName) ?? 0) + 1
                );

                if (!stats.exampleValues.has(fieldName)) {
                    stats.exampleValues.set(
                        fieldName,
                        safeValue(value)
                    );
                }
            }
        }
    }
);

console.log(`Parsing ${absolutePath}`);
console.log('Discovering entity classes and fields...\n');

try {

    await parser.parse(createReadStream(absolutePath));

    const catalog = [];

    for (const stats of classStats.values()) {

        const fields = [...stats.fields.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([name, changes]) => ({
                name,
                changes,
                example: stats.exampleValues.get(name)
            }));

        catalog.push({
            className: stats.className,
            uniqueEntities: stats.entityIndexes.size,
            createCount: stats.createCount,
            updateCount: stats.updateCount,
            fields
        });
    }

    catalog.sort(
        (a, b) =>
            b.updateCount - a.updateCount
    );

    const result = {
        replay: replayName,
        totalEntityMutations: mutationCount,
        totalEntityClasses: catalog.length,
        classes: catalog
    };

    const destination =
        join(outputDir, 'entity_catalog.json');

    writeFileSync(
        destination,
        JSON.stringify(result, null, 2),
        'utf8'
    );

    console.log(
        `Found ${catalog.length} entity classes.`
    );

    console.log(
        `Observed ${mutationCount} entity mutations.`
    );

    console.log('\nHighest activity entity classes:\n');

    for (const entry of catalog.slice(0, 30)) {

        console.log(
            `${entry.className.padEnd(45)} ` +
            `entities=${entry.uniqueEntities} ` +
            `updates=${entry.updateCount}`
        );
    }

    console.log(
        `\nFull catalog written to:\n${destination}`
    );

} catch (error) {

    console.error('\nDISCOVERY FAILED\n');
    console.error(error);
    process.exitCode = 1;

} finally {

    await parser.dispose();
}

function safeValue(value) {

    if (value === null || value === undefined) {
        return value;
    }

    if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return value;
    }

    if (typeof value === 'bigint') {
        return value.toString();
    }

    try {
        return JSON.parse(
            JSON.stringify(value, (_, v) =>
                typeof v === 'bigint'
                    ? v.toString()
                    : v
            )
        );
    } catch {
        return String(value);
    }
}
