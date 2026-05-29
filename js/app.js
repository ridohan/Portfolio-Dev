// État global
let STATE = { portfolios: [], sub_portfolios: [], envelopes: [], positions: [], prices: [], crypto_prices: [], charges: [], history: [], fire_profile: [], vpw: null };

// État du tri des positions (persisté pendant la session)
let _posSort = { col: 'type', dir: 'asc' };

// Période active pour les pages historique
let _histPeriod = 'all';

// ─── ROUTER ──────────────────────────────────────────────────────────────────

function navigate(hash) { location.hash = hash; }

window.addEventListener('hashchange', render);
window.addEventListener('load', render);

async function render() {
  const app = document.getElementById('app');
  if (!API.isConfigured()) return renderSetup(app);

  const cached = API._getCache();
  if (cached) {
    // Affichage immédiat depuis le cache, pas de spinner
    STATE = cached;
  } else {
    app.innerHTML = `<div class="flex items-center justify-center h-64 text-slate-400">Chargement…</div>`;
    try {
      STATE = await API.getData();
    } catch (e) {
      app.innerHTML = errorBanner(e.message); return;
    }
  }

  const hash = location.hash || '#dashboard';
  const [route, id] = hash.slice(1).split('/');

  if (route === 'dashboard')  return renderDashboard(app);
  if (route === 'portfolio')  return renderPortfolio(app, id);
  if (route === 'envelope')   return renderEnvelope(app, id);
  if (route === 'hist-env')    return renderHistoryEnv(app, id);
  if (route === 'hist-pf')     return renderHistoryPf(app, id);
  if (route === 'hist-global') return renderHistoryGlobal(app);
  if (route === 'fire')        return renderFire(app);
  renderDashboard(app);
}

async function forceRefresh() {
  const app = document.getElementById('app');
  app.innerHTML = `<div class="flex items-center justify-center h-64 text-slate-400">Actualisation…</div>`;
  try {
    STATE = await API.getData(true);
  } catch (e) {
    app.innerHTML = errorBanner(e.message); return;
  }
  render();
}

// ─── SETUP ───────────────────────────────────────────────────────────────────

