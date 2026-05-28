// dashboard.gs
// Génère un onglet "📊 NomPortfolio" par portfolio dans Google Sheets.
// Fonction principale : refreshDashboards()
// Déclencheur suggéré : time-driven, toutes les heures ou journalier.
// Note : sheetToObjects() est définie dans webapp.gs — partagée automatiquement.

function refreshDashboards() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const portfolios   = sheetToObjects(ss, 'portfolios');
  const envelopes    = sheetToObjects(ss, 'envelopes');
  const positions    = sheetToObjects(ss, 'positions');
  const prices       = sheetToObjects(ss, 'prices');
  const cryptoPrices = sheetToObjects(ss, 'crypto_prices');

  const priceByIsin    = {};
  prices.forEach(p => { priceByIsin[p.isin] = p; });
  const cryptoBySymbol = {};
  cryptoPrices.forEach(c => { cryptoBySymbol[String(c.symbole).toUpperCase()] = c; });

  portfolios.forEach(portfolio => {
    renderPortfolioSheet(ss, portfolio, envelopes, positions, priceByIsin, cryptoBySymbol);
  });

  // Supprime les onglets portfolio orphelins (portfolio supprimé du côté data)
  const validNames = new Set(portfolios.map(p => dashSheetName(p.nom)));
  const reserved = new Set(['portfolios','sub_portfolios','envelopes','positions','prices','crypto_prices','history']);
  ss.getSheets().forEach(sheet => {
    const name = sheet.getName();
    if (name.startsWith('📊 ') && !validNames.has(name) && !reserved.has(name)) {
      ss.deleteSheet(sheet);
    }
  });

  SpreadsheetApp.flush();
}

function dashSheetName(nom) {
  return `📊 ${nom}`;
}

// ─── RENDU D'UN ONGLET PORTFOLIO ─────────────────────────────────────────────

function renderPortfolioSheet(ss, portfolio, allEnvelopes, allPositions, priceByIsin, cryptoBySymbol) {
  const name = dashSheetName(portfolio.nom);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  } else {
    sheet.clearContents();
    sheet.clearFormats();
  }

  const envs   = allEnvelopes.filter(e => e.portfolio_id === portfolio.id);
  const stats  = calcPortfolioStats(portfolio.id, allEnvelopes, allPositions, priceByIsin, cryptoBySymbol);
  const { total, invested, alloc } = stats;
  const pv     = total - invested;
  const pvPct  = invested > 0 ? ((pv / invested) * 100).toFixed(2) : '0.00';
  const rebal  = calcRebalancing(portfolio, total, alloc);

  let row = 1;

  // ── TITRE ──────────────────────────────────────────────────────────────────
  row = writeTitle(sheet, row, portfolio, pvPct);

  // ── STATS GLOBALES ─────────────────────────────────────────────────────────
  row = writeGlobalStats(sheet, row, total, invested, pv, pvPct);

  // ── BARRE D'ALLOCATION ─────────────────────────────────────────────────────
  row = writeAllocSection(sheet, row, alloc, portfolio, total);

  // ── RÉÉQUILIBRAGE ──────────────────────────────────────────────────────────
  if (rebal.length > 0) {
    row = writeRebalancing(sheet, row, rebal);
  }

  // ── ENVELOPPES ─────────────────────────────────────────────────────────────
  row = writeSectionHeader(sheet, row, 'Enveloppes');
  envs.forEach(env => {
    row = renderEnvelopeBlock(sheet, row, env, allPositions, priceByIsin, cryptoBySymbol);
    setBg(sheet, row, 1, 1, 8, C.BG);
    row++;
  });
  if (!envs.length) {
    sheet.getRange(row, 1).setValue('Aucune enveloppe').setFontColor(C.MUTED).setFontSize(9).setBackground(C.CARD);
    bg8(sheet, row, C.CARD);
    row++;
  }

  // ── MISE EN FORME DES COLONNES ─────────────────────────────────────────────
  [220, 110, 110, 150, 120, 150, 80, 80].forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  sheet.setFrozenRows(0);
}

