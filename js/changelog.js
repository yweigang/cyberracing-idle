// ─── Changelog ────────────────────────────────────────────────────────────────
// Player-facing release notes, newest first. The first entry's version must
// match GAME_VERSION in data.js; add an entry with every release.

const CHANGELOG = [
  {
    version: '0.5.2',
    date: '2026-10-27',
    title: 'Single-seater licenses',
    changes: [
      'F3 and F2 have their own licenses. F4 titles earn the F3 license, F3 titles the F2 license; endurance racing counts a little too.',
      'Drivers already racing an F3 or F2 car keep their license, and Pro and Factory drivers start with the licenses of their tier.',
      'Driver cards show the progress toward the next GT and the next single-seater license side by side.',
    ],
  },
  {
    version: '0.5.1',
    date: '2026-10-27',
    title: 'Salary counter',
    changes: [
      'The header shows the salaries due at the end of the season. It turns red when your money does not cover them; hover it for the breakdown.',
    ],
  },
  {
    version: '0.5.0',
    date: '2026-10-27',
    title: 'Player feedback round',
    changes: [
      'Drivers are paid a salary every season: Gentleman $2k, Pro $15k, Factory $100k.',
      'Salaries can no longer put the team in debt: unpaid people leave instead. Existing debt has been written off.',
      'Prestige asks first and lists what you keep and lose. No salaries are due in the season you reset.',
      'New 10 PP prestige item, Investor Backing: +$25k starting money after every reset.',
      'Entry fees are priced per class, so every championship pays even from mid-field.',
      'A car that has raced a series before renews its slot at 25% of the fee.',
      'The championship prize pool now pays out down to P10.',
      'Faster classes earn more REP in the same series.',
      'Euro Endurance opens at 2,500 REP, as soon as the LMP3 can be bought.',
      'GT and prototype racing now counts toward the F4 license, and Gentleman drivers start with one.',
      'Paid drivers are guaranteed a minimum pace for their tier. The free scout has a 90 s cooldown.',
      'Sponsor cards show what is paid now and what is held back, with all bonuses, so the totals add up.',
      'Ending a sponsor contract asks first and lets you replace it directly with one of this season\'s offers.',
      'A championship cut short by the season end refunds its entry fee.',
      'The garage shows the current round and which series each car class can race.',
    ],
  },
  {
    version: '0.4.0',
    date: '2026-10-27',
    title: 'Lineups and Balance of Performance',
    changes: [
      'Endurance cars race with 2–3 drivers. Short lineups tire the fittest driver and retire more often.',
      'Every car has a reserve seat. Reserves step in when a race driver leaves.',
      'Balance of Performance: cars of a class are equal. Results come from drivers, the team-wide pit crew and setup knowledge.',
      'Old performance upgrades were refunded as money. Car Preparation (reliability) remains.',
      'Driver XP trains their stats at the end of each season.',
      'Register a car for next season, and seasons end early when nothing is left to race.',
      'Name your team from the header.',
      'Any car can be sold behind a confirmation, as long as the team can still restart.',
      'All series have fictional names.',
      'Fixed: championship cards could show another series\' round after a reload.',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-10-27',
    title: 'Racing simulation',
    changes: [
      'Every round is raced against a full AI field: car, driver and reliability decide the result.',
      'Seasons run on a fixed 60-minute clock.',
      'Drivers earn license points from championship results.',
      'Sponsors set result targets and make fixed offers each season.',
      'Prestige is a full team rebuild that pays PP for titles and podiums.',
      'Team HQ: late-game facilities that pay out PP at the next reset.',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-03-28',
    title: 'Team management',
    changes: [
      'Sponsors, staff (Team Principal and race engineers) and seasons.',
      'Drivers age, peak and retire.',
      'The single-seater pathway (F4 to F1) unlocks with prestige.',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-03-24',
    title: 'First release',
    changes: [
      'Garage with car classes and garage levels, championships and driver scouting.',
    ],
  },
];