function renderSetup(app) {
  app.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="bg-slate-800 rounded-2xl p-8 w-full max-w-md shadow-xl">
        <h1 class="text-2xl font-bold text-white mb-2">Portfolio Manager</h1>
        <p class="text-slate-400 mb-6 text-sm">Configure ta connexion à Google Sheets pour commencer.</p>
        <form id="setup-form" class="space-y-4">
          <div>
            <label class="text-slate-300 text-sm font-medium block mb-1">URL AppScript Web App</label>
            <input id="setup-url" type="url" required placeholder="https://script.google.com/macros/s/…/exec"
              class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label class="text-slate-300 text-sm font-medium block mb-1">Token secret</label>
            <input id="setup-token" type="password" required placeholder="ton-token-secret"
              class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <button type="submit" class="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2 rounded-lg transition">
            Se connecter
          </button>
          <p id="setup-error" class="text-red-400 text-sm hidden"></p>
        </form>
      </div>
    </div>`;

  document.getElementById('setup-form').addEventListener('submit', async e => {
    e.preventDefault();
    const url   = document.getElementById('setup-url').value;
    const token = document.getElementById('setup-token').value;
    API.save(url, token);
    try {
      STATE = await API.getData();
      navigate('#dashboard');
    } catch (err) {
      document.getElementById('setup-error').textContent = 'Connexion échouée : ' + err.message;
      document.getElementById('setup-error').classList.remove('hidden');
    }
  });
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

function renderDashboard(app) {
  const { total, invested, alloc, totalCharges } = globalStats();

  app.innerHTML = `
    ${navbar()}
    <div class="max-w-5xl mx-auto px-4 py-8 space-y-6">
      ${statCards(total, invested, totalCharges, computeAnnualReturn(globalHistory()))}
      ${allocBar(alloc, 'Allocation globale', 'md', null, total)}
      ${historySparkline(globalHistory(), '#hist-global')}
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-white">🔥 Simulation FIRE</h2>
        <a href="#fire" onclick="navigate('#fire');return false;" class="btn-secondary text-sm">Configurer →</a>
      </div>
      ${fireDashboardCards()}
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-white">Portfolios</h2>
        <div class="flex gap-2">
          <a href="#hist-global" onclick="navigate('#hist-global');return false;" class="btn-secondary text-sm">📈 Historique</a>
          <button onclick="openModal('portfolio')" class="btn-primary text-sm">+ Nouveau</button>
        </div>
      </div>
      ${envelopeTypeAllocBar(STATE.envelopes)}
      <div class="grid gap-4 sm:grid-cols-2">
        ${STATE.portfolios.map(p => portfolioCard(p)).join('') || empty('Aucun portfolio — crée-en un.')}
      </div>
    </div>
    ${modalPortfolio()}`;
}

function portfolioCard(p) {
  const envs    = STATE.envelopes.filter(e => e.portfolio_id === p.id);
  const { total, invested, alloc, totalCharges } = portfolioStats(p.id);
  const pv      = total - invested;
  const pvPct   = invested > 0 ? ((pv / invested) * 100).toFixed(1) : 0;

  return `
    <div class="bg-slate-800 rounded-xl p-5 hover:bg-slate-750 transition cursor-pointer" onclick="navigate('#portfolio/${p.id}')">
      <div class="flex items-start justify-between mb-3">
        <div>
          <h3 class="text-white font-semibold">${esc(p.nom)}</h3>
          <p class="text-slate-400 text-xs">${envs.length} enveloppe${envs.length > 1 ? 's' : ''}</p>
        </div>
        <span class="${pv >= 0 ? 'text-emerald-400' : 'text-red-400'} text-sm font-medium">
          ${pv >= 0 ? '+' : ''}${fmt(pv)} (${pvPct}%)
        </span>
      </div>
      <p class="text-white text-xl font-bold mb-1">${fmt(totalCharges > 0 ? total - totalCharges : total)}</p>
      ${totalCharges > 0 ? `<p class="text-slate-500 text-xs mb-3">Brut : ${fmt(total)} · Charges : −${fmt(totalCharges)}</p>` : '<div class="mb-3"></div>'}
      ${allocBar(alloc, null, 'sm')}
    </div>`;
}

// ─── PORTFOLIO DETAIL ─────────────────────────────────────────────────────────

function renderPortfolio(app, portfolioId) {
  const p = STATE.portfolios.find(x => x.id === portfolioId);
  if (!p) { navigate('#dashboard'); return; }

  const { total, invested, alloc, totalCharges } = portfolioStats(portfolioId);
  const pv    = total - invested;
  const rebal = rebalancingSuggestions(portfolioId);
  const envs  = STATE.envelopes.filter(e => e.portfolio_id === portfolioId);

  app.innerHTML = `
    ${navbar(`<a href="#dashboard" class="text-slate-400 hover:text-white text-sm">← Retour</a>`)}
    <div class="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div class="flex items-start justify-between">
        <div>
          <h1 class="text-2xl font-bold text-white">${esc(p.nom)}</h1>
          <p class="text-slate-400 text-sm mt-1">Cible : ${p.cible_actions}% actions · ${p.cible_obligations}% obligations · ${p.cible_cash}% cash</p>
        </div>
        <div class="flex gap-2">
          <button onclick='openEditPortfolio(${JSON.stringify(p)})' class="btn-secondary text-sm">✏ Modifier</button>
          <a href="#hist-pf/${p.id}" onclick="navigate('#hist-pf/${p.id}');return false;" class="btn-secondary text-sm">📈 Historique</a>
          <button onclick="openModal('envelope','${portfolioId}')" class="btn-primary text-sm">+ Enveloppe</button>
          <button onclick="confirmDelete('portfolio','${p.id}')" class="btn-danger text-sm">Supprimer</button>
        </div>
      </div>
      ${statCards(total, invested, totalCharges, computeAnnualReturn(portfolioHistory(portfolioId)))}
      ${historySparkline(portfolioHistory(portfolioId), '#hist-pf/' + portfolioId)}
      ${allocBar(alloc, 'Allocation réelle', 'lg', { actions: p.cible_actions, obligations: p.cible_obligations, cash: p.cible_cash }, total)}
      ${rebal.length ? rebalancingCard(rebal) : ''}
      <h2 class="text-lg font-semibold text-white">Enveloppes</h2>
      ${envelopeTypeAllocBar(STATE.envelopes.filter(e => e.portfolio_id === portfolioId))}
      ${envelopesSection(portfolioId)}
      ${chargesSection(portfolioId)}
    </div>
    ${modalEnvelope()}
    ${modalEditPortfolio()}
    ${modalCharge()}
    ${modalEditCharge()}`;
}

function envelopeCard(e) {
  const { total, invested } = envelopeStats(e.id);
  const pv    = total - invested;
  const pvPct = invested > 0 ? ((pv / invested) * 100).toFixed(1) : 0;
  const badge = { bourse: 'bg-blue-500/20 text-blue-300', crypto: 'bg-purple-500/20 text-purple-300', épargne: 'bg-emerald-500/20 text-emerald-300' };

  return `
    <div class="bg-slate-800 rounded-xl p-5 cursor-pointer hover:bg-slate-750 transition" onclick="navigate('#envelope/${e.id}')">
      <div class="flex items-start justify-between mb-2">
        <div>
          <h3 class="text-white font-semibold">${esc(e.nom)}</h3>
          <span class="text-xs px-2 py-0.5 rounded-full ${badge[e.type] || 'bg-slate-600 text-slate-300'}">${e.type}</span>
        </div>
        <span class="${pv >= 0 ? 'text-emerald-400' : 'text-red-400'} text-sm">${pv >= 0 ? '+' : ''}${fmt(pv)} (${pvPct}%)</span>
      </div>
      <p class="text-white text-xl font-bold mt-3">${fmt(total)}</p>
    </div>`;
}

// ─── ENVELOPE DETAIL ──────────────────────────────────────────────────────────

function renderEnvelope(app, envelopeId) {
  const e  = STATE.envelopes.find(x => x.id === envelopeId);
  if (!e) { navigate('#dashboard'); return; }
  const portfolio = STATE.portfolios.find(p => p.id === e.portfolio_id);
  const positions = STATE.positions.filter(p => p.envelope_id === envelopeId);
  const { total, invested } = envelopeStats(envelopeId);

  app.innerHTML = `
    ${navbar(`<a href="#portfolio/${e.portfolio_id}" class="text-slate-400 hover:text-white text-sm">← ${esc(portfolio?.nom || 'Retour')}</a>`)}
    <div class="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div class="flex items-start justify-between">
        <div>
          <h1 class="text-2xl font-bold text-white">${esc(e.nom)}</h1>
          <p class="text-slate-400 text-sm capitalize">${e.type}</p>
        </div>
        <div class="flex gap-2">
          <button onclick='openEditEnvelope(${JSON.stringify(e)})' class="btn-secondary text-sm">✏ Renommer</button>
          <a href="#hist-env/${e.id}" onclick="navigate('#hist-env/${e.id}');return false;" class="btn-secondary text-sm">📈 Historique</a>
          <button onclick="openModal('position','${envelopeId}','${e.type}')" class="btn-primary text-sm">+ Position</button>
          <button onclick="confirmDelete('envelope','${e.id}')" class="btn-danger text-sm">Supprimer</button>
        </div>
      </div>
      ${statCards(total, invested, 0, computeAnnualReturn(envelopeHistory(envelopeId)))}
      ${historySparkline(envelopeHistory(envelopeId), '#hist-env/' + envelopeId)}
      <h2 class="text-lg font-semibold text-white">Positions</h2>
      ${positionsTable(positions, e.type)}
    </div>
    ${modalPosition(envelopeId, e.type)}
    ${modalEditPosition(e.type)}
    ${modalEditEnvelope()}`;
}

function positionsTable(positions, type) {
  if (!positions.length) return empty('Aucune position — ajoutes-en une.');
  const isEpargne = type === 'épargne';
  const isBourse  = type === 'bourse';

  // Tri selon _posSort
  const typeOrder = { action: 0, bond: 1 };
  const dir = _posSort.dir === 'asc' ? 1 : -1;

  const sorted = [...positions].sort((a, b) => {
    const col = _posSort.col;
    // col 'type' sans bourse → fallback identifiant
    if (col === 'type' && isBourse) {
      const tA = STATE.prices.find(p => p.isin === a.identifiant)?.type || 'z';
      const tB = STATE.prices.find(p => p.isin === b.identifiant)?.type || 'z';
      return dir * ((typeOrder[tA] ?? 2) - (typeOrder[tB] ?? 2));
    }
    if (col === 'identifiant' || (col === 'type' && !isBourse)) {
      return dir * String(a.identifiant).toLowerCase().localeCompare(String(b.identifiant).toLowerCase());
    }
    if (col === 'valeur') {
      const vA = isEpargne ? Number(a.prix_achat) : currentPrice(a.identifiant, type) * Number(a.quantite);
      const vB = isEpargne ? Number(b.prix_achat) : currentPrice(b.identifiant, type) * Number(b.quantite);
      return dir * (vA - vB);
    }
    if (col === 'pv') {
      const pvA = isEpargne ? 0 : (currentPrice(a.identifiant, type) - Number(a.prix_achat)) * Number(a.quantite);
      const pvB = isEpargne ? 0 : (currentPrice(b.identifiant, type) - Number(b.prix_achat)) * Number(b.quantite);
      return dir * (pvA - pvB);
    }
    return 0;
  });

  // Helper header cliquable
  const th = (col, label) => {
    const active = _posSort.col === col;
    const icon = active ? (_posSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
    return `<th class="py-3 px-4 cursor-pointer select-none hover:text-slate-200 transition whitespace-nowrap" onclick="sortPositions('${col}')">${label}${icon}</th>`;
  };

    const rows = sorted.map(pos => {
    const prix = currentPrice(pos.identifiant, type);
    const valAchat  = isEpargne ? Number(pos.prix_achat) : Number(pos.prix_achat) * Number(pos.quantite);
    const valActuel  = isEpargne ? Number(pos.prix_achat) : prix * Number(pos.quantite);
    const pv         = valActuel - valAchat;
    const pvPct      = valAchat > 0 ? ((pv / valAchat) * 100).toFixed(1) : 0;
    const etfNom     = type === 'bourse'
      ? STATE.prices.find(p => p.isin === pos.identifiant)?.nom || ''
      : type === 'crypto'
        ? STATE.crypto_prices.find(p => p.symbole === pos.identifiant)?.nom || ''
        : '';
    const etfType    = type === 'bourse'
      ? STATE.prices.find(p => p.isin === pos.identifiant)?.type || ''
      : '';
    const typeBadge  = etfType === 'action'
      ? `<span class="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">action</span>`
      : etfType === 'bond'
        ? `<span class="text-xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">bond</span>`
        : '';
    const label = etfNom || pos.identifiant;

    return `
      <tr class="border-t border-slate-700 hover:bg-slate-750">
        <td class="py-3 px-4">
          <p class="text-white font-medium">${esc(label)}</p>
          <p class="text-slate-500 text-xs">${esc(pos.identifiant)}</p>
        </td>
        ${type === 'bourse' ? `<td class="py-3 px-4">${typeBadge}</td>` : ''}
        ${isEpargne
          ? `<td class="py-3 px-4 text-slate-300">${Number(pos.quantite).toFixed(2)}%</td>`
          : `<td class="py-3 px-4 text-slate-300">${pos.quantite} × ${fmt(Number(pos.prix_achat))}</td>`}
        <td class="py-3 px-4 text-white">${fmt(valActuel)}</td>
        <td class="py-3 px-4 ${pv >= 0 ? 'text-emerald-400' : 'text-red-400'}">${pv >= 0 ? '+' : ''}${fmt(pv)} (${pvPct}%)</td>
        <td class="py-3 px-4 flex gap-3">
          <button onclick='openEditPosition(${JSON.stringify(pos)})' class="text-slate-400 hover:text-blue-400 text-xs transition">Modifier</button>
          <button onclick="confirmDelete('position','${pos.id}')" class="text-slate-500 hover:text-red-400 text-xs transition">Supprimer</button>
        </td>
      </tr>`;
  }).join('');

  // Récap allocation pour les enveloppes bourse
  const allocRecap = (() => {
    if (type !== 'bourse') return '';
    let actions = 0, bonds = 0;
    sorted.forEach(pos => {
      const val = currentPrice(pos.identifiant, type) * Number(pos.quantite);
      const t   = STATE.prices.find(p => p.isin === pos.identifiant)?.type;
      if (t === 'action') actions += val;
      else if (t === 'bond') bonds += val;
    });
    const total = actions + bonds;
    if (!total) return '';
    const pctA = (actions / total * 100).toFixed(1);
    const pctB = (bonds   / total * 100).toFixed(1);
    return `
      <div class="bg-slate-800 rounded-xl p-4">
        <p class="text-slate-400 text-xs mb-2">Répartition de l'enveloppe</p>
        <div class="flex rounded-full overflow-hidden h-2 gap-0.5">
          <div class="bg-blue-500" style="width:${pctA}%"></div>
          <div class="bg-amber-500" style="width:${pctB}%"></div>
        </div>
        <div class="flex gap-4 text-xs text-slate-400 mt-2">
          <span><span class="inline-block w-2 h-2 rounded-full bg-blue-500 mr-1"></span>Actions ${pctA}% — ${fmt(actions)}</span>
          <span><span class="inline-block w-2 h-2 rounded-full bg-amber-500 mr-1"></span>Bonds ${pctB}% — ${fmt(bonds)}</span>
        </div>
      </div>`;
  })();

  return `${allocRecap}
    <div class="bg-slate-800 rounded-xl overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-slate-400 text-left">
            ${th('identifiant', isEpargne ? 'Compte' : 'Identifiant')}
            ${isBourse ? th('type', 'Type') : ''}
            <th class="py-3 px-4">${isEpargne ? 'Taux' : 'Quantité × Prix achat'}</th>
            ${th('valeur', 'Valeur actuelle')}
            ${th('pv', 'Plus-value')}
            <th class="py-3 px-4"></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ─── MODALES ─────────────────────────────────────────────────────────────────

function modalPortfolio() {
  return `
    <div id="modal-portfolio" class="modal-backdrop hidden">
      <div class="modal-box">
        <h2 class="text-white font-semibold mb-4">Nouveau portfolio</h2>
        <form id="form-portfolio" class="space-y-3">
          <input name="nom" placeholder="Nom du portfolio" required class="input" />
          <div class="grid grid-cols-3 gap-2">
            <div><label class="label">Actions %</label><input name="cible_actions" type="number" min="0" max="100" value="70" required class="input" /></div>
            <div><label class="label">Obligations %</label><input name="cible_obligations" type="number" min="0" max="100" value="20" required class="input" /></div>
            <div><label class="label">Cash %</label><input name="cible_cash" type="number" min="0" max="100" value="10" required class="input" /></div>
          </div>
          <p id="err-portfolio" class="text-red-400 text-xs hidden"></p>
          <div class="flex gap-2 pt-1">
            <button type="submit" class="btn-primary flex-1">Créer</button>
            <button type="button" onclick="closeModal('portfolio')" class="btn-secondary flex-1">Annuler</button>
          </div>
        </form>
      </div>
    </div>`;
}

function modalEnvelope() {
  return `
    <div id="modal-envelope" class="modal-backdrop hidden">
      <div class="modal-box">
        <h2 class="text-white font-semibold mb-4">Nouvelle enveloppe</h2>
        <form id="form-envelope" class="space-y-3">
          <input name="nom" placeholder="Nom (ex: PEA Boursorama)" required class="input" />
          <select name="type" required class="input">
            <option value="bourse">Bourse</option>
            <option value="crypto">Crypto</option>
            <option value="épargne">Épargne</option>
          </select>
          <p id="err-envelope" class="text-red-400 text-xs hidden"></p>
          <div class="flex gap-2 pt-1">
            <button type="submit" class="btn-primary flex-1">Créer</button>
            <button type="button" onclick="closeModal('envelope')" class="btn-secondary flex-1">Annuler</button>
          </div>
        </form>
      </div>
    </div>`;
}

function modalPosition(envelopeId, type) {
  const isEpargne = type === 'épargne';
  const isCrypto  = type === 'crypto';

  return `
    <div id="modal-position" class="modal-backdrop hidden">
      <div class="modal-box">
        <h2 class="text-white font-semibold mb-4">Nouvelle position</h2>
        <form id="form-position" class="space-y-3">
          <div>
            <label class="label">${isEpargne ? 'Nom du compte' : isCrypto ? 'Symbole (ex: BTC)' : 'ISIN'}</label>
            <input name="identifiant" placeholder="${isEpargne ? 'Livret A BNP' : isCrypto ? 'BTC' : 'LU0274208692'}" required class="input" />
          </div>
          ${isEpargne
            ? `<div><label class="label">Montant actuel (€)</label><input name="prix_achat" type="number" step="0.01" min="0" required class="input" /></div>
               <div><label class="label">Taux annuel (%)</label><input name="quantite" type="number" step="0.01" min="0" required class="input" /></div>`
            : `<div class="grid grid-cols-2 gap-2">
                 <div><label class="label">Prix d'achat (€)</label><input name="prix_achat" type="number" step="0.01" min="0" required class="input" /></div>
                 <div><label class="label">Quantité</label><input name="quantite" type="number" step="0.000001" min="0" required class="input" /></div>
               </div>`}
          <p id="err-position" class="text-red-400 text-xs hidden"></p>
          <div class="flex gap-2 pt-1">
            <button type="submit" class="btn-primary flex-1">Ajouter</button>
            <button type="button" onclick="closeModal('position')" class="btn-secondary flex-1">Annuler</button>
          </div>
        </form>
      </div>
    </div>`;
}

function modalCharge() {
  return `
    <div id="modal-charge" class="modal-backdrop hidden">
      <div class="modal-box">
        <h2 class="text-white font-semibold mb-4">Nouvelle charge</h2>
        <form id="form-charge" class="space-y-3">
          <div><label class="label">Nom</label>
            <input name="nom" placeholder="Ex: Remboursement prêt immo" required class="input" /></div>
          <div><label class="label">Montant (€)</label>
            <input name="montant" type="number" step="0.01" min="0" required class="input" /></div>
          <div><label class="label">Date de fin (optionnelle)</label>
            <input name="date_fin" type="date" class="input" /></div>
          <p id="err-charge" class="text-red-400 text-xs hidden"></p>
          <div class="flex gap-2 pt-1">
            <button type="submit" class="btn-primary flex-1">Ajouter</button>
            <button type="button" onclick="closeModal('charge')" class="btn-secondary flex-1">Annuler</button>
          </div>
        </form>
      </div>
    </div>`;
}

function modalEditCharge() {
  return `
    <div id="modal-edit-charge" class="modal-backdrop hidden">
      <div class="modal-box">
        <h2 class="text-white font-semibold mb-4">Modifier la charge</h2>
        <form id="form-edit-charge" class="space-y-3">
          <div><label class="label">Nom</label>
            <input name="nom" id="edit-charge-nom" required class="input" /></div>
          <div><label class="label">Montant (€)</label>
            <input name="montant" id="edit-charge-montant" type="number" step="0.01" min="0" required class="input" /></div>
          <div><label class="label">Date de fin (optionnelle)</label>
            <input name="date_fin" id="edit-charge-date" type="date" class="input" /></div>
          <p id="err-edit-charge" class="text-red-400 text-xs hidden"></p>
          <div class="flex gap-2 pt-1">
            <button type="submit" class="btn-primary flex-1">Enregistrer</button>
            <button type="button" onclick="closeModal('edit-charge')" class="btn-secondary flex-1">Annuler</button>
          </div>
        </form>
      </div>
    </div>`;
}

function modalEditPortfolio() {
  return `
    <div id="modal-edit-portfolio" class="modal-backdrop hidden">
      <div class="modal-box">
        <h2 class="text-white font-semibold mb-4">Modifier le portfolio</h2>
        <form id="form-edit-portfolio" class="space-y-3">
          <div>
            <label class="label">Nom</label>
            <input name="nom" id="edit-portfolio-nom" required class="input" />
          </div>
          <div class="grid grid-cols-3 gap-2">
            <div><label class="label">Actions %</label><input name="cible_actions" id="edit-portfolio-actions" type="number" min="0" max="100" required class="input" /></div>
            <div><label class="label">Obligations %</label><input name="cible_obligations" id="edit-portfolio-oblig" type="number" min="0" max="100" required class="input" /></div>
            <div><label class="label">Cash %</label><input name="cible_cash" id="edit-portfolio-cash" type="number" min="0" max="100" required class="input" /></div>
          </div>
          <p id="err-edit-portfolio" class="text-red-400 text-xs hidden"></p>
          <div class="flex gap-2 pt-1">
            <button type="submit" class="btn-primary flex-1">Enregistrer</button>
            <button type="button" onclick="closeModal('edit-portfolio')" class="btn-secondary flex-1">Annuler</button>
          </div>
        </form>
      </div>
    </div>`;
}

function modalEditEnvelope() {
  return `
    <div id="modal-edit-envelope" class="modal-backdrop hidden">
      <div class="modal-box">
        <h2 class="text-white font-semibold mb-4">Renommer l'enveloppe</h2>
        <form id="form-edit-envelope" class="space-y-3">
          <div>
            <label class="label">Nom</label>
            <input name="nom" id="edit-envelope-nom" required class="input" />
          </div>
          <p id="err-edit-envelope" class="text-red-400 text-xs hidden"></p>
          <div class="flex gap-2 pt-1">
            <button type="submit" class="btn-primary flex-1">Enregistrer</button>
            <button type="button" onclick="closeModal('edit-envelope')" class="btn-secondary flex-1">Annuler</button>
          </div>
        </form>
      </div>
    </div>`;
}

function modalEditPosition(type) {
  const isEpargne = type === 'épargne';
  return `
    <div id="modal-edit-position" class="modal-backdrop hidden">
      <div class="modal-box">
        <h2 class="text-white font-semibold mb-4">Modifier la position</h2>
        <form id="form-edit-position" class="space-y-3">
          ${isEpargne
            ? `<div><label class="label">Montant actuel (€)</label><input name="prix_achat" id="edit-prix_achat" type="number" step="0.01" min="0" required class="input" /></div>
               <div><label class="label">Taux annuel (%)</label><input name="quantite" id="edit-quantite" type="number" step="0.01" min="0" required class="input" /></div>`
            : `<div class="grid grid-cols-2 gap-2">
                 <div><label class="label">Prix d'achat (€)</label><input name="prix_achat" id="edit-prix_achat" type="number" step="0.01" min="0" required class="input" /></div>
                 <div><label class="label">Quantité</label><input name="quantite" id="edit-quantite" type="number" step="0.000001" min="0" required class="input" /></div>
               </div>`}
          <p id="err-edit-position" class="text-red-400 text-xs hidden"></p>
          <div class="flex gap-2 pt-1">
            <button type="submit" class="btn-primary flex-1">Enregistrer</button>
            <button type="button" onclick="closeModal('edit-position')" class="btn-secondary flex-1">Annuler</button>
          </div>
        </form>
      </div>
    </div>`;
}

// ─── MODAL ACTIONS ────────────────────────────────────────────────────────────

let _modalContext = {};

function openModal(type, ...args) {
  _modalContext = { type, args };
  document.getElementById(`modal-${type}`)?.classList.remove('hidden');

  if (type === 'portfolio') {
    document.getElementById('form-portfolio').onsubmit = async e => {
      e.preventDefault();
      const btn = e.target.querySelector('[type=submit]');
      setLoading(btn, true);
      const d = Object.fromEntries(new FormData(e.target));
      try {
        await withErr('portfolio', () => API.createPortfolio(d));
        closeModal('portfolio'); render();
      } finally { setLoading(btn, false); }
    };
  }
  if (type === 'envelope') {
    document.getElementById('form-envelope').onsubmit = async e => {
      e.preventDefault();
      const btn = e.target.querySelector('[type=submit]');
      setLoading(btn, true);
      const d = Object.fromEntries(new FormData(e.target));
      try {
        await withErr('envelope', () => API.createEnvelope({ ...d, portfolio_id: args[0] }));
        closeModal('envelope'); render();
      } finally { setLoading(btn, false); }
    };
  }
  if (type === 'charge') {
    document.getElementById('form-charge').reset();
    document.getElementById('form-charge').onsubmit = async e => {
      e.preventDefault();
      const btn = e.target.querySelector('[type=submit]');
      setLoading(btn, true);
      const d = Object.fromEntries(new FormData(e.target));
      try {
        await withErr('charge', () => API.createCharge({ ...d, portfolio_id: args[0] }));
        closeModal('charge'); render();
      } finally { setLoading(btn, false); }
    };
  }
  if (type === 'position') {
    document.getElementById('form-position').onsubmit = async e => {
      e.preventDefault();
      const btn = e.target.querySelector('[type=submit]');
      setLoading(btn, true);
      const d = Object.fromEntries(new FormData(e.target));
      const envelopeType = args[1];
      const payload = { envelope_id: args[0], identifiant: d.identifiant, prix_achat: d.prix_achat, quantite: d.quantite };
      try {
        if (envelopeType === 'bourse') await API.addPrice({ isin: d.identifiant });
        if (envelopeType === 'crypto') await API.addCryptoPrice({ symbole: d.identifiant });
        await withErr('position', () => API.addPosition(payload));
        closeModal('position'); render();
      } finally { setLoading(btn, false); }
    };
  }
}

function closeModal(type) {
  document.getElementById(`modal-${type}`)?.classList.add('hidden');
}

function openEditCharge(c) {
  document.getElementById('modal-edit-charge')?.classList.remove('hidden');
  document.getElementById('edit-charge-nom').value     = c.nom     || '';
  document.getElementById('edit-charge-montant').value = c.montant || '';
  document.getElementById('edit-charge-date').value    = c.date_fin || '';

  document.getElementById('form-edit-charge').onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector('[type=submit]');
    setLoading(btn, true);
    const d = Object.fromEntries(new FormData(e.target));
    try {
      await withErr('edit-charge', () => API.updateCharge({ id: c.id, ...d }));
      closeModal('edit-charge'); render();
    } finally { setLoading(btn, false); }
  };
}

