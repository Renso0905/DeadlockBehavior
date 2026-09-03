import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { Parser, Printer } from 'deadem';

// Replay path supplied on the command line
const replayPath = process.argv[2];

if (!replayPath) {
    console.error('No replay supplied.');
    console.error('Usage: node scripts/01-test-parser.mjs replays/test.dem');
    process.exit(1);
}

const absolutePath = resolve(replayPath);

console.log('====================================');
console.log('Deadlock Replay Parser - Test 01');
console.log('====================================');
console.log(`Replay: ${absolutePath}`);
console.log('');

const parser = new Parser();

try {
    // Parse the Deadlock .dem file
    await parser.parse(createReadStream(absolutePath));

    console.log('');
    console.log('SUCCESS: Replay parsed.');
    console.log('');

    // Print parser/replay statistics
    const printer = new Printer(parser);
    printer.printStats();

    // Access the reconstructed Deadlock game state
    const demo = parser.getDemo();

    console.log('');
    console.log('====================================');
    console.log('ENTITY CLASS INFORMATION');
    console.log('====================================');

    const classes = demo.getClasses();

    console.log(`Registered entity classes: ${classes.length}`);

    console.log('');
    console.log('====================================');
    console.log('PLAYER CONTROLLERS');
    console.log('====================================');

    const controllers =
        demo.getEntitiesByClassName('CCitadelPlayerController');

    console.log(`Player controllers found: ${controllers.length}`);
    console.log('');

    for (const controller of controllers) {
        const playerName =
            controller.getField('m_iszPlayerName');

        const netWorth =
            controller.getField('m_iGoldNetWorth');

        console.log({
            entityIndex: controller.index,
            playerName,
            netWorth
        });
    }

    console.log('');
    console.log('====================================');
    console.log('TEST COMPLETE');
    console.log('====================================');

} catch (error) {
    console.error('');
    console.error('====================================');
    console.error('REPLAY PARSING FAILED');
    console.error('====================================');
    console.error(error);

    process.exitCode = 1;

} finally {
    await parser.dispose();
}