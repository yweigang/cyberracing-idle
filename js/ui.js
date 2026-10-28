'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

let _activeTab = 'garage';
let _uiInterval = null;
let _lastNotifCount = 0;
let _signingSlotIndex = null;  // 0–4 or null
let _hiringTP = false;
let _tpCandidates = [];
let _hiringRECarId = null;     // carId being hired for, or null
let _reCandidates = [];
const _champCarChoice = {};    // championship id → car picked on its card
let _confirmingReset = false;

// ─── Tab Navigation ───────────────────────────────────────────────────────────

function switchTab(tabId) {
  _activeTab = tabId;
  // Clear transient state on tab switch
  _hiringTP = false; _tpCandidates = [];
  _hiringRECarId = null; _reCandidates = [];
  _confirmingReset = false;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === 'panel-' + tabId);
  });
  renderActivePanel();
}

function renderActivePanel() {
  switch (_activeTab) {
    case 'garage':        renderGarage(); break;
    case 'championships': renderChampionships(); break;
    case 'drivers':       renderDrivers(); break;
    case 'sponsors':      renderSponsors(); break;
    case 'staff':         renderStaff(); break;
    case 'hq':            renderHQ(); break;
    case 'prestige':      renderPrestige(); break;
  }
}

// ─── Confirmation Dialog ──────────────────────────────────────────────────────

// Modal confirm dialog. body is trusted HTML built by the caller. Esc or a click
// outside cancels; Enter confirms. Without onConfirm it is an info dialog with one
// Close button.
function showConfirmDialog({ title, body, confirmLabel = 'Confirm', danger = false, onConfirm, wide = false }) {
  closeConfirmDialog();
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.id = 'confirm-dialog';
  overlay.innerHTML = `
    <div class="dialog ${wide ? 'dialog-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <div class="dialog-title" id="dialog-title">${title}</div>
      <div class="dialog-body">${body}</div>
      <div class="dialog-actions">
        <button class="btn" id="dialog-cancel">${onConfirm ? 'Cancel' : 'Close'}</button>
        ${onConfirm ? `<button class="btn ${danger ? 'btn-danger' : ''}" id="dialog-confirm">${confirmLabel}</button>` : ''}
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const confirm = () => { closeConfirmDialog(); if (onConfirm) onConfirm(); };
  if (onConfirm) overlay.querySelector('#dialog-confirm').addEventListener('click', confirm);
  overlay.querySelector('#dialog-cancel').addEventListener('click', closeConfirmDialog);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeConfirmDialog(); });
  overlay._onKey = e => {
    if (e.key === 'Escape') closeConfirmDialog();
    else if (e.key === 'Enter') { e.preventDefault(); confirm(); }
  };
  document.addEventListener('keydown', overlay._onKey);
  overlay.querySelector('#dialog-cancel').focus();
}

// ─── Changelog ────────────────────────────────────────────────────────────────

// Compares "0.10.0"-style versions: negative when a is older than b
function _compareVersions(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

// Shows release notes: only the releases newer than sinceVersion, else the whole history
function showChangelog(sinceVersion = null) {
  const entries = sinceVersion
    ? CHANGELOG.filter(e => _compareVersions(e.version, sinceVersion) > 0)
    : CHANGELOG;
  const body = entries.map(e => `
    <div class="changelog-entry">
      <div class="changelog-head"><span class="changelog-version">v${e.version}</span>
        <span class="changelog-title">${e.title}</span><span class="changelog-date">${e.date}</span></div>
      <ul class="dialog-list">${e.changes.map(c => `<li>${c}</li>`).join('')}</ul>
    </div>`).join('');
  showConfirmDialog({ title: sinceVersion ? "What's new" : 'Changelog', body: `<div class="changelog">${body}</div>`, wide: true });
  G.lastSeenVersion = GAME_VERSION;
}

// ─── Update check ─────────────────────────────────────────────────────────────

const UPDATE_CHECK_MS = 5 * 60 * 1000;
let _dismissedBuild = null;

// Build stamp of the running page, from the ?v= tag on its script
function _currentBuild() {
  const script = document.querySelector('script[src*="js/game.js"]');
  const m = script && script.getAttribute('src').match(/[?&]v=(\w+)/);
  return m ? m[1] : null;
}

// Asks the server for the latest build; offers a reload when it is newer than this page
async function checkForUpdate() {
  const current = _currentBuild();
  if (!current) return;
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const { build } = await res.json();
    if (build && build > current && build !== _dismissedBuild) _showUpdateBanner(build);
  } catch (e) { /* offline: try again later */ }
}

function _showUpdateBanner(build) {
  if (document.getElementById('update-banner')) return;
  const bar = document.createElement('div');
  bar.id = 'update-banner';
  bar.className = 'update-banner';
  bar.innerHTML = `<span>A new version of Cyberracing Idle is available. Your progress is saved first.</span>
    <button class="btn" id="update-reload-btn">Reload now</button>
    <button class="btn" id="update-later-btn">Later</button>`;
  document.body.appendChild(bar);
  bar.querySelector('#update-reload-btn').addEventListener('click', () => {
    saveGame();
    // A fresh URL skips any cached copy of the old page
    location.replace(location.pathname + '?v=' + build);
  });
  bar.querySelector('#update-later-btn').addEventListener('click', () => {
    _dismissedBuild = build;
    bar.remove();
  });
}

// After an update, show the notes the player hasn't seen yet once
function _showUnseenChangelog() {
  if (G.lastSeenVersion && _compareVersions(G.lastSeenVersion, GAME_VERSION) >= 0) return;
  // Saves from before the changelog only see the latest release
  showChangelog(G.lastSeenVersion || CHANGELOG[1].version);
}

function closeConfirmDialog() {
  const overlay = document.getElementById('confirm-dialog');
  if (!overlay) return;
  document.removeEventListener('keydown', overlay._onKey);
  overlay.remove();
}

// ─── Currency Bar ─────────────────────────────────────────────────────────────

// Swaps the team name in the HUD for a text field; Enter or leaving the field saves, Esc cancels
function startTeamRename() {
  const wrap = document.getElementById('hud-team-wrap');
  if (wrap.querySelector('input')) return;
  wrap.innerHTML = `<input id="hud-team-input" maxlength="${TEAM_NAME_MAX_LENGTH}" aria-label="Team name">`;
  const input = wrap.querySelector('input');
  input.value = G.teamName || DEFAULT_TEAM_NAME;
  input.focus();
  input.select();
  let done = false;
  const finish = save => {
    if (done) return;
    done = true;
    if (save) {
      const result = renameTeam(input.value);
      if (!result.ok) addNotification(result.msg, 'error');
      else { addNotification(`Team renamed to ${result.name}.`, 'success'); saveGame(); }
    }
    wrap.innerHTML = `<span id="hud-team"></span><button class="hud-rename-btn" id="hud-rename-btn" title="Rename team" aria-label="Rename team">✎</button>`;
    wrap.querySelector('#hud-rename-btn').addEventListener('click', startTeamRename);
    updateCurrencyBar();
    if (_activeTab === 'championships') renderChampionships();
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

// " (+20% sponsors, -10% driver salaries)" for a fame tier, or "" for none
function _famePerks(t) {
  const perks = [t.sponsor && `+${t.sponsor * 100}% sponsors`, t.salary && `-${t.salary * 100}% driver salaries`].filter(Boolean);
  return perks.length ? ` (${perks.join(', ')})` : '';
}

function updateCurrencyBar() {
  const teamEl = document.getElementById('hud-team');
  if (teamEl) teamEl.textContent = G.teamName || DEFAULT_TEAM_NAME;
  document.getElementById('hud-money').textContent = '$' + formatNumber(G.money);
  const fame = getFameTier();
  const nextFame = FAME_TIERS.find(t => t.rep > G.reputation);
  const repEl = document.getElementById('hud-rep');
  repEl.textContent = `${formatNumber(G.reputation)} REP · ${fame.label}`;
  repEl.title = `Fame: ${fame.label}${_famePerks(fame)}`
    + (nextFame ? `\nNext: ${nextFame.label} at ${formatNumber(nextFame.rep)} REP${_famePerks(nextFame)}` : '')
    + '\nREP and fame reset with prestige.';
  _updateSalaryHud();
  const ppNext = calcPrestigePoints();
  const hudPP = document.getElementById('hud-pp');
  hudPP.textContent = G.prestigePoints + ' PP' + (ppNext > 0 ? ` (+${ppNext})` : '');
  hudPP.title = `${G.prestigePoints} PP to spend. The next prestige reset grants +${ppNext} PP`
    + (G.prestige.sponsorPP ? `, ${G.prestige.sponsorPP} of them from sponsors.` : '.');
  const ipsEl = document.getElementById('hud-ips');
  const heldIps = calcSponsorHeldPerSec();
  ipsEl.textContent = '$' + formatNumber(calcTotalIncomePerSec()) + '/s';
  ipsEl.title = `Paid now: $${formatNumber(calcSponsorIncomePerSec())}/s (bonuses included)`
    + (heldIps > 0 ? `\nHeld until targets are met: +$${formatNumber(heldIps)}/s` : '');
  document.getElementById('hud-season-label').textContent = 'Season ' + G.season;
  document.getElementById('hud-season').textContent = formatClock(getSeasonTimeLeft());
}

// Salaries due at season end, red when the money doesn't cover them, with a breakdown on hover
function _updateSalaryHud() {
  const el = document.getElementById('hud-salary');
  const due = getSeasonSalaryTotal();
  const short = due > G.money;
  el.textContent = isSalaryFreeSeason() ? 'none' : '$' + formatNumber(due);
  el.classList.toggle('short', short);
  const rows = getPayroll();
  const sum = kind => rows.filter(r => r.kind === kind).reduce((s, r) => s + r.salary, 0);
  const count = kind => rows.filter(r => r.kind === kind).length;
  const lines = isSalaryFreeSeason()
    ? ['No salaries this season: the team is rebuilding after its reset.']
    : [
        `Paid when the season ends (in ${formatClock(getSeasonTimeLeft())})`,
        sum('tp') ? `Team Principal: $${formatNumber(sum('tp'))}` : '',
        count('re') ? `Race engineers (${count('re')}): $${formatNumber(sum('re'))}` : '',
        count('driver') ? `Drivers (${count('driver')}): $${formatNumber(sum('driver'))}` : '',
        short ? `$${formatNumber(due - G.money)} short: the best-paid people would leave unpaid.` : '',
      ];
  document.getElementById('hud-salary-stat').title = lines.filter(Boolean).join('\n');
}

// ─── Notifications ────────────────────────────────────────────────────────────

function renderNotifications() {
  if (G.notifications.length === _lastNotifCount) return;
  _lastNotifCount = G.notifications.length;

  const container = document.getElementById('notification-feed');
  // show last 5
  const recent = G.notifications.slice(-5).reverse();
  container.innerHTML = recent.map(n => `
    <div class="notif notif-${n.type}">${n.msg}</div>
  `).join('');
}

// ─── Garage Panel ─────────────────────────────────────────────────────────────

// Team-wide pit crew: training level and how many cars it covers
function _renderPitCrew() {
  const crew = G.pitCrew;
  const levelMaxed = crew.level >= PIT_CREW.maxLevel;
  const sizeMaxed = crew.size >= PIT_CREW.maxSize;
  const levelCost = levelMaxed ? 0 : getPitCrewLevelCost();
  const sizeCost = sizeMaxed ? 0 : getPitCrewSizeCost();
  const covered = getCrewCoveredCarIds().map(id => G.cars.find(c => c.id === id).name);
  const sprint = (crew.level * PIT_CREW.sprintPctPerLevel).toFixed(1);
  const endurance = (crew.level * PIT_CREW.endurancePctPerLevel).toFixed(0);
  return `
    <div class="section-header">PIT CREW</div>
    <div class="pit-crew-bar">
      <div class="pit-crew-info">
        <div class="pit-crew-title">Level ${crew.level}/${PIT_CREW.maxLevel} · covers ${crew.size} car${crew.size > 1 ? 's' : ''}</div>
        <div class="pit-crew-sub">+${sprint}% sprint · +${endurance}% endurance rating. Covered: ${covered.join(', ') || '—'}. Other cars get ${Math.round(PIT_CREW.uncoveredShare * 100)}% of the bonus.</div>
        <div class="pit-crew-sub">Cars are balanced (BoP): pace comes from drivers, the crew and setup knowledge.</div>
      </div>
      <div class="pit-crew-actions">
        <button class="btn pit-crew-btn" id="crew-train-btn" ${levelMaxed || G.money < levelCost ? 'disabled' : ''}>
          ${levelMaxed ? 'Fully trained' : `Train — $${formatNumber(levelCost)}`}
        </button>
        <button class="btn pit-crew-btn" id="crew-expand-btn" ${sizeMaxed || G.money < sizeCost ? 'disabled' : ''}>
          ${sizeMaxed ? 'Full size' : `Cover +1 car — $${formatNumber(sizeCost)}`}
        </button>
      </div>
    </div>`;
}

// A driver's highest license in each visible pathway, in pathway order
function _topLicenses(driver) {
  const held = driver.licenses || [];
  const top = {};
  LICENSE_TIERS.forEach(lt => {
    if (held.includes(lt.id) && (lt.pathway === 'gt_endurance' || isSingleSeaterUnlocked())) top[lt.pathway] = lt;
  });
  return Object.values(top);
}

// Top license badges for a seat; a license above the car's class is highlighted
function _renderSeatLicenses(driver, carLicense) {
  const carTier = LICENSE_TIERS.find(lt => lt.id === carLicense);
  return _topLicenses(driver).map(lt => {
    const above = carTier && lt.pathway === carTier.pathway
      && LICENSE_TIERS.indexOf(lt) > LICENSE_TIERS.indexOf(carTier);
    return `<span class="lineup-license ${above ? 'lineup-license-up' : ''}"${above ? ` title="Licensed above ${carTier.name}: could race a higher class"` : ''}>${lt.name}${above ? ' ▲' : ''}</span>`;
  }).join('');
}

// A driver's name, with ✦ for special drivers
const _driverLabel = d => (getSpecialDef(d) ? '✦ ' : '') + d.name;

// Seat rows for a car card: lead, co-drivers, and empty seats with a driver picker
function _renderLineup(car) {
  const lineup = getCarLineup(car);
  const enduranceSize = getMaxLineupForClass(car.classId);
  const raceSeats = getCarLineupSize(car);
  const license = CLASS_LICENSE_REQUIREMENT[car.classId];
  const candidates = G.drivers.filter(d => d.carId !== car.id && (!license || (d.licenses || []).includes(license)));
  // The seats the car's series need, plus one spare seat for a reserve
  const seats = lineup.length ? getCarSeatLimit(car) : enduranceSize;
  let html = '';
  for (let i = 0; i < seats; i++) {
    const d = lineup[i];
    const role = i === 0 ? 'Lead' : i < raceSeats ? 'Co-driver' : 'Reserve';
    if (d) {
      const s = getCareerStage(d.age || 20);
      const special = getSpecialDef(d);
      const boost = special && special.classBoost && special.classBoost.classes.includes(car.classId) ? special.classBoost : null;
      html += `
        <div class="lineup-seat ${i >= raceSeats ? 'lineup-reserve' : ''}">
          <span class="lineup-role">${role}</span>
          <span class="lineup-name ${special ? 'lineup-special' : ''}" ${special ? `title="${special.quirk}"` : ''}>${_driverLabel(d)}</span>
          ${boost ? `<span class="lineup-special-boost">+${Math.round((boost.mult - 1) * 100)}% in ${getCarClassById(car.classId).name}</span>` : ''}
          <span class="lineup-stats">Pace ${d.pace} · Fit ${d.fitness} · <span style="color:${s.color}">${s.label}</span></span>
          <span class="lineup-licenses">${_renderSeatLicenses(d, license)}</span>
          ${i > 0 ? `<button class="btn lineup-btn lineup-lead-btn" data-car="${car.id}" data-driver="${d.id}" title="Make lead driver">▲ Lead</button>` : ''}
          <button class="btn lineup-btn lineup-remove-btn" data-driver="${d.id}" title="Remove from car">✕</button>
        </div>`;
    } else {
      const options = candidates.map(c => {
        const from = c.carId ? G.cars.find(x => x.id === c.carId) : null;
        const top = _topLicenses(c).map(lt => lt.name).join('/');
        return `<option value="${c.id}">${_driverLabel(c)} · Pace ${c.pace}${top ? ' · ' + top : ''}${from ? ' (from ' + from.name + ')' : ''}</option>`;
      }).join('');
      html += `
        <div class="lineup-seat lineup-empty ${i >= raceSeats ? 'lineup-reserve' : ''}">
          <span class="lineup-role">${role}</span>
          ${options
            ? `<select class="lineup-add-select" data-car="${car.id}"><option value="">+ Add driver</option>${options}</select>`
            : `<span class="lineup-none">${i === 0 ? 'No driver' : 'Empty seat'}${license ? ' · needs ' + license + ' license' : ''}</span>`}
        </div>`;
    }
  }
  const missing = getMissingDrivers(car, enduranceSize);
  const note = enduranceSize > 1
    ? (missing > 0
        ? `<div class="lineup-note warn">⚠ Endurance series want ${enduranceSize} drivers. ${missing} short: the fittest driver double-stints tired and the DNF chance rises ${Math.round(SHORT_LINEUP_DNF_PENALTY * missing * 100)}%.</div>`
        : `<div class="lineup-note">Endurance stints are shared by ${enduranceSize} drivers; sprint races use the lead driver.</div>`)
    : '';
  const reserveNote = lineup.length > raceSeats
    ? `<div class="lineup-note">Reserves don't race or earn LP/XP. They step in when a race driver leaves, retires or is released.</div>`
    : '';
  return `<div class="car-lineup">${html}${note}${reserveNote}</div>`;
}

