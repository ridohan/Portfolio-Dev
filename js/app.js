// État global
let STATE = { portfolios: [], sub_portfolios: [], envelopes: [], positions: [], prices: [], crypto_prices: [], charges: [], history: [], fire_profile: [], vpw: null, expense_categories: [], expense_items: [], expense_entries: [], expense_aids: [], biens_immo: [], depenses_immo: [], residences: [], ui_prefs: [] };

// État du tri des positions (persisté pendant la session)
let _posSort = { col: 'type', dir: 'asc' };

// Période active pour les pages historique
let _histPeriod = 'all';

// Année active pour la page Dépenses
let _expYear = new Date().getFullYear();

// ─── ROUTER ──────────────────────────────────────────────────────────────────

function navigate(hash) { location.hash = hash; }

window.addEventListener('hashchange', render);
window.addEventListener('load', render);

// ─── PRÉFÉRENCES UI CROSS-DEVICE ─────────────────────────────────────────────
// Les prefs sont stockées dans Google Sheets (ui_prefs) ET en localStorage.
// Au chargement, les données serveur ont priorité et synchronisent localStorage.

function getUiPref(key, defaultVal = null) {
  // Priorité 1 : localStorage — toujours à jour, même après render() qui recharge STATE
  // depuis le cache (ce qui écraserait les prefs mises à jour par persistUiPref cette session).
  // Le sync cross-device est garanti : render() copie STATE.ui_prefs → localStorage au chargement.
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) return JSON.parse(raw);
  } catch {}
  // Priorité 2 : STATE.ui_prefs (chargé depuis Google Sheets — utile au tout premier rendu
  // avant que localStorage ne soit synchronisé depuis le serveur)
  if (Array.isArray(STATE.ui_prefs) && STATE.ui_prefs.length) {
    const pref = STATE.ui_prefs.find(p => p.key === key);
    if (pref?.value !== undefined && pref.value !== '') {
      try { return JSON.parse(pref.value); } catch { return pref.value; }
    }
  }
  return defaultVal;
}

function persistUiPref(key, value) {
  const serialized = JSON.stringify(value);
  // 1. localStorage immédiat (réactivité)
  try { localStorage.setItem(key, serialized); } catch {}
  // 2. Mise à jour de STATE pour cohérence session courante
  if (!Array.isArray(STATE.ui_prefs)) STATE.ui_prefs = [];
  const idx = STATE.ui_prefs.findIndex(p => p.key === key);
  if (idx !== -1) STATE.ui_prefs[idx].value = serialized;
  else STATE.ui_prefs.push({ key, value: serialized });
  // 3. Sync serveur asynchrone (fire-and-forget, postSilent → pas d'invalidation cache)
  API.saveUiPref(key, serialized).catch(e => console.warn('persistUiPref:', e));
}

