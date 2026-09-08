import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  extractKv3Root,
  parseTopLevelEntries
} from '../src/vdata/kv3-parser.mjs';

import {
  extractPrimaryWeaponInfo,
  findHeroPrimaryWeaponBindings
} from '../src/player-state/primary-weapon-resource.mjs';

const VERSION = 'PRIMARY_WEAPON_STATIC_CADENCE_SUBSTRATE_V01';
const SCRIPT131_PATH = resolve('output', 'cross_replay', 'hero_stat_progression_schema_discovery_v01.json');
const SOURCE2VIEWER_PATH = resolve('tools', 'source2viewer', 'Source2Viewer-CLI.exe');
const ABILITIES_RESOURCE = 'scripts/abilities.vdata_c';
const OUTPUT_PATH = resolve('output', 'cross_replay', 'primary_weapon_static_cadence_substrate_v01.json');

const installCandidates = [
  process.env.DEADLOCK_CITADEL_DIR
    ? resolve(process.env.DEADLOCK_CITADEL_DIR, 'pak01_dir.vpk')
    : null,
  'G:\\SteamLibrary\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk',
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk',
  'C:\\Program Files\\Steam\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk',
  'D:\\SteamLibrary\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk',
  'E:\\SteamLibrary\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk',
  'F:\\SteamLibrary\\steamapps\\common\\Deadlock\\game\\citadel\\pak01_dir.vpk'
].filter(Boolean);

for (const path of [SCRIPT131_PATH, SOURCE2VIEWER_PATH]) {
  if (!existsSync(path)) throw new Error(`Missing required input:\n${path}`);
}

const script131 = JSON.parse(readFileSync(SCRIPT131_PATH, 'utf8'));
if (script131?.status !== 'HERO_INTRINSIC_AND_PROGRESSION_STAT_SCHEMA_READY_FOR_INTERPRETATION') {
  throw new Error(`Script131 V01 not ready. Status=${script131?.status}`);
}

const heroBindings = findHeroPrimaryWeaponBindings(script131);
const pakPath = installCandidates.find(path => existsSync(path)) ?? null;
if (!pakPath) throw new Error(`Deadlock pak01_dir.vpk not found.\n${installCandidates.join('\n')}`);

console.log('');
console.log('========================================================');
console.log('PRIMARY WEAPON STATIC CADENCE SUBSTRATE V0.1');
console.log('========================================================');
console.log('');
console.log(`Hero authority:                  Script131 V01 (${heroBindings.length} primary bindings)`);
console.log(`Weapon resource:                 ${ABILITIES_RESOURCE}`);
console.log('Resource policy:                 installed-build fields only');
console.log('Runtime cadence composition:     NONE');
console.log('Fire-rate formula inference:     NONE');
console.log('Authority promotion:             NONE');
console.log('');

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'deadlock-primary-weapon-static-v01-'));

