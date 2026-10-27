'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

let _activeTab = 'garage';
let _uiInterval = null;
let _lastNotifCount = 0;
let _selectedCarForChamp = null;
let _signingSlotIndex = null;  // 0–4 or null
let _hiringTP = false;
let _tpCandidates = [];
let _hiringRECarId = null;     // carId being hired for, or null
let _reCandidates = [];
let _confirmingReset = false;
let _confirmSellCarId = null;
let _confirmingPrestige = false;

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

// ─── Currency Bar ─────────────────────────────────────────────────────────────

function updateCurrencyBar() {
  document.getElementById('hud-money').textContent = '$' + formatNumber(G.money);
  document.getElementById('hud-rep').textContent = formatNumber(G.reputation) + ' REP';
  document.getElementById('hud-pp').textContent = G.prestigePoints + ' PP';
  document.getElementById('hud-ips').textContent = '$' + formatNumber(calcTotalIncomePerSec()) + '/s';
  document.getElementById('hud-season-label').textContent = 'Season ' + G.season;
  document.getElementById('hud-season').textContent = formatClock(getSeasonTimeLeft());
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

    let lockMsg = '';
    if (!repOk)          lockMsg = `Requires ${formatNumber(cls.repRequired)} REP`;
    else if (!ppOk)      lockMsg = `Requires ${cls.ppRequired} PP`;
    else if (!garageSlotOk) lockMsg = 'Expand your garage';
    else if (!classSlotOk)  lockMsg = `Max ${cls.maxOwned} owned`;

    buyCarsHtml += `
      <div class="buy-car-card ${locked ? 'locked' : ''}" style="--cls-color: ${cls.color}">
        <div class="cls-tier">Tier ${cls.tier}</div>
        <div class="cls-name" style="color: ${cls.color}">${cls.name}</div>
        <div class="cls-owned" data-live-owned="${cls.id}">${owned}/${cls.maxOwned}</div>
        ${lockMsg ? `<div class="cls-lock">${lockMsg}</div>` : ''}
        <button class="btn buy-car-btn ${canBuy ? '' : 'disabled'}"
          data-class="${cls.id}" ${canBuy ? '' : 'disabled'}>
          $${formatNumber(cls.baseCost)}
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
              ${G.cars.length > 1 && !car.championshipId
                ? `<button class="btn btn-danger sell-car-btn" data-car="${car.id}">${_confirmSellCarId === car.id ? 'Confirm sell' : 'Sell'} $${formatNumber(getCarSellValue(car))}</button>`
                : ''}
            </div>
          </div>
          <div class="car-meta">
            <span class="meta-pill ${driver ? 'has-driver' : ''}">
              ${driver
                ? (() => {
                    const s = getCareerStage(driver.age || 20);
                    return `🏎 ${driver.name} · <span style="color:${s.color}">${s.label} ${s.trajectory}</span> · Pace ${driver.pace}`;
                  })()
                : '⚡ No Driver'}
            </span>
            <span class="meta-pill ${activeChamp ? 'in-champ' : ''}">
              ${activeChamp ? '🏁 ' + champDef.shortName + ' R' + activeChamp.currentRound + '/' + activeChamp.maxRounds : '◯ No Championship'}
            </span>
          </div>
          ${reHtml}
          <div class="upgrades-section">${upgradesHtml}</div>
        </div>`;
    });
  }
  carsHtml += '</div>';

  container.innerHTML = garageHtml + buyCarsHtml + carsHtml;

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
  container.querySelectorAll('.buy-car-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      const result = buyCar(btn.dataset.class);
      if (!result.ok) addNotification(result.msg, 'error');
      renderGarage();
    });
  });

  // Sell buttons: first click arms, second click sells
  container.querySelectorAll('.sell-car-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (_confirmSellCarId !== btn.dataset.car) {
        _confirmSellCarId = btn.dataset.car;
      } else {
        const result = sellCar(btn.dataset.car);
        if (!result.ok) addNotification(result.msg, 'error');
        _confirmSellCarId = null;
      }
      renderGarage();
    });
  });

  // Upgrade buttons
  container.querySelectorAll('.upg-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      const result = buyUpgrade(btn.dataset.car, btn.dataset.upg);
      if (!result.ok) addNotification(result.msg, 'error');
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
      const rating = car ? Math.round(calcCarRating(car, champDef.format)) : 0;
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

  // Available championships
  let availHtml = '<div class="section-header">ENTER CHAMPIONSHIP</div>';

  // Car selector
  availHtml += `
    <div class="champ-car-selector">
      <label>Select Car:</label>
      <select id="champ-car-select">
        <option value="">— choose —</option>
        ${G.cars.map(c => {
          const inChamp = c.championshipId !== null;
          const noDriver = !c.driverId;
          return `<option value="${c.id}" ${inChamp || noDriver ? 'disabled' : ''} ${c.id === _selectedCarForChamp ? 'selected' : ''}>
            ${c.name} · ★ ${Math.round(calcCarRating(c))}${inChamp ? ' (in championship)' : noDriver ? ' (no driver)' : ''}
          </option>`;
        }).join('')}
      </select>
    </div>`;

  availHtml += '<div class="champ-grid">';
  CHAMPIONSHIPS.forEach(champDef => {
    if (champDef.pathway === 'single_seater' && !isSingleSeaterUnlocked()) return;
    const repOk    = G.reputation >= (champDef.repRequired || 0);
    const prereqOk = checkChampionshipPrerequisite(champDef);
    const hardLocked = !repOk || !prereqOk;
    const canAfford  = G.money >= champDef.entryFee;
    const timeOk     = fitsInSeason(champDef);
    const canEnter   = !hardLocked && canAfford && timeOk;
    const completions = G.champCompletions[champDef.id] || 0;
    const selCar = _selectedCarForChamp ? G.cars.find(c => c.id === _selectedCarForChamp) : null;
    const selFits = selCar && champDef.allowedClasses.includes(selCar.classId);
    const fieldClass = selFits ? selCar.classId : champDef.allowedClasses[0];
    const fieldStr = getFieldStrength(champDef, fieldClass);
    const p1Prize = getRoundPrize(champDef, fieldClass);
    const selRating = selFits ? Math.round(calcCarRating(selCar, champDef.format)) : null;
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
      lockReasons.push(`<span class="lock-reason money">💰 $${formatNumber(champDef.entryFee)} entry fee</span>`);
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
          <span>🌧 ${Math.round((champDef.wetChance || 0) * 100)}% wet</span>
          <span>🏁 Field ★ ${fieldStr}${selRating !== null ? ` · yours ★ ${selRating}` : ''}</span>
          <span>💰 P1 $${formatNumber(p1Prize)}/round</span>
          <span>📈 P1 +${champDef.repPerRound} REP</span>
        </div>
        ${lockReasons.length > 0 ? `<div class="champ-lock-reasons">${lockReasons.join('')}</div>` : ''}
        <button class="btn enter-champ-btn ${canEnter ? '' : 'disabled'}"
          data-champ="${champDef.id}" ${canEnter ? '' : 'disabled'}>
          Enter — $${formatNumber(champDef.entryFee)}
        </button>
      </div>`;
  });
  availHtml += '</div>';

  container.innerHTML = activeHtml + availHtml;

  // Bind events
  container.querySelector('#champ-car-select').addEventListener('change', e => {
    _selectedCarForChamp = e.target.value || null;
    renderChampionships();
  });

  container.querySelectorAll('.enter-champ-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_selectedCarForChamp) {
        addNotification('Select a car first.', 'error');
        return;
      }
      const result = enterChampionship(btn.dataset.champ, _selectedCarForChamp);
      if (!result.ok) addNotification(result.msg, 'error');
      else addNotification('Entered championship!', 'success');
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

function renderLastRound(entry) {
  const r = entry.lastRound;
  if (!r) return '<span class="champ-last">Lights out soon</span>';
  const wet = r.wet ? ' 🌧' : '';
  if (r.dns) return `<span class="champ-last bad">Last: DNS${wet}</span>`;
  if (r.dnf) return `<span class="champ-last bad">Last: DNF${wet}</span>`;
  return `<span class="champ-last ${r.pos <= 3 ? 'good' : ''}">Last: P${r.pos}${wet} · +$${formatNumber(r.prize)}</span>`;
}

function renderResultStrip(entry) {
  if (!entry.results || entry.results.length === 0) return '';
  const cells = entry.results.map(res => {
    const cls = typeof res !== 'number' ? 'res-dnf' : res === 1 ? 'res-win' : res <= 3 ? 'res-podium' : res <= 10 ? 'res-points' : '';
    return `<span class="res-cell ${cls}">${res}</span>`;
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

  // Find the first visible license not yet held — show its progress
  const nextTier = visibleTiers.find(lt => !licenses.includes(lt.id));
  let progressHtml = '';
  if (nextTier) {
    const current = licensePoints[nextTier.id] || 0;
    const pct     = Math.min(100, Math.floor(current / nextTier.pointsRequired * 100));
    progressHtml = `
      <div class="dlicense-progress-row">
        <span class="dlicense-next-name">${nextTier.name} License</span>
        <span class="dlicense-pts">${current} / ${nextTier.pointsRequired} LP</span>
        <div class="dlicense-bar-wrap"><div class="dlicense-bar-fill" style="width:${pct}%"></div></div>
      </div>`;
  }

  return `<div class="driver-licenses">${heldHtml ? `<div class="dlicense-row">${heldHtml}</div>` : ''}${progressHtml}</div>`;
}

// ─── Drivers Panel ────────────────────────────────────────────────────────────

function renderDrivers() {
  const container = document.getElementById('panel-drivers');

  // Scout section — C/B/A/S purchasable; L locked
  let scoutHtml = '<div class="section-header">SCOUT DRIVERS</div><div class="scout-grid">';
  ['C', 'B', 'A', 'S', 'L'].forEach(tier => {
    const def = DRIVER_TIERS[tier];
    const cfg = DRIVER_STAT_CONFIG[tier];
    const isLocked = def.locked;
    const canAfford = !isLocked && G.money >= def.scoutCost;

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
        ${isLocked
          ? `<div class="scout-locked-msg">Unlocked via Prestige</div>`
          : `<button class="btn scout-btn ${canAfford ? '' : 'disabled'}"
               data-tier="${tier}" ${canAfford ? '' : 'disabled'}>
               ${def.scoutCost === 0 ? 'Free Scout' : '$' + formatNumber(def.scoutCost)}
             </button>`
        }
      </div>`;
  });
  scoutHtml += '</div>';

  // Driver roster
  let rosterHtml = '<div class="section-header">DRIVER ROSTER</div>';
  if (G.drivers.length === 0) {
    rosterHtml += '<div class="empty-state">No drivers signed. Scout above.</div>';
  } else {
    rosterHtml += '<div class="driver-list">';
    G.drivers.forEach(driver => {
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
        <div class="driver-card ${age >= 38 ? 'driver-retiring' : ''}">
          <div class="driver-info">
            <div class="driver-name">${driver.name}</div>
            <div class="driver-tier" style="color: ${tierDef.color}">${tierDef.name}</div>
            <div class="driver-primary-badge" style="color: ${tierDef.color}">★ ${primaryLabel}</div>
            <div class="driver-career-row">
              <span class="driver-age">Age ${age}</span>
              <span class="driver-stage-badge" style="color:${stage.color};border-color:${stage.color}">${stage.label} ${stage.trajectory}</span>
              ${retiringLabel ? `<span class="driver-retiring-badge">${retiringLabel}</span>` : ''}
            </div>
          </div>
          <div class="driver-stats-grid">${statsHtml}</div>
          <div class="driver-meta">
            <span class="driver-xp">XP ${Math.floor(driver.xp)}</span>
            <span class="driver-ret-age">Retires ~${retAge}</span>
          </div>
          ${renderDriverLicenses(driver)}
          <div class="driver-assign">
            <select class="assign-car-select" data-driver="${driver.id}">
              <option value="">Unassigned</option>
              ${G.cars.map(c => `<option value="${c.id}" ${driver.carId === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-danger fire-driver-btn" data-driver="${driver.id}" title="Release driver">✕</button>
        </div>`;
    });
    rosterHtml += '</div>';
  }

  container.innerHTML = scoutHtml + rosterHtml;

  container.querySelectorAll('.scout-btn:not([disabled])').forEach(btn => {
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
        const result = assignDriver(driverId, carId);
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
        <span class="sponsor-overview-label">Total Sponsor Income</span>
        <span class="sponsor-overview-ips" id="sponsor-total-ips">$${formatNumber(totalIps)}/s</span>
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
          <div class="sponsor-ips-value">$8/s</div>
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
      if (sponsor.bonusPP > 0)   bonusParts.push(`+${sponsor.bonusPP} PP`);
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
                <div class="sponsor-ips-value" data-live-sponsor-ips="${sponsor.id}">$${formatNumber(sponsor.incomePerSec)}/s</div>
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
  if (_signingSlotIndex !== null) {
    html += `
      <div class="section-header">SPONSOR OFFERS — Slot ${_signingSlotIndex + 1} · Season ${G.season}</div>`;
    if (offers.length === 0) html += '<div class="empty-state">No offers left this season. New sponsors approach you next season.</div>';
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
      if (opt.bonusPP > 0)   bonusParts.push(`+${opt.bonusPP} PP`);
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
  container.querySelectorAll('.sign-sponsor-btn:not([disabled])').forEach(btn => {
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
      const result = terminateSponsor(btn.dataset.id);
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

  G.sponsors.forEach(s => {
    if (!s) return;
    const ipsEl = document.querySelector(`[data-live-sponsor-ips="${s.id}"]`);
    if (ipsEl) ipsEl.textContent = '$' + formatNumber(s.incomePerSec) + '/s';

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

function renderStaff() {
  const container = document.getElementById('panel-staff');
  const tp = G.teamPrincipal;

  // ── Season salary preview
  let totalSalary = tp ? tp.salary : 0;
  if (G.raceEngineers) Object.values(G.raceEngineers).forEach(re => { totalSalary += re.salary; });

  let html = `
    <div class="section-header">STAFF</div>
    <div class="staff-overview-bar">
      <div class="staff-overview-stat">
        <span class="staff-overview-label">Season Salary Bill</span>
        <span class="staff-overview-value" style="color:var(--red)">${totalSalary > 0 ? '-$' + formatNumber(totalSalary) + '/season' : 'No salaries'}</span>
      </div>
    </div>`;

  // ── Team Principal section
  html += `<div class="section-header">TEAM PRINCIPAL</div>`;

  if (_hiringTP) {
    html += `<div class="staff-section-desc">Choose your Team Principal:</div>`;
    html += _renderStaffCandidateGrid(_tpCandidates, TP_STAT_KEYS, TP_STAT_LABELS, TP_TIERS, 'tp-idx', 'cancel-tp');
  } else if (!tp) {
    html += `
      <div class="staff-empty">
        <span>No Team Principal. Hire one to unlock bonuses.</span>
        <button class="btn" id="start-hire-tp">Hire Team Principal</button>
      </div>`;
  } else {
    const tpTierDef = TP_TIERS[tp.tier];
    const buyout = Math.floor(tpTierDef.hireCost * 0.25);
    const statsHtml = _renderStaffStatBlock(tp, TP_STAT_KEYS, TP_STAT_LABELS);
    const bonuses = getTPBonuses();
    html += `
      <div class="staff-card" style="--staff-color: ${tpTierDef.color}">
        <div class="staff-card-header">
          <div>
            <div class="staff-name">${tp.name}</div>
            <div class="staff-tier-label" style="color:${tpTierDef.color}">${tpTierDef.label} · Team Principal</div>
          </div>
          <div class="staff-salary-badge">${tp.salary > 0 ? '$' + formatNumber(tp.salary) + '/season' : 'No salary'}</div>
        </div>
        <div class="staff-stats-grid">${statsHtml}</div>
        <div class="staff-bonuses">
          <span>+${(bonuses.paceMult*100).toFixed(1)}% pace</span>
          <span>+${bonuses.strategyRep} REP/round</span>
          <span>-${((1-bonuses.upgradeCostMult)*100).toFixed(0)}% upgrades</span>
          <span>+${(bonuses.sponsorMult*100).toFixed(1)}% sponsors</span>
          <span>-${((1-bonuses.scoutCostMult)*100).toFixed(0)}% scouting</span>
        </div>
        <div class="staff-card-actions">
          <button class="btn btn-danger fire-tp-btn">Fire</button>
          <button class="btn upgrade-tp-btn">${buyout > 0 ? 'Replace (buyout $' + formatNumber(buyout) + ')' : 'Replace'}</button>
        </div>
      </div>`;
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
          <button class="btn hire-re-btn" data-car="${car.id}">Hire RE</button>
        </div>`;
      } else {
        const reTierDef = RE_TIERS[re.tier];
        const buyout = Math.floor(reTierDef.hireCost * 0.25);
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
              <span>+${(reB.setupBonus*100).toFixed(0)}% upgrades</span>
              <span>+${(reB.reliBonus*100).toFixed(0)}% reliability</span>
              <span>+${(reB.pitBonus*100).toFixed(1)}% income</span>
              <span>+${(reB.coachBonus*100).toFixed(0)}% XP</span>
              <span>+${(reB.dataBonus*100).toFixed(0)}% payout</span>
            </div>
            <div class="staff-card-actions">
              <button class="btn btn-danger fire-re-btn" data-car="${car.id}">Fire</button>
              <button class="btn hire-re-btn" data-car="${car.id}">${buyout > 0 ? 'Replace ($' + formatNumber(buyout) + ')' : 'Replace'}</button>
            </div>
          </div>`;
      }

      html += `</div>`; // end staff-re-row
    });
  }

  container.innerHTML = html;

  // ── Events: hire TP
  const startHireTPBtn = container.querySelector('#start-hire-tp');
  if (startHireTPBtn) {
    startHireTPBtn.addEventListener('click', () => {
      _hiringTP = true;
      _tpCandidates = generateTPOptions();
      renderStaff();
    });
  }

  // Upgrade/Replace TP button
  const upgradeTPBtn = container.querySelector('.upgrade-tp-btn');
  if (upgradeTPBtn) {
    upgradeTPBtn.addEventListener('click', () => {
      _hiringTP = true;
      _tpCandidates = generateTPOptions();
      renderStaff();
    });
  }

  // Hire TP from candidates
  container.querySelectorAll('[data-tp-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cand = _tpCandidates[parseInt(btn.dataset.tpIdx)];
      const result = hireTP(cand);
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
  const fireTPBtn = container.querySelector('.fire-tp-btn');
  if (fireTPBtn) {
    fireTPBtn.addEventListener('click', () => {
      fireTP();
      renderStaff();
    });
  }

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

  // Fire RE buttons
  container.querySelectorAll('.fire-re-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      fireRE(btn.dataset.car);
      renderStaff();
    });
  });
}

// ─── Prestige Panel ───────────────────────────────────────────────────────────

function renderPrestige() {
  const container = document.getElementById('panel-prestige');

  // ── Season clock
  const completedThisSeason = G.completedChampionships.filter(c => c.season === G.season);
  let totalSalary = G.teamPrincipal ? (G.teamPrincipal.salary || 0) : 0;
  if (G.raceEngineers) Object.values(G.raceEngineers).forEach(re => { totalSalary += re.salary || 0; });
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
        <span>Salaries due: ${totalSalary > 0 ? '$' + formatNumber(totalSalary) : 'none'}</span>
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
  html += `
    <div class="section-header">PRESTIGE RESET</div>
    <div class="prestige-info">
      <div class="prestige-pp">You have <span class="pp-value">${G.prestigePoints} PP</span></div>
      <div class="prestige-gain">Resetting now grants <span class="pp-gain">+${ppGain} PP</span>
        <span class="prestige-warning">(titles and podiums since the last reset, 1 PP per ${formatNumber(PRESTIGE_REP_PER_PP)} REP gained, ${HQ_PP_PER_LEVEL} PP per HQ level)</span></div>
      <div class="prestige-warning">Starts the team over: $5,000, one stock GT4 (plus a car per Development Token), no sponsors, HQ rebuilt. Drivers, licenses, REP, garage, staff and PP stay.
        ${(G.prestige.prestigeCount || 0) === 0 ? '<br>Your first reset unlocks the <b>Single-Seater Pathway</b> (F4 → F1).' : ''}</div>
      <button class="btn btn-prestige ${canP ? '' : 'disabled'}" id="prestige-btn" ${canP ? '' : 'disabled'}>
        ${!canP ? `Earn ${PRESTIGE_MIN_GAIN} PP to reset · ${ppGain} so far` : _confirmingPrestige ? `Confirm reset — +${ppGain} PP` : `Prestige — +${ppGain} PP`}
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

  // Events — prestige (two clicks)
  const prestigeBtn = container.querySelector('#prestige-btn:not([disabled])');
  if (prestigeBtn) {
    prestigeBtn.addEventListener('click', () => {
      if (!_confirmingPrestige) { _confirmingPrestige = true; renderPrestige(); return; }
      _confirmingPrestige = false;
      const result = doPrestige();
      if (!result.ok) addNotification(result.msg, 'error');
      renderPrestige();
    });
  }

  container.querySelectorAll('.prestige-buy-btn:not([disabled])').forEach(btn => {
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
  if (id === 'composites')  return `-${lvl * 3}% upgrade costs`;
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

  container.querySelectorAll('.hq-buy-btn:not([disabled])').forEach(btn => {
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
  } catch (e) {
    console.error('[fastRefresh] error:', e);
  }
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
  const sig = G.activeChampionships.map(e => e.id + ':' + e.currentRound).join('|');
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

  // Initial render
  switchTab('garage');
  updateCurrencyBar();

  // UI refresh loop — HUD + targeted in-place updates only, no DOM reconstruction
  setInterval(fastRefresh, 100);
}