function openEditPortfolio(p) {
  document.getElementById('modal-edit-portfolio')?.classList.remove('hidden');
  document.getElementById('edit-portfolio-nom').value     = p.nom || '';
  document.getElementById('edit-portfolio-actions').value = p.cible_actions ?? 0;
  document.getElementById('edit-portfolio-oblig').value   = p.cible_obligations ?? 0;
  document.getElementById('edit-portfolio-cash').value    = p.cible_cash ?? 0;

  document.getElementById('form-edit-portfolio').onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector('[type=submit]');
    setLoading(btn, true);
    const d = Object.fromEntries(new FormData(e.target));
    try {
      await withErr('edit-portfolio', () => API.updatePortfolio({ id: p.id, ...d }));
      closeModal('edit-portfolio');
      render();
    } finally { setLoading(btn, false); }
  };
}

function openEditEnvelope(e) {
  document.getElementById('modal-edit-envelope')?.classList.remove('hidden');
  document.getElementById('edit-envelope-nom').value = e.nom || '';

  document.getElementById('form-edit-envelope').onsubmit = async ev => {
    ev.preventDefault();
    const btn = ev.target.querySelector('[type=submit]');
    setLoading(btn, true);
    const d = Object.fromEntries(new FormData(ev.target));
    try {
      await withErr('edit-envelope', () => API.updateEnvelope({ id: e.id, nom: d.nom, type: e.type }));
      closeModal('edit-envelope');
      render();
    } finally { setLoading(btn, false); }
  };
}

function openEditPosition(pos) {
  document.getElementById('modal-edit-position')?.classList.remove('hidden');
  document.getElementById('edit-prix_achat').value = pos.prix_achat || '';
  document.getElementById('edit-quantite').value   = pos.quantite || '';

  document.getElementById('form-edit-position').onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector('[type=submit]');
    setLoading(btn, true);
    const d = Object.fromEntries(new FormData(e.target));
    try {
      await withErr('edit-position', () => API.updatePosition({ id: pos.id, ...d }));
      closeModal('edit-position');
      render();
    } finally { setLoading(btn, false); }
  };
}

async function confirmDelete(type, id) {
  if (!confirm(`Supprimer définitivement ?`)) return;
  const actions = { portfolio: () => API.deletePortfolio(id), envelope: () => API.deleteEnvelope(id), position: () => API.deletePosition(id), charge: () => API.deleteCharge(id) };
  await actions[type]?.();
  render();
}

async function withErr(type, fn) {
  const err = document.getElementById(`err-${type}`);
  err?.classList.add('hidden');
  try { await fn(); }
  catch (e) { if (err) { err.textContent = e.message; err.classList.remove('hidden'); } throw e; }
}

function setLoading(btn, isLoading) {
  if (!btn) return;
  btn.disabled = isLoading;
  btn.dataset.label = btn.dataset.label || btn.textContent;
  btn.innerHTML = isLoading
    ? `<svg class="animate-spin inline w-4 h-4 mr-1" viewBox="0 0 24 24" fill="none">
         <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
         <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
       </svg>En cours…`
    : btn.dataset.label;
}

// ─── CALCULS ─────────────────────────────────────────────────────────────────

function currentPrice(identifiant, type) {
  if (type === 'bourse')  return Number(STATE.prices.find(p => p.isin === identifiant)?.prix_actuel) || 0;
  if (type === 'crypto')  return Number(STATE.crypto_prices.find(p => p.symbole === identifiant)?.prix_actuel) || 0;
  return Number(identifiant) || 0;
}

function envelopeStats(envId) {
  const env = STATE.envelopes.find(e => e.id === envId);
  const positions = STATE.positions.filter(p => p.envelope_id === envId);
  let invested = 0, total = 0;

  positions.forEach(pos => {
    const isEpargne = env?.type === 'épargne';
    const qty = Number(pos.quantite) || 0;
    const pa  = Number(pos.prix_achat) || 0;
    const prix = currentPrice(pos.identifiant, env?.type);
    invested += isEpargne ? pa : pa * qty;
    total    += isEpargne ? pa : prix * qty;
  });

  return { total, invested };
}

function portfolioStats(portfolioId) {
  const envs = STATE.envelopes.filter(e => e.portfolio_id === portfolioId);
  let total = 0, invested = 0, actions = 0, obligations = 0, cash = 0;

  envs.forEach(env => {
    const s = envelopeStats(env.id);
    total    += s.total;
    invested += s.invested;
    if (env.type === 'épargne') cash += s.total;
    else {
      const positions = STATE.positions.filter(p => p.envelope_id === env.id);
      positions.forEach(pos => {
        const pr   = currentPrice(pos.identifiant, env.type);
        const val  = pr * Number(pos.quantite);
        const type = STATE.prices.find(p => p.isin === pos.identifiant)?.type;
        if (env.type === 'crypto' || type === 'action') actions += val;
        else if (type === 'bond') obligations += val;
      });
    }
  });

  const alloc = total > 0
    ? { actions: (actions / total * 100).toFixed(1), obligations: (obligations / total * 100).toFixed(1), cash: (cash / total * 100).toFixed(1) }
    : { actions: 0, obligations: 0, cash: 0 };

  const totalCharges = STATE.charges
    .filter(c => c.portfolio_id === portfolioId)
    .reduce((sum, c) => sum + (Number(c.montant) || 0), 0);

  return { total, invested, alloc, totalCharges };
}

function globalStats() {
  let total = 0, invested = 0, actions = 0, obligations = 0, cash = 0;
  STATE.portfolios.forEach(p => {
    const s = portfolioStats(p.id);
    total       += s.total;
    invested    += s.invested;
    actions     += (s.alloc.actions / 100) * s.total;
    obligations += (s.alloc.obligations / 100) * s.total;
    cash        += (s.alloc.cash / 100) * s.total;
  });
  const alloc = total > 0
    ? { actions: (actions / total * 100).toFixed(1), obligations: (obligations / total * 100).toFixed(1), cash: (cash / total * 100).toFixed(1) }
    : { actions: 0, obligations: 0, cash: 0 };
  const totalCharges = STATE.charges
    .reduce((sum, c) => sum + (Number(c.montant) || 0), 0);

  return { total, invested, alloc, totalCharges };
}

function rebalancingSuggestions(portfolioId) {
  const p = STATE.portfolios.find(x => x.id === portfolioId);
  const { total, alloc } = portfolioStats(portfolioId);
  if (!total || !p) return [];

  const poches = [
    { label: 'Actions',     actuel: alloc.actions,     cible: Number(p.cible_actions) },
    { label: 'Obligations', actuel: alloc.obligations, cible: Number(p.cible_obligations) },
    { label: 'Cash',        actuel: alloc.cash,        cible: Number(p.cible_cash) },
  ];

  return poches
    .map(({ label, actuel, cible }) => {
      const ecartPct = (cible - Number(actuel)).toFixed(1);
      const ecartEur = ((cible - Number(actuel)) / 100 * total).toFixed(0);
      return { label, ecartPct, ecartEur: Number(ecartEur) };
    })
    .filter(s => Math.abs(s.ecartEur) > 100);
}

// ─── COMPOSANTS UI ───────────────────────────────────────────────────────────

function navbar(left = '') {
  const age     = API.cacheAge();
  const ageLabel = age === null ? 'aucun cache'
    : age < 60  ? `il y a ${age}s`
    : `il y a ${Math.floor(age / 60)}min`;

  return `
    <nav class="bg-slate-900 border-b border-slate-700 px-4 py-3 flex items-center justify-between">
      <div class="flex items-center gap-4">
        ${left}
        <a href="#dashboard" onclick="navigate('#dashboard');return false;" class="text-white font-bold text-sm hover:text-slate-300 transition">Portfolio Manager</a>
        <a href="#fire" onclick="navigate('#fire');return false;" class="text-orange-400 hover:text-orange-300 text-sm font-medium transition">🔥 FIRE</a>
      </div>
      <div class="flex items-center gap-4">
        <span class="text-slate-500 text-xs">Cache : ${ageLabel}</span>
        <button onclick="forceRefresh()" class="text-slate-400 hover:text-white text-xs transition">↻ Actualiser</button>
        <button onclick="localStorage.clear();location.reload()" class="text-slate-500 hover:text-white text-xs transition">Déconnexion</button>
      </div>
    </nav>`;
}

function statCards(total, invested, totalCharges = 0, annualReturn = null) {
  const pv    = total - invested;
  const pvPct = invested > 0 ? ((pv / invested) * 100).toFixed(2) : 0;
  const nette = total - totalCharges;
  const pvColor  = pv >= 0 ? 'text-emerald-400' : 'text-red-400';
  const pctColor = pv >= 0 ? 'text-emerald-500' : 'text-red-500';

  // Rendement annualisé — affiché si disponible
  let annualLine = '';
  if (annualReturn && annualReturn.value !== null) {
    const ar  = annualReturn.value;
    const est = annualReturn.estimated;
    // Même couleur que la PV, légèrement atténuée
    const arColor = ar >= 0 ? 'text-emerald-500/70' : 'text-red-500/70';
    annualLine = `<p class="text-xs ${arColor} mt-0.5">${est ? '~' : ''}${ar >= 0 ? '+' : ''}${ar}%/an${est ? '*' : ''}</p>`;
  }

  return `
    <div class="grid grid-cols-3 gap-4">
      <div class="bg-slate-800 rounded-xl p-4">
        <p class="text-slate-400 text-xs mb-1">${totalCharges > 0 ? 'Valeur nette' : 'Valeur totale'}</p>
        <p class="text-white text-2xl font-bold">${fmt(totalCharges > 0 ? nette : total)}</p>
      </div>
      <div class="bg-slate-800 rounded-xl p-4">
        <p class="text-slate-400 text-xs mb-1">Investi</p>
        <p class="text-white text-2xl font-bold">${fmt(invested)}</p>
      </div>
      <div class="bg-slate-800 rounded-xl p-4">
        <p class="text-slate-400 text-xs mb-1">Plus-value</p>
        <p class="text-2xl font-bold ${pvColor}">${pv >= 0 ? '+' : ''}${fmt(pv)}</p>
        <p class="text-xs ${pctColor}">${pvPct}%</p>
        ${annualLine}
      </div>
    </div>
    ${totalCharges > 0 ? `
    <div class="grid grid-cols-2 gap-4">
      <div class="bg-slate-800/50 border border-slate-700 rounded-xl p-3">
        <p class="text-slate-500 text-xs mb-1">Valeur brute</p>
        <p class="text-slate-400 text-lg font-semibold">${fmt(total)}</p>
      </div>
      <div class="bg-slate-800/50 border border-red-500/20 rounded-xl p-3">
        <p class="text-slate-500 text-xs mb-1">Charges à venir</p>
        <p class="text-red-400 text-lg font-semibold">−${fmt(totalCharges)}</p>
      </div>
    </div>` : ''}`;
}