// ─── SECTIONS ────────────────────────────────────────────────────────────────

function writeTitle(sheet, row, portfolio, pvPct) {
  const pvSign = Number(pvPct) >= 0 ? '+' : '';
  mergeWrite(sheet, row, 1, 8, portfolio.nom,
    { size: 16, bold: true, fg: C.WHITE, bg: C.BG, align: 'left' });
  row++;

  const cibleStr = `Cible : ${portfolio.cible_actions}% actions · ${portfolio.cible_obligations}% obligations · ${portfolio.cible_cash}% cash`;
  mergeWrite(sheet, row, 1, 8, cibleStr,
    { size: 9, fg: C.MUTED, bg: C.BG });
  row++;

  mergeWrite(sheet, row, 1, 8, `Actualisé le ${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm')}`,
    { size: 8, fg: C.MUTED2, bg: C.BG });
  row++;

  setBg(sheet, row, 1, 1, 8, C.BG); row++;
  return row;
}

function writeGlobalStats(sheet, row, total, invested, pv, pvPct) {
  // Labels
  ['Valeur totale', 'Investi', 'Plus-value'].forEach((label, i) => {
    const col = i * 3 + 1;
    const span = i === 2 ? 2 : 2;
    mergeWrite(sheet, row, col, span, label,
      { size: 8, fg: C.MUTED, bg: C.CARD, align: 'center' });
  });
  row++;

  // Valeurs
  const pvColor = pv >= 0 ? C.GREEN : C.RED;
  mergeWrite(sheet, row, 1, 2, fmtEur(total),
    { size: 14, bold: true, fg: C.WHITE, bg: C.CARD, align: 'center' });
  mergeWrite(sheet, row, 3, 2, fmtEur(invested),
    { size: 14, bold: true, fg: C.WHITE, bg: C.CARD, align: 'center' });
  const pvLabel = `${pv >= 0 ? '+' : ''}${fmtEur(pv)}\n(${pv >= 0 ? '+' : ''}${pvPct}%)`;
  mergeWrite(sheet, row, 5, 2, `${pv >= 0 ? '+' : ''}${fmtEur(pv)} (${pv >= 0 ? '+' : ''}${pvPct}%)`,
    { size: 12, bold: true, fg: pvColor, bg: C.CARD, align: 'center' });
  setBg(sheet, row, 7, 1, 2, C.CARD);
  row++;

  setBg(sheet, row, 1, 1, 8, C.BG); row++;
  return row;
}

function writeAllocSection(sheet, row, alloc, portfolio, total) {
  // Ligne labels réels vs cible
  const cells = [
    [1, 'Allocation réelle', C.MUTED, 8, false],
    [2, `${alloc.actions}% actions`,    C.BLUE,  10, false],
    [3, `${alloc.obligations}% oblig.`, C.AMBER, 10, false],
    [4, `${alloc.cash}% cash`,          C.GREEN, 10, false],
    [5, 'Cible',                        C.MUTED, 8,  false],
    [6, `${portfolio.cible_actions}% actions`,    C.BLUE,  10, false],
    [7, `${portfolio.cible_obligations}% oblig.`, C.AMBER, 10, false],
    [8, `${portfolio.cible_cash}% cash`,          C.GREEN, 10, false],
  ];
  cells.forEach(([col, val, fg, size]) => {
    sheet.getRange(row, col)
      .setValue(val).setFontColor(fg).setFontSize(size).setBackground(C.CARD);
  });
  row++;

  // Barre visuelle (8 colonnes colorées proportionnellement)
  drawAllocBar(sheet, row, alloc);
  row++;

  // Montants par poche
  const amtCells = [
    [2, fmtEur(total * Number(alloc.actions)     / 100), C.BLUE],
    [3, fmtEur(total * Number(alloc.obligations) / 100), C.AMBER],
    [4, fmtEur(total * Number(alloc.cash)        / 100), C.GREEN],
  ];
  setBg(sheet, row, 1, 1, 8, C.CARD);
  sheet.getRange(row, 1).setValue('Montants').setFontColor(C.MUTED).setFontSize(8).setBackground(C.CARD);
  amtCells.forEach(([col, val, fg]) => {
    sheet.getRange(row, col).setValue(val).setFontColor(fg).setFontSize(9).setBackground(C.CARD);
  });
  row++;

  setBg(sheet, row, 1, 1, 8, C.BG); row++;
  return row;
}

