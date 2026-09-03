import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';

import {
  dirname,
  resolve
} from 'node:path';


const replayName =
  process.argv[2] ?? 'test';


const htmlPath =
  resolve(
    'inspector',
    'index.html'
  );


const backupPath =
  resolve(
    'inspector',
    'index_v02_backup.html'
  );


const overlayPath =
  resolve(
    'inspector',
    'data',
    replayName,
    'v03_overlays.json'
  );


const summaryPath =
  resolve(
    'output',
    replayName,
    'inspector_v03_upgrade_validation.json'
  );


const overlayWebPath =
  `./data/${replayName}/v03_overlays.json`;


// ============================================================
// REQUIRED INPUTS
// ============================================================

for (
  const path
  of [
    htmlPath,
    overlayPath
  ]
) {

  if (
    !existsSync(
      path
    )
  ) {

    throw new Error(
      `Missing required input:\n${path}`
    );
  }
}


const overlay =
  JSON.parse(
    readFileSync(
      overlayPath,
      'utf8'
    )
  );


if (
  overlay
    ?.validation
    ?.citemxpFeatureValidationPass
  !==
  true
) {

  throw new Error(
    'v03_overlays.json does not contain a passing CItemXP feature validation.'
  );
}


// ============================================================
// UPGRADE HTML
// ============================================================

let html =
  readFileSync(
    htmlPath,
    'utf8'
  );


const alreadyUpgraded =
  html.includes(
    'CITEMXP_V03_INTERFACE_BEGIN'
  );


let backupCreated =
  false;


let replacementCount =
  0;


if (
  !alreadyUpgraded
) {

  if (
    !existsSync(
      backupPath
    )
  ) {

    copyFileSync(
      htmlPath,
      backupPath
    );

    backupCreated =
      true;
  }


  html =
    replaceRequired(

      html,

      'Deadlock Behavioral Replay Inspector v0.2',

      'Deadlock Behavioral Replay Inspector v0.3',

      'document title'
    );


  html =
    replaceRequired(

      html,

      './data/test/v02_overlays.json',

      overlayWebPath,

      'overlay data path'
    );


  html =
    replaceRequired(

      html,

      '                    v0.2',

      '                    v0.3',

      'visible version badge'
    );


  const injected =
    [

      '',

      '<!-- CITEMXP_V03_INTERFACE_BEGIN -->',

      '<script>',

      `(${citemxpInspectorV03.toString()})(${JSON.stringify(overlayWebPath)});`,

      '</script>',

      '<!-- CITEMXP_V03_INTERFACE_END -->',

      ''
    ]

    .join(
      '\n'
    );


  if (
    !html.includes(
      '</body>'
    )
  ) {

    throw new Error(
      'Could not find </body> in inspector/index.html.'
    );
  }


  html =
    html.replace(

      '</body>',

      `${injected}\n</body>`
    );


  replacementCount++;


  writeFileSync(
    htmlPath,
    html,
    'utf8'
  );
}


// ============================================================
// VALIDATION
// ============================================================

const finalHtml =
  readFileSync(
    htmlPath,
    'utf8'
  );


const checks =
  {

    citemxpOverlayPassed:
      check(

        overlay
          ?.validation
          ?.citemxpFeatureValidationPass,

        true,

        overlay
          ?.validation
          ?.citemxpFeatureValidationPass
        ===
        true
      ),


    overlayEventCountMatches:
      check(

        overlay
          ?.citemxpEvents
          ?.length
        ??
        null,

        overlay
          ?.validation
          ?.expectedCitemxpEventCount
        ??
        null,

        Array.isArray(
          overlay
            ?.citemxpEvents
        )

        &&

        overlay
          .citemxpEvents
          .length
        ===
        overlay
          ?.validation
          ?.expectedCitemxpEventCount
      ),


    htmlLoadsV03Overlay:
      check(

        finalHtml.includes(
          overlayWebPath
        ),

        true,

        finalHtml.includes(
          overlayWebPath
        )
      ),


    oldOverlayPathRemoved:
      check(

        finalHtml.includes(
          './data/test/v02_overlays.json'
        ),

        false,

        !finalHtml.includes(
          './data/test/v02_overlays.json'
        )
      ),


    interfaceMarkerPresent:
      check(

        finalHtml.includes(
          'CITEMXP_V03_INTERFACE_BEGIN'
        ),

        true,

        finalHtml.includes(
          'CITEMXP_V03_INTERFACE_BEGIN'
        )
      ),


    soulPanelCodePresent:
      check(

        finalHtml.includes(
          'recentSoulEvents'
        )

        &&

        finalHtml.includes(
          'soulPlayerTable'
        ),

        true,

        finalHtml.includes(
          'recentSoulEvents'
        )

        &&

        finalHtml.includes(
          'soulPlayerTable'
        )
      ),


    documentVersionUpdated:
      check(

        finalHtml.includes(
          'Replay Inspector v0.3'
        ),

        true,

        finalHtml.includes(
          'Replay Inspector v0.3'
        )
      )
  };


