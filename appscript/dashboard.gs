// dashboard.gs
// Génère un onglet "📊 NomPortfolio" par portfolio + "📊 Vue consolidée".
// Fonction principale : refreshDashboards()
// Note : sheetToObjects() est définie dans webapp.gs — partagée automatiquement.

const CONSOLIDATED_SHEET_NAME = '📊 Vue consolidée';

// ─── POINT D'ENTRÉE ───────────────────────────────────────────────────────────

function refreshDashboards() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const portfolios   = sheetToObjects(ss, 'portfolios');
  const envelopes    = sheetToObjects(ss, 'envelopes');
  const positions    = sheetToObjects(ss, 'positions');
  const prices       = sheetToObjects(ss, 'prices');
  const cryptoPrices = sheetToObjects(ss, 'crypto_prices');
  const charges      = sheetToObjects(ss, 'charges');
  const rawHistory   = sheetToObjects(ss, 'history');

  const priceByIsin    = {};
  prices.forEach(p => { priceByIsin[p.isin] = p; });
  const cryptoBySymbol = {};
  cryptoPrices.forEach(c => { cryptoBySymbol[String(c.symbole).toUpperCase()] = c; });

  // Normalise les dates history (Sheets renvoie des objets Date)
  const history = rawHistory.map(h => ({
    ...h,
    date:            h.date instanceof Date ? h.date.toISOString().slice(0, 10) : String(h.date).slice(0, 10),
    valeur_investie: Number(h.valeur_investie) || 0,
    valeur_actuelle: Number(h.valeur_actuelle) || 0,
    pv_euros:        Number(h.pv_euros)        || 0,
    pv_pct:          Number(h.pv_pct)          || 0,
  })).sort((a, b) => a.date.localeCompare(b.date));

  // Onglet consolidé
  renderConsolidatedSheet(ss, portfolios, envelopes, positions, priceByIsin, cryptoBySymbol, charges, history);

  // Un onglet par portfolio
  portfolios.forEach(portfolio => {
    renderPortfolioSheet(ss, portfolio, envelopes, positions, priceByIsin, cryptoBySymbol, charges, history);
  });

  // Supprime les onglets dashboard orphelins
  const validNames = new Set(portfolios.map(p => dashSheetName(p.nom)));
  validNames.add(CONSOLIDATED_SHEET_NAME);
  const reserved = new Set(['portfolios','sub_portfolios','envelopes','positions','prices','crypto_prices','history','charges']);
  ss.getSheets().forEach(sheet => {
    const name = sheet.getName();
    if (name.startsWith('📊 ') && !validNames.has(name) && !reserved.has(name)) {
      ss.deleteSheet(sheet);
    }
  });

  SpreadsheetApp.flush();
}

function dashSheetName(nom) { return `📊 ${nom}`; }

// ─── ONGLET CONSOLIDÉ ─────────────────────────────────────────────────────────