// Asks before selling a car, listing what the sale does
function _confirmSellCar(carId) {
  const car = G.cars.find(c => c.id === carId);
  if (!car) return;
  const value = getCarSellValue(car);
  const entry = car.championshipId && G.activeChampionships.find(e => e.id === car.championshipId);
  const reg = getRegistration(car.id);
  const lineup = getCarLineup(car);
  const re = getREForCar(car.id);
  const points = [
    `You receive <b>$${formatNumber(value)}</b> and free a garage slot.`,
    lineup.length ? `${lineup.map(d => d.name).join(', ')} ${lineup.length > 1 ? 'go' : 'goes'} back to the driver roster.` : '',
    entry ? `<span class="dialog-warn">${car.name} is racing in ${getChampionshipById(entry.definitionId).name}: that championship is abandoned and its entry fee is lost.</span>` : '',
    reg ? `Its registration for ${getChampionshipById(reg.definitionId).name} next season is cancelled and refunded.` : '',
    re ? `Race engineer ${re.name} stays as a spare engineer for another car.` : '',
    G.cars.length === 1 ? `<span class="dialog-warn">This is your last car. You'll need to buy a new one to keep racing.</span>` : '',
  ].filter(Boolean);
  showConfirmDialog({
    title: `Sell ${car.name}?`,
    body: `<ul class="dialog-list">${points.map(p => `<li>${p}</li>`).join('')}</ul>`,
    confirmLabel: `Sell for $${formatNumber(value)}`,
    danger: true,
    onConfirm: () => {
      const result = sellCar(carId);
      if (!result.ok) addNotification(result.msg, 'error');
      renderGarage();
    },
  });
}

// Series a car class can race, with the REP still needed for locked ones
function _classSeriesText(cls) {
  const series = CHAMPIONSHIPS.filter(c => c.allowedClasses.includes(cls.id));
  if (!series.length) return '';
  return 'Races: ' + series.map(c => {
    const fees = `$${formatNumber(getClassEntryFee(c, cls.id))} entry, then $${formatNumber(getRenewalFee(c, cls.id))}/season`;
    return G.reputation >= (c.repRequired || 0)
      ? `<span title="${fees}">${c.shortName} $${formatNumber(getClassEntryFee(c, cls.id))}</span>`
      : `<span class="cls-series-locked" title="${fees}">${c.shortName} (${formatNumber(c.repRequired)} REP)</span>`;
  }).join(' · ');
}

// Cheapest first-entry fee among the series a new car of this class can race now
function _cheapestClassEntry(cls) {
  const open = CHAMPIONSHIPS.filter(c => c.allowedClasses.includes(cls.id) && G.reputation >= (c.repRequired || 0));
  if (!open.length) return null;
  return open.map(c => ({ champ: c, fee: getClassEntryFee(c, cls.id) })).sort((a, b) => a.fee - b.fee)[0];
}

// Buys a car, asking first when the money left would not pay any entry fee for it
function _buyCarChecked(classId) {
  const cls = getCarClassById(classId);
  const entry = _cheapestClassEntry(cls);
  const left = G.money - cls.baseCost;
  const buy = () => {
    const result = buyCar(classId);
    if (!result.ok) addNotification(result.msg, 'error');
    renderGarage();
  };
  if (!entry || left >= entry.fee) return buy();
  showConfirmDialog({
    title: `Buy a ${cls.name}?`,
    body: `After buying it you'd have <b>$${formatNumber(left)}</b>. The cheapest series for it, ${entry.champ.name},
      costs <b>$${formatNumber(entry.fee)}</b> to enter (renewals $${formatNumber(getRenewalFee(entry.champ, cls.id))}/season),
      so the car can't race until you've earned <b>$${formatNumber(entry.fee - left)}</b> more.`,
    confirmLabel: 'Buy anyway',
    onConfirm: buy,
  });
}

function renderGarage() {
  const container = document.getElementById('panel-garage');

  // ── Garage upgrade section
  const totalSlots  = getGarageSlots(G.garageLevel);
  const usedSlots   = G.cars.length;
  const nextUpgrade = getGarageNextUpgrade(G.garageLevel);
  const isMaxed     = G.garageLevel >= GARAGE_MAX_LEVEL;
  const canUpgrade  = !isMaxed &&
                      G.money >= nextUpgrade.cost &&
                      G.reputation >= nextUpgrade.repRequired;

  let garageHtml = `
    <div class="section-header">GARAGE</div>
    <div class="garage-upgrade-bar">
      <div class="garage-slots-display">
        <span class="garage-label">Slots</span>
        <span class="garage-used" id="garage-slots-used">${usedSlots} / ${totalSlots}</span>
        <div class="garage-slot-pips">${
          Array.from({ length: totalSlots }, (_, i) =>
            `<div class="slot-pip ${i < usedSlots ? 'used' : ''}"></div>`
          ).join('')
        }</div>
      </div>
      ${isMaxed
        ? `<div class="garage-maxed">Max garage level reached (${totalSlots} slots)</div>`
        : `<div class="garage-next-info">
            <span>Level ${G.garageLevel + 1} → ${nextUpgrade.slots} slots</span>
            ${nextUpgrade.repRequired > 0 ? `<span class="garage-rep-req ${G.reputation >= nextUpgrade.repRequired ? '' : 'unmet'}">${formatNumber(nextUpgrade.repRequired)} REP</span>` : ''}
           </div>
           <button class="btn garage-upgrade-btn ${canUpgrade ? '' : 'disabled'}" id="garage-upgrade-btn" ${canUpgrade ? '' : 'disabled'}>
             Expand — $${formatNumber(nextUpgrade.cost)}
           </button>`
      }
    </div>`;

  // ── Buy car section
  let buyCarsHtml = '<div class="section-header">BUY CAR</div><div class="buy-cars-grid">';
  CAR_CLASSES.forEach(cls => {
    if (cls.pathway === 'single_seater' && !isSingleSeaterUnlocked()) return;
    const owned      = G.cars.filter(c => c.classId === cls.id).length;
    const repOk      = G.reputation >= cls.repRequired;
    const ppOk       = cls.ppRequired === 0 || G.prestigePoints >= cls.ppRequired;
    const moneyOk    = G.money >= cls.baseCost;
    const classSlotOk  = owned < cls.maxOwned;
    const garageSlotOk = usedSlots < totalSlots;
    const canBuy     = repOk && ppOk && moneyOk && classSlotOk && garageSlotOk;
    const locked     = !repOk || !ppOk;
    const cheapest   = _cheapestClassEntry(cls);

    let lockMsg = '';
    if (!repOk)          lockMsg = `Requires ${formatNumber(cls.repRequired)} REP`;
    else if (!ppOk)      lockMsg = `Requires ${cls.ppRequired} PP`;
    else if (!garageSlotOk) lockMsg = 'Garage full: expand it or sell a car';
    else if (!classSlotOk)  lockMsg = `Max ${cls.maxOwned} owned`;

    buyCarsHtml += `
      <div class="buy-car-card ${locked ? 'locked' : ''}" style="--cls-color: ${cls.color}">
        <div class="cls-tier">Tier ${cls.tier}</div>
        <div class="cls-name" style="color: ${cls.color}">${cls.name}</div>
        <div class="cls-owned" data-live-owned="${cls.id}">${owned}/${cls.maxOwned}</div>
        ${lockMsg ? `<div class="cls-lock">${lockMsg}</div>` : ''}
        <div class="cls-series">${_classSeriesText(cls)}</div>
        <button class="btn buy-car-btn ${canBuy ? '' : 'disabled'}"
          data-class="${cls.id}" ${canBuy ? '' : 'disabled'}>
          $${formatNumber(cls.baseCost)}${cheapest ? ` <span class="buy-car-entry">+ $${formatNumber(cheapest.fee)} entry</span>` : ''}
        </button>
      </div>`;
  });
  buyCarsHtml += '</div>';

  // ── Cars list
  let carsHtml = '<div class="section-header">YOUR CARS</div><div class="cars-list">';
  if (G.cars.length === 0) {
    carsHtml += '<div class="empty-state">No cars yet. Buy one above.</div>';
  } else {
    G.cars.forEach(car => {
      const cls = getCarClassById(car.classId);
      const driver = car.driverId ? G.drivers.find(d => d.id === car.driverId) : null;
      const activeChamp = car.championshipId
        ? G.activeChampionships.find(c => c.id === car.championshipId) : null;
      const champDef = activeChamp ? getChampionshipById(activeChamp.definitionId) : null;

      // RE mini-bar for this car
      const re = getREForCar(car.id);
      const reTierDef = re ? RE_TIERS[re.tier] : null;
      const reHtml = `
        <div class="car-re-bar">
          <span class="car-re-label">RE</span>
          ${re
            ? `<span class="car-re-name" style="color:${reTierDef.color}">${re.name}</span>
               <span class="car-re-tier" style="color:${reTierDef.color}">${reTierDef.label}</span>
               <span class="car-re-primary">${RE_STAT_LABELS[re.primaryStat] || re.primaryStat} ${re[re.primaryStat]}</span>`
            : `<span class="car-re-empty">No engineer</span>`
          }
          <button class="btn car-re-btn" data-car="${car.id}">${re ? 'Change' : 'Hire RE'}</button>
        </div>`;

      // Upgrades
      let upgradesHtml = '';
      UPGRADE_ORDER.forEach(upgId => {
        const upg = UPGRADES[upgId];
        const lvl = car.upgrades[upgId];
        const cost = getEffectiveUpgradeCost(upgId, lvl, car.classId);
        const maxed = lvl >= upg.maxLevel;
        const canAfford = G.money >= cost && !maxed;
        const progress = (lvl / upg.maxLevel) * 100;

        upgradesHtml += `
          <div class="upgrade-row">
            <div class="upg-info">
              <span class="upg-icon">${upg.icon}</span>
              <span class="upg-name">${upg.name}</span>
              <span class="upg-level">Lv ${lvl}/${upg.maxLevel}</span>
            </div>
            <div class="upg-bar-wrap">
              <div class="upg-bar" style="width: ${progress}%"></div>
            </div>
            <button class="btn upg-btn ${maxed ? 'maxed' : canAfford ? '' : 'disabled'}"
              data-car="${car.id}" data-upg="${upgId}" ${maxed || !canAfford ? 'disabled' : ''}>
              ${maxed ? 'MAX' : '$' + formatNumber(cost)}
            </button>
          </div>`;
      });

      const baseRating = Math.round(calcCarBaseRating(car));
      const paceMult = calcDriverPaceMult(car);
      const rating = Math.round(calcCarRating(car));
      const dnfPct = Math.round(calcDNFChance(car) * 100);
      const endSize = getCarLineupSize(car);
      const endRating = endSize > 1 ? Math.round(calcCarRating(car, 'endurance', false, endSize)) : null;

      carsHtml += `
        <div class="car-card" style="--cls-color: ${cls.color}">
          <div class="car-header">
            <div>
              <div class="car-name">${car.name}</div>
              <div class="car-class" style="color: ${cls.color}">${cls.fullName}</div>
            </div>
            <div class="car-stats-right">
              <div class="car-rating">★ ${rating}</div>
              <div class="car-mult">car ${baseRating} · driver ×${paceMult.toFixed(2)} · DNF ${dnfPct}%</div>
              <div class="car-mult">setup +${(getSetupBonus(car) * 100).toFixed(1)}% (max ${SETUP_BONUS_MAX * 100}%) · crew +${(getPitCrewBonus(car) * 100).toFixed(1)}%</div>
              ${endRating !== null ? `<div class="car-mult">endurance ★ ${endRating} with ${Math.min(getCarLineup(car).length, endSize)}/${endSize} drivers · DNF ${Math.round(calcDNFChance(car, 'endurance', endSize) * 100)}%</div>` : ''}
              ${(() => {
                const sell = canSellCar(car.id);
                return `<button class="btn btn-danger sell-car-btn" data-car="${car.id}" ${sell.ok ? '' : `disabled title="${sell.msg}"`}>Sell $${formatNumber(getCarSellValue(car))}</button>`
                  + (sell.ok ? '' : `<div class="sell-blocked">Last car: keep $${formatNumber(getRestartCost())} to sell it</div>`);
              })()}
            </div>
          </div>
          <div class="car-meta">
            ${driver ? '' : '<span class="meta-pill">⚡ No Driver</span>'}
            <span class="meta-pill ${activeChamp ? 'in-champ' : ''}">
              ${activeChamp ? '🏁 ' + champDef.shortName + ' R' + Math.min(activeChamp.currentRound + 1, activeChamp.maxRounds) + '/' + activeChamp.maxRounds : '◯ No Championship'}
            </span>
          </div>
          ${_renderLineup(car)}
          ${reHtml}
          <div class="upgrades-section">${upgradesHtml}</div>
        </div>`;
    });
  }
  carsHtml += '</div>';

  container.innerHTML = garageHtml + _renderPitCrew() + buyCarsHtml + carsHtml;

  // Garage upgrade button
  const garageBtn = container.querySelector('#garage-upgrade-btn');
  if (garageBtn) {
    garageBtn.addEventListener('click', () => {
      const result = upgradeGarage();
      if (result.ok) addNotification(`Garage expanded to ${result.slots} slots!`, 'success');
      else addNotification(result.msg, 'error');
      renderGarage();
    });
  }

  // Buy car buttons
  container.querySelectorAll('.buy-car-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _buyCarChecked(btn.dataset.class);
    });
  });

  // Sell buttons open a confirmation dialog
  container.querySelectorAll('.sell-car-btn').forEach(btn => {
    btn.addEventListener('click', () => _confirmSellCar(btn.dataset.car));
  });

  // Upgrade buttons
  container.querySelectorAll('.upg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const result = buyUpgrade(btn.dataset.car, btn.dataset.upg);
      if (!result.ok) addNotification(result.msg, 'error');
      renderGarage();
    });
  });

  // Pit crew
  [['#crew-train-btn', trainPitCrew], ['#crew-expand-btn', expandPitCrew]].forEach(([sel, fn]) => {
    const btn = container.querySelector(sel);
    if (btn) btn.addEventListener('click', () => {
      const result = fn();
      if (!result.ok) addNotification(result.msg, 'error');
      renderGarage();
    });
  });

  // Lineup seats
  container.querySelectorAll('.lineup-add-select').forEach(sel => {
    sel.addEventListener('change', () => {
      if (!sel.value) return;
      const result = assignDriver(sel.value, sel.dataset.car, 'co');
      if (!result.ok) addNotification(result.msg, 'error');
      renderGarage();
    });
  });
  container.querySelectorAll('.lineup-lead-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const result = assignDriver(btn.dataset.driver, btn.dataset.car, 'lead');
      if (!result.ok) addNotification(result.msg, 'error');
      renderGarage();
    });
  });
  container.querySelectorAll('.lineup-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      unassignDriver(btn.dataset.driver);
      renderGarage();
    });
  });

  // Hire / Change RE buttons in car cards
  container.querySelectorAll('.car-re-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _hiringRECarId = btn.dataset.car;
      _reCandidates  = generateREOptions();
      switchTab('staff');
    });
  });
}

