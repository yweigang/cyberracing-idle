'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

let _activeTab = 'garage';
let _uiInterval = null;
let _lastNotifCount = 0;
let _selectedCarForChamp = null;
let _signingSlotIndex = null;  // 0–4 or null
let _sponsorOptions = [];      // array of 3 generated sponsor objects
let _hiringTP = false;
let _tpCandidates = [];
let _hiringRECarId = null;     // carId being hired for, or null
let _reCandidates = [];
let _confirmingEndSeason = false;

// ─── Tab Navigation ───────────────────────────────────────────────────────────

function switchTab(tabId) {
  _activeTab = tabId;
  // Clear transient state on tab switch
  _hiringTP = false; _tpCandidates = [];
  _hiringRECarId = null; _reCandidates = [];
  _confirmingEndSeason = false;
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
    case 'prestige':      renderPrestige(); break;
  }
}

// ─── Currency Bar ─────────────────────────────────────────────────────────────

function updateCurrencyBar() {
  document.getElementById('hud-money').textContent = '$' + formatNumber(G.money);
  document.getElementById('hud-rep').textContent = formatNumber(G.reputation) + ' REP';
  document.getElementById('hud-pp').textContent = G.prestigePoints + ' PP';
  document.getElementById('hud-ips').textContent = '$' + formatNumber(calcTotalIncomePerSec()) + '/s';
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
        <div class="cls-income">$${formatNumber(cls.baseIncomePerLap / cls.lapTimeSec)}/s base</div>
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
        const cost = getEffectiveUpgradeCost(upgId, lvl);
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

      // Upgrade multiplier total
      const totalMult = (
        UPGRADES.engine.getIncomeMult(car.upgrades.engine) *
        UPGRADES.aero.getIncomeMult(car.upgrades.aero) *
        UPGRADES.tyres.getIncomeMult(car.upgrades.tyres) *
        UPGRADES.brakes.getIncomeMult(car.upgrades.brakes) *
        UPGRADES.reliability.getIncomeMult(car.upgrades.reliability)
      ).toFixed(2);

      const paceMult = calcDriverPaceMult(car);

      carsHtml += `
        <div class="car-card" style="--cls-color: ${cls.color}">
          <div class="car-header">
            <div>
              <div class="car-name">${car.name}</div>
              <div class="car-class" style="color: ${cls.color}">${cls.fullName}</div>
            </div>
            <div class="car-stats-right">
              <div class="car-mult">×${totalMult} upgrades · ×${paceMult.toFixed(2)} pace</div>
            </div>
          </div>
          <div class="car-meta">
            <span class="meta-pill ${driver ? 'has-driver' : ''}">
              ${driver ? '🏎 ' + driver.name + ' (Pace ' + driver.pace + ')' : '⚡ No Driver'}
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

      activeHtml += `
        <div class="champ-active-card" data-entry="${entry.id}" style="--cls-color: ${champDef.color}">
          <div class="champ-active-header">
            <div>
              <div class="champ-name" style="color: ${champDef.color}">${champDef.name}</div>
              <div class="champ-car">${car ? car.name : 'Unknown car'}</div>
            </div>
            <div class="champ-round">Round ${entry.currentRound + 1}/${entry.maxRounds}</div>
          </div>
          <div class="round-progress-wrap">
            <div class="round-progress-bar" style="width: ${roundPct}%"></div>
          </div>
          <div class="champ-footer">
            <span data-live-timer>Next round in ${formatTime(remaining)}</span>
            <span>+${formatNumber(entry.repEarned)} REP earned</span>
            <button class="btn btn-danger withdraw-btn" data-entry="${entry.id}">Withdraw</button>
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
          return `<option value="${c.id}" ${inChamp ? 'disabled' : ''}>
            ${c.name}${inChamp ? ' (in championship)' : ''}
          </option>`;
        }).join('')}
      </select>
    </div>`;

  availHtml += '<div class="champ-grid">';
  CHAMPIONSHIPS.forEach(champDef => {
    const repOk    = G.reputation >= (champDef.repRequired || 0);
    const prereqOk = checkChampionshipPrerequisite(champDef);
    const hardLocked = !repOk || !prereqOk;
    const canAfford  = G.money >= champDef.entryFee;
    const canEnter   = !hardLocked && canAfford;
    const completions = G.champCompletions[champDef.id] || 0;

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

    availHtml += `
      <div class="champ-card ${hardLocked ? 'champ-locked' : ''}" style="--cls-color: ${champDef.color}">
        <div class="champ-card-header">
          <div class="champ-card-name" style="color: ${hardLocked ? '#555' : champDef.color}">${hardLocked ? '🔒 ' : ''}${champDef.name}</div>
          ${completions > 0 ? `<div class="champ-completions">✓ ${completions}×</div>` : ''}
        </div>
        <div class="champ-classes">${champDef.allowedClasses.join(', ')}</div>
        <div class="champ-desc">${champDef.description}</div>
        <div class="champ-stats">
          <span>📅 ${champDef.rounds} rounds</span>
          <span>⏱ ${champDef.roundDurationSec}s/round</span>
          <span>📈 +${champDef.repPerRound} REP/round</span>
          <span>💹 +${Math.round(champDef.incomeBonus * 100)}% income</span>
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

  container.querySelectorAll('.withdraw-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      withdrawFromChampionship(btn.dataset.entry);
      addNotification('Withdrawn from championship.', 'info');
      renderChampionships();
    });
  });
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
        <div class="driver-card">
          <div class="driver-info">
            <div class="driver-name">${driver.name}</div>
            <div class="driver-tier" style="color: ${tierDef.color}">${tierDef.name}</div>
            <div class="driver-primary-badge" style="color: ${tierDef.color}">★ ${primaryLabel}</div>
          </div>
          <div class="driver-stats-grid">${statsHtml}</div>
          <div class="driver-meta">
            <span class="driver-xp">XP ${Math.floor(driver.xp)}</span>
          </div>
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
        assignDriver(driverId, carId);
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
      const targetLbl = SPONSOR_TARGET_LABELS[sponsor.target] || '';
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
  if (_signingSlotIndex !== null && _sponsorOptions.length > 0) {
    html += `
      <div class="section-header">CHOOSE SPONSOR — Slot ${_signingSlotIndex + 1}</div>
      <div class="sponsor-options-grid">`;

    _sponsorOptions.forEach((opt, idx) => {
      const catDef  = SPONSOR_CATEGORIES.find(c => c.id === opt.category);
      const tierDef = SPONSOR_TIERS[opt.tier];
      const contractLbl = opt.seasonsRemaining !== null
        ? `${opt.seasonsRemaining} season${opt.seasonsRemaining !== 1 ? 's' : ''}`
        : 'Ongoing';
      const targetLbl = SPONSOR_TARGET_LABELS[opt.target] || '';

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
          <button class="btn choose-sponsor-btn" data-idx="${idx}">Sign Deal</button>
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
      _sponsorOptions = generateSponsorOptions();
      renderSponsors();
    });
  });

  // Events — choose deal
  container.querySelectorAll('.choose-sponsor-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const opt = _sponsorOptions[parseInt(btn.dataset.idx)];
      const result = signSponsor(_signingSlotIndex, opt);
      if (result.ok) {
        _signingSlotIndex = null;
        _sponsorOptions = [];
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
      _sponsorOptions = [];
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
      const lbl = SPONSOR_TARGET_LABELS[s.target] || '';
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
  const canEnd = canEndSeason();

  // ── Season summary
  const completedThisSeason = G.completedChampionships.filter(c => c.season === G.season);
  const abandonList = G.activeChampionships.map(e => {
    const def = getChampionshipById(e.definitionId);
    const car = G.cars.find(c => c.id === e.carId);
    return `${def ? def.shortName : e.definitionId} — ${car ? car.name : 'unknown'} (Round ${e.currentRound + 1}/${e.maxRounds})`;
  });
  const assignedDrivers = G.drivers.filter(d => d.carId !== null);
  let totalSalary = G.teamPrincipal ? (G.teamPrincipal.salary || 0) : 0;
  if (G.raceEngineers) Object.values(G.raceEngineers).forEach(re => { totalSalary += re.salary || 0; });

  // ── End Season section
  let html = `<div class="section-header">END SEASON</div>`;

  if (_confirmingEndSeason) {
    // Confirmation panel
    let confirmRows = `
      <div class="confirm-row">
        <span class="confirm-label">Championships completed</span>
        <span class="confirm-value ok">${completedThisSeason.length}</span>
      </div>`;

    if (abandonList.length > 0) {
      confirmRows += `
        <div class="confirm-row">
          <span class="confirm-label">Will be abandoned</span>
          <span class="confirm-value warn">${abandonList.length} championship${abandonList.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="confirm-abandon-list">${abandonList.map(s => `<div class="confirm-abandon-item">✕ ${s}</div>`).join('')}</div>`;
    } else {
      confirmRows += `
        <div class="confirm-row">
          <span class="confirm-label">Abandoned championships</span>
          <span class="confirm-value">None</span>
        </div>`;
    }

    confirmRows += `
      <div class="confirm-row">
        <span class="confirm-label">Staff salaries deducted</span>
        <span class="confirm-value ${totalSalary > 0 ? 'warn' : ''}">${totalSalary > 0 ? '-$' + formatNumber(totalSalary) : 'None'}</span>
      </div>
      <div class="confirm-row">
        <span class="confirm-label">Driver aging</span>
        <span class="confirm-value">${assignedDrivers.length > 0 ? `${assignedDrivers.length} assigned driver${assignedDrivers.length !== 1 ? 's' : ''} age +1` : 'No assigned drivers'}</span>
      </div>`;

    html += `
      <div class="end-season-confirm">
        <div class="confirm-title">Confirm End Season ${G.season}?</div>
        <div class="confirm-details">${confirmRows}</div>
        <div class="confirm-actions">
          <button class="btn btn-danger" id="confirm-end-season-btn">End Season ${G.season}</button>
          <button class="btn" id="cancel-end-season-btn">Cancel</button>
        </div>
      </div>`;
  } else {
    // Normal state
    const endSeasonTooltip = canEnd ? '' : 'title="Complete at least one championship first"';
    html += `
      <div class="end-season-bar">
        <div class="end-season-info">
          <div class="end-season-label">Season ${G.season}</div>
          <div class="end-season-sub">${completedThisSeason.length} championship${completedThisSeason.length !== 1 ? 's' : ''} completed this season${abandonList.length > 0 ? ` · ${abandonList.length} in progress` : ''}</div>
        </div>
        <button class="btn end-season-btn ${canEnd ? '' : 'disabled'}"
          id="open-end-season-btn" ${canEnd ? '' : 'disabled'} ${endSeasonTooltip}>
          End Season
        </button>
      </div>`;
  }

  // ── Prestige section — disabled / WIP
  html += `
    <div class="section-header">PRESTIGE RESET</div>
    <div class="wip-screen">
      <div class="wip-icon">🚧</div>
      <div class="wip-title">Coming Soon</div>
      <div class="wip-desc">Prestige resets are not yet available. Focus on building up your season results for now.</div>
    </div>`;

  container.innerHTML = html;

  // Events — open confirmation
  const openBtn = container.querySelector('#open-end-season-btn');
  if (openBtn) {
    openBtn.addEventListener('click', () => {
      _confirmingEndSeason = true;
      renderPrestige();
    });
  }

  // Events — confirm end season
  const confirmBtn = container.querySelector('#confirm-end-season-btn');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      const result = endSeason();
      _confirmingEndSeason = false;
      if (!result.ok) addNotification(result.msg, 'error');
      renderPrestige();
    });
  }

  // Events — cancel
  const cancelBtn = container.querySelector('#cancel-end-season-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      _confirmingEndSeason = false;
      renderPrestige();
    });
  }

}

// ─── Fast UI Refresh (HUD only — no DOM reconstruction) ─────────────────────

function fastRefresh() {
  try {
    updateCurrencyBar();
    renderNotifications();
    updateGarageLive();
    updateChampLive();
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
        const cost = getUpgradeCost(upgId, lvl);
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

function updateChampLive() {
  if (_activeTab !== 'championships') return;

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
    if (timer) timer.textContent = 'Next round in ' + formatTime(remaining);
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