function envelopeTypeAllocBar(envelopes) {
  let bourse = 0, crypto = 0, epargne = 0;
  envelopes.forEach(env => {
    const { total } = envelopeStats(env.id);
    if (env.type === 'bourse')  bourse  += total;
    if (env.type === 'crypto')  crypto  += total;
    if (env.type === 'épargne') epargne += total;
  });
  const total = bourse + crypto + epargne;
  if (!total) return '';

  const items = [
    bourse  > 0 ? { color: 'bg-blue-500',    dot: 'bg-blue-500',    label: 'Bourse',  pct: (bourse  / total * 100).toFixed(1), val: bourse  } : null,
    crypto  > 0 ? { color: 'bg-purple-500',  dot: 'bg-purple-500',  label: 'Crypto',  pct: (crypto  / total * 100).toFixed(1), val: crypto  } : null,
    epargne > 0 ? { color: 'bg-emerald-500', dot: 'bg-emerald-500', label: 'Épargne', pct: (epargne / total * 100).toFixed(1), val: epargne } : null,
  ].filter(Boolean);

  return `
    <div class="bg-slate-800 rounded-xl p-4">
      <p class="text-slate-400 text-xs mb-2">Répartition par type d'enveloppe</p>
      <div class="flex rounded-full overflow-hidden h-3 gap-0.5">
        ${items.map(i => `<div class="${i.color} transition-all" style="width:${i.pct}%"></div>`).join('')}
      </div>
      <div class="flex gap-4 text-xs text-slate-400 mt-2 flex-wrap">
        ${items.map(i => `<span><span class="inline-block w-2 h-2 rounded-full ${i.dot} mr-1"></span>${i.label} ${i.pct}% — ${fmt(i.val)}</span>`).join('')}
      </div>
    </div>`;
}

function allocBar(alloc, title, size = 'md', cible = null, total = null) {
  const h = size === 'sm' ? 'h-2' : 'h-3';
  const amt = (pct) => total ? ` — ${fmt(total * pct / 100)}` : '';
  const cibleLine = cible ? `
    <div class="flex gap-4 text-xs text-slate-500 mt-1">
      <span>Cible : ${cible.actions}% actions · ${cible.obligations}% obligations · ${cible.cash}% cash</span>
    </div>` : '';
  return `
    <div class="bg-slate-800 rounded-xl p-4">
      ${title ? `<p class="text-slate-400 text-xs mb-2">${title}</p>` : ''}
      <div class="flex rounded-full overflow-hidden ${h} gap-0.5">
        <div class="bg-blue-500 transition-all" style="width:${alloc.actions}%"></div>
        <div class="bg-amber-500 transition-all" style="width:${alloc.obligations}%"></div>
        <div class="bg-emerald-500 transition-all" style="width:${alloc.cash}%"></div>
      </div>
      <div class="flex gap-4 text-xs text-slate-400 mt-2">
        <span><span class="inline-block w-2 h-2 rounded-full bg-blue-500 mr-1"></span>Actions ${alloc.actions}%${amt(alloc.actions)}</span>
        <span><span class="inline-block w-2 h-2 rounded-full bg-amber-500 mr-1"></span>Obligations ${alloc.obligations}%${amt(alloc.obligations)}</span>
        <span><span class="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1"></span>Cash ${alloc.cash}%${amt(alloc.cash)}</span>
      </div>
      ${cibleLine}
    </div>`;
}

function rebalancingCard(suggestions) {
  const rows = suggestions.map(s => {
    const buy = s.ecartEur > 0;
    return `<li class="${buy ? 'text-emerald-400' : 'text-red-400'}">
      ${buy ? '▲' : '▼'} ${s.label} : ${buy ? '+' : ''}${s.ecartEur.toLocaleString('fr-FR')} €
      <span class="text-slate-400">(${buy ? '+' : ''}${s.ecartPct}%)</span>
    </li>`;
  }).join('');
  return `
    <div class="bg-slate-800 border border-slate-600 rounded-xl p-4">
      <p class="text-slate-300 text-sm font-medium mb-2">Suggestions de rééquilibrage</p>
      <ul class="space-y-1 text-sm list-none">${rows}</ul>
    </div>`;
}

function empty(msg) {
  return `<div class="col-span-2 text-slate-500 text-sm text-center py-8 bg-slate-800 rounded-xl">${msg}</div>`;
}