function renderConsolidatedSheet(ss, portfolios, allEnvelopes, allPositions, priceByIsin, cryptoBySymbol, charges, history) {
  let sheet = ss.getSheetByName(CONSOLIDATED_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONSOLIDATED_SHEET_NAME);
    ss.setActiveSheet(sheet);
    ss.moveActiveSheet(1);
  } else {
    sheet.clearContents();
    sheet.clearFormats();
  }

  let row = 1;

  // Titre
  mergeWrite(sheet, row, 1, 8, 'Vue consolidée',
    { size: 18, bold: true, fg: C.WHITE, bg: C.BG, align: 'left' });
  row++;
  mergeWrite(sheet, row, 1, 8, `Actualisé le ${fmtNow()}`,
    { size: 8, fg: C.MUTED2, bg: C.BG });
  row++;
  setBg(sheet, row, 1, 1, 8, C.BG); row++;

  // Stats globales
  let grandTotal = 0, grandInvested = 0;
  const allStats = portfolios.map(p => {
    const s = calcPortfolioStats(p.id, allEnvelopes, allPositions, priceByIsin, cryptoBySymbol);
    grandTotal    += s.total;
    grandInvested += s.invested;
    return { portfolio: p, ...s };
  });
  const grandCharges = charges.reduce((s, c) => s + (Number(c.montant) || 0), 0);
  const grandPv      = grandTotal - grandInvested;
  const grandPvPct   = grandInvested > 0 ? ((grandPv / grandInvested) * 100).toFixed(2) : '0.00';

  row = writeGlobalStats(sheet, row, grandTotal, grandInvested, grandPv, grandPvPct, grandCharges);

  // Historique global
  const globalHist = aggregateHistory(history, allEnvelopes.map(e => e.id));
  row = writeHistorySection(sheet, row, globalHist, 'Historique global');

  // Activité récente
  row = writeRecentActivity(sheet, row, allPositions, allEnvelopes);

  // Tableau récap par portfolio
  row = writeSectionHeader(sheet, row, 'Récapitulatif par portfolio');
  ['Portfolio', 'Total', 'Investi', 'Plus-value', 'PV %', 'Actions', 'Obligations', 'Cash'].forEach((h, i) => {
    sheet.getRange(row, i + 1).setValue(h)
      .setFontColor(C.MUTED2).setFontSize(8).setFontWeight('bold').setBackground(C.BG);
  });
  row++;

  allStats.forEach(({ portfolio, total, invested, alloc }) => {
    const pv      = total - invested;
    const pvPct   = invested > 0 ? ((pv / invested) * 100).toFixed(1) : '0.0';
    const pvColor = pv >= 0 ? C.GREEN : C.RED;
    sheet.getRange(row, 1).setValue(portfolio.nom).setFontColor(C.WHITE).setFontSize(10).setFontWeight('bold').setBackground(C.CARD);
    sheet.getRange(row, 2).setValue(fmtEur(total)).setFontColor(C.WHITE).setFontSize(10).setBackground(C.CARD);
    sheet.getRange(row, 3).setValue(fmtEur(invested)).setFontColor(C.MUTED).setFontSize(9).setBackground(C.CARD);
    sheet.getRange(row, 4).setValue(`${pv >= 0 ? '+' : ''}${fmtEur(pv)}`).setFontColor(pvColor).setFontSize(9).setBackground(C.CARD);
    sheet.getRange(row, 5).setValue(`${pv >= 0 ? '+' : ''}${pvPct}%`).setFontColor(pvColor).setFontSize(9).setBackground(C.CARD);
    sheet.getRange(row, 6).setValue(`${alloc.actions}%`).setFontColor(C.BLUE).setFontSize(9).setBackground(C.CARD);
    sheet.getRange(row, 7).setValue(`${alloc.obligations}%`).setFontColor(C.AMBER).setFontSize(9).setBackground(C.CARD);
    sheet.getRange(row, 8).setValue(`${alloc.cash}%`).setFontColor(C.GREEN).setFontSize(9).setBackground(C.CARD);
    row++;
  });
  setBg(sheet, row, 1, 1, 8, C.BG); row++;

  // Détail complet par portfolio
  allStats.forEach(({ portfolio, total, invested, alloc }) => {
    const pv         = total - invested;
    const pvPct      = invested > 0 ? ((pv / invested) * 100).toFixed(2) : '0.00';
    const envs       = allEnvelopes.filter(e => e.portfolio_id === portfolio.id);
    const rebal      = calcRebalancing(portfolio, total, alloc);
    const pfCharges  = charges.filter(c => c.portfolio_id === portfolio.id);
    const totalChg   = pfCharges.reduce((s, c) => s + (Number(c.montant) || 0), 0);

    row = writeTitle(sheet, row, portfolio, pvPct);
    row = writeGlobalStats(sheet, row, total, invested, pv, pvPct, totalChg);
    row = writeAllocSection(sheet, row, alloc, portfolio, total);
    if (rebal.length) row = writeRebalancing(sheet, row, rebal);

    row = writeSectionHeader(sheet, row, 'Enveloppes');
    row = envs.length
      ? writeEnvelopesByType(sheet, row, envs, allPositions, priceByIsin, cryptoBySymbol)
      : (sheet.getRange(row, 1).setValue('Aucune enveloppe').setFontColor(C.MUTED).setFontSize(9).setBackground(C.CARD), bg8(sheet, row, C.CARD), row + 1);

    if (pfCharges.length) row = writeChargesSection(sheet, row, pfCharges, totalChg);

    // Séparateur inter-portfolio
    sheet.getRange(row, 1, 1, 8)
      .setBackground('#1e3a5f')
      .setBorder(false, false, true, false, false, false, '#3b82f6', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    sheet.setRowHeight(row, 6);
    row++;
    setBg(sheet, row, 1, 1, 8, C.BG); row++;
  });

  [220, 110, 110, 150, 120, 150, 80, 80].forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  sheet.setFrozenRows(0);
}

