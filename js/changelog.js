// ─── Changelog ────────────────────────────────────────────────────────────────
// Player-facing release notes, newest first. The first entry's version must
// match GAME_VERSION in data.js; add an entry with every release.

const CHANGELOG = [
  {
    version: '0.8.0',
    date: '2026-10-29',
    title: 'Longer careers, real resets',
    changes: [
      'Drivers now age one year every 6 seasons instead of every season, so careers last days instead of hours and a night away costs about a year. Hover a driver\'s age to see when their next birthday is.',
      'A prestige reset now starts the team over: all drivers, team principals and race engineers leave, a free rookie drives the GT4, and the garage is rebuilt at the size your kept cars need. Championship history stays. The first season after a reset now pays salaries like any other.',
      'Formula World now unlocks once you have earned 500 PP in total. Spending PP in the prestige shop no longer locks it again.',
      'The welcome-back message now shows what salaries and entry fees cost while you were away, and how much your money changed overall.',
      'The F2 Global Series now has 15 rounds, so a car that enters at the start of a season can race it twice.',
      'Sponsor offers now show what is paid right away and what is held back, bonuses included. Signed sponsors show whether their held-back money will be paid at season end or lost.',
      'Every page now updates while you are on it: buttons turn on as soon as you can afford them or have the REP, and season ends, retirements, staff changes and newly opened series show up without switching tabs.',
    ],
  },
  {
    version: '0.7.3',
    date: '2026-10-28',
    title: 'Licenses in order',
    changes: [
      'Licenses are now earned in order: a driver needs F2 before F1, LMP2 before Hypercar and so on. LP toward higher licenses still builds up, and counts as soon as the license below is earned.',
      'Drivers who already hold a license without the ones below it (for example F1 without F2) get the missing ones.',
    ],
  },
  {
    version: '0.7.2',
    date: '2026-10-28',
    title: 'Roster sorting and filters',
    changes: [
      'The driver roster can be sorted by pace, tier, licenses, age, salary or name, and filtered by the class a driver can drive, whether they are in a car, and tier.',
    ],
  },
  {
    version: '0.7.1',
    date: '2026-10-28',
    title: 'Scouting rebalance',
    changes: [
      'Fame no longer lowers scouting costs. Stacked with the Team Principal and Talent Academy it made new drivers far too cheap. Fame still lifts sponsor income and cuts driver salaries.',
    ],
  },
  {
    version: '0.7.0',
    date: '2026-10-28',
    title: 'Fame and a fresh start',
    changes: [
      'Reputation now resets with every prestige, so car classes, series, garage levels, the HQ and sponsor slots have to be earned again in each run.',
      'New prestige shop item, Fan Base: keeps 1% of your REP through every reset, per purchase, up to 10%.',
      'New Fame tiers lift sponsor income and cut driver salaries and scouting costs as your REP grows during a run: Known (25K REP), Famous (75K), Star Team (150K) and Legendary (300K). Your current tier is shown next to REP at the top, with its perks when you hover over it. Fame resets with REP.',
      'Rival fields now top out at +50% after resets (was +60%), with prizes and REP at up to +25%.',
      'Special drivers stand out: a glowing card on the Drivers page and a \u2726 by their name in lineups and driver lists. Drivers with a class strength show their bonus in the garage.',
      'Pricier scouts find special drivers more often.',
      'The scout buttons show the real price after Team Principal, fame and Talent Academy discounts.',
      'The Prestige panel shows half percentages (e.g. +22.5%) instead of rounding them.',
    ],
  },
  {
    version: '0.6.0',
    date: '2026-10-28',
    title: 'Team Principals per program, special drivers',
    changes: [
      'GT & Endurance and Single-Seaters each need their own Team Principal. Their pace and REP bonuses only reach their own program, and seniority sets the top class they can run: Amateurs up to GT3/F4, Regional up to LMP3/F3, National up to LMP2/F2, International everything. Your current principal now runs GT & Endurance.',
      'Team-wide perks (crew and preparation costs, sponsors, scouting) come from whichever principal is best at each.',
      'Driver salaries rise with the class raced: up to 1.5× in GT3/F4, 2× in LMP3/F3, 3× in LMP2/F2, 4× in Hypercar and 5× in F1. The highest class a driver raced or sat in during the season counts.',
      'Special drivers have been added. They are very rare, and each one comes with a quirk.',
    ],
  },
  {
    version: '0.5.9',
    date: '2026-10-28',
    title: 'Tougher rivals and race incidents',
    changes: [
      'Retirements now say why: a mechanical failure, a driver error or being taken out by a rival. Low consistency and wet races make driver errors more likely.',
      'Cars that finish can lose places to a spin, contact with a rival or a slow pit stop. A trained pit crew makes slow stops rarer.',
      'The last result on a championship card names the incident, and hovering over a result in the round strip shows what happened.',
      'Rival fields get 15% stronger with every prestige reset, up to +60% after four resets. Your drivers and the Performance Programme carry over, so titles no longer come for free.',
      'Prizes and REP rise half as fast as the rivals: +7.5% per reset, up to +30%.',
      'The Prestige Reset panel shows how strong the rivals are now and after the next reset.',
    ],
  },
  {
    version: '0.5.8',
    date: '2026-10-28',
    title: 'Licenses in the garage',
    changes: [
      'Each driver in a car lineup shows their highest GT and single-seater license. A license above the class of the car is marked ▲ in amber, so you can spot a driver ready to move up.',
      'The add-driver dropdown lists the top licenses of each candidate too.',
    ],
  },
  {
    version: '0.5.7',
    date: '2026-10-28',
    title: 'Fresh seasons after a reset',
    changes: [
      'A prestige reset now starts the team again at season 1 with a full season clock, salary-free. Before, the old season kept running with nothing booked.',
      'Legend drivers now hold the F1 license, along with every other one. Legends you already signed get it too.',
    ],
  },
  {
    version: '0.5.6',
    date: '2026-10-27',
    title: 'Entry fees before you buy',
    changes: [
      'The Buy Car cards show the entry fee of every series the class races (hover for the renewal fee), and the buy button adds the cheapest one.',
      'Buying a car asks first when the money left would not cover any entry fee for it.',
    ],
  },
  {
    version: '0.5.5',
    date: '2026-10-27',
    title: 'Championship cards and engineers',
    changes: [
      'Each championship card picks your best free car for it, with a dropdown when more than one car fits. Enter or register for next season right on the card; the car selector at the top is gone.',
      'Every race engineer now stays with the team when their car is sold or replaced, Amateurs included. Replacing an engineer no longer costs a buyout: the old one becomes a spare.',
    ],
  },
  {
    version: '0.5.4',
    date: '2026-10-27',
    title: 'Spare engineers',
    changes: [
      'Selling a car, or losing it in a prestige reset, no longer loses its paid race engineer. They become a spare engineer you can assign to another car in the Staff tab. Spares still draw their salary and can be released.',
    ],
  },
  {
    version: '0.5.3',
    date: '2026-10-27',
    title: 'Sponsor PP',
    changes: [
      'PP from sponsor bonuses now count toward your next prestige reset instead of being paid out at once. Teams that have not reset yet keep their PP in that counter.',
      'The Prestige figure in the header also shows the PP the next reset would grant.',
    ],
  },
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