function writeRebalancing(sheet, row, rebal) {
  writeSectionHeader(sheet, row, 'Suggestions de rééquilibrage');
  row++;

  rebal.forEach(s => {
    const buy = s.ecartEur > 0;
    const color = buy ? C.GREEN : C.RED;
    sheet.getRange(row, 1).setValue(s.label).setFontColor(C.MUTED).setFontSize(9).setBackground(C.CARD);
    sheet.getRange(row, 2).setValue(`${buy ? '▲ +' : '▼ '}${s.ecartEur.toLocaleString('fr-FR')} €`).setFontColor(color).setFontSize(10).setBackground(C.CARD);
    sheet.getRange(row, 3).setValue(`(${buy ? '+' : ''}${s.ecartPct}%)`).setFontColor(color).setFontSize(9).setBackground(C.CARD);
    setBg(sheet, row, 4, 1, 5, C.CARD);
    row++;
  });

  setBg(sheet, row, 1, 1, 8, C.BG); row++;
  return row;
}

function writeSectionHeader(sheet, row, label) {
  mergeWrite(sheet, row, 1, 8, label,
    { size: 11, bold: true, fg: C.WHITE, bg: C.BG });
  row++;
  return row;
}

// ─── BLOC ENVELOPPE ──────────────────────────────────────────────────────────

function renderEnvelopeBlock(sheet, startRow, env, allPositions, priceByIsin, cryptoBySymbol) {
  const positions = allPositions.filter(p => p.envelope_id === env.id);
  const { total, invested } = calcEnvelopeStats(env, positions, priceByIsin, cryptoBySymbol);
  const pv     = total - invested;
  const pvPct  = invested > 0 ? ((pv / invested) * 100).toFixed(1) : '0.0';
  const pvColor = pv >= 0 ? C.GREEN : C.RED;
  const typeBg  = { bourse: '#1d4ed8', crypto: '#6d28d9', 'épargne': '#065f46' };

  let row = startRow;

  // En-tête enveloppe
  sheet.getRange(row, 1).setValue(env.nom).setFontWeight('bold').setFontColor(C.WHITE).setFontSize(11).setBackground(C.CARD2);
  sheet.getRange(row, 2).setValue(env.type).setFontColor(C.WHITE).setFontSize(9).setBackground(typeBg[env.type] || C.CARD2).setHorizontalAlignment('center');
  sheet.getRange(row, 3).setValue(fmtEur(total)).setFontWeight('bold').setFontColor(C.WHITE).setFontSize(11).setBackground(C.CARD2);
  sheet.getRange(row, 4).setValue(`${pv >= 0 ? '+' : ''}${fmtEur(pv)} (${pvPct}%)`).setFontColor(pvColor).setFontSize(10).setBackground(C.CARD2);
  setBg(sheet, row, 5, 1, 4, C.CARD2);
  row++;

  if (!positions.length) {
    sheet.getRange(row, 1).setValue('Aucune position').setFontColor(C.MUTED2).setFontSize(8).setBackground(C.CARD);
    bg8(sheet, row, C.CARD);
    return row + 1;
  }

  // Récap allocation pour bourse
  if (env.type === 'bourse') {
    row = writeEnvelopeAllocBar(sheet, row, positions, priceByIsin);
  }

  // En-têtes du tableau positions
  const isEpargne = env.type === 'épargne';
  const isBourse  = env.type === 'bourse';
  const hdr = isEpargne
    ? ['Compte', 'Montant (€)', 'Taux (%)', '', '', '', '', '']
    : isBourse
      ? ['ISIN', 'Nom', 'Type', 'Qté × Prix achat', 'Valeur actuelle', 'Plus-value', '', '']
      : ['Symbole', 'Nom', 'Prix actuel', 'Quantité', 'Valeur actuelle', 'Plus-value', '', ''];

  hdr.forEach((h, i) => {
    sheet.getRange(row, i + 1).setValue(h)
      .setFontColor(C.MUTED2).setFontSize(8).setFontWeight('bold').setBackground(C.BG);
  });
  row++;

  // Tri actions d'abord, bonds ensuite
  const order = { action: 0, bond: 1 };
  const sorted = [...positions].sort((a, b) => {
    const tA = priceByIsin[a.identifiant]?.type || 'z';
    const tB = priceByIsin[b.identifiant]?.type || 'z';
    return (order[tA] ?? 2) - (order[tB] ?? 2);
  });

  sorted.forEach(pos => {
    row = writePositionRow(sheet, row, pos, env, isEpargne, isBourse, priceByIsin, cryptoBySymbol);
  });

  return row;
}