// ─── Championships Panel ──────────────────────────────────────────────────────

function renderChampionships() {
  const container = document.getElementById('panel-championships');

  // Active entries
  let activeHtml = '<div class="section-header">ACTIVE CHAMPIONSHIPS</div>';
  if (G.activeChampionships.length === 0) {
    activeHtml += '<div class="empty-state">No active championships. Enter one below.</div>';
  } else {
    G.activeChampionships.forEach(entry => {
      const champDef = getChampionshipById(entry.definitionId);
      const car = G.cars.find(c => c.id === entry.carId);
      const now = Date.now();
      const elapsed = (now - entry.roundStartTime) / 1000;
      const roundPct = Math.min(100, (elapsed / entry.roundDurationSec) * 100);
      const remaining = Math.max(0, entry.roundDurationSec - elapsed);
      const isFinalRound = entry.currentRound + 1 >= entry.maxRounds;
      const timerText = remaining <= 0
        ? (isFinalRound ? 'Championship finishing…' : 'Round finishing…')
        : (isFinalRound ? `Final round ends in ${formatTime(remaining)}` : `Next round in ${formatTime(remaining)}`);
      const standingPos = getStandingPosition(entry);
      const rating = car ? Math.round(calcCarRating(car, champDef.format, false, getLineupSize(champDef))) : 0;
      const fieldStr = getFieldStrength(champDef, entry.classId);

      activeHtml += `
        <div class="champ-active-card" data-entry="${entry.id}" style="--cls-color: ${champDef.color}">
          <div class="champ-active-header">
            <div>
              <div class="champ-name" style="color: ${champDef.color}">${champDef.name}</div>
              <div class="champ-car">${car ? car.name : 'Unknown car'}</div>
            </div>
            <div class="champ-standing-big">
              <div class="champ-standing-pos">${entry.currentRound > 0 ? 'P' + standingPos : '—'}</div>
              <div class="champ-round">Round ${entry.currentRound + 1}/${entry.maxRounds}</div>
            </div>
          </div>
          <div class="champ-race-info">
            <span>★ ${rating} vs field ★ ${fieldStr}</span>
            <span>${entry.points} pts</span>
            ${renderLastRound(entry)}
          </div>
          ${renderResultStrip(entry)}
          <div class="round-progress-wrap">
            <div class="round-progress-bar" style="width: ${roundPct}%"></div>
          </div>
          ${renderMiniStandings(entry)}
          <div class="champ-footer">
            <span data-live-timer>${timerText}</span>
            <span>+$${formatNumber(entry.prizeEarned || 0)} · +${formatNumber(entry.repEarned)} REP</span>
            <span class="champ-footer-actions">
              <button class="btn autorenew-btn ${car && car.autoRenew ? 'on' : ''}" data-car="${entry.carId}">🔁 Auto-renew ${car && car.autoRenew ? 'on' : 'off'}</button>
              <button class="btn btn-danger withdraw-btn" data-entry="${entry.id}">Withdraw</button>
            </span>
          </div>
        </div>`;
    });
  }

  // Registrations for next season
  if ((G.registrations || []).length > 0) {
    activeHtml += '<div class="section-header">NEXT SEASON</div><div class="next-season-list">';
    G.registrations.forEach(reg => {
      const champDef = getChampionshipById(reg.definitionId);
      const car = G.cars.find(c => c.id === reg.carId);
      activeHtml += `
        <div class="next-season-row" style="--cls-color: ${champDef.color}">
          <span class="next-season-champ" style="color: ${champDef.color}">${champDef.name}</span>
          <span class="next-season-car">${car ? car.name : 'Unknown car'} · starts when season ${G.season + 1} begins · $${formatNumber(reg.fee)} paid</span>
          <button class="btn cancel-reg-btn" data-car="${reg.carId}">Cancel (refund)</button>
        </div>`;
    });
    activeHtml += '</div>';
  }

  // Available championships
  let availHtml = '<div class="section-header">ENTER CHAMPIONSHIP</div>';

  availHtml += '<div class="champ-grid">';
  CHAMPIONSHIPS.forEach(champDef => {
    if (champDef.pathway === 'single_seater' && !isSingleSeaterUnlocked()) return;
    const repOk    = G.reputation >= (champDef.repRequired || 0);
    const prereqOk = checkChampionshipPrerequisite(champDef);
    const hardLocked = !repOk || !prereqOk;
    const timeOk     = fitsInSeason(champDef);
    const completions = G.champCompletions[champDef.id] || 0;
    // Cars of an allowed class; the card describes the picked one (default: the best free car)
    const eligibleCars = G.cars.filter(c => champDef.allowedClasses.includes(c.classId));
    const selCar = _pickChampCar(champDef, eligibleCars);
    const feeClass = selCar ? selCar.classId : champDef.allowedClasses[0];
    const fee = getEntryFee(champDef, selCar, feeClass);
    const renewal = selCar && hasSeriesSlot(selCar, champDef);
    const canAfford  = G.money >= fee;
    const fieldClass = feeClass;
    const fieldStr = getFieldStrength(champDef, fieldClass);
    const p1Prize = getRoundPrize(champDef, fieldClass);
    const lineupSize = getLineupSize(champDef);
    const selRating = selCar ? Math.round(calcCarRating(selCar, champDef.format, false, lineupSize)) : null;
    const selMissing = selCar ? getMissingDrivers(selCar, lineupSize) : 0;
    const best = G.completedChampionships.filter(c => c.definitionId === champDef.id && c.finalPosition)
      .reduce((m, c) => Math.min(m, c.finalPosition), Infinity);

    // Build lock reasons list
    const lockReasons = [];
    if (!repOk)
      lockReasons.push(`<span class="lock-reason rep">⬡ ${formatNumber(champDef.repRequired)} REP required</span>`);
    if (!prereqOk) {
      const label = getPrerequisiteLabel(champDef);
      lockReasons.push(`<span class="lock-reason prereq">🏆 Complete ${label} first</span>`);
    }
    if (!hardLocked && !canAfford)
      lockReasons.push(`<span class="lock-reason money">💰 $${formatNumber(fee)} entry fee</span>`);
    if (!hardLocked && !timeOk)
      lockReasons.push(`<span class="lock-reason time">⏱ Needs ${formatClock(getChampionshipDuration(champDef))} — season ends in ${formatClock(getSeasonTimeLeft())}</span>`);

    availHtml += `
      <div class="champ-card ${hardLocked ? 'champ-locked' : ''}" style="--cls-color: ${champDef.color}">
        <div class="champ-card-header">
          <div class="champ-card-name" style="color: ${hardLocked ? '#555' : champDef.color}">${hardLocked ? '🔒 ' : ''}${champDef.name}</div>
          ${completions > 0 ? `<div class="champ-completions">✓ ${completions}×${best < Infinity ? ` · best P${best}` : ''}</div>` : ''}
        </div>
        <div class="champ-classes">${champDef.allowedClasses.join(', ')}</div>
        <div class="champ-desc">${champDef.description}</div>
        <div class="champ-stats">
          <span>📅 ${champDef.rounds} rounds</span>
          <span>⏱ ${champDef.roundDurationSec}s/round · ${formatClock(getChampionshipDuration(champDef))} total</span>
          <span>${champDef.format === 'endurance' ? '🌙 Endurance' : '⚡ Sprint'}</span>
          <span>👥 ${lineupSize} driver${lineupSize > 1 ? 's' : ''} per car${selMissing > 0 ? ` · <span class="lineup-short">yours is ${selMissing} short</span>` : ''}</span>
          <span>🌧 ${Math.round((champDef.wetChance || 0) * 100)}% wet</span>
          <span>🏁 Field ★ ${fieldStr}${selRating !== null ? ` · yours ★ ${selRating}` : ''}</span>
          <span>💰 P1 $${formatNumber(p1Prize)}/round</span>
          <span>📈 P1 +${formatNumber(Math.round(getRoundRep(champDef, fieldClass)))} REP/round</span>
          <span>🏆 Prize pool: P1 $${formatNumber(p1Prize * champDef.rounds * STANDING_BONUS[0])} · P5 $${formatNumber(p1Prize * champDef.rounds * STANDING_BONUS[4])}</span>
          <span>🎟 ${renewal
            ? `Renewal $${formatNumber(fee)} (${selCar.name} has a slot)`
            : `${feeClass} first entry $${formatNumber(getClassEntryFee(champDef, feeClass))} · renewals $${formatNumber(getRenewalFee(champDef, feeClass))}`}</span>
        </div>
        ${lockReasons.length > 0 ? `<div class="champ-lock-reasons">${lockReasons.join('')}</div>` : ''}
        ${hardLocked ? '' : _renderChampCarActions(champDef, eligibleCars, selCar, timeOk)}
      </div>`;
  });
  availHtml += '</div>';

  container.innerHTML = activeHtml + availHtml;

  // Bind events
  container.querySelectorAll('.champ-car-pick').forEach(sel => {
    sel.addEventListener('change', () => {
      _champCarChoice[sel.dataset.champ] = sel.value;
      renderChampionships();
    });
  });

  container.querySelectorAll('.enter-champ-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const result = enterChampionship(btn.dataset.champ, btn.dataset.car);
      if (!result.ok) addNotification(result.msg, 'error');
      else addNotification('Entered championship!', 'success');
      renderChampionships();
    });
  });

  container.querySelectorAll('.register-champ-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const result = registerForNextSeason(btn.dataset.champ, btn.dataset.car);
      if (!result.ok) addNotification(result.msg, 'error');
      else addNotification('Registered for next season. It starts when the new season begins.', 'success');
      renderChampionships();
    });
  });

  container.querySelectorAll('.cancel-reg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      cancelRegistration(btn.dataset.car);
      addNotification('Registration cancelled, entry fee refunded.', 'info');
      renderChampionships();
    });
  });

  container.querySelectorAll('.autorenew-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const car = G.cars.find(c => c.id === btn.dataset.car);
      setAutoRenew(btn.dataset.car, !(car && car.autoRenew));
      renderChampionships();
    });
  });

  container.querySelectorAll('.withdraw-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      withdrawFromChampionship(btn.dataset.entry);
      addNotification('Withdrawn from championship.', 'info');
      renderChampionships();
    });
  });
}