// ─── ONGLET PAR PORTFOLIO ─────────────────────────────────────────────────────

function renderPortfolioSheet(ss, portfolio, allEnvelopes, allPositions, priceByIsin, cryptoBySymbol, charges, history) {
  const name  = dashSheetName(portfolio.nom);
  let sheet   = ss.getSheetByName(name);
  if (!sheet) { sheet = ss.insertSheet(name); }
  else        { sheet.clearContents(); sheet.clearFormats(); }

  const envs       = allEnvelopes.filter(e => e.portfolio_id === portfolio.id);
  const pfCharges  = charges.filter(c => c.portfolio_id === portfolio.id);
  const totalChg   = pfCharges.reduce((s, c) => s + (Number(c.montant) || 0), 0);
  const { total, invested, alloc } = calcPortfolioStats(portfolio.id, allEnvelopes, allPositions, priceByIsin, cryptoBySymbol);
  const pv         = total - invested;
  const pvPct      = invested > 0 ? ((pv / invested) * 100).toFixed(2) : '0.00';
  const rebal      = calcRebalancing(portfolio, total, alloc);
  const pfHist     = aggregateHistory(history, envs.map(e => e.id));

  let row = 1;
  row = writeTitle(sheet, row, portfolio, pvPct);
  row = writeGlobalStats(sheet, row, total, invested, pv, pvPct, totalChg);
  row = writeAllocSection(sheet, row, alloc, portfolio, total);
  if (rebal.length) row = writeRebalancing(sheet, row, rebal);
  row = writeHistorySection(sheet, row, pfHist, 'Historique');

  row = writeSectionHeader(sheet, row, 'Enveloppes');
  row = envs.length
    ? writeEnvelopesByType(sheet, row, envs, allPositions, priceByIsin, cryptoBySymbol)
    : (sheet.getRange(row, 1).setValue('Aucune enveloppe').setFontColor(C.MUTED).setFontSize(9).setBackground(C.CARD), bg8(sheet, row, C.CARD), row + 1);

  if (pfCharges.length) row = writeChargesSection(sheet, row, pfCharges, totalChg);

  [220, 110, 110, 150, 120, 150, 80, 80].forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  sheet.setFrozenRows(0);
}

// ─── SECTIONS DE BASE ─────────────────────────────────────────────────────────

function writeTitle(sheet, row, portfolio, pvPct) {
  mergeWrite(sheet, row, 1, 8, portfolio.nom,
    { size: 16, bold: true, fg: C.WHITE, bg: C.BG, align: 'left' });
  row++;
  mergeWrite(sheet, row, 1, 8,
    `Cible : ${portfolio.cible_actions}% actions · ${portfolio.cible_obligations}% obligations · ${portfolio.cible_cash}% cash`,
    { size: 9, fg: C.MUTED, bg: C.BG });
  row++;
  mergeWrite(sheet, row, 1, 8, `Actualisé le ${fmtNow()}`,
    { size: 8, fg: C.MUTED2, bg: C.BG });
  row++;
  setBg(sheet, row, 1, 1, 8, C.BG); row++;
  return row;
}

function writeGlobalStats(sheet, row, total, invested, pv, pvPct, totalCharges) {
  totalCharges = totalCharges || 0;
  const nette   = total - totalCharges;
  const pvColor = pv >= 0 ? C.GREEN : C.RED;

  // Labels
  ['Valeur totale', 'Investi', 'Plus-value'].forEach((label, i) => {
    mergeWrite(sheet, row, i * 3 + 1, 2, label,
      { size: 8, fg: C.MUTED, bg: C.CARD, align: 'center' });
  });
  setBg(sheet, row, 7, 1, 2, C.CARD);
  row++;

  // Valeurs
  const valLabel = totalCharges > 0
    ? `${fmtEur(nette)}  (brut ${fmtEur(total)})`
    : fmtEur(total);
  mergeWrite(sheet, row, 1, 2, valLabel,
    { size: 13, bold: true, fg: C.WHITE, bg: C.CARD, align: 'center' });
  mergeWrite(sheet, row, 3, 2, fmtEur(invested),
    { size: 13, bold: true, fg: C.WHITE, bg: C.CARD, align: 'center' });
  mergeWrite(sheet, row, 5, 2,
    `${pv >= 0 ? '+' : ''}${fmtEur(pv)} (${pv >= 0 ? '+' : ''}${pvPct}%)`,
    { size: 11, bold: true, fg: pvColor, bg: C.CARD, align: 'center' });
  setBg(sheet, row, 7, 1, 2, C.CARD);
  row++;

  // Ligne charges si applicable
  if (totalCharges > 0) {
    sheet.getRange(row, 1).setValue('Charges à venir').setFontColor(C.MUTED2).setFontSize(8).setBackground(C.CARD);
    sheet.getRange(row, 2).setValue(`−${fmtEur(totalCharges)}`).setFontColor(C.RED).setFontSize(9).setBackground(C.CARD);
    setBg(sheet, row, 3, 1, 6, C.CARD);
    row++;
  }

  setBg(sheet, row, 1, 1, 8, C.BG); row++;
  return row;
}