function writeEnvelopeAllocBar(sheet, row, positions, priceByIsin) {
  let actions = 0, bonds = 0;
  positions.forEach(pos => {
    const val = (Number(priceByIsin[pos.identifiant]?.prix_actuel) || 0) * Number(pos.quantite);
    const t = priceByIsin[pos.identifiant]?.type;
    if (t === 'action') actions += val;
    else if (t === 'bond') bonds += val;
  });
  const total = actions + bonds;
  if (!total) return row;

  const pctA = (actions / total * 100).toFixed(1);
  const pctB = (bonds   / total * 100).toFixed(1);

  sheet.getRange(row, 1).setValue('Répartition').setFontColor(C.MUTED).setFontSize(8).setBackground(C.CARD);
  sheet.getRange(row, 2).setValue(`Actions ${pctA}% — ${fmtEur(actions)}`).setFontColor(C.BLUE).setFontSize(9).setBackground(C.CARD);
  sheet.getRange(row, 3).setValue(`Bonds ${pctB}% — ${fmtEur(bonds)}`).setFontColor(C.AMBER).setFontSize(9).setBackground(C.CARD);
  setBg(sheet, row, 4, 1, 5, C.CARD);
  row++;

  // Barre visuelle 8 colonnes
  const actCols  = Math.max(0, Math.round(Number(pctA) / 100 * 8));
  const bondCols = Math.max(0, Math.min(8 - actCols, Math.round(Number(pctB) / 100 * 8)));
  const restCols = 8 - actCols - bondCols;
  let col = 1;
  if (actCols  > 0) { sheet.getRange(row, col, 1, actCols ).setBackground('#3b82f6'); col += actCols;  }
  if (bondCols > 0) { sheet.getRange(row, col, 1, bondCols).setBackground('#f59e0b'); col += bondCols; }
  if (restCols > 0) { sheet.getRange(row, col, 1, restCols).setBackground(C.CARD);                     }
  sheet.setRowHeight(row, 8);
  row++;

  return row;
}

