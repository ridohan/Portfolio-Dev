// État global
let STATE = { portfolios: [], sub_portfolios: [], envelopes: [], positions: [], prices: [], crypto_prices: [], charges: [], history: [] };

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
      ${statCards(total, invested, totalCharges)}
      ${allocBar(alloc, 'Allocation globale', 'md', null, total)}
      ${historySparkline(globalHistory(), '#hist-global')}
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
      ${statCards(total, invested, totalCharges)}
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
      ${statCards(total, invested)}
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
        <span class="text-white font-bold text-sm">Portfolio Manager</span>
      </div>
      <div class="flex items-center gap-4">
        <span class="text-slate-500 text-xs">Cache : ${ageLabel}</span>
        <button onclick="forceRefresh()" class="text-slate-400 hover:text-white text-xs transition">↻ Actualiser</button>
        <button onclick="localStorage.clear();location.reload()" class="text-slate-500 hover:text-white text-xs transition">Déconnexion</button>
      </div>
    </nav>`;
}

function statCards(total, invested, totalCharges = 0) {
  const pv    = total - invested;
  const pvPct = invested > 0 ? ((pv / invested) * 100).toFixed(2) : 0;
  const nette = total - totalCharges;
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
        <p class="text-2xl font-bold ${pv >= 0 ? 'text-emerald-400' : 'text-red-400'}">${pv >= 0 ? '+' : ''}${fmt(pv)}</p>
        <p class="text-xs ${pv >= 0 ? 'text-emerald-500' : 'text-red-500'}">${pvPct}%</p>
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

function svgLineChart(entries, { width = 600, height = 200, mini = false } = {}) {
  if (entries.length < 2) return '';

  const values = entries.map(e => Number(e.valeur_actuelle));
  const minV   = Math.min(...values);
  const maxV   = Math.max(...values);
  const range  = maxV - minV || 1;

  const pad = mini ? 2 : 16;
  const w   = width  - pad * 2;
  const h   = height - pad * 2;

  const pts = values.map((v, i) => {
    const x = pad + (i / Math.max(values.length - 1, 1)) * w;
    const y = pad + (1 - (v - minV) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const isUp    = values[values.length - 1] >= values[0];
  const color   = isUp ? '#10b981' : '#ef4444';
  const polyPts = pts.join(' ');

  if (mini) {
    return `
      <svg viewBox="0 0 ${width} ${height}" class="w-full h-full" preserveAspectRatio="none">
        <polyline points="${polyPts}" fill="none" stroke="${color}" stroke-width="1.5"
          stroke-linejoin="round" stroke-linecap="round"/>
      </svg>`;
  }

  // Zone de remplissage sous la courbe
  const firstX = pts[0].split(',')[0];
  const lastX  = pts[pts.length - 1].split(',')[0];
  const baseY  = (pad + h).toFixed(1);
  const fillPts = `${firstX},${baseY} ${polyPts} ${lastX},${baseY}`;

  return `
    <svg viewBox="0 0 ${width} ${height}" class="w-full h-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="chart-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="${color}" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      <polygon points="${fillPts}" fill="url(#chart-grad)"/>
      <polyline points="${polyPts}" fill="none" stroke="${color}" stroke-width="2"
        stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
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
      <div style="height:200px" class="relative">
        ${svgLineChart(filtered, { width: 900, height: 200 })}
      </div>
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