function writeAllocSection(sheet, row, alloc, portfolio, total) {
  [
    [1, 'Allocation réelle', C.MUTED, 8],
    [2, `${alloc.actions}% actions`,    C.BLUE,  10],
    [3, `${alloc.obligations}% oblig.`, C.AMBER, 10],
    [4, `${alloc.cash}% cash`,          C.GREEN, 10],
    [5, 'Cible',                        C.MUTED, 8],
    [6, `${portfolio.cible_actions}% actions`,    C.BLUE,  10],
    [7, `${portfolio.cible_obligations}% oblig.`, C.AMBER, 10],
    [8, `${portfolio.cible_cash}% cash`,          C.GREEN, 10],
  ].forEach(([col, val, fg, size]) => {
    sheet.getRange(row, col).setValue(val).setFontColor(fg).setFontSize(size).setBackground(C.CARD);
  });
  row++;

  drawAllocBar(sheet, row, alloc);
  row++;

  setBg(sheet, row, 1, 1, 8, C.CARD);
  sheet.getRange(row, 1).setValue('Montants').setFontColor(C.MUTED).setFontSize(8).setBackground(C.CARD);
  [[2, alloc.actions, C.BLUE], [3, alloc.obligations, C.AMBER], [4, alloc.cash, C.GREEN]].forEach(([col, pct, fg]) => {
    sheet.getRange(row, col).setValue(fmtEur(total * Number(pct) / 100)).setFontColor(fg).setFontSize(9).setBackground(C.CARD);
  });
  row++;

  setBg(sheet, row, 1, 1, 8, C.BG); row++;
  return row;
}