try {
  const desiredOutputPath = join(temporaryDirectory, 'abilities.vdata');
  const extraction = spawnSync(
    SOURCE2VIEWER_PATH,
    [
      '--input', pakPath,
      '--vpk_filepath', ABILITIES_RESOURCE,
      '--output', desiredOutputPath,
      '--vpk_decompile'
    ],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024 }
  );

  if (extraction.status !== 0) {
    throw new Error([
      'Source2Viewer extraction failed.',
      `Exit code: ${extraction.status}`,
      extraction.stdout ?? '',
      extraction.stderr ?? ''
    ].join('\n'));
  }

  const localPath = existsSync(desiredOutputPath)
    ? desiredOutputPath
    : findFileRecursive(temporaryDirectory, name => name.toLowerCase() === 'abilities.vdata');
  if (!localPath) throw new Error('abilities.vdata not found after extraction.');

  const buffer = readFileSync(localPath);
  const text = buffer.toString('utf8');
  const resourceSha256 = createHash('sha256').update(buffer).digest('hex');
  const root = extractKv3Root(text);
  if (!root) throw new Error('Could not locate abilities.vdata KV3 root.');

  const entries = parseTopLevelEntries(root.inner).filter(entry => entry.type === 'object');
  const recordMap = new Map(entries.map(entry => [entry.key, entry.inner]));

  const heroes = [];
  const missingRecords = [];

  for (const binding of heroBindings) {
    const recordText = recordMap.get(binding.primaryWeaponRecordKey) ?? null;
    if (!recordText) {
      missingRecords.push(binding);
      heroes.push({ ...binding, recordResolved: false, weaponInfo: null });
      continue;
    }

    const weaponInfo = extractPrimaryWeaponInfo(recordText);
    heroes.push({ ...binding, recordResolved: true, weaponInfo });
  }

  const resolved = heroes.filter(row => row.recordResolved);
  const cadenceResolved = resolved.filter(row => Number.isFinite(row?.weaponInfo?.fields?.m_flCycleTime));
  const burstCountResolved = resolved.filter(row => Number.isFinite(row?.weaponInfo?.fields?.m_iBurstShotCount));
  const intraBurstResolved = resolved.filter(row => Number.isFinite(row?.weaponInfo?.fields?.m_flIntraBurstCycleTime));
  const clipResolved = resolved.filter(row => Number.isFinite(row?.weaponInfo?.fields?.m_iClipSize));
  const bulletSpeedResolved = resolved.filter(row => Number.isFinite(row?.weaponInfo?.fields?.m_flBulletSpeed));
  const spinFlagResolved = resolved.filter(row => typeof row?.weaponInfo?.fields?.m_bSpinsUp === 'boolean');
  const conflictingRecords = resolved.filter(row => (row?.weaponInfo?.conflictingFields?.length ?? 0) > 0);
  const specialFireRateScaling = heroes.filter(row => (row.fireRateScaling?.length ?? 0) > 0);

  const regimeCounts = countBy(
    resolved,
    row => row?.weaponInfo?.cadenceRegime?.regime ?? 'UNRESOLVED'
  );

  const checks = {
    script131Ready: check(script131.status, 'HERO_INTRINSIC_AND_PROGRESSION_STAT_SCHEMA_READY_FOR_INTERPRETATION', true),
    selectableHeroPrimaryBindings: check(heroBindings.length, 42, heroBindings.length === 42),
    abilitiesRecordsParsed: check(entries.length, '>500', entries.length > 500),
    allPrimaryWeaponRecordsResolved: check(missingRecords.length, 0, missingRecords.length === 0),
    cycleTimeSubstrateObserved: check(cadenceResolved.length, '>0', cadenceResolved.length > 0),
    burstCountSubstrateObserved: check(burstCountResolved.length, '>0', burstCountResolved.length > 0),
    clipSizeSubstrateObserved: check(clipResolved.length, '>0', clipResolved.length > 0),
    bulletSpeedSubstrateObserved: check(bulletSpeedResolved.length, '>0', bulletSpeedResolved.length > 0)
  };

  const integrityPass = Object.values(checks).every(row => row.pass);
  const status = integrityPass
    ? 'PRIMARY_WEAPON_STATIC_CADENCE_SUBSTRATE_V01_READY_FOR_INTERPRETATION'
    : 'PRIMARY_WEAPON_STATIC_CADENCE_SUBSTRATE_V01_REQUIRES_DIAGNOSIS';

  const summary = {
    version: VERSION,
    canonical: false,
    createdAt: new Date().toISOString(),
    status,
    source: {
      method: 'LOCAL_INSTALLED_DEADLOCK_ABILITIES_VDATA',
      pakPath,
      resource: ABILITIES_RESOURCE,
      resourceBytes: buffer.length,
      resourceSha256,
      heroBindingAuthority: SCRIPT131_PATH
    },
    scope: {
      purpose: 'Resolve build-bound primary-weapon static cadence/operation fields before modeling effective runtime cadence.',
      cycleTimeSemantics: 'Static resource candidate only. Runtime effective cadence remains unresolved.',
      intraBurstSemantics: 'Only a separate static candidate for within-burst cadence when burst count exceeds one.',
      fireRateScalingGuardrail: 'Hero-specific EFireRate scaling relationships from Script131 are preserved as confounds and are not composed here.',
      effectiveWeaponAuthorityPromoted: false
    },
    counts: {
      heroBindings: heroBindings.length,
      primaryWeaponRecordsResolved: resolved.length,
      cycleTimeResolved: cadenceResolved.length,
      burstShotCountResolved: burstCountResolved.length,
      intraBurstCycleTimeResolved: intraBurstResolved.length,
      clipSizeResolved: clipResolved.length,
      bulletSpeedResolved: bulletSpeedResolved.length,
      spinFlagResolved: spinFlagResolved.length,
      recordsWithConflictingRepeatedFields: conflictingRecords.length,
      heroesWithSpecialFireRateScaling: specialFireRateScaling.length
    },
    cadenceRegimeCounts: regimeCounts,
    heroesWithSpecialFireRateScaling: specialFireRateScaling.map(row => ({
      heroId: row.heroId,
      displayName: row.displayName,
      primaryWeaponRecordKey: row.primaryWeaponRecordKey,
      fireRateScaling: row.fireRateScaling
    })),
    missingPrimaryWeaponRecords: missingRecords,
    heroes,
    validation: {
      integrityPass,
      semanticValidation: 'RESOURCE_DISCOVERY_ONLY_NOT_YET_RUNTIME_SEMANTIC_VALIDATION',
      replicationStatus: 'BUILD_BOUND_RESOURCE_NOT_REPLAY_REPLICATION',
      checks
    },
    nextStage: integrityPass
      ? 'JOIN_SCRIPT161_DISCHARGES_TO_STATIC_WEAPON_CYCLE_REGIMES_AND_TEST_BASELINE_ALIGNMENT_BEFORE_RETESTING_FIRE_RATE_CONTEXT_RESPONSE'
      : 'DIAGNOSE_PRIMARY_WEAPON_RESOURCE_RESOLUTION_OR_FIELD_COVERAGE'
  };

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(summary, null, 2), 'utf8');

  console.log('========================================================');
  console.log('PRIMARY WEAPON STATIC CADENCE RESULT');
  console.log('========================================================');
  console.log('');
  console.log(`status:                           ${status}`);
  console.log(`hero primary bindings:            ${heroBindings.length}`);
  console.log(`weapon records resolved:          ${resolved.length}/${heroBindings.length}`);
  console.log(`cycle time resolved:              ${cadenceResolved.length}/${resolved.length}`);
  console.log(`burst shot count resolved:        ${burstCountResolved.length}/${resolved.length}`);
  console.log(`intra-burst cycle resolved:       ${intraBurstResolved.length}/${resolved.length}`);
  console.log(`clip size resolved:               ${clipResolved.length}/${resolved.length}`);
  console.log(`bullet speed resolved:            ${bulletSpeedResolved.length}/${resolved.length}`);
  console.log(`special EFireRate scaling heroes: ${specialFireRateScaling.length}`);
  console.log(`static cadence regimes:           ${JSON.stringify(regimeCounts)}`);
  console.log('');
  console.log('INTEGRITY VALIDATION');
  console.log('--------------------');
  for (const [name, row] of Object.entries(checks)) {
    console.log(`${name.padEnd(42)} ${row.pass}  actual=${JSON.stringify(row.actual)} expected=${JSON.stringify(row.expected)}`);
  }
  console.log('');
  console.log(`JSON:\n${OUTPUT_PATH}`);
  console.log('');
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

function findFileRecursive(root, predicate) {
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      const nested = findFileRecursive(path, predicate);
      if (nested) return nested;
    } else if (predicate(name, path)) {
      return path;
    }
  }
  return null;
}

function countBy(rows, selector) {
  const out = {};
  for (const row of rows) {
    const key = selector(row);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function check(actual, expected, pass) {
  return { actual, expected, pass: Boolean(pass) };
}
