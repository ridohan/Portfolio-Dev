// État global
let STATE = { portfolios: [], sub_portfolios: [], envelopes: [], positions: [], prices: [], crypto_prices: [] };

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
  const { total, invested, alloc } = globalStats();

  app.innerHTML = `
    ${navbar()}
    <div class="max-w-5xl mx-auto px-4 py-8 space-y-6">
      ${statCards(total, invested)}
      ${allocBar(alloc, 'Allocation globale', 'md', null, total)}
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-white">Portfolios</h2>
        <button onclick="openModal('portfolio')" class="btn-primary text-sm">+ Nouveau</button>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        ${STATE.portfolios.map(p => portfolioCard(p)).join('') || empty('Aucun portfolio — crée-en un.')}
      </div>
    </div>
    ${modalPortfolio()}`;
}

function portfolioCard(p) {
  const envs    = STATE.envelopes.filter(e => e.portfolio_id === p.id);
  const { total, invested, alloc } = portfolioStats(p.id);
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
      <p class="text-white text-xl font-bold mb-3">${fmt(total)}</p>
      ${allocBar(alloc, null, 'sm')}
    </div>`;
}

// ─── PORTFOLIO DETAIL ─────────────────────────────────────────────────────────

function renderPortfolio(app, portfolioId) {
  const p = STATE.portfolios.find(x => x.id === portfolioId);
  if (!p) { navigate('#dashboard'); return; }

  const { total, invested, alloc } = portfolioStats(portfolioId);
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
          <button onclick="openModal('envelope','${portfolioId}')" class="btn-primary text-sm">+ Enveloppe</button>
          <button onclick="confirmDelete('portfolio','${p.id}')" class="btn-danger text-sm">Supprimer</button>
        </div>
      </div>
      ${statCards(total, invested)}
      ${allocBar(alloc, 'Allocation réelle', 'lg', { actions: p.cible_actions, obligations: p.cible_obligations, cash: p.cible_cash }, total)}
      ${rebal.length ? rebalancingCard(rebal) : ''}
      <h2 class="text-lg font-semibold text-white">Enveloppes</h2>
      <div class="grid gap-4 sm:grid-cols-2">
        ${envs.map(e => envelopeCard(e)).join('') || empty('Aucune enveloppe.')}
      </div>
    </div>
    ${modalEnvelope()}`;
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
          <button onclick="openModal('position','${envelopeId}','${e.type}')" class="btn-primary text-sm">+ Position</button>
          <button onclick="confirmDelete('envelope','${e.id}')" class="btn-danger text-sm">Supprimer</button>
        </div>
      </div>
      ${statCards(total, invested)}
      <h2 class="text-lg font-semibold text-white">Positions</h2>
      ${positionsTable(positions, e.type)}
    </div>
    ${modalPosition(envelopeId, e.type)}
    ${modalEditPosition(e.type)}`;
}

function positionsTable(positions, type) {
  if (!positions.length) return empty('Aucune position — ajoutes-en une.');
  const isEpargne = type === 'épargne';

  // Tri : actions d'abord, puis bonds, puis reste
  const order = { action: 0, bond: 1 };
  const sorted = [...positions].sort((a, b) => {
    const tA = STATE.prices.find(p => p.isin === a.identifiant)?.type || 'z';
    const tB = STATE.prices.find(p => p.isin === b.identifiant)?.type || 'z';
    return (order[tA] ?? 2) - (order[tB] ?? 2);
  });

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
    const label      = pos.nom || etfNom || pos.identifiant;
    const sublabel   = pos.nom && etfNom ? etfNom : null;

    return `
      <tr class="border-t border-slate-700 hover:bg-slate-750">
        <td class="py-3 px-4">
          <p class="text-white font-medium">${esc(label)}</p>
          ${sublabel ? `<p class="text-slate-400 text-xs">${esc(sublabel)}</p>` : ''}
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
            <th class="py-3 px-4">${type === 'épargne' ? 'Compte' : 'Identifiant'}</th>
            ${type === 'bourse' ? '<th class="py-3 px-4">Type</th>' : ''}
            <th class="py-3 px-4">${type === 'épargne' ? 'Taux' : 'Quantité × Prix achat'}</th>
            <th class="py-3 px-4">Valeur actuelle</th>
            <th class="py-3 px-4">Plus-value</th>
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
          <div>
            <label class="label">Nom affiché (optionnel)</label>
            <input name="nom" placeholder="Ex: Mon ETF World" class="input" />
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

function modalEditPosition(type) {
  const isEpargne = type === 'épargne';
  return `
    <div id="modal-edit-position" class="modal-backdrop hidden">
      <div class="modal-box">
        <h2 class="text-white font-semibold mb-4">Modifier la position</h2>
        <form id="form-edit-position" class="space-y-3">
          <div>
            <label class="label">Nom affiché</label>
            <input name="nom" id="edit-nom" class="input" />
          </div>
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
  if (type === 'position') {
    document.getElementById('form-position').onsubmit = async e => {
      e.preventDefault();
      const btn = e.target.querySelector('[type=submit]');
      setLoading(btn, true);
      const d = Object.fromEntries(new FormData(e.target));
      const envelopeType = args[1];
      const payload = { envelope_id: args[0], identifiant: d.identifiant, nom: d.nom || '', prix_achat: d.prix_achat, quantite: d.quantite };
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

function openEditPosition(pos) {
  document.getElementById('modal-edit-position')?.classList.remove('hidden');
  document.getElementById('edit-nom').value        = pos.nom || '';
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
  const actions = { portfolio: () => API.deletePortfolio(id), envelope: () => API.deleteEnvelope(id), position: () => API.deletePosition(id) };
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

  return { total, invested, alloc };
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
  return { total, invested, alloc };
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

function statCards(total, invested) {
  const pv    = total - invested;
  const pvPct = invested > 0 ? ((pv / invested) * 100).toFixed(2) : 0;
  return `
    <div class="grid grid-cols-3 gap-4">
      <div class="bg-slate-800 rounded-xl p-4"><p class="text-slate-400 text-xs mb-1">Valeur totale</p><p class="text-white text-2xl font-bold">${fmt(total)}</p></div>
      <div class="bg-slate-800 rounded-xl p-4"><p class="text-slate-400 text-xs mb-1">Investi</p><p class="text-white text-2xl font-bold">${fmt(invested)}</p></div>
      <div class="bg-slate-800 rounded-xl p-4"><p class="text-slate-400 text-xs mb-1">Plus-value</p>
        <p class="text-2xl font-bold ${pv >= 0 ? 'text-emerald-400' : 'text-red-400'}">${pv >= 0 ? '+' : ''}${fmt(pv)}</p>
        <p class="text-xs ${pv >= 0 ? 'text-emerald-500' : 'text-red-500'}">${pvPct}%</p>
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

function errorBanner(msg) {
  return `<div class="m-8 bg-red-900/30 border border-red-500 text-red-300 rounded-xl p-4 text-sm">Erreur : ${esc(msg)}</div>`;
}

function fmt(n) {
  return Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