function envelopesSection(portfolioId) {
  const envs = STATE.envelopes.filter(e => e.portfolio_id === portfolioId);
  if (!envs.length) return empty('Aucune enveloppe.');

  const typeConfig = [
    { key: 'bourse',  label: 'Bourse',  cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
    { key: 'crypto',  label: 'Crypto',  cls: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
    { key: 'épargne', label: 'Épargne', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  ];

  return typeConfig
    .filter(tc => envs.some(e => e.type === tc.key))
    .map(tc => {
      const group      = envs.filter(e => e.type === tc.key);
      const groupTotal = group.reduce((sum, e) => sum + envelopeStats(e.id).total, 0);
      return `
        <div class="space-y-3">
          <h3 class="flex items-center gap-2 text-sm font-semibold text-slate-400">
            <span class="px-2.5 py-0.5 rounded-full border text-xs ${tc.cls}">${tc.label}</span>
            <span class="text-slate-300 font-semibold">${fmt(groupTotal)}</span>
          </h3>
          <div class="grid gap-4 sm:grid-cols-2">
            ${group.map(e => envelopeCard(e)).join('')}
          </div>
        </div>`;
    }).join('');
}

function sortPositions(col) {
  _posSort.col === col
    ? (_posSort.dir = _posSort.dir === 'asc' ? 'desc' : 'asc')
    : (_posSort.col = col, _posSort.dir = (col === 'valeur' || col === 'pv') ? 'desc' : 'asc');
  render();
}

function chargesSection(portfolioId) {
  const charges = STATE.charges.filter(c => c.portfolio_id === portfolioId);
  const total   = charges.reduce((s, c) => s + (Number(c.montant) || 0), 0);

  const rows = charges.map(c => `
    <tr class="border-t border-slate-700 hover:bg-slate-750">
      <td class="py-3 px-4 text-white font-medium">${esc(c.nom)}</td>
      <td class="py-3 px-4 text-red-400 font-medium">−${fmt(Number(c.montant))}</td>
      <td class="py-3 px-4 text-slate-400 text-sm">${c.date_fin ? fmtDate(c.date_fin) : '—'}</td>
      <td class="py-3 px-4 flex gap-3">
        <button onclick='openEditCharge(${JSON.stringify(c)})' class="text-slate-400 hover:text-blue-400 text-xs transition">Modifier</button>
        <button onclick="confirmDelete('charge','${c.id}')" class="text-slate-500 hover:text-red-400 text-xs transition">Supprimer</button>
      </td>
    </tr>`).join('');

  return `
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold text-white">Charges à venir</h2>
      <button onclick="openModal('charge','${portfolioId}')" class="btn-danger text-sm">+ Charge</button>
    </div>
    ${charges.length ? `
    <div class="bg-slate-800 rounded-xl overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-slate-400 text-left">
            <th class="py-3 px-4">Nom</th>
            <th class="py-3 px-4">Montant</th>
            <th class="py-3 px-4">Date de fin</th>
            <th class="py-3 px-4"></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="border-t border-slate-700 px-4 py-3 flex justify-between items-center bg-slate-800/60">
        <span class="text-slate-400 text-sm font-medium">Total charges</span>
        <span class="text-red-400 font-semibold">−${fmt(total)}</span>
      </div>
    </div>`
    : `<p class="text-slate-500 text-sm py-2">Aucune charge à venir.</p>`}`;
}

function errorBanner(msg) {
  return `<div class="m-8 bg-red-900/30 border border-red-500 text-red-300 rounded-xl p-4 text-sm">Erreur : ${esc(msg)}</div>`;
}

function fmt(n) {
  return Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  try { return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
  catch { return String(dateStr); }
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── HISTORIQUE ───────────────────────────────────────────────────────────────

function normalizeDate(d) {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

// Toutes les entrées history d'une enveloppe, triées chronologiquement
function envelopeHistory(envelopeId) {
  return STATE.history
    .filter(h => h.envelope_id === envelopeId)
    .map(h => ({ ...h, date: normalizeDate(h.date) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Somme quotidienne de toutes les enveloppes → courbe de valeur globale
function globalHistory() {
  const byDate = {};
  STATE.history.forEach(h => {
    const date = normalizeDate(h.date);
    if (!byDate[date]) byDate[date] = { date, valeur_investie: 0, valeur_actuelle: 0 };
    byDate[date].valeur_investie += Number(h.valeur_investie) || 0;
    byDate[date].valeur_actuelle += Number(h.valeur_actuelle) || 0;
  });

  return Object.values(byDate)
    .map(e => ({
      ...e,
      pv_euros: e.valeur_actuelle - e.valeur_investie,
      pv_pct: e.valeur_investie > 0
        ? ((e.valeur_actuelle / e.valeur_investie - 1) * 100).toFixed(2)
        : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Somme quotidienne des enveloppes d'un portfolio → courbe de valeur globale
function portfolioHistory(portfolioId) {
  const envIds = STATE.envelopes
    .filter(e => e.portfolio_id === portfolioId)
    .map(e => e.id);

  const byDate = {};
  STATE.history
    .filter(h => envIds.includes(h.envelope_id))
    .forEach(h => {
      const date = normalizeDate(h.date);
      if (!byDate[date]) byDate[date] = { date, valeur_investie: 0, valeur_actuelle: 0 };
      byDate[date].valeur_investie += Number(h.valeur_investie) || 0;
      byDate[date].valeur_actuelle += Number(h.valeur_actuelle) || 0;
    });

  return Object.values(byDate)
    .map(e => ({
      ...e,
      pv_euros: e.valeur_actuelle - e.valeur_investie,
      pv_pct: e.valeur_investie > 0
        ? ((e.valeur_actuelle / e.valeur_investie - 1) * 100).toFixed(2)
        : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Filtre un tableau d'entrées selon la période sélectionnée
function filterByPeriod(entries, period) {
  if (!period || period === 'all') return entries;
  const now    = new Date();
  const cutoff = new Date(now);
  if (period === '1m')  cutoff.setMonth(now.getMonth() - 1);
  if (period === '3m')  cutoff.setMonth(now.getMonth() - 3);
  if (period === '6m')  cutoff.setMonth(now.getMonth() - 6);
  if (period === '1y')  cutoff.setFullYear(now.getFullYear() - 1);
  if (period === 'ytd') { cutoff.setMonth(0); cutoff.setDate(1); }
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return entries.filter(e => e.date >= cutoffStr);
}

// ─── GRAPHIQUE SVG ────────────────────────────────────────────────────────────

// Formate une valeur pour les graduations de l'axe Y (compact, en €)
function fmtAxis(v) {
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' M€';
  if (Math.abs(v) >= 1_000)     return (v / 1_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' k€';
  return Math.round(v).toLocaleString('fr-FR') + ' €';
}

// Calcule un pas "propre" pour les graduations (ex: 500, 1000, 2500…)
function niceNumber(range, round) {
  if (!range) return 1;
  const exp  = Math.floor(Math.log10(range));
  const frac = range / Math.pow(10, exp);
  let nice;
  if (round) { nice = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10; }
  else       { nice = frac <= 1  ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10; }
  return nice * Math.pow(10, exp);
}

function svgLineChart(entries, { width = 600, height = 200, mini = false } = {}) {
  if (entries.length < 2) return '';

  const values = entries.map(e => Number(e.valeur_actuelle));
  const minV   = Math.min(...values);
  const maxV   = Math.max(...values);
  const isUp   = values[values.length - 1] >= values[0];
  const color  = isUp ? '#10b981' : '#ef4444';

  // ── Mode mini (sparkline) ─────────────────────────────────────────────────
  if (mini) {
    const range = maxV - minV || 1;
    const pad = 2, w = width - pad * 2, h = height - pad * 2;
    const pts = values.map((v, i) => {
      const x = pad + (i / Math.max(values.length - 1, 1)) * w;
      const y = pad + (1 - (v - minV) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `
      <svg viewBox="0 0 ${width} ${height}" class="w-full h-full" preserveAspectRatio="none">
        <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.5"
          stroke-linejoin="round" stroke-linecap="round"/>
      </svg>`;
  }

  // ── Graphique complet avec axes, graduations et points ───────────────────
  const padL = 72;  // espace pour labels Y
  const padR = 16;
  const padT = 14;
  const padB = 34;  // espace pour labels X
  const cw   = width  - padL - padR;
  const ch   = height - padT - padB;

  // Graduations Y : 4-5 niveaux "propres"
  const rawRange = maxV - minV;
  const tickStep = rawRange > 0
    ? niceNumber(rawRange / 4, false)
    : niceNumber((maxV || 1) / 4, false);
  const tickMin  = rawRange > 0
    ? Math.floor(minV / tickStep) * tickStep
    : Math.floor(maxV * 0.9 / tickStep) * tickStep;
  const tickMax  = rawRange > 0
    ? Math.ceil(maxV  / tickStep) * tickStep
    : Math.ceil(maxV  * 1.1 / tickStep) * tickStep;
  const totalRange = tickMax - tickMin || 1;

  const yTicks = [];
  for (let t = tickMin; t <= tickMax + tickStep * 0.01; t += tickStep) yTicks.push(t);

  const toX = i  => padL + (i / Math.max(values.length - 1, 1)) * cw;
  const toY = v  => padT + ch - ((v - tickMin) / totalRange) * ch;

  // Gridlines horizontales + labels Y
  const gridLines = yTicks.map(t => {
    const y = toY(t).toFixed(1);
    return `
      <line x1="${padL}" y1="${y}" x2="${(padL + cw).toFixed(1)}" y2="${y}"
        stroke="#334155" stroke-width="1" stroke-dasharray="4,3"/>
      <text x="${(padL - 7).toFixed(1)}" y="${y}" text-anchor="end" dominant-baseline="middle"
        fill="#94a3b8" font-size="11" font-family="system-ui,sans-serif">${fmtAxis(t)}</text>`;
  }).join('');

  // Labels X : max 7 étiquettes, bien réparties
  const maxXLabels = Math.min(7, entries.length);
  const xStep = entries.length <= maxXLabels ? 1 : Math.ceil((entries.length - 1) / (maxXLabels - 1));
  const xIndices = new Set([0, entries.length - 1]);
  for (let i = xStep; i < entries.length - 1; i += xStep) xIndices.add(i);

  const xLabels = [...xIndices].sort((a, b) => a - b).map(i => {
    const parts = (entries[i].date || '').split('-');
    const label = parts.length === 3
      ? `${parts[2]}/${parts[1]}/${parts[0].slice(2)}`
      : entries[i].date;
    return `<text x="${toX(i).toFixed(1)}" y="${(padT + ch + 22).toFixed(1)}"
      text-anchor="middle" fill="#64748b" font-size="10"
      font-family="system-ui,sans-serif">${label}</text>`;
  }).join('');

  // Courbe + aire de remplissage
  const pts     = values.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`);
  const polyPts = pts.join(' ');
  const baseY   = toY(tickMin).toFixed(1);
  const fillPts = `${toX(0).toFixed(1)},${baseY} ${polyPts} ${toX(values.length - 1).toFixed(1)},${baseY}`;

  // Points visuels (non-interactifs — les hit targets sont au-dessus)
  const visualDots = values.map((v, i) =>
    `<circle cx="${toX(i).toFixed(1)}" cy="${toY(v).toFixed(1)}" r="3.5"
      fill="${color}" stroke="#1e293b" stroke-width="1.5" pointer-events="none"/>`
  ).join('');

  // Zones de hit invisibles (rayon large pour faciliter le survol)
  const hitTargets = values.map((v, i) => {
    const e       = entries[i];
    const parts   = (e.date || '').split('-');
    const dateStr = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : e.date;
    const pv      = Number(e.pv_euros);
    const pct     = Math.abs(Number(e.pv_pct)).toFixed(2);
    const pvFmt   = fmtAxis(Math.abs(pv));
    const sign    = pv >= 0 ? '+' : '−';
    return `<circle cx="${toX(i).toFixed(1)}" cy="${toY(v).toFixed(1)}" r="14"
      fill="transparent" style="cursor:crosshair"
      data-date="${dateStr}" data-val="${fmtAxis(v)}"
      data-pv="${sign}${pvFmt}" data-pct="${sign}${pct}%" data-up="${pv >= 0}"
      onmouseenter="showChartTip(event,this)"
      onmousemove="positionChartTip(event)"
      onmouseleave="hideChartTip()"/>`;
  }).join('');

  return `
    <svg viewBox="0 0 ${width} ${height}" class="w-full" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="chart-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="${color}" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      ${gridLines}
      <polygon points="${fillPts}" fill="url(#chart-grad)"/>
      <polyline points="${polyPts}" fill="none" stroke="${color}" stroke-width="2"
        stroke-linejoin="round" stroke-linecap="round"/>
      ${visualDots}
      ${hitTargets}
      ${xLabels}
    </svg>`;
}

// ─── TOOLTIP DU GRAPHIQUE ─────────────────────────────────────────────────────

function showChartTip(event, el) {
  let tip = document.getElementById('chart-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'chart-tip';
    tip.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;display:none';
    tip.className = 'bg-slate-700 border border-slate-500/60 rounded-lg px-3 py-2 text-xs shadow-2xl';
    document.body.appendChild(tip);
  }
  const d    = el.dataset;
  const isUp = d.up === 'true';
  tip.innerHTML = `
    <p class="text-slate-400 mb-1">${d.date}</p>
    <p class="text-white font-bold text-sm">${d.val}</p>
    <p class="${isUp ? 'text-emerald-400' : 'text-red-400'} mt-0.5">${d.pv} (${d.pct})</p>`;
  tip.style.display = 'block';
  positionChartTip(event);
}

function positionChartTip(event) {
  const tip = document.getElementById('chart-tip');
  if (!tip || tip.style.display === 'none') return;
  const gap = 16;
  let x = event.clientX + gap;
  let y = event.clientY - tip.offsetHeight / 2;
  if (x + tip.offsetWidth  > window.innerWidth  - 4) x = event.clientX - tip.offsetWidth  - gap;
  if (y < 4)                                          y = 4;
  if (y + tip.offsetHeight > window.innerHeight - 4)  y = window.innerHeight - tip.offsetHeight - 4;
  tip.style.left = x + 'px';
  tip.style.top  = y + 'px';
}

function hideChartTip() {
  const tip = document.getElementById('chart-tip');
  if (tip) tip.style.display = 'none';
}

// Mini sparkline affiché sur les pages portfolio / enveloppe
function historySparkline(entries, histHref) {
  if (entries.length < 2) return '';

  const first     = entries[0];
  const last      = entries[entries.length - 1];
  const change    = last.valeur_actuelle - first.valeur_actuelle;
  const changePct = first.valeur_actuelle > 0
    ? ((change / first.valeur_actuelle) * 100).toFixed(1)
    : 0;
  const isUp = change >= 0;

  return `
    <div class="bg-slate-800 rounded-xl p-4">
      <div class="flex items-center justify-between mb-2">
        <p class="text-slate-400 text-xs">Historique (${entries.length} entrée${entries.length > 1 ? 's' : ''})</p>
        <a href="${histHref}" onclick="navigate('${histHref}');return false;"
           class="text-blue-400 hover:text-blue-300 text-xs transition">Voir le détail →</a>
      </div>
      <div class="h-14 relative">
        ${svgLineChart(entries, { width: 600, height: 56, mini: true })}
      </div>
      <p class="text-xs mt-2 ${isUp ? 'text-emerald-400' : 'text-red-400'}">
        ${isUp ? '+' : ''}${fmt(change)} (${isUp ? '+' : ''}${changePct}%) sur ${entries.length} jour${entries.length > 1 ? 's' : ''}
      </p>
    </div>`;
}

// ─── PAGES HISTORIQUE ─────────────────────────────────────────────────────────

function setHistPeriod(period) {
  _histPeriod = period;
  render();
}

function periodFilter(active) {
  const periods = [
    { key: '1m',  label: '1M'  },
    { key: '3m',  label: '3M'  },
    { key: '6m',  label: '6M'  },
    { key: 'ytd', label: 'YTD' },
    { key: '1y',  label: '1A'  },
    { key: 'all', label: 'Tout'},
  ];
  return `
    <div class="flex gap-1 flex-wrap">
      ${periods.map(p => `
        <button onclick="setHistPeriod('${p.key}')"
          class="px-3 py-1 rounded-lg text-xs font-medium transition ${active === p.key
            ? 'bg-blue-600 text-white'
            : 'bg-slate-800 text-slate-400 hover:text-white'}">
          ${p.label}
        </button>`).join('')}
    </div>`;
}

function historyStatsCards(entries) {
  if (!entries.length) return '';
  const first      = entries[0];
  const last       = entries[entries.length - 1];
  const change     = last.valeur_actuelle - first.valeur_actuelle;
  const changePct  = first.valeur_actuelle > 0
    ? ((change / first.valeur_actuelle) * 100).toFixed(2) : 0;
  const maxVal     = Math.max(...entries.map(e => Number(e.valeur_actuelle)));
  const minVal     = Math.min(...entries.map(e => Number(e.valeur_actuelle)));

  return `
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <div class="bg-slate-800 rounded-xl p-4">
        <p class="text-slate-400 text-xs mb-1">Valeur actuelle</p>
        <p class="text-white text-2xl font-bold">${fmt(last.valeur_actuelle)}</p>
      </div>
      <div class="bg-slate-800 rounded-xl p-4">
        <p class="text-slate-400 text-xs mb-1">Variation période</p>
        <p class="text-2xl font-bold ${change >= 0 ? 'text-emerald-400' : 'text-red-400'}">${change >= 0 ? '+' : ''}${fmt(change)}</p>
        <p class="text-xs ${change >= 0 ? 'text-emerald-500' : 'text-red-500'}">${change >= 0 ? '+' : ''}${changePct}%</p>
      </div>
      <div class="bg-slate-800 rounded-xl p-4">
        <p class="text-slate-400 text-xs mb-1">Plus haut</p>
        <p class="text-white text-2xl font-bold">${fmt(maxVal)}</p>
      </div>
      <div class="bg-slate-800 rounded-xl p-4">
        <p class="text-slate-400 text-xs mb-1">Plus bas</p>
        <p class="text-white text-2xl font-bold">${fmt(minVal)}</p>
      </div>
    </div>`;
}

function historyTable(entries) {
  if (!entries.length) return `<p class="text-slate-500 text-sm py-4 text-center">Aucune donnée.</p>`;

  const rows = [...entries].reverse().map(h => {
    const pv  = Number(h.pv_euros);
    const pct = Number(h.pv_pct);
    return `
      <tr class="border-t border-slate-700 hover:bg-slate-750">
        <td class="py-3 px-4 text-slate-300 text-sm">${fmtDate(h.date)}</td>
        <td class="py-3 px-4 text-white font-medium">${fmt(h.valeur_actuelle)}</td>
        <td class="py-3 px-4 text-slate-400">${fmt(h.valeur_investie)}</td>
        <td class="py-3 px-4 ${pv >= 0 ? 'text-emerald-400' : 'text-red-400'}">${pv >= 0 ? '+' : ''}${fmt(pv)} (${pct >= 0 ? '+' : ''}${pct}%)</td>
      </tr>`;
  }).join('');

  return `
    <div class="bg-slate-800 rounded-xl overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="text-slate-400 text-left">
            <th class="py-3 px-4">Date</th>
            <th class="py-3 px-4">Valeur</th>
            <th class="py-3 px-4">Investi</th>
            <th class="py-3 px-4">Plus-value</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// Contenu partagé entre les deux pages d'historique
function historyContent(allEntries, filtered) {
  if (!allEntries.length) return `
    <div class="bg-slate-800 rounded-xl p-10 text-center space-y-2">
      <p class="text-slate-300 font-medium">Aucune donnée historique disponible.</p>
      <p class="text-slate-500 text-sm">Lance <code class="bg-slate-700 px-1.5 py-0.5 rounded text-slate-400">takeDailySnapshot()</code> depuis l'éditeur AppScript, ou configure un déclencheur avec <code class="bg-slate-700 px-1.5 py-0.5 rounded text-slate-400">createDailyTrigger()</code>.</p>
    </div>`;

  return `
    <div class="flex items-center justify-between flex-wrap gap-3">
      ${periodFilter(_histPeriod)}
      <p class="text-slate-500 text-xs">${filtered.length} point${filtered.length > 1 ? 's' : ''}</p>
    </div>
    ${historyStatsCards(filtered)}
    <div class="bg-slate-800 rounded-xl p-4">
      ${svgLineChart(filtered, { width: 900, height: 240 })}
    </div>
    ${historyTable(filtered)}`;
}

function renderHistoryEnv(app, envelopeId) {
  const e = STATE.envelopes.find(x => x.id === envelopeId);
  if (!e) { navigate('#dashboard'); return; }
  const portfolio = STATE.portfolios.find(p => p.id === e.portfolio_id);

  const all      = envelopeHistory(envelopeId);
  const filtered = filterByPeriod(all, _histPeriod);

  app.innerHTML = `
    ${navbar(`<a href="#envelope/${e.id}" class="text-slate-400 hover:text-white text-sm">← ${esc(e.nom)}</a>`)}
    <div class="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 class="text-2xl font-bold text-white">${esc(e.nom)}</h1>
        <p class="text-slate-400 text-sm mt-1">Historique · <span class="capitalize">${e.type}</span> · ${esc(portfolio?.nom || '')}</p>
      </div>
      ${historyContent(all, filtered)}
    </div>`;
}

function renderHistoryPf(app, portfolioId) {
  const p = STATE.portfolios.find(x => x.id === portfolioId);
  if (!p) { navigate('#dashboard'); return; }

  const all      = portfolioHistory(portfolioId);
  const filtered = filterByPeriod(all, _histPeriod);

  app.innerHTML = `
    ${navbar(`<a href="#portfolio/${p.id}" class="text-slate-400 hover:text-white text-sm">← ${esc(p.nom)}</a>`)}
    <div class="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 class="text-2xl font-bold text-white">${esc(p.nom)}</h1>
        <p class="text-slate-400 text-sm mt-1">Historique de valeur du portfolio</p>
      </div>
      ${historyContent(all, filtered)}
    </div>`;
}

function renderHistoryGlobal(app) {
  const all      = globalHistory();
  const filtered = filterByPeriod(all, _histPeriod);

  app.innerHTML = `
    ${navbar(`<a href="#dashboard" class="text-slate-400 hover:text-white text-sm">← Dashboard</a>`)}
    <div class="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 class="text-2xl font-bold text-white">Historique global</h1>
        <p class="text-slate-400 text-sm mt-1">Tous les portfolios confondus</p>
      </div>
      ${historyContent(all, filtered)}
    </div>`;
}

// ─── FIRE / SIMULATION ────────────────────────────────────────────────────────

// Paramètres de simulation (persistés pendant la session)
let _fp = null;

// Calcule le rendement annualisé (CAGR) à partir d'un tableau d'entrées history.
// Retourne { value: number|null, estimated: boolean }
//   • value      : rendement annualisé en %, arrondi à 0.1 %
//   • estimated  : true si l'historique est < 6 mois (on suppose 5 ans de détention)
function computeAnnualReturn(histEntries) {
  if (!histEntries || !histEntries.length) return { value: null, estimated: false };
  const last        = histEntries[histEntries.length - 1];
  const totalReturn = Number(last.pv_pct) / 100;
  if (!isFinite(totalReturn) || totalReturn <= -1) return { value: null, estimated: false };

  const first    = histEntries[0];
  const histDays = histEntries.length >= 2
    ? (new Date(last.date) - new Date(first.date)) / 86400000
    : 0;

  // Moins de 6 mois d'historique → hypothèse 5 ans de détention
  const estimated = histDays < 180;
  const years     = estimated ? 5 : histDays / 365;

  const annualized = (Math.pow(1 + totalReturn, 1 / years) - 1) * 100;
  return { value: Math.round(annualized * 10) / 10, estimated };
}

// Estime le rendement annuel net à partir de l'historique global du portfolio.
// Méthode : annualise le PV% total (valeur_actuelle / valeur_investie − 1).
//
// Durée utilisée :
//   • Historique >= 6 mois → on utilise la durée réelle observée
//   • Historique < 6 mois (ou absent) → on suppose que les positions sont
//     détenues depuis 5 ans (hypothèse conservative pour un portefeuille existant)
function estimateAnnualReturn() {
  const hist = globalHistory();
  const last  = hist.length ? hist[hist.length - 1] : null;

  // PV% : ratio rendement total depuis le prix d'achat
  const totalReturn = last ? Number(last.pv_pct) / 100 : null;
  if (totalReturn === null || !isFinite(totalReturn) || totalReturn <= -1) return 7;

  // Durée réelle de l'historique en jours
  const first       = hist[0];
  const histDays    = hist.length >= 2
    ? (new Date(last.date) - new Date(first.date)) / 86400000
    : 0;

  // Si moins de 6 mois d'historique : on pose l'hypothèse de 5 ans de détention
  const years = histDays >= 180 ? histDays / 365 : 5;

  const annualized = (Math.pow(1 + totalReturn, 1 / years) - 1) * 100;
  // Arrondi au 0.5 % le plus proche, borné entre 0 et 20 %
  return Math.max(0, Math.min(20, Math.round(annualized * 2) / 2));
}

function _fpInit() {
  const { total, totalCharges } = globalStats();
  const capital          = Math.max(0, Math.round(total - totalCharges)); // valeur nette
  const defaultRendement = estimateAnnualReturn();

  if (!_fp) {
    const saved = STATE.fire_profile && STATE.fire_profile[0];
    if (saved && saved.rendement != null) {
      // Charger le profil sauvegardé depuis Google Sheets
      _fp = {
        capital,
        rendement:     Number(saved.rendement)     || defaultRendement,
        inflation:     Number(saved.inflation)     || 2,
        duree:         Number(saved.duree)         || 30,
        versement:     Number(saved.versement)     || 500,
        depenses:      Number(saved.depenses)      || 2000,
        swr:           Number(saved.swr)           || 4,
        dwzMode:       saved.dwzMode === true || saved.dwzMode === 'TRUE',
        dureeFire:     Number(saved.dureeFire)     || 30,
        reserveFinale: Number(saved.reserveFinale) || 0,
        depart:        Number(saved.depart)        || 0,
        age:           Number(saved.age)           || 39,
      };
    } else {
      // Aucun profil sauvegardé — valeurs par défaut
      _fp = { capital, rendement: defaultRendement, inflation: 2, duree: 30, versement: 500,
              depenses: 2000, swr: 4, dwzMode: false, dureeFire: 30, reserveFinale: 0,
              depart: 0, age: 39 };
    }
  } else {
    _fp.capital = capital; // Synchronise valeur nette depuis le portfolio
  }
}

// ─── SAUVEGARDE DIFFÉRÉE DU PROFIL FIRE ──────────────────────────────────────
// Déclenché à chaque modification d'un paramètre FIRE.
// Debounce 2 s pour éviter de spammer l'API sur chaque glissement de slider.

let _fpSaveTimer = null;

function _scheduleSave() {
  if (!API.isConfigured() || !_fp) return;
  if (_fpSaveTimer) clearTimeout(_fpSaveTimer);
  _fpSaveTimer = setTimeout(async () => {
    try {
      await API.saveFireProfile({ ..._fp });
      // Met à jour le cache pour que le rechargement de page retrouve le bon profil
      const cached = API._getCache();
      if (cached) {
        cached.fire_profile = [{ ..._fp }];
        API._setCache(cached);
      }
    } catch (e) {
      console.warn('Erreur sauvegarde profil FIRE :', e);
    }
  }, 2000);
}

// ─── CARTES FIRE DU DASHBOARD ─────────────────────────────────────────────────
// Affiche deux aperçus rapides (FIRE classique + Die with Zero) sur le dashboard.
// Simule les deux modes à partir du profil courant sans modifier _fp.

function fireDashboardCards() {
  _fpInit(); // s'assure que _fp est initialisé

  const curYear  = new Date().getFullYear();
  const savedDwz = _fp.dwzMode;

  // Simulation FIRE classique
  _fp.dwzMode = false;
  const { data: cData, fireYear: cFireYear } = runFireSimulation();

  // Simulation Die with Zero
  _fp.dwzMode = true;
  const { data: dData, fireYear: dFireYear } = runFireSimulation();

  _fp.dwzMode = savedDwz; // restaurer le mode d'origine

  // Calcul des retraits à l'année FIRE
  const cFire     = cFireYear ? cData.find(d => d.year === cFireYear) : null;
  const cRetAnnuel  = cFire ? Math.round(cFire.yearStart * _fp.swr / 100) : 0;
  const cRetMensuel = Math.round(cRetAnnuel / 12);

  const dFire       = dFireYear ? dData.find(d => d.year === dFireYear) : null;
  const dRetMensuel = dFire ? Math.round(dFire.withdrawal / 12) : 0;

  const classicCard = `
    <a href="#fire" onclick="navigate('#fire');return false;"
      class="bg-slate-800 rounded-xl p-5 hover:bg-slate-750 transition cursor-pointer block">
      <div class="flex items-center gap-2 mb-3">
        <span class="text-xl leading-none">🔥</span>
        <p class="text-slate-400 text-xs font-semibold uppercase tracking-wider">FIRE Classique · SWR ${_fp.swr}%</p>
      </div>
      ${cFireYear
        ? `<p class="text-amber-400 text-2xl font-bold">
             An ${cFireYear}
             <span class="text-slate-500 text-sm font-normal">(${curYear + cFireYear})</span>
           </p>
           <p class="text-slate-300 text-sm mt-1">
             ${fmt(cRetMensuel)}<span class="text-slate-500">/mois</span>
             <span class="text-slate-600 text-xs ml-2">· ${fmt(cRetAnnuel)}/an</span>
           </p>`
        : `<p class="text-slate-400 font-semibold">Non atteint sur ${_fp.duree} ans</p>
           <p class="text-slate-600 text-xs mt-1">↑ versements ou durée de simulation</p>`}
      <p class="text-slate-600 text-xs mt-3">Objectif : ${fmt(_fp.depenses)}/mois</p>
    </a>`;

  const dwzCard = `
    <a href="#fire" onclick="navigate('#fire');return false;"
      class="bg-slate-800 rounded-xl p-5 hover:bg-slate-750 transition cursor-pointer block">
      <div class="flex items-center gap-2 mb-3">
        <span class="text-xl leading-none">💀</span>
        <p class="text-slate-400 text-xs font-semibold uppercase tracking-wider">Die with Zero · ${_fp.dureeFire} ans</p>
      </div>
      ${dFireYear
        ? `<p class="text-orange-400 text-2xl font-bold">
             An ${dFireYear}
             <span class="text-slate-500 text-sm font-normal">(${curYear + dFireYear})</span>
           </p>
           <p class="text-slate-300 text-sm mt-1">
             ${fmt(dRetMensuel)}<span class="text-slate-500">/mois</span>
             <span class="text-slate-600 text-xs ml-2">· ${fmt(dRetMensuel * 12)}/an</span>
           </p>`
        : `<p class="text-slate-400 font-semibold">Non atteint sur ${_fp.duree} ans</p>
           <p class="text-slate-600 text-xs mt-1">↑ versements ou durée de simulation</p>`}
      <p class="text-slate-600 text-xs mt-3">Objectif : ${fmt(_fp.depenses)}/mois</p>
    </a>`;

  // Carte VPW — affichée seulement si les données sont disponibles dans Google Sheets
  const vpw    = STATE.vpw;
  const vpwCard = vpw && vpw.monthlyWithdrawal != null ? `
    <a href="#fire" onclick="navigate('#fire');return false;"
      class="bg-slate-800 rounded-xl p-5 hover:bg-slate-750 transition cursor-pointer block">
      <div class="flex items-center gap-2 mb-3">
        <span class="text-xl leading-none">📊</span>
        <p class="text-slate-400 text-xs font-semibold uppercase tracking-wider">VPW${vpw.vpwPct != null ? ' · ' + vpw.vpwPct + '%' : ''}</p>
      </div>
      <p class="text-blue-400 text-2xl font-bold">
        ${fmt(vpw.monthlyWithdrawal)}<span class="text-slate-500 text-sm font-normal">/mois</span>
      </p>
      <p class="text-slate-400 text-sm mt-1">
        ${fmt(vpw.annualWithdrawal ?? vpw.monthlyWithdrawal * 12)}<span class="text-slate-500">/an</span>
      </p>
      ${vpw.monthlyAfterLoss != null
        ? `<p class="text-slate-600 text-xs mt-3">Après correction : <span class="text-amber-500">${fmt(vpw.monthlyAfterLoss)}/mois</span></p>`
        : ''}
    </a>` : '';

  const hasVpw   = !!(vpwCard);
  const gridCols = hasVpw ? 'sm:grid-cols-3' : 'sm:grid-cols-2';
  return `<div class="grid grid-cols-1 ${gridCols} gap-4">${classicCard}${dwzCard}${vpwCard}</div>`;
}

function renderFire(app) {
  _fpInit();
  app.innerHTML = `
    ${navbar(`<a href="#dashboard" class="text-slate-400 hover:text-white text-sm">← Dashboard</a>`)}
    <div class="max-w-6xl mx-auto px-4 py-8">
      <div class="flex items-center gap-3 mb-6">
        <span class="text-4xl leading-none">🔥</span>
        <div>
          <h1 class="text-2xl font-bold text-white">Simulation FIRE</h1>
          <p class="text-slate-400 text-sm">Financial Independence, Retire Early — projections basées sur ton portfolio</p>
        </div>
      </div>
      <div class="flex gap-6 items-start flex-col lg:flex-row">
        <div class="lg:w-72 w-full shrink-0">
          ${fireParamsPanel()}
        </div>
        <div class="flex-1 min-w-0 space-y-4" id="fire-results">
          ${fireResults()}
        </div>
      </div>
    </div>`;
}

function fireParamsPanel() {
  const dwz = _fp.dwzMode;
  return `
    <div class="bg-slate-800 rounded-xl p-5 space-y-5 lg:sticky lg:top-4">
      <h2 class="text-white font-semibold text-xs uppercase tracking-wider">Paramètres</h2>

      <div>
        <label class="label">Capital initial (€)</label>
        <input type="number" value="${_fp.capital}" min="0" step="1000" class="input"
          oninput="_fp.capital=Math.max(0,+this.value);refreshFireResults()">
        <p class="text-slate-600 text-xs mt-1">Valeur nette du portfolio</p>
      </div>

      <div>
        <div class="flex justify-between items-center mb-1.5">
          <label class="text-slate-400 text-xs font-medium">Rendement annuel net</label>
          <span id="fp-r-lbl" class="text-blue-400 text-xs font-bold">${_fp.rendement}%</span>
        </div>
        <input type="range" value="${_fp.rendement}" min="0" max="20" step="0.5"
          class="w-full h-1.5 rounded-lg appearance-none cursor-pointer accent-blue-500"
          oninput="_fp.rendement=+this.value;document.getElementById('fp-r-lbl').textContent=this.value+'%';refreshFireResults()">
        <div class="flex justify-between text-slate-700 text-xs mt-0.5"><span>0%</span><span>20%</span></div>
      </div>

      <div>
        <div class="flex justify-between items-center mb-1.5">
          <label class="text-slate-400 text-xs font-medium">Inflation</label>
          <span id="fp-i-lbl" class="text-amber-400 text-xs font-bold">${_fp.inflation}%</span>
        </div>
        <input type="range" value="${_fp.inflation}" min="0" max="10" step="0.5"
          class="w-full h-1.5 rounded-lg appearance-none cursor-pointer accent-amber-500"
          oninput="_fp.inflation=+this.value;document.getElementById('fp-i-lbl').textContent=this.value+'%';refreshFireResults()">
        <div class="flex justify-between text-slate-700 text-xs mt-0.5"><span>0%</span><span>10%</span></div>
      </div>

      <div>
        <div class="flex justify-between items-center mb-1.5">
          <label class="text-slate-400 text-xs font-medium">Durée de simulation</label>
          <span id="fp-d-lbl" class="text-slate-300 text-xs font-bold">${_fp.duree} ans</span>
        </div>
        <input type="range" value="${_fp.duree}" min="5" max="50" step="1"
          class="w-full h-1.5 rounded-lg appearance-none cursor-pointer accent-slate-400"
          oninput="_fp.duree=+this.value;document.getElementById('fp-d-lbl').textContent=this.value+' ans';refreshFireResults()">
        <div class="flex justify-between text-slate-700 text-xs mt-0.5"><span>5 ans</span><span>50 ans</span></div>
      </div>

      <div>
        <label class="label">Versement mensuel (€)</label>
        <input type="number" value="${_fp.versement}" min="0" step="50" class="input"
          oninput="_fp.versement=Math.max(0,+this.value);refreshFireResults()">
      </div>

      <div>
        <div class="flex justify-between items-center mb-1.5">
          <label class="text-slate-400 text-xs font-medium">Accumulation min. avant FIRE</label>
          <span id="fp-dep-lbl" class="text-slate-300 text-xs font-bold">${_fp.depart === 0 ? 'auto' : _fp.depart + ' ans'}</span>
        </div>
        <input type="range" value="${_fp.depart}" min="0" max="40" step="1"
          class="w-full h-1.5 rounded-lg appearance-none cursor-pointer accent-slate-400"
          oninput="_fp.depart=+this.value;document.getElementById('fp-dep-lbl').textContent=this.value==0?'auto':this.value+' ans';refreshFireResults()">
        <div class="flex justify-between text-slate-700 text-xs mt-0.5"><span>auto</span><span>40 ans</span></div>
        <p class="text-slate-600 text-xs mt-1">Force les versements sur N ans avant de prendre ta retraite</p>
      </div>

      <div class="border-t border-slate-700 pt-4 space-y-4">
        <p class="text-slate-400 text-xs font-semibold uppercase tracking-wider">Objectif FIRE</p>

        <div>
          <label class="label">Dépenses mensuelles en FIRE (€)</label>
          <input type="number" value="${_fp.depenses}" min="0" step="100" class="input"
            oninput="_fp.depenses=Math.max(0,+this.value);refreshFireResults()">
        </div>

        <!-- Section SWR — masquée en mode DWZ -->
        <div id="fp-swr-section" style="${dwz ? 'display:none' : ''}">
          <div class="flex justify-between items-center mb-1.5">
            <label class="text-slate-400 text-xs font-medium">SWR (taux de retrait)</label>
            <span id="fp-s-lbl" class="text-emerald-400 text-xs font-bold">${_fp.swr}%</span>
          </div>
          <input type="range" value="${_fp.swr}" min="1" max="8" step="0.5"
            class="w-full h-1.5 rounded-lg appearance-none cursor-pointer accent-emerald-500"
            oninput="_fp.swr=+this.value;document.getElementById('fp-s-lbl').textContent=this.value+'%';refreshFireResults()">
          <div class="flex justify-between text-slate-700 text-xs mt-0.5"><span>1%</span><span>8%</span></div>
        </div>
      </div>

      <!-- Toggle Die with Zero -->
      <div class="border-t border-slate-700 pt-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-slate-200 text-sm font-semibold">Die with Zero</p>
            <p class="text-slate-500 text-xs mt-0.5">Épuiser le capital sur N ans</p>
          </div>
          <button type="button" id="fp-dwz-btn"
            onclick="_fp.dwzMode=!_fp.dwzMode;const on=_fp.dwzMode;document.getElementById('fp-dwz-btn').className=on?'${_toggleOnCls()}':'${_toggleOffCls()}';document.getElementById('fp-dwz-thumb').className=on?'${_thumbOnCls()}':'${_thumbOffCls()}';document.getElementById('fp-swr-section').style.display=on?'none':'';document.getElementById('fp-dwz-section').style.display=on?'':'none';refreshFireResults()"
            class="${dwz ? _toggleOnCls() : _toggleOffCls()}">
            <div id="fp-dwz-thumb" class="${dwz ? _thumbOnCls() : _thumbOffCls()}"></div>
          </button>
        </div>

        <!-- Paramètres DWZ — masqués en mode classique -->
        <div id="fp-dwz-section" style="${dwz ? '' : 'display:none'}" class="mt-4 space-y-4">

          <div>
            <div class="flex justify-between items-center mb-1.5">
              <label class="text-slate-400 text-xs font-medium">Durée de vie en FIRE</label>
              <span id="fp-df-lbl" class="text-orange-400 text-xs font-bold">${_fp.dureeFire} ans</span>
            </div>
            <input type="range" value="${_fp.dureeFire}" min="5" max="50" step="1"
              class="w-full h-1.5 rounded-lg appearance-none cursor-pointer accent-orange-500"
              oninput="_fp.dureeFire=+this.value;document.getElementById('fp-df-lbl').textContent=this.value+' ans';refreshFireResults()">
            <div class="flex justify-between text-slate-700 text-xs mt-0.5"><span>5 ans</span><span>50 ans</span></div>
          </div>

          <div>
            <label class="label">Réserve finale (€)</label>
            <input type="number" value="${_fp.reserveFinale}" min="0" step="1000" class="input"
              oninput="_fp.reserveFinale=Math.max(0,+this.value);refreshFireResults()">
            <p class="text-slate-600 text-xs mt-1">Capital à laisser en héritage</p>
          </div>

          <div class="bg-orange-500/8 border border-orange-500/20 rounded-lg p-3 text-xs text-slate-400 space-y-1">
            <p class="text-orange-300 font-semibold">💀 Die with Zero</p>
            <p>Le capital est progressivement épuisé sur ${_fp.dureeFire} ans plutôt que préservé indéfiniment. Les retraits sont plus élevés.</p>
          </div>
        </div>
      </div>

    </div>`;
}

// Helpers pour le toggle DWZ (inline CSS via classes Tailwind)
function _toggleOnCls()  { return 'relative w-10 h-6 rounded-full bg-orange-500 transition-colors cursor-pointer border-0 p-0'; }
function _toggleOffCls() { return 'relative w-10 h-6 rounded-full bg-slate-600 transition-colors cursor-pointer border-0 p-0'; }
function _thumbOnCls()   { return 'absolute top-1 left-5 w-4 h-4 rounded-full bg-white transition-transform'; }
function _thumbOffCls()  { return 'absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform'; }

function refreshFireResults() {
  const el = document.getElementById('fire-results');
  if (el) el.innerHTML = fireResults();
  _scheduleSave();
}

// ─── CARTE VPW (résultats pré-calculés depuis Google Sheets) ──────────────────
// Affiche les résultats de l'onglet "VPW Retirement" sans recalculer côté JS.
// Retourne '' si les données ne sont pas disponibles.

function fireVpwCard() {
  const v = STATE.vpw;
  if (!v || v.monthlyWithdrawal == null) return '';

  const cible    = _fp ? _fp.depenses : 0;
  const retOk    = cible > 0 && v.monthlyWithdrawal >= cible;
  const hasStress = v.monthlyAfterLoss != null && v.monthlyAfterLoss > 0;

  return `
    <div class="bg-slate-800 rounded-xl p-5 border border-blue-500/20">

      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <span class="text-xl leading-none">📊</span>
          <div>
            <p class="text-white text-sm font-semibold">Variable Percentage Withdrawal</p>
            <p class="text-slate-500 text-xs">Calculé dans Google Sheets · Taux ajusté chaque année</p>
          </div>
        </div>
        ${v.vpwPct != null
          ? `<span class="bg-blue-500/15 text-blue-400 text-xs font-bold px-2.5 py-1 rounded-full">${v.vpwPct}% appliqué</span>`
          : ''}
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">

        <div>
          <p class="text-slate-500 text-xs mb-1">Retrait mensuel suggéré</p>
          <p class="${retOk ? 'text-emerald-400' : 'text-blue-400'} text-xl font-bold">
            ${fmt(v.monthlyWithdrawal)}<span class="text-slate-500 text-sm font-normal">/mois</span>
          </p>
          ${cible > 0 ? `<p class="text-slate-600 text-xs mt-0.5">${retOk ? '✓ Objectif atteint' : `${fmt(cible - v.monthlyWithdrawal)} sous l'objectif`}</p>` : ''}
        </div>

        <div>
          <p class="text-slate-500 text-xs mb-1">Retrait annuel</p>
          <p class="text-slate-300 text-xl font-bold">${fmt(v.annualWithdrawal ?? v.monthlyWithdrawal * 12)}</p>
        </div>

        ${hasStress ? `
        <div>
          <p class="text-slate-500 text-xs mb-1">Après correction marché</p>
          <p class="text-amber-400 text-xl font-bold">
            ${fmt(v.monthlyAfterLoss)}<span class="text-slate-500 text-sm font-normal">/mois</span>
          </p>
          ${v.monthlyReduction != null
            ? `<p class="text-red-400 text-xs mt-0.5">${fmt(v.monthlyReduction)}/mois</p>`
            : ''}
        </div>

        <div>
          <p class="text-slate-500 text-xs mb-1">Portfolio après perte</p>
          <p class="text-slate-300 font-semibold">${fmt(v.balanceAfterLoss)}</p>
          ${v.portfolioLoss != null
            ? `<p class="text-red-400 text-xs mt-0.5">${fmt(v.portfolioLoss)} simulé</p>`
            : ''}
        </div>` : '<div></div><div></div>'}

      </div>
    </div>`;
}

function runFireSimulation() {
  const { capital, rendement, inflation, duree, versement, depenses, swr,
          dwzMode, dureeFire, reserveFinale, depart } = _fp;
  const r              = rendement / 100;
  const inf            = inflation / 100;
  const annualExpenses = depenses * 12;

  let portfolio   = capital;
  let cumInvested = capital;
  const data      = [];
  let fireYear    = null;

  // Calcule le retrait annuel DWZ (formule de rente / PMT)
  // On soustrait la valeur ACTUALISÉE de la réserve (pas la valeur brute) :
  //   pvOfReserve = reserveFinale / (1+r)^n  ← ce que vaut la réserve aujourd'hui
  // Ainsi le portfolio atteint exactement reserveFinale à l'échéance.
  const dwzPmt = (pv, remaining) => {
    if (remaining <= 0) return Math.max(0, pv); // sécurité
    const pvOfReserve   = reserveFinale > 0 ? reserveFinale / Math.pow(1 + r, remaining) : 0;
    const toDepleteBase = Math.max(0, pv - pvOfReserve);
    if (r === 0) return toDepleteBase / remaining;
    return toDepleteBase * r / (1 - Math.pow(1 + r, -remaining));
  };

  for (let year = 1; year <= duree; year++) {
    const yearStart = portfolio;

    // ── Détection de l'année FIRE ──────────────────────────────────────────
    // Le paramètre `depart` impose une durée minimum d'accumulation avant FIRE
    const fireCanTrigger = depart === 0 || year >= depart;
    if (fireYear === null && annualExpenses > 0 && fireCanTrigger) {
      if (dwzMode) {
        // DWZ : FIRE quand la rente annuelle couvre les dépenses
        if (dwzPmt(yearStart, dureeFire) >= annualExpenses) fireYear = year;
      } else {
        // Classique SWR
        if (yearStart * (swr / 100) >= annualExpenses) fireYear = year;
      }
    }

    const inFire       = fireYear !== null && year >= fireYear;
    const contribution = inFire ? 0 : versement * 12;

    // ── Calcul du retrait ──────────────────────────────────────────────────
    let withdrawal = 0;
    if (inFire) {
      if (dwzMode) {
        const yearsInFire = year - fireYear;            // 0 à l'année FIRE
        const remaining   = dureeFire - yearsInFire;    // décroît jusqu'à 0
        withdrawal = dwzPmt(yearStart, remaining);
      } else {
        // Classique : dépenses constantes indexées sur l'inflation
        withdrawal = annualExpenses * Math.pow(1 + inf, year - fireYear);
      }
    }

    const gain  = yearStart * r;
    portfolio   = yearStart + gain + contribution - withdrawal;
    cumInvested += contribution;

    if (portfolio < 0) portfolio = 0;

    // ── Capacité de retrait mensuelle (pour le tableau) ────────────────────
    // Avant FIRE : ce qu'on POURRAIT retirer si on prenait sa retraite cette année
    // En FIRE    : le retrait effectif mensuel
    const retMensuel = inFire
      ? Math.round(withdrawal / 12)
      : dwzMode
        ? Math.round(dwzPmt(yearStart, dureeFire) / 12)
        : (swr > 0 ? Math.round(yearStart * swr / 100 / 12) : 0);

    data.push({
      year,
      yearStart:    Math.round(yearStart),
      gain:         Math.round(gain),
      contribution: Math.round(contribution),
      withdrawal:   Math.round(withdrawal),
      portfolio:    Math.round(portfolio),
      invested:     Math.round(cumInvested),
      retMensuel,
      isFireYear:   year === fireYear,
      inFire,
      ruined:       portfolio <= 0 && inFire,
    });

    if (portfolio <= 0) break;
  }

  return { data, fireYear };
}

function fireResults() {
  const { data, fireYear } = runFireSimulation();
  if (!data.length) return `<p class="text-slate-500 text-center py-12">Aucune donnée.</p>`;

  return `
    ${fireStatsCards(data, fireYear)}
    ${fireVpwCard()}
    <div class="bg-slate-800 rounded-xl p-4">
      <p class="text-slate-400 text-xs mb-3">Projection du portfolio
        <span class="ml-2 text-slate-600">· bleu = valeur · pointillés = capital investi${fireYear ? ' · orange = année FIRE' : ''}</span>
      </p>
      ${fireSvgChart(data, fireYear)}
    </div>
    <div class="rounded-xl overflow-hidden border border-slate-700">
      <div class="max-h-96 overflow-y-auto">
        ${fireTable(data, fireYear)}
      </div>
    </div>`;
}

function fireStatsCards(data, fireYear) {
  const last           = data[data.length - 1];
  const totalWithdrawn = data.reduce((s, d) => s + d.withdrawal,   0);
  const totalContrib   = data.reduce((s, d) => s + d.contribution, 0);
  const totalGains     = last.portfolio + totalWithdrawn - _fp.capital - totalContrib;
  const curYear        = new Date().getFullYear();

  // Carte 2 : toujours visible — Retrait FIRE mensuel + annuel
  const fireData    = fireYear ? data.find(d => d.year === fireYear) : null;
  let retAnnuel, retMensuel2;
  if (_fp.dwzMode) {
    retAnnuel  = fireData ? fireData.withdrawal : 0;
    retMensuel2 = Math.round(retAnnuel / 12);
  } else {
    const pfAtFire = fireData ? fireData.yearStart : _fp.capital;
    retAnnuel  = Math.round(pfAtFire * _fp.swr / 100);
    retMensuel2 = Math.round(retAnnuel / 12);
  }
  const targetMensuel = _fp.depenses;
  const retPct        = targetMensuel > 0 ? Math.min(100, retMensuel2 / targetMensuel * 100) : 100;
  const retOk         = retMensuel2 >= targetMensuel;

  const card2 = `
    <div class="bg-slate-800 rounded-xl p-4">
      <p class="text-slate-400 text-xs mb-1">Retrait FIRE</p>
      <p class="${retOk ? 'text-emerald-400' : 'text-white'} text-xl font-bold">
        ${fmt(retMensuel2)}<span class="text-slate-500 text-sm font-normal">/mois</span>
      </p>
      <p class="text-slate-400 text-xs mt-0.5">${fmt(retAnnuel)}/an</p>
      <div class="mt-2 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div class="h-full rounded-full transition-all ${retOk ? 'bg-emerald-500' : 'bg-amber-500'}"
          style="width:${retPct.toFixed(1)}%"></div>
      </div>
      <p class="text-slate-500 text-xs mt-1">${retPct.toFixed(0)}% de la cible (${fmt(targetMensuel)}/mois)</p>
    </div>`;

  return `
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">

      <div class="bg-slate-800 rounded-xl p-4">
        <p class="text-slate-400 text-xs mb-1">Année FIRE</p>
        ${fireYear
          ? `<p class="text-amber-400 text-2xl font-bold">An ${fireYear}</p>
             <p class="text-slate-500 text-xs mt-0.5">Soit en ${curYear + fireYear}</p>`
          : `<p class="text-slate-400 text-base font-semibold leading-tight mt-1">Non atteint</p>
             <p class="text-slate-600 text-xs mt-1">↑ versements ou durée</p>`}
      </div>

      ${card2}

      <div class="bg-slate-800 rounded-xl p-4">
        <p class="text-slate-400 text-xs mb-1">Portfolio fin an ${last.year}</p>
        <p class="${last.ruined ? 'text-red-400' : 'text-white'} text-xl font-bold">
          ${last.ruined ? '⚠ Ruiné' : fmt(last.portfolio)}
        </p>
        ${last.ruined ? `<p class="text-red-500 text-xs mt-1">Fonds épuisés</p>` : ''}
      </div>

      <div class="bg-slate-800 rounded-xl p-4">
        <p class="text-slate-400 text-xs mb-1">Gains totaux générés</p>
        <p class="${totalGains >= 0 ? 'text-emerald-400' : 'text-red-400'} text-xl font-bold">
          ${totalGains >= 0 ? '+' : ''}${fmt(totalGains)}
        </p>
        <p class="text-slate-500 text-xs mt-1">Intérêts composés</p>
      </div>

    </div>`;
}

function fireSvgChart(data, fireYear) {
  if (data.length < 2) return '';

  const width = 900, height = 260;
  const padL  = 82, padR = 20, padT = 18, padB = 36;
  const cw    = width  - padL - padR;
  const ch    = height - padT - padB;

  const maxV     = Math.max(...data.flatMap(d => [d.portfolio, d.invested]));
  const tickStep = niceNumber((maxV || 1) / 5, false);
  const tickMax  = Math.ceil((maxV || 1) / tickStep) * tickStep;

  const yTicks = [];
  for (let t = 0; t <= tickMax + tickStep * 0.01; t += tickStep) yTicks.push(t);

  const toX = i => padL + (i / Math.max(data.length - 1, 1)) * cw;
  const toY = v => padT + ch - (v / tickMax) * ch;

  // Gridlines + labels axe Y
  const gridLines = yTicks.map(t => {
    const y = toY(t).toFixed(1);
    return `
      <line x1="${padL}" y1="${y}" x2="${(padL + cw).toFixed(1)}" y2="${y}"
        stroke="#334155" stroke-width="1" stroke-dasharray="4,3"/>
      <text x="${(padL - 8).toFixed(1)}" y="${y}" text-anchor="end" dominant-baseline="middle"
        fill="#94a3b8" font-size="11" font-family="system-ui,sans-serif">${fmtAxis(t)}</text>`;
  }).join('');

  // Labels axe X (années)
  const maxXLabels = Math.min(9, data.length);
  const xStep = data.length <= maxXLabels ? 1 : Math.ceil((data.length - 1) / (maxXLabels - 1));
  const xSet  = new Set([0, data.length - 1]);
  for (let i = xStep; i < data.length - 1; i += xStep) xSet.add(i);
  const xLabels = [...xSet].sort((a, b) => a - b).map(i =>
    `<text x="${toX(i).toFixed(1)}" y="${(padT + ch + 24).toFixed(1)}"
      text-anchor="middle" fill="#64748b" font-size="10"
      font-family="system-ui,sans-serif">An ${data[i].year}</text>`
  ).join('');

  // Marqueur vertical "Année FIRE"
  let fireMarker = '';
  if (fireYear) {
    const fi = data.findIndex(d => d.year === fireYear);
    if (fi >= 0) {
      const fx = toX(fi).toFixed(1);
      fireMarker = `
        <line x1="${fx}" y1="${padT}" x2="${fx}" y2="${(padT + ch).toFixed(1)}"
          stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="5,4" opacity="0.85"/>
        <rect x="${(+fx + 4).toFixed(1)}" y="${(padT + 2).toFixed(1)}" width="52" height="16" rx="3"
          fill="#f59e0b" opacity="0.18"/>
        <text x="${(+fx + 30).toFixed(1)}" y="${(padT + 13).toFixed(1)}" text-anchor="middle"
          fill="#fbbf24" font-size="10" font-weight="bold"
          font-family="system-ui,sans-serif">🔥 FIRE</text>`;
    }
  }

  // Courbe portfolio (bleue) + aire de remplissage
  const portPts = data.map((d, i) => `${toX(i).toFixed(1)},${toY(d.portfolio).toFixed(1)}`).join(' ');
  const baseY   = toY(0).toFixed(1);
  const fillPts = `${toX(0).toFixed(1)},${baseY} ${portPts} ${toX(data.length - 1).toFixed(1)},${baseY}`;

  // Courbe capital investi (gris pointillé)
  const invPts = data.map((d, i) => `${toX(i).toFixed(1)},${toY(d.invested).toFixed(1)}`).join(' ');

  return `
    <svg viewBox="0 0 ${width} ${height}" class="w-full" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="fg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="#3b82f6" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="#3b82f6" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      ${gridLines}
      ${fireMarker}
      <polygon points="${fillPts}" fill="url(#fg)"/>
      <polyline points="${portPts}" fill="none" stroke="#3b82f6" stroke-width="2.5"
        stroke-linejoin="round" stroke-linecap="round"/>
      <polyline points="${invPts}" fill="none" stroke="#475569" stroke-width="1.5"
        stroke-dasharray="6,4" stroke-linejoin="round" stroke-linecap="round"/>
      ${xLabels}
    </svg>
    <div class="flex flex-wrap gap-4 mt-2.5 text-xs text-slate-500">
      <span class="flex items-center gap-1.5">
        <span class="inline-block w-4 h-0.5 bg-blue-500 rounded-full"></span>
        Valeur portfolio
      </span>
      <span class="flex items-center gap-1.5">
        <svg width="16" height="4" class="inline-block"><line x1="0" y1="2" x2="16" y2="2" stroke="#475569" stroke-width="1.5" stroke-dasharray="4,3"/></svg>
        Capital investi
      </span>
      ${fireYear ? `<span class="flex items-center gap-1.5">
        <svg width="16" height="4" class="inline-block"><line x1="0" y1="2" x2="16" y2="2" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="4,3"/></svg>
        Année FIRE
      </span>` : ''}
    </div>`;
}

function fireTable(data, fireYear) {
  const target = _fp.depenses; // dépenses mensuelles cibles

  const rows = data.map(d => {
    const rowCls = d.isFireYear
      ? 'bg-amber-500/10 border-t border-amber-500/30'
      : d.inFire
        ? 'bg-slate-800/20 border-t border-slate-700'
        : 'border-t border-slate-700';

    // Couleur de la capacité mensuelle : vert si cible atteinte, ambre si proche, gris sinon
    const retOk    = d.retMensuel >= target;
    const retClose = !retOk && target > 0 && d.retMensuel >= target * 0.8;
    const retCls   = retOk    ? 'text-emerald-400 font-semibold'
                   : retClose ? 'text-amber-400'
                   : 'text-slate-400';

    return `
      <tr class="${rowCls} hover:bg-slate-750 transition-colors">
        <td class="py-2.5 px-4 text-sm ${d.isFireYear ? 'text-amber-400 font-bold' : 'text-slate-300'}">
          An ${d.year}${d.isFireYear ? ' 🔥' : ''}
        </td>
        <td class="py-2.5 px-4 text-right text-sm text-slate-400">${fmt(d.yearStart)}</td>
        <td class="py-2.5 px-4 text-right text-sm text-emerald-400">+${fmt(d.gain)}</td>
        <td class="py-2.5 px-4 text-right text-sm ${d.contribution > 0 ? 'text-blue-400' : 'text-slate-700'}">
          ${d.contribution > 0 ? '+' + fmt(d.contribution) : '—'}
        </td>
        <td class="py-2.5 px-4 text-right text-sm ${d.withdrawal > 0 ? 'text-red-400' : 'text-slate-700'}">
          ${d.withdrawal > 0 ? '−' + fmt(d.withdrawal) : '—'}
        </td>
        <td class="py-2.5 px-4 text-right text-sm ${retCls}">
          ${fmt(d.retMensuel)}/m
        </td>
        <td class="py-2.5 px-4 text-right text-sm font-semibold ${d.ruined ? 'text-red-400' : 'text-white'}">
          ${d.ruined ? '⚠ 0 €' : fmt(d.portfolio)}
        </td>
      </tr>`;
  }).join('');

  return `
    <div class="bg-slate-800">
      <table class="w-full text-sm">
        <thead class="sticky top-0 bg-slate-900/95 backdrop-blur-sm z-10">
          <tr class="text-slate-400 text-left">
            <th class="py-3 px-4 font-medium">Année</th>
            <th class="py-3 px-4 text-right font-medium">Début</th>
            <th class="py-3 px-4 text-right font-medium">Rendement</th>
            <th class="py-3 px-4 text-right font-medium">Versements</th>
            <th class="py-3 px-4 text-right font-medium">Retraits FIRE</th>
            <th class="py-3 px-4 text-right font-medium">Retrait/mois</th>
            <th class="py-3 px-4 text-right font-medium">Fin</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}