// The car a championship card shows: the player's pick, else the best car that can enter now
function _pickChampCar(champDef, cars) {
  const picked = cars.find(c => c.id === _champCarChoice[champDef.id]);
  if (picked) return picked;
  const lineupSize = getLineupSize(champDef);
  const rated = car => calcCarRating(car, champDef.format, false, lineupSize);
  const ready = cars.filter(c => c.driverId && !c.championshipId && !getRegistration(c.id));
  return [...(ready.length ? ready : cars)].sort((a, b) => rated(b) - rated(a))[0] || null;
}

// Car picker plus one action: enter now, or register for next season when the car
// is busy or the series no longer fits this season
function _renderChampCarActions(champDef, cars, car, timeOk) {
  if (!car) return `<div class="champ-no-car">No ${champDef.allowedClasses.join(' / ')} car in your garage</div>`;
  const lineupSize = getLineupSize(champDef);
  const status = c => {
    const reg = getRegistration(c.id);
    if (!c.driverId) return ' (no driver)';
    if (c.championshipId) return ' (racing)';
    return reg ? ' (registered)' : '';
  };
  const picker = cars.length > 1
    ? `<select class="champ-car-pick" data-champ="${champDef.id}">${cars.map(c =>
        `<option value="${c.id}" ${c.id === car.id ? 'selected' : ''}>${c.name} · ★ ${Math.round(calcCarRating(c, champDef.format, false, lineupSize))}${status(c)}</option>`).join('')}</select>`
    : `<span class="champ-car-label">${car.name} · ★ ${Math.round(calcCarRating(car, champDef.format, false, lineupSize))}</span>`;
  const fee = getEntryFee(champDef, car, car.classId);
  const reg = getRegistration(car.id);
  const entry = car.championshipId && G.activeChampionships.find(e => e.id === car.championshipId);
  let action;
  if (!car.driverId) action = `<span class="champ-car-note">no driver</span>`;
  else if (reg) action = `<span class="champ-car-note">${reg.definitionId === champDef.id ? '✓ registered for next season' : `registered for ${getChampionshipById(reg.definitionId).shortName}`}</span>`;
  else if (entry || !timeOk) action = `<button class="btn register-champ-btn" data-champ="${champDef.id}" data-car="${car.id}" ${G.money >= fee ? '' : 'disabled'}
      title="${entry ? `Racing ${getChampionshipById(entry.definitionId).shortName} this season` : 'Does not fit in this season'}">📅 Next season — $${formatNumber(fee)}</button>`;
  else action = `<button class="btn enter-champ-btn" data-champ="${champDef.id}" data-car="${car.id}" ${G.money >= fee ? '' : 'disabled'}>Enter — $${formatNumber(fee)}</button>`;
  return `<div class="champ-car-row">${picker}${action}</div>`;
}

function renderLastRound(entry) {
  const r = entry.lastRound;
  if (!r) return '<span class="champ-last">Lights out soon</span>';
  const wet = r.wet ? ' 🌧' : '';
  if (r.dns) return `<span class="champ-last bad">Last: DNS${wet}${r.dnsReason ? ' · ' + r.dnsReason : ''}</span>`;
  if (r.dnf) return `<span class="champ-last bad">Last: DNF${wet}${r.dnfReason ? ' · ' + r.dnfReason : ''}</span>`;
  const incident = r.incident ? ` · <span class="champ-incident">${describeIncident(r.incident)}</span>` : '';
  return `<span class="champ-last ${r.pos <= 3 ? 'good' : ''}">Last: P${r.pos}${wet}${incident} · +$${formatNumber(r.prize)}</span>`;
}

function renderResultStrip(entry) {
  if (!entry.results || entry.results.length === 0) return '';
  const notes = entry.resultNotes || [];
  const cells = entry.results.map((res, i) => {
    const cls = typeof res !== 'number' ? 'res-dnf' : res === 1 ? 'res-win' : res <= 3 ? 'res-podium' : res <= 10 ? 'res-points' : '';
    const note = notes[i] ? ` res-noted" title="${notes[i]}` : '';
    return `<span class="res-cell ${cls}${note}">${res}</span>`;
  }).join('');
  return `<div class="result-strip">${cells}</div>`;
}

// Top 3 plus the rows around the player
function renderMiniStandings(entry) {
  if (entry.currentRound === 0) return '';
  const rows = getStandings(entry);
  const me = rows.findIndex(r => r.isPlayer);
  const show = new Set([0, 1, 2, me - 1, me, me + 1].filter(i => i >= 0 && i < rows.length));
  let html = '<div class="mini-standings">';
  let last = -1;
  [...show].sort((a, b) => a - b).forEach(i => {
    if (last >= 0 && i > last + 1) html += '<div class="ms-gap">⋯</div>';
    const r = rows[i];
    html += `<div class="ms-row ${r.isPlayer ? 'ms-me' : ''}"><span class="ms-pos">P${i + 1}</span><span class="ms-name">${r.name}</span><span class="ms-pts">${r.points}</span></div>`;
    last = i;
  });
  return html + '</div>';
}

// ─── Driver License Helper ────────────────────────────────────────────────────

function renderDriverLicenses(driver) {
  const licenses    = driver.licenses    || [];
  const licensePoints = driver.licensePoints || {};

  // Only show pathways that are currently visible
  const visibleTiers = LICENSE_TIERS.filter(lt =>
    lt.pathway === 'gt_endurance' || (lt.pathway === 'single_seater' && isSingleSeaterUnlocked())
  );

  // Held license badges
  const heldHtml = visibleTiers
    .filter(lt => licenses.includes(lt.id))
    .map(lt => `<span class="dlicense-badge">${lt.name} ✓</span>`)
    .join('');

  // Progress toward the next license of each visible pathway
  const progressHtml = [...new Set(visibleTiers.map(lt => lt.pathway))].map(pathway => {
    const nextTier = visibleTiers.find(lt => lt.pathway === pathway && !licenses.includes(lt.id));
    if (!nextTier) return '';
    const current = licensePoints[nextTier.id] || 0;
    const pct     = Math.min(100, Math.floor(current / nextTier.pointsRequired * 100));
    return `
      <div class="dlicense-progress-row">
        <span class="dlicense-next-name">${nextTier.name} License</span>
        <span class="dlicense-pts">${current} / ${nextTier.pointsRequired} LP</span>
        <div class="dlicense-bar-wrap"><div class="dlicense-bar-fill" style="width:${pct}%"></div></div>
      </div>`;
  }).join('');

  return `<div class="driver-licenses">${heldHtml ? `<div class="dlicense-row">${heldHtml}</div>` : ''}${progressHtml}</div>`;
}

// ─── Drivers Panel ────────────────────────────────────────────────────────────

// Roster sort and filters; license: a license id the driver must hold, status: 'free' or 'seated'
let _driverView = { sort: 'signed', license: '', status: '', tier: '' };

const DRIVER_SORTS = {
  signed: { label: 'Signed',   cmp: null },
  pace:   { label: 'Pace',     cmp: (a, b) => b.pace - a.pace },
  tier:   { label: 'Tier',     cmp: (a, b) => DRIVER_TIER_ORDER.indexOf(a.tier) - DRIVER_TIER_ORDER.indexOf(b.tier) || b.pace - a.pace },
  license:{ label: 'Licenses', cmp: (a, b) => (b.licenses || []).length - (a.licenses || []).length || b.pace - a.pace },
  age:    { label: 'Youngest', cmp: (a, b) => (a.age || 20) - (b.age || 20) },
  salary: { label: 'Salary',   cmp: (a, b) => getDriverSalary(b) - getDriverSalary(a) },
  name:   { label: 'Name',     cmp: (a, b) => a.name.localeCompare(b.name) },
};
const DRIVER_TIER_ORDER = ['L', 'S', 'A', 'B', 'C'];

// The roster after the current filters and sort
function _filteredDrivers(visibleLicenses) {
  const v = _driverView;
  if (v.license && !visibleLicenses.some(lt => lt.id === v.license)) v.license = '';
  const list = G.drivers.filter(d =>
    (!v.license || (d.licenses || []).includes(v.license))
    && (!v.status || (v.status === 'free') === !d.carId)
    && (!v.tier || d.tier === v.tier));
  const cmp = (DRIVER_SORTS[v.sort] || DRIVER_SORTS.signed).cmp;
  return cmp ? list.sort(cmp) : list;
}

function _driverToolbar(visibleLicenses, shown) {
  const opt = (value, label, current) => `<option value="${value}" ${value === current ? 'selected' : ''}>${label}</option>`;
  const v = _driverView;
  const tiers = DRIVER_TIER_ORDER.filter(t => G.drivers.some(d => d.tier === t));
  return `
    <div class="driver-toolbar">
      <label>Sort <select data-view="sort">${Object.entries(DRIVER_SORTS).map(([k, s]) => opt(k, s.label, v.sort)).join('')}</select></label>
      <label>Can drive <select data-view="license">${opt('', 'Any class', v.license)}${visibleLicenses.map(lt => opt(lt.id, lt.name, v.license)).join('')}</select></label>
      <label>Status <select data-view="status">${opt('', 'All', v.status)}${opt('free', 'Unassigned', v.status)}${opt('seated', 'In a car', v.status)}</select></label>
      <label>Tier <select data-view="tier">${opt('', 'All', v.tier)}${tiers.map(t => opt(t, DRIVER_TIERS[t].name, v.tier)).join('')}</select></label>
      <span class="driver-toolbar-count">${shown} of ${G.drivers.length}</span>
    </div>`;
}