async function render() {
  const app = document.getElementById('app');
  if (!API.isConfigured()) return renderSetup(app);

  const cached = API._getCache();
  if (cached) {
    // Affichage immédiat depuis le cache, pas de spinner.
    // On ne touche PAS localStorage ici : les prefs modifiées cette session
    // (ex : ordre des blocs) sont déjà dans localStorage via persistUiPref
    // et ne doivent pas être écrasées par un STATE potentiellement plus ancien.
    STATE = cached;
  } else {
    app.innerHTML = `<div class="flex items-center justify-center h-64 text-slate-400">Chargement…</div>`;
    try {
      STATE = await API.getData();
    } catch (e) {
      app.innerHTML = errorBanner(e.message); return;
    }
    // Sync localStorage depuis les prefs serveur UNIQUEMENT lors d'un chargement
    // serveur (pas cache) → garantit la synchronisation cross-device au premier chargement
    if (Array.isArray(STATE.ui_prefs)) {
      STATE.ui_prefs.forEach(p => {
        if (p.key && p.value !== undefined && p.value !== '') {
          try { localStorage.setItem(p.key, p.value); } catch {}
        }
      });
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
  if (route === 'expenses')    return renderExpenses(app);
  if (route === 'immo' && !id) return renderImmo(app);
  if (route === 'immo' &&  id) return renderImmoDetail(app, id);
  if (route === 'residences' && !id) return renderResidences(app);
  if (route === 'residences' &&  id) return renderResidenceDetail(app, id);
  renderDashboard(app);
}

// ─── PARAMÈTRES CACHE ────────────────────────────────────────────────────────

function openCacheSettings() {
  if (!document.getElementById('modal-cache-settings')) {
    const div = document.createElement('div');
    div.id        = 'modal-cache-settings';
    div.className = 'fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4';
    div.innerHTML = `
      <div class="modal-box w-full max-w-sm space-y-5" onclick="event.stopPropagation()">
        <h3 class="text-base font-bold text-white">⚙ Paramètres & Sauvegarde</h3>

        <!-- Cache TTL -->
        <div class="bg-slate-700/40 rounded-lg p-4 space-y-2">
          <p class="text-slate-300 text-sm font-medium">Durée du cache</p>
          <div class="flex gap-2 items-center">
            <input id="cache-ttl-input" type="number" min="1" max="120" step="1"
              onkeydown="if(event.key==='Enter')saveCacheSettings()"
              class="w-24 bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <span class="text-slate-400 text-sm">minutes</span>
            <button onclick="saveCacheSettings()" class="btn-primary text-xs px-3 py-1.5 ml-auto">Sauvegarder</button>
          </div>
          <p class="text-slate-500 text-xs">Les données sont rechargées depuis le serveur après cette durée.</p>
        </div>

        <!-- Export JSON -->
        <div class="bg-slate-700/40 rounded-lg p-4 space-y-2">
          <p class="text-slate-300 text-sm font-medium">💾 Sauvegarde JSON</p>
          <p class="text-slate-500 text-xs">Exporte toutes vos données (biens, dépenses, portefeuille…) dans un fichier JSON horodaté.</p>
          <button onclick="exportDataJSON()" class="btn-secondary text-sm w-full">⬇ Télécharger la sauvegarde</button>
        </div>

        <!-- Import JSON -->
        <div class="bg-slate-700/40 rounded-lg p-4 space-y-2">
          <p class="text-slate-300 text-sm font-medium">📂 Restaurer depuis JSON</p>
          <p class="text-slate-500 text-xs text-amber-400/80">⚠ Remplace les données affichées (session en cours). Ne modifie pas Google Sheets.</p>
          <input id="import-json-input" type="file" accept=".json" onchange="importDataJSON(this)" class="hidden">
          <button onclick="document.getElementById('import-json-input').click()" class="btn-secondary text-sm w-full">⬆ Charger un fichier JSON</button>
          <p id="import-json-status" class="text-xs hidden"></p>
        </div>

        <!-- Rapports PDF -->
        <div class="bg-slate-700/40 rounded-lg p-4 space-y-2">
          <p class="text-slate-300 text-sm font-medium">📄 Rapports PDF</p>
          <p class="text-slate-500 text-xs">Génère un rapport mis en page dans un nouvel onglet — utilisez "Enregistrer en PDF" dans la boîte d'impression.</p>
          <div class="space-y-1.5">
            <button onclick="generatePdfPortfolio()" class="btn-secondary text-sm w-full text-left">📊 Rapport Portfolio complet</button>
            <button onclick="generatePdfHistory()" class="btn-secondary text-sm w-full text-left">📈 Historique des valeurs</button>
            <button onclick="generatePdfImmo()" class="btn-secondary text-sm w-full text-left">🏠 Rapport Immobilier locatif</button>
            <button onclick="generatePdfExpenses()" class="btn-secondary text-sm w-full text-left">💸 Rapport Dépenses mensuelles</button>
          </div>
        </div>

        <button onclick="closeCacheSettings()" class="btn-secondary w-full text-sm">Fermer</button>
      </div>`;
    div.addEventListener('click', e => { if (e.target === div) closeCacheSettings(); });
    document.body.appendChild(div);
  }
  document.getElementById('cache-ttl-input').value = API.getCacheTTLMinutes();
  document.getElementById('modal-cache-settings').classList.remove('hidden');
}

function closeCacheSettings() {
  const el = document.getElementById('modal-cache-settings');
  if (el) el.classList.add('hidden');
}

function saveCacheSettings() {
  const val = parseInt(document.getElementById('cache-ttl-input').value, 10);
  if (val >= 1) API.setCacheTTL(val);
  render(); // rafraîchit la navbar pour afficher le nouveau TTL
}

function exportDataJSON() {
  const now      = new Date();
  const pad      = n => String(n).padStart(2, '0');
  const ts       = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}h${pad(now.getMinutes())}`;
  const filename = `portfolio-backup_${ts}.json`;
  const payload  = JSON.stringify(STATE, null, 2);
  const blob     = new Blob([payload], { type: 'application/json' });
  const url      = URL.createObjectURL(blob);
  const a        = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importDataJSON(input) {
  const file = input.files?.[0];
  if (!file) return;
  const status = document.getElementById('import-json-status');
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      // Validation minimale : vérifier que c'est bien un objet avec au moins une clé attendue
      const expected = ['portfolios', 'envelopes', 'biens_immo', 'expense_categories'];
      const valid    = expected.some(k => Array.isArray(data[k]));
      if (!valid) throw new Error('Format non reconnu — fichier invalide.');
      // Fusionner avec le STATE existant (les clés manquantes gardent les valeurs actuelles)
      STATE = { ...STATE, ...data };
      API._setCache({ ...STATE });
      if (status) {
        status.textContent = `✅ Fichier chargé — ${file.name}`;
        status.className   = 'text-xs text-emerald-400';
        status.classList.remove('hidden');
      }
      // Réinitialiser l'input pour permettre de recharger le même fichier
      input.value = '';
      // Re-render la page courante
      render();
    } catch (err) {
      if (status) {
        status.textContent = `❌ Erreur : ${err.message}`;
        status.className   = 'text-xs text-red-400';
        status.classList.remove('hidden');
      }
      input.value = '';
    }
  };
  reader.readAsText(file);
}

// ─── RAPPORTS PDF ────────────────────────────────────────────────────────────

function _pdfOpen(htmlContent) {
  const win = window.open('', '_blank', 'width=960,height=750');
  if (!win) { alert('Autorisez les popups pour générer le PDF.'); return; }
  win.document.write(htmlContent);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 700);
}

function _pdfStyle() {
  return `<style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:10.5pt;color:#1a202c;line-height:1.45;padding:18mm 16mm}
    h1{font-size:18pt;color:#1a365d;margin-bottom:3pt}
    h2{font-size:12pt;color:#1a365d;border-bottom:2px solid #1a365d;margin:14pt 0 7pt;padding-bottom:3pt;text-transform:uppercase;letter-spacing:.04em}
    h3{font-size:10.5pt;color:#2b4c7e;margin:9pt 0 4pt;font-weight:600}
    table{width:100%;border-collapse:collapse;margin-bottom:9pt;font-size:9.5pt}
    th{background:#edf2f7;color:#2d3748;padding:5pt 7pt;text-align:left;font-weight:600;border-bottom:1.5px solid #a0aec0}
    td{padding:4.5pt 7pt;border-bottom:1px solid #e2e8f0}
    .r{text-align:right}.c{text-align:center}.muted{color:#718096;font-size:9pt}
    .green{color:#276749;font-weight:600}.red{color:#c53030;font-weight:600}.amber{color:#975a16;font-weight:600}
    .grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:8pt;margin-bottom:12pt}
    .grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:8pt;margin-bottom:12pt}
    .grid2{display:grid;grid-template-columns:repeat(2,1fr);gap:8pt;margin-bottom:12pt}
    .card{background:#f7fafc;border:1px solid #e2e8f0;border-radius:4pt;padding:8pt 10pt}
    .card .lbl{font-size:8.5pt;color:#718096;margin-bottom:2pt}
    .card .val{font-size:13pt;font-weight:700}
    .card .sub{font-size:8.5pt;color:#718096;margin-top:1pt}
    .section{margin-bottom:16pt}
    .pb{page-break-after:always;margin-top:12pt}
    .hdr{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:14pt;border-bottom:3px solid #1a365d;padding-bottom:8pt}
    .hdr-right{text-align:right;color:#718096;font-size:9pt}
    .bar-bg{background:#e2e8f0;border-radius:2pt;height:6pt;margin-top:3pt}
    .bar-fg{background:#38a169;height:6pt;border-radius:2pt}
    .tag{display:inline-block;padding:1pt 5pt;border-radius:3pt;font-size:8.5pt;background:#edf2f7;color:#2d3748}
    .tag-green{background:#c6f6d5;color:#276749}
    .tag-red{background:#fed7d7;color:#c53030}
    .tag-amber{background:#feebc8;color:#975a16}
    .footer{margin-top:18pt;padding-top:8pt;border-top:1px solid #e2e8f0;color:#a0aec0;font-size:8pt;display:flex;justify-content:space-between}
    .no-print{margin-bottom:10pt}
    @media print{.no-print{display:none}}
  </style>`;
}

function _pdfHeader(title, subtitle, date) {
  return `<div class="hdr">
    <div><h1>${title}</h1>${subtitle ? `<p class="muted">${subtitle}</p>` : ''}</div>
    <div class="hdr-right">Portfolio Manager<br>${date}</div>
  </div>`;
}

function _pdfFooter(date) {
  return `<div class="footer"><span>Généré par Portfolio Manager</span><span>${date}</span></div>`;
}

function _n(v) { return new Intl.NumberFormat('fr-FR',{minimumFractionDigits:0,maximumFractionDigits:0}).format(Math.round(v||0))+' €'; }
function _pct(v,sign=true) { const p=Number(v||0); return (sign&&p>=0?'+':'')+p.toFixed(2)+'%'; }
function _sgn(v) { return v>=0?'green':'red'; }

// ── Rapport Portfolio ─────────────────────────────────────────────────────────

function generatePdfPortfolio() {
  const now     = new Date();
  const dateStr = now.toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'});
  const gs      = globalStats();

  // Positions par portefeuille → enveloppe
  let sections = '';
  STATE.portfolios.forEach(pf => {
    const ps   = portfolioStats(pf.id);
    const envs = STATE.envelopes.filter(e => e.portfolio_id === pf.id);
    let envRows = '';
    envs.forEach(env => {
      const es   = envelopeStats(env.id);
      const pls  = es.invested > 0 ? (es.total - es.invested) / es.invested * 100 : 0;
      const positions = STATE.positions.filter(p => p.envelope_id === env.id);
      if (!positions.length) return;
      envRows += `<h3>${env.nom} <span class="muted">(${env.type})</span> — ${_n(es.total)}
        <span class="tag ${_sgn(es.total-es.invested) === 'green' ? 'tag-green':'tag-red'}">${_pct(pls)}</span></h3>
        <table>
          <thead><tr>
            <th>Identifiant / Nom</th>
            <th class="r">Quantité</th>
            <th class="r">Prix achat unit.</th>
            <th class="r">Prix actuel</th>
            <th class="r">Valeur</th>
            <th class="r">+/−</th>
          </tr></thead>
          <tbody>`;
      positions.forEach(pos => {
        const qty  = Number(pos.quantite)||0;
        const pa   = Number(pos.prix_achat)||0;
        const prix = currentPrice(pos.identifiant, env.type);
        const val  = prix*qty;
        const pls2 = pa>0 ? (prix-pa)/pa*100 : 0;
        const isEp = env.type==='épargne';
        envRows += `<tr>
          <td><strong>${pos.identifiant}</strong>${pos.nom?` <span class="muted">— ${pos.nom}</span>`:''}</td>
          <td class="r">${isEp?'—':qty}</td>
          <td class="r muted">${isEp?'—':_n(pa)}</td>
          <td class="r">${isEp?'—':_n(prix)}</td>
          <td class="r"><strong>${_n(isEp?pa:val)}</strong></td>
          <td class="r ${_sgn(pls2)}">${isEp?'—':_pct(pls2)}</td>
        </tr>`;
      });
      envRows += `</tbody></table>`;
    });
    if (!envRows) return;
    const pfPls = ps.invested>0?(ps.total-ps.invested)/ps.invested*100:0;
    sections += `<div class="section">
      <h2>${pf.nom} <span style="font-size:10pt;font-weight:400">— ${_n(ps.total)}
        <span class="${_sgn(pfPls)}">(${_pct(pfPls)})</span></span></h2>
      ${envRows}
    </div>`;
  });

  // Immobilier (résumé)
  let immoSection = '';
  if (STATE.biens_immo.length) {
    const ig = immoGlobalStats(now.getFullYear());
    immoSection = `<div class="section pb">
      <h2>Immobilier locatif</h2>
      <div class="grid4">
        <div class="card"><div class="lbl">Valeur brute</div><div class="val">${_n(ig.brut)}</div></div>
        <div class="card"><div class="lbl">Capital remboursé</div><div class="val green">${_n(ig.equity)}</div></div>
        <div class="card"><div class="lbl">Restant dû</div><div class="val amber">${_n(ig.crd)}</div></div>
        <div class="card"><div class="lbl">CF projeté</div><div class="val ${_sgn(ig.cfProjete/12)}">${_n(ig.cfProjete/12)}/mois</div></div>
      </div>
      <table>
        <thead><tr><th>Bien</th><th>Surface</th><th>Prix achat</th><th class="r">Rdt brut</th><th class="r">Rdt net</th><th class="r">CF/mois</th></tr></thead>
        <tbody>
        ${STATE.biens_immo.map(b => {
          const r = immoRentabilite(b);
          return `<tr>
            <td><strong>${b.nom}</strong></td>
            <td>${b.surface_m2?b.surface_m2+' m²':'—'}</td>
            <td>${_n(b.prix_achat)}</td>
            <td class="r">${_pct(r.rendBrut,false)}</td>
            <td class="r ${_sgn(r.rendNetCredit)}">${_pct(r.rendNetCredit)}</td>
            <td class="r ${_sgn(r.cfMensCredit)}">${_n(r.cfMensCredit)}/mois</td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>
    </div>`;
  }

  // Charges à venir (frais ponctuels déductibles par portfolio)
  let chargesSection = '';
  if (STATE.charges.length) {
    const total = STATE.charges.reduce((s,c)=>s+Number(c.montant||0),0);
    chargesSection = `<div class="section">
      <h2>Charges à venir</h2>
      <table>
        <thead><tr><th>Charge</th><th class="r">Montant</th><th>Date de fin</th></tr></thead>
        <tbody>
          ${STATE.charges.map(c=>`<tr>
            <td>${c.nom||c.label||'—'}</td>
            <td class="r">${_n(c.montant)}</td>
            <td class="muted">${c.date_fin ? new Date(c.date_fin+'T00:00:00').toLocaleDateString('fr-FR') : '—'}</td>
          </tr>`).join('')}
          <tr style="font-weight:700;border-top:2px solid #a0aec0"><td>Total</td><td class="r">${_n(total)}</td><td></td></tr>
        </tbody>
      </table>
    </div>`;
  }

  const plGlobal  = gs.invested>0?(gs.total-gs.invested)/gs.invested*100:0;
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Rapport Portfolio — ${dateStr}</title>
  ${_pdfStyle()}
  </head><body>
    <div class="no-print"><button onclick="window.print()" style="padding:6pt 14pt;background:#1a365d;color:#fff;border:none;border-radius:4pt;cursor:pointer;font-size:10pt">🖨 Imprimer / Enregistrer PDF</button></div>
    ${_pdfHeader('Rapport Portfolio', `Synthèse au ${dateStr}`, dateStr)}

    <div class="section">
      <h2>Synthèse globale</h2>
      <div class="grid4">
        <div class="card"><div class="lbl">Valeur totale</div><div class="val">${_n(gs.total)}</div><div class="sub">Hors immobilier</div></div>
        <div class="card"><div class="lbl">Capital investi</div><div class="val">${_n(gs.invested)}</div></div>
        <div class="card"><div class="lbl">Plus-value</div><div class="val ${_sgn(gs.total-gs.invested)}">${_n(gs.total-gs.invested)}</div><div class="sub ${_sgn(plGlobal)}">${_pct(plGlobal)}</div></div>
        <div class="card"><div class="lbl">Répartition</div>
          <div style="font-size:9pt;margin-top:3pt">
            Actions: <strong>${gs.alloc.actions}%</strong><br>
            Oblig.: <strong>${gs.alloc.obligations}%</strong><br>
            Cash: <strong>${gs.alloc.cash}%</strong>
          </div>
        </div>
      </div>
    </div>

    ${sections}
    ${immoSection}
    ${chargesSection}
    ${_pdfFooter(dateStr)}
  </body></html>`;
  _pdfOpen(html);
}

// ── Rapport Immobilier ────────────────────────────────────────────────────────

function generatePdfImmo() {
  const now     = new Date();
  const year    = now.getFullYear();
  const dateStr = now.toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'});
  const ig      = immoGlobalStats(year);

  let biensHtml = '';
  STATE.biens_immo.forEach(b => {
    const r   = immoRentabilite(b);
    const rr  = immoRentabiliteReelle(b.id, year);
    const crd = immoCapitalRestantDu(b, now);
    const remb= Math.max(0, Number(b.montant_credit||0) - crd);
    const pct = Number(b.montant_credit||0)>0 ? Math.round(remb/Number(b.montant_credit)*100) : null;
    const hasCr = Number(b.montant_credit||0)>0;

    biensHtml += `
    <div class="section">
      <h2>${b.nom}</h2>
      <div class="grid4" style="margin-bottom:8pt">
        <div class="card"><div class="lbl">Prix d'achat</div><div class="val">${_n(b.prix_achat)}</div></div>
        <div class="card"><div class="lbl">Surface</div><div class="val">${b.surface_m2||'—'} m²</div></div>
        <div class="card"><div class="lbl">Loyer annuel HT</div><div class="val green">${_n(b.loyer_annuel_ht)}</div><div class="sub">${_n(Number(b.loyer_annuel_ht||0)/12)}/mois</div></div>
        <div class="card"><div class="lbl">Taxe foncière</div><div class="val">${_n(b.taxe_fonciere)}/an</div></div>
      </div>

      <div class="grid2">
        <div>
          <h3>Rentabilité théorique</h3>
          <table>
            <thead><tr><th>Indicateur</th>${hasCr?'<th class="r">Pendant crédit</th>':''}<th class="r">Post crédit</th></tr></thead>
            <tbody>
              <tr><td>Rendement brut</td>${hasCr?`<td class="r">${_pct(r.rendBrut,false)}</td>`:''}<td class="r">${_pct(r.rendBrut,false)}</td></tr>
              <tr><td>Rendement net</td>${hasCr?`<td class="r ${_sgn(r.rendNetCredit)}">${_pct(r.rendNetCredit)}</td>`:''}<td class="r ${_sgn(r.rendNetPost)}">${_pct(r.rendNetPost)}</td></tr>
              <tr><td>Cashflow annuel</td>${hasCr?`<td class="r ${_sgn(r.cfAnnCredit)}">${_n(r.cfAnnCredit)}</td>`:''}<td class="r ${_sgn(r.cfAnnPost)}">${_n(r.cfAnnPost)}</td></tr>
              <tr><td>Cashflow mensuel</td>${hasCr?`<td class="r ${_sgn(r.cfMensCredit)}"><strong>${_n(r.cfMensCredit)}/mois</strong></td>`:''}<td class="r ${_sgn(r.cfMensPost)}"><strong>${_n(r.cfMensPost)}/mois</strong></td></tr>
            </tbody>
          </table>
        </div>
        <div>
          <h3>Réel ${year}</h3>
          ${rr&&(rr.moisLoyers>0||rr.moisCharges>0) ? `<table>
            <tbody>
              <tr><td>Loyers HT perçus</td><td class="r green">${_n(rr.loyersHt)}</td></tr>
              <tr><td>Dépenses + TF</td><td class="r red">−${_n(rr.depenses+rr.taxe)}</td></tr>
              <tr><td>Cashflow réel YTD</td><td class="r ${_sgn(rr.cfReel)}"><strong>${_n(rr.cfReel)}</strong></td></tr>
              <tr><td>Cashflow projeté</td><td class="r ${_sgn(rr.cfProjete)}"><strong>${_n(rr.cfProjete/12)}/mois</strong></td></tr>
              <tr><td class="muted">Mois de données</td><td class="r muted">${rr.moisLoyers} loyers · ${rr.moisCharges} charges</td></tr>
            </tbody>
          </table>` : `<p class="muted" style="padding:8pt 0">Aucune donnée saisie pour ${year}</p>`}
        </div>
      </div>

      ${hasCr ? `<h3>Capital crédit</h3>
      <table>
        <tbody>
          <tr><td>Emprunté</td><td class="r">${_n(b.montant_credit)}</td><td>Durée</td><td class="r">${b.duree_credit_mois} mois</td></tr>
          <tr><td>Remboursé</td><td class="r green">${_n(remb)}</td><td>Mensualité</td><td class="r">${_n(immoMensualite(b))}/mois</td></tr>
          <tr><td>Restant dû</td><td class="r amber">${_n(crd)}</td><td>Taux annuel</td><td class="r">${(Number(b.taux_credit||0)*100).toFixed(2)}%</td></tr>
        </tbody>
      </table>
      <div class="bar-bg"><div class="bar-fg" style="width:${pct}%"></div></div>
      <p class="muted" style="text-align:right;font-size:8.5pt;margin-top:2pt">${pct}% remboursé</p>` : ''}
    </div>`;
  });

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Rapport Immobilier — ${dateStr}</title>
  ${_pdfStyle()}
  </head><body>
    <div class="no-print"><button onclick="window.print()" style="padding:6pt 14pt;background:#1a365d;color:#fff;border:none;border-radius:4pt;cursor:pointer;font-size:10pt">🖨 Imprimer / Enregistrer PDF</button></div>
    ${_pdfHeader('Rapport Immobilier Locatif', `Synthèse au ${dateStr}`, dateStr)}

    <div class="section">
      <h2>Patrimoine global · ${STATE.biens_immo.length} bien${STATE.biens_immo.length>1?'s':''}</h2>
      <div class="grid4">
        <div class="card"><div class="lbl">Valeur brute</div><div class="val">${_n(ig.brut)}</div></div>
        <div class="card"><div class="lbl">Capital remboursé</div><div class="val green">${_n(ig.equity)}</div></div>
        <div class="card"><div class="lbl">Restant dû</div><div class="val amber">${_n(ig.crd)}</div></div>
        <div class="card"><div class="lbl">Valeur nette</div><div class="val">${_n(ig.brut-ig.crd)}</div></div>
      </div>
      <div class="grid4">
        <div class="card"><div class="lbl">CF théorique</div><div class="val ${_sgn(ig.cfAnnCredit/12)}">${_n(ig.cfAnnCredit/12)}/mois</div></div>
        <div class="card"><div class="lbl">CF projeté ${year}</div><div class="val ${_sgn(ig.cfProjete/12)}">${_n(ig.cfProjete/12)}/mois</div><div class="sub">${_pct(ig.rendProjete)} rdt</div></div>
        <div class="card"><div class="lbl">Rdt brut moy.</div><div class="val">${_pct(ig.rendBrut,false)}</div></div>
        <div class="card"><div class="lbl">Rdt net (crédit)</div><div class="val ${_sgn(ig.rendNetCredit)}">${_pct(ig.rendNetCredit)}</div></div>
      </div>
    </div>

    ${biensHtml}
    ${_pdfFooter(dateStr)}
  </body></html>`;
  _pdfOpen(html);
}

// ── Rapport Dépenses ──────────────────────────────────────────────────────────

function generatePdfExpenses() {
  const year    = _expYear || new Date().getFullYear();
  const now     = new Date();
  const dateStr = now.toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'});
  const { entryMap, noteMap } = expLookup();
  const trackedMonths = expTrackedMonthsCount(year);
  const TYPES = ['vital','confort','loisir','épargne','immo','autre'];
  const TYPE_LABELS = { vital:'Vital', confort:'Confort', loisir:'Loisirs', 'épargne':'Épargne', immo:'Immo', autre:'Autre' };
  const MOIS = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];

  // Trier catégories par ordre
  const sortedCats = [...STATE.expense_categories].sort((a,b) => {
    const oa = a.ordre!==undefined&&a.ordre!==''?Number(a.ordre):Infinity;
    const ob = b.ordre!==undefined&&b.ordre!==''?Number(b.ordre):Infinity;
    return oa-ob;
  });

  let typeSections = '';
  TYPES.forEach(type => {
    const cats = sortedCats.filter(c=>c.type===type);
    if (!cats.length) return;

    let catRows = '';
    let typeTotal = 0;
    cats.forEach(cat => {
      const items = STATE.expense_items.filter(i=>i.category_id===cat.id);
      if (!items.length) return;
      let catTotal = 0;
      items.forEach(item => {
        for(let m=1;m<=12;m++) {
          const v = Number(entryMap[`${item.id}_${year}_${m}`]||0);
          catTotal += v;
        }
      });
      typeTotal += catTotal;
      const avg = trackedMonths>0 ? catTotal/trackedMonths : 0;
      catRows += `<tr>
        <td style="padding-left:14pt">${cat.nom}</td>
        <td class="r muted">${_n(catTotal)}</td>
        <td class="r"><strong>${_n(avg)}/mois</strong></td>
      </tr>`;
      items.forEach(item => {
        let itemTotal = 0;
        for(let m=1;m<=12;m++) itemTotal += Number(entryMap[`${item.id}_${year}_${m}`]||0);
        if (!itemTotal) return;
        catRows += `<tr style="font-size:8.5pt">
          <td style="padding-left:24pt;color:#718096">${item.nom}</td>
          <td class="r muted">${_n(itemTotal)}</td>
          <td class="r muted">${_n(trackedMonths>0?itemTotal/trackedMonths:0)}/mois</td>
        </tr>`;
      });
    });
    if (!catRows) return;
    const typeAvg = trackedMonths>0?typeTotal/trackedMonths:0;
    typeSections += `
      <h3>${TYPE_LABELS[type]||type}</h3>
      <table>
        <thead><tr><th>Catégorie / Poste</th><th class="r">Total ${year}</th><th class="r">Moy./mois</th></tr></thead>
        <tbody>
          ${catRows}
          <tr style="font-weight:700;border-top:1.5px solid #a0aec0">
            <td>Sous-total ${TYPE_LABELS[type]||type}</td>
            <td class="r">${_n(typeTotal)}</td>
            <td class="r">${_n(typeAvg)}/mois</td>
          </tr>
        </tbody>
      </table>`;
  });

  // Aides et reste
  const aidsTotal = STATE.expense_aids.reduce((s,a)=>s+Number(a.montant||0),0);
  const grandTotal = TYPES.reduce((s,t) => {
    const ids = STATE.expense_categories.filter(c=>c.type===t).map(c=>c.id);
    const itemIds = STATE.expense_items.filter(i=>ids.includes(i.category_id)).map(i=>i.id);
    return s + STATE.expense_entries.filter(e=>Number(e.annee)===year&&itemIds.includes(e.item_id)).reduce((ss,e)=>ss+Number(e.montant||0),0);
  },0);
  const grandAvg = trackedMonths>0?grandTotal/trackedMonths:0;

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Rapport Dépenses ${year}</title>
  ${_pdfStyle()}
  </head><body>
    <div class="no-print"><button onclick="window.print()" style="padding:6pt 14pt;background:#1a365d;color:#fff;border:none;border-radius:4pt;cursor:pointer;font-size:10pt">🖨 Imprimer / Enregistrer PDF</button></div>
    ${_pdfHeader(`Rapport Dépenses ${year}`, `${trackedMonths} mois de données · Généré le ${dateStr}`, dateStr)}

    <div class="section">
      <h2>Synthèse</h2>
      <div class="grid3">
        <div class="card"><div class="lbl">Total dépenses ${year}</div><div class="val red">${_n(grandTotal)}</div></div>
        <div class="card"><div class="lbl">Moyenne mensuelle</div><div class="val">${_n(grandAvg)}/mois</div><div class="sub">${trackedMonths} mois de données</div></div>
        <div class="card"><div class="lbl">Aides mensuelles</div><div class="val green">${_n(aidsTotal)}/mois</div></div>
      </div>
    </div>

    <div class="section">
      <h2>Détail par type</h2>
      ${typeSections}
    </div>

    ${STATE.expense_aids.length ? `
    <div class="section">
      <h2>Aides & revenus mensuels</h2>
      <table>
        <thead><tr><th>Aide</th><th class="r">Montant</th></tr></thead>
        <tbody>
          ${STATE.expense_aids.map(a=>`<tr><td>${a.nom||a.label||'—'}</td><td class="r green">${_n(a.montant)}/mois</td></tr>`).join('')}
          <tr style="font-weight:700;border-top:1.5px solid #a0aec0">
            <td>Total aides</td><td class="r green">${_n(aidsTotal)}/mois</td>
          </tr>
        </tbody>
      </table>
    </div>` : ''}

    ${_pdfFooter(dateStr)}
  </body></html>`;
  _pdfOpen(html);
}

// ── Rapport Historique Portfolio ──────────────────────────────────────────────

function generatePdfHistory() {
  const now     = new Date();
  const dateStr = now.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

  if (!STATE.history.length) {
    alert('Aucun historique disponible.'); return;
  }

  // Garde le dernier snapshot de chaque mois pour un rapport compact
  function toMonthly(entries) {
    const byMonth = {};
    entries.forEach(e => {
      const key = e.date.slice(0, 7); // YYYY-MM
      if (!byMonth[key] || e.date > byMonth[key].date) byMonth[key] = e;
    });
    return Object.values(byMonth).sort((a, b) => a.date.localeCompare(b.date));
  }

  // Variation vs entrée précédente
  function delta(entries) {
    return entries.map((e, i) => ({
      ...e,
      prev: i > 0 ? entries[i - 1].valeur_actuelle : null,
    }));
  }

  function histRows(entries, showDelta = true) {
    const monthly = delta(toMonthly(entries));
    return monthly.map(e => {
      const pv    = Number(e.pv_euros  || (e.valeur_actuelle - e.valeur_investie)) ;
      const pvPct = Number(e.pv_pct    || (e.valeur_investie > 0 ? (e.valeur_actuelle / e.valeur_investie - 1) * 100 : 0));
      const mDiff = e.prev !== null ? Number(e.valeur_actuelle) - Number(e.prev) : null;
      const mois  = new Date(e.date + 'T00:00:00').toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
      return `<tr>
        <td>${mois}</td>
        <td class="r">${_n(e.valeur_investie)}</td>
        <td class="r"><strong>${_n(e.valeur_actuelle)}</strong></td>
        <td class="r ${_sgn(pv)}">${_n(pv)}</td>
        <td class="r ${_sgn(pvPct)}">${_pct(pvPct)}</td>
        ${showDelta ? `<td class="r ${mDiff !== null ? _sgn(mDiff) : ''}">${mDiff !== null ? _n(mDiff) : '—'}</td>` : ''}
      </tr>`;
    }).join('');
  }

  const globalH  = globalHistory();
  const firstDate = globalH.length ? new Date(globalH[0].date + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
  const lastH     = globalH.length ? globalH[globalH.length - 1] : null;
  const firstH    = globalH.length ? globalH[0] : null;
  const totalGain = lastH ? Number(lastH.valeur_actuelle) - Number(firstH.valeur_actuelle) : 0;
  const totalGainPct = firstH && Number(firstH.valeur_actuelle) > 0
    ? (Number(lastH.valeur_actuelle) / Number(firstH.valeur_actuelle) - 1) * 100 : 0;

  // Section globale
  const globalSection = `
    <div class="section">
      <h2>Évolution globale</h2>
      <div class="grid3" style="margin-bottom:10pt">
        <div class="card">
          <div class="lbl">Valeur actuelle</div>
          <div class="val">${lastH ? _n(lastH.valeur_actuelle) : '—'}</div>
          <div class="sub">${lastH ? 'Au ' + new Date(lastH.date + 'T00:00:00').toLocaleDateString('fr-FR') : ''}</div>
        </div>
        <div class="card">
          <div class="lbl">Gain depuis le début</div>
          <div class="val ${_sgn(totalGain)}">${_n(totalGain)}</div>
          <div class="sub ${_sgn(totalGainPct)}">${_pct(totalGainPct)} depuis le ${firstDate}</div>
        </div>
        <div class="card">
          <div class="lbl">Points historiques</div>
          <div class="val">${toMonthly(globalH).length} mois</div>
          <div class="sub">${globalH.length} snapshots total</div>
        </div>
      </div>
      <table>
        <thead><tr>
          <th>Mois</th>
          <th class="r">Investi</th>
          <th class="r">Valeur</th>
          <th class="r">+/− €</th>
          <th class="r">+/− %</th>
          <th class="r">Variation mois</th>
        </tr></thead>
        <tbody>${histRows(globalH)}</tbody>
      </table>
    </div>`;

  // Section par portfolio
  let pfSections = '';
  STATE.portfolios.forEach(pf => {
    const pfH = portfolioHistory(pf.id);
    if (!pfH.length) return;
    const pfLast = pfH[pfH.length - 1];

    // Détail par enveloppe (dernier snapshot connu)
    const envs = STATE.envelopes.filter(e => e.portfolio_id === pf.id);
    let envRows = '';
    envs.forEach(env => {
      const envH = envelopeHistory(env.id);
      if (!envH.length) return;
      const last = envH[envH.length - 1];
      const pv   = Number(last.valeur_actuelle) - Number(last.valeur_investie);
      const pvPct = Number(last.valeur_investie) > 0 ? pv / Number(last.valeur_investie) * 100 : 0;
      const firstEnv = envH[0];
      const gain = Number(last.valeur_actuelle) - Number(firstEnv.valeur_actuelle);
      envRows += `<tr>
        <td>${env.nom} <span class="muted">(${env.type})</span></td>
        <td class="r">${_n(last.valeur_investie)}</td>
        <td class="r"><strong>${_n(last.valeur_actuelle)}</strong></td>
        <td class="r ${_sgn(pv)}">${_n(pv)}</td>
        <td class="r ${_sgn(pvPct)}">${_pct(pvPct)}</td>
        <td class="r muted">${envH.length} snap.</td>
      </tr>`;
    });

    pfSections += `
    <div class="section">
      <h2>${pf.nom}</h2>
      ${envRows ? `
      <h3>Composition actuelle</h3>
      <table>
        <thead><tr>
          <th>Enveloppe</th>
          <th class="r">Investi</th>
          <th class="r">Valeur</th>
          <th class="r">+/− €</th>
          <th class="r">+/− %</th>
          <th class="r">Historique</th>
        </tr></thead>
        <tbody>${envRows}</tbody>
      </table>` : ''}
      <h3>Évolution mensuelle</h3>
      <table>
        <thead><tr>
          <th>Mois</th>
          <th class="r">Investi</th>
          <th class="r">Valeur</th>
          <th class="r">+/− €</th>
          <th class="r">+/− %</th>
          <th class="r">Variation mois</th>
        </tr></thead>
        <tbody>${histRows(pfH)}</tbody>
      </table>
    </div>`;
  });

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
  <title>Historique Portfolio — ${dateStr}</title>
  ${_pdfStyle()}
  <style>
    /* Tableaux historiques plus compacts */
    table td, table th { padding: 3.5pt 6pt; font-size: 9pt; }
  </style>
  </head><body>
    <div class="no-print">
      <button onclick="window.print()" style="padding:6pt 14pt;background:#1a365d;color:#fff;border:none;border-radius:4pt;cursor:pointer;font-size:10pt">
        🖨 Imprimer / Enregistrer PDF
      </button>
    </div>
    ${_pdfHeader('Historique Portfolio', `Du ${firstDate} au ${dateStr}`, dateStr)}
    ${globalSection}
    ${pfSections}
    ${_pdfFooter(dateStr)}
  </body></html>`;

  _pdfOpen(html);
}

// ─── LOADER GLOBAL ───────────────────────────────────────────────────────────

function setGlobalLoader(on, msg = 'Enregistrement…') {
  let el = document.getElementById('global-loader');
  if (!el) {
    el = document.createElement('div');
    el.id        = 'global-loader';
    el.className = 'fixed bottom-5 right-5 z-[200] flex items-center gap-2.5 bg-slate-700 border border-slate-600 text-white text-sm px-4 py-2.5 rounded-full shadow-xl transition-opacity duration-200';
    document.body.appendChild(el);
  }
  if (on) {
    el.innerHTML = `<span class="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin flex-shrink-0"></span><span>${msg}</span>`;
    el.style.opacity = '1';
    el.style.pointerEvents = 'none';
  } else {
    el.style.opacity = '0';
  }
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

function patrimoineGlobalBloc(pfStats) {
  const now = new Date();

  // ── Patrimoine financier ──────────────────────────────────────────────────
  const pfBrut = pfStats.total;
  const pfNet  = Math.max(0, pfStats.total - pfStats.totalCharges);

  // ── Immobilier locatif ────────────────────────────────────────────────────
  let immoBrut = 0, immoDette = 0;
  STATE.biens_immo.forEach(b => {
    immoBrut  += Number(b.prix_achat || 0);
    immoDette += immoCapitalRestantDu(b, now);
  });
  const immoNet = Math.max(0, immoBrut - immoDette);

  // ── Résidences ────────────────────────────────────────────────────────────
  let residBrut = 0, residNet = 0, residDette = 0;
  (STATE.residences || []).forEach(r => {
    residBrut  += residValeurPart(r);
    residNet   += residPatrimoineNet(r, now);
    residDette += residCapitalRestantDu(r, now);
  });

  // ── Totaux ────────────────────────────────────────────────────────────────
  const totalBrut  = pfBrut  + immoBrut  + residBrut;
  const totalNet   = pfNet   + immoNet   + residNet;
  const totalDette = pfStats.totalCharges + immoDette + residDette;

  const hasImmo   = STATE.biens_immo.length > 0;
  const hasResid  = (STATE.residences || []).length > 0;
  const multiComp = hasImmo || hasResid;

  const cc   = v => v >= 0 ? 'text-emerald-400' : 'text-red-400';
  const pct  = (net, brut) => brut > 0 ? (net / brut * 100).toFixed(1) + '%' : '—';
  const row  = (icon, label, brut, net, href) => `
    <tr class="border-b border-slate-700/40 hover:bg-slate-700/20 transition cursor-pointer" onclick="navigate('${href}')">
      <td class="py-3 px-4 text-sm">
        <span class="text-slate-300">${icon}</span>
        <span class="text-slate-300 ml-1.5">${label}</span>
      </td>
      <td class="py-3 px-4 text-right text-slate-300 text-sm">${fmt(Math.round(brut))}</td>
      <td class="py-3 px-4 text-right font-semibold text-sm ${cc(net)}">${fmt(Math.round(net))}</td>
      <td class="py-3 px-4 text-right text-slate-500 text-xs">${pct(net, brut)}</td>
    </tr>`;

  return `
    <div class="bg-slate-800 rounded-xl p-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold text-white">🌍 Patrimoine global</h2>
      </div>

      <!-- Cartes résumé -->
      <div class="grid grid-cols-2 ${multiComp ? 'sm:grid-cols-4' : 'sm:grid-cols-2'} gap-3 mb-5">
        <div class="bg-slate-700/40 rounded-xl p-4">
          <p class="text-slate-400 text-xs mb-1">Valeur brute totale</p>
          <p class="text-white font-bold text-xl">${fmt(Math.round(totalBrut))}</p>
          <p class="text-slate-600 text-xs mt-0.5">Tous actifs confondus</p>
        </div>
        <div class="bg-slate-700/40 rounded-xl p-4">
          <p class="text-slate-400 text-xs mb-1">Valeur nette totale</p>
          <p class="text-emerald-400 font-bold text-xl">${fmt(Math.round(totalNet))}</p>
          <p class="text-slate-600 text-xs mt-0.5">Après dettes · ${pct(totalNet, totalBrut)}</p>
        </div>
        ${multiComp ? `
        <div class="bg-slate-700/40 rounded-xl p-4">
          <p class="text-slate-400 text-xs mb-1">Dette totale</p>
          <p class="${totalDette > 0 ? 'text-amber-400' : 'text-slate-400'} font-bold text-xl">${fmt(Math.round(totalDette))}</p>
          <p class="text-slate-600 text-xs mt-0.5">Crédits + charges</p>
        </div>
        <div class="bg-slate-700/40 rounded-xl p-4">
          <p class="text-slate-400 text-xs mb-1">Ratio net / brut</p>
          <p class="text-blue-400 font-bold text-xl">${pct(totalNet, totalBrut)}</p>
          <p class="text-slate-600 text-xs mt-0.5">${totalBrut > 0 ? fmt(Math.round(totalDette)) + ' de dettes' : '—'}</p>
        </div>` : ''}
      </div>

      <!-- Tableau de répartition (affiché seulement si plusieurs composantes) -->
      ${multiComp ? `
      <div class="bg-slate-900 rounded-lg overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-slate-800 text-slate-500 text-xs">
            <tr>
              <th class="py-2.5 px-4 text-left font-medium">Composante</th>
              <th class="py-2.5 px-4 text-right font-medium">Valeur brute</th>
              <th class="py-2.5 px-4 text-right font-medium">Valeur nette</th>
              <th class="py-2.5 px-4 text-right font-medium">% du brut</th>
            </tr>
          </thead>
          <tbody>
            ${row('📊', 'Patrimoine financier', pfBrut, pfNet, '#dashboard')}
            ${hasImmo  ? row('🏠', 'Immobilier locatif', immoBrut, immoNet, '#immo') : ''}
            ${hasResid ? row('🏡', 'Résidences', residBrut, residNet, '#residences') : ''}
          </tbody>
          <tfoot class="border-t-2 border-slate-600">
            <tr class="bg-slate-800/60">
              <td class="py-3 px-4 text-white font-bold text-sm">Total</td>
              <td class="py-3 px-4 text-right text-white font-bold">${fmt(Math.round(totalBrut))}</td>
              <td class="py-3 px-4 text-right text-emerald-400 font-bold text-base">${fmt(Math.round(totalNet))}</td>
              <td class="py-3 px-4 text-right text-blue-400 font-semibold text-sm">${pct(totalNet, totalBrut)}</td>
            </tr>
          </tfoot>
        </table>
      </div>` : ''}
    </div>`;
}

function _dashBlock(id, stats) {
  const { total, invested, alloc, totalCharges } = stats;
  switch (id) {
    case 'stats': return `
      <div class="flex items-center justify-between mb-1">
        <h2 class="text-lg font-semibold text-white">📊 Patrimoine financier</h2>
        <a href="#hist-global" onclick="navigate('#hist-global');return false;" class="btn-secondary text-sm">📈 Historique</a>
      </div>
      ${statCards(total, invested, totalCharges, computeAnnualReturn(globalHistory()))}
      ${allocBar(alloc, 'Allocation globale', 'md', null, total)}
      ${historySparkline(globalHistory(), '#hist-global')}`;
    case 'patrimoine_global': return patrimoineGlobalBloc(stats);
    case 'immo': return `
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-white">🏠 Immobilier locatif</h2>
        <a href="#immo" onclick="navigate('#immo');return false;" class="btn-secondary text-sm">Détail →</a>
      </div>
      ${immoDashboardCard()}`;
    case 'residences': return `
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-white">🏡 Résidences</h2>
        <a href="#residences" onclick="navigate('#residences');return false;" class="btn-secondary text-sm">Détail →</a>
      </div>
      ${residDashboardCard()}`;
    case 'eoy': return `
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-white">📅 Projection fin d'année</h2>
      </div>
      <div id="eoy-card-wrapper">${eoyCard()}</div>`;
    case 'projections': return `
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-white">🎯 Simulations</h2>
      </div>
      <div id="proj-section">${projBlock()}</div>`;
    case 'milestones': return `
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-white">🏆 Jalons</h2>
        <button onclick="openMilestoneModal()" class="btn-secondary text-sm">+ Jalon</button>
      </div>
      <div id="milestone-section">${milestoneGauge()}</div>`;
    case 'fire': return `
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-white">🔥 Simulation FIRE</h2>
        <a href="#fire" onclick="navigate('#fire');return false;" class="btn-secondary text-sm">Configurer →</a>
      </div>
      ${fireDashboardCards()}`;
    case 'expenses': return `
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold text-white">💰 Dépenses</h2>
        <a href="#expenses" onclick="navigate('#expenses');return false;" class="btn-secondary text-sm">Détail →</a>
      </div>
      ${expenseDashboardCard()}`;
    case 'portfolios': return `
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
      </div>`;
    default: return '';
  }
}

function renderDashboard(app) {
  const stats = globalStats();
  const order = loadDashOrder();

  app.innerHTML = `
    ${navbar()}
    <div class="max-w-screen-2xl mx-auto px-4 py-8 space-y-6">
      <div class="flex justify-end">
        <button onclick="openDashOrderModal()" class="text-slate-600 hover:text-slate-300 text-xs flex items-center gap-1.5 transition px-2 py-1 rounded hover:bg-slate-800">
          ⊞ <span>Réorganiser</span>
        </button>
      </div>
      ${order.map(id => _dashBlock(id, stats)).join('')}
    </div>
    ${modalPortfolio()}
    ${modalEoy()}
    ${modalProjection()}
    ${modalMilestone()}`;
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
      <p class="text-slate-500 text-xs h-4 mb-2">${totalCharges > 0 ? `Brut : ${fmt(total)} · Charges : −${fmt(totalCharges)}` : ''}</p>
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
    <div class="max-w-screen-2xl mx-auto px-4 py-8 space-y-6">
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
    <div class="max-w-screen-2xl mx-auto px-4 py-8 space-y-6">
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
    <nav class="bg-slate-900 border-b border-slate-700 px-4 py-2.5 flex items-center justify-between gap-2">
      <div class="flex items-center gap-3 min-w-0">
        ${left}
        <a href="#dashboard" onclick="navigate('#dashboard');return false;" class="text-white font-bold text-sm hover:text-slate-300 transition whitespace-nowrap">Portfolio Manager</a>
        <a href="#fire" onclick="navigate('#fire');return false;" class="text-orange-400 hover:text-orange-300 text-sm font-medium transition whitespace-nowrap">🔥 FIRE</a>
        <a href="#expenses" onclick="navigate('#expenses');return false;" class="text-emerald-400 hover:text-emerald-300 text-sm font-medium transition whitespace-nowrap">💰 Dépenses</a>
        <a href="#immo" onclick="navigate('#immo');return false;" class="text-blue-400 hover:text-blue-300 text-sm font-medium transition whitespace-nowrap">🏠 Immo</a>
        <a href="#residences" onclick="navigate('#residences');return false;" class="text-violet-400 hover:text-violet-300 text-sm font-medium transition whitespace-nowrap">🏡 Résidences</a>
      </div>
      <div class="flex items-center gap-3 flex-shrink-0">
        <button onclick="openCacheSettings()" class="hidden sm:inline text-slate-500 hover:text-slate-300 text-xs whitespace-nowrap transition" title="Configurer le cache">Cache : ${ageLabel} · TTL ${API.getCacheTTLMinutes()}min</button>
        <button onclick="forceRefresh()" class="text-slate-400 hover:text-white text-xs transition whitespace-nowrap" title="Cache : ${ageLabel}">↻ <span class="hidden sm:inline">Actualiser</span></button>
        <button onclick="localStorage.clear();location.reload()" class="text-slate-500 hover:text-white text-xs transition whitespace-nowrap" title="Déconnexion">⏻ <span class="hidden sm:inline">Déconnexion</span></button>
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
    <div class="grid grid-cols-3 gap-3 sm:gap-4">
      <div class="bg-slate-800 rounded-xl p-3 sm:p-4 min-w-0">
        <p class="text-slate-400 text-xs mb-1 truncate">${totalCharges > 0 ? 'Valeur nette' : 'Valeur totale'}</p>
        <p class="text-white text-base sm:text-2xl font-bold leading-tight break-all">${fmt(totalCharges > 0 ? nette : total)}</p>
      </div>
      <div class="bg-slate-800 rounded-xl p-3 sm:p-4 min-w-0">
        <p class="text-slate-400 text-xs mb-1">Investi</p>
        <p class="text-white text-base sm:text-2xl font-bold leading-tight break-all">${fmt(invested)}</p>
      </div>
      <div class="bg-slate-800 rounded-xl p-3 sm:p-4 min-w-0">
        <p class="text-slate-400 text-xs mb-1">Plus-value</p>
        <p class="text-base sm:text-2xl font-bold leading-tight break-all ${pvColor}">${pv >= 0 ? '+' : ''}${fmt(pv)}</p>
        <p class="text-xs ${pctColor}">${pvPct}%</p>
        ${annualLine}
      </div>
    </div>
    ${totalCharges > 0 ? `
    <div class="grid grid-cols-2 gap-3 sm:gap-4">
      <div class="bg-slate-800/50 border border-slate-700 rounded-xl p-3 min-w-0">
        <p class="text-slate-500 text-xs mb-1">Valeur brute</p>
        <p class="text-slate-400 text-base sm:text-lg font-semibold break-all">${fmt(total)}</p>
      </div>
      <div class="bg-slate-800/50 border border-red-500/20 rounded-xl p-3 min-w-0">
        <p class="text-slate-500 text-xs mb-1">Charges à venir</p>
        <p class="text-red-400 text-base sm:text-lg font-semibold break-all">−${fmt(totalCharges)}</p>
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

// Déduplique les entrées history par (envelope_id, date_jour) en gardant
// la dernière occurrence — les lignes du sheet étant en ordre chronologique,
// la dernière ligne d'une journée = l'enregistrement le plus récent.
function dedupHistory(entries) {
  const seen = new Map();
  entries.forEach(h => {
    seen.set(`${h.envelope_id}__${normalizeDate(h.date)}`, h);
  });
  return Array.from(seen.values());
}

// Toutes les entrées history d'une enveloppe, triées chronologiquement (dédupliquées par jour)
function envelopeHistory(envelopeId) {
  return dedupHistory(STATE.history.filter(h => h.envelope_id === envelopeId))
    .map(h => ({ ...h, date: normalizeDate(h.date) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Somme quotidienne de toutes les enveloppes → courbe de valeur NETTE
// Les charges (portées au niveau portfolio) sont déduites de valeur_actuelle
// pour éviter les chutes brutales quand une charge est saisie.
function globalHistory() {
  const totalCharges = STATE.charges.reduce((s, c) => s + (Number(c.montant) || 0), 0);

  const byDate = {};
  dedupHistory(STATE.history).forEach(h => {
    const date = normalizeDate(h.date);
    if (!byDate[date]) byDate[date] = { date, valeur_investie: 0, valeur_actuelle: 0 };
    byDate[date].valeur_investie += Number(h.valeur_investie) || 0;
    byDate[date].valeur_actuelle += Number(h.valeur_actuelle) || 0;
  });

  return Object.values(byDate)
    .map(e => {
      const va = Math.max(0, e.valeur_actuelle - totalCharges); // valeur nette
      return {
        ...e,
        valeur_actuelle: va,
        pv_euros: va - e.valeur_investie,
        pv_pct: e.valeur_investie > 0
          ? ((va / e.valeur_investie - 1) * 100).toFixed(2)
          : 0,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Somme quotidienne des enveloppes d'un portfolio → courbe de valeur NETTE
function portfolioHistory(portfolioId) {
  const totalCharges = STATE.charges
    .filter(c => c.portfolio_id === portfolioId)
    .reduce((s, c) => s + (Number(c.montant) || 0), 0);

  const envIds = STATE.envelopes
    .filter(e => e.portfolio_id === portfolioId)
    .map(e => e.id);

  const byDate = {};
  dedupHistory(STATE.history.filter(h => envIds.includes(h.envelope_id))).forEach(h => {
    const date = normalizeDate(h.date);
    if (!byDate[date]) byDate[date] = { date, valeur_investie: 0, valeur_actuelle: 0 };
    byDate[date].valeur_investie += Number(h.valeur_investie) || 0;
    byDate[date].valeur_actuelle += Number(h.valeur_actuelle) || 0;
  });

  return Object.values(byDate)
    .map(e => {
      const va = Math.max(0, e.valeur_actuelle - totalCharges); // valeur nette
      return {
        ...e,
        valeur_actuelle: va,
        pv_euros: va - e.valeur_investie,
        pv_pct: e.valeur_investie > 0
          ? ((va / e.valeur_investie - 1) * 100).toFixed(2)
          : 0,
      };
    })
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

// Formate une valeur d'axe Y en adaptant la précision au pas des graduations.
// Évite le problème "1,4 M€" sur toutes les lignes quand la plage est petite.
function fmtAxisSmart(v, tickStep) {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) {
    // M€ = précision de 100 k. Si le pas est plus fin, descendre en k€.
    if (tickStep < 100_000) {
      const kv = v / 1000;
      // Si le pas est < 1 k€, montrer 1 décimale en k€
      const decimals = tickStep < 1000 ? 1 : 0;
      return kv.toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + ' k€';
    }
    return (v / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' M€';
  }
  if (abs >= 1_000) {
    const decimals = tickStep < 1000 ? 1 : 0;
    return (v / 1000).toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + ' k€';
  }
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

  // Gridlines horizontales + labels Y (précision adaptative selon le pas)
  const gridLines = yTicks.map(t => {
    const y = toY(t).toFixed(1);
    return `
      <line x1="${padL}" y1="${y}" x2="${(padL + cw).toFixed(1)}" y2="${y}"
        stroke="#334155" stroke-width="1" stroke-dasharray="4,3"/>
      <text x="${(padL - 7).toFixed(1)}" y="${y}" text-anchor="end" dominant-baseline="middle"
        fill="#94a3b8" font-size="11" font-family="system-ui,sans-serif">${fmtAxisSmart(t, tickStep)}</text>`;
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
    const dateStr = parts.length === 3
      ? new Date(e.date + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
      : e.date;
    const pv      = Number(e.pv_euros);
    const pct     = Math.abs(Number(e.pv_pct)).toFixed(2);
    const pvFmt   = fmt(Math.abs(Math.round(pv)));
    const sign    = pv >= 0 ? '+' : '−';
    const invest  = Number(e.valeur_investie) > 0 ? fmt(Math.round(Number(e.valeur_investie))) : '';
    return `<circle cx="${toX(i).toFixed(1)}" cy="${toY(v).toFixed(1)}" r="14"
      fill="transparent" style="cursor:crosshair"
      data-date="${dateStr}" data-val="${fmt(Math.round(v))}"
      data-invest="${invest}"
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
    <p class="text-slate-400 text-xs mb-1.5">${d.date}</p>
    <p class="text-white font-bold">${d.val}</p>
    ${d.invest ? `<p class="text-slate-500 text-xs">Investi : ${d.invest}</p>` : ''}
    <p class="${isUp ? 'text-emerald-400' : 'text-red-400'} text-xs mt-1">${d.pv} <span class="opacity-70">(${d.pct})</span></p>`;
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
    <div class="max-w-screen-2xl mx-auto px-4 py-8 space-y-6">
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
    <div class="max-w-screen-2xl mx-auto px-4 py-8 space-y-6">
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
    <div class="max-w-screen-2xl mx-auto px-4 py-8 space-y-6">
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

// ─── PROJECTION FIN D'ANNÉE (EOY) ────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════════
// ORDRE DES BLOCS DU DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

const DASH_ORDER_KEY = 'dashboard_block_order';
const DASH_BLOCKS_DEF = [
  { id: 'patrimoine_global', label: '🌍 Patrimoine global'   },
  { id: 'stats',       label: '📊 Patrimoine financier'      },
  { id: 'immo',        label: '🏠 Immobilier locatif'        },
  { id: 'residences',  label: '🏡 Résidences'                },
  { id: 'eoy',         label: '📅 Projection fin d\'année'   },
  { id: 'projections', label: '🎯 Simulations'               },
  { id: 'milestones',  label: '🏆 Jalons'                    },
  { id: 'fire',        label: '🔥 Simulation FIRE'           },
  { id: 'expenses',    label: '💰 Dépenses'                  },
  { id: 'portfolios',  label: '📁 Portfolios'                },
];

function loadDashOrder() {
  const allIds = DASH_BLOCKS_DEF.map(b => b.id);
  const saved  = getUiPref(DASH_ORDER_KEY, null);
  if (!saved || !Array.isArray(saved)) return allIds;
  const filtered = saved.filter(id => allIds.includes(id));
  const missing  = allIds.filter(id => !filtered.includes(id));
  return [...filtered, ...missing];
}
function saveDashOrder(arr) { persistUiPref(DASH_ORDER_KEY, arr); }

function openDashOrderModal() {
  let modal = document.getElementById('modal-dash-order');
  if (!modal) {
    modal = document.createElement('div');
    modal.id        = 'modal-dash-order';
    modal.className = 'fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4';
    modal.addEventListener('click', e => { if (e.target === modal) closeDashOrderModal(); });
    document.body.appendChild(modal);
  }
  modal.classList.remove('hidden');
  _renderDashOrderModal();
}

function closeDashOrderModal() {
  document.getElementById('modal-dash-order')?.classList.add('hidden');
}

function _renderDashOrderModal() {
  const modal = document.getElementById('modal-dash-order');
  if (!modal) return;
  const order = loadDashOrder();
  modal.innerHTML = `
    <div class="modal-box w-full max-w-sm" onclick="event.stopPropagation()">
      <h3 class="text-base font-bold text-white mb-1">⊞ Ordre des blocs</h3>
      <p class="text-slate-500 text-xs mb-4">Utilisez ▲ ▼ pour réorganiser l'affichage du dashboard.</p>
      <div class="space-y-1.5 mb-5">
        ${order.map((id, i) => {
          const block = DASH_BLOCKS_DEF.find(b => b.id === id);
          if (!block) return '';
          return `
            <div class="flex items-center gap-2 bg-slate-700/60 rounded-lg px-3 py-2.5">
              <span class="text-slate-600 text-xs w-4 text-center select-none">${i + 1}</span>
              <span class="flex-1 text-sm text-white">${block.label}</span>
              <div class="flex gap-0.5">
                <button onclick="moveDashBlock('${id}',-1)"
                  class="px-1.5 py-0.5 rounded text-xs transition ${i === 0 ? 'text-slate-700 cursor-not-allowed' : 'text-slate-400 hover:text-white hover:bg-slate-600'}"
                  ${i === 0 ? 'disabled' : ''}>▲</button>
                <button onclick="moveDashBlock('${id}',1)"
                  class="px-1.5 py-0.5 rounded text-xs transition ${i === order.length - 1 ? 'text-slate-700 cursor-not-allowed' : 'text-slate-400 hover:text-white hover:bg-slate-600'}"
                  ${i === order.length - 1 ? 'disabled' : ''}>▼</button>
              </div>
            </div>`;
        }).join('')}
      </div>
      <div class="flex gap-3">
        <button onclick="applyDashOrder()" class="btn-primary flex-1">Appliquer</button>
        <button onclick="resetDashOrder()" class="btn-secondary text-xs">Réinitialiser</button>
        <button onclick="closeDashOrderModal()" class="btn-secondary flex-1">Fermer</button>
      </div>
    </div>`;
}

function moveDashBlock(id, dir) {
  const order  = loadDashOrder();
  const idx    = order.indexOf(id);
  const newIdx = idx + dir;
  if (idx < 0 || newIdx < 0 || newIdx >= order.length) return;
  [order[idx], order[newIdx]] = [order[newIdx], order[idx]];
  saveDashOrder(order);
  _renderDashOrderModal();
}

function applyDashOrder() {
  closeDashOrderModal();
  render();
}

function resetDashOrder() {
  saveDashOrder(DASH_BLOCKS_DEF.map(b => b.id));
  _renderDashOrderModal();
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIMULATIONS PERSONNALISÉES
// ═══════════════════════════════════════════════════════════════════════════════

const PROJ_KEY  = 'portfolio_projections';
const MILE_KEY  = 'portfolio_milestones';
let _projEdit   = null;
let _mileEdit   = null;

function loadProjections() { return getUiPref(PROJ_KEY, []); }
function saveProjections(arr) { persistUiPref(PROJ_KEY, arr); }

function loadMilestones() { return getUiPref(MILE_KEY, []); }
function saveMilestones(arr) { persistUiPref(MILE_KEY, arr); }

// ── Calcul projection ─────────────────────────────────────────────────────────

function projCalc(sim) {
  const { total, totalCharges } = globalStats();
  const pv     = Math.max(0, total - totalCharges);
  const now    = new Date();
  const target = new Date(Number(sim.annee), 11, 31);
  const t      = Math.max(0, Math.round((target - now) / (1000 * 60 * 60 * 24 * 30.44)));
  const r      = (sim.rate || 0) / 100 / 12;
  const pmt    = Number(sim.pmt) || 0;
  const fv     = r === 0 ? pv + pmt * t : pv * Math.pow(1 + r, t) + pmt * (Math.pow(1 + r, t) - 1) / r;
  return { pv, fv: Math.round(fv), gain: Math.round(fv - pv), t };
}

// ── Rendu carte simulation ────────────────────────────────────────────────────

function projCard(sim) {
  const { pv, fv, gain, t } = projCalc(sim);
  const gainPct  = pv > 0 ? ((gain / pv) * 100).toFixed(1) : '0.0';
  const gc       = gain >= 0 ? 'text-emerald-400' : 'text-red-400';
  const pmtLine  = sim.pmt > 0 ? ` · +${fmt(sim.pmt)}/mois` : '';
  const yearsLeft = Number(sim.annee) - new Date().getFullYear();
  const yLabel    = yearsLeft > 0 ? `dans ${yearsLeft} an${yearsLeft > 1 ? 's' : ''}` : 'cette année';
  return `
    <div class="bg-slate-800 rounded-xl p-5 cursor-pointer hover:bg-slate-750 transition"
         onclick="openProjModal('${sim.id}')">
      <div class="flex items-start justify-between">
        <div class="min-w-0 flex-1">
          <p class="text-slate-400 text-xs mb-0.5">🎯 <span class="font-medium text-slate-300">${esc(sim.nom)}</span></p>
          <p class="text-white text-2xl font-bold">${fmt(fv)}</p>
          <p class="${gc} text-sm mt-0.5">${gain >= 0 ? '+' : ''}${fmt(gain)} <span class="text-xs opacity-70">(${gain >= 0 ? '+' : ''}${gainPct}%)</span></p>
        </div>
        <div class="text-right flex-shrink-0 ml-3">
          <p class="text-slate-500 text-xs">${sim.rate}%/an${pmtLine}</p>
          <p class="text-slate-600 text-xs mt-0.5">Fin ${sim.annee} · ${yLabel}</p>
          <p class="text-slate-700 text-xs mt-0.5">${t} mois</p>
        </div>
      </div>
    </div>`;
}

function projBlock() {
  const sims = loadProjections();
  const cards = sims.map(s => projCard(s)).join('');
  return `
    <div class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      ${cards}
      <div class="bg-slate-800/50 border-2 border-dashed border-slate-700 rounded-xl p-5 flex items-center justify-center cursor-pointer hover:border-slate-500 hover:bg-slate-800 transition min-h-[112px]"
        onclick="openProjModal()">
        <div class="text-center">
          <p class="text-slate-500 text-2xl mb-1">+</p>
          <p class="text-slate-500 text-xs">Nouvelle simulation</p>
        </div>
      </div>
    </div>`;
}

function openProjModal(id = null) {
  _projEdit = id;
  const sim = id ? loadProjections().find(s => s.id === id) : null;
  document.getElementById('proj-nom').value   = sim?.nom   || '';
  document.getElementById('proj-annee').value = sim?.annee || (new Date().getFullYear() + 5);
  document.getElementById('proj-rate').value  = sim?.rate  ?? estimateAnnualReturn();
  document.getElementById('proj-pmt').value   = sim?.pmt   || 0;
  document.getElementById('proj-delete-row')?.classList.toggle('hidden', !id);
  document.getElementById('modal-proj').classList.remove('hidden');
  refreshProjPreview();
  setTimeout(() => document.getElementById('proj-nom')?.focus(), 50);
}

function closeProjModal() {
  document.getElementById('modal-proj').classList.add('hidden');
  _projEdit = null;
}

function refreshProjPreview() {
  const rate  = parseFloat(document.getElementById('proj-rate')?.value) || 0;
  const pmt   = parseFloat(String(document.getElementById('proj-pmt')?.value || '').replace(',', '.')) || 0;
  const annee = parseInt(document.getElementById('proj-annee')?.value) || new Date().getFullYear() + 5;
  const { total, totalCharges } = globalStats();
  const pv     = Math.max(0, total - totalCharges);
  const target = new Date(annee, 11, 31);
  const t      = Math.max(0, Math.round((target - new Date()) / (1000 * 60 * 60 * 24 * 30.44)));
  const r      = rate / 100 / 12;
  const fv     = r === 0 ? pv + pmt * t : pv * Math.pow(1 + r, t) + pmt * (Math.pow(1 + r, t) - 1) / r;
  const gain   = fv - pv;
  const el = document.getElementById('proj-preview');
  if (el) el.innerHTML = `${fmt(Math.round(fv))} <span class="${gain >= 0 ? 'text-emerald-400' : 'text-red-400'} text-sm">(${gain >= 0 ? '+' : ''}${fmt(Math.round(gain))})</span>`;
  const tEl = document.getElementById('proj-months');
  if (tEl) tEl.textContent = `${t} mois jusqu'au 31 déc. ${annee}`;
}

function saveProjSim() {
  const nom   = document.getElementById('proj-nom')?.value.trim();
  const annee = parseInt(document.getElementById('proj-annee')?.value);
  const rate  = parseFloat(document.getElementById('proj-rate')?.value) || 0;
  const pmt   = parseFloat(String(document.getElementById('proj-pmt')?.value || '').replace(',', '.')) || 0;
  if (!nom) { alert('Le nom est obligatoire.'); return; }
  const sims = loadProjections();
  if (_projEdit) {
    const idx = sims.findIndex(s => s.id === _projEdit);
    if (idx !== -1) sims[idx] = { ...sims[idx], nom, annee, rate, pmt };
  } else {
    sims.push({ id: 'proj_' + Date.now(), nom, annee, rate, pmt });
  }
  saveProjections(sims);
  closeProjModal();
  setEl('proj-section', projBlock());
}

function deleteProjSim(id) {
  if (!confirm('Supprimer cette simulation ?')) return;
  saveProjections(loadProjections().filter(s => s.id !== id));
  setEl('proj-section', projBlock());
}

function modalProjection() {
  const cy = new Date().getFullYear();
  const yearOpts = Array.from({ length: 21 }, (_, i) => cy + i)
    .map(y => `<option value="${y}">${y}</option>`).join('');
  return `
    <div id="modal-proj" class="hidden fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onclick="if(event.target===this)closeProjModal()">
      <div class="modal-box w-full max-w-sm">
        <h3 class="text-lg font-bold text-white mb-4">🎯 Simulation</h3>
        <div class="space-y-3">
          <div>
            <label class="block text-slate-400 text-xs mb-1">Nom de la simulation *</label>
            <input id="proj-nom" type="text" placeholder="Ex : Retraite 2032, Appart 2028…"
              class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
          <div>
            <label class="block text-slate-400 text-xs mb-1">Année cible</label>
            <select id="proj-annee" onchange="refreshProjPreview()"
              class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              ${yearOpts}
            </select>
          </div>
          <div>
            <label class="block text-slate-400 text-xs mb-1">Rendement annuel estimé (%)</label>
            <input id="proj-rate" type="number" step="0.1" min="0" max="100" oninput="refreshProjPreview()"
              class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
          <div>
            <label class="block text-slate-400 text-xs mb-1">Versements mensuels (€)</label>
            <input id="proj-pmt" type="number" step="100" min="0" oninput="refreshProjPreview()"
              class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
          <div class="bg-slate-700/50 rounded-lg p-3 space-y-1">
            <p class="text-slate-400 text-xs">Projection calculée</p>
            <p id="proj-preview" class="text-white font-bold text-lg">—</p>
            <p id="proj-months" class="text-slate-600 text-xs">—</p>
          </div>
        </div>
        <div class="flex gap-3 mt-5">
          <button onclick="saveProjSim()" class="btn-primary flex-1">Enregistrer</button>
          <button onclick="closeProjModal()" class="btn-secondary flex-1">Annuler</button>
        </div>
        <div id="proj-delete-row" class="hidden mt-2">
          <button onclick="deleteProjSimFromModal()" class="w-full text-center text-red-400 hover:text-red-300 text-xs py-1.5 rounded hover:bg-slate-700 transition">
            🗑 Supprimer cette simulation
          </button>
        </div>
      </div>
    </div>`;
}

function deleteProjSimFromModal() {
  if (!_projEdit) return;
  if (!confirm('Supprimer cette simulation ?')) return;
  saveProjections(loadProjections().filter(s => s.id !== _projEdit));
  closeProjModal();
  setEl('proj-section', projBlock());
}

// ── Jalons (milestone gauge) ─────────────────────────────────────────────────

function milestoneGauge() {
  const miles   = loadMilestones().sort((a, b) => Number(a.valeur) - Number(b.valeur));
  const { total, totalCharges } = globalStats();
  const current = Math.max(0, total - totalCharges);

  if (!miles.length) return `
    <div class="bg-slate-800 rounded-xl p-6 text-center">
      <p class="text-3xl mb-2">🏆</p>
      <p class="text-slate-300 font-medium mb-1">Jalons de progression</p>
      <p class="text-slate-500 text-sm mb-4">Définissez des paliers de valeur et visualisez votre progression vers l'indépendance financière</p>
      <button onclick="openMilestoneModal()" class="btn-primary text-sm">+ Créer mon premier jalon</button>
    </div>`;

  const unlocked = miles.filter(m => current >= Number(m.valeur));
  const locked   = miles.filter(m => current < Number(m.valeur));
  const curLevel = unlocked[unlocked.length - 1] || null;
  const nxtLevel = locked[0] || null;

  // ── Frise complète ─────────────────────────────────────────────────────────
  // Échelle : de 0 jusqu'au dernier jalon (ou au-delà si current > tout)
  const maxVal   = Math.max(...miles.map(m => Number(m.valeur)), current) * 1.06;
  const curPct   = Math.min(97, (current / maxVal) * 100);

  // Chaque jalon : position + étiquette alternée (pair = bas, impair = haut)
  const markerHtml = miles.map((m, i) => {
    const val    = Number(m.valeur);
    const pct    = Math.min(97, (val / maxVal) * 100);
    const fire   = Math.round(val * Number(m.txRetrait || 4) / 100 / 12);
    const done   = current >= val;
    const isNext = m.id === nxtLevel?.id;
    const above  = i % 2 !== 0; // odd = au-dessus
    const dotColor = done ? '#10b981' : isNext ? '#3b82f6' : '#475569';
    const dotBorder = done ? '#34d399' : isNext ? '#93c5fd' : '#64748b';
    const txtColor  = done ? '#34d399' : isNext ? '#93c5fd' : '#64748b';
    const labelPos  = above
      ? `bottom:18px;`
      : `top:18px;`;
    return `
      <div style="position:absolute;left:${pct}%;top:50%;transform:translate(-50%,-50%);z-index:10">
        <div style="width:12px;height:12px;background:${dotColor};border:2px solid ${dotBorder};border-radius:50%;box-shadow:0 0 6px ${dotColor}55"></div>
        <div style="position:absolute;${labelPos}left:50%;transform:translateX(-50%);text-align:center;white-space:nowrap;pointer-events:none">
          <div style="font-size:10px;font-weight:600;color:${txtColor}">${done ? '✓ ' : isNext ? '→ ' : ''}${esc(m.nom)}</div>
          <div style="font-size:9px;color:#64748b">${fmt(val)}</div>
          <div style="font-size:9px;color:${txtColor}">+${fmt(fire)}/m</div>
        </div>
      </div>`;
  }).join('');

  const frise = `
    <div class="bg-slate-800 rounded-xl p-5">
      <div style="position:relative;margin:52px 8px 52px;height:8px">
        <!-- Piste -->
        <div style="position:absolute;inset:0;background:#334155;border-radius:4px"></div>
        <!-- Progression verte -->
        <div style="position:absolute;top:0;left:0;bottom:0;width:${curPct}%;background:linear-gradient(to right,#059669,#3b82f6);border-radius:4px"></div>
        <!-- Jalons -->
        ${markerHtml}
        <!-- Marqueur position actuelle -->
        <div style="position:absolute;left:${curPct}%;top:50%;transform:translate(-50%,-50%);z-index:20">
          <div style="width:18px;height:18px;background:white;border:3px solid #3b82f6;border-radius:50%;box-shadow:0 0 14px rgba(59,130,246,.7)"></div>
          <div style="position:absolute;bottom:24px;left:50%;transform:translateX(-50%);white-space:nowrap">
            <div style="background:#1d4ed8;color:white;font-size:11px;font-weight:700;padding:3px 8px;border-radius:5px">${fmt(Math.round(current))}</div>
            <div style="width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:5px solid #1d4ed8;margin:0 auto"></div>
          </div>
        </div>
      </div>
      <!-- Légende statut -->
      ${nxtLevel ? `
        <div class="flex items-center justify-between text-xs text-slate-500 mt-1">
          <span>${curLevel ? `🏅 Niveau actuel : <span class="text-emerald-400 font-medium">${esc(curLevel.nom)}</span>` : `🚀 En route vers le 1er jalon`}</span>
          <span>🎯 Prochain : <span class="text-blue-400 font-medium">${esc(nxtLevel.nom)}</span> — manque <span class="text-blue-300">${fmt(Math.round(Number(nxtLevel.valeur) - current))}</span></span>
        </div>` : `
        <div class="text-center text-xs text-emerald-400 mt-1">🎉 Tous les jalons atteints !</div>`}
    </div>`;

  // ── Cartes jalons (cliquables) ─────────────────────────────────────────────
  const mileCards = miles.map(m => {
    const val    = Number(m.valeur);
    const rate   = Number(m.txRetrait || 4);
    const fire   = Math.round(val * rate / 100 / 12);
    const done   = current >= val;
    const isNext = m.id === nxtLevel?.id;
    return `
      <div class="bg-slate-700/40 rounded-lg p-4 border cursor-pointer hover:bg-slate-700/60 transition
                  ${done ? 'border-emerald-500/40' : isNext ? 'border-blue-500/40' : 'border-slate-700'}"
           onclick="openMilestoneModal('${m.id}')">
        <div class="flex items-start justify-between">
          <div>
            <p class="text-xs font-semibold ${done ? 'text-emerald-400' : isNext ? 'text-blue-300' : 'text-slate-400'}">
              ${done ? '✅' : isNext ? '🎯' : '⬜'} ${esc(m.nom)}
            </p>
            <p class="text-white font-bold text-base mt-0.5">${fmt(val)}</p>
          </div>
          <div class="text-right">
            <p class="text-xs text-slate-500">${rate}% SWR</p>
            <p class="text-sm font-semibold ${done ? 'text-emerald-400' : isNext ? 'text-blue-300' : 'text-slate-500'}">+${fmt(fire)}/mois</p>
          </div>
        </div>
        ${done
          ? `<p class="text-xs text-emerald-500 mt-1.5">Atteint ✓</p>`
          : `<p class="text-xs text-slate-500 mt-1.5">Manque : <span class="${isNext ? 'text-blue-400' : 'text-slate-400'} font-medium">${fmt(Math.round(val - current))}</span></p>`}
      </div>`;
  }).join('');

  return `
    <div class="space-y-4">
      ${frise}
      <div class="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        ${mileCards}
      </div>
    </div>`;
}

function openMilestoneModal(id = null) {
  _mileEdit = id;
  const m = id ? loadMilestones().find(x => x.id === id) : null;
  document.getElementById('mile-nom').value      = m?.nom      || '';
  document.getElementById('mile-valeur').value   = m?.valeur   || '';
  document.getElementById('mile-retrait').value  = m?.txRetrait ?? 4;
  document.getElementById('mile-delete-row')?.classList.toggle('hidden', !id);
  document.getElementById('modal-milestone').classList.remove('hidden');
  refreshMilePreview();
  setTimeout(() => document.getElementById('mile-nom')?.focus(), 50);
}

function closeMilestoneModal() {
  document.getElementById('modal-milestone').classList.add('hidden');
  _mileEdit = null;
}

function refreshMilePreview() {
  const val  = parseFloat(document.getElementById('mile-valeur')?.value) || 0;
  const rate = parseFloat(document.getElementById('mile-retrait')?.value) || 4;
  const fire = Math.round(val * rate / 100 / 12);
  const el   = document.getElementById('mile-preview');
  if (el) el.textContent = val > 0 ? `FIRE : +${fmt(fire)}/mois (${rate}% SWR)` : '—';
}

function saveMilestone() {
  const nom      = document.getElementById('mile-nom')?.value.trim();
  const valeur   = parseFloat(document.getElementById('mile-valeur')?.value) || 0;
  const txRetrait = parseFloat(document.getElementById('mile-retrait')?.value) || 4;
  if (!nom || !valeur) { alert('Nom et valeur sont obligatoires.'); return; }
  const miles = loadMilestones();
  if (_mileEdit) {
    const idx = miles.findIndex(m => m.id === _mileEdit);
    if (idx !== -1) miles[idx] = { ...miles[idx], nom, valeur, txRetrait };
  } else {
    miles.push({ id: 'mile_' + Date.now(), nom, valeur, txRetrait });
  }
  saveMilestones(miles);
  closeMilestoneModal();
  setEl('milestone-section', milestoneGauge());
}

function deleteMilestone(id) {
  if (!confirm('Supprimer ce jalon ?')) return;
  saveMilestones(loadMilestones().filter(m => m.id !== id));
  setEl('milestone-section', milestoneGauge());
}

function modalMilestone() {
  return `
    <div id="modal-milestone" class="hidden fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onclick="if(event.target===this)closeMilestoneModal()">
      <div class="modal-box w-full max-w-sm">
        <h3 class="text-lg font-bold text-white mb-4">🏆 Jalon</h3>
        <div class="space-y-3">
          <div>
            <label class="block text-slate-400 text-xs mb-1">Nom du jalon *</label>
            <input id="mile-nom" type="text" placeholder="Ex : 100k Club, Mi-chemin FIRE…"
              class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
          <div>
            <label class="block text-slate-400 text-xs mb-1">Valeur cible (€) *</label>
            <input id="mile-valeur" type="number" step="1000" min="0" oninput="refreshMilePreview()"
              class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
          <div>
            <label class="block text-slate-400 text-xs mb-1">Taux de retrait SWR (%)</label>
            <input id="mile-retrait" type="number" step="0.1" min="1" max="10" oninput="refreshMilePreview()"
              class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <p class="text-slate-600 text-xs mt-1">Règle des 4% recommandée. Revenu FIRE = valeur × taux ÷ 12</p>
          </div>
          <div class="bg-slate-700/50 rounded-lg px-3 py-2">
            <p id="mile-preview" class="text-emerald-400 font-semibold text-sm">—</p>
          </div>
        </div>
        <div class="flex gap-3 mt-5">
          <button onclick="saveMilestone()" class="btn-primary flex-1">Enregistrer</button>
          <button onclick="closeMilestoneModal()" class="btn-secondary flex-1">Annuler</button>
        </div>
        <div id="mile-delete-row" class="hidden mt-2">
          <button onclick="deleteMilestoneFromModal()" class="w-full text-center text-red-400 hover:text-red-300 text-xs py-1.5 rounded hover:bg-slate-700 transition">
            🗑 Supprimer ce jalon
          </button>
        </div>
      </div>
    </div>`;
}

function deleteMilestoneFromModal() {
  if (!_mileEdit) return;
  if (!confirm('Supprimer ce jalon ?')) return;
  saveMilestones(loadMilestones().filter(m => m.id !== _mileEdit));
  closeMilestoneModal();
  setEl('milestone-section', milestoneGauge());
}

const EOY_KEY = 'eoy_forecast';
let _eoy = { rate: null, pmt: 0 };

function _eoyInit() {
  const saved = getUiPref(EOY_KEY, null);
  if (saved) _eoy = { ..._eoy, ...saved };
  if (_eoy.rate === null) _eoy.rate = estimateAnnualReturn();
}

function _eoySave() {
  persistUiPref(EOY_KEY, _eoy);
}

function eoyCalc() {
  _eoyInit();
  const { total, totalCharges } = globalStats();
  const pv  = Math.max(0, total - totalCharges);
  const now = new Date();
  const t   = 12 - (now.getMonth() + 1); // mois restants après le mois courant
  const r   = (_eoy.rate || 0) / 100 / 12;
  const pmt = _eoy.pmt || 0;
  const eoy = r === 0
    ? pv + pmt * t
    : pv * Math.pow(1 + r, t) + pmt * (Math.pow(1 + r, t) - 1) / r;
  return { pv, eoy: Math.round(eoy), gain: Math.round(eoy - pv), t };
}

function eoyCard() {
  const { pv, eoy, gain, t } = eoyCalc();
  const gainPct   = pv > 0 ? ((gain / pv) * 100).toFixed(1) : '0.0';
  const gainColor = gain >= 0 ? 'text-emerald-400' : 'text-red-400';
  const pmtLine   = _eoy.pmt > 0 ? ` · +${fmt(_eoy.pmt)}/mois` : '';
  return `
    <div class="bg-slate-800 rounded-xl p-5 cursor-pointer hover:bg-slate-750 transition" onclick="openEoyModal()">
      <div class="flex items-start justify-between">
        <div>
          <p class="text-slate-400 text-xs mb-1">Valeur estimée au 31 déc.</p>
          <p class="text-white text-2xl font-bold">${fmt(eoy)}</p>
          <p class="${gainColor} text-sm mt-1">${gain >= 0 ? '+' : ''}${fmt(gain)} <span class="text-xs">(${gain >= 0 ? '+' : ''}${gainPct}%)</span></p>
        </div>
        <div class="text-right flex-shrink-0 ml-4">
          <p class="text-slate-500 text-xs">${_eoy.rate}%/an${pmtLine}</p>
          <p class="text-slate-600 text-xs mt-0.5">${t} mois restants</p>
        </div>
      </div>
    </div>`;
}

function openEoyModal() {
  _eoyInit();
  document.getElementById('eoy-rate').value = _eoy.rate;
  document.getElementById('eoy-pmt').value  = _eoy.pmt;
  document.getElementById('modal-eoy').classList.remove('hidden');
  refreshEoyPreview();
}

function closeEoyModal() {
  document.getElementById('modal-eoy').classList.add('hidden');
}

function refreshEoyPreview() {
  const rate = parseFloat(document.getElementById('eoy-rate').value) || 0;
  const pmt  = parseFloat(String(document.getElementById('eoy-pmt').value).replace(',', '.')) || 0;
  const { total, totalCharges } = globalStats();
  const pv   = Math.max(0, total - totalCharges);
  const t    = 12 - (new Date().getMonth() + 1);
  const r    = rate / 100 / 12;
  const eoy  = r === 0 ? pv + pmt * t : pv * Math.pow(1 + r, t) + pmt * (Math.pow(1 + r, t) - 1) / r;
  const gain = eoy - pv;
  const el   = document.getElementById('eoy-preview');
  if (el) el.innerHTML = `${fmt(Math.round(eoy))} <span class="${gain >= 0 ? 'text-emerald-400' : 'text-red-400'} text-sm">(${gain >= 0 ? '+' : ''}${fmt(Math.round(gain))})</span>`;
}

function saveEoy() {
  _eoy.rate = parseFloat(document.getElementById('eoy-rate').value) || 0;
  _eoy.pmt  = parseFloat(String(document.getElementById('eoy-pmt').value).replace(',', '.')) || 0;
  _eoySave();
  closeEoyModal();
  setEl('eoy-card-wrapper', eoyCard());
}

function modalEoy() {
  return `
    <div id="modal-eoy" class="hidden fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onclick="if(event.target===this)closeEoyModal()">
      <div class="modal-box w-full max-w-sm">
        <h3 class="text-lg font-bold text-white mb-4">📅 Projection fin d'année</h3>
        <div class="space-y-4">
          <div>
            <label class="block text-slate-400 text-sm mb-1">Rendement annuel estimé (%)</label>
            <input id="eoy-rate" type="number" step="0.1" min="0" max="100" oninput="refreshEoyPreview()"
              class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
          <div>
            <label class="block text-slate-400 text-sm mb-1">Versements mensuels jusqu'en décembre (€)</label>
            <input id="eoy-pmt" type="number" step="100" min="0" oninput="refreshEoyPreview()"
              class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
          <div class="bg-slate-700/50 rounded-lg p-3">
            <p class="text-slate-400 text-xs mb-1">Projection calculée</p>
            <p id="eoy-preview" class="text-white font-bold text-lg">—</p>
          </div>
        </div>
        <div class="flex gap-3 mt-6">
          <button onclick="saveEoy()" class="btn-primary flex-1">Enregistrer</button>
          <button onclick="closeEoyModal()" class="btn-secondary flex-1">Annuler</button>
        </div>
      </div>
    </div>`;
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
        ? `<p class="text-amber-400 text-xl sm:text-2xl font-bold leading-tight break-all">
             ${fmt(cRetMensuel)}<span class="text-slate-500 text-sm font-normal">/mois</span>
           </p>
           <p class="text-slate-400 text-sm mt-1">
             ${fmt(cRetAnnuel)}<span class="text-slate-500">/an</span>
           </p>
           <p class="text-slate-600 text-xs mt-3">
             🔥 An ${cFireYear} <span class="text-slate-700">(${curYear + cFireYear})</span>
             · Objectif : ${fmt(_fp.depenses)}/mois
           </p>`
        : `<p class="text-slate-400 font-semibold">Non atteint sur ${_fp.duree} ans</p>
           <p class="text-slate-600 text-xs mt-1">↑ versements ou durée de simulation</p>`}
    </a>`;

  const dwzCard = `
    <a href="#fire" onclick="navigate('#fire');return false;"
      class="bg-slate-800 rounded-xl p-5 hover:bg-slate-750 transition cursor-pointer block">
      <div class="flex items-center gap-2 mb-3">
        <span class="text-xl leading-none">💀</span>
        <p class="text-slate-400 text-xs font-semibold uppercase tracking-wider">Die with Zero · ${_fp.dureeFire} ans</p>
      </div>
      ${dFireYear
        ? `<p class="text-orange-400 text-xl sm:text-2xl font-bold leading-tight break-all">
             ${fmt(dRetMensuel)}<span class="text-slate-500 text-sm font-normal">/mois</span>
           </p>
           <p class="text-slate-400 text-sm mt-1">
             ${fmt(dRetMensuel * 12)}<span class="text-slate-500">/an</span>
           </p>
           <p class="text-slate-600 text-xs mt-3">
             💀 An ${dFireYear} <span class="text-slate-700">(${curYear + dFireYear})</span>
             · Objectif : ${fmt(_fp.depenses)}/mois
           </p>`
        : `<p class="text-slate-400 font-semibold">Non atteint sur ${_fp.duree} ans</p>
           <p class="text-slate-600 text-xs mt-1">↑ versements ou durée de simulation</p>`}
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
      <p class="text-blue-400 text-xl sm:text-2xl font-bold leading-tight break-all">
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
  _vpwSim = null; _vpwSimCapital = null; // Reset pour forcer un nouveau calcul
  _scheduleVpwSim();
  app.innerHTML = `
    ${navbar()}
    <div class="max-w-screen-2xl mx-auto px-4 py-8">
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
          <div class="flex items-center justify-between mb-1">
            <label class="label !mb-0">Dépenses mensuelles en FIRE (€)</label>
            <button onclick="importExpAvgToFire()" class="text-xs text-emerald-400 hover:text-emerald-300 transition" title="Importer la moyenne des dépenses">📥 Importer moy.</button>
          </div>
          <input id="fp-dep-input" type="number" value="${_fp.depenses}" min="0" step="100" class="input"
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
  // Déclenche la simulation VPW avec debounce (évite de spammer à chaque frappe)
  _scheduleVpwSim();
}

// ─── VPW SIMULATOR (async) ────────────────────────────────────────────────────

let _vpwSim        = null;   // Dernier résultat de simulation VPW
let _vpwSimLoading = false;
let _vpwSimCapital = null;   // Dernier capital simulé (évite les doublons)
let _vpwSimTimer   = null;

function _scheduleVpwSim() {
  // La feuille simulatrice n'existe peut-être pas — on ne fait rien si pas de VPW réel
  if (!STATE.vpw || STATE.vpw.monthlyWithdrawal == null) return;
  clearTimeout(_vpwSimTimer);
  _vpwSimTimer = setTimeout(_doVpwSim, 900); // 900ms debounce
}

async function _doVpwSim() {
  const capital = _fp?.capital;
  if (!capital || capital <= 0) return;
  if (capital === _vpwSimCapital && _vpwSim) return; // même capital, résultat déjà en cache
  _vpwSimCapital = capital;
  _vpwSimLoading = true;
  setEl('fire-vpw-sim', _vpwSimCard());
  try {
    const result = await API.simulateVpw(capital);
    _vpwSim        = result;
    _vpwSimLoading = false;
    setEl('fire-vpw-sim', _vpwSimCard());
  } catch (e) {
    _vpwSimLoading = false;
    console.warn('simulateVpw error:', e.message);
    setEl('fire-vpw-sim', `
      <div class="bg-slate-800/60 rounded-xl p-4 border border-red-500/20">
        <p class="text-red-400 text-xs">⚠ Simulation VPW indisponible — vérifie que la feuille "VPW Retirement Simulator" existe dans Google Sheets.</p>
        <p class="text-slate-600 text-xs mt-1">${e.message}</p>
      </div>`);
  }
}

function _vpwSimCard() {
  if (!STATE.vpw || STATE.vpw.monthlyWithdrawal == null) return '';

  if (_vpwSimLoading) return `
    <div class="bg-slate-800 rounded-xl p-5 border border-purple-500/20 flex items-center gap-3">
      <span class="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin flex-shrink-0"></span>
      <div>
        <p class="text-slate-300 text-sm font-medium">Simulation VPW en cours…</p>
        <p class="text-slate-500 text-xs">Recalcul de "VPW Retirement Simulator" avec ${fmt(Math.round(_fp?.capital || 0))}</p>
      </div>
    </div>`;

  const v = _vpwSim;
  if (!v || v.monthlyWithdrawal == null) return '';

  const cible  = _fp?.depenses || 0;
  const retOk  = cible > 0 && v.monthlyWithdrawal >= cible;
  const hasStr = v.monthlyAfterLoss != null && v.monthlyAfterLoss > 0;
  // Comparaison avec le VPW réel
  const real   = STATE.vpw;
  const diff   = real?.monthlyWithdrawal ? v.monthlyWithdrawal - real.monthlyWithdrawal : null;

  return `
    <div class="bg-slate-800 rounded-xl p-5 border border-purple-500/25">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <span class="text-xl leading-none">🔮</span>
          <div>
            <p class="text-white text-sm font-semibold">VPW — Capital simulé</p>
            <p class="text-slate-500 text-xs">
              Basé sur <span class="text-purple-400">${fmt(Math.round(v.capital))}</span> dans "VPW Retirement Simulator"
              ${diff !== null ? `· <span class="${diff >= 0 ? 'text-emerald-400' : 'text-red-400'}">${diff >= 0 ? '+' : ''}${fmt(Math.round(diff))}/mois vs réel</span>` : ''}
            </p>
          </div>
        </div>
        ${v.vpwPct != null
          ? `<span class="bg-purple-500/15 text-purple-400 text-xs font-bold px-2.5 py-1 rounded-full">${v.vpwPct}% appliqué</span>`
          : ''}
      </div>

      <div class="grid grid-cols-2 ${hasStr ? 'sm:grid-cols-4' : 'sm:grid-cols-2'} gap-4">
        <div>
          <p class="text-slate-500 text-xs mb-1">Retrait mensuel suggéré</p>
          <p class="${retOk ? 'text-emerald-400' : 'text-purple-400'} text-xl font-bold">
            ${fmt(v.monthlyWithdrawal)}<span class="text-slate-500 text-sm font-normal">/mois</span>
          </p>
          ${cible > 0 ? `<p class="text-slate-600 text-xs mt-0.5">${retOk ? '✓ Objectif atteint' : `${fmt(Math.round(cible - v.monthlyWithdrawal))} sous l'objectif`}</p>` : ''}
        </div>
        <div>
          <p class="text-slate-500 text-xs mb-1">Retrait annuel</p>
          <p class="text-slate-300 text-xl font-bold">${fmt(v.annualWithdrawal ?? v.monthlyWithdrawal * 12)}</p>
          ${v.age != null ? `<p class="text-slate-600 text-xs mt-0.5">Âge : ${v.age} ans</p>` : ''}
        </div>
        ${hasStr ? `
        <div>
          <p class="text-slate-500 text-xs mb-1">Après correction marché</p>
          <p class="text-amber-400 text-xl font-bold">
            ${fmt(v.monthlyAfterLoss)}<span class="text-slate-500 text-sm font-normal">/mois</span>
          </p>
          ${v.monthlyReduction != null ? `<p class="text-red-400 text-xs mt-0.5">${fmt(v.monthlyReduction)}/mois</p>` : ''}
        </div>
        <div>
          <p class="text-slate-500 text-xs mb-1">Portfolio après perte</p>
          <p class="text-slate-300 font-semibold">${fmt(v.balanceAfterLoss)}</p>
          ${v.portfolioLoss != null ? `<p class="text-red-400 text-xs mt-0.5">${fmt(v.portfolioLoss)} simulé</p>` : ''}
        </div>` : ''}
      </div>
    </div>`;
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
    <div id="fire-vpw-sim">${_vpwSimCard()}</div>
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

// ─── DÉPENSES MENSUELLES ──────────────────────────────────────────────────────

const EXP_COLORS = {
  slate:   { bg: 'bg-slate-500/20',   text: 'text-slate-300',   dot: 'bg-slate-400'   },
  blue:    { bg: 'bg-blue-500/20',    text: 'text-blue-300',    dot: 'bg-blue-400'    },
  sky:     { bg: 'bg-sky-500/20',     text: 'text-sky-300',     dot: 'bg-sky-400'     },
  cyan:    { bg: 'bg-cyan-500/20',    text: 'text-cyan-300',    dot: 'bg-cyan-400'    },
  teal:    { bg: 'bg-teal-500/20',    text: 'text-teal-300',    dot: 'bg-teal-400'    },
  emerald: { bg: 'bg-emerald-500/20', text: 'text-emerald-300', dot: 'bg-emerald-400' },
  green:   { bg: 'bg-green-500/20',   text: 'text-green-300',   dot: 'bg-green-400'   },
  lime:    { bg: 'bg-lime-500/20',    text: 'text-lime-300',    dot: 'bg-lime-400'    },
  yellow:  { bg: 'bg-yellow-500/20',  text: 'text-yellow-300',  dot: 'bg-yellow-400'  },
  amber:   { bg: 'bg-amber-500/20',   text: 'text-amber-300',   dot: 'bg-amber-400'   },
  orange:  { bg: 'bg-orange-500/20',  text: 'text-orange-300',  dot: 'bg-orange-400'  },
  red:     { bg: 'bg-red-500/20',     text: 'text-red-300',     dot: 'bg-red-400'     },
  rose:    { bg: 'bg-rose-500/20',    text: 'text-rose-300',    dot: 'bg-rose-400'    },
  pink:    { bg: 'bg-pink-500/20',    text: 'text-pink-300',    dot: 'bg-pink-400'    },
  fuchsia: { bg: 'bg-fuchsia-500/20', text: 'text-fuchsia-300', dot: 'bg-fuchsia-400' },
  purple:  { bg: 'bg-purple-500/20',  text: 'text-purple-300',  dot: 'bg-purple-400'  },
  violet:  { bg: 'bg-violet-500/20',  text: 'text-violet-300',  dot: 'bg-violet-400'  },
  indigo:  { bg: 'bg-indigo-500/20',  text: 'text-indigo-300',  dot: 'bg-indigo-400'  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function setEl(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function expLookup() {
  const catMap   = Object.fromEntries(STATE.expense_categories.map(c => [c.id, c]));
  const itemMap  = Object.fromEntries(STATE.expense_items.map(i => [i.id, i]));
  const entryMap = {};
  const noteMap  = {};
  STATE.expense_entries.forEach(e => {
    const key = `${e.item_id}_${e.annee}_${e.mois}`;
    entryMap[key] = Number(e.montant);
    if (e.note) noteMap[key] = String(e.note);
  });
  return { catMap, itemMap, entryMap, noteMap };
}

function expMonthTotal(year, month) {
  return STATE.expense_entries
    .filter(e => Number(e.annee) === year && Number(e.mois) === month)
    .reduce((s, e) => s + Number(e.montant), 0);
}

function expGlobalMonthlyAvg(year) {
  const entries = STATE.expense_entries.filter(e => Number(e.annee) === year && Number(e.montant) > 0);
  if (!entries.length) return 0;
  const total          = entries.reduce((s, e) => s + Number(e.montant), 0);
  const monthsWithData = new Set(entries.map(e => Number(e.mois))).size;
  return total / monthsWithData;
}

function expTrackedMonthsCount(year) {
  return new Set(
    STATE.expense_entries
      .filter(e => Number(e.annee) === year && Number(e.montant) > 0)
      .map(e => Number(e.mois))
  ).size;
}

function expTypeAvg(year, type) {
  const catIds  = STATE.expense_categories.filter(c => c.type === type).map(c => c.id);
  const itemIds = STATE.expense_items.filter(i => catIds.includes(i.category_id)).map(i => i.id);
  const entries = STATE.expense_entries
    .filter(e => Number(e.annee) === year && itemIds.includes(e.item_id) && Number(e.montant) > 0);
  if (!entries.length) return 0;
  const total         = entries.reduce((s, e) => s + Number(e.montant), 0);
  const trackedMonths = expTrackedMonthsCount(year);
  return trackedMonths > 0 ? total / trackedMonths : 0;
}

function expTotalAids() {
  return STATE.expense_aids.reduce((s, a) => s + Number(a.montant), 0);
}

async function moveCat(catId, direction) {
  // Tri courant (même logique que expenseTable)
  const sorted = [...STATE.expense_categories].sort((a, b) => {
    const oa = (a.ordre !== undefined && a.ordre !== '') ? Number(a.ordre) : Infinity;
    const ob = (b.ordre !== undefined && b.ordre !== '') ? Number(b.ordre) : Infinity;
    return oa - ob;
  });
  const idx     = sorted.findIndex(c => c.id === catId);
  const swapIdx = idx + direction;
  if (idx < 0 || swapIdx < 0 || swapIdx >= sorted.length) return;

  // Réassigne des ordres propres 0..n puis échange les deux
  sorted.forEach((c, i) => { c.ordre = i; });
  sorted[idx].ordre     = swapIdx;
  sorted[swapIdx].ordre = idx;

  // Met à jour STATE (les objets sont des références)
  setEl('exp-table', expenseTable(_expYear));

  // Persistance silencieuse
  try {
    await API.reorderCategories({ items: sorted.map(c => ({ id: c.id, ordre: c.ordre })) });
  } catch (err) { console.error('Erreur réordonnancement catégories:', err); }
}

// ── Dashboard card ────────────────────────────────────────────────────────────

function expenseDashboardCard() {
  const year         = new Date().getFullYear();
  const avg          = expGlobalMonthlyAvg(year);
  const vitalAvg     = expTypeAvg(year, 'vital');
  const superAvg     = expTypeAvg(year, 'superflu');
  const currentMonth = new Date().getMonth() + 1;
  const currentTotal = expMonthTotal(year, currentMonth);

  if (!STATE.expense_categories.length) {
    return `
      <div class="bg-slate-800 rounded-xl p-5 text-center cursor-pointer hover:bg-slate-750 transition" onclick="navigate('#expenses')">
        <p class="text-slate-400 text-sm">Aucune dépense enregistrée</p>
        <p class="text-slate-500 text-xs mt-1">Cliquer pour configurer</p>
      </div>`;
  }

  const MONTHS   = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
  const totalAids = expTotalAids();
  const netAvg    = Math.max(0, avg - totalAids);
  return `
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div class="bg-slate-800 rounded-xl p-4 cursor-pointer hover:bg-slate-750 transition" onclick="navigate('#expenses')">
        <p class="text-slate-400 text-xs mb-1">${MONTHS[currentMonth - 1]} ${year}</p>
        <p class="text-white font-bold text-lg">${fmt(currentTotal)}</p>
      </div>
      <div class="bg-slate-800 rounded-xl p-4 cursor-pointer hover:bg-slate-750 transition" onclick="navigate('#expenses')">
        <p class="text-slate-400 text-xs mb-1">Moy. brute</p>
        <p class="text-white font-bold text-lg">${fmt(avg)}</p>
      </div>
      <div class="bg-slate-800 rounded-xl p-4 cursor-pointer hover:bg-slate-750 transition" onclick="navigate('#expenses')">
        <p class="text-slate-400 text-xs mb-1">Vital / mois</p>
        <p class="text-emerald-400 font-bold text-lg">${fmt(vitalAvg)}</p>
      </div>
      <div class="bg-slate-800 rounded-xl p-4 cursor-pointer hover:bg-slate-750 transition" onclick="navigate('#expenses')">
        <p class="text-slate-400 text-xs mb-1">Reste à financer${totalAids > 0 ? ' 🔥' : ''}</p>
        <p class="${totalAids > 0 ? 'text-amber-400' : 'text-white'} font-bold text-lg">${fmt(netAvg)}</p>
      </div>
    </div>`;
}

// ── Page principale ───────────────────────────────────────────────────────────

function renderExpenses(app) {
  _fpInit();
  app.innerHTML = `
    ${navbar()}
    <div class="max-w-screen-2xl mx-auto px-4 py-8 space-y-6" id="exp-page">
      ${expensesContent(_expYear)}
    </div>
    ${modalExpenseCategory()}
    ${modalExpenseItem()}
    ${modalExpenseAid()}
    ${modalExpenseCell()}`;
}

function refreshExpenses(year) {
  _expYear = Number(year);
  setEl('exp-page', expensesContent(_expYear));
}

function expensesContent(year) {
  const years = [...new Set([year, ...STATE.expense_entries.map(e => Number(e.annee))])].sort((a, b) => b - a);

  return `
    <div class="flex items-center justify-between flex-wrap gap-3">
      <h1 class="text-2xl font-bold text-white">💰 Dépenses</h1>
      <div class="flex items-center gap-2 flex-wrap">
        <select class="input text-sm py-1.5" onchange="refreshExpenses(+this.value)">
          ${years.map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}</option>`).join('')}
        </select>
        <button onclick="openExpenseCategoryModal()" class="btn-secondary text-sm">⚙ Catégories</button>
        <button onclick="openExpenseItemModal()" class="btn-primary text-sm">+ Poste</button>
        <button onclick="openExpenseAidModal()" class="btn-secondary text-sm">💳 Aides</button>
        <button onclick="importExpAvgToFire()" class="btn-secondary text-sm" title="Importer le reste à financer dans la simulation FIRE">🔥 → FIRE</button>
      </div>
    </div>
    <div id="exp-stats">${expenseStatsCards(year)}</div>
    <div id="exp-table">${expenseTable(year)}</div>`;
}

// ── Cartes de stats ───────────────────────────────────────────────────────────

function expenseStatsCards(year) {
  const MONTHS       = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
  const avg          = expGlobalMonthlyAvg(year);
  const vitalAvg     = expTypeAvg(year, 'vital');
  const superAvg     = expTypeAvg(year, 'superflu');
  const currentMonth = new Date().getMonth() + 1;
  const currentTotal = expMonthTotal(year, currentMonth);
  const totalAids    = expTotalAids();
  const netAvg       = Math.max(0, avg - totalAids);

  return `
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="bg-slate-800 rounded-xl p-4">
        <p class="text-slate-400 text-xs mb-1">${MONTHS[currentMonth - 1]} ${year}</p>
        <p class="text-white font-bold text-xl">${fmt(currentTotal)}</p>
        ${totalAids > 0 ? `<p class="text-slate-500 text-xs mt-1">Net : ${fmt(Math.max(0, currentTotal - totalAids))}</p>` : ''}
      </div>
      <div class="bg-slate-800 rounded-xl p-4">
        <p class="text-slate-400 text-xs mb-1">Moy. brute ${year}</p>
        <p class="text-white font-bold text-xl">${fmt(avg)}</p>
        <p class="text-slate-500 text-xs mt-1">${fmt(avg * 12)} / an</p>
      </div>
      <div class="bg-slate-800 rounded-xl p-4">
        <p class="text-slate-400 text-xs mb-1">Vital / mois</p>
        <p class="text-emerald-400 font-bold text-xl">${fmt(vitalAvg)}</p>
      </div>
      <div class="bg-slate-800 rounded-xl p-4 ${totalAids > 0 ? 'border border-amber-500/30' : ''}">
        <p class="text-slate-400 text-xs mb-1">Reste à financer / mois</p>
        <p class="${totalAids > 0 ? 'text-amber-400' : 'text-white'} font-bold text-xl">${fmt(netAvg)}</p>
        ${totalAids > 0 ? `<p class="text-slate-500 text-xs mt-1">Aides : −${fmt(totalAids)}</p>` : ''}
      </div>
    </div>`;
}

// ── Tableau mensuel ───────────────────────────────────────────────────────────

function expenseTable(year) {
  const { entryMap, noteMap } = expLookup();
  const MONTHS = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
  const cats   = [...STATE.expense_categories].sort((a, b) => {
    const oa = (a.ordre !== undefined && a.ordre !== '') ? Number(a.ordre) : Infinity;
    const ob = (b.ordre !== undefined && b.ordre !== '') ? Number(b.ordre) : Infinity;
    return oa - ob;
  });
  const items  = STATE.expense_items;

  if (!cats.length) {
    return `
      <div class="bg-slate-800 rounded-xl p-8 text-center">
        <p class="text-slate-400 mb-3">Aucune catégorie de dépense</p>
        <button onclick="openExpenseCategoryModal()" class="btn-primary text-sm">Créer une catégorie</button>
      </div>`;
  }

  // Totaux mensuels globaux + grand total
  const monthTotals       = MONTHS.map((_, mi) => expMonthTotal(year, mi + 1));
  const grandTotal        = monthTotals.reduce((a, b) => a + b, 0);
  const grandMonthsFilled = monthTotals.filter(v => v > 0).length;
  const grandAvg          = grandMonthsFilled > 0 ? grandTotal / grandMonthsFilled : 0;
  // Dénominateur commun pour toutes les moyennes cat/item : mois avec AU MOINS une dépense
  const trackedMonths     = expTrackedMonthsCount(year);

  const bodyRows = cats.map(cat => {
    const colors    = EXP_COLORS[cat.couleur] || EXP_COLORS.slate;
    const catItems  = items.filter(i => i.category_id === cat.id);
    const typeBadge = cat.type === 'vital'
      ? '<span class="px-1.5 py-0.5 rounded text-xs bg-emerald-500/20 text-emerald-400">vital</span>'
      : '<span class="px-1.5 py-0.5 rounded text-xs bg-amber-500/20 text-amber-400">superflux</span>';

    // Totaux mensuels de la catégorie
    const catMonths = MONTHS.map((_, mi) =>
      catItems.reduce((s, item) => s + (entryMap[`${item.id}_${year}_${mi + 1}`] || 0), 0)
    );
    const catTotal = catMonths.reduce((a, b) => a + b, 0);
    const catAvg   = trackedMonths > 0 ? catTotal / trackedMonths : 0;

    // Ligne header catégorie
    const catRow = `
      <tr class="border-t border-slate-600">
        <td class="py-2 px-3 sticky left-0 z-10 bg-slate-900 min-w-[260px] hover:bg-slate-800 transition">
          <div class="flex items-center justify-between gap-1">
            <div class="flex items-center gap-1.5 flex-wrap min-w-0 cursor-pointer" onclick="openExpenseCategoryModal('${cat.id}')">
              <span class="w-2.5 h-2.5 rounded-full ${colors.dot} flex-shrink-0"></span>
              <span class="font-semibold ${colors.text} text-sm">${esc(cat.nom)}</span>
              ${typeBadge}
            </div>
            <div class="flex flex-col flex-shrink-0 gap-0">
              <button onclick="event.stopPropagation();moveCat('${cat.id}',-1)" class="text-slate-600 hover:text-slate-300 transition leading-none px-1 py-0" title="Monter">▲</button>
              <button onclick="event.stopPropagation();moveCat('${cat.id}',1)"  class="text-slate-600 hover:text-slate-300 transition leading-none px-1 py-0" title="Descendre">▼</button>
            </div>
          </div>
        </td>
        <td class="py-2 px-3 text-right text-xs font-semibold border-r border-slate-600 ${colors.text}">${catAvg > 0 ? fmt(catAvg) : '—'}</td>
        ${catMonths.map(v => `<td class="py-2 px-2 text-right text-xs text-slate-400 font-medium">${v > 0 ? fmt(v) : ''}</td>`).join('')}
      </tr>`;

    // Lignes items
    const itemRows = catItems.map(item => {
      const cells = MONTHS.map((_, mi) => {
        const month   = mi + 1;
        const key     = `${item.id}_${year}_${month}`;
        const val     = entryMap[key] || 0;
        const note    = noteMap[key] || '';
        const dotHtml = note ? `<span class="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-sky-400/80 pointer-events-none"></span>` : '';
        const titleAttr = note ? ` title="${note.replace(/"/g, '&quot;').replace(/\n/g, ' ')}"` : '';
        return `<td class="py-1.5 px-2 text-right text-xs text-slate-300 cursor-pointer hover:bg-slate-700 transition select-none relative"
          onclick="openExpenseCellModal('${item.id}',${year},${month})"
          id="ecell-${item.id}-${year}-${month}"${titleAttr}>${val > 0 ? fmt(val) : ''}${dotHtml}</td>`;
      });
      const itemTotal = MONTHS.reduce((s, _, mi) => s + (entryMap[`${item.id}_${year}_${mi + 1}`] || 0), 0);
      const itemAvg   = trackedMonths > 0 ? itemTotal / trackedMonths : 0;

      return `
        <tr class="border-t border-slate-700/50 hover:bg-slate-800/40 transition">
          <td class="py-1.5 px-3 sticky left-0 bg-slate-900 cursor-pointer hover:bg-slate-800 transition"
            onclick="openExpenseItemModal('${item.id}')">
            <div class="pl-4">
              <span class="text-sm text-slate-300">${esc(item.nom)}</span>
            </div>
          </td>
          <td class="py-1.5 px-3 text-right text-xs font-medium border-r border-slate-600 text-slate-400">${itemAvg > 0 ? fmt(itemAvg) : '—'}</td>
          ${cells.join('')}
        </tr>`;
    }).join('');

    return catRow + itemRows;
  }).join('');

  // Ligne "Dont vital"
  const vitalCatIds    = STATE.expense_categories.filter(c => c.type === 'vital').map(c => c.id);
  const vitalItemIds   = STATE.expense_items.filter(i => vitalCatIds.includes(i.category_id)).map(i => i.id);
  const vitalMonths    = MONTHS.map((_, mi) =>
    STATE.expense_entries
      .filter(e => Number(e.annee) === year && Number(e.mois) === mi + 1 && vitalItemIds.includes(e.item_id))
      .reduce((s, e) => s + Number(e.montant), 0)
  );
  const vitalTotal        = vitalMonths.reduce((a, b) => a + b, 0);
  const vitalMonthsFilled = vitalMonths.filter(v => v > 0).length;
  const vitalAvgRow       = vitalMonthsFilled > 0 ? vitalTotal / vitalMonthsFilled : 0;

  // Aides
  const totalAids = expTotalAids();

  const totalRow = `
    <tr class="border-t-2 border-slate-500 bg-slate-800/60">
      <td class="py-2.5 px-3 sticky left-0 bg-slate-800 font-bold text-white text-sm">Total brut</td>
      <td class="py-2.5 px-3 text-right text-sm font-bold border-r border-slate-600 text-white">${fmt(grandAvg)}</td>
      ${monthTotals.map(v => `<td class="py-2.5 px-2 text-right text-xs font-bold text-white">${v > 0 ? fmt(v) : '—'}</td>`).join('')}
    </tr>
    <tr class="bg-slate-800/40">
      <td class="py-2 px-3 sticky left-0 bg-slate-800/40 text-emerald-400 text-xs pl-6">↳ dont vital</td>
      <td class="py-2 px-3 text-right text-xs border-r border-slate-600 text-emerald-400">${vitalAvgRow > 0 ? fmt(vitalAvgRow) : '—'}</td>
      ${vitalMonths.map(v => `<td class="py-2 px-2 text-right text-xs text-emerald-400/70">${v > 0 ? fmt(v) : ''}</td>`).join('')}
    </tr>
    ${totalAids > 0 ? `
    <tr class="bg-slate-800/30 border-t border-slate-700/50">
      <td class="py-2 px-3 sticky left-0 bg-slate-800/30 text-blue-400 text-xs font-medium cursor-pointer hover:bg-slate-700/40 transition"
        onclick="openExpenseAidModal()">
        Aides mensuelles
      </td>
      <td class="py-2 px-3 text-right text-xs font-medium border-r border-slate-600 text-blue-400">−${fmt(totalAids)}</td>
      ${MONTHS.map(() => `<td class="py-2 px-2 text-right text-xs text-blue-400">−${fmt(totalAids)}</td>`).join('')}
    </tr>
    <tr class="bg-amber-500/8 border-t border-amber-500/20">
      <td class="py-2.5 px-3 sticky left-0 bg-amber-500/8 font-bold text-amber-400 text-sm">Reste à financer</td>
      <td class="py-2.5 px-3 text-right text-sm font-bold border-r border-slate-600 text-amber-400">${fmt(Math.max(0, grandAvg - totalAids))}</td>
      ${monthTotals.map(v => {
        const net = v - totalAids;
        return `<td class="py-2.5 px-2 text-right text-xs font-bold ${net > 0 ? 'text-amber-400' : 'text-emerald-400'}">${v > 0 || totalAids > 0 ? fmt(Math.max(0, net)) : '—'}</td>`;
      }).join('')}
    </tr>
    <tr class="bg-amber-500/5">
      <td class="py-2 px-3 sticky left-0 bg-amber-500/5 text-amber-300/70 text-xs pl-6">↳ dont vital</td>
      <td class="py-2 px-3 text-right text-xs border-r border-slate-600 text-amber-300/70">${Math.max(0, vitalAvgRow - totalAids) > 0 ? fmt(Math.max(0, vitalAvgRow - totalAids)) : '—'}</td>
      ${vitalMonths.map(v => { const net = Math.max(0, v - totalAids); return `<td class="py-2 px-2 text-right text-xs text-amber-300/50">${net > 0 ? fmt(net) : ''}</td>`; }).join('')}
    </tr>` : ''}`;

  return `
    <div class="bg-slate-900 rounded-xl overflow-hidden">
      <div class="overflow-x-auto">
        <table class="text-sm" style="min-width:1320px;width:100%">
          <thead class="bg-slate-900 sticky top-0 z-20">
            <tr class="text-slate-400 text-xs border-b border-slate-700">
              <th class="py-3 px-3 text-left sticky left-0 bg-slate-900 font-medium min-w-[260px]">Poste</th>
              <th class="py-3 px-3 text-right font-medium whitespace-nowrap border-r border-slate-600">Moy./mois</th>
              ${MONTHS.map(m => `<th class="py-3 px-2 text-right font-medium w-20">${m}</th>`).join('')}
            </tr>
          </thead>
          <tbody>${bodyRows}${totalRow}</tbody>
        </table>
      </div>
    </div>`;
}

// ── Modal saisie dépense ──────────────────────────────────────────────────────

let _cellEdit = { itemId: null, year: null, month: null, currentVal: 0, currentNote: '', mode: 'add' };

const MONTH_NAMES_LONG = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

function openExpenseCellModal(itemId, year, month) {
  const entry = STATE.expense_entries.find(
    e => e.item_id === itemId && Number(e.annee) === year && Number(e.mois) === month
  );
  _cellEdit = {
    itemId, year, month,
    currentVal:  entry ? Number(entry.montant) : 0,
    currentNote: entry ? (entry.note || '') : '',
    mode: 'add',
  };
  const item = STATE.expense_items.find(i => i.id === itemId);
  document.getElementById('ecell-modal-title').textContent =
    `${item ? item.nom : '?'} — ${MONTH_NAMES_LONG[month - 1]} ${year}`;
  document.getElementById('ecell-current').textContent =
    _cellEdit.currentVal > 0 ? fmt(_cellEdit.currentVal) : '—';
  document.getElementById('ecell-amount').value = '';
  document.getElementById('ecell-note').value   = _cellEdit.currentNote;
  setEcellMode('add');
  document.getElementById('modal-expense-cell').classList.remove('hidden');
  setTimeout(() => document.getElementById('ecell-amount').focus(), 50);
}

function closeExpenseCellModal() {
  document.getElementById('modal-expense-cell').classList.add('hidden');
}

function setEcellMode(mode) {
  _cellEdit.mode = mode;
  document.getElementById('ecell-mode-add').className =
    `btn-${mode === 'add' ? 'primary' : 'secondary'} text-sm flex-1`;
  document.getElementById('ecell-mode-set').className =
    `btn-${mode === 'set' ? 'primary' : 'secondary'} text-sm flex-1`;
  refreshCellPreview();
}

function refreshCellPreview() {
  const added = parseFloat(String(document.getElementById('ecell-amount').value).replace(',', '.')) || 0;
  const total = _cellEdit.mode === 'add' ? _cellEdit.currentVal + added : added;
  const el    = document.getElementById('ecell-preview');
  if (el) el.textContent = fmt(Math.max(0, total));
}

async function saveExpenseCell() {
  const added = parseFloat(String(document.getElementById('ecell-amount').value).replace(',', '.')) || 0;
  const val   = Math.max(0, _cellEdit.mode === 'add' ? _cellEdit.currentVal + added : added);
  const note  = document.getElementById('ecell-note').value.trim();
  const { itemId, year, month } = _cellEdit;
  closeExpenseCellModal();

  // Mise à jour optimiste
  const idx = STATE.expense_entries.findIndex(
    e => e.item_id === itemId && Number(e.annee) === year && Number(e.mois) === month
  );
  if (val === 0 && !note) {
    if (idx !== -1) STATE.expense_entries.splice(idx, 1);
  } else if (idx !== -1) {
    STATE.expense_entries[idx].montant = val;
    STATE.expense_entries[idx].note    = note;
  } else {
    STATE.expense_entries.push({ id: `ee_${Date.now()}`, item_id: itemId, annee: year, mois: month, montant: val, note });
  }
  setEl('exp-stats', expenseStatsCards(year));
  setEl('exp-table', expenseTable(year));

  // Persistance
  try {
    if (val === 0 && !note) {
      await API.deleteExpenseEntry({ item_id: itemId, annee: year, mois: month });
    } else {
      await API.upsertExpenseEntry({ item_id: itemId, annee: year, mois: month, montant: val, note });
    }
    const cached = API._getCache();
    if (cached) { cached.expense_entries = STATE.expense_entries; API._setCache(cached); }
  } catch (err) { console.error('Erreur sauvegarde dépense:', err); }
}

async function clearExpenseCell() {
  const { itemId, year, month } = _cellEdit;
  closeExpenseCellModal();
  const idx = STATE.expense_entries.findIndex(
    e => e.item_id === itemId && Number(e.annee) === year && Number(e.mois) === month
  );
  if (idx !== -1) STATE.expense_entries.splice(idx, 1);
  setEl('exp-stats', expenseStatsCards(year));
  setEl('exp-table', expenseTable(year));
  try {
    await API.deleteExpenseEntry({ item_id: itemId, annee: year, mois: month });
    const cached = API._getCache();
    if (cached) { cached.expense_entries = STATE.expense_entries; API._setCache(cached); }
  } catch (err) { console.error('Erreur suppression dépense:', err); }
}

function modalExpenseCell() {
  return `
    <div id="modal-expense-cell" class="hidden fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onclick="if(event.target===this)closeExpenseCellModal()">
      <div class="modal-box w-full max-w-sm">
        <h3 id="ecell-modal-title" class="text-base font-bold text-white mb-1">—</h3>
        <p class="text-slate-400 text-sm mb-4">Montant actuel : <span id="ecell-current" class="text-white font-semibold">—</span></p>

        <div class="flex gap-2 mb-3">
          <button id="ecell-mode-add" onclick="setEcellMode('add')" class="btn-primary text-sm flex-1">+ Ajouter</button>
          <button id="ecell-mode-set" onclick="setEcellMode('set')" class="btn-secondary text-sm flex-1">= Définir</button>
        </div>

        <input id="ecell-amount" type="number" min="0" step="1" placeholder="Montant (€)"
          oninput="refreshCellPreview()"
          onkeydown="if(event.key==='Enter'){event.preventDefault();saveExpenseCell();}"
          class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3">

        <div class="bg-slate-700/40 rounded-lg px-3 py-2 mb-3 flex items-center justify-between">
          <span class="text-slate-400 text-xs">Total résultant</span>
          <span id="ecell-preview" class="text-white font-bold text-sm">—</span>
        </div>

        <textarea id="ecell-note" rows="2" placeholder="Note (optionnelle)…"
          class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none mb-4"></textarea>

        <div class="flex gap-2">
          <button onclick="saveExpenseCell()" class="btn-primary flex-1">Enregistrer</button>
          <button onclick="clearExpenseCell()" class="btn-secondary text-red-400 flex-1">Effacer</button>
          <button onclick="closeExpenseCellModal()" class="btn-secondary flex-1">Annuler</button>
        </div>
      </div>
    </div>`;
}

// ── Import moyenne → FIRE ─────────────────────────────────────────────────────

function importExpAvgToFire() {
  const grossAvg  = expGlobalMonthlyAvg(_expYear);
  const totalAids = expTotalAids();
  const netAvg    = Math.max(0, grossAvg - totalAids);
  if (!grossAvg && !totalAids) { alert('Aucune dépense enregistrée pour cette année.'); return; }
  _fpInit();
  _fp.depenses = Math.round(netAvg);
  const inp = document.getElementById('fp-dep-input');
  if (inp) inp.value = _fp.depenses;
  refreshFireResults();
  navigate('#fire');
}

// ── Modal Catégories ──────────────────────────────────────────────────────────

function _expColorDots(selected = 'slate') {
  return Object.entries(EXP_COLORS).map(([key, col]) => {
    const isSelected = key === selected;
    return `<button type="button" title="${key}"
      onclick="selectExpColor('${key}')"
      id="exp-color-dot-${key}"
      class="w-6 h-6 rounded-full ${col.dot} transition-all ${isSelected ? 'ring-2 ring-offset-2 ring-offset-slate-800 ring-white scale-110' : 'opacity-60 hover:opacity-100 hover:scale-105'}">
    </button>`;
  }).join('');
}

function selectExpColor(key) {
  document.getElementById('exp-cat-couleur').value = key;
  // Reset all dots then highlight selected
  Object.keys(EXP_COLORS).forEach(k => {
    const btn = document.getElementById(`exp-color-dot-${k}`);
    if (!btn) return;
    const col = EXP_COLORS[k];
    if (k === key) {
      btn.className = `w-6 h-6 rounded-full ${col.dot} transition-all ring-2 ring-offset-2 ring-offset-slate-800 ring-white scale-110`;
    } else {
      btn.className = `w-6 h-6 rounded-full ${col.dot} transition-all opacity-60 hover:opacity-100 hover:scale-105`;
    }
  });
}

function modalExpenseCategory() {
  return `
    <div id="modal-expense-cat" class="modal-backdrop hidden">
      <div class="modal-box">
        <h3 class="text-lg font-bold text-white mb-4" id="exp-cat-modal-title">Nouvelle catégorie</h3>
        <div class="space-y-3">
          <div>
            <label class="label">Nom</label>
            <input type="text" id="exp-cat-nom" class="input" placeholder="Loyer, Courses, Loisirs…" />
          </div>
          <div>
            <label class="label">Type</label>
            <select id="exp-cat-type" class="input">
              <option value="vital">Vital (minimum vital)</option>
              <option value="superflu">Superflux</option>
            </select>
          </div>
          <div>
            <label class="label">Couleur</label>
            <div id="exp-color-picker" class="flex flex-wrap gap-2 mt-1">
              ${_expColorDots('slate')}
            </div>
            <input type="hidden" id="exp-cat-couleur" value="slate" />
          </div>
          <input type="hidden" id="exp-cat-id" value="" />
        </div>
        <div class="flex gap-2 mt-5">
          <button onclick="saveExpenseCategory()" class="btn-primary flex-1">Enregistrer</button>
          <button onclick="closeModal('expense-cat')" class="btn-secondary flex-1">Annuler</button>
        </div>
        <div id="exp-cat-list" class="mt-5 space-y-1 max-h-64 overflow-y-auto pr-1"></div>
      </div>
    </div>`;
}

function openExpenseCategoryModal(editId) {
  document.getElementById('exp-cat-id').value = editId || '';
  let selectedColor = 'slate';
  if (editId) {
    const cat = STATE.expense_categories.find(c => c.id === editId);
    if (cat) {
      document.getElementById('exp-cat-modal-title').textContent = 'Modifier catégorie';
      document.getElementById('exp-cat-nom').value  = cat.nom;
      document.getElementById('exp-cat-type').value = cat.type;
      selectedColor = cat.couleur || 'slate';
    }
  } else {
    document.getElementById('exp-cat-modal-title').textContent = 'Nouvelle catégorie';
    document.getElementById('exp-cat-nom').value  = '';
    document.getElementById('exp-cat-type').value = 'vital';
  }
  // Re-render color picker avec la bonne sélection
  const picker = document.getElementById('exp-color-picker');
  if (picker) picker.innerHTML = _expColorDots(selectedColor);
  document.getElementById('exp-cat-couleur').value = selectedColor;
  // Liste des catégories existantes
  const listEl = document.getElementById('exp-cat-list');
  if (listEl) {
    listEl.innerHTML = STATE.expense_categories.length ? `
      <h4 class="text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">Catégories existantes</h4>
      ${STATE.expense_categories.map(c => {
        const col = EXP_COLORS[c.couleur] || EXP_COLORS.slate;
        return `<div class="flex items-center justify-between py-1.5 px-2 rounded hover:bg-slate-700 transition cursor-pointer"
          onclick="openExpenseCategoryModal('${c.id}')">
          <span class="flex items-center gap-2 text-sm">
            <span class="w-2 h-2 rounded-full ${col.dot}"></span>
            <span class="${col.text}">${esc(c.nom)}</span>
            <span class="text-slate-600 text-xs">${c.type}</span>
          </span>
          <button onclick="event.stopPropagation();confirmDeleteExpenseCat('${c.id}')" class="text-slate-500 hover:text-red-400 text-xs">✕</button>
        </div>`;
      }).join('')}` : '';
  }
  document.getElementById('modal-expense-cat').classList.remove('hidden');
}

async function saveExpenseCategory() {
  const id      = document.getElementById('exp-cat-id').value;
  const nom     = document.getElementById('exp-cat-nom').value.trim();
  const type    = document.getElementById('exp-cat-type').value;
  const couleur = document.getElementById('exp-cat-couleur').value;
  if (!nom) return;
  try {
    if (id) {
      await API.updateExpenseCategory({ id, nom, type, couleur });
      STATE.expense_categories = STATE.expense_categories.map(c => c.id === id ? { ...c, nom, type, couleur } : c);
    } else {
      const result = await API.createExpenseCategory({ nom, type, couleur });
      STATE.expense_categories.push(result);
    }
    const cached = API._getCache();
    if (cached) { cached.expense_categories = STATE.expense_categories; API._setCache(cached); }
    closeModal('expense-cat');
    refreshExpenses(_expYear);
  } catch (err) { alert('Erreur : ' + err.message); }
}

async function confirmDeleteExpenseCat(id) {
  if (!confirm('Supprimer cette catégorie et tous ses postes ?')) return;
  try {
    await API.deleteExpenseCategory(id);
    // Cascade côté front
    const itemIds = STATE.expense_items.filter(i => i.category_id === id).map(i => i.id);
    STATE.expense_categories = STATE.expense_categories.filter(c => c.id !== id);
    STATE.expense_items      = STATE.expense_items.filter(i => i.category_id !== id);
    STATE.expense_entries    = STATE.expense_entries.filter(e => !itemIds.includes(e.item_id));
    const cached = API._getCache();
    if (cached) {
      cached.expense_categories = STATE.expense_categories;
      cached.expense_items      = STATE.expense_items;
      cached.expense_entries    = STATE.expense_entries;
      API._setCache(cached);
    }
    closeModal('expense-cat');
    refreshExpenses(_expYear);
  } catch (err) { alert('Erreur : ' + err.message); }
}

// ── Modal Postes de dépense ───────────────────────────────────────────────────

function modalExpenseItem() {
  return `
    <div id="modal-expense-item" class="modal-backdrop hidden">
      <div class="modal-box">
        <h3 class="text-lg font-bold text-white mb-4" id="exp-item-modal-title">Nouveau poste</h3>
        <div class="space-y-3">
          <div>
            <label class="label">Nom du poste</label>
            <input type="text" id="exp-item-nom" class="input" placeholder="Électricité, Netflix, Courses…" />
          </div>
          <div>
            <label class="label">Catégorie</label>
            <select id="exp-item-cat" class="input"></select>
          </div>
          <input type="hidden" id="exp-item-id" value="" />
        </div>
        <div class="flex gap-2 mt-5">
          <button onclick="saveExpenseItem()" class="btn-primary flex-1">Enregistrer</button>
          <button onclick="closeModal('expense-item')" class="btn-secondary flex-1">Annuler</button>
        </div>
        <div id="exp-item-list" class="mt-5 space-y-1 max-h-64 overflow-y-auto pr-1"></div>
      </div>
    </div>`;
}

function openExpenseItemModal(editId) {
  // Rebuild options
  const sel = document.getElementById('exp-item-cat');
  if (sel) sel.innerHTML = STATE.expense_categories
    .map(c => `<option value="${c.id}">${esc(c.nom)}</option>`).join('');

  document.getElementById('exp-item-id').value = editId || '';
  if (editId) {
    const item = STATE.expense_items.find(i => i.id === editId);
    if (item) {
      document.getElementById('exp-item-modal-title').textContent = 'Modifier poste';
      document.getElementById('exp-item-nom').value = item.nom;
      if (sel) sel.value = item.category_id;
    }
  } else {
    document.getElementById('exp-item-modal-title').textContent = 'Nouveau poste';
    document.getElementById('exp-item-nom').value = '';
  }

  // Liste des postes existants
  const listEl = document.getElementById('exp-item-list');
  if (listEl) {
    listEl.innerHTML = STATE.expense_items.length ? `
      <h4 class="text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">Postes existants</h4>
      ${STATE.expense_items.map(item => {
        const cat = STATE.expense_categories.find(c => c.id === item.category_id);
        const col = EXP_COLORS[cat?.couleur] || EXP_COLORS.slate;
        return `<div class="flex items-center justify-between py-1.5 px-2 rounded hover:bg-slate-700 transition cursor-pointer"
          onclick="openExpenseItemModal('${item.id}')">
          <span class="text-sm text-slate-300">${esc(item.nom)}
            <span class="text-xs ${col.text} ml-1">${cat ? esc(cat.nom) : ''}</span>
          </span>
          <button onclick="event.stopPropagation();confirmDeleteExpenseItem('${item.id}')" class="text-slate-500 hover:text-red-400 text-xs">✕</button>
        </div>`;
      }).join('')}` : '';
  }
  document.getElementById('modal-expense-item').classList.remove('hidden');
}

async function saveExpenseItem() {
  const id          = document.getElementById('exp-item-id').value;
  const nom         = document.getElementById('exp-item-nom').value.trim();
  const category_id = document.getElementById('exp-item-cat').value;
  if (!nom || !category_id) return;
  try {
    if (id) {
      await API.updateExpenseItem({ id, nom, category_id });
      STATE.expense_items = STATE.expense_items.map(i => i.id === id ? { ...i, nom, category_id } : i);
    } else {
      const result = await API.createExpenseItem({ nom, category_id });
      STATE.expense_items.push(result);
    }
    const cached = API._getCache();
    if (cached) { cached.expense_items = STATE.expense_items; API._setCache(cached); }
    closeModal('expense-item');
    refreshExpenses(_expYear);
  } catch (err) { alert('Erreur : ' + err.message); }
}

async function confirmDeleteExpenseItem(id) {
  if (!confirm('Supprimer ce poste et toutes ses entrées ?')) return;
  try {
    await API.deleteExpenseItem(id);
    STATE.expense_items   = STATE.expense_items.filter(i => i.id !== id);
    STATE.expense_entries = STATE.expense_entries.filter(e => e.item_id !== id);
    const cached = API._getCache();
    if (cached) {
      cached.expense_items   = STATE.expense_items;
      cached.expense_entries = STATE.expense_entries;
      API._setCache(cached);
    }
    closeModal('expense-item');
    refreshExpenses(_expYear);
  } catch (err) { alert('Erreur : ' + err.message); }
}

// ── Modal Aides mensuelles ────────────────────────────────────────────────────

function modalExpenseAid() {
  return `
    <div id="modal-expense-aid" class="modal-backdrop hidden">
      <div class="modal-box">
        <h3 class="text-lg font-bold text-white mb-1">Aides mensuelles</h3>
        <p class="text-slate-400 text-xs mb-4">Revenus récurrents qui réduisent ton besoin FIRE (contribution conjoint, rente, etc.).</p>
        <div class="space-y-3">
          <div>
            <label class="label">Nom</label>
            <input type="text" id="exp-aid-nom" class="input" placeholder="Contribution épouse, Rente…" />
          </div>
          <div>
            <label class="label">Montant mensuel (€)</label>
            <input type="number" id="exp-aid-montant" class="input" min="0" step="50" placeholder="500" />
          </div>
          <input type="hidden" id="exp-aid-id" value="" />
        </div>
        <div class="flex gap-2 mt-5">
          <button onclick="saveExpenseAid()" class="btn-primary flex-1">Enregistrer</button>
          <button onclick="closeModal('expense-aid')" class="btn-secondary flex-1">Annuler</button>
        </div>
        <div id="exp-aid-list" class="mt-5 space-y-1 max-h-64 overflow-y-auto pr-1"></div>
      </div>
    </div>`;
}

function openExpenseAidModal(editId) {
  document.getElementById('exp-aid-id').value      = editId || '';
  document.getElementById('exp-aid-nom').value     = '';
  document.getElementById('exp-aid-montant').value = '';
  if (editId) {
    const aid = STATE.expense_aids.find(a => a.id === editId);
    if (aid) {
      document.getElementById('exp-aid-nom').value     = aid.nom;
      document.getElementById('exp-aid-montant').value = aid.montant;
    }
  }
  // Liste des aides existantes
  const listEl = document.getElementById('exp-aid-list');
  if (listEl) {
    const total = expTotalAids();
    listEl.innerHTML = STATE.expense_aids.length ? `
      <h4 class="text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">Aides enregistrées</h4>
      ${STATE.expense_aids.map(a => `
        <div class="flex items-center justify-between py-1.5 px-2 rounded hover:bg-slate-700 transition cursor-pointer"
          onclick="openExpenseAidModal('${a.id}')">
          <span class="text-sm text-slate-300">${esc(a.nom)}</span>
          <span class="flex items-center gap-3">
            <span class="text-blue-400 text-sm font-medium">${fmt(Number(a.montant))}/mois</span>
            <button onclick="event.stopPropagation();confirmDeleteExpenseAid('${a.id}')" class="text-slate-500 hover:text-red-400 text-xs">✕</button>
          </span>
        </div>`).join('')}
      <div class="mt-2 pt-2 border-t border-slate-700 flex justify-between text-xs">
        <span class="text-slate-500">Total aides</span>
        <span class="text-blue-400 font-semibold">${fmt(total)}/mois</span>
      </div>` : '<p class="text-slate-600 text-xs">Aucune aide enregistrée.</p>';
  }
  document.getElementById('modal-expense-aid').classList.remove('hidden');
}

async function saveExpenseAid() {
  const id      = document.getElementById('exp-aid-id').value;
  const nom     = document.getElementById('exp-aid-nom').value.trim();
  const montant = parseFloat(document.getElementById('exp-aid-montant').value) || 0;
  if (!nom || !montant) return;
  try {
    if (id) {
      await API.updateExpenseAid({ id, nom, montant });
      STATE.expense_aids = STATE.expense_aids.map(a => a.id === id ? { ...a, nom, montant } : a);
    } else {
      const result = await API.createExpenseAid({ nom, montant });
      STATE.expense_aids.push(result);
    }
    const cached = API._getCache();
    if (cached) { cached.expense_aids = STATE.expense_aids; API._setCache(cached); }
    closeModal('expense-aid');
    refreshExpenses(_expYear);
  } catch (err) { alert('Erreur : ' + err.message); }
}

async function confirmDeleteExpenseAid(id) {
  if (!confirm('Supprimer cette aide ?')) return;
  try {
    await API.deleteExpenseAid(id);
    STATE.expense_aids = STATE.expense_aids.filter(a => a.id !== id);
    const cached = API._getCache();
    if (cached) { cached.expense_aids = STATE.expense_aids; API._setCache(cached); }
    closeModal('expense-aid');
    refreshExpenses(_expYear);
  } catch (err) { alert('Erreur : ' + err.message); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RÉSIDENCES (principale / secondaire)
// ═══════════════════════════════════════════════════════════════════════════════

let _editingResidId = null;
let _residValeurId  = null;

// ── Calculs financiers ────────────────────────────────────────────────────────

function residMensualite(res) {
  const C  = Number(res.montant_credit || 0);
  const tm = Number(res.taux_credit    || 0) / 12;
  const n  = Number(res.duree_credit_mois || 0);
  if (!C || !n) return 0;
  if (tm === 0) return C / n;
  return (C * tm) / (1 - Math.pow(1 + tm, -n));
}

function residCapitalRestantDu(res, now = new Date()) {
  // Si l'utilisateur indique avoir déjà remboursé sa part → 0 restant
  if (res.credit_part_soldee == 1 || res.credit_part_soldee === true || res.credit_part_soldee === 'true') return 0;
  const C = Number(res.montant_credit || 0);
  const n = Number(res.duree_credit_mois || 0);
  if (!C || !n || !res.date_debut_credit) return C;
  const tm    = Number(res.taux_credit || 0) / 12;
  const start = new Date(res.date_debut_credit);
  const k     = Math.min(Math.max(0, (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth()), n);
  if (tm === 0) return C * (1 - k / n);
  return C * (Math.pow(1 + tm, n) - Math.pow(1 + tm, k)) / (Math.pow(1 + tm, n) - 1);
}

function residCapitalRembourse(res, now = new Date()) {
  const C = Number(res.montant_credit || 0);
  if (!C) return 0;
  // Si part soldée → 100% remboursé
  if (res.credit_part_soldee == 1 || res.credit_part_soldee === true || res.credit_part_soldee === 'true') return C;
  return Math.max(0, C - residCapitalRestantDu(res, now));
}

function residValeurRef(res) {
  // Valeur totale du bien (estimée ou prix d'achat par défaut)
  return Number(res.valeur_estimee || res.prix_achat || 0);
}

function residQP(res) {
  // Quote-part de détention (0–1), défaut 1 (100%)
  return Math.min(1, Math.max(0, Number(res.quote_part_pct ?? 100) / 100));
}

function residValeurPart(res) {
  // Valeur de l'actif correspondant à la part de l'utilisateur
  return residValeurRef(res) * residQP(res);
}

function residPrixAchatPart(res) {
  return Number(res.prix_achat || 0) * residQP(res);
}

function residPatrimoineNet(res, now = new Date()) {
  // Patrimoine net = valeur (part utilisateur) − capital restant dû (son propre crédit)
  return Math.max(0, residValeurPart(res) - residCapitalRestantDu(res, now));
}

function residPlusValue(res) {
  return residValeurPart(res) - residPrixAchatPart(res);
}

// ── Dashboard card ────────────────────────────────────────────────────────────

function residDashboardCard() {
  if (!STATE.residences?.length) return `
    <div class="bg-slate-800 rounded-xl p-5 text-center cursor-pointer hover:bg-slate-750 transition" onclick="navigate('#residences')">
      <p class="text-slate-400 text-sm">Aucune résidence enregistrée</p>
      <p class="text-slate-500 text-xs mt-1">Cliquer pour ajouter</p>
    </div>`;
  const now = new Date();
  let valEstimee = 0, dette = 0, remb = 0;
  STATE.residences.forEach(r => {
    valEstimee += residValeurPart(r);          // part utilisateur
    dette      += residCapitalRestantDu(r, now); // son propre crédit
    remb       += residCapitalRembourse(r, now);
  });
  const patriNet = valEstimee - dette;
  const principale = STATE.residences.find(r => r.type === 'principale');
  return `
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div class="bg-slate-800 rounded-xl p-4 cursor-pointer hover:bg-slate-750 transition" onclick="navigate('#residences')">
        <p class="text-slate-400 text-xs mb-1">Valeur estimée</p>
        <p class="text-white font-bold text-lg">${fmt(Math.round(valEstimee))}</p>
        <p class="text-slate-500 text-xs">${STATE.residences.length} bien${STATE.residences.length > 1 ? 's' : ''}${principale ? ' · ' + esc(principale.nom) : ''}</p>
      </div>
      <div class="bg-slate-800 rounded-xl p-4 cursor-pointer hover:bg-slate-750 transition" onclick="navigate('#residences')">
        <p class="text-slate-400 text-xs mb-1">Patrimoine net</p>
        <p class="text-emerald-400 font-bold text-lg">${fmt(Math.round(patriNet))}</p>
        <p class="text-slate-500 text-xs">Estimé − dette</p>
      </div>
      <div class="bg-slate-800 rounded-xl p-4 cursor-pointer hover:bg-slate-750 transition" onclick="navigate('#residences')">
        <p class="text-slate-400 text-xs mb-1">Capital remboursé</p>
        <p class="text-blue-400 font-bold text-lg">${fmt(Math.round(remb))}</p>
        <p class="text-slate-500 text-xs">Equity constituée</p>
      </div>
      <div class="bg-slate-800 rounded-xl p-4 cursor-pointer hover:bg-slate-750 transition" onclick="navigate('#residences')">
        <p class="text-slate-400 text-xs mb-1">Dette restante</p>
        <p class="${dette > 0 ? 'text-amber-400' : 'text-slate-400'} font-bold text-lg">${fmt(Math.round(dette))}</p>
        <p class="text-slate-500 text-xs">Capital restant dû</p>
      </div>
    </div>`;
}

// ── Vue liste ─────────────────────────────────────────────────────────────────

function renderResidences(app) {
  app.innerHTML = `
    ${navbar(`<a href="#dashboard" onclick="navigate('#dashboard');return false;" class="text-slate-400 hover:text-white text-sm">← Dashboard</a>`)}
    <div class="max-w-screen-2xl mx-auto px-4 py-8 space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold text-white">🏡 Mes Résidences</h1>
        <button onclick="openResidenceModal()" class="btn-primary text-sm">+ Ajouter</button>
      </div>
      ${STATE.residences?.length ? `
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          ${STATE.residences.map(r => residenceCard(r)).join('')}
        </div>` : `
        <div class="bg-slate-800 rounded-xl p-12 text-center">
          <p class="text-4xl mb-4">🏡</p>
          <p class="text-slate-300 text-lg font-medium mb-2">Aucune résidence</p>
          <p class="text-slate-500 text-sm mb-6">Ajoutez votre résidence principale ou secondaire pour suivre votre patrimoine immobilier personnel</p>
          <button onclick="openResidenceModal()" class="btn-primary">+ Ajouter une résidence</button>
        </div>`}
    </div>
    ${modalResidence()}
    ${modalResidenceValeur()}`;
}

function residenceCard(res) {
  const now    = new Date();
  const qp     = residQP(res);
  const val    = residValeurPart(res);           // part utilisateur
  const crd    = residCapitalRestantDu(res, now);
  const remb   = residCapitalRembourse(res, now);
  const net    = residPatrimoineNet(res, now);
  const pv     = residPlusValue(res);
  const hasCr  = Number(res.montant_credit || 0) > 0;
  const badge  = res.type === 'principale'
    ? '<span class="bg-violet-500/20 text-violet-300 text-xs font-semibold px-2 py-0.5 rounded-full">PRINCIPALE</span>'
    : '<span class="bg-slate-600/60 text-slate-300 text-xs font-semibold px-2 py-0.5 rounded-full">SECONDAIRE</span>';
  const qpBadge = qp < 1
    ? `<span class="bg-amber-500/20 text-amber-300 text-xs font-semibold px-2 py-0.5 rounded-full">${Math.round(qp * 100)}%</span>`
    : '';
  const pvColor = pv >= 0 ? 'text-emerald-400' : 'text-red-400';
  return `
    <div class="bg-slate-800 rounded-xl p-5 hover:bg-slate-750 transition cursor-pointer" onclick="navigate('#residences/${res.id}')">
      <div class="flex items-start justify-between mb-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2 mb-1">${badge}${qpBadge}</div>
          <h3 class="text-white font-semibold truncate">${esc(res.nom)}</h3>
          <p class="text-slate-400 text-xs mt-0.5">${res.surface_m2 ? res.surface_m2 + ' m²' : ''}${res.surface_m2 && res.prix_achat ? ' · ' : ''}${res.prix_achat ? fmt(Number(res.prix_achat)) + ' achat total' : ''}</p>
        </div>
        <span class="text-blue-400 text-xs ml-2 flex-shrink-0">Voir →</span>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <p class="text-slate-500 text-xs">Valeur ma part${qp < 1 ? ' (' + Math.round(qp * 100) + '%)' : ''}</p>
          <p class="text-white font-bold text-sm">${fmt(Math.round(val))}</p>
          ${res.date_valeur_estimee ? `<p class="text-slate-600 text-xs">MAJ ${fmtDate(res.date_valeur_estimee)}</p>` : ''}
        </div>
        <div>
          <p class="text-slate-500 text-xs">Patrimoine net</p>
          <p class="text-emerald-400 font-bold text-sm">${fmt(Math.round(net))}</p>
          ${!hasCr ? '<p class="text-slate-600 text-xs">Crédit soldé ✓</p>' : ''}
        </div>
        ${hasCr ? `
        <div>
          <p class="text-slate-500 text-xs">Capital remboursé</p>
          <p class="text-blue-400 font-bold text-sm">${fmt(Math.round(remb))}</p>
        </div>` : ''}
        <div>
          <p class="text-slate-500 text-xs">Plus-value latente</p>
          <p class="${pvColor} font-bold text-sm">${pv >= 0 ? '+' : ''}${fmt(Math.round(pv))}</p>
        </div>
      </div>
    </div>`;
}

// ── Vue détail ────────────────────────────────────────────────────────────────

function renderResidenceDetail(app, id) {
  const res = STATE.residences?.find(r => r.id === id);
  if (!res) { navigate('#residences'); return; }
  const hasCr = Number(res.montant_credit || 0) > 0;
  app.innerHTML = `
    ${navbar(`<a href="#residences" onclick="navigate('#residences');return false;" class="text-slate-400 hover:text-white text-sm">← Mes résidences</a>`)}
    <div class="max-w-screen-2xl mx-auto px-4 py-8 space-y-6">
      <div class="flex items-start justify-between gap-4">
        <div>
          <div class="flex items-center gap-2 mb-1">
            ${res.type === 'principale'
              ? '<span class="bg-violet-500/20 text-violet-300 text-xs font-semibold px-2 py-0.5 rounded-full">PRINCIPALE</span>'
              : '<span class="bg-slate-600/60 text-slate-300 text-xs font-semibold px-2 py-0.5 rounded-full">SECONDAIRE</span>'}
          </div>
          <h1 class="text-2xl font-bold text-white">${esc(res.nom)}</h1>
          <p class="text-slate-400 text-sm mt-0.5">${res.surface_m2 ? res.surface_m2 + ' m²' : ''} · Acheté ${fmt(Number(res.prix_achat || 0))}</p>
        </div>
        <div class="flex gap-2 flex-shrink-0">
          <button onclick="openResidValeurModal('${id}')" class="btn-secondary text-sm">📍 Valeur estimée</button>
          <button onclick="openResidenceModal('${id}')" class="btn-secondary text-sm">✏ Modifier</button>
          <button onclick="confirmDeleteResidence('${id}')" class="btn-secondary text-sm text-red-400">✕</button>
        </div>
      </div>
      ${residBloc1(res)}
      <div class="grid gap-6 lg:grid-cols-2">
        ${residBloc2(res)}
        ${hasCr ? residBloc3(res) : ''}
      </div>
    </div>
    ${modalResidence()}
    ${modalResidenceValeur()}`;
}

function residBloc1(res) {
  const mens  = residMensualite(res);
  const assur = Number(res.mensualite_assurance || 0);
  const hasCr = Number(res.montant_credit || 0) > 0;
  const qp    = residQP(res);
  const row   = (label, val) => `<div><p class="text-slate-500 text-xs">${label}</p><p class="text-white font-medium text-sm">${val}</p></div>`;
  return `
    <div class="bg-slate-800 rounded-xl p-5">
      <h2 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Caractéristiques</h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        ${row('Surface', res.surface_m2 ? res.surface_m2 + ' m²' : '—')}
        ${row('Ma quote-part', `<span class="${qp < 1 ? 'text-amber-400' : 'text-slate-300'} font-bold">${Math.round(qp * 100)}%</span>`)}
        ${row("Prix d'achat total", fmt(Number(res.prix_achat || 0)))}
        ${qp < 1 ? row("Prix d'achat ma part", fmt(Math.round(residPrixAchatPart(res)))) : ''}
        ${row('Valeur estimée totale', '<span class="text-emerald-400">' + fmt(Math.round(residValeurRef(res))) + '</span>')}
        ${qp < 1 ? row('Valeur estimée ma part', '<span class="text-emerald-400 font-bold">' + fmt(Math.round(residValeurPart(res))) + '</span>') : ''}
        ${row('Date estimation', res.date_valeur_estimee ? fmtDate(res.date_valeur_estimee) : '—')}
        ${hasCr ? `
        ${row('Mon crédit', fmt(Number(res.montant_credit)))}
        ${row('Durée crédit', res.duree_credit_mois + ' mois')}
        ${row('Taux annuel', (Number(res.taux_credit) * 100).toFixed(2) + '%')}
        ${row('Mensualité crédit', '<span class="text-amber-400">' + fmt(Math.round(mens)) + '/mois</span>')}
        ${assur > 0 ? row('Assurance', fmt(assur) + '/mois') : ''}
        ${row('Mensualité totale', '<span class="text-amber-400 font-bold">' + fmt(Math.round(mens + assur)) + '/mois</span>')}
        ${res.numero_pret ? row('N° prêt', esc(res.numero_pret)) : ''}
        ${res.date_debut_credit ? row('Début crédit', res.date_debut_credit) : ''}
        ${residCapitalRestantDu(res) === 0 ? row('Ma part', '<span class="text-emerald-400 font-bold">✓ Remboursée</span>') : ''}
        ` : `${row('Crédit', '<span class="text-emerald-400 font-bold">Soldé ✓</span>')}`}
      </div>
    </div>`;
}

function residBloc2(res) {
  const now    = new Date();
  const qp     = residQP(res);
  const valTot = residValeurRef(res);
  const valPart= residValeurPart(res);
  const pxPart = residPrixAchatPart(res);
  const crd    = residCapitalRestantDu(res, now);
  const remb   = residCapitalRembourse(res, now);
  const net    = residPatrimoineNet(res, now);
  const pv     = residPlusValue(res);
  const C      = Number(res.montant_credit || 0);
  const hasCr  = C > 0;
  const pct    = hasCr ? Math.round(remb / C * 100) : 100;
  const pvCol  = pv >= 0 ? 'text-emerald-400' : 'text-red-400';
  const row    = (label, val, cls = 'text-white') =>
    `<tr class="border-b border-slate-700/40"><td class="py-2.5 text-slate-300 text-sm">${label}</td><td class="py-2.5 text-right font-semibold ${cls}">${val}</td></tr>`;
  const isPartial = qp < 1;
  return `
    <div class="bg-slate-800 rounded-xl p-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Patrimoine</h2>
        ${isPartial ? `<span class="bg-amber-500/20 text-amber-300 text-xs font-semibold px-2 py-0.5 rounded-full">Ma part : ${Math.round(qp * 100)}%</span>` : ''}
      </div>
      <table class="w-full">
        <tbody>
          ${isPartial ? `
          ${row("Prix d'achat total", fmt(Number(res.prix_achat || 0)), 'text-slate-400')}
          ${row("Prix d'achat ma part", fmt(Math.round(pxPart)))}
          ${row('Valeur estimée totale', fmt(Math.round(valTot)), 'text-slate-400')}
          ${row('Valeur estimée ma part', fmt(Math.round(valPart)), 'text-emerald-400')}
          ` : `
          ${row("Prix d'achat", fmt(Number(res.prix_achat || 0)))}
          ${row('Valeur estimée', fmt(Math.round(valPart)), 'text-emerald-400')}
          `}
          ${row('Plus-value latente', (pv >= 0 ? '+' : '') + fmt(Math.round(pv)), pvCol)}
          ${hasCr ? `
          ${row('Mon crédit', fmt(C))}
          ${row('Capital remboursé', fmt(Math.round(remb)), 'text-blue-400')}
          ${row('Capital restant dû', fmt(Math.round(crd)), crd > 0 ? 'text-amber-400' : 'text-emerald-400')}
          ` : `${row('Crédit', '<span class="text-emerald-400">Soldé ✓</span>', 'text-emerald-400')}`}
          <tr class="border-t-2 border-slate-600">
            <td class="py-3 text-white font-semibold">Patrimoine net</td>
            <td class="py-3 text-right text-emerald-400 font-bold text-lg">${fmt(Math.round(net))}</td>
          </tr>
        </tbody>
      </table>
      <div class="mt-3">
        <div class="w-full bg-slate-700 rounded-full h-2.5">
          <div class="bg-blue-500 h-2.5 rounded-full transition-all" style="width:${pct}%"></div>
        </div>
        <p class="text-slate-500 text-xs mt-1.5 text-right">${hasCr ? pct + '% de mon crédit remboursé' : '100% — crédit soldé ✓'}</p>
      </div>
    </div>`;
}

function residBloc3(res) {
  const now   = new Date();
  const C     = Number(res.montant_credit || 0);
  const n     = Number(res.duree_credit_mois || 0);
  if (!C || !n) return '';
  const start = res.date_debut_credit ? new Date(res.date_debut_credit) : null;
  const k     = start ? Math.min(Math.max(0,
    (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth()), n) : 0;
  const restant = Math.max(0, n - k);
  let dateFin = null;
  if (start) {
    dateFin = new Date(start);
    dateFin.setMonth(dateFin.getMonth() + n);
  }
  const MOIS_FR = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
  const fmtDateFin = dateFin
    ? `${MOIS_FR[dateFin.getMonth()]} ${dateFin.getFullYear()}`
    : '—';
  return `
    <div class="bg-slate-800 rounded-xl p-5">
      <h2 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Crédit</h2>
      <div class="grid grid-cols-2 gap-4">
        ${res.numero_pret ? `<div><p class="text-slate-500 text-xs">N° prêt</p><p class="text-white text-sm font-medium">${esc(res.numero_pret)}</p></div>` : ''}
        <div><p class="text-slate-500 text-xs">Début</p><p class="text-white text-sm font-medium">${res.date_debut_credit || '—'}</p></div>
        <div><p class="text-slate-500 text-xs">Durée totale</p><p class="text-white text-sm font-medium">${n} mois (${Math.round(n / 12 * 10) / 10} ans)</p></div>
        <div><p class="text-slate-500 text-xs">Fin théorique</p><p class="text-white text-sm font-medium">${fmtDateFin}</p></div>
        <div><p class="text-slate-500 text-xs">Mensualités écoulées</p><p class="text-blue-400 text-sm font-bold">${k} / ${n}</p></div>
        <div><p class="text-slate-500 text-xs">Mensualités restantes</p><p class="${restant > 0 ? 'text-amber-400' : 'text-emerald-400'} text-sm font-bold">${restant}</p></div>
      </div>
      ${restant === 0 ? `
      <div class="mt-4 bg-emerald-900/30 border border-emerald-500/30 rounded-lg p-3 text-center">
        <p class="text-emerald-400 font-semibold text-sm">🎉 Crédit soldé !</p>
      </div>` : ''}
    </div>`;
}

// ── Modals ────────────────────────────────────────────────────────────────────

function modalResidence() {
  return `
    <div id="modal-residence" class="hidden fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onclick="if(event.target===this)closeResidenceModal()">
      <div class="modal-box w-full max-w-lg overflow-y-auto" style="max-height:90vh">
        <h3 id="resid-modal-title" class="text-lg font-bold text-white mb-5">Nouvelle résidence</h3>
        <div class="space-y-3">
          <div>
            <label class="block text-slate-400 text-xs mb-1">Nom *</label>
            <input id="res-nom" type="text" placeholder="Ex : Appartement Paris 11e"
              class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-slate-400 text-xs mb-1">Type *</label>
              <select id="res-type" class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="principale">Résidence principale</option>
                <option value="secondaire">Résidence secondaire</option>
              </select>
            </div>
            <div>
              <label class="block text-slate-400 text-xs mb-1">Ma quote-part (%)</label>
              <div class="flex items-center gap-2">
                <input id="res-qp" type="number" min="1" max="100" step="1" value="100"
                  oninput="document.getElementById('res-qp-lbl').textContent=this.value+'%'"
                  class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <span id="res-qp-lbl" class="text-amber-400 text-xs font-bold w-10 text-right flex-shrink-0">100%</span>
              </div>
              <p class="text-slate-600 text-xs mt-1">Si copropriété (ex : 50%)</p>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-slate-400 text-xs mb-1">Surface (m²)</label>
              <input id="res-surface" type="number" min="0" step="1"
                class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            <div>
              <label class="block text-slate-400 text-xs mb-1">Prix d'achat (€) *</label>
              <input id="res-prix" type="number" min="0" step="1000"
                class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-slate-400 text-xs mb-1">Valeur estimée (€)</label>
              <input id="res-valeur" type="number" min="0" step="1000"
                class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            <div>
              <label class="block text-slate-400 text-xs mb-1">Date estimation</label>
              <input id="res-date-valeur" type="date"
                class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
          </div>
          <hr class="border-slate-700">
          <p class="text-slate-500 text-xs font-medium uppercase tracking-wider">Crédit immobilier (optionnel)</p>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-slate-400 text-xs mb-1">Montant emprunté (€)</label>
              <input id="res-credit" type="number" min="0" step="1000" oninput="previewResidMens()"
                class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            <div>
              <label class="block text-slate-400 text-xs mb-1">Durée (mois)</label>
              <input id="res-duree" type="number" min="0" step="12" oninput="previewResidMens()"
                class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            <div>
              <label class="block text-slate-400 text-xs mb-1">Taux annuel (%)</label>
              <input id="res-taux" type="number" min="0" max="20" step="0.01" oninput="previewResidMens()"
                class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            <div>
              <label class="block text-slate-400 text-xs mb-1">Assurance (€/mois)</label>
              <input id="res-assur" type="number" min="0" step="1"
                class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
          </div>
          <div id="res-mens-preview" class="hidden bg-slate-700/50 rounded-lg p-3 flex items-center justify-between">
            <span class="text-slate-400 text-xs">Mensualité crédit calculée</span>
            <span id="res-mens-val" class="text-amber-400 font-semibold text-sm">—</span>
          </div>
          <label class="flex items-center gap-3 cursor-pointer bg-emerald-900/20 border border-emerald-500/25 rounded-lg px-3 py-2.5 hover:bg-emerald-900/30 transition">
            <input id="res-credit-solde" type="checkbox"
              class="w-4 h-4 rounded accent-emerald-500 cursor-pointer">
            <div>
              <p class="text-emerald-400 text-sm font-medium">J'ai déjà remboursé ma part du crédit</p>
              <p class="text-slate-500 text-xs">Capital restant dû = 0 · Barre de progression 100%</p>
            </div>
          </label>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-slate-400 text-xs mb-1">Numéro de prêt</label>
              <input id="res-numpret" type="text" placeholder="Ex : 12345678"
                class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            <div>
              <label class="block text-slate-400 text-xs mb-1">Date 1ère échéance</label>
              <input id="res-datecredit" type="date"
                class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
          </div>
        </div>
        <div class="flex gap-2 mt-5">
          <button onclick="saveResidence()" class="btn-primary flex-1">Enregistrer</button>
          <button onclick="closeResidenceModal()" class="btn-secondary flex-1">Annuler</button>
        </div>
        <div id="res-delete-row" class="hidden mt-2">
          <button onclick="confirmDeleteResidenceFromModal()" class="w-full text-center text-red-400 hover:text-red-300 text-xs py-1.5 rounded hover:bg-slate-700 transition">
            🗑 Supprimer cette résidence
          </button>
        </div>
      </div>
    </div>`;
}

function modalResidenceValeur() {
  return `
    <div id="modal-resid-valeur" class="hidden fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onclick="if(event.target===this)closeResidValeurModal()">
      <div class="modal-box w-full max-w-sm">
        <h3 id="resval-title" class="text-base font-bold text-white mb-4">📍 Mettre à jour la valeur estimée</h3>
        <div class="space-y-3">
          <div>
            <label class="block text-slate-400 text-xs mb-1">Valeur estimée du marché (€) *</label>
            <input id="resval-montant" type="number" min="0" step="1000"
              class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
          <div>
            <label class="block text-slate-400 text-xs mb-1">Date d'estimation</label>
            <input id="resval-date" type="date"
              class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
        </div>
        <div class="flex gap-3 mt-5">
          <button onclick="saveResidValeur()" class="btn-primary flex-1">Enregistrer</button>
          <button onclick="closeResidValeurModal()" class="btn-secondary flex-1">Annuler</button>
        </div>
      </div>
    </div>`;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

function openResidenceModal(id = null) {
  _editingResidId = id;
  const res = id ? STATE.residences?.find(r => r.id === id) : null;
  document.getElementById('resid-modal-title').textContent = res ? 'Modifier — ' + res.nom : 'Nouvelle résidence';
  const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = (val ?? ''); };
  set('res-nom',        res?.nom || '');
  set('res-type',       res?.type || 'principale');
  const qpVal = Math.round(Number(res?.quote_part_pct ?? 100));
  set('res-qp', qpVal);
  const qpLbl = document.getElementById('res-qp-lbl');
  if (qpLbl) qpLbl.textContent = qpVal + '%';
  set('res-surface',    res?.surface_m2 || '');
  set('res-prix',       res?.prix_achat || '');
  set('res-valeur',     res?.valeur_estimee || '');
  set('res-date-valeur',res?.date_valeur_estimee || '');
  set('res-credit',     res?.montant_credit || '');
  set('res-duree',      res?.duree_credit_mois || '');
  set('res-taux',       res ? (Number(res.taux_credit || 0) * 100).toFixed(2) : '');
  set('res-assur',      res?.mensualite_assurance || '');
  set('res-numpret',    res?.numero_pret || '');
  set('res-datecredit', res?.date_debut_credit || '');
  const soldEl = document.getElementById('res-credit-solde');
  if (soldEl) soldEl.checked = !!(res?.credit_part_soldee == 1 || res?.credit_part_soldee === true || res?.credit_part_soldee === 'true');
  document.getElementById('res-delete-row')?.classList.toggle('hidden', !id);
  previewResidMens();
  document.getElementById('modal-residence').classList.remove('hidden');
  setTimeout(() => document.getElementById('res-nom')?.focus(), 50);
}

function closeResidenceModal() {
  document.getElementById('modal-residence').classList.add('hidden');
  _editingResidId = null;
}

function previewResidMens() {
  const C  = parseFloat(document.getElementById('res-credit')?.value) || 0;
  const n  = parseFloat(document.getElementById('res-duree')?.value) || 0;
  const ta = parseFloat(document.getElementById('res-taux')?.value) || 0;
  const tm = ta / 100 / 12;
  const m  = C > 0 && n > 0 ? (tm === 0 ? C / n : (C * tm) / (1 - Math.pow(1 + tm, -n))) : 0;
  const prev = document.getElementById('res-mens-preview');
  const val  = document.getElementById('res-mens-val');
  if (prev && val) {
    if (C > 0 && n > 0) { prev.classList.remove('hidden'); val.textContent = fmt(Math.round(m)) + '/mois'; }
    else prev.classList.add('hidden');
  }
}

async function saveResidence() {
  const nom = document.getElementById('res-nom')?.value?.trim();
  if (!nom) { alert('Le nom est obligatoire.'); return; }
  const ta   = parseFloat(document.getElementById('res-taux')?.value) || 0;
  const data = {
    nom,
    type:                 document.getElementById('res-type')?.value || 'principale',
    quote_part_pct:       Math.min(100, Math.max(1, parseFloat(document.getElementById('res-qp')?.value) || 100)),
    surface_m2:           parseFloat(document.getElementById('res-surface')?.value) || 0,
    prix_achat:           parseFloat(document.getElementById('res-prix')?.value) || 0,
    valeur_estimee:       parseFloat(document.getElementById('res-valeur')?.value) || 0,
    date_valeur_estimee:  document.getElementById('res-date-valeur')?.value || '',
    montant_credit:       parseFloat(document.getElementById('res-credit')?.value) || 0,
    duree_credit_mois:    parseFloat(document.getElementById('res-duree')?.value) || 0,
    taux_credit:          ta / 100,
    mensualite_assurance: parseFloat(document.getElementById('res-assur')?.value) || 0,
    numero_pret:          document.getElementById('res-numpret')?.value?.trim() || '',
    date_debut_credit:    document.getElementById('res-datecredit')?.value || '',
    credit_part_soldee:   document.getElementById('res-credit-solde')?.checked ? 1 : 0,
  };
  // Capturer l'id AVANT closeResidenceModal qui le remet à null
  const editId = _editingResidId;

  // Avertissement si 2e résidence principale
  if (data.type === 'principale' && !editId) {
    const existing = STATE.residences?.find(r => r.type === 'principale');
    if (existing) {
      if (!confirm('⚠ Vous avez déjà une résidence principale (' + existing.nom + '). Continuer quand même ?')) return;
    }
  }
  closeResidenceModal();
  setGlobalLoader(true, editId ? 'Mise à jour…' : 'Enregistrement…');
  try {
    if (editId) {
      await API.updateResidence({ id: editId, ...data });
      const idx = STATE.residences.findIndex(r => r.id === editId);
      if (idx !== -1) STATE.residences[idx] = { ...STATE.residences[idx], ...data };
    } else {
      const result = await API.addResidence(data);
      if (!STATE.residences) STATE.residences = [];
      STATE.residences.push({ ...data, ...result });
      history.replaceState(null, '', '#residences');
    }
    API._setCache({ ...STATE });
    render();
  } catch (err) { alert('Erreur : ' + (err.message || err)); }
  finally { setGlobalLoader(false); }
}

async function confirmDeleteResidenceFromModal() {
  if (!_editingResidId) return;
  const res = STATE.residences?.find(r => r.id === _editingResidId);
  if (!confirm('Supprimer "' + (res?.nom || '') + '" ?')) return;
  const id = _editingResidId;
  closeResidenceModal();
  await _deleteResidenceById(id);
}

async function confirmDeleteResidence(id) {
  const res = STATE.residences?.find(r => r.id === id);
  if (!confirm('Supprimer "' + (res?.nom || '') + '" ?')) return;
  await _deleteResidenceById(id);
}

async function _deleteResidenceById(id) {
  setGlobalLoader(true, 'Suppression…');
  try {
    await API.deleteResidence(id);
    STATE.residences = STATE.residences.filter(r => r.id !== id);
    history.replaceState(null, '', '#residences');
    API._setCache({ ...STATE });
    render();
  } catch (err) { alert('Erreur : ' + err.message); }
  finally { setGlobalLoader(false); }
}

function openResidValeurModal(id) {
  _residValeurId = id;
  const res = STATE.residences?.find(r => r.id === id);
  if (!res) return;
  document.getElementById('resval-title').textContent = '📍 ' + esc(res.nom) + ' — Valeur estimée';
  document.getElementById('resval-montant').value = res.valeur_estimee || res.prix_achat || '';
  document.getElementById('resval-date').value    = new Date().toISOString().split('T')[0];
  document.getElementById('modal-resid-valeur').classList.remove('hidden');
  setTimeout(() => document.getElementById('resval-montant')?.focus(), 50);
}

function closeResidValeurModal() {
  document.getElementById('modal-resid-valeur').classList.add('hidden');
  _residValeurId = null;
}

async function saveResidValeur() {
  const montant = parseFloat(document.getElementById('resval-montant')?.value) || 0;
  const date    = document.getElementById('resval-date')?.value || '';
  if (!montant) { alert('La valeur estimée est obligatoire.'); return; }
  const id  = _residValeurId;
  const res = STATE.residences?.find(r => r.id === id);
  if (!res) return;
  closeResidValeurModal();
  setGlobalLoader(true, 'Mise à jour…');
  try {
    const updated = { ...res, valeur_estimee: montant, date_valeur_estimee: date };
    await API.updateResidence(updated);
    const idx = STATE.residences.findIndex(r => r.id === id);
    if (idx !== -1) STATE.residences[idx] = updated;
    API._setCache({ ...STATE });
    render();
  } catch (err) { alert('Erreur : ' + err.message); }
  finally { setGlobalLoader(false); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// IMMOBILIER LOCATIF
// ═══════════════════════════════════════════════════════════════════════════════

let _immoFilter      = { year: new Date().getFullYear(), type: '' };
let _immoGlobalYear  = new Date().getFullYear();
let _tvaFilter       = { year: new Date().getFullYear() };
let _loyerFreq       = 'mensuel'; // 'mensuel' | 'trimestriel' | 'personnalise'
let _editingBienId   = null;
let _editingDepId    = null;
let _depBienId       = null;
let _editingTvaId    = null;

// ── Calculs financiers ────────────────────────────────────────────────────────

function immoMensualite(bien) {
  const C  = Number(bien.montant_credit || 0);
  const tm = Number(bien.taux_credit || 0) / 12;
  const n  = Number(bien.duree_credit_mois || 0);
  if (!C || !n) return 0;
  if (tm === 0) return C / n;
  return (C * tm) / (1 - Math.pow(1 + tm, -n));
}

function immoCapitalRestantDu(bien, now = new Date()) {
  const C = Number(bien.montant_credit || 0);
  const n = Number(bien.duree_credit_mois || 0);
  if (!C || !n || !bien.date_debut_credit) return C;
  const tm    = Number(bien.taux_credit || 0) / 12;
  const start = new Date(bien.date_debut_credit);
  const k     = Math.min(Math.max(0, (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth()), n);
  if (tm === 0) return C * (1 - k / n);
  return C * (Math.pow(1 + tm, n) - Math.pow(1 + tm, k)) / (Math.pow(1 + tm, n) - 1);
}

function immoCapitalRembourse(bien, now = new Date()) {
  const C = Number(bien.montant_credit || 0);
  return C > 0 ? Math.max(0, C - immoCapitalRestantDu(bien, now)) : 0;
}

function immoRentabilite(bien) {
  const mens    = immoMensualite(bien);
  const assur   = Number(bien.mensualite_assurance || 0);
  const loyer   = Number(bien.loyer_annuel_ht || 0);
  const taxe    = Number(bien.taxe_fonciere || 0);
  const charges = Number(bien.charges_annuelles || 0);
  const prix    = Number(bien.prix_achat || 0);
  const creditAn  = (mens + assur) * 12;
  const cfAnnCred = loyer - taxe - charges - creditAn;
  const cfAnnPost = loyer - taxe - charges;
  return {
    mensCredit: mens, creditAn,
    rendBrut:       prix > 0 ? loyer / prix * 100 : 0,
    cfAnnCredit:    cfAnnCred,  cfMensCredit: cfAnnCred / 12,
    rendNetCredit:  prix > 0 ? cfAnnCred / prix * 100 : 0,
    cfAnnPost,      cfMensPost: cfAnnPost / 12,
    rendNetPost:    prix > 0 ? cfAnnPost / prix * 100 : 0,
  };
}

function immoLoyersHtYtd(bienId, year) {
  const yStart = new Date(year, 0, 1);
  const yEnd   = new Date(year, 11, 31, 23, 59, 59);
  // parseLocalDate : évite le décalage UTC en parsant yyyy-MM-dd comme date locale
  const parseLocalDate = s => { const p = String(s).split('T')[0].split('-'); return new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2])); };
  return STATE.depenses_immo
    .filter(d => d.bien_id === bienId && d.type === 'loyer' && d.periode_debut && d.periode_fin)
    .reduce((sum, d) => {
      const s = parseLocalDate(d.periode_debut), e = parseLocalDate(d.periode_fin);
      if (e < yStart || s > yEnd) return sum;
      const oS = s < yStart ? yStart : s, oE = e > yEnd ? yEnd : e;
      const tot = (e - s) / 86400000 + 1, ov = (oE - oS) / 86400000 + 1;
      return sum + Number(d.montant_ht || 0) * (ov / tot);
    }, 0);
}

function immoDepensesYtd(bienId, year) {
  return STATE.depenses_immo
    .filter(d => d.bien_id === bienId && d.type !== 'loyer' && d.date && new Date(d.date).getFullYear() === year)
    .reduce((s, d) => s + Number(d.montant_ttc || 0), 0);
}

// Mois avec au moins 1 loyer reçu (basé sur la période couverte, pas la date de paiement)
function immoLoyerTrackedMonths(bienId, year) {
  const months = new Set();
  const parseLD = s => { const p = String(s).split('T')[0].split('-'); return new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2])); };
  const yStart = new Date(year, 0, 1), yEnd = new Date(year, 11, 31, 23, 59, 59);
  STATE.depenses_immo
    .filter(d => d.bien_id === bienId && d.type === 'loyer' && d.periode_debut && d.periode_fin)
    .forEach(d => {
      const s = parseLD(d.periode_debut), e = parseLD(d.periode_fin);
      if (e < yStart || s > yEnd) return;
      // Compter chaque mois calendaire de l'année couvert par ce loyer
      let cur = new Date(Math.max(s, yStart));
      cur = new Date(cur.getFullYear(), cur.getMonth(), 1);
      const fin = new Date(Math.min(e, yEnd));
      while (cur <= fin) {
        if (cur.getFullYear() === year) months.add(cur.getMonth());
        cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      }
    });
  return months.size;
}

// Mois avec au moins 1 charge/échéance/assurance payée
function immoChargesTrackedMonths(bienId, year) {
  const months = new Set();
  STATE.depenses_immo
    .filter(d => d.bien_id === bienId && d.type !== 'loyer' && d.date)
    .forEach(d => {
      if (new Date(d.date).getFullYear() === year) months.add(new Date(d.date).getMonth());
    });
  return months.size;
}

function immoRentabiliteReelle(bienId, year) {
  const bien = STATE.biens_immo.find(b => b.id === bienId);
  if (!bien) return null;
  const loyersHt    = immoLoyersHtYtd(bienId, year);
  const depenses    = immoDepensesYtd(bienId, year);
  const taxe        = Number(bien.taxe_fonciere || 0);
  const prix        = Number(bien.prix_achat || 0);
  const moisLoyers  = immoLoyerTrackedMonths(bienId, year);
  const moisCharges = immoChargesTrackedMonths(bienId, year);
  const cfReel      = loyersHt - depenses - taxe;

  // Projection : chaque flux divisé par SES PROPRES mois déclarés → extrapolé sur 12
  let loyersAnn = 0, depAnn = 0, cfProjete = 0, rendProjete = 0;
  if (moisLoyers > 0)  loyersAnn = (loyersHt  / moisLoyers)  * 12;
  if (moisCharges > 0) depAnn    = (depenses   / moisCharges) * 12;
  if (moisLoyers > 0 || moisCharges > 0) {
    cfProjete   = loyersAnn - depAnn - taxe;
    rendProjete = prix > 0 ? cfProjete / prix * 100 : 0;
  }

  return { loyersHt, depenses, taxe, cfReel, moisLoyers, moisCharges, loyersAnn, depAnn, cfProjete, rendProjete };
}

// ── Dashboard card ────────────────────────────────────────────────────────────

// ── Vue globale consolidée ────────────────────────────────────────────────────

function immoGlobalStats(year) {
  const now = new Date();
  const parseLD = s => { const p = String(s).split('T')[0].split('-'); return new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2])); };

  // Patrimoine
  let brut = 0, crd = 0, loyerAnnHtTot = 0, taxeTot = 0;
  let cfAnnCredit = 0, cfAnnPost = 0;
  STATE.biens_immo.forEach(b => {
    brut          += Number(b.prix_achat || 0);
    crd           += immoCapitalRestantDu(b, now);
    loyerAnnHtTot += Number(b.loyer_annuel_ht || 0);
    taxeTot       += Number(b.taxe_fonciere || 0);
    const r = immoRentabilite(b);
    cfAnnCredit += r.cfAnnCredit;
    cfAnnPost   += r.cfAnnPost;
  });
  const equity        = brut - crd;
  const rendBrut      = brut > 0 ? loyerAnnHtTot / brut * 100 : 0;
  const rendNetCredit = brut > 0 ? cfAnnCredit / brut * 100 : 0;
  const rendNetPost   = brut > 0 ? cfAnnPost   / brut * 100 : 0;
  const pctRemb       = brut > 0 ? Math.round(equity / brut * 100) : 0; // equity = capital remboursé uniquement si brut = montant crédit

  // Réel global — on agrège tous les biens
  let loyersHtTot = 0, depTot = 0;
  STATE.biens_immo.forEach(b => {
    loyersHtTot += immoLoyersHtYtd(b.id, year);
    depTot      += immoDepensesYtd(b.id, year);
  });
  const cfReelTot = loyersHtTot - depTot - taxeTot;

  // Mois loyers globaux (union des mois couverts par n'importe quel bien)
  const moisLoyerSet = new Set();
  const yStart = new Date(year, 0, 1), yEnd = new Date(year, 11, 31, 23, 59, 59);
  STATE.depenses_immo
    .filter(d => d.type === 'loyer' && d.bien_id !== '__tva__' && d.periode_debut && d.periode_fin)
    .forEach(d => {
      const s = parseLD(d.periode_debut), e = parseLD(d.periode_fin);
      if (e < yStart || s > yEnd) return;
      let cur = new Date(Math.max(s, yStart));
      cur = new Date(cur.getFullYear(), cur.getMonth(), 1);
      const fin = new Date(Math.min(e, yEnd));
      while (cur <= fin) { if (cur.getFullYear() === year) moisLoyerSet.add(cur.getMonth()); cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1); }
    });
  const moisLoyers = moisLoyerSet.size;

  // Mois charges globaux
  const moisChargeSet = new Set();
  STATE.depenses_immo
    .filter(d => d.type !== 'loyer' && d.bien_id !== '__tva__' && d.date)
    .forEach(d => { if (new Date(d.date).getFullYear() === year) moisChargeSet.add(new Date(d.date).getMonth()); });
  const moisCharges = moisChargeSet.size;

  let loyersAnn = 0, depAnn = 0, cfProjete = 0, rendProjete = 0;
  if (moisLoyers  > 0) loyersAnn = (loyersHtTot / moisLoyers)  * 12;
  if (moisCharges > 0) depAnn    = (depTot      / moisCharges) * 12;
  if (moisLoyers > 0 || moisCharges > 0) {
    cfProjete   = loyersAnn - depAnn - taxeTot;
    rendProjete = brut > 0 ? cfProjete / brut * 100 : 0;
  }

  return {
    brut, crd, equity, pctRemb,
    rendBrut, rendNetCredit, rendNetPost, cfAnnCredit, cfAnnPost,
    loyersHtTot, depTot, taxeTot, cfReelTot,
    moisLoyers, moisCharges, loyersAnn, depAnn, cfProjete, rendProjete,
    nbBiens: STATE.biens_immo.length,
  };
}

function immoGlobalBloc() {
  if (!STATE.biens_immo.length) return '';
  const year = _immoGlobalYear;
  const g    = immoGlobalStats(year);
  const cc   = v => v >= 0 ? 'text-emerald-400' : 'text-red-400';
  const fmtC = v => (v >= 0 ? '+' : '') + fmt(Math.round(v));
  const fmtP = v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  const yBtns = [year - 1, year, year + 1].map(y =>
    `<button onclick="_immoGlobalYear=${y};setEl('immo-global-bloc',immoGlobalBloc())"
      class="px-2 py-1 rounded text-xs ${y === year ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}">${y}</button>`).join('');
  const hasCr = g.crd > 0;

  return `
  <div id="immo-global-bloc" class="space-y-4">

    <!-- Patrimoine -->
    <div class="bg-slate-800 rounded-xl p-5">
      <h2 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">🏦 Patrimoine immobilier · ${g.nbBiens} bien${g.nbBiens > 1 ? 's' : ''}</h2>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        <div>
          <p class="text-slate-500 text-xs mb-1">Valeur brute</p>
          <p class="text-white font-bold text-lg">${fmt(g.brut)}</p>
          <p class="text-slate-600 text-xs">Prix d'achat total</p>
        </div>
        <div>
          <p class="text-slate-500 text-xs mb-1">Capital remboursé</p>
          <p class="text-emerald-400 font-bold text-lg">${fmt(Math.round(g.equity))}</p>
          <p class="text-slate-600 text-xs">Equity constituée</p>
        </div>
        <div>
          <p class="text-slate-500 text-xs mb-1">Capital restant dû</p>
          <p class="${hasCr ? 'text-amber-400' : 'text-slate-400'} font-bold text-lg">${fmt(Math.round(g.crd))}</p>
          <p class="text-slate-600 text-xs">Engagement crédit</p>
        </div>
        <div>
          <p class="text-slate-500 text-xs mb-1">Valeur nette</p>
          <p class="text-white font-bold text-lg">${fmt(Math.round(g.brut - g.crd))}</p>
          <p class="text-slate-600 text-xs">Brut − restant dû</p>
        </div>
      </div>
      ${hasCr ? `
      <div class="w-full bg-slate-700 rounded-full h-2">
        <div class="bg-emerald-500 h-2 rounded-full transition-all" style="width:${Math.min(g.pctRemb, 100)}%"></div>
      </div>
      <p class="text-slate-500 text-xs mt-1.5 text-right">${g.pctRemb}% du capital remboursé</p>` : ''}
    </div>

    <!-- Rentabilité théorique + réelle côte à côte -->
    <div class="grid gap-4 lg:grid-cols-2">

      <!-- Théorique -->
      <div class="bg-slate-800 rounded-xl p-5">
        <h2 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">📈 Rentabilité théorique</h2>
        <table class="w-full text-sm">
          <thead class="text-slate-500 text-xs border-b border-slate-700">
            <tr>
              <th class="text-left py-2 font-medium">Indicateur</th>
              ${hasCr ? '<th class="text-right py-2 font-medium">Pendant crédit</th>' : ''}
              <th class="text-right py-2 font-medium">Post crédit</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-700/40">
            <tr>
              <td class="py-2.5 text-slate-300">Rendement brut</td>
              ${hasCr ? `<td class="py-2.5 text-right text-emerald-400">${g.rendBrut.toFixed(2)}%</td>` : ''}
              <td class="py-2.5 text-right text-emerald-400">${g.rendBrut.toFixed(2)}%</td>
            </tr>
            <tr>
              <td class="py-2.5 text-slate-300">Rendement net</td>
              ${hasCr ? `<td class="py-2.5 text-right font-semibold ${cc(g.rendNetCredit)}">${fmtP(g.rendNetCredit)}</td>` : ''}
              <td class="py-2.5 text-right font-semibold ${cc(g.rendNetPost)}">${fmtP(g.rendNetPost)}</td>
            </tr>
            <tr>
              <td class="py-2.5 text-slate-300">Cashflow annuel</td>
              ${hasCr ? `<td class="py-2.5 text-right ${cc(g.cfAnnCredit)}">${fmtC(g.cfAnnCredit)}</td>` : ''}
              <td class="py-2.5 text-right ${cc(g.cfAnnPost)}">${fmtC(g.cfAnnPost)}</td>
            </tr>
            <tr>
              <td class="py-2.5 text-slate-300">Cashflow mensuel</td>
              ${hasCr ? `<td class="py-2.5 text-right font-semibold ${cc(g.cfAnnCredit / 12)}">${fmtC(g.cfAnnCredit / 12)}/mois</td>` : ''}
              <td class="py-2.5 text-right font-semibold ${cc(g.cfAnnPost / 12)}">${fmtC(g.cfAnnPost / 12)}/mois</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Réel -->
      <div class="bg-slate-800 rounded-xl p-5">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xs font-semibold text-slate-400 uppercase tracking-wider">📊 Réel ${year}</h2>
          <div class="flex gap-1">${yBtns}</div>
        </div>
        ${(g.moisLoyers === 0 && g.moisCharges === 0) ? `
          <p class="text-slate-500 text-sm py-6 text-center">Aucune donnée saisie pour ${year}</p>` : `
        <div class="grid grid-cols-2 gap-3">
          <div class="bg-slate-700/40 rounded-lg p-3">
            <p class="text-slate-400 text-xs mb-1">Loyers HT perçus</p>
            <p class="text-emerald-400 font-bold">${fmt(Math.round(g.loyersHtTot))}</p>
            <p class="text-slate-600 text-xs">${g.moisLoyers} loyer${g.moisLoyers > 1 ? 's' : ''} saisi${g.moisLoyers > 1 ? 's' : ''}</p>
          </div>
          <div class="bg-slate-700/40 rounded-lg p-3">
            <p class="text-slate-400 text-xs mb-1">Dépenses + TF</p>
            <p class="text-red-400 font-bold">−${fmt(Math.round(g.depTot + g.taxeTot))}</p>
            <p class="text-slate-600 text-xs">${g.moisCharges} mois · TF ${fmt(g.taxeTot)}</p>
          </div>
          <div class="bg-slate-700/40 rounded-lg p-3">
            <p class="text-slate-400 text-xs mb-1">Cashflow réel YTD</p>
            <p class="${cc(g.cfReelTot)} font-bold">${fmtC(Math.round(g.cfReelTot))}</p>
            <p class="text-slate-500 text-xs mt-0.5">${g.moisLoyers > 0 && g.moisCharges > 0 ? fmtC(Math.round(g.cfReelTot / Math.max(g.moisLoyers, g.moisCharges))) + '/mois moy.' : 'données partielles'}</p>
          </div>
          <div class="bg-slate-700/40 rounded-lg p-3 ${g.moisLoyers !== g.moisCharges ? 'border border-blue-500/30' : ''}">
            <p class="text-slate-400 text-xs mb-1">Cashflow projeté</p>
            <p class="${cc(g.cfProjete)} font-bold">${fmtC(Math.round(g.cfProjete / 12))}/mois</p>
            <p class="text-slate-500 text-xs mt-0.5">${fmtC(Math.round(g.cfProjete))}/an · ${g.rendProjete.toFixed(2)}%</p>
            ${g.moisLoyers !== g.moisCharges ? `
            <div class="mt-1.5 pt-1.5 border-t border-slate-600/50 space-y-0.5">
              <p class="text-slate-600 text-xs">↑ ${fmtC(Math.round(g.loyersAnn / 12))}/mois loyers (${g.moisLoyers}m)</p>
              <p class="text-slate-600 text-xs">↓ ${fmt(Math.round(g.depAnn / 12))}/mois charges (${g.moisCharges}m)</p>
            </div>` : ''}
          </div>
        </div>`}
      </div>
    </div>
  </div>`;
}

function immoDashboardCard() {
  if (!STATE.biens_immo.length) return `
    <div class="bg-slate-800 rounded-xl p-5 text-center cursor-pointer hover:bg-slate-750 transition" onclick="navigate('#immo')">
      <p class="text-slate-400 text-sm">Aucun bien immobilier enregistré</p>
      <p class="text-slate-500 text-xs mt-1">Cliquer pour ajouter</p>
    </div>`;
  const now = new Date();
  let brute = 0, crd = 0, cf = 0;
  STATE.biens_immo.forEach(b => {
    brute += Number(b.prix_achat || 0);
    crd   += immoCapitalRestantDu(b, now);
    cf    += immoRentabilite(b).cfMensCredit;
  });
  const equity = brute - crd;
  const cfCol  = cf >= 0 ? 'text-emerald-400' : 'text-red-400';
  return `
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div class="bg-slate-800 rounded-xl p-4 cursor-pointer hover:bg-slate-750 transition" onclick="navigate('#immo')">
        <p class="text-slate-400 text-xs mb-1">Valeur brute</p>
        <p class="text-white font-bold text-lg">${fmt(brute)}</p>
        <p class="text-slate-500 text-xs">${STATE.biens_immo.length} bien${STATE.biens_immo.length > 1 ? 's' : ''}</p>
      </div>
      <div class="bg-slate-800 rounded-xl p-4 cursor-pointer hover:bg-slate-750 transition" onclick="navigate('#immo')">
        <p class="text-slate-400 text-xs mb-1">Equity</p>
        <p class="text-emerald-400 font-bold text-lg">${fmt(equity)}</p>
        <p class="text-slate-500 text-xs">Capital remboursé</p>
      </div>
      <div class="bg-slate-800 rounded-xl p-4 cursor-pointer hover:bg-slate-750 transition" onclick="navigate('#immo')">
        <p class="text-slate-400 text-xs mb-1">Engagement crédit</p>
        <p class="text-amber-400 font-bold text-lg">${fmt(crd)}</p>
        <p class="text-slate-500 text-xs">Restant dû total</p>
      </div>
      <div class="bg-slate-800 rounded-xl p-4 cursor-pointer hover:bg-slate-750 transition" onclick="navigate('#immo')">
        <p class="text-slate-400 text-xs mb-1">Cashflow / mois</p>
        <p class="${cfCol} font-bold text-lg">${cf >= 0 ? '+' : ''}${fmt(cf)}</p>
        <p class="text-slate-500 text-xs">Théorique (crédit)</p>
      </div>
    </div>`;
}

// ── Vue liste ─────────────────────────────────────────────────────────────────

function renderImmo(app) {
  app.innerHTML = `
    ${navbar(`<a href="#dashboard" onclick="navigate('#dashboard');return false;" class="text-slate-400 hover:text-white text-sm">← Dashboard</a>`)}
    <div class="max-w-screen-2xl mx-auto px-4 py-8 space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold text-white">🏠 Immobilier Locatif</h1>
        <button onclick="openBienImmoModal()" class="btn-primary text-sm">+ Ajouter un bien</button>
      </div>

      ${STATE.biens_immo.length ? `
        ${immoGlobalBloc()}

        <div>
          <h2 class="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Mes biens</h2>
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            ${STATE.biens_immo.map(b => bienImmoCard(b)).join('')}
          </div>
        </div>` : `
        <div class="bg-slate-800 rounded-xl p-12 text-center">
          <p class="text-4xl mb-4">🏠</p>
          <p class="text-slate-300 text-lg font-medium mb-2">Aucun bien immobilier</p>
          <p class="text-slate-500 text-sm mb-6">Ajoutez votre premier bien pour démarrer le suivi de rentabilité</p>
          <button onclick="openBienImmoModal()" class="btn-primary">+ Ajouter un bien</button>
        </div>`}

      <div id="immo-tva-bloc">${immoTvaBloc()}</div>
    </div>
    ${modalBienImmo()}
    ${modalTvaVersement()}`;
}

function bienImmoCard(bien) {
  const r    = immoRentabilite(bien);
  const cap  = immoCapitalRembourse(bien);
  const prix = Number(bien.prix_achat || 0);
  const surf = Number(bien.surface_m2 || 0);
  const hasCr = Number(bien.montant_credit || 0) > 0;
  const cfCol = r.cfMensCredit >= 0 ? 'text-emerald-400' : 'text-red-400';
  const rdCol = r.rendNetCredit >= 0 ? 'text-emerald-400' : 'text-red-400';
  return `
    <div class="bg-slate-800 rounded-xl p-5 hover:bg-slate-750 transition cursor-pointer" onclick="navigate('#immo/${bien.id}')">
      <div class="flex items-start justify-between mb-4">
        <div class="min-w-0">
          <h3 class="text-white font-semibold text-base truncate">${esc(bien.nom)}</h3>
          <p class="text-slate-400 text-xs mt-0.5">
            ${surf ? surf + ' m²' : ''}${surf && prix ? ' · ' : ''}${prix ? fmt(prix) : ''}
            ${surf && prix ? ' <span class="text-slate-600">· ' + Math.round(prix / surf) + '€/m²</span>' : ''}
          </p>
        </div>
        <span class="text-blue-400 text-xs ml-2 flex-shrink-0">Voir →</span>
      </div>
      <div class="grid grid-cols-3 gap-3">
        <div>
          <p class="text-slate-500 text-xs">CF mensuel</p>
          <p class="${cfCol} font-bold text-sm">${r.cfMensCredit >= 0 ? '+' : ''}${fmt(r.cfMensCredit)}</p>
        </div>
        <div>
          <p class="text-slate-500 text-xs">Rdt net</p>
          <p class="${rdCol} font-bold text-sm">${r.rendNetCredit.toFixed(2)}%</p>
        </div>
        <div>
          <p class="text-slate-500 text-xs">Capital remb.</p>
          <p class="text-white font-bold text-sm">${hasCr ? fmt(cap) : '—'}</p>
        </div>
      </div>
    </div>`;
}

// ── Vue détail ────────────────────────────────────────────────────────────────

function renderImmoDetail(app, bienId) {
  const bien = STATE.biens_immo.find(b => b.id === bienId);
  if (!bien) { navigate('#immo'); return; }
  _immoFilter.type = '';
  const hasCr = Number(bien.montant_credit || 0) > 0;
  app.innerHTML = `
    ${navbar(`<a href="#immo" onclick="navigate('#immo');return false;" class="text-slate-400 hover:text-white text-sm">← Mes biens</a>`)}
    <div class="max-w-screen-2xl mx-auto px-4 py-8 space-y-6">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-white">${esc(bien.nom)}</h1>
          <p class="text-slate-400 text-sm mt-0.5">${bien.surface_m2 ? bien.surface_m2 + ' m²' : ''} · Acheté ${fmt(Number(bien.prix_achat))}</p>
        </div>
        <div class="flex gap-2 flex-shrink-0">
          <button onclick="openBienImmoModal('${bienId}')" class="btn-secondary text-sm">✏ Modifier</button>
          <button onclick="confirmDeleteBienImmo('${bienId}')" class="btn-secondary text-sm text-red-400">✕</button>
        </div>
      </div>
      ${immoBloc1(bien)}
      <div class="grid gap-6 lg:grid-cols-2">
        ${immoBloc2(bien)}
        <div id="immo-reel">${immoBloc3(bienId)}</div>
      </div>
      ${hasCr ? immoBloc4(bien) : ''}
      <div>
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold text-white">📋 Dépenses & Loyers</h2>
          <button onclick="openDepenseImmoModal('${bienId}')" class="btn-primary text-sm">+ Ajouter</button>
        </div>
        <div id="immo-dep-table">${immoDepensesTable(bienId)}</div>
      </div>
    </div>
    ${modalBienImmo()}
    ${modalDepenseImmo()}
    ${modalTvaVersement()}`;
}

function immoBloc1(bien) {
  const mens  = immoMensualite(bien);
  const hasCr = Number(bien.montant_credit || 0) > 0;
  const row   = (label, val) => `<div><p class="text-slate-500 text-xs">${label}</p><p class="text-white font-medium text-sm">${val}</p></div>`;
  return `
    <div class="bg-slate-800 rounded-xl p-5">
      <h2 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Caractéristiques</h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        ${row('Surface', bien.surface_m2 ? bien.surface_m2 + ' m²' : '—')}
        ${row("Prix d'achat", fmt(Number(bien.prix_achat || 0)))}
        ${row('Loyer HT / mois', '<span class="text-emerald-400">' + fmt(Number(bien.loyer_annuel_ht || 0) / 12) + '</span>')}
        ${row('Loyer annuel HT', fmt(Number(bien.loyer_annuel_ht || 0)))}
        ${row('Taxe foncière', fmt(Number(bien.taxe_fonciere || 0)) + '/an')}
        ${row('Charges prévis.', fmt(Number(bien.charges_annuelles || 0)) + '/an')}
        ${hasCr ? `
        ${row('Montant emprunté', fmt(Number(bien.montant_credit)))}
        ${row('Durée crédit', bien.duree_credit_mois + ' mois')}
        ${row('Taux annuel', (Number(bien.taux_credit) * 100).toFixed(2) + '%')}
        ${row('Mensualité crédit', '<span class="text-amber-400">' + fmt(mens) + '/mois</span>')}
        ${row('Assurance', fmt(Number(bien.mensualite_assurance || 0)) + '/mois')}
        ${bien.numero_pret ? row('N° prêt', esc(bien.numero_pret)) : ''}
        ${bien.date_debut_credit ? row('Début crédit', bien.date_debut_credit) : ''}
        ` : ''}
      </div>
    </div>`;
}

function immoBloc2(bien) {
  const r     = immoRentabilite(bien);
  const hasCr = Number(bien.montant_credit || 0) > 0;
  const cc    = v => v >= 0 ? 'text-emerald-400' : 'text-red-400';
  const fmtCf = v => (v >= 0 ? '+' : '') + fmt(v);
  const fmtPct = v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  return `
    <div class="bg-slate-800 rounded-xl p-5">
      <h2 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Rentabilité théorique</h2>
      <table class="w-full text-sm">
        <thead class="text-slate-400 text-xs border-b border-slate-700">
          <tr>
            <th class="text-left py-2 font-medium">Indicateur</th>
            ${hasCr ? '<th class="text-right py-2 font-medium">Pendant crédit</th>' : ''}
            <th class="text-right py-2 font-medium">Post crédit</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-700/40">
          <tr>
            <td class="py-2.5 text-slate-300">Rendement brut</td>
            ${hasCr ? '<td class="py-2.5 text-right text-emerald-400">' + r.rendBrut.toFixed(2) + '%</td>' : ''}
            <td class="py-2.5 text-right text-emerald-400">${r.rendBrut.toFixed(2)}%</td>
          </tr>
          <tr>
            <td class="py-2.5 text-slate-300">Rendement net</td>
            ${hasCr ? '<td class="py-2.5 text-right font-semibold ' + cc(r.rendNetCredit) + '">' + fmtPct(r.rendNetCredit) + '</td>' : ''}
            <td class="py-2.5 text-right font-semibold ${cc(r.rendNetPost)}">${fmtPct(r.rendNetPost)}</td>
          </tr>
          <tr>
            <td class="py-2.5 text-slate-300">Cashflow annuel</td>
            ${hasCr ? '<td class="py-2.5 text-right ' + cc(r.cfAnnCredit) + '">' + fmtCf(r.cfAnnCredit) + '</td>' : ''}
            <td class="py-2.5 text-right ${cc(r.cfAnnPost)}">${fmtCf(r.cfAnnPost)}</td>
          </tr>
          <tr>
            <td class="py-2.5 text-slate-300">Cashflow mensuel</td>
            ${hasCr ? '<td class="py-2.5 text-right font-semibold ' + cc(r.cfMensCredit) + '">' + fmtCf(r.cfMensCredit) + '/mois</td>' : ''}
            <td class="py-2.5 text-right font-semibold ${cc(r.cfMensPost)}">${fmtCf(r.cfMensPost)}/mois</td>
          </tr>
        </tbody>
      </table>
    </div>`;
}

function immoBloc3(bienId) {
  const year = _immoFilter.year;
  const r    = immoRentabiliteReelle(bienId, year);
  if (!r) return '';
  const cc    = v => v >= 0 ? 'text-emerald-400' : 'text-red-400';
  const fmtCf = v => (v >= 0 ? '+' : '') + fmt(v);
  const yBtns = [year - 1, year, year + 1].map(y =>
    `<button onclick="_immoFilter.year=${y};setEl('immo-reel',immoBloc3('${bienId}'))"
      class="px-2 py-1 rounded text-xs ${y === year ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}">${y}</button>`).join('');
  return `
    <div class="bg-slate-800 rounded-xl p-5 h-full">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Réel ${year}</h2>
        <div class="flex gap-1">${yBtns}</div>
      </div>
      ${(r.moisLoyers === 0 && r.moisCharges === 0) ? `<p class="text-slate-500 text-sm py-6 text-center">Aucune dépense saisie pour ${year}</p>` : `
      <div class="grid grid-cols-2 gap-3">
        <div class="bg-slate-700/40 rounded-lg p-3">
          <p class="text-slate-400 text-xs mb-1">Loyers HT perçus</p>
          <p class="text-emerald-400 font-bold">${fmt(Math.round(r.loyersHt))}</p>
          <p class="text-slate-600 text-xs">${r.moisLoyers} loyer${r.moisLoyers > 1 ? 's' : ''} saisi${r.moisLoyers > 1 ? 's' : ''}</p>
        </div>
        <div class="bg-slate-700/40 rounded-lg p-3">
          <p class="text-slate-400 text-xs mb-1">Dépenses + TF</p>
          <p class="text-red-400 font-bold">−${fmt(Math.round(r.depenses + r.taxe))}</p>
          <p class="text-slate-600 text-xs">${r.moisCharges} mois · TF ${fmt(r.taxe)}</p>
        </div>
        <div class="bg-slate-700/40 rounded-lg p-3">
          <p class="text-slate-400 text-xs mb-1">Cashflow réel YTD</p>
          <p class="${cc(r.cfReel)} font-bold">${fmtCf(Math.round(r.cfReel))}</p>
          <p class="text-slate-500 text-xs mt-0.5">${r.moisLoyers > 0 && r.moisCharges > 0 ? fmtCf(Math.round(r.cfReel / Math.max(r.moisLoyers, r.moisCharges))) + '/mois moy.' : 'données partielles'}</p>
        </div>
        <div class="bg-slate-700/40 rounded-lg p-3 ${r.moisLoyers !== r.moisCharges ? 'border border-blue-500/30' : ''}">
          <p class="text-slate-400 text-xs mb-1">Cashflow projeté</p>
          <p class="${cc(r.cfProjete)} font-bold">${fmtCf(Math.round(r.cfProjete / 12))}/mois</p>
          <p class="text-slate-500 text-xs mt-0.5">${fmtCf(Math.round(r.cfProjete))}/an · ${r.rendProjete.toFixed(2)}%</p>
          ${r.moisLoyers !== r.moisCharges ? `
          <div class="mt-1.5 pt-1.5 border-t border-slate-600/50 space-y-0.5">
            <p class="text-slate-600 text-xs">↑ ${fmtCf(Math.round(r.loyersAnn / 12))}/mois loyers (${r.moisLoyers}m)</p>
            <p class="text-slate-600 text-xs">↓ ${fmt(Math.round(r.depAnn / 12))}/mois charges (${r.moisCharges}m)</p>
          </div>` : ''}
        </div>
      </div>`}
    </div>`;
}

function immoBloc4(bien) {
  const C    = Number(bien.montant_credit || 0);
  const rdu  = immoCapitalRestantDu(bien);
  const remb = Math.max(0, C - rdu);
  const pct  = C > 0 ? Math.round(remb / C * 100) : 0;
  return `
    <div class="bg-slate-800 rounded-xl p-5">
      <h2 class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Capital crédit</h2>
      <div class="grid grid-cols-3 gap-4 text-center mb-4">
        <div><p class="text-slate-500 text-xs">Emprunté</p><p class="text-white font-bold text-base">${fmt(C)}</p></div>
        <div><p class="text-slate-500 text-xs">Remboursé</p><p class="text-emerald-400 font-bold text-base">${fmt(remb)}</p></div>
        <div><p class="text-slate-500 text-xs">Restant dû</p><p class="text-amber-400 font-bold text-base">${fmt(rdu)}</p></div>
      </div>
      <div class="w-full bg-slate-700 rounded-full h-2.5">
        <div class="bg-emerald-500 h-2.5 rounded-full" style="width:${pct}%"></div>
      </div>
      <p class="text-slate-500 text-xs mt-1.5 text-right">${pct}% remboursé</p>
    </div>`;
}

// ── TVA globale immobilier ────────────────────────────────────────────────────

function immoTvaCollectee(year) {
  const yStart = new Date(year, 0, 1);
  const yEnd   = new Date(year, 11, 31, 23, 59, 59);
  const parseLocalDate = s => { const p = String(s).split('T')[0].split('-'); return new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2])); };
  return STATE.depenses_immo
    .filter(d => d.type === 'loyer' && d.tva_rate && Number(d.tva_rate) > 0 && d.periode_debut && d.periode_fin)
    .reduce((sum, d) => {
      const s = parseLocalDate(d.periode_debut), e = parseLocalDate(d.periode_fin);
      if (e < yStart || s > yEnd) return sum;
      const oS = s < yStart ? yStart : s, oE = e > yEnd ? yEnd : e;
      const tot = (e - s) / 86400000 + 1, ov = (oE - oS) / 86400000 + 1;
      const tva = Number(d.montant_ttc || 0) - Number(d.montant_ht || 0);
      return sum + tva * (ov / tot);
    }, 0);
}

function immoTvaVersee(year) {
  return STATE.depenses_immo
    .filter(d => d.bien_id === '__tva__' && d.type === 'tva_reversee' && d.date && new Date(d.date).getFullYear() === year)
    .reduce((s, d) => s + Number(d.montant_ttc || 0), 0);
}

function immoTvaVersements(year) {
  return STATE.depenses_immo
    .filter(d => d.bien_id === '__tva__' && d.type === 'tva_reversee' && d.date && new Date(d.date).getFullYear() === year)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function immoTvaTrackedMonths(year) {
  const months = new Set();
  STATE.depenses_immo
    .filter(d => d.type === 'loyer' && d.tva_rate && Number(d.tva_rate) > 0)
    .forEach(d => {
      const ref = d.periode_debut || d.date;
      if (ref && new Date(ref).getFullYear() === year) months.add(new Date(ref).getMonth());
    });
  return months.size;
}

function immoTvaBloc() {
  const year    = _tvaFilter.year;
  const collectee = immoTvaCollectee(year);
  const versee    = immoTvaVersee(year);
  const solde     = collectee - versee;
  const mois      = immoTvaTrackedMonths(year);
  const projete   = mois > 0 ? (collectee / mois) * 12 : 0;
  const versements = immoTvaVersements(year);
  const cc = v => v > 0 ? 'text-amber-400' : (v < 0 ? 'text-emerald-400' : 'text-slate-300');
  const yBtns = [year - 1, year, year + 1].map(y =>
    `<button onclick="_tvaFilter.year=${y};setEl('immo-tva-bloc',immoTvaBloc())"
      class="px-2 py-1 rounded text-xs ${y === year ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}">${y}</button>`).join('');

  // Détail TVA par bien
  const loyersAvecTva = STATE.depenses_immo.filter(d =>
    d.type === 'loyer' && d.tva_rate && Number(d.tva_rate) > 0 && d.periode_debut && d.periode_fin
  );
  const bienIds = [...new Set(loyersAvecTva.map(d => d.bien_id))];
  const detailRows = bienIds.map(bid => {
    const bien = STATE.biens_immo.find(b => b.id === bid);
    const yStart = new Date(year, 0, 1), yEnd = new Date(year, 11, 31, 23, 59, 59);
    let tvaHt = 0, tvaTtc = 0;
    loyersAvecTva.filter(d => d.bien_id === bid).forEach(d => {
      const s = new Date(d.periode_debut), e = new Date(d.periode_fin);
      if (e < yStart || s > yEnd) return;
      const oS = s < yStart ? yStart : s, oE = e > yEnd ? yEnd : e;
      const tot = (e - s) / 86400000 + 1, ov = (oE - oS) / 86400000 + 1;
      const ratio = ov / tot;
      tvaTtc += Number(d.montant_ttc || 0) * ratio;
      tvaHt  += Number(d.montant_ht  || 0) * ratio;
    });
    const tvaMontant = tvaTtc - tvaHt;
    return tvaMontant > 0 ? `
      <tr class="border-b border-slate-800">
        <td class="py-2 px-3 text-slate-300 text-xs">${esc(bien?.nom || bid)}</td>
        <td class="py-2 px-3 text-right text-slate-300 text-xs">${fmt(Math.round(tvaHt))}</td>
        <td class="py-2 px-3 text-right text-white text-xs font-medium">${fmt(Math.round(tvaTtc))}</td>
        <td class="py-2 px-3 text-right text-amber-400 text-xs font-semibold">${fmt(Math.round(tvaMontant))}</td>
      </tr>` : '';
  }).join('');

  return `
    <div class="bg-slate-800 rounded-xl p-5">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <h2 class="text-xs font-semibold text-slate-400 uppercase tracking-wider">🧾 TVA Immobilier</h2>
          <span class="text-slate-600 text-xs">· Global tous biens</span>
        </div>
        <div class="flex items-center gap-3">
          <div class="flex gap-1">${yBtns}</div>
          <button onclick="openTvaVersementModal()" class="btn-secondary text-xs py-1 px-2">+ Verser TVA</button>
        </div>
      </div>

      <!-- Cartes résumé -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <div class="bg-slate-700/40 rounded-lg p-3">
          <p class="text-slate-400 text-xs mb-1">TVA collectée</p>
          <p class="text-white font-bold">${fmt(Math.round(collectee))}</p>
          <p class="text-slate-500 text-xs mt-0.5">${mois} mois de données</p>
        </div>
        <div class="bg-slate-700/40 rounded-lg p-3">
          <p class="text-slate-400 text-xs mb-1">Prévisionnel annuel</p>
          <p class="text-blue-400 font-bold">${mois > 0 ? fmt(Math.round(projete)) : '—'}</p>
          <p class="text-slate-500 text-xs mt-0.5">Extrapolé sur 12 mois</p>
        </div>
        <div class="bg-slate-700/40 rounded-lg p-3">
          <p class="text-slate-400 text-xs mb-1">TVA versée à l'état</p>
          <p class="text-emerald-400 font-bold">${fmt(Math.round(versee))}</p>
          <p class="text-slate-500 text-xs mt-0.5">${versements.length} versement${versements.length > 1 ? 's' : ''}</p>
        </div>
        <div class="bg-slate-700/40 rounded-lg p-3 ${solde > 0 ? 'border border-amber-500/30' : ''}">
          <p class="text-slate-400 text-xs mb-1">Solde à reverser</p>
          <p class="${cc(solde)} font-bold text-lg">${fmt(Math.round(solde))}</p>
          <p class="text-slate-500 text-xs mt-0.5">${solde > 0 ? '⚠ À régler' : solde < 0 ? '✓ Excédent' : '✓ Équilibré'}</p>
        </div>
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <!-- Détail TVA collectée par bien -->
        ${detailRows ? `
        <div>
          <p class="text-slate-500 text-xs font-medium uppercase tracking-wider mb-2">TVA collectée par bien</p>
          <div class="bg-slate-900 rounded-lg overflow-hidden">
            <table class="w-full text-sm">
              <thead class="bg-slate-800 text-slate-500 text-xs">
                <tr>
                  <th class="py-2 px-3 text-left font-medium">Bien</th>
                  <th class="py-2 px-3 text-right font-medium">HT</th>
                  <th class="py-2 px-3 text-right font-medium">TTC</th>
                  <th class="py-2 px-3 text-right font-medium">TVA</th>
                </tr>
              </thead>
              <tbody>${detailRows}</tbody>
              <tfoot class="border-t border-slate-700">
                <tr class="bg-slate-800/50">
                  <td class="py-2 px-3 text-slate-400 text-xs font-semibold">Total</td>
                  <td class="py-2 px-3" colspan="2"></td>
                  <td class="py-2 px-3 text-right text-amber-400 text-xs font-bold">${fmt(Math.round(collectee))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>` : `
        <div class="bg-slate-900 rounded-lg p-6 text-center">
          <p class="text-slate-500 text-sm">Aucun loyer TTC saisi pour ${year}</p>
          <p class="text-slate-600 text-xs mt-1">La TVA est calculée automatiquement à partir des loyers TTC</p>
        </div>`}

        <!-- Historique des versements -->
        <div>
          <p class="text-slate-500 text-xs font-medium uppercase tracking-wider mb-2">Versements à l'état</p>
          ${versements.length ? `
          <div class="bg-slate-900 rounded-lg overflow-hidden">
            <table class="w-full text-sm">
              <thead class="bg-slate-800 text-slate-500 text-xs">
                <tr>
                  <th class="py-2 px-3 text-left font-medium">Date</th>
                  <th class="py-2 px-3 text-right font-medium">Montant</th>
                  <th class="py-2 px-3 text-left font-medium">Note</th>
                  <th class="py-2 px-3 w-8"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800">
                ${versements.map(v => `
                <tr class="hover:bg-slate-800/50 transition">
                  <td class="py-2 px-3 text-slate-300 text-xs whitespace-nowrap">${fmtDate(v.date)}</td>
                  <td class="py-2 px-3 text-right text-emerald-400 text-xs font-semibold">${fmt(Number(v.montant_ttc || 0))}</td>
                  <td class="py-2 px-3 text-slate-500 text-xs truncate max-w-[140px]" title="${esc(v.note || '')}">${esc(v.note || '') || '—'}</td>
                  <td class="py-2 px-3 text-right">
                    <button onclick="confirmDeleteTvaVersement('${v.id}')" class="text-slate-500 hover:text-red-400 text-xs">✕</button>
                  </td>
                </tr>`).join('')}
              </tbody>
              <tfoot class="border-t border-slate-700">
                <tr class="bg-slate-800/50">
                  <td class="py-2 px-3 text-slate-400 text-xs font-semibold">Total versé</td>
                  <td class="py-2 px-3 text-right text-emerald-400 text-xs font-bold">${fmt(Math.round(versee))}</td>
                  <td colspan="2"></td>
                </tr>
              </tfoot>
            </table>
          </div>` : `
          <div class="bg-slate-900 rounded-lg p-6 text-center">
            <p class="text-slate-500 text-sm">Aucun versement enregistré pour ${year}</p>
            <button onclick="openTvaVersementModal()" class="mt-2 text-blue-400 hover:text-blue-300 text-xs">+ Enregistrer un versement</button>
          </div>`}
        </div>
      </div>
    </div>`;
}

function openTvaVersementModal() {
  document.getElementById('modal-tva-versement').classList.remove('hidden');
  document.getElementById('tva-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('tva-montant').value = '';
  document.getElementById('tva-note').value = '';
}

function closeTvaModal() {
  document.getElementById('modal-tva-versement').classList.add('hidden');
  _editingTvaId = null;
}

async function saveTvaVersement() {
  const date = document.getElementById('tva-date')?.value;
  const m    = parseFloat(String(document.getElementById('tva-montant')?.value || '').replace(',', '.')) || 0;
  const note = document.getElementById('tva-note')?.value?.trim() || '';
  if (!date || !m) { alert('Date et montant sont obligatoires.'); return; }
  const data = { bien_id: '__tva__', type: 'tva_reversee', date, montant_ttc: m, tva_rate: null, montant_ht: m, note };
  setGlobalLoader(true, 'Enregistrement…');
  try {
    closeTvaModal();
    const result = await API.addDepenseImmo(data);
    if (result) STATE.depenses_immo.push({ ...data, ...result });
    const cached = API._getCache();
    if (cached) { cached.depenses_immo = STATE.depenses_immo; API._setCache(cached); }
    setEl('immo-tva-bloc', immoTvaBloc());
  } catch (err) {
    console.error('saveTvaVersement error:', err);
    alert('Erreur : ' + (err.message || err));
  } finally { setGlobalLoader(false); }
}

async function confirmDeleteTvaVersement(id) {
  if (!confirm('Supprimer ce versement TVA ?')) return;
  setGlobalLoader(true, 'Suppression…');
  try {
    await API.deleteDepenseImmo(id);
    STATE.depenses_immo = STATE.depenses_immo.filter(d => d.id !== id);
    const cached = API._getCache();
    if (cached) { cached.depenses_immo = STATE.depenses_immo; API._setCache(cached); }
    setEl('immo-tva-bloc', immoTvaBloc());
  } catch (err) { alert('Erreur : ' + err.message); }
  finally { setGlobalLoader(false); }
}

function modalTvaVersement() {
  return `
    <div id="modal-tva-versement" class="hidden fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onclick="if(event.target===this)closeTvaModal()">
      <div class="modal-box w-full max-w-sm">
        <h3 class="text-lg font-bold text-white mb-5">🧾 Versement TVA à l'état</h3>
        <div class="space-y-3">
          <div>
            <label class="block text-slate-400 text-xs mb-1">Date du versement *</label>
            <input id="tva-date" type="date"
              class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
          <div>
            <label class="block text-slate-400 text-xs mb-1">Montant versé (€) *</label>
            <input id="tva-montant" type="number" step="0.01" min="0" placeholder="0.00"
              class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
          <div>
            <label class="block text-slate-400 text-xs mb-1">Note (optionnel)</label>
            <input id="tva-note" type="text" placeholder="Ex : Acompte T1 2026, Solde annuel…"
              class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
        </div>
        <div class="flex gap-2 mt-5">
          <button onclick="closeTvaModal()" class="btn-secondary flex-1">Annuler</button>
          <button onclick="saveTvaVersement()" class="btn-primary flex-1">Enregistrer</button>
        </div>
      </div>
    </div>`;
}

function fmtPeriode(debut, fin) {
  if (!debut && !fin) return '—';
  const MOIS = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
  // Prend uniquement la partie date (avant le T) pour gérer les ISO strings UTC
  const parse = s => { const p = String(s).split('T')[0].split('-'); return { y: parseInt(p[0]), m: parseInt(p[1]) - 1 }; };
  const d = debut ? parse(debut) : null;
  const f = fin   ? parse(fin)   : null;
  if (d && f) {
    if (d.m === f.m && d.y === f.y) return `${MOIS[d.m]} ${d.y}`;
    if (d.y === f.y) return `${MOIS[d.m]} → ${MOIS[f.m]} ${f.y}`;
    return `${MOIS[d.m]} ${d.y} → ${MOIS[f.m]} ${f.y}`;
  }
  if (d) return `${MOIS[d.m]} ${d.y}`;
  return `${MOIS[f.m]} ${f.y}`;
}

function immoDepensesTable(bienId) {
  const year  = _immoFilter.year;
  const type  = _immoFilter.type;
  const TYPES = { echeance_pret: 'Échéance prêt', charge: 'Charge', assurance: 'Assurance', loyer: 'Loyer' };
  const TCOLS = { echeance_pret: 'text-amber-400', charge: 'text-red-400', assurance: 'text-orange-400', loyer: 'text-emerald-400' };
  const deps  = STATE.depenses_immo
    .filter(d => {
      if (d.bien_id !== bienId) return false;
      const ref = d.date || d.periode_debut;
      if (!ref || new Date(ref).getFullYear() !== year) return false;
      return !type || d.type === type;
    })
    .sort((a, b) => new Date(b.date || b.periode_debut) - new Date(a.date || a.periode_debut));
  const totalTtc = deps.reduce((s, d) => s + Number(d.montant_ttc || 0), 0);
  const totalHt  = deps.reduce((s, d) => s + Number(d.montant_ht  || 0), 0);
  const hasHtCol = deps.some(d => d.montant_ht && Math.abs(Number(d.montant_ht) - Number(d.montant_ttc)) > 0.01);
  const yBtns = [year - 1, year, year + 1].map(y =>
    `<button onclick="_immoFilter.year=${y};setEl('immo-dep-table',immoDepensesTable('${bienId}'))"
      class="px-2 py-1 rounded text-xs ${y === _immoFilter.year ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'}">${y}</button>`).join('');
  const tBtns = ['', 'loyer', 'echeance_pret', 'charge', 'assurance'].map(t =>
    `<button onclick="_immoFilter.type='${t}';setEl('immo-dep-table',immoDepensesTable('${bienId}'))"
      class="px-2 py-1 rounded text-xs ${_immoFilter.type === t ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}">${t ? TYPES[t] : 'Tous'}</button>`).join('');
  return `
    <div>
      <div class="flex flex-wrap gap-2 mb-3 items-center">
        <div class="flex gap-1">${yBtns}</div>
        <div class="w-px h-4 bg-slate-700"></div>
        <div class="flex flex-wrap gap-1">${tBtns}</div>
      </div>
      ${deps.length ? `
      <div class="bg-slate-900 rounded-xl overflow-x-auto">
        <table class="w-full text-sm" style="min-width:700px">
          <thead class="bg-slate-800 text-slate-400 text-xs border-b border-slate-700">
            <tr>
              <th class="py-3 px-4 text-left font-medium">Date paiement</th>
              <th class="py-3 px-4 text-left font-medium">Type</th>
              <th class="py-3 px-4 text-right font-medium">Montant TTC</th>
              <th class="py-3 px-4 text-right font-medium">Montant HT</th>
              <th class="py-3 px-4 text-left font-medium">Période couverte</th>
              <th class="py-3 px-4 text-left font-medium">Note</th>
              <th class="py-3 px-4 w-16"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800">
            ${deps.map(d => {
              const tc     = TCOLS[d.type] || 'text-slate-300';
              const htDiff = d.montant_ht && Math.abs(Number(d.montant_ht) - Number(d.montant_ttc)) > 0.01;
              return `
                <tr class="hover:bg-slate-800/50 transition">
                  <td class="py-2.5 px-4 text-slate-300 text-xs whitespace-nowrap">${d.date ? fmtDate(d.date) : '—'}</td>
                  <td class="py-2.5 px-4"><span class="${tc} text-xs font-medium">${TYPES[d.type] || d.type}</span></td>
                  <td class="py-2.5 px-4 text-right text-white font-medium">${fmt(Number(d.montant_ttc || 0))}</td>
                  <td class="py-2.5 px-4 text-right text-slate-400 text-xs">${htDiff ? fmt(Number(d.montant_ht)) : '—'}</td>
                  <td class="py-2.5 px-4 text-slate-400 text-xs whitespace-nowrap">${fmtPeriode(d.periode_debut, d.periode_fin)}</td>
                  <td class="py-2.5 px-4 text-slate-500 text-xs max-w-[160px] truncate" title="${esc(d.note || '')}">${esc(d.note || '')}</td>
                  <td class="py-2.5 px-4 text-right whitespace-nowrap">
                    <button onclick="openDepenseImmoModal('${bienId}','${d.id}')" class="text-slate-500 hover:text-blue-400 text-xs mr-2">✏</button>
                    <button onclick="confirmDeleteDepenseImmo('${d.id}','${bienId}')" class="text-slate-500 hover:text-red-400 text-xs">✕</button>
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
          <tfoot class="border-t-2 border-slate-600">
            <tr class="bg-slate-800/80">
              <td class="py-2.5 px-4 text-slate-400 text-xs font-semibold" colspan="2">
                Total — ${deps.length} entrée${deps.length > 1 ? 's' : ''}${type ? ' · ' + (TYPES[type] || type) : ''}
              </td>
              <td class="py-2.5 px-4 text-right text-white font-bold">${fmt(totalTtc)}</td>
              <td class="py-2.5 px-4 text-right text-slate-300 text-xs font-semibold">${hasHtCol ? fmt(totalHt) : '—'}</td>
              <td colspan="3" class="py-2.5 px-4 text-slate-500 text-xs">${hasHtCol ? 'TVA : ' + fmt(totalTtc - totalHt) : ''}</td>
            </tr>
          </tfoot>
        </table>
      </div>` : `
      <div class="bg-slate-900 rounded-xl p-8 text-center">
        <p class="text-slate-500 text-sm">Aucune entrée pour ${year}${type ? ' · ' + (TYPES[type] || type) : ''}</p>
      </div>`}
    </div>`;
}

// ── Modals ────────────────────────────────────────────────────────────────────

function modalBienImmo() {
  return `
    <div id="modal-bien-immo" class="hidden fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onclick="if(event.target===this)closeBienImmoModal()">
      <div class="modal-box w-full max-w-lg overflow-y-auto" style="max-height:90vh">
        <h3 id="bien-modal-title" class="text-lg font-bold text-white mb-5">Nouveau bien</h3>
        <div class="space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <div class="col-span-2">
              <label class="block text-slate-400 text-xs mb-1">Nom du bien *</label>
              <input id="bi-nom" type="text" placeholder="Ex : Appart Lyon 3ème"
                class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            <div>
              <label class="block text-slate-400 text-xs mb-1">Surface (m²)</label>
              <input id="bi-surface" type="number" min="0"
                class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            <div>
              <label class="block text-slate-400 text-xs mb-1">Prix d'achat (€) *</label>
              <input id="bi-prix" type="number" min="0"
                class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
          </div>
          <div class="border-t border-slate-700 pt-3">
            <p class="text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">Revenus & Charges prévisionnels</p>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-slate-400 text-xs mb-1">Loyer annuel HT (€)</label>
                <input id="bi-loyer" type="number" min="0"
                  class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              </div>
              <div>
                <label class="block text-slate-400 text-xs mb-1">Taxe foncière (€/an)</label>
                <input id="bi-taxe" type="number" min="0"
                  class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              </div>
              <div>
                <label class="block text-slate-400 text-xs mb-1">Charges annuelles (€)</label>
                <input id="bi-charges" type="number" min="0"
                  class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              </div>
            </div>
          </div>
          <div class="border-t border-slate-700 pt-3">
            <p class="text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">Crédit immobilier (optionnel)</p>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-slate-400 text-xs mb-1">Montant emprunté (€)</label>
                <input id="bi-credit" type="number" min="0" oninput="previewMensualite()"
                  class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              </div>
              <div>
                <label class="block text-slate-400 text-xs mb-1">Durée (mois)</label>
                <input id="bi-duree" type="number" min="0" oninput="previewMensualite()"
                  class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              </div>
              <div>
                <label class="block text-slate-400 text-xs mb-1">Taux annuel (ex : 3.5 pour 3,5%)</label>
                <input id="bi-taux" type="number" min="0" step="0.01" oninput="previewMensualite()"
                  class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              </div>
              <div>
                <label class="block text-slate-400 text-xs mb-1">Assurance mensuelle (€)</label>
                <input id="bi-assur" type="number" min="0"
                  class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              </div>
              <div>
                <label class="block text-slate-400 text-xs mb-1">N° de prêt</label>
                <input id="bi-numpret" type="text"
                  class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              </div>
              <div>
                <label class="block text-slate-400 text-xs mb-1">Date 1ère échéance</label>
                <input id="bi-datecredit" type="date"
                  class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              </div>
            </div>
            <div id="bi-mens-preview" class="hidden mt-3 bg-slate-700/40 rounded-lg px-3 py-2 flex items-center justify-between">
              <span class="text-slate-400 text-xs">Mensualité crédit calculée</span>
              <span id="bi-mens-val" class="text-amber-400 font-bold">—</span>
            </div>
          </div>
        </div>
        <div class="flex gap-3 mt-6">
          <button onclick="saveBienImmo()" class="btn-primary flex-1">Enregistrer</button>
          <button onclick="closeBienImmoModal()" class="btn-secondary flex-1">Annuler</button>
        </div>
      </div>
    </div>`;
}

function modalDepenseImmo() {
  const cy = new Date().getFullYear();
  const years = [cy - 2, cy - 1, cy, cy + 1, cy + 2];
  const MOIS_OPTS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']
    .map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
  const YEAR_OPTS = years.map(y => `<option value="${y}">${y}</option>`).join('');
  const moisCls  = `flex-1 bg-slate-700 text-white rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500`;
  const anneeCls = `w-[74px] bg-slate-700 text-white rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500`;

  return `
    <div id="modal-dep-immo" class="hidden fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onclick="if(event.target===this)closeDepenseImmoModal()">
      <div class="modal-box w-full max-w-sm overflow-y-auto" style="max-height:90vh">
        <h3 id="dep-modal-title" class="text-base font-bold text-white mb-4">Dépense / Loyer</h3>
        <div class="space-y-3">
          <div>
            <label class="block text-slate-400 text-xs mb-1">Type *</label>
            <select id="dep-type" onchange="toggleTvaFields()"
              class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="loyer">Loyer</option>
              <option value="echeance_pret">Échéance prêt</option>
              <option value="charge">Charge</option>
              <option value="assurance">Assurance</option>
            </select>
          </div>
          <div>
            <label class="block text-slate-400 text-xs mb-1">Date de paiement *</label>
            <input id="dep-date" type="date"
              class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
          <div>
            <label id="dep-montant-label" class="block text-slate-400 text-xs mb-1">Montant TTC (€) *</label>
            <input id="dep-montant" type="number" min="0" step="0.01" oninput="refreshDepPreview()"
              class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
          <div id="dep-tva-section" class="hidden space-y-3 bg-slate-700/30 rounded-lg p-3">
            <label class="flex items-center gap-2 cursor-pointer">
              <input id="dep-tva-toggle" type="checkbox" onchange="toggleTvaFields()">
              <span class="text-slate-300 text-sm">Montant TTC (appliquer TVA)</span>
            </label>
            <div id="dep-tva-rate-row" class="hidden">
              <label class="block text-slate-400 text-xs mb-1">Taux TVA (%)</label>
              <input id="dep-tva-rate" type="number" value="10" min="0" max="100" step="0.1" oninput="refreshDepPreview()"
                class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
            <div id="dep-ht-preview" class="hidden flex items-center justify-between">
              <span class="text-slate-400 text-xs">Montant HT calculé</span>
              <span id="dep-ht-val" class="text-emerald-400 font-semibold text-sm">—</span>
            </div>

            <!-- ── Période couverte ──────────────────────────────────── -->
            <div class="space-y-2">
              <label class="block text-slate-400 text-xs">Période couverte</label>
              <!-- Sélecteur de fréquence -->
              <div class="flex gap-1">
                <button id="freq-btn-mensuel" type="button" onclick="setLoyerFreq('mensuel')"
                  class="flex-1 py-1.5 rounded text-xs font-medium transition bg-blue-600 text-white">Mensuel</button>
                <button id="freq-btn-trimestriel" type="button" onclick="setLoyerFreq('trimestriel')"
                  class="flex-1 py-1.5 rounded text-xs font-medium transition bg-slate-700 text-slate-400 hover:text-white">Trimestriel</button>
                <button id="freq-btn-personnalise" type="button" onclick="setLoyerFreq('personnalise')"
                  class="flex-1 py-1.5 rounded text-xs font-medium transition bg-slate-700 text-slate-400 hover:text-white">Perso.</button>
              </div>

              <!-- Mode mensuel : 1 seul mois -->
              <div id="dep-freq-mensuel">
                <p class="text-slate-500 text-xs mb-1">Mois couvert par ce loyer</p>
                <div class="flex gap-1">
                  <select id="dep-mois-unique" class="${moisCls}">${MOIS_OPTS}</select>
                  <select id="dep-annee-unique" class="${anneeCls}">${YEAR_OPTS}</select>
                </div>
                <p class="text-slate-600 text-xs mt-1">Ex : déc. 2025 pour un loyer reçu en janv. 2026</p>
              </div>

              <!-- Mode trimestriel + personnalisé : début + fin -->
              <div id="dep-freq-nonmensuel" class="hidden space-y-2">
                <div>
                  <p class="text-slate-500 text-xs mb-1">Mois de début</p>
                  <div class="flex gap-1">
                    <select id="dep-mois-debut" onchange="updateTrimPreview()" class="${moisCls}">${MOIS_OPTS}</select>
                    <select id="dep-annee-debut" onchange="updateTrimPreview()" class="${anneeCls}">${YEAR_OPTS}</select>
                  </div>
                </div>
                <!-- Aperçu trimestriel automatique -->
                <p id="dep-trim-preview" class="hidden text-blue-400 text-xs font-medium"></p>
                <!-- Fin (mode personnalisé seulement) -->
                <div id="dep-freq-fin" class="hidden">
                  <p class="text-slate-500 text-xs mb-1">Mois de fin</p>
                  <div class="flex gap-1">
                    <select id="dep-mois-fin" class="${moisCls}">${MOIS_OPTS}</select>
                    <select id="dep-annee-fin" class="${anneeCls}">${YEAR_OPTS}</select>
                  </div>
                </div>
              </div>
            </div>
            <!-- ── fin Période ──────────────────────────────────────── -->

          </div>
          <div>
            <label class="block text-slate-400 text-xs mb-1">Note (optionnelle)</label>
            <textarea id="dep-note" rows="2" placeholder="Commentaire…"
              class="w-full bg-slate-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"></textarea>
          </div>
        </div>
        <div class="flex gap-3 mt-4">
          <button onclick="saveDepenseImmo()" class="btn-primary flex-1">Enregistrer</button>
          <button onclick="closeDepenseImmoModal()" class="btn-secondary flex-1">Annuler</button>
        </div>
      </div>
    </div>`;
}

// ── CRUD biens ────────────────────────────────────────────────────────────────

function openBienImmoModal(id = null) {
  _editingBienId = id;
  const bien = id ? STATE.biens_immo.find(b => b.id === id) : null;
  document.getElementById('bien-modal-title').textContent = bien ? 'Modifier — ' + bien.nom : 'Nouveau bien';
  const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = (val ?? ''); };
  set('bi-nom',        bien?.nom || '');
  set('bi-surface',    bien?.surface_m2 || '');
  set('bi-prix',       bien?.prix_achat || '');
  set('bi-loyer',      bien?.loyer_annuel_ht || '');
  set('bi-taxe',       bien?.taxe_fonciere || '');
  set('bi-charges',    bien?.charges_annuelles || '');
  set('bi-credit',     bien?.montant_credit || '');
  set('bi-duree',      bien?.duree_credit_mois || '');
  set('bi-taux',       bien ? (Number(bien.taux_credit || 0) * 100).toFixed(2) : '');
  set('bi-assur',      bien?.mensualite_assurance || '');
  set('bi-numpret',    bien?.numero_pret || '');
  set('bi-datecredit', bien?.date_debut_credit || '');
  previewMensualite();
  document.getElementById('modal-bien-immo').classList.remove('hidden');
  setTimeout(() => document.getElementById('bi-nom')?.focus(), 50);
}

function closeBienImmoModal() {
  document.getElementById('modal-bien-immo').classList.add('hidden');
}

function previewMensualite() {
  const C  = parseFloat(document.getElementById('bi-credit')?.value) || 0;
  const n  = parseFloat(document.getElementById('bi-duree')?.value) || 0;
  const ta = parseFloat(document.getElementById('bi-taux')?.value) || 0;
  const tm = ta / 100 / 12;
  const m  = C > 0 && n > 0 ? (tm === 0 ? C / n : (C * tm) / (1 - Math.pow(1 + tm, -n))) : 0;
  const prev = document.getElementById('bi-mens-preview');
  const val  = document.getElementById('bi-mens-val');
  if (prev && val) {
    if (C > 0 && n > 0) { prev.classList.remove('hidden'); val.textContent = fmt(m) + '/mois'; }
    else prev.classList.add('hidden');
  }
}

async function saveBienImmo() {
  const nom = document.getElementById('bi-nom')?.value?.trim();
  if (!nom) { alert('Le nom est obligatoire.'); return; }
  const ta   = parseFloat(document.getElementById('bi-taux')?.value) || 0;
  const data = {
    nom,
    surface_m2:           parseFloat(document.getElementById('bi-surface')?.value) || 0,
    prix_achat:           parseFloat(document.getElementById('bi-prix')?.value) || 0,
    loyer_annuel_ht:      parseFloat(document.getElementById('bi-loyer')?.value) || 0,
    taxe_fonciere:        parseFloat(document.getElementById('bi-taxe')?.value) || 0,
    charges_annuelles:    parseFloat(document.getElementById('bi-charges')?.value) || 0,
    montant_credit:       parseFloat(document.getElementById('bi-credit')?.value) || 0,
    duree_credit_mois:    parseFloat(document.getElementById('bi-duree')?.value) || 0,
    taux_credit:          ta / 100,
    mensualite_assurance: parseFloat(document.getElementById('bi-assur')?.value) || 0,
    numero_pret:          document.getElementById('bi-numpret')?.value?.trim() || '',
    date_debut_credit:    document.getElementById('bi-datecredit')?.value || '',
  };
  closeBienImmoModal();
  setGlobalLoader(true, _editingBienId ? 'Mise à jour…' : 'Enregistrement…');
  try {
    if (_editingBienId) {
      await API.updateBienImmo({ id: _editingBienId, ...data });
      const idx = STATE.biens_immo.findIndex(b => b.id === _editingBienId);
      if (idx !== -1) STATE.biens_immo[idx] = { ...STATE.biens_immo[idx], ...data };
    } else {
      const result = await API.addBienImmo(data);
      STATE.biens_immo.push({ ...data, ...result });
      // Changer l'URL silencieusement sans déclencher hashchange
      history.replaceState(null, '', '#immo');
    }
    // Reconstruire le cache depuis STATE puis forcer le re-render
    // (navigate() ne suffit pas si le hash n'a pas changé)
    API._setCache({ ...STATE });
    render();
  } catch (err) { alert('Erreur : ' + err.message); }
  finally { setGlobalLoader(false); }
}

async function confirmDeleteBienImmo(id) {
  const bien = STATE.biens_immo.find(b => b.id === id);
  if (!confirm('Supprimer "' + (bien?.nom || '') + '" et toutes ses dépenses associées ?')) return;
  setGlobalLoader(true, 'Suppression…');
  try {
    await API.deleteBienImmo(id);
    STATE.biens_immo    = STATE.biens_immo.filter(b => b.id !== id);
    STATE.depenses_immo = STATE.depenses_immo.filter(d => d.bien_id !== id);
    history.replaceState(null, '', '#immo');
    API._setCache({ ...STATE });
    render();
  } catch (err) { alert('Erreur : ' + err.message); }
  finally { setGlobalLoader(false); }
}

// ── CRUD dépenses ─────────────────────────────────────────────────────────────

function openDepenseImmoModal(bienId, depId = null) {
  _depBienId    = bienId;
  _editingDepId = depId;
  const dep  = depId ? STATE.depenses_immo.find(d => d.id === depId) : null;
  const now  = new Date();
  const cy   = now.getFullYear();
  const cm   = now.getMonth() + 1;

  document.getElementById('dep-modal-title').textContent = dep ? 'Modifier la dépense' : 'Nouvelle dépense';
  document.getElementById('dep-type').value    = dep?.type || 'loyer';
  document.getElementById('dep-date').value    = dep?.date || now.toISOString().slice(0, 10);
  document.getElementById('dep-montant').value = dep?.montant_ttc || '';
  document.getElementById('dep-note').value    = dep?.note || '';

  // TVA : cochée par défaut pour un nouveau loyer, sinon basé sur les données existantes
  const hasTva = dep ? !!dep.tva_rate : true;
  document.getElementById('dep-tva-toggle').checked = hasTva;
  document.getElementById('dep-tva-rate').value = dep?.tva_rate
    ? (Number(dep.tva_rate) * 100).toFixed(1) : '10';

  // Période : initialiser les sélecteurs selon la fréquence détectée
  const setMoisAnnee = (moisId, anneeId, dateStr, defaultMois, defaultAnnee) => {
    const m = dateStr ? parseInt(dateStr.split('-')[1]) : defaultMois;
    const y = dateStr ? parseInt(dateStr.split('-')[0]) : defaultAnnee;
    const mEl = document.getElementById(moisId), yEl = document.getElementById(anneeId);
    if (mEl) mEl.value = m;
    if (yEl) {
      if (![...yEl.options].some(o => Number(o.value) === y)) {
        const opt = document.createElement('option');
        opt.value = y; opt.textContent = y;
        yEl.appendChild(opt);
      }
      yEl.value = y;
    }
  };

  const freq = dep?.type === 'loyer' ? detectLoyerFreq(dep) : 'mensuel';
  _loyerFreq = freq;
  if (freq === 'mensuel') {
    setMoisAnnee('dep-mois-unique', 'dep-annee-unique', dep?.periode_debut, cm, cy);
  } else {
    setMoisAnnee('dep-mois-debut', 'dep-annee-debut', dep?.periode_debut, cm, cy);
    if (freq === 'personnalise') {
      setMoisAnnee('dep-mois-fin', 'dep-annee-fin', dep?.periode_fin, cm, cy);
    }
  }

  toggleTvaFields();
  // Initialiser l'affichage de la fréquence après que toggleTvaFields ait rendu la section visible
  setTimeout(() => setLoyerFreq(_loyerFreq), 0);
  document.getElementById('modal-dep-immo').classList.remove('hidden');
  setTimeout(() => document.getElementById('dep-montant')?.focus(), 50);
}

function closeDepenseImmoModal() {
  document.getElementById('modal-dep-immo').classList.add('hidden');
}

function detectLoyerFreq(dep) {
  if (!dep?.periode_debut || !dep?.periode_fin) return 'mensuel';
  const pd = dep.periode_debut.split('-'), pf = dep.periode_fin.split('-');
  const diff = (parseInt(pf[0]) - parseInt(pd[0])) * 12 + (parseInt(pf[1]) - parseInt(pd[1]));
  if (diff === 0) return 'mensuel';
  if (diff === 2) return 'trimestriel';
  return 'personnalise';
}

function setLoyerFreq(freq) {
  _loyerFreq = freq;
  const FREQS = ['mensuel', 'trimestriel', 'personnalise'];
  FREQS.forEach(f => {
    const btn = document.getElementById('freq-btn-' + f);
    if (!btn) return;
    btn.className = btn.className
      .replace('bg-blue-600 text-white', '')
      .replace('bg-slate-700 text-slate-400', '').trim();
    btn.className += f === freq ? ' bg-blue-600 text-white' : ' bg-slate-700 text-slate-400';
  });
  document.getElementById('dep-freq-mensuel')?.classList.toggle('hidden', freq !== 'mensuel');
  document.getElementById('dep-freq-nonmensuel')?.classList.toggle('hidden', freq === 'mensuel');
  document.getElementById('dep-trim-preview')?.classList.toggle('hidden', freq !== 'trimestriel');
  document.getElementById('dep-freq-fin')?.classList.toggle('hidden', freq !== 'personnalise');
  if (freq === 'trimestriel') updateTrimPreview();
}

function updateTrimPreview() {
  if (_loyerFreq !== 'trimestriel') return;
  const moisD  = parseInt(document.getElementById('dep-mois-debut')?.value) || 1;
  const anneeD = parseInt(document.getElementById('dep-annee-debut')?.value) || new Date().getFullYear();
  const fm     = moisD + 2;
  const finAn  = anneeD + Math.floor((fm - 1) / 12);
  const finM   = ((fm - 1) % 12) + 1;
  const MOIS   = ['jan','fév','mar','avr','mai','jun','jul','aoû','sep','oct','nov','déc'];
  const prev = document.getElementById('dep-trim-preview');
  if (prev) prev.textContent = `→ Couvre : ${MOIS[moisD-1]}. → ${MOIS[finM-1]}. ${finAn}`;
}

function toggleTvaFields() {
  const type    = document.getElementById('dep-type')?.value;
  const tvaTog  = document.getElementById('dep-tva-toggle');
  const isLoyer = type === 'loyer';
  document.getElementById('dep-tva-section')?.classList.toggle('hidden', !isLoyer);
  const withTva = isLoyer && tvaTog?.checked;
  document.getElementById('dep-tva-rate-row')?.classList.toggle('hidden', !withTva);
  document.getElementById('dep-ht-preview')?.classList.toggle('hidden', !withTva);
  const label = document.getElementById('dep-montant-label');
  if (label) label.textContent = withTva ? 'Montant TTC (€) *' : isLoyer ? 'Montant HT (€) *' : 'Montant (€) *';
  refreshDepPreview();
}

function refreshDepPreview() {
  const type   = document.getElementById('dep-type')?.value;
  const m      = parseFloat(document.getElementById('dep-montant')?.value) || 0;
  const hasTva = document.getElementById('dep-tva-toggle')?.checked;
  const rate   = parseFloat(document.getElementById('dep-tva-rate')?.value) || 10;
  if (type === 'loyer' && hasTva && m > 0) {
    const el = document.getElementById('dep-ht-val');
    if (el) el.textContent = fmt(m / (1 + rate / 100));
  }
}

async function saveDepenseImmo() {
  const type   = document.getElementById('dep-type')?.value;
  const date   = document.getElementById('dep-date')?.value;
  const rawVal = document.getElementById('dep-montant')?.value || '';
  const m      = parseFloat(String(rawVal).replace(',', '.')) || 0;
  const note   = document.getElementById('dep-note')?.value?.trim() || '';
  if (!type || !date || !m) { alert('Type, date et montant sont obligatoires.'); return; }
  const isLoyer = type === 'loyer';
  const hasTva  = isLoyer && document.getElementById('dep-tva-toggle')?.checked;
  const tvaRate = hasTva ? parseFloat(document.getElementById('dep-tva-rate')?.value) / 100 : null;
  const ht      = hasTva ? m / (1 + tvaRate) : m;
  const bienId  = _depBienId; // capture avant fermeture
  const editId  = _editingDepId;
  const data = {
    bien_id: bienId, type, date,
    montant_ttc:   m,
    tva_rate:      tvaRate,
    montant_ht:    isLoyer ? ht : m,
    periode_debut: isLoyer ? (() => {
      if (_loyerFreq === 'mensuel') {
        const mois  = parseInt(document.getElementById('dep-mois-unique')?.value) || 1;
        const annee = parseInt(document.getElementById('dep-annee-unique')?.value) || new Date().getFullYear();
        return `${annee}-${String(mois).padStart(2,'0')}-01`;
      }
      const mois  = parseInt(document.getElementById('dep-mois-debut')?.value) || 1;
      const annee = parseInt(document.getElementById('dep-annee-debut')?.value) || new Date().getFullYear();
      return `${annee}-${String(mois).padStart(2,'0')}-01`;
    })() : '',
    periode_fin: isLoyer ? (() => {
      if (_loyerFreq === 'mensuel') {
        const mois  = parseInt(document.getElementById('dep-mois-unique')?.value) || 1;
        const annee = parseInt(document.getElementById('dep-annee-unique')?.value) || new Date().getFullYear();
        return `${annee}-${String(mois).padStart(2,'0')}-${String(new Date(annee, mois, 0).getDate()).padStart(2,'0')}`;
      }
      if (_loyerFreq === 'trimestriel') {
        const moisD  = parseInt(document.getElementById('dep-mois-debut')?.value) || 1;
        const anneeD = parseInt(document.getElementById('dep-annee-debut')?.value) || new Date().getFullYear();
        const fm     = moisD + 2;
        const finAn  = anneeD + Math.floor((fm - 1) / 12);
        const finM   = ((fm - 1) % 12) + 1;
        return `${finAn}-${String(finM).padStart(2,'0')}-${String(new Date(finAn, finM, 0).getDate()).padStart(2,'0')}`;
      }
      // Personnalisé
      const mois  = parseInt(document.getElementById('dep-mois-fin')?.value) || 1;
      const annee = parseInt(document.getElementById('dep-annee-fin')?.value) || new Date().getFullYear();
      return `${annee}-${String(mois).padStart(2,'0')}-${String(new Date(annee, mois, 0).getDate()).padStart(2,'0')}`;
    })() : '',
    note,
  };
  setGlobalLoader(true, editId ? 'Mise à jour…' : 'Enregistrement…');
  try {
    closeDepenseImmoModal();
    if (editId) {
      await API.updateDepenseImmo({ id: editId, ...data });
      const idx = STATE.depenses_immo.findIndex(d => d.id === editId);
      if (idx !== -1) STATE.depenses_immo[idx] = { ...STATE.depenses_immo[idx], ...data };
    } else {
      const result = await API.addDepenseImmo(data);
      if (result) STATE.depenses_immo.push({ ...data, ...result });
    }
    const cached = API._getCache();
    if (cached) { cached.depenses_immo = STATE.depenses_immo; API._setCache(cached); }
    setEl('immo-dep-table', immoDepensesTable(bienId));
    setEl('immo-reel',      immoBloc3(bienId));
  } catch (err) {
    console.error('saveDepenseImmo error:', err);
    alert('Erreur : ' + (err.message || err));
  } finally { setGlobalLoader(false); }
}

async function confirmDeleteDepenseImmo(id, bienId) {
  if (!confirm('Supprimer cette entrée ?')) return;
  setGlobalLoader(true, 'Suppression…');
  try {
    await API.deleteDepenseImmo(id);
    STATE.depenses_immo = STATE.depenses_immo.filter(d => d.id !== id);
    const cached = API._getCache();
    if (cached) { cached.depenses_immo = STATE.depenses_immo; API._setCache(cached); }
    setEl('immo-dep-table', immoDepensesTable(bienId));
    setEl('immo-reel',      immoBloc3(bienId));
  } catch (err) { alert('Erreur : ' + err.message); }
  finally { setGlobalLoader(false); }
}
