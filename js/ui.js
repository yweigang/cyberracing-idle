'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

let _activeTab = 'garage';
let _uiInterval = null;
let _lastNotifCount = 0;
let _selectedCarForChamp = null;

// ─── Tab Navigation ───────────────────────────────────────────────────────────

function switchTab(tabId) {
  _activeTab = tabId;
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

  // ── Buy car section
  let buyCarsHtml = '<div class="section-header">BUY CAR</div><div class="buy-cars-grid">';
  CAR_CLASSES.forEach(cls => {
    const owned = G.cars.filter(c => c.classId === cls.id).length;
    const repOk = G.reputation >= cls.repRequired;
    const ppOk = cls.ppRequired === 0 || G.prestigePoints >= cls.ppRequired;
    const moneyOk = G.money >= cls.baseCost;
    const slotOk = owned < cls.maxOwned;
    const canBuy = repOk && ppOk && moneyOk && slotOk;
    const locked = !repOk || !ppOk;

    let lockMsg = '';
    if (!repOk) lockMsg = `Requires ${formatNumber(cls.repRequired)} REP`;
    else if (!ppOk) lockMsg = `Requires ${cls.ppRequired} PP`;

    buyCarsHtml += `
      <div class="buy-car-card ${locked ? 'locked' : ''}" style="--cls-color: ${cls.color}">
        <div class="cls-tier">Tier ${cls.tier}</div>
        <div class="cls-name" style="color: ${cls.color}">${cls.name}</div>
        <div class="cls-income">$${formatNumber(cls.baseIncomePerLap / cls.lapTimeSec)}/s base</div>
        <div class="cls-owned">${owned}/${cls.maxOwned} owned</div>
        ${locked ? `<div class="cls-lock">${lockMsg}</div>` : ''}
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
      const ips = calcCarIncomePerSec(car);
      const driver = car.driverId ? G.drivers.find(d => d.id === car.driverId) : null;
      const activeChamp = car.championshipId
        ? G.activeChampionships.find(c => c.id === car.championshipId) : null;
      const champDef = activeChamp ? getChampionshipById(activeChamp.definitionId) : null;

      // Upgrades
      let upgradesHtml = '';
      UPGRADE_ORDER.forEach(upgId => {
        const upg = UPGRADES[upgId];
        const lvl = car.upgrades[upgId];
        const cost = getUpgradeCost(upgId, lvl);
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

      // Mult breakdown
      const totalMult = (
        UPGRADES.engine.getIncomeMult(car.upgrades.engine) *
        UPGRADES.aero.getIncomeMult(car.upgrades.aero) *
        UPGRADES.tyres.getIncomeMult(car.upgrades.tyres) *
        UPGRADES.brakes.getIncomeMult(car.upgrades.brakes) *
        UPGRADES.reliability.getIncomeMult(car.upgrades.reliability)
      ).toFixed(2);

      carsHtml += `
        <div class="car-card" style="--cls-color: ${cls.color}">
          <div class="car-header">
            <div>
              <div class="car-name">${car.name}</div>
              <div class="car-class" style="color: ${cls.color}">${cls.fullName}</div>
            </div>
            <div class="car-stats-right">
              <div class="car-ips" data-live-ips="${car.id}">$${formatNumber(ips)}/s</div>
              <div class="car-mult">×${totalMult} total</div>
            </div>
          </div>
          <div class="car-meta">
            <span class="meta-pill ${driver ? 'has-driver' : ''}">
              ${driver ? '🏎 ' + driver.name + ' (Pace +' + driver.pace + '%)' : '⚡ No Driver'}
            </span>
            <span class="meta-pill ${activeChamp ? 'in-champ' : ''}">
              ${activeChamp ? '🏁 ' + champDef.shortName + ' R' + activeChamp.currentRound + '/' + activeChamp.maxRounds : '◯ No Championship'}
            </span>
          </div>
          <div class="upgrades-section">${upgradesHtml}</div>
        </div>`;
    });
  }
  carsHtml += '</div>';

  container.innerHTML = buyCarsHtml + carsHtml;

  // Bind events
  container.querySelectorAll('.buy-car-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      const result = buyCar(btn.dataset.class);
      if (!result.ok) addNotification(result.msg, 'error');
      renderGarage();
    });
  });
  container.querySelectorAll('.upg-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      const result = buyUpgrade(btn.dataset.car, btn.dataset.upg);
      if (!result.ok) addNotification(result.msg, 'error');
      renderGarage();
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
    const cost = champDef.entryFee;
    const canAfford = G.money >= cost;

    availHtml += `
      <div class="champ-card" style="--cls-color: ${champDef.color}">
        <div class="champ-card-name" style="color: ${champDef.color}">${champDef.name}</div>
        <div class="champ-classes">${champDef.allowedClasses.join(', ')}</div>
        <div class="champ-desc">${champDef.description}</div>
        <div class="champ-stats">
          <span>📅 ${champDef.rounds} rounds</span>
          <span>⏱ ${champDef.roundDurationSec}s/round</span>
          <span>📈 +${champDef.repPerRound} REP/round</span>
          <span>💹 +${Math.round(champDef.incomeBonus * 100)}% income</span>
        </div>
        <button class="btn enter-champ-btn ${canAfford ? '' : 'disabled'}"
          data-champ="${champDef.id}" ${canAfford ? '' : 'disabled'}>
          Enter — $${formatNumber(cost)}
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

  // Scout section
  let scoutHtml = '<div class="section-header">SCOUT DRIVERS</div><div class="scout-grid">';
  ['C', 'B', 'A'].forEach(tier => {
    const def = DRIVER_TIERS[tier];
    const canAfford = G.money >= def.scoutCost;
    scoutHtml += `
      <div class="scout-card" style="--tier-color: ${def.color}">
        <div class="scout-tier" style="color: ${def.color}">${def.name}</div>
        <div class="scout-rarity">${def.rarity}</div>
        <div class="scout-pace">Pace: +${def.paceRange[0]}–${def.paceRange[1]}%</div>
        <button class="btn scout-btn ${canAfford ? '' : 'disabled'}"
          data-tier="${tier}" ${canAfford ? '' : 'disabled'}>
          ${def.scoutCost === 0 ? 'Free Scout' : '$' + formatNumber(def.scoutCost)}
        </button>
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
      const assignedCar = driver.carId ? G.cars.find(c => c.id === driver.carId) : null;

      rosterHtml += `
        <div class="driver-card">
          <div class="driver-info">
            <div class="driver-name">${driver.name}</div>
            <div class="driver-tier" style="color: ${tierDef.color}">${tierDef.name}</div>
          </div>
          <div class="driver-stats">
            <span>Pace +${driver.pace}%</span>
            <span>Consistency ${driver.consistency}</span>
            <span>XP ${Math.floor(driver.xp)}</span>
          </div>
          <div class="driver-assign">
            <select class="assign-car-select" data-driver="${driver.id}">
              <option value="">Unassigned</option>
              ${G.cars.map(c => `<option value="${c.id}" ${driver.carId === c.id ? 'selected' : ''}>
                ${c.name}
              </option>`).join('')}
            </select>
          </div>
        </div>`;
    });
    rosterHtml += '</div>';
  }

  container.innerHTML = scoutHtml + rosterHtml;

  container.querySelectorAll('.scout-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      const result = scoutDriver(btn.dataset.tier);
      if (result.ok) {
        addNotification(`Signed ${result.driver.name} (${result.driver.tier}-tier, Pace +${result.driver.pace}%)`, 'success');
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
}

// ─── Prestige Panel ───────────────────────────────────────────────────────────

function renderPrestige() {
  const container = document.getElementById('panel-prestige');

  const canP = canPrestige();
  const ppGain = calcPrestigePoints();

  let html = `
    <div class="section-header">SEASON RESET</div>
    <div class="prestige-info">
      <div class="prestige-season">Season ${G.season}</div>
      <div class="prestige-pp">You have <span class="pp-value">${G.prestigePoints} PP</span></div>
      <div class="prestige-gain">Resetting now would grant <span class="pp-gain">+${ppGain} PP</span></div>
      <div class="prestige-warning">
        ${canP
          ? 'A reset will clear car upgrades and money, but driver XP, REP, and unlocked classes persist.'
          : 'Complete at least one championship this season to unlock a Season Reset.'}
      </div>
      <button class="btn btn-prestige ${canP ? '' : 'disabled'}" id="prestige-btn" ${canP ? '' : 'disabled'}>
        ${canP ? `Reset Season — Gain ${ppGain} PP` : 'Complete a championship first'}
      </button>
    </div>

    <div class="section-header">PRESTIGE SHOP</div>
    <div class="prestige-shop-grid">`;

  PRESTIGE_ITEMS.forEach(item => {
    const purchased = G.prestige.purchased.filter(p => p === item.id).length;
    const maxed = item.maxPurchases && purchased >= item.maxPurchases;
    const canBuy = !maxed && G.prestigePoints >= item.cost;

    html += `
      <div class="prestige-item ${maxed ? 'maxed' : ''}">
        <div class="pi-name">${item.name}</div>
        <div class="pi-desc">${item.description}</div>
        ${item.maxPurchases ? `<div class="pi-count">${purchased}/${item.maxPurchases}</div>` : ''}
        <button class="btn ${canBuy ? '' : 'disabled'} prestige-buy-btn"
          data-item="${item.id}" ${canBuy ? '' : 'disabled'}>
          ${maxed ? 'Maxed' : item.cost + ' PP'}
        </button>
      </div>`;
  });

  html += `</div>

    <div class="section-header">STATS</div>
    <div class="stats-grid">
      <div class="stat-row"><span>Total Earned</span><span>$${formatNumber(G.totalEarned)}</span></div>
      <div class="stat-row"><span>Season Resets</span><span>${G.prestige.totalResets}</span></div>
      <div class="stat-row"><span>Championships Completed</span><span>${G.completedChampionships.length}</span></div>
      <div class="stat-row"><span>Cars Owned</span><span>${G.cars.length}</span></div>
      <div class="stat-row"><span>Drivers Signed</span><span>${G.drivers.length}</span></div>
    </div>

    <div class="section-header danger-zone">DANGER ZONE</div>
    <button class="btn btn-danger" id="reset-save-btn">Delete Save & Restart</button>
  `;

  container.innerHTML = html;

  const prestigeBtn = container.querySelector('#prestige-btn');
  if (prestigeBtn && !prestigeBtn.disabled) {
    prestigeBtn.addEventListener('click', () => {
      if (!confirm('Reset the season? Car upgrades and money will be cleared. This cannot be undone.')) return;
      const result = doPrestige();
      if (result.ok) renderPrestige();
    });
  }

  container.querySelectorAll('.prestige-buy-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = PRESTIGE_ITEMS.find(i => i.id === btn.dataset.item);
      if (!item || G.prestigePoints < item.cost) return;
      G.prestigePoints -= item.cost;
      G.prestige.purchased.push(item.id);

      // Apply effect
      if (item.id === 'factory_backing') G.prestige.permanentBonuses.sponsorBonus += 0.25;
      if (item.id === 'head_start') G.prestige.permanentBonuses.headStartLevels = Math.min(5, G.prestige.permanentBonuses.headStartLevels + 3);

      addNotification(`Purchased: ${item.name}`, 'success');
      renderPrestige();
    });
  });

  const resetBtn = container.querySelector('#reset-save-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (!confirm('Delete all save data and restart? This is permanent!')) return;
      resetGame();
      window.location.reload();
    });
  }
}

// ─── Fast UI Refresh (HUD only — no DOM reconstruction) ─────────────────────

function fastRefresh() {
  updateCurrencyBar();
  renderNotifications();
  updateGarageLive();
  updateChampLive();
}

// ─── Targeted in-place garage updates ────────────────────────────────────────

function updateGarageLive() {
  if (_activeTab !== 'garage') return;

  G.cars.forEach(car => {
    const ips = calcCarIncomePerSec(car);
    const ipsEl = document.querySelector(`[data-live-ips="${car.id}"]`);
    if (ipsEl) ipsEl.textContent = '$' + formatNumber(ips) + '/s';

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

  // Buy-car button affordability
  document.querySelectorAll('.buy-car-btn').forEach(btn => {
    const cls = getCarClassById(btn.dataset.class);
    if (!cls) return;
    const owned = G.cars.filter(c => c.classId === cls.id).length;
    const canBuy = G.reputation >= cls.repRequired &&
                   (!cls.ppRequired || G.prestigePoints >= cls.ppRequired) &&
                   G.money >= cls.baseCost &&
                   owned < cls.maxOwned;
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