function renderDrivers() {
  const container = document.getElementById('panel-drivers');

  // Scout section — C/B/A/S purchasable; L locked
  let scoutHtml = '<div class="section-header">SCOUT DRIVERS</div><div class="scout-grid">';
  ['C', 'B', 'A', 'S', 'L'].forEach(tier => {
    const def = DRIVER_TIERS[tier];
    const cfg = DRIVER_STAT_CONFIG[tier];
    const isLocked = def.locked;
    const scoutWait = tier === 'C' ? getFreeScoutWait() : 0;
    const scoutCost = isLocked ? def.scoutCost : getScoutCost(tier);
    const canAfford = !isLocked && G.money >= scoutCost && scoutWait === 0;

    const budgetLabel = `Budget: ${cfg.budgetMin}–${cfg.budgetMax} pts`;
    const lockTooltip = isLocked ? 'title="Unlocked via Prestige milestones"' : '';

    scoutHtml += `
      <div class="scout-card ${isLocked ? 'scout-locked' : ''}" style="--tier-color: ${def.color}" ${lockTooltip}>
        <div class="scout-tier-label">
          <span class="scout-tier" style="color: ${isLocked ? '#555' : def.color}">${def.name}</span>
          <span class="scout-tier-key" style="color: ${isLocked ? '#444' : def.color}">${tier}</span>
        </div>
        <div class="scout-rarity" style="color: ${isLocked ? '#444' : ''}">${def.rarity}</div>
        <div class="scout-budget" style="color: ${isLocked ? '#333' : ''}">${budgetLabel}</div>
        <div class="scout-budget" style="color: ${isLocked ? '#333' : ''}">Licenses: ${(TIER_STARTING_LICENSES[tier] || ['GT4']).filter(id => isSingleSeaterUnlocked() || id[0] !== 'F').join(', ')}</div>
        <div class="scout-budget" style="color: ${isLocked ? '#333' : ''}">Pace ${cfg.paceMin}+ · ${def.salary ? `<span title="Rises with the class raced, up to ×${Math.max(...Object.values(SALARY_CLASS_MULT))}">$${formatNumber(def.salary)}/season base salary</span>` : isLocked ? 'Contract prepaid' : 'No salary'}</div>
        ${isLocked
          ? `<div class="scout-locked-msg">Unlocked via Prestige</div>`
          : `<button class="btn scout-btn ${canAfford ? '' : 'disabled'}"
               data-tier="${tier}" ${canAfford ? '' : 'disabled'}>
               ${scoutCost === 0 ? (scoutWait > 0 ? `Free in ${Math.ceil(scoutWait)}s` : 'Free Scout') : '$' + formatNumber(scoutCost)}
             </button>`
        }
      </div>`;
  });
  scoutHtml += '</div><div class="staff-section-desc">Once in a long while, scouting turns up a special driver.</div>';

  // Driver roster
  let rosterHtml = '<div class="section-header">DRIVER ROSTER</div>';
  if (G.drivers.length === 0) {
    rosterHtml += '<div class="empty-state">No drivers signed. Scout above.</div>';
  } else {
    const visibleLicenses = LICENSE_TIERS.filter(lt => lt.pathway !== 'single_seater' || isSingleSeaterUnlocked());
    const drivers = _filteredDrivers(visibleLicenses);
    rosterHtml += _driverToolbar(visibleLicenses, drivers.length);
    if (!drivers.length) rosterHtml += '<div class="empty-state">No driver matches these filters.</div>';
    rosterHtml += '<div class="driver-list">';
    drivers.forEach(driver => {
      const tierDef = DRIVER_TIERS[driver.tier];
      const stage   = getCareerStage(driver.age || 20);
      const age     = driver.age || 20;
      const retAge  = driver.retirementAge || 43;
      const retiringLabel = age >= 40 ? null
        : age >= 38 ? 'Retiring soon'
        : null;

      // Build 5-stat block
      const statsHtml = DRIVER_STAT_KEYS.map(key => {
        const isPrimary = driver.primaryStat === key;
        const isPace    = key === 'pace';
        return `
          <div class="dstat ${isPrimary ? 'dstat-primary' : ''} ${isPace ? 'dstat-pace' : ''}">
            <span class="dstat-label">${isPace ? 'Pace' : DRIVER_STAT_LABELS[key].replace(' ', '\u00a0')}</span>
            <span class="dstat-value">${driver[key] ?? '–'}</span>
            ${isPrimary ? '<span class="dstat-star">★</span>' : ''}
          </div>`;
      }).join('');

      const primaryLabel = DRIVER_STAT_LABELS[driver.primaryStat] || driver.primaryStat;

      rosterHtml += `
        <div class="driver-card ${age >= 38 ? 'driver-retiring' : ''} ${getSpecialDef(driver) ? 'driver-special' : ''}">
          <div class="driver-info">
            <div class="driver-name">${_driverLabel(driver)}</div>
            <div class="driver-tier" style="color: ${tierDef.color}">${tierDef.name}</div>
            <div class="driver-primary-badge" style="color: ${tierDef.color}">★ ${primaryLabel}</div>
            ${getSpecialDef(driver) ? `<div class="driver-special-badge">✦ Special · ${getSpecialDef(driver).quirk}</div>` : ''}
            <div class="driver-career-row">
              <span class="driver-age">Age ${age}</span>
              <span class="driver-stage-badge" style="color:${stage.color};border-color:${stage.color}">${stage.label} ${stage.trajectory}</span>
              ${retiringLabel ? `<span class="driver-retiring-badge">${retiringLabel}</span>` : ''}
            </div>
          </div>
          <div class="driver-stats-grid">${statsHtml}</div>
          <div class="driver-meta">
            <span class="driver-xp" title="Banked XP becomes stat points at season end">XP ${Math.floor(driver.xp)} · +${Math.floor(driver.xp / XP_PER_STAT_POINT)} stat pts</span>
            <span class="driver-ret-age">Retires ~${retAge}</span>
            ${getDriverSalary(driver) ? `<span class="driver-salary" title="Base $${formatNumber(DRIVER_TIERS[driver.tier].salary)} ×${SALARY_CLASS_MULT[getDriverSalaryClassTier(driver)] || 1} for the highest class raced or seated in this season">$${formatNumber(getDriverSalary(driver))}/season</span>` : ''}
          </div>
          ${renderDriverLicenses(driver)}
          <div class="driver-assign">
            <select class="assign-car-select" data-driver="${driver.id}">
              <option value="">Unassigned</option>
              ${G.cars.map(c => {
                const seated = getCarLineup(c);
                const here = driver.carId === c.id;
                const role = here
                  ? (c.driverId === driver.id ? ' (lead)' : isReserveDriver(driver) ? ' (reserve)' : ' (co-driver)')
                  : ` (${seated.length}/${getCarSeatLimit(c)})`;
                return `<option value="${c.id}" ${here ? 'selected' : ''} ${!here && seated.length >= getCarSeatLimit(c) ? 'disabled' : ''}>${c.name}${role}</option>`;
              }).join('')}
            </select>
          </div>
          <button class="btn btn-danger fire-driver-btn" data-driver="${driver.id}" title="Release driver">✕</button>
        </div>`;
    });
    rosterHtml += '</div>';
  }

  container.innerHTML = scoutHtml + rosterHtml;

  container.querySelectorAll('.driver-toolbar select').forEach(sel => {
    sel.addEventListener('change', () => {
      _driverView[sel.dataset.view] = sel.value;
      renderDrivers();
    });
  });

  container.querySelectorAll('.scout-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const result = scoutDriver(btn.dataset.tier);
      if (result.ok) {
        addNotification(`Signed ${result.driver.name} (${result.driver.tier}-tier, Pace ${result.driver.pace})`, 'success');
        renderDrivers();
      } else {
        addNotification(result.msg, 'error');
      }
    });
  });

  container.querySelectorAll('.assign-car-select').forEach(sel => {
    sel.addEventListener('change', e => {
      const driverId = e.target.dataset.driver;
      const carId = e.target.value;
      if (carId) {
        const result = assignDriver(driverId, carId, 'co');
        if (!result.ok) {
          addNotification(result.msg, 'error');
          renderDrivers(); // reset select to previous state
          return;
        }
        addNotification('Driver assigned.', 'info');
      } else {
        unassignDriver(driverId);
        addNotification('Driver unassigned.', 'info');
      }
      renderDrivers();
    });
  });

  container.querySelectorAll('.fire-driver-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const result = fireDriver(btn.dataset.driver);
      if (result.ok) {
        addNotification(`${result.name} released.`, 'info');
        renderDrivers();
      }
    });
  });
}

// ─── Sponsors Panel ───────────────────────────────────────────────────────────

function renderSponsors() {
  const container = document.getElementById('panel-sponsors');
  const totalIps      = calcSponsorIncomePerSec();
  const slotsUnlocked = getSponsorSlotsUnlocked();

  // ── Overview bar
  let html = `
    <div class="section-header">SPONSORS</div>
    <div class="sponsor-overview-bar">
      <div class="sponsor-overview-stat">
        <span class="sponsor-overview-label">Sponsor Income Paid Now</span>
        <span class="sponsor-overview-ips" id="sponsor-total-ips">$${formatNumber(totalIps)}/s</span>
      </div>
      <div class="sponsor-overview-stat">
        <span class="sponsor-overview-label">Held Until Targets Met</span>
        <span class="sponsor-overview-value" id="sponsor-held-ips">+$${formatNumber(calcSponsorHeldPerSec())}/s</span>
      </div>
      <div class="sponsor-overview-stat">
        <span class="sponsor-overview-label">Sponsor Bonus</span>
        <span class="sponsor-overview-value" title="Team Principal, Hospitality and prestige bonuses">+${Math.round((_sponsorMult() - 1) * 100)}%</span>
      </div>
      <div class="sponsor-overview-stat">
        <span class="sponsor-overview-label">Season</span>
        <span class="sponsor-overview-value">${G.season}</span>
      </div>
      <div class="sponsor-overview-stat">
        <span class="sponsor-overview-label">Slots</span>
        <span class="sponsor-overview-value">${G.sponsors.filter(Boolean).length} / ${slotsUnlocked}</span>
      </div>
    </div>`;

  // ── Starter (parents) sponsor
  html += `
    <div class="section-header">FAMILY SUPPORT</div>
    <div class="sponsor-card sponsor-starter">
      <div class="sponsor-card-header">
        <span class="sponsor-cat-icon starter-icon">🏠</span>
        <div class="sponsor-info">
          <div class="sponsor-name">Mum &amp; Dad Racing Support</div>
          <div class="sponsor-meta sponsor-meta-starter">Family Support · Permanent</div>
        </div>
        <div class="sponsor-ips-col">
          <div class="sponsor-ips-value">$${formatNumber(getFamilySupportPerSec())}/s</div>
        </div>
      </div>
      <div class="sponsor-card-footer">
        <span class="sponsor-target-badge met">✓ No conditions — always supporting you</span>
        <span class="sponsor-contract-badge">Lifetime contract</span>
      </div>
    </div>`;

  // ── Earnable slots
  html += `<div class="section-header">SPONSOR SLOTS</div><div class="sponsor-slots-list">`;

  for (let i = 0; i < 5; i++) {
    const slotNum    = i + 1;
    const unlockDef  = SPONSOR_SLOT_UNLOCKS[i];
    const isUnlocked = slotNum <= slotsUnlocked;
    const sponsor    = G.sponsors[i];
    const isSigningThis = _signingSlotIndex === i;

    if (!isUnlocked) {
      const cond = unlockDef.condition;
      const lockLabel = cond
        ? (cond.type === 'rep'
            ? `${formatNumber(cond.amount)} REP`
            : unlockDef.label)
        : 'Locked';
      html += `
        <div class="sponsor-slot sponsor-slot-locked">
          <span class="slot-num">Slot ${slotNum}</span>
          <span class="slot-lock-icon">🔒</span>
          <span class="slot-lock-label">Unlock: ${lockLabel}</span>
        </div>`;

    } else if (!sponsor) {
      html += `
        <div class="sponsor-slot sponsor-slot-empty${isSigningThis ? ' signing-active' : ''}">
          <span class="slot-num">Slot ${slotNum}</span>
          <span class="slot-empty-label">No sponsor — slot available</span>
          <button class="btn sign-sponsor-btn${isSigningThis ? ' disabled' : ''}"
            data-slot="${i}" ${isSigningThis ? 'disabled' : ''}>
            ${isSigningThis ? 'Selecting...' : 'Sign Sponsor'}
          </button>
        </div>`;

    } else {
      const catDef    = SPONSOR_CATEGORIES.find(c => c.id === sponsor.category);
      const tierDef   = SPONSOR_TIERS[sponsor.tier];
      const targetMet = isSponsorTargetMet(sponsor);
      const targetLbl = renderSponsorTargetText(sponsor.target);
      const contractLbl = sponsor.seasonsRemaining !== null
        ? `${sponsor.seasonsRemaining} season${sponsor.seasonsRemaining !== 1 ? 's' : ''} remaining`
        : 'Ongoing contract';

      let bonusParts = [];
      if (sponsor.bonusCash > 0) bonusParts.push(`$${formatNumber(sponsor.bonusCash)}`);
      if (sponsor.bonusRep > 0)  bonusParts.push(`+${formatNumber(sponsor.bonusRep)} REP`);
      if (sponsor.bonusPP > 0)   bonusParts.push(`+${sponsor.bonusPP} PP at next prestige`);
      if (sponsor.unlocksLivery) bonusParts.push('Exclusive Livery');

      html += `
        <div class="sponsor-slot sponsor-slot-filled" style="--sp-color: ${tierDef.color}">
          <div class="sponsor-card-inner">
            <div class="sponsor-card-header">
              <span class="sponsor-cat-icon">${catDef ? catDef.icon : '◆'}</span>
              <div class="sponsor-info">
                <div class="sponsor-name">${sponsor.name}</div>
                <div class="sponsor-meta" style="color: ${tierDef.color}">${catDef ? catDef.name : ''} · ${tierDef.label}</div>
              </div>
              <div class="sponsor-ips-col">
                <div class="sponsor-ips-value" data-live-sponsor-ips="${sponsor.id}">${_sponsorRateText(sponsor)}</div>
                ${sponsor.target ? `<div class="sponsor-held" data-live-held="${sponsor.id}">held so far: $${formatNumber(sponsor.heldBack || 0)}</div>` : ''}
              </div>
            </div>
            <div class="sponsor-details">
              <span class="sponsor-contract-badge">📅 ${contractLbl}</span>
              <span class="sponsor-target-badge ${targetMet ? 'met' : 'unmet'}" data-live-target="${sponsor.id}">
                ${targetMet ? '✓' : '✗'} ${targetLbl}
              </span>
              ${bonusParts.length ? `<span class="sponsor-bonus-badge">🏆 Season bonus: ${bonusParts.join(' + ')}</span>` : ''}
            </div>
          </div>
          <button class="btn btn-danger terminate-sponsor-btn" data-id="${sponsor.id}" title="Terminate contract">✕</button>
        </div>`;
    }
  }
  html += `</div>`; // end sponsor-slots-list

  // ── Sign sponsor panel
  const offers = getSponsorOffers();
  const freeSlot = G.sponsors.slice(0, slotsUnlocked).some(s => !s);
  if (_signingSlotIndex === null && !freeSlot) {
    html += `<div class="section-header">OFFERS THIS SEASON</div>`;
    html += offers.length
      ? `<div class="sponsor-offer-preview">${offers.map(o => `<div class="offer-row">${_offerSummary(o)}</div>`).join('')}
           <div class="offer-preview-note">All slots are full. Use ✕ on a sponsor to replace it with one of these.</div></div>`
      : `<div class="empty-state">No offers left this season. New sponsors approach you in season ${G.season + 1}.</div>`;
  }
  if (_signingSlotIndex !== null) {
    html += `
      <div class="section-header">SPONSOR OFFERS — Slot ${_signingSlotIndex + 1} · Season ${G.season}</div>`;
    if (offers.length === 0) html += `<div class="empty-state">No offers left this season. New sponsors approach you in season ${G.season + 1}.</div>`;
    html += `
      <div class="sponsor-options-grid">`;
    offers.forEach(opt => {
      const catDef  = SPONSOR_CATEGORIES.find(c => c.id === opt.category);
      const tierDef = SPONSOR_TIERS[opt.tier];
      const contractLbl = opt.seasonsRemaining !== null
        ? `${opt.seasonsRemaining} season${opt.seasonsRemaining !== 1 ? 's' : ''}`
        : 'Ongoing';
      const targetLbl = describeSponsorTarget(opt.target);

      let bonusParts = [];
      if (opt.bonusCash > 0) bonusParts.push(`$${formatNumber(opt.bonusCash)}`);
      if (opt.bonusRep > 0)  bonusParts.push(`+${formatNumber(opt.bonusRep)} REP`);
      if (opt.bonusPP > 0)   bonusParts.push(`+${opt.bonusPP} PP at next prestige`);
      if (opt.unlocksLivery) bonusParts.push('Livery');

      html += `
        <div class="sponsor-option-card" style="--sp-color: ${tierDef.color}">
          <div class="opt-tier-label" style="color: ${tierDef.color}">${tierDef.label}</div>
          <div class="opt-header">
            <span class="opt-cat-icon">${catDef ? catDef.icon : '◆'}</span>
            <div class="opt-name-block">
              <div class="opt-name">${opt.name}</div>
              <div class="opt-cat" style="color: ${tierDef.color}">${catDef ? catDef.name : ''}</div>
            </div>
          </div>
          <div class="opt-ips">$${formatNumber(opt.incomePerSec)}/s</div>
          <div class="opt-held-note">${Math.round(SPONSOR_UPFRONT_SHARE * 100)}% paid now, the rest at season end if the target is met</div>
          <div class="opt-details">
            <span>📅 ${contractLbl}</span>
            <span>🎯 ${targetLbl}</span>
            ${bonusParts.length ? `<span>🏆 ${bonusParts.join(' + ')}</span>` : ''}
          </div>
          <button class="btn choose-sponsor-btn" data-offer="${opt.id}">Sign Deal</button>
        </div>`;
    });

    html += `</div>
      <button class="btn cancel-sign-btn" style="margin-top:12px">Cancel</button>`;
  }

  container.innerHTML = html;

  // Events — sign slot
  container.querySelectorAll('.sign-sponsor-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _signingSlotIndex = parseInt(btn.dataset.slot);
      renderSponsors();
    });
  });

  // Events — choose deal
  container.querySelectorAll('.choose-sponsor-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const result = signSponsorOffer(_signingSlotIndex, btn.dataset.offer);
      if (result.ok) {
        _signingSlotIndex = null;
      } else {
        addNotification(result.msg, 'error');
      }
      renderSponsors();
    });
  });

  // Events — cancel sign
  const cancelBtn = container.querySelector('.cancel-sign-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      _signingSlotIndex = null;
      renderSponsors();
    });
  }

  // Events — terminate
  container.querySelectorAll('.terminate-sponsor-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _confirmTerminateSponsor(btn.dataset.id);
    });
  });
}