const validationPass =
  Object
    .values(
      checks
    )
    .every(
      row =>
        row.pass
    );


// ============================================================
// SUMMARY
// ============================================================

mkdirSync(
  dirname(
    summaryPath
  ),
  {
    recursive: true
  }
);


const summary =
  {

    replay:
      replayName,

    version:
      'INSPECTOR_CITEMXP_V03_UPGRADE',

    status:
      validationPass
        ? 'INSPECTOR_V03_READY'
        : 'DIAGNOSTIC_ONLY',

    idempotentNoOp:
      alreadyUpgraded,

    backupCreated,

    replacementCount,

    inputs:
      {

        html:
          htmlPath,

        overlayV03:
          overlayPath
      },

    citemxp:
      {

        events:
          overlay
            ?.citemxpEvents
            ?.length
          ??
          null,

        players:
          overlay
            ?.citemxpPlayers
            ?.length
          ??
          null,

        outcomeCounts:
          overlay
            ?.summary
            ?.citemxp
            ?.byOutcome
          ??
          null
      },

    interfaceFeatures:
      [

        'Loads v03_overlays.json.',

        'Adds shot, automatic-award, unresolved, Trooper, and Urn filters.',

        'Adds a recent soul-outcome panel synchronized to replay time.',

        'Adds a player soul-action table with attempts, credit, secure, deny, claim, and race records.',

        'Preserves the original inspector as index_v02_backup.html.'
      ],

    validation:
      {

        pass:
          validationPass,

        checks
      },

    outputs:
      {

        upgradedHtml:
          htmlPath,

        backupHtml:
          existsSync(
            backupPath
          )
            ? backupPath
            : null,

        summary:
          summaryPath
      }
  };


writeFileSync(

  summaryPath,

  JSON.stringify(
    summary,
    null,
    2
  ),

  'utf8'
);


// ============================================================
// CONSOLE OUTPUT
// ============================================================

console.log(
  '\n========================================'
);

console.log(
  'INSPECTOR CITEMXP V0.3 UPGRADE'
);

console.log(
  '========================================'
);


console.log(
  `\nMode: ${
    alreadyUpgraded
      ? 'ALREADY UPGRADED - VALIDATED ONLY'
      : 'UPGRADED'
  }`
);


console.log(
  `Backup created: ${
    backupCreated
      ? 'YES'
      : 'NO'
  }`
);


console.log(
  `CItemXP events: ${
    overlay
      ?.citemxpEvents
      ?.length
    ??
    'n/a'
  }`
);


console.log(
  `CItemXP players: ${
    overlay
      ?.citemxpPlayers
      ?.length
    ??
    'n/a'
  }`
);


console.log(
  '\nVALIDATION'
);


for (
  const [
    key,
    row
  ]
  of Object.entries(
    checks
  )
) {

  console.log(

    `${
      row.pass
        ? 'PASS'
        : 'FAIL'
    }  `

    +

    `${key.padEnd(30)} `

    +

    `actual=${JSON.stringify(row.actual)} `

    +

    `expected=${JSON.stringify(row.expected)}`
  );
}


console.log(
  `\nOVERALL: ${
    validationPass
      ? 'PASS'
      : 'FAIL'
  }`
);


console.log(
  `\nUpgraded inspector:\n${htmlPath}`
);


console.log(
  `\nBackup:\n${backupPath}`
);


console.log(
  `\nSummary:\n${summaryPath}\n`
);


// ============================================================
// SCRIPT HELPERS
// ============================================================