function writePositionRow(sheet, row, pos, env, isEpargne, isBourse, priceByIsin, cryptoBySymbol) {
  const prix    = currentPriceCalc(pos.identifiant, env.type, priceByIsin, cryptoBySymbol);
  const pa      = Number(pos.prix_achat) || 0;
  const qty     = Number(pos.quantite)   || 0;
  const valAchat  = isEpargne ? pa : pa * qty;
  const valActuel = isEpargne ? pa : prix * qty;
  const posPv     = valActuel - valAchat;
  const posPvPct  = valAchat > 0 ? ((posPv / valAchat) * 100).toFixed(1) : '0.0';
  const posPvColor = posPv >= 0 ? C.GREEN : C.RED;

  const etfInfo  = priceByIsin[pos.identifiant];
  const etfType  = etfInfo?.type || '';
  const etfNom   = env.type === 'bourse'
    ? (etfInfo?.nom || '')
    : (cryptoBySymbol[String(pos.identifiant).toUpperCase()]?.nom || '');
  const label    = pos.nom || etfNom || pos.identifiant;
  const typeLabel = etfType === 'action' ? 'action' : etfType === 'bond' ? 'bond' : '';
  const typeFg   = etfType === 'action' ? C.BLUE : etfType === 'bond' ? C.AMBER : C.MUTED;
  const rowBg    = C.CARD;

  if (isEpargne) {
    sheet.getRange(row, 1).setValue(label).setFontColor(C.TEXT).setFontSize(9).setBackground(rowBg);
    sheet.getRange(row, 2).setValue(pa).setFontColor(C.WHITE).setFontSize(9).setBackground(rowBg).setNumberFormat('#,##0 "€"');
    sheet.getRange(row, 3).setValue(`${qty}%`).setFontColor(C.MUTED).setFontSize(9).setBackground(rowBg);
    setBg(sheet, row, 4, 1, 5, rowBg);
  } else {
    sheet.getRange(row, 1).setValue(pos.identifiant).setFontColor(C.MUTED).setFontSize(8).setBackground(rowBg);
    sheet.getRange(row, 2).setValue(label).setFontColor(C.TEXT).setFontSize(9).setBackground(rowBg);
    if (isBourse) {
      sheet.getRange(row, 3).setValue(typeLabel).setFontColor(typeFg).setFontSize(9).setBackground(rowBg);
    } else {
      sheet.getRange(row, 3).setValue(fmtEur(prix)).setFontColor(C.MUTED).setFontSize(9).setBackground(rowBg);
    }
    sheet.getRange(row, 4).setValue(`${qty} × ${fmtEur(pa)}`).setFontColor(C.MUTED).setFontSize(9).setBackground(rowBg);
    sheet.getRange(row, 5).setValue(fmtEur(valActuel)).setFontColor(C.WHITE).setFontSize(9).setBackground(rowBg);
    sheet.getRange(row, 6).setValue(`${posPv >= 0 ? '+' : ''}${fmtEur(posPv)} (${posPvPct}%)`).setFontColor(posPvColor).setFontSize(9).setBackground(rowBg);
    setBg(sheet, row, 7, 1, 2, rowBg);
  }
  row++;
  return row;
}

// ─── BARRE D'ALLOCATION GLOBALE ──────────────────────────────────────────────

function drawAllocBar(sheet, row, alloc) {
  const COLS    = 8;
  const actCols = Math.max(0, Math.round(Number(alloc.actions)     / 100 * COLS));
  const obCols  = Math.max(0, Math.min(COLS - actCols, Math.round(Number(alloc.obligations) / 100 * COLS)));
  const casCols = COLS - actCols - obCols;

  let col = 1;
  if (actCols > 0) { sheet.getRange(row, col, 1, actCols).setBackground('#3b82f6'); col += actCols; }
  if (obCols  > 0) { sheet.getRange(row, col, 1, obCols ).setBackground('#f59e0b'); col += obCols;  }
  if (casCols > 0) { sheet.getRange(row, col, 1, casCols).setBackground('#10b981');                 }
  sheet.setRowHeight(row, 12);
}

// ─── CALCULS (réplique exacte de la logique JS front) ────────────────────────

function currentPriceCalc(identifiant, type, priceByIsin, cryptoBySymbol) {
  if (type === 'bourse')  return Number(priceByIsin[identifiant]?.prix_actuel) || 0;
  if (type === 'crypto')  return Number(cryptoBySymbol[String(identifiant).toUpperCase()]?.prix_actuel) || 0;
  return 0;
}