// "$69/s now + $23/s held" for a sponsor, bonuses included
function _sponsorRateText(sponsor) {
  const r = getSponsorPayRates(sponsor);
  return `$${formatNumber(r.now)}/s` + (r.held > 0 ? ` <span class="sponsor-held-rate">+ $${formatNumber(r.held)}/s held</span>` : '');
}

// One-line description of a sponsor offer
function _offerSummary(opt) {
  const tierDef = SPONSOR_TIERS[opt.tier];
  const contract = opt.seasonsRemaining !== null ? `${opt.seasonsRemaining} season${opt.seasonsRemaining !== 1 ? 's' : ''}` : 'ongoing';
  return `<b style="color:${tierDef.color}">${opt.name}</b> · ${tierDef.label} · $${formatNumber(opt.incomePerSec)}/s · ${contract} · 🎯 ${describeSponsorTarget(opt.target)}`;
}

// Asks before ending a sponsor contract, showing the offers that could replace it
function _confirmTerminateSponsor(sponsorId) {
  const sponsor = G.sponsors.find(s => s && s.id === sponsorId);
  if (!sponsor) return;
  const offers = getSponsorOffers();
  const held = Math.round(sponsor.heldBack || 0);
  const points = [
    `${sponsor.name} stops paying immediately.`,
    held > 0 ? `<span class="dialog-warn">Its $${formatNumber(held)} held-back income is forfeited.</span>` : '',
    offers.length
      ? `${offers.length} offer${offers.length > 1 ? 's' : ''} left this season. Replace it directly:`
      : `<span class="dialog-warn">No more offers until season ${G.season + 1}: the slot stays empty until then.</span>`,
  ].filter(Boolean);
  const offerHtml = offers.map(o => `
    <div class="dialog-offer">
      <span>${_offerSummary(o)}</span>
      <button class="btn dialog-replace-btn" data-offer="${o.id}">Replace</button>
    </div>`).join('');
  showConfirmDialog({
    title: `End ${sponsor.name}'s contract?`,
    body: `<ul class="dialog-list">${points.map(p => `<li>${p}</li>`).join('')}</ul>${offerHtml}`,
    confirmLabel: 'End contract',
    danger: true,
    onConfirm: () => {
      terminateSponsor(sponsorId);
      renderSponsors();
    },
  });
  document.querySelectorAll('#confirm-dialog .dialog-replace-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      closeConfirmDialog();
      const result = replaceSponsor(sponsorId, btn.dataset.offer);
      if (!result.ok) addNotification(result.msg, 'error');
      renderSponsors();
    });
  });
}

// Target description with this season's progress, e.g. "3 round podiums this season (1/3)"
function renderSponsorTargetText(target) {
  const label = describeSponsorTarget(target);
  if (!target || typeof target !== 'object') return label;
  const p = getSponsorTargetProgress(target);
  return p.need > 1 ? `${label} (${Math.min(p.have, p.need)}/${p.need})` : label;
}

// ─── Targeted in-place sponsor updates ───────────────────────────────────────

function updateSponsorsLive() {
  if (_activeTab !== 'sponsors') return;

  const totalEl = document.getElementById('sponsor-total-ips');
  if (totalEl) totalEl.textContent = '$' + formatNumber(calcSponsorIncomePerSec()) + '/s';
  const heldTotalEl = document.getElementById('sponsor-held-ips');
  if (heldTotalEl) heldTotalEl.textContent = '+$' + formatNumber(calcSponsorHeldPerSec()) + '/s';

  G.sponsors.forEach(s => {
    if (!s) return;
    const ipsEl = document.querySelector(`[data-live-sponsor-ips="${s.id}"]`);
    if (ipsEl) ipsEl.innerHTML = _sponsorRateText(s);
    const heldEl = document.querySelector(`[data-live-held="${s.id}"]`);
    if (heldEl) heldEl.textContent = 'held so far: $' + formatNumber(s.heldBack || 0);

    const targetEl = document.querySelector(`[data-live-target="${s.id}"]`);
    if (targetEl) {
      const met = isSponsorTargetMet(s);
      const lbl = renderSponsorTargetText(s.target);
      targetEl.textContent = (met ? '✓ ' : '✗ ') + lbl;
      targetEl.className = 'sponsor-target-badge ' + (met ? 'met' : 'unmet');
    }
  });
}

// ─── Staff Panel ─────────────────────────────────────────────────────────────

function _renderStaffStatBlock(staffObj, statKeys, statLabels) {
  return statKeys.map(key => {
    const isPrimary = staffObj.primaryStat === key;
    return `<div class="dstat ${isPrimary ? 'dstat-primary' : ''}">
      <span class="dstat-label">${statLabels[key]}</span>
      <span class="dstat-value">${staffObj[key] ?? '–'}</span>
      ${isPrimary ? '<span class="dstat-star">★</span>' : ''}
    </div>`;
  }).join('');
}

function _renderStaffCandidateGrid(candidates, statKeys, statLabels, tiersDef, hireDataAttr, cancelAttr) {
  let html = '<div class="staff-candidates-grid">';
  candidates.forEach((c, idx) => {
    const tierDef = tiersDef[c.tier];
    const statsHtml = _renderStaffStatBlock(c, statKeys, statLabels);
    const hireCostLabel = tierDef.hireCost > 0 ? `$${formatNumber(tierDef.hireCost)}` : 'Free';
    const salaryLabel   = tierDef.salary > 0 ? `$${formatNumber(tierDef.salary)}/season` : 'No salary';
    html += `
      <div class="staff-candidate-card" style="--staff-color: ${tierDef.color}">
        <div class="staff-tier-badge" style="color:${tierDef.color}">${tierDef.label}</div>
        <div class="staff-cand-name">${c.name}</div>
        <div class="staff-stats-grid">${statsHtml}</div>
        <div class="staff-cand-cost">
          <span class="staff-hire-cost">${hireCostLabel}</span>
          <span class="staff-salary">${salaryLabel}</span>
        </div>
        <button class="btn staff-hire-btn" style="border-color:${tierDef.color};color:${tierDef.color}"
          data-${hireDataAttr}="${idx}">Hire</button>
      </div>`;
  });
  html += `</div>
    <button class="btn cancel-sign-btn" data-${cancelAttr}="1" style="margin-top:12px">Cancel</button>`;
  return html;
}

// Highest class a principal tier can run in a program, e.g. "LMP3"
function _tpTopClass(tier, program) {
  const classes = CAR_CLASSES.filter(c => (c.pathway === 'single_seater' ? 'single_seater' : 'gt_endurance') === program
    && c.tier <= TP_TIERS[tier].maxClassTier);
  return classes.length ? classes[classes.length - 1].name : '—';
}

// One program's Team Principal: the hiring grid, an empty slot or the hired principal
function _renderProgramTP(prog) {
  const tp = G.teamPrincipals[prog.id];
  let html = `<div class="staff-program-label">${prog.label}</div>`;
  if (_hiringTP === prog.id) {
    const ranges = Object.values(TP_TIERS).filter(t => !t.locked).map(t => `${t.label} up to ${_tpTopClass(t.id, prog.id)}`).join(' · ');
    html += `<div class="staff-section-desc">Choose the ${prog.label} Team Principal. Seniority sets the classes they can run: ${ranges}.</div>`;
    return html + _renderStaffCandidateGrid(_tpCandidates, TP_STAT_KEYS, TP_STAT_LABELS, TP_TIERS, 'tp-idx', 'cancel-tp');
  }
  if (!tp) {
    return html + `
      <div class="staff-empty">
        <span>No ${prog.label} Team Principal. Hire one to boost these cars.</span>
        <button class="btn start-hire-tp" data-program="${prog.id}">Hire Team Principal</button>
      </div>`;
  }
  const tpTierDef = TP_TIERS[tp.tier];
  const buyout = Math.floor(tpTierDef.hireCost * 0.25);
  const b = getTPBonuses({ classId: prog.id === 'single_seater' ? 'F4' : 'GT4' });
  const tooJunior = G.cars.filter(c => getCarProgram(c) === prog.id && !canTPRunClass(tp, c.classId)).map(c => c.name);
  return html + `
    <div class="staff-card" style="--staff-color: ${tpTierDef.color}">
      <div class="staff-card-header">
        <div>
          <div class="staff-name">${tp.name}</div>
          <div class="staff-tier-label" style="color:${tpTierDef.color}">${tpTierDef.label} · ${prog.label} · runs up to ${_tpTopClass(tp.tier, prog.id)}</div>
        </div>
        <div class="staff-salary-badge">${tp.salary > 0 ? '$' + formatNumber(tp.salary) + '/season' : 'No salary'}</div>
      </div>
      <div class="staff-stats-grid">${_renderStaffStatBlock(tp, TP_STAT_KEYS, TP_STAT_LABELS)}</div>
      <div class="staff-bonuses">
        <span title="${prog.label} cars up to ${_tpTopClass(tp.tier, prog.id)}">+${(b.paceMult*100).toFixed(1)}% pace</span>
        <span title="${prog.label} cars up to ${_tpTopClass(tp.tier, prog.id)}">+${b.strategyRep} REP/round</span>
      </div>
      ${tooJunior.length ? `<div class="lineup-note warn">⚠ Too junior to run ${tooJunior.join(', ')}: no bonuses there.</div>` : ''}
      <div class="staff-card-actions">
        <button class="btn btn-danger fire-tp-btn" data-program="${prog.id}">Fire</button>
        <button class="btn upgrade-tp-btn" data-program="${prog.id}">${buyout > 0 ? 'Replace (buyout $' + formatNumber(buyout) + ')' : 'Replace'}</button>
      </div>
    </div>`;
}