function writeRebalancing(sheet, row, rebal) {
  writeSectionHeader(sheet, row, 'Suggestions de rééquilibrage');
  row++;
  rebal.forEach(s => {
    const buy   = s.ecartEur > 0;
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
  mergeWrite(sheet, row, 1, 8, label, { size: 11, bold: true, fg: C.WHITE, bg: C.BG });
  return row + 1;
}

// ─── HISTORIQUE ──────────────────────────────────────────────────────────────

// Agrège les entrées history par date pour une liste d'envelope IDs
function aggregateHistory(history, envelopeIds) {
  const byDate = {};
  history.forEach(h => {
    if (!envelopeIds.includes(h.envelope_id)) return;
    if (!byDate[h.date]) byDate[h.date] = { date: h.date, valeur_investie: 0, valeur_actuelle: 0 };
    byDate[h.date].valeur_investie += h.valeur_investie;
    byDate[h.date].valeur_actuelle += h.valeur_actuelle;
  });
  return Object.values(byDate)
    .map(e => ({
      ...e,
      pv_euros: e.valeur_actuelle - e.valeur_investie,
      pv_pct:   e.valeur_investie > 0
        ? ((e.valeur_actuelle / e.valeur_investie - 1) * 100).toFixed(2)
        : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function writeHistorySection(sheet, row, entries, label) {
  if (!entries.length) return row;

  row = writeSectionHeader(sheet, row, label);

  // Ligne résumé : tendance globale
  const first      = entries[0];
  const last       = entries[entries.length - 1];
  const change     = last.valeur_actuelle - first.valeur_actuelle;
  const changePct  = first.valeur_actuelle > 0 ? ((change / first.valeur_actuelle) * 100).toFixed(2) : 0;
  const trendColor = change >= 0 ? C.GREEN : C.RED;
  const sign       = change >= 0 ? '+' : '';

  sheet.getRange(row, 1).setValue('Dernière valeur').setFontColor(C.MUTED).setFontSize(8).setBackground(C.CARD);
  sheet.getRange(row, 2).setValue(fmtEur(last.valeur_actuelle)).setFontColor(C.WHITE).setFontSize(11).setFontWeight('bold').setBackground(C.CARD);
  sheet.getRange(row, 3).setValue(`${sign}${fmtEur(change)} (${sign}${changePct}%)`).setFontColor(trendColor).setFontSize(10).setBackground(C.CARD);
  sheet.getRange(row, 4).setValue(`sur ${entries.length} entrée${entries.length > 1 ? 's' : ''}`).setFontColor(C.MUTED2).setFontSize(8).setBackground(C.CARD);
  setBg(sheet, row, 5, 1, 4, C.CARD);
  row++;

  // En-têtes
  ['Date', 'Valeur', 'Investi', 'Plus-value', 'PV %', '', '', ''].forEach((h, i) => {
    sheet.getRange(row, i + 1).setValue(h)
      .setFontColor(C.MUTED2).setFontSize(8).setFontWeight('bold').setBackground(C.BG);
  });
  row++;

  // Dernières 10 entrées, plus récent en premier
  entries.slice(-10).reverse().forEach(h => {
    const pv       = h.pv_euros;
    const pvColor  = pv >= 0 ? C.GREEN : C.RED;
    const dateLbl  = fmtDateStr(h.date);
    sheet.getRange(row, 1).setValue(dateLbl).setFontColor(C.MUTED).setFontSize(9).setBackground(C.CARD);
    sheet.getRange(row, 2).setValue(fmtEur(h.valeur_actuelle)).setFontColor(C.WHITE).setFontSize(9).setFontWeight('bold').setBackground(C.CARD);
    sheet.getRange(row, 3).setValue(fmtEur(h.valeur_investie)).setFontColor(C.MUTED).setFontSize(9).setBackground(C.CARD);
    sheet.getRange(row, 4).setValue(`${pv >= 0 ? '+' : ''}${fmtEur(pv)}`).setFontColor(pvColor).setFontSize(9).setBackground(C.CARD);
    sheet.getRange(row, 5).setValue(`${pv >= 0 ? '+' : ''}${Number(h.pv_pct).toFixed(2)}%`).setFontColor(pvColor).setFontSize(9).setBackground(C.CARD);
    setBg(sheet, row, 6, 1, 3, C.CARD);
    row++;
  });

  setBg(sheet, row, 1, 1, 8, C.BG); row++;
  return row;
}

// ─── ACTIVITÉ RÉCENTE ─────────────────────────────────────────────────────────

function writeRecentActivity(sheet, row, allPositions, allEnvelopes) {
  const recent = allPositions
    .filter(p => p.date_achat)
    .map(p => ({
      ...p,
      dateStr: p.date_achat instanceof Date
        ? p.date_achat.toISOString().slice(0, 10)
        : String(p.date_achat).slice(0, 10),
    }))
    .sort((a, b) => b.dateStr.localeCompare(a.dateStr))
    .slice(0, 5);

  if (!recent.length) return row;

  row = writeSectionHeader(sheet, row, 'Activité récente');
  ['Date', 'Identifiant', 'Enveloppe', 'Quantité', 'Prix achat', '', '', ''].forEach((h, i) => {
    sheet.getRange(row, i + 1).setValue(h)
      .setFontColor(C.MUTED2).setFontSize(8).setFontWeight('bold').setBackground(C.BG);
  });
  row++;

  recent.forEach(pos => {
    const env = allEnvelopes.find(e => e.id === pos.envelope_id);
    sheet.getRange(row, 1).setValue(fmtDateStr(pos.dateStr)).setFontColor(C.MUTED).setFontSize(9).setBackground(C.CARD);
    sheet.getRange(row, 2).setValue(pos.identifiant).setFontColor(C.TEXT).setFontSize(9).setBackground(C.CARD);
    sheet.getRange(row, 3).setValue(env?.nom || '').setFontColor(C.MUTED).setFontSize(9).setBackground(C.CARD);
    sheet.getRange(row, 4).setValue(pos.quantite).setFontColor(C.MUTED).setFontSize(9).setBackground(C.CARD);
    sheet.getRange(row, 5).setValue(fmtEur(Number(pos.prix_achat))).setFontColor(C.MUTED).setFontSize(9).setBackground(C.CARD);
    setBg(sheet, row, 6, 1, 3, C.CARD);
    row++;
  });

  setBg(sheet, row, 1, 1, 8, C.BG); row++;
  return row;
}

// ─── ENVELOPPES PAR TYPE ──────────────────────────────────────────────────────

function writeEnvelopesByType(sheet, row, envs, allPositions, priceByIsin, cryptoBySymbol) {
  const typeConfig = [
    { key: 'bourse',  label: 'Bourse',  bg: '#1d4ed8' },
    { key: 'crypto',  label: 'Crypto',  bg: '#6d28d9' },
    { key: 'épargne', label: 'Épargne', bg: '#065f46' },
  ];

  typeConfig.forEach(tc => {
    const group = envs.filter(e => e.type === tc.key);
    if (!group.length) return;

    // Total du groupe
    const groupTotal = group.reduce((sum, env) => {
      const pos = allPositions.filter(p => p.envelope_id === env.id);
      return sum + calcEnvelopeStats(env, pos, priceByIsin, cryptoBySymbol).total;
    }, 0);

    // En-tête de type (bande colorée)
    sheet.getRange(row, 1).setValue(tc.label).setFontColor(C.WHITE).setFontSize(10).setFontWeight('bold').setBackground(tc.bg);
    sheet.getRange(row, 2).setValue(fmtEur(groupTotal)).setFontColor(C.WHITE).setFontSize(10).setFontWeight('bold').setBackground(tc.bg);
    setBg(sheet, row, 3, 1, 6, tc.bg);
    row++;

    group.forEach(env => {
      row = renderEnvelopeBlock(sheet, row, env, allPositions, priceByIsin, cryptoBySymbol);
      setBg(sheet, row, 1, 1, 8, C.BG);
      row++;
    });
  });

  return row;
}

// ─── CHARGES ─────────────────────────────────────────────────────────────────

function writeChargesSection(sheet, row, pfCharges, totalCharges) {
  row = writeSectionHeader(sheet, row, 'Charges à venir');
  ['Nom', 'Montant', 'Date de fin', '', '', '', '', ''].forEach((h, i) => {
    sheet.getRange(row, i + 1).setValue(h)
      .setFontColor(C.MUTED2).setFontSize(8).setFontWeight('bold').setBackground(C.BG);
  });
  row++;

  pfCharges.forEach(c => {
    const dateFin = c.date_fin
      ? fmtDateStr(c.date_fin instanceof Date ? c.date_fin.toISOString().slice(0, 10) : String(c.date_fin).slice(0, 10))
      : '—';
    sheet.getRange(row, 1).setValue(c.nom).setFontColor(C.TEXT).setFontSize(9).setBackground(C.CARD);
    sheet.getRange(row, 2).setValue(`−${fmtEur(Number(c.montant))}`).setFontColor(C.RED).setFontSize(9).setFontWeight('bold').setBackground(C.CARD);
    sheet.getRange(row, 3).setValue(dateFin).setFontColor(C.MUTED).setFontSize(9).setBackground(C.CARD);
    setBg(sheet, row, 4, 1, 5, C.CARD);
    row++;
  });

  // Ligne total
  sheet.getRange(row, 1).setValue('Total charges').setFontColor(C.MUTED).setFontSize(9).setFontWeight('bold').setBackground(C.CARD);
  sheet.getRange(row, 2).setValue(`−${fmtEur(totalCharges)}`).setFontColor(C.RED).setFontSize(10).setFontWeight('bold').setBackground(C.CARD);
  setBg(sheet, row, 3, 1, 6, C.CARD);
  row++;

  setBg(sheet, row, 1, 1, 8, C.BG); row++;
  return row;
}

// ─── BLOC ENVELOPPE ──────────────────────────────────────────────────────────

function renderEnvelopeBlock(sheet, startRow, env, allPositions, priceByIsin, cryptoBySymbol) {
  const positions  = allPositions.filter(p => p.envelope_id === env.id);
  const { total, invested } = calcEnvelopeStats(env, positions, priceByIsin, cryptoBySymbol);
  const pv         = total - invested;
  const pvPct      = invested > 0 ? ((pv / invested) * 100).toFixed(1) : '0.0';
  const pvColor    = pv >= 0 ? C.GREEN : C.RED;
  const typeBg     = { bourse: '#1d4ed8', crypto: '#6d28d9', 'épargne': '#065f46' };

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

  if (env.type === 'bourse') row = writeEnvelopeAllocBar(sheet, row, positions, priceByIsin);

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

  // Tri : actions d'abord, bonds ensuite (pour bourse)
  const order  = { action: 0, bond: 1 };
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
    const t   = priceByIsin[pos.identifiant]?.type;
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
  const prix      = currentPriceCalc(pos.identifiant, env.type, priceByIsin, cryptoBySymbol);
  const pa        = Number(pos.prix_achat) || 0;
  const qty       = Number(pos.quantite)   || 0;
  const valAchat  = isEpargne ? pa : pa * qty;
  const valActuel = isEpargne ? pa : prix * qty;
  const posPv     = valActuel - valAchat;
  const posPvPct  = valAchat > 0 ? ((posPv / valAchat) * 100).toFixed(1) : '0.0';
  const pvColor   = posPv >= 0 ? C.GREEN : C.RED;

  const etfInfo   = priceByIsin[pos.identifiant];
  const etfNom    = env.type === 'bourse'
    ? (etfInfo?.nom || '')
    : (cryptoBySymbol[String(pos.identifiant).toUpperCase()]?.nom || '');
  const etfType   = etfInfo?.type || '';
  const label     = etfNom || pos.identifiant;
  const typeLabel = etfType === 'action' ? 'action' : etfType === 'bond' ? 'bond' : '';
  const typeFg    = etfType === 'action' ? C.BLUE : etfType === 'bond' ? C.AMBER : C.MUTED;

  if (isEpargne) {
    sheet.getRange(row, 1).setValue(label).setFontColor(C.TEXT).setFontSize(9).setBackground(C.CARD);
    sheet.getRange(row, 2).setValue(pa).setFontColor(C.WHITE).setFontSize(9).setBackground(C.CARD).setNumberFormat('#,##0 "€"');
    sheet.getRange(row, 3).setValue(`${qty}%`).setFontColor(C.MUTED).setFontSize(9).setBackground(C.CARD);
    setBg(sheet, row, 4, 1, 5, C.CARD);
  } else {
    sheet.getRange(row, 1).setValue(pos.identifiant).setFontColor(C.MUTED).setFontSize(8).setBackground(C.CARD);
    sheet.getRange(row, 2).setValue(label).setFontColor(C.TEXT).setFontSize(9).setBackground(C.CARD);
    sheet.getRange(row, 3).setValue(isBourse ? typeLabel : fmtEur(prix)).setFontColor(isBourse ? typeFg : C.MUTED).setFontSize(9).setBackground(C.CARD);
    sheet.getRange(row, 4).setValue(`${qty} × ${fmtEur(pa)}`).setFontColor(C.MUTED).setFontSize(9).setBackground(C.CARD);
    sheet.getRange(row, 5).setValue(fmtEur(valActuel)).setFontColor(C.WHITE).setFontSize(9).setBackground(C.CARD);
    sheet.getRange(row, 6).setValue(`${posPv >= 0 ? '+' : ''}${fmtEur(posPv)} (${posPvPct}%)`).setFontColor(pvColor).setFontSize(9).setBackground(C.CARD);
    setBg(sheet, row, 7, 1, 2, C.CARD);
  }
  return row + 1;
}

// ─── BARRE D'ALLOCATION ───────────────────────────────────────────────────────

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

// ─── CALCULS ─────────────────────────────────────────────────────────────────

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
        actions:     (actions     / total * 100).toFixed(1),
        obligations: (obligations / total * 100).toFixed(1),
        cash:        (cash        / total * 100).toFixed(1),
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

// "YYYY-MM-DD" → "JJ/MM/AAAA"
function fmtDateStr(dateStr) {
  const parts = String(dateStr).split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : dateStr;
}

function fmtNow() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
}

function mergeWrite(sheet, row, col, span, value, opts) {
  const range = span > 1
    ? sheet.getRange(row, col, 1, span).merge()
    : sheet.getRange(row, col);
  range.setValue(value);
  if (opts.size)  range.setFontSize(opts.size);
  if (opts.bold)  range.setFontWeight('bold');
  if (opts.fg)    range.setFontColor(opts.fg);
  if (opts.bg)    range.setBackground(opts.bg);
  if (opts.align) range.setHorizontalAlignment(opts.align);
  return range;
}

function setBg(sheet, row, col, numRows, numCols, color) {
  sheet.getRange(row, col, numRows, numCols).setBackground(color);
}

function bg8(sheet, row, color) {
  sheet.getRange(row, 1, 1, 8).setBackground(color);
}