function replaceRequired(
  source,
  before,
  after,
  label
) {

  const occurrences =
    source
      .split(
        before
      )
      .length
    -
    1;


  if (
    occurrences !==
    1
  ) {

    throw new Error(

      `Expected exactly one ${label} marker, found ${occurrences}. `

      +

      'The inspector may already differ from the supplied v0.2 file.'
    );
  }


  replacementCount++;


  return source.replace(
    before,
    after
  );
}


function check(
  actual,
  expected,
  pass
) {

  return {
    actual,
    expected,
    pass
  };
}


// ============================================================
// BROWSER-SIDE CITEMXP INTERFACE
// ============================================================

async function citemxpInspectorV03(
  DATA_PATH
) {

  // ----------------------------------------------------------
  // STYLES
  // ----------------------------------------------------------

  const style =
    document.createElement(
      'style'
    );


  style.textContent =
    `
    .soul-v03-controls {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .soul-v03-status {
      margin: 0 0 10px;
      padding: 8px 10px;
      border: 1px solid #303743;
      border-radius: 7px;
      background: #14171c;
      font-size: 12px;
      line-height: 1.5;
    }

    .soul-v03-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }

    .soul-v03-table th,
    .soul-v03-table td {
      padding: 5px 6px;
      border-bottom: 1px solid #292e37;
      white-space: nowrap;
      text-align: right;
    }

    .soul-v03-table th:first-child,
    .soul-v03-table td:first-child {
      text-align: left;
    }

    .soul-v03-secure {
      color: #82c9ad;
    }

    .soul-v03-deny {
      color: #e39a8d;
    }

    .soul-v03-claim {
      color: #e4c978;
    }

    .soul-v03-auto {
      color: #9fa9b8;
    }

    .soul-v03-unresolved {
      color: #c7a2df;
    }

    .soul-v03-team2 {
      color: #cf806c;
    }

    .soul-v03-team3 {
      color: #73a3d7;
    }

    .soul-v03-panel .events {
      max-height: 360px;
    }
    `;


  document
    .head
    .appendChild(
      style
    );


  // ----------------------------------------------------------
  // LAYOUT
  // ----------------------------------------------------------

  const filters =
    document.querySelector(
      '.filters'
    );


  const side =
    document.querySelector(
      '.side'
    );


  if (
    !filters ||
    !side
  ) {

    throw new Error(
      'Inspector v0.2 layout anchors were not found.'
    );
  }


  const filterGroup =
    document.createElement(
      'div'
    );


  filterGroup.className =
    'filter-group soul-v03-controls';


  filterGroup.innerHTML =
    `
    <strong class="subtle">
      Souls
    </strong>

    <label>
      <input
        id="showSoulShots"
        type="checkbox"
        checked
      >
      Shots
    </label>

    <label>
      <input
        id="showSoulAuto"
        type="checkbox"
      >
      Auto
    </label>

    <label>
      <input
        id="showSoulUnresolved"
        type="checkbox"
        checked
      >
      Unresolved
    </label>

    <label>
      <input
        id="showSoulTrooper"
        type="checkbox"
        checked
      >
      Trooper
    </label>

    <label>
      <input
        id="showSoulUrn"
        type="checkbox"
        checked
      >
      Urn
    </label>
    `;


  filters.appendChild(
    filterGroup
  );


  const outcomePanel =
    document.createElement(
      'section'
    );


  outcomePanel.className =
    'card panel soul-v03-panel';


  outcomePanel.innerHTML =
    `
    <h2>
      Recent soul outcomes
    </h2>

    <div
      id="soulOutcomeStatus"
      class="soul-v03-status"
    >
      Loading soul telemetry...
    </div>

    <div
      id="recentSoulEvents"
      class="events"
    ></div>
    `;


  side.appendChild(
    outcomePanel
  );


  const playerPanel =
    document.createElement(
      'section'
    );


  playerPanel.className =
    'card panel soul-v03-panel';


  playerPanel.innerHTML =
    `
    <h2>
      Player soul actions
    </h2>

    <div
      class="subtle"
      style="margin-bottom:8px"
    >
      A = attempts,
      C = credited first hits,
      S = secures,
      D = denies,
      U = Urn claims.
    </div>

    <div style="overflow-x:auto">

      <table class="soul-v03-table">

        <thead>

          <tr>
            <th>Player</th>
            <th>A</th>
            <th>C</th>
            <th>S</th>
            <th>D</th>
            <th>U</th>
            <th>Race</th>
            <th>Credit</th>
          </tr>

        </thead>

        <tbody id="soulPlayerTable"></tbody>

      </table>

    </div>
    `;


  side.appendChild(
    playerPanel
  );


  // ----------------------------------------------------------
  // LOAD DATA
  // ----------------------------------------------------------

  const response =
    await fetch(
      DATA_PATH
    );


  if (
    !response.ok
  ) {

    throw new Error(
      `Could not load ${DATA_PATH}`
    );
  }


  const soulOverlay =
    await response.json();


  const events =
    Array.isArray(
      soulOverlay.citemxpEvents
    )
      ? soulOverlay.citemxpEvents
      : [];


  const players =
    Array.isArray(
      soulOverlay.citemxpPlayers
    )
      ? soulOverlay.citemxpPlayers
      : [];


  const status =
    document.getElementById(
      'soulOutcomeStatus'
    );


  const eventContainer =
    document.getElementById(
      'recentSoulEvents'
    );


  const playerTable =
    document.getElementById(
      'soulPlayerTable'
    );


  const slider =
    document.getElementById(
      'timeSlider'
    );


  const passed =
    soulOverlay
      ?.validation
      ?.citemxpFeatureValidationPass
    ===
    true;


  const resolved =
    events.filter(
      event =>
        event.resolved
    )
    .length;


  status.innerHTML =
    `
    <span class="${
      passed
        ? 'validation-pass'
        : 'validation-fail'
    }">

      ${
        passed
          ? 'CItemXP PASS'
          : 'CItemXP FAIL'
      }

    </span>

    • ${events.length.toLocaleString()} outcomes

    • ${resolved.toLocaleString()} resolved

    • ${(events.length - resolved).toLocaleString()} unresolved
    `;


  // ----------------------------------------------------------
  // BROWSER HELPERS
  // ----------------------------------------------------------

  function number(
    value
  ) {

    return Number.isFinite(
      Number(value)
    )
      ? Number(value)
      : 0;
  }


  function escape(
    text
  ) {

    return String(
      text ?? ''
    )

    .replaceAll(
      '&',
      '&amp;'
    )

    .replaceAll(
      '<',
      '&lt;'
    )

    .replaceAll(
      '>',
      '&gt;'
    )

    .replaceAll(
      '"',
      '&quot;'
    )

    .replaceAll(
      "'",
      '&#039;'
    );
  }


  function clock(
    seconds
  ) {

    const safe =
      Math.max(
        0,
        number(seconds)
      );


    const minutes =
      Math.floor(
        safe / 60
      );


    const remainder =
      Math.floor(
        safe % 60
      );


    return (
      `${minutes}:`
      +
      String(
        remainder
      )
      .padStart(
        2,
        '0'
      )
    );
  }


  function pretty(
    label
  ) {

    return String(
      label ?? 'UNKNOWN'
    )

    .replaceAll(
      '_',
      ' '
    )

    .replace(
      'AUTO AWARD',
      'AUTO'
    );
  }


  function eventClass(
    label
  ) {

    if (
      label ===
      'SECURE'
    ) {

      return 'soul-v03-secure';
    }


    if (
      label ===
      'DENY'
    ) {

      return 'soul-v03-deny';
    }


    if (
      label ===
      'CLAIM'
    ) {

      return 'soul-v03-claim';
    }


    if (
      String(label)
        .startsWith(
          'AUTO_AWARD'
        )
    ) {

      return 'soul-v03-auto';
    }


    return 'soul-v03-unresolved';
  }


  function visible(
    event
  ) {

    const family =
      event.outcomeFamily;


    if (
      family ===
      'SHOT'

      &&

      !document
        .getElementById(
          'showSoulShots'
        )
        .checked
    ) {

      return false;
    }


    if (
      family ===
      'AUTO_AWARD'

      &&

      !document
        .getElementById(
          'showSoulAuto'
        )
        .checked
    ) {

      return false;
    }


    if (
      !event.resolved

      &&

      !document
        .getElementById(
          'showSoulUnresolved'
        )
        .checked
    ) {

      return false;
    }


    if (
      event.sourceType ===
      'TROOPER_DEATH'

      &&

      !document
        .getElementById(
          'showSoulTrooper'
        )
        .checked
    ) {

      return false;
    }


    if (
      event.sourceType ===
      'URN_DELIVERY'

      &&

      !document
        .getElementById(
          'showSoulUrn'
        )
        .checked
    ) {

      return false;
    }


    return true;
  }


  // ----------------------------------------------------------
  // EVENT PANEL
  // ----------------------------------------------------------

  function renderEvents() {

    const time =
      number(
        slider?.value
      );


    const recent =
      events

        .filter(
          event =>
            number(
              event.timeSeconds
            )
            <=
            time
        )

        .filter(
          visible
        )

        .slice(
          -18
        )

        .reverse();


    if (
      !recent.length
    ) {

      eventContainer.innerHTML =
        `
        <div class="subtle">
          No visible soul outcomes yet.
        </div>
        `;

      return;
    }


    eventContainer.innerHTML =
      recent

        .map(
          event => {

            const actor =
              event.winnerPlayerName

                ? `<strong>${escape(event.winnerPlayerName)}</strong>`

                : (
                  `Team `

                  +

                  `<span class="soul-v03-team${escape(event.winnerTeam)}">`

                  +

                  `${escape(event.winnerTeam ?? '—')}`

                  +

                  `</span>`
                );


            const source =
              event.sourceType ===
              'URN_DELIVERY'

                ? 'Urn'

                : 'Trooper';


            const race =
              event.mixedTeamRace

                ? ' • mixed race'

                : '';


            return `
            <div class="event">

              <span class="event-time">
                ${clock(event.timeSeconds)}
              </span>

              <span class="${eventClass(event.outcomeLabel)}">
                ${escape(pretty(event.outcomeLabel))}
              </span>

              ${actor}

              <div class="subtle">
                ${source}
                • orb team ${escape(event.orbTeam)}
                ${race}
              </div>

            </div>
            `;
          }
        )

        .join('');
  }


  // ----------------------------------------------------------
  // PLAYER TABLE
  // ----------------------------------------------------------

  function renderPlayers() {

    const sorted =
      [...players]

        .sort(
          (a, b) =>

            number(
              b.totalOrbEngagements
            )

            -

            number(
              a.totalOrbEngagements
            )

            ||

            String(
              a.playerName
            )

            .localeCompare(
              String(
                b.playerName
              )
            )
        );


    playerTable.innerHTML =
      sorted

        .map(
          player => {

            const outcomes =
              player.creditedOutcomes
              ??
              {};


            const attempts =
              number(
                player.totalOrbEngagements
              );


            const credit =
              number(
                player.creditedFirstHits
              );


            const rate =
              attempts

                ? `${(
                  credit /
                  attempts *
                  100
                ).toFixed(0)}%`

                : '—';


            const race =
              `${number(player.mixedTeamRaceWins)}-${number(player.mixedTeamRaceLosses)}`;


            return `
            <tr class="${
              player.playerName === 'renso'
                ? 'focus-player'
                : ''
            }">

              <td>
                <span class="soul-v03-team${escape(player.team)}">
                  ${escape(player.playerName)}
                </span>
              </td>

              <td>
                ${attempts}
              </td>

              <td>
                ${credit}
              </td>

              <td class="soul-v03-secure">
                ${number(outcomes.SECURE)}
              </td>

              <td class="soul-v03-deny">
                ${number(outcomes.DENY)}
              </td>

              <td class="soul-v03-claim">
                ${number(outcomes.CLAIM)}
              </td>

              <td>
                ${race}
              </td>

              <td>
                ${rate}
              </td>

            </tr>
            `;
          }
        )

        .join('');
  }


  // ----------------------------------------------------------
  // FILTER EVENTS
  // ----------------------------------------------------------

  for (
    const id
    of [
      'showSoulShots',
      'showSoulAuto',
      'showSoulUnresolved',
      'showSoulTrooper',
      'showSoulUrn'
    ]
  ) {

    document
      .getElementById(
        id
      )
      .addEventListener(
        'change',
        renderEvents
      );
  }


  // The original inspector changes the slider value internally
  // during playback without firing an input event. Poll the
  // value so the soul panel remains synchronized.

  let lastTime =
    null;


  setInterval(
    () => {

      const current =
        number(
          slider?.value
        );


      if (
        current ===
        lastTime
      ) {

        return;
      }


      lastTime =
        current;


      renderEvents();

    },

    250
  );


  renderPlayers();

  renderEvents();
}