function renderStaff() {
  const container = document.getElementById('panel-staff');

  // ── Season salary preview (staff and drivers)
  const totalSalary = getSeasonSalaryTotal();

  let html = `
    <div class="section-header">STAFF</div>
    <div class="staff-overview-bar">
      <div class="staff-overview-stat">
        <span class="staff-overview-label">Season Salary Bill</span>
        <span class="staff-overview-value" style="color:var(--red)" title="Staff and drivers">${isSalaryFreeSeason() ? 'None this season (reset)' : totalSalary > 0 ? '-$' + formatNumber(totalSalary) + '/season' : 'No salaries'}</span>
      </div>
    </div>`;

  // ── Team Principals: one per program; Single-Seaters once that pathway is open
  html += `<div class="section-header">TEAM PRINCIPALS</div>
    <div class="staff-section-desc">Each program needs its own Team Principal. Pace and REP bonuses reach only that program's cars, up to the classes their seniority allows.</div>`;
  TP_PROGRAMS.filter(p => p.id === 'gt_endurance' || isSingleSeaterUnlocked() || G.teamPrincipals[p.id])
    .forEach(prog => { html += _renderProgramTP(prog); });
  if (getTeamPrincipals().length) {
    const team = getTPBonuses();
    html += `<div class="staff-bonuses staff-team-perks" title="Each perk comes from whichever principal offers the most">
      Team-wide: <span>-${((1-team.upgradeCostMult)*100).toFixed(0)}% crew &amp; prep costs</span>
      <span>+${(team.sponsorMult*100).toFixed(1)}% sponsors</span>
      <span>-${((1-team.scoutCostMult)*100).toFixed(0)}% scouting</span></div>`;
  }

  // ── Race Engineers section
  html += `<div class="section-header">RACE ENGINEERS</div>`;

  if (G.cars.length === 0) {
    html += `<div class="staff-empty"><span>Buy a car first to assign race engineers.</span></div>`;
  } else {
    G.cars.forEach(car => {
      const re = getREForCar(car.id);
      const isHiringThis = _hiringRECarId === car.id;

      html += `<div class="staff-re-row">
        <div class="staff-re-car-name">${car.name}</div>`;

      if (isHiringThis && _reCandidates.length > 0) {
        html += `<div class="staff-section-desc">Choose a Race Engineer for ${car.name}:</div>`;
        html += _renderStaffCandidateGrid(_reCandidates, RE_STAT_KEYS, RE_STAT_LABELS, RE_TIERS, 're-idx', 'cancel-re');
      } else if (!re) {
        html += `<div class="staff-re-empty">
          <span>No engineer</span>
          ${(G.spareEngineers || []).map((s, i) => `<button class="btn assign-spare-btn" data-car="${car.id}" data-idx="${i}">Assign ${s.name} (${RE_TIERS[s.tier].label})</button>`).join('')}
          <button class="btn hire-re-btn" data-car="${car.id}">Hire RE</button>
        </div>`;
      } else {
        const reTierDef = RE_TIERS[re.tier];
        const statsHtml = _renderStaffStatBlock(re, RE_STAT_KEYS, RE_STAT_LABELS);
        const reB = getREBonuses(car.id);
        html += `
          <div class="staff-re-card" style="--staff-color:${reTierDef.color}">
            <div class="staff-card-header">
              <div>
                <div class="staff-name">${re.name}</div>
                <div class="staff-tier-label" style="color:${reTierDef.color}">${reTierDef.label} · Race Engineer</div>
              </div>
              <div class="staff-salary-badge">${re.salary > 0 ? '$' + formatNumber(re.salary) + '/season' : 'No salary'}</div>
            </div>
            <div class="staff-stats-grid">${statsHtml}</div>
            <div class="staff-bonuses">
              <span>+${(reB.setupBonus*100).toFixed(0)}% car rating</span>
              <span>+${(reB.reliBonus*100).toFixed(0)}% reliability</span>
              <span title="Strategy calls gain places">+${(reB.pitBonus*100).toFixed(1)}% prize money</span>
              <span>+${(reB.coachBonus*100).toFixed(0)}% XP</span>
              <span>+${(reB.dataBonus*100).toFixed(0)}% payout</span>
            </div>
            <div class="staff-card-actions">
              <button class="btn btn-danger fire-re-btn" data-car="${car.id}">Fire</button>
              <button class="btn hire-re-btn" data-car="${car.id}">Replace</button>
            </div>
          </div>`;
      }

      html += `</div>`; // end staff-re-row
    });
  }

  // ── Spare engineers: paid engineers whose car was sold
  if ((G.spareEngineers || []).length) {
    html += `<div class="section-header">SPARE ENGINEERS</div>
      <div class="staff-section-desc">Engineers without a car still draw their salary. Assign them to a car without an engineer above.</div>`;
    G.spareEngineers.forEach((re, i) => {
      const reTierDef = RE_TIERS[re.tier];
      html += `
        <div class="staff-re-card" style="--staff-color:${reTierDef.color}">
          <div class="staff-card-header">
            <div>
              <div class="staff-name">${re.name}</div>
              <div class="staff-tier-label" style="color:${reTierDef.color}">${reTierDef.label} · Spare Race Engineer</div>
            </div>
            <div class="staff-salary-badge">$${formatNumber(re.salary)}/season</div>
          </div>
          <div class="staff-stats-grid">${_renderStaffStatBlock(re, RE_STAT_KEYS, RE_STAT_LABELS)}</div>
          <div class="staff-card-actions">
            <button class="btn btn-danger release-spare-btn" data-idx="${i}">Release</button>
          </div>
        </div>`;
    });
  }

  container.innerHTML = html;

  // ── Events: hire or replace a program's TP
  container.querySelectorAll('.start-hire-tp, .upgrade-tp-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _hiringTP = btn.dataset.program;
      _tpCandidates = generateTPOptions();
      renderStaff();
    });
  });

  // Hire TP from candidates
  container.querySelectorAll('[data-tp-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cand = _tpCandidates[parseInt(btn.dataset.tpIdx)];
      const result = hireTP(cand, _hiringTP);
      if (result.ok) { _hiringTP = false; _tpCandidates = []; }
      else addNotification(result.msg, 'error');
      renderStaff();
    });
  });

  // Cancel TP hiring
  container.querySelectorAll('[data-cancel-tp]').forEach(btn => {
    btn.addEventListener('click', () => {
      _hiringTP = false; _tpCandidates = [];
      renderStaff();
    });
  });

  // Fire TP
  container.querySelectorAll('.fire-tp-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      fireTP(btn.dataset.program);
      renderStaff();
    });
  });

  // Hire RE buttons (open candidates for that car)
  container.querySelectorAll('.hire-re-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _hiringRECarId = btn.dataset.car;
      _reCandidates  = generateREOptions();
      renderStaff();
    });
  });

  // Hire RE from candidates
  container.querySelectorAll('[data-re-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cand = _reCandidates[parseInt(btn.dataset.reIdx)];
      const result = hireRE(_hiringRECarId, cand);
      if (result.ok) { _hiringRECarId = null; _reCandidates = []; }
      else addNotification(result.msg, 'error');
      renderStaff();
    });
  });

  // Cancel RE hiring
  container.querySelectorAll('[data-cancel-re]').forEach(btn => {
    btn.addEventListener('click', () => {
      _hiringRECarId = null; _reCandidates = [];
      renderStaff();
    });
  });

  container.querySelectorAll('.assign-spare-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const result = assignSpareEngineer(parseInt(btn.dataset.idx), btn.dataset.car);
      if (!result.ok) addNotification(result.msg, 'error');
      renderStaff();
    });
  });

  container.querySelectorAll('.release-spare-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      releaseSpareEngineer(parseInt(btn.dataset.idx));
      renderStaff();
    });
  });

  // Fire RE buttons
  container.querySelectorAll('.fire-re-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      fireRE(btn.dataset.car);
      renderStaff();
    });
  });
}

// ─── Prestige Panel ───────────────────────────────────────────────────────────

// Warns when the PP after a reset won't buy anything in the shop
function _prestigeBuyWarning(ppGain) {
  const cheapest = getCheapestPrestigeItem();
  if (!cheapest || G.prestigePoints + ppGain >= cheapest.cost) return '';
  return `<br><span class="dialog-warn">After this reset you'd have ${G.prestigePoints + ppGain} PP: the cheapest shop item costs ${cheapest.cost} PP.</span>`;
}