function calcEnvelopeStats(env, positions, priceByIsin, cryptoBySymbol) {
  const isEpargne = env.type === 'épargne';
  let invested = 0, total = 0;
  positions.forEach(pos => {
    const qty  = Number(pos.quantite)   || 0;
    const pa   = Number(pos.prix_achat) || 0;
    const prix = currentPriceCalc(pos.identifiant, env.type, priceByIsin, cryptoBySymbol);
    invested += isEpargne ? pa : pa * qty;
    total    += isEpargne ? pa : prix * qty;
  });
  return { total, invested };
}

function calcPortfolioStats(portfolioId, allEnvelopes, allPositions, priceByIsin, cryptoBySymbol) {
  const envs = allEnvelopes.filter(e => e.portfolio_id === portfolioId);
  let total = 0, invested = 0, actions = 0, obligations = 0, cash = 0;

  envs.forEach(env => {
    const positions = allPositions.filter(p => p.envelope_id === env.id);
    const s = calcEnvelopeStats(env, positions, priceByIsin, cryptoBySymbol);
    total    += s.total;
    invested += s.invested;
    if (env.type === 'épargne') {
      cash += s.total;
    } else {
      positions.forEach(pos => {
        const pr  = currentPriceCalc(pos.identifiant, env.type, priceByIsin, cryptoBySymbol);
        const val = pr * (Number(pos.quantite) || 0);
        const t   = priceByIsin[pos.identifiant]?.type;
        if (env.type === 'crypto' || t === 'action') actions += val;
        else if (t === 'bond') obligations += val;
      });
    }
  });

  const alloc = total > 0
    ? {
        actions:     (actions / total * 100).toFixed(1),
        obligations: (obligations / total * 100).toFixed(1),
        cash:        (cash / total * 100).toFixed(1),
      }
    : { actions: 0, obligations: 0, cash: 0 };

  return { total, invested, alloc };
}

function calcRebalancing(portfolio, total, alloc) {
  if (!total) return [];
  return [
    { label: 'Actions',     actuel: alloc.actions,     cible: Number(portfolio.cible_actions) },
    { label: 'Obligations', actuel: alloc.obligations, cible: Number(portfolio.cible_obligations) },
    { label: 'Cash',        actuel: alloc.cash,        cible: Number(portfolio.cible_cash) },
  ].map(({ label, actuel, cible }) => {
    const ecartPct = (cible - Number(actuel)).toFixed(1);
    const ecartEur = Math.round((cible - Number(actuel)) / 100 * total);
    return { label, ecartPct, ecartEur };
  }).filter(s => Math.abs(s.ecartEur) > 100);
}

// ─── UTILITAIRES D'AFFICHAGE ─────────────────────────────────────────────────

// Palette de couleurs (dark slate theme)
const C = {
  BG:    '#0f172a',
  CARD:  '#1e293b',
  CARD2: '#162032',
  WHITE: '#ffffff',
  TEXT:  '#e2e8f0',
  MUTED: '#94a3b8',
  MUTED2:'#64748b',
  GREEN: '#34d399',
  RED:   '#f87171',
  BLUE:  '#60a5fa',
  AMBER: '#fbbf24',
};

function fmtEur(n) {
  return Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}

function mergeWrite(sheet, row, col, span, value, opts) {
  const range = span > 1
    ? sheet.getRange(row, col, 1, span).merge()
    : sheet.getRange(row, col);
  range.setValue(value);
  if (opts.size)   range.setFontSize(opts.size);
  if (opts.bold)   range.setFontWeight('bold');
  if (opts.fg)     range.setFontColor(opts.fg);
  if (opts.bg)     range.setBackground(opts.bg);
  if (opts.align)  range.setHorizontalAlignment(opts.align);
  return range;
}

function setBg(sheet, row, col, numRows, numCols, color) {
  sheet.getRange(row, col, numRows, numCols).setBackground(color);
}

function bg8(sheet, row, color) {
  sheet.getRange(row, 1, 1, 8).setBackground(color);
}