// Asks before a prestige reset, listing what is kept and lost
function _confirmPrestige() {
  const ppGain = calcPrestigePoints();
  const tokens = G.prestige.permanentBonuses.devTokens || 0;
  const cheapest = getCheapestPrestigeItem();
  const totalPP = G.prestigePoints + ppGain;
  const lost = [
    `Money: $${formatNumber(G.money)} → $${formatNumber(getPrestigeStartMoney())}`,
    `Cars: ${tokens ? `the best ${tokens} plus a GT4` : 'one stock GT4'} (${G.cars.length} now)`,
    'Running championships, registrations and sponsor contracts',
    'Pit crew, car preparation above level 2, setup knowledge and HQ',
  ];
  const kept = 'Drivers, licenses, REP, garage, staff and PP. The team starts again at season 1, with no salaries due.';
  showConfirmDialog({
    title: `Prestige reset for +${ppGain} PP?`,
    body: `<ul class="dialog-list">
        <li>You lose: <ul>${lost.map(l => `<li>${l}</li>`).join('')}</ul></li>
        <li>You keep: ${kept}</li>
        <li>${cheapest && totalPP < cheapest.cost
          ? `<span class="dialog-warn">You'll have ${totalPP} PP, but the cheapest shop item costs ${cheapest.cost} PP.</span>`
          : `You'll have ${totalPP} PP to spend in the shop.`}</li>
      </ul>`,
    confirmLabel: `Reset for +${ppGain} PP`,
    danger: true,
    onConfirm: () => {
      const result = doPrestige();
      if (!result.ok) addNotification(result.msg, 'error');
      renderPrestige();
    },
  });
}

function renderPrestige() {
  const container = document.getElementById('panel-prestige');

  // ── Season clock
  const completedThisSeason = _seasonChampionships();
  const totalSalary = getSeasonSalaryTotal();
  const leftSec = getSeasonTimeLeft();
  const seasonPct = 100 - (leftSec / SEASON_LENGTH_SEC) * 100;
  const titles = completedThisSeason.filter(c => c.finalPosition === 1).length;

  let html = `<div class="section-header">SEASON ${G.season}</div>
    <div class="season-clock">
      <div class="season-clock-top">
        <span class="season-clock-time" id="season-clock-time">${formatClock(leftSec)}</span>
        <span class="season-clock-sub">until the season ends · drivers age +1 · contracts and salaries settle</span>
      </div>
      <div class="round-progress-wrap"><div class="round-progress-bar" id="season-clock-bar" style="width:${seasonPct}%"></div></div>
      <div class="season-clock-stats">
        <span>${completedThisSeason.length} championship${completedThisSeason.length !== 1 ? 's' : ''} completed</span>
        <span>${titles} title${titles !== 1 ? 's' : ''}</span>
        <span>${G.activeChampionships.length} in progress</span>
        <span title="Staff and drivers. If the money doesn't cover it, the best-paid people leave.">Salaries due: ${isSalaryFreeSeason() ? 'none (reset season)' : totalSalary > 0 ? '$' + formatNumber(totalSalary) : 'none'}</span>
      </div>
    </div>`;

  // ── Last season results
  const summary = G.lastSeasonSummary;
  if (summary && summary.results && summary.results.length > 0) {
    html += `<div class="section-header">SEASON ${summary.season} RESULTS</div><div class="season-results">`;
    summary.results.forEach(r => {
      const def = getChampionshipById(r.definitionId);
      html += `<div class="sr-row"><span class="sr-pos ${r.finalPosition === 1 ? 'win' : r.finalPosition <= 3 ? 'podium' : ''}">P${r.finalPosition || '?'}</span>
        <span class="sr-name">${def ? def.name : r.definitionId}</span><span class="sr-class">${r.classId || ''}</span>
        <span class="sr-prize">+$${formatNumber(r.prizeEarned || 0)}</span></div>`;
    });
    html += '</div>';
  }
  const _seasonSummary = summary ? summary.driverChanges : null;

  // ── Driver season summary (shown after end season)
  if (_seasonSummary && _seasonSummary.length > 0) {
    html += `<div class="section-header">DRIVER CHANGES — SEASON ${summary.season}</div>
      <div class="season-driver-summary">`;

    _seasonSummary.forEach(rec => {
      if (rec.retired) {
        html += `
          <div class="sds-row sds-retired">
            <span class="sds-name">${rec.name}</span>
            <span class="sds-age">${rec.ageBefore} → ${rec.ageAfter}</span>
            <span class="sds-stage" style="color:var(--red)">Retired</span>
          </div>`;
        return;
      }

      const stageLbl = rec.stage ? `${rec.stage.label} ${rec.stage.trajectory}` : '';
      const stageColor = rec.stage ? rec.stage.color : 'var(--text-2)';
      const statPills = DRIVER_STAT_KEYS.map(k => {
        const d = rec.changes[k];
        if (!d) return '';
        const sign = d > 0 ? '+' : '';
        const cls  = d > 0 ? 'sds-up' : 'sds-down';
        return `<span class="sds-stat ${cls}">${DRIVER_STAT_LABELS[k]} ${sign}${d}</span>`;
      }).filter(Boolean).join('');

      // LP gained pills — filter to visible pathways only
      const lpGained = rec.lpGained || {};
      const lpPills = Object.entries(lpGained)
        .filter(([licenseId]) => {
          const lt = LICENSE_TIERS.find(t => t.id === licenseId);
          return lt && (lt.pathway === 'gt_endurance' || (lt.pathway === 'single_seater' && isSingleSeaterUnlocked()));
        })
        .map(([licenseId, pts]) => `<span class="sds-lp">+${pts} LP → ${licenseId}</span>`)
        .join('');

      html += `
        <div class="sds-row">
          <span class="sds-name">${rec.name}</span>
          <span class="sds-age">${rec.ageBefore} → ${rec.ageAfter}</span>
          <span class="sds-stage" style="color:${stageColor}">${stageLbl}</span>
          <span class="sds-stats">${statPills || '<span class="sds-nochange">No change</span>'}</span>
          ${lpPills ? `<span class="sds-lp-group">${lpPills}</span>` : ''}
        </div>`;
    });

    html += `</div>`;
  }

  // ── Prestige section
  const ppGain = calcPrestigePoints();
  const canP = canPrestige();
  const resets = G.prestige.prestigeCount || 0;
  const pct = x => +(x * 100).toFixed(1);   // 22.5, 15 (no trailing .0)
  const fieldPct = r => pct(getFieldMult(r) - 1);
  const rewardPct = r => pct((getFieldMult(r) - 1) * PRESTIGE_REWARD_SHARE);
  const fieldNote = getFieldMult(resets + 1) > getFieldMult(resets)
    ? `Rival fields are +${fieldPct(resets)}% stronger than in your first run; after this reset +${fieldPct(resets + 1)}%, with prizes and REP +${rewardPct(resets + 1)}%.`
    : `Rival fields are at their strongest: +${fieldPct(resets)}%, with prizes and REP +${rewardPct(resets)}%.`;
  html += `
    <div class="section-header">PRESTIGE RESET</div>
    <div class="prestige-info">
      <div class="prestige-pp">You have <span class="pp-value">${G.prestigePoints} PP</span></div>
      <div class="prestige-gain">Resetting now grants <span class="pp-gain">+${ppGain} PP</span>
        <span class="prestige-warning">(titles and podiums since the last reset, 1 PP per ${formatNumber(PRESTIGE_REP_PER_PP)} REP gained, ${HQ_PP_PER_LEVEL} PP per HQ level, sponsor PP bonuses)</span></div>
      <div class="prestige-warning">Starts the team over: $${formatNumber(getPrestigeStartMoney())}, one stock GT4 (plus a car per Development Token), no sponsors, HQ rebuilt. REP resets to ${getFanBaseShare() ? Math.round(getFanBaseShare() * 100) + '% (Fan Base)' : 'zero'}, so classes, series and fame must be earned again. Drivers, licenses, garage, staff and PP stay. The team starts again at season 1, with no salaries due.
        <br>${fieldNote}
        ${_prestigeBuyWarning(ppGain)}
        ${(G.prestige.prestigeCount || 0) === 0 ? '<br>Your first reset unlocks the <b>Single-Seater Pathway</b> (F4 → F1).' : ''}</div>
      <button class="btn btn-prestige ${canP ? '' : 'disabled'}" id="prestige-btn" ${canP ? '' : 'disabled'}>
        ${!canP ? `Earn ${PRESTIGE_MIN_GAIN} PP to reset · ${ppGain} so far` : `Prestige — +${ppGain} PP`}
      </button>
    </div>
    <div class="section-header">PRESTIGE SHOP</div>
    <div class="prestige-shop-grid">`;
  PRESTIGE_ITEMS.forEach(item => {
    const owned = getPrestigeItemCount(item.id);
    const maxed = item.maxPurchases && owned >= item.maxPurchases;
    const canBuy = !maxed && G.prestigePoints >= item.cost;
    html += `
      <div class="prestige-item ${maxed ? 'maxed' : ''}">
        <div class="pi-name">${item.name}</div>
        <div class="pi-desc">${item.description}</div>
        ${item.maxPurchases ? `<div class="pi-count">${owned}/${item.maxPurchases}</div>` : ''}
        <button class="btn prestige-buy-btn ${canBuy ? '' : 'disabled'}" data-item="${item.id}" ${canBuy ? '' : 'disabled'}>
          ${maxed ? 'Maxed' : item.cost + ' PP'}
        </button>
      </div>`;
  });
  html += '</div>';

  // ── Hard Reset section
  html += `<div class="section-header">DANGER ZONE</div>`;
  if (_confirmingReset) {
    html += `
      <div class="hard-reset-confirm">
        <div class="hard-reset-warning">This will permanently delete all progress. There is no undo.</div>
        <div class="confirm-actions">
          <button class="btn btn-danger" id="do-hard-reset-btn">Yes, wipe everything</button>
          <button class="btn" id="cancel-hard-reset-btn">Cancel</button>
        </div>
      </div>`;
  } else {
    html += `
      <div class="hard-reset-bar">
        <div class="hard-reset-info">
          <div class="hard-reset-label">Hard Reset</div>
          <div class="hard-reset-sub">Delete all save data and start over from scratch.</div>
        </div>
        <button class="btn btn-danger" id="open-hard-reset-btn">Hard Reset</button>
      </div>`;
  }

  container.innerHTML = html;

  // Events — prestige (confirmation dialog)
  const prestigeBtn = container.querySelector('#prestige-btn');
  if (prestigeBtn) prestigeBtn.addEventListener('click', _confirmPrestige);

  container.querySelectorAll('.prestige-buy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const result = buyPrestigeItem(btn.dataset.item);
      if (!result.ok) addNotification(result.msg, 'error');
      renderPrestige();
    });
  });

  // Events — hard reset
  const openResetBtn = container.querySelector('#open-hard-reset-btn');
  if (openResetBtn) {
    openResetBtn.addEventListener('click', () => {
      _confirmingReset = true;
      renderPrestige();
    });
  }

  const doResetBtn = container.querySelector('#do-hard-reset-btn');
  if (doResetBtn) {
    doResetBtn.addEventListener('click', () => {
      resetGame();
      _confirmingReset = false;
      switchTab('garage');
    });
  }

  const cancelResetBtn = container.querySelector('#cancel-hard-reset-btn');
  if (cancelResetBtn) {
    cancelResetBtn.addEventListener('click', () => {
      _confirmingReset = false;
      renderPrestige();
    });
  }

}

function formatClock(sec) {
  const s = Math.ceil(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ─── Team HQ Panel ────────────────────────────────────────────────────────────

function _hqEffectText(id) {
  const lvl = getHQLevel(id);
  if (id === 'simulator')   return `+${(lvl * 1.5).toFixed(1)}% race rating`;
  if (id === 'composites')  return `-${lvl * 3}% crew & prep costs`;
  if (id === 'hospitality') return `+${lvl * 5}% sponsor income`;
  return '';
}

function renderHQ() {
  const container = document.getElementById('panel-hq');
  let html = '<div class="section-header">TEAM HQ</div>';
  if (!isHQUnlocked()) {
    html += `<div class="empty-state">🔒 Team HQ unlocks at ${formatNumber(HQ_UNLOCK_REP)} REP (you have ${formatNumber(G.reputation)}).</div>`;
    container.innerHTML = html;
    return;
  }
  html += `<div class="hq-intro">Invest prize money in facilities. Each level is worth ${HQ_PP_PER_LEVEL} PP when you prestige
    (currently <span class="pp-gain">+${getHQPrestigePoints()} PP</span>); facilities are rebuilt each run.</div>
    <div class="hq-grid">`;
  HQ_FACILITIES.forEach(f => {
    const lvl = getHQLevel(f.id);
    const maxed = f.maxLevel !== null && lvl >= f.maxLevel;
    const cost = getHQCost(f.id);
    const canBuy = !maxed && G.money >= cost;
    html += `
      <div class="hq-card">
        <div class="hq-head"><span class="hq-icon">${f.icon}</span><span class="hq-name">${f.name}</span>
          <span class="hq-level">Lv ${lvl}${f.maxLevel !== null ? '/' + f.maxLevel : ''}</span></div>
        <div class="hq-desc">${f.description}</div>
        <div class="hq-effect">Now: ${lvl > 0 ? _hqEffectText(f.id) : 'no effect yet'}</div>
        <button class="btn hq-buy-btn ${canBuy ? '' : 'disabled'}" data-hq="${f.id}" ${canBuy ? '' : 'disabled'}>
          ${maxed ? 'MAX' : '$' + formatNumber(cost)}
        </button>
      </div>`;
  });
  html += '</div>';
  container.innerHTML = html;

  container.querySelectorAll('.hq-buy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const result = buyHQ(btn.dataset.hq);
      if (!result.ok) addNotification(result.msg, 'error');
      renderHQ();
    });
  });
}

// Keep HQ buy buttons in sync with money without rebuilding the panel
function updateHQLive() {
  if (_activeTab !== 'hq') return;
  document.querySelectorAll('.hq-buy-btn').forEach(btn => {
    const f = HQ_FACILITIES.find(x => x.id === btn.dataset.hq);
    const maxed = f.maxLevel !== null && getHQLevel(f.id) >= f.maxLevel;
    const canBuy = !maxed && G.money >= getHQCost(f.id);
    if (btn.disabled === canBuy) renderHQ();
  });
}

// ─── Fast UI Refresh (HUD only — no DOM reconstruction) ─────────────────────

function fastRefresh() {
  try {
    updateCurrencyBar();
    renderNotifications();
    updateGarageLive();
    updateChampLive();
    updateSeasonLive();
    updateHQLive();
    updateSponsorsLive();
    updateDriversLive();
  } catch (e) {
    console.error('[fastRefresh] error:', e);
  }
}

// Free scout countdown on the Drivers tab
function updateDriversLive() {
  if (_activeTab !== 'drivers') return;
  const btn = document.querySelector('.scout-btn[data-tier="C"]');
  if (!btn) return;
  const wait = getFreeScoutWait();
  const label = wait > 0 ? `Free in ${Math.ceil(wait)}s` : 'Free Scout';
  if (btn.textContent.trim() !== label) btn.textContent = label;
  btn.disabled = wait > 0;
  btn.classList.toggle('disabled', wait > 0);
}

// ─── Targeted in-place garage updates ────────────────────────────────────────

function updateGarageLive() {
  if (_activeTab !== 'garage') return;

  G.cars.forEach(car => {
    UPGRADE_ORDER.forEach(upgId => {
      const btn = document.querySelector(`.upg-btn[data-car="${car.id}"][data-upg="${upgId}"]`);
      if (!btn) return;
      const lvl = car.upgrades[upgId];
      const maxed = lvl >= UPGRADES[upgId].maxLevel;
      if (!maxed) {
        const cost = getEffectiveUpgradeCost(upgId, lvl, car.classId);
        const canAfford = G.money >= cost;
        btn.textContent = '$' + formatNumber(cost);
        btn.disabled = !canAfford;
        btn.classList.toggle('disabled', !canAfford);
      }
    });
  });

  // Pit crew buttons
  const trainBtn = document.getElementById('crew-train-btn');
  if (trainBtn && G.pitCrew.level < PIT_CREW.maxLevel) trainBtn.disabled = G.money < getPitCrewLevelCost();
  const expandBtn = document.getElementById('crew-expand-btn');
  if (expandBtn && G.pitCrew.size < PIT_CREW.maxSize) expandBtn.disabled = G.money < getPitCrewSizeCost();

  // Garage upgrade button affordability
  const totalSlots  = getGarageSlots(G.garageLevel);
  const usedSlots   = G.cars.length;
  const nextUpgrade = getGarageNextUpgrade(G.garageLevel);

  const slotsUsedEl = document.getElementById('garage-slots-used');
  if (slotsUsedEl) slotsUsedEl.textContent = `${usedSlots} / ${totalSlots}`;

  const garageBtn = document.getElementById('garage-upgrade-btn');
  if (garageBtn && nextUpgrade) {
    const canUpgrade = G.money >= nextUpgrade.cost && G.reputation >= nextUpgrade.repRequired;
    garageBtn.disabled = !canUpgrade;
    garageBtn.classList.toggle('disabled', !canUpgrade);
  }

  // Buy-car button affordability
  document.querySelectorAll('.buy-car-btn').forEach(btn => {
    const cls = getCarClassById(btn.dataset.class);
    if (!cls) return;
    const owned        = G.cars.filter(c => c.classId === cls.id).length;
    const garageSlotOk = usedSlots < totalSlots;
    const canBuy = G.reputation >= cls.repRequired &&
                   (!cls.ppRequired || G.prestigePoints >= cls.ppRequired) &&
                   G.money >= cls.baseCost &&
                   owned < cls.maxOwned &&
                   garageSlotOk;
    btn.disabled = !canBuy;
    btn.classList.toggle('disabled', !canBuy);
  });
}

// ─── Targeted in-place championship updates ───────────────────────────────────

let _seasonRenderSig = 0;
function updateSeasonLive() {
  if (_activeTab !== 'prestige') return;
  if (_seasonRenderSig !== G.season) { _seasonRenderSig = G.season; renderPrestige(); return; }
  const t = document.getElementById('season-clock-time');
  if (t) t.textContent = formatClock(getSeasonTimeLeft());
  const bar = document.getElementById('season-clock-bar');
  if (bar) bar.style.width = (100 - getSeasonTimeLeft() / SEASON_LENGTH_SEC * 100) + '%';
}

let _champRenderSig = '';
function updateChampLive() {
  if (_activeTab !== 'championships') return;
  const sig = G.season + '#' + G.activeChampionships.map(e => e.id + ':' + e.currentRound).join('|')
    + '#' + (G.registrations || []).map(r => r.id).join('|');
  if (sig !== _champRenderSig) { _champRenderSig = sig; renderChampionships(); return; }

  const now = Date.now();
  G.activeChampionships.forEach(entry => {
    const card = document.querySelector(`.champ-active-card[data-entry="${entry.id}"]`);
    if (!card) return;
    const champDef = getChampionshipById(entry.definitionId);
    const elapsed = (now - entry.roundStartTime) / 1000;
    const pct = Math.min(100, (elapsed / champDef.roundDurationSec) * 100);
    const remaining = Math.max(0, champDef.roundDurationSec - elapsed);

    const bar = card.querySelector('.round-progress-bar');
    if (bar) bar.style.width = pct + '%';
    const timer = card.querySelector('[data-live-timer]');
    if (timer) {
      const isFinalRound = entry.currentRound + 1 >= entry.maxRounds;
      timer.textContent = remaining <= 0
        ? (isFinalRound ? 'Championship finishing…' : 'Round finishing…')
        : (isFinalRound ? `Final round ends in ${formatTime(remaining)}` : `Next round in ${formatTime(remaining)}`);
    }
    const roundEl = card.querySelector('.champ-round');
    if (roundEl) roundEl.textContent = `Round ${entry.currentRound + 1}/${entry.maxRounds}`;
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function initUI() {
  // Tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  const renameBtn = document.getElementById('hud-rename-btn');
  if (renameBtn) renameBtn.addEventListener('click', startTeamRename);

  const versionBtn = document.getElementById('version-btn');
  versionBtn.textContent = 'v' + GAME_VERSION;
  versionBtn.addEventListener('click', () => showChangelog());

  // Initial render
  switchTab('garage');
  updateCurrencyBar();
  _showUnseenChangelog();

  // UI refresh loop — HUD + targeted in-place updates only, no DOM reconstruction
  setInterval(fastRefresh, 100);

  // Offer a reload when a new version is published
  setInterval(checkForUpdate, UPDATE_CHECK_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
  checkForUpdate();
}
