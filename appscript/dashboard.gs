// dashboard.gs
// Génère les onglets de reporting dans Google Sheets :
//   📊 Vue consolidée  — par portfolio (existant)
//   📊 NomPortfolio    — détail par portfolio (existant)
//   🏠 Immobilier      — rapport immobilier locatif
//   🏡 Résidences      — rapport résidences
//   💰 Dépenses        — rapport dépenses annuelles
//
// Fonction principale : refreshDashboards()
// Note : sheetToObjects() est définie dans webapp.gs — partagée automatiquement.

const CONSOLIDATED_SHEET_NAME = '📊 Vue consolidée';
const IMMO_SHEET_NAME         = '🏠 Immobilier';
const RESID_SHEET_NAME        = '🏡 Résidences';
const DEP_SHEET_NAME          = '💰 Dépenses';

// ─── POINT D'ENTRÉE ───────────────────────────────────────────────────────────

function refreshDashboards() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // ── Patrimoine financier ──────────────────────────────────────────────────
  const portfolios    = sheetToObjects(ss, 'portfolios');
  const envelopes     = sheetToObjects(ss, 'envelopes');
  const positions     = sheetToObjects(ss, 'positions');
  const prices        = sheetToObjects(ss, 'prices');
  const cryptoPrices  = sheetToObjects(ss, 'crypto_prices');
  const charges       = sheetToObjects(ss, 'charges');
  const rawHistory    = sheetToObjects(ss, 'history');

  const priceByIsin    = {};
  prices.forEach(p => { priceByIsin[p.isin] = p; });
  const cryptoBySymbol = {};
  cryptoPrices.forEach(c => { cryptoBySymbol[String(c.symbole).toUpperCase()] = c; });

  const history = rawHistory.map(h => ({
    ...h,
    date:            h.date instanceof Date ? h.date.toISOString().slice(0, 10) : String(h.date).slice(0, 10),
    valeur_investie: Number(h.valeur_investie) || 0,
    valeur_actuelle: Number(h.valeur_actuelle) || 0,
    pv_euros:        Number(h.pv_euros)        || 0,
    pv_pct:          Number(h.pv_pct)          || 0,
  })).sort((a, b) => a.date.localeCompare(b.date));

  // ── Immobilier locatif ────────────────────────────────────────────────────
  const biensImmo    = sheetToObjects(ss, 'biens_immo');
  const depensesImmo = sheetToObjects(ss, 'depenses_immo');

  // ── Résidences ────────────────────────────────────────────────────────────
  const residences = sheetToObjects(ss, 'residences');

  // ── Dépenses ──────────────────────────────────────────────────────────────
  const expCategories = sheetToObjects(ss, 'expense_categories');
  const expItems      = sheetToObjects(ss, 'expense_items');
  const expEntries    = sheetToObjects(ss, 'expense_entries');
  const expAids       = sheetToObjects(ss, 'expense_aids');

  // ── Rendu ─────────────────────────────────────────────────────────────────
  renderConsolidatedSheet(ss, portfolios, envelopes, positions, priceByIsin, cryptoBySymbol, charges, history);
  portfolios.forEach(portfolio => {
    renderPortfolioSheet(ss, portfolio, envelopes, positions, priceByIsin, cryptoBySymbol, charges, history);
  });

  if (biensImmo.length)  renderImmoSheet(ss, biensImmo, depensesImmo);
  if (residences.length) renderResidencesSheet(ss, residences);
  renderDepensesSheet(ss, expCategories, expItems, expEntries, expAids);

  // Supprime les onglets dashboard orphelins
  const validNames = new Set(portfolios.map(p => dashSheetName(p.nom)));
  validNames.add(CONSOLIDATED_SHEET_NAME);
  validNames.add(IMMO_SHEET_NAME);
  validNames.add(RESID_SHEET_NAME);
  validNames.add(DEP_SHEET_NAME);
  const reserved = new Set(['portfolios','sub_portfolios','envelopes','positions','prices',
    'crypto_prices','history','charges','biens_immo','depenses_immo','residences',
    'expense_categories','expense_items','expense_entries','expense_aids','fire_profile','vpw','ui_prefs']);
  ss.getSheets().forEach(sheet => {
    const name = sheet.getName();
    if ((name.startsWith('📊 ') || name.startsWith('🏠') || name.startsWith('🏡') || name.startsWith('💰'))
        && !validNames.has(name) && !reserved.has(name)) {
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

  mergeWrite(sheet, row, 1, 8, 'Vue consolidée',
    { size: 18, bold: true, fg: C.WHITE, bg: C.BG, align: 'left' });
  row++;
  mergeWrite(sheet, row, 1, 8, `Actualisé le ${fmtNow()}`,
    { size: 8, fg: C.MUTED2, bg: C.BG });
  row++;
  setBg(sheet, row, 1, 1, 8, C.BG); row++;

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

  const globalHist = aggregateHistory(history, allEnvelopes.map(e => e.id));
  row = writeHistorySection(sheet, row, globalHist, 'Historique global');
  row = writeRecentActivity(sheet, row, allPositions, allEnvelopes);

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

  allStats.forEach(({ portfolio, total, invested, alloc }) => {
    const pv        = total - invested;
    const pvPct     = invested > 0 ? ((pv / invested) * 100).toFixed(2) : '0.00';
    const envs      = allEnvelopes.filter(e => e.portfolio_id === portfolio.id);
    const rebal     = calcRebalancing(portfolio, total, alloc);
    const pfCharges = charges.filter(c => c.portfolio_id === portfolio.id);
    const totalChg  = pfCharges.reduce((s, c) => s + (Number(c.montant) || 0), 0);

    row = writeTitle(sheet, row, portfolio, pvPct);
    row = writeGlobalStats(sheet, row, total, invested, pv, pvPct, totalChg);
    row = writeAllocSection(sheet, row, alloc, portfolio, total);
    if (rebal.length) row = writeRebalancing(sheet, row, rebal);

    row = writeSectionHeader(sheet, row, 'Enveloppes');
    row = envs.length
      ? writeEnvelopesByType(sheet, row, envs, allPositions, priceByIsin, cryptoBySymbol)
      : (sheet.getRange(row, 1).setValue('Aucune enveloppe').setFontColor(C.MUTED).setFontSize(9).setBackground(C.CARD), bg8(sheet, row, C.CARD), row + 1);

    if (pfCharges.length) row = writeChargesSection(sheet, row, pfCharges, totalChg);

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

  const envs      = allEnvelopes.filter(e => e.portfolio_id === portfolio.id);
  const pfCharges = charges.filter(c => c.portfolio_id === portfolio.id);
  const totalChg  = pfCharges.reduce((s, c) => s + (Number(c.montant) || 0), 0);
  const { total, invested, alloc } = calcPortfolioStats(portfolio.id, allEnvelopes, allPositions, priceByIsin, cryptoBySymbol);
  const pv    = total - invested;
  const pvPct = invested > 0 ? ((pv / invested) * 100).toFixed(2) : '0.00';
  const rebal = calcRebalancing(portfolio, total, alloc);
  const pfHist = aggregateHistory(history, envs.map(e => e.id));

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

// ─── ONGLET IMMOBILIER LOCATIF ────────────────────────────────────────────────

function renderImmoSheet(ss, biensImmo, depensesImmo) {
  let sheet = ss.getSheetByName(IMMO_SHEET_NAME);
  if (!sheet) { sheet = ss.insertSheet(IMMO_SHEET_NAME); }
  else        { sheet.clearContents(); sheet.clearFormats(); }

  const now  = new Date();
  const year = now.getFullYear();
  let row = 1;

  // ── En-tête ──────────────────────────────────────────────────────────────
  mergeWrite(sheet, row, 1, 8, '🏠 Immobilier Locatif',
    { size: 18, bold: true, fg: C.WHITE, bg: C.BG, align: 'left' });
  row++;
  mergeWrite(sheet, row, 1, 8, `Synthèse au ${fmtNow()} · ${biensImmo.length} bien${biensImmo.length > 1 ? 's' : ''}`,
    { size: 8, fg: C.MUTED2, bg: C.BG });
  row++;
  setBg(sheet, row, 1, 1, 8, C.BG); row++;

  // ── Patrimoine global ─────────────────────────────────────────────────────
  let totalBrut = 0, totalCrd = 0, totalCfAnnTheo = 0, totalCfAnn = 0, totalRendBrut = 0;
  biensImmo.forEach(b => {
    const crd = immoCapitalRestantDu(b, now);
    const r   = immoRentabilite(b);
    const rr  = immoRentabiliteReelle(b, depensesImmo, year);
    totalBrut      += Number(b.prix_achat || 0);
    totalCrd       += crd;
    totalCfAnnTheo += r.cfAnnCredit;
    totalCfAnn     += rr.cfProjete || r.cfAnnPost;
    totalRendBrut  += r.rendBrut;
  });
  const avgRendBrut = biensImmo.length ? totalRendBrut / biensImmo.length : 0;
  const totalNet    = totalBrut - totalCrd;

  row = writeSectionHeader(sheet, row, `Patrimoine global · ${biensImmo.length} bien${biensImmo.length > 1 ? 's' : ''}`);

  // Ligne 1 : Brut / Net / Restant dû / Capital remboursé
  const totalRemb = biensImmo.reduce((s, b) => {
    const crd = immoCapitalRestantDu(b, now);
    return s + Math.max(0, Number(b.montant_credit || 0) - crd);
  }, 0);

  [['Valeur brute', fmtEur(totalBrut), C.WHITE],
   ['Capital remboursé', fmtEur(totalRemb), C.GREEN],
   ['Restant dû', fmtEur(totalCrd), C.AMBER],
   ['Valeur nette', fmtEur(totalNet), C.WHITE],
  ].forEach(([lbl, val, fg], i) => {
    const col = i * 2 + 1;
    sheet.getRange(row, col).setValue(lbl).setFontColor(C.MUTED).setFontSize(8).setBackground(C.CARD).setHorizontalAlignment('center');
    sheet.getRange(row, col + 1).setValue('').setBackground(C.CARD);
  });
  row++;
  [totalBrut, totalRemb, totalCrd, totalNet].forEach((val, i) => {
    const col = i * 2 + 1;
    const fg  = i === 1 ? C.GREEN : i === 2 ? C.AMBER : C.WHITE;
    mergeWrite(sheet, row, col, 2, fmtEur(val), { size: 12, bold: true, fg, bg: C.CARD, align: 'center' });
  });
  row++;

  // Ligne 2 : Cashflows et rendements
  [['CF théorique/mois', fmtEur(totalCfAnnTheo / 12) + '/mois', totalCfAnnTheo >= 0 ? C.GREEN : C.RED],
   ['CF projeté/mois', fmtEur(totalCfAnn / 12) + '/mois', totalCfAnn >= 0 ? C.GREEN : C.RED],
   ['Rdt brut moy.', avgRendBrut.toFixed(2) + '%', C.WHITE],
   ['Biens', biensImmo.length + ' bien' + (biensImmo.length > 1 ? 's' : ''), C.MUTED],
  ].forEach(([lbl, val, fg], i) => {
    const col = i * 2 + 1;
    sheet.getRange(row, col).setValue(lbl).setFontColor(C.MUTED).setFontSize(8).setBackground(C.CARD).setHorizontalAlignment('center');
    sheet.getRange(row, col + 1).setValue('').setBackground(C.CARD);
  });
  row++;
  [[totalCfAnnTheo / 12, fmtEur(totalCfAnnTheo / 12) + '/mois'],
   [totalCfAnn / 12,     fmtEur(totalCfAnn / 12)     + '/mois'],
   [1,                   avgRendBrut.toFixed(2) + '%'],
   [1,                   biensImmo.length + ' bien' + (biensImmo.length > 1 ? 's' : '')],
  ].forEach(([sign, label], i) => {
    const col = i * 2 + 1;
    const fg  = i < 2 ? (sign >= 0 ? C.GREEN : C.RED) : C.WHITE;
    mergeWrite(sheet, row, col, 2, label, { size: 11, bold: i < 2, fg, bg: C.CARD, align: 'center' });
  });
  row++;
  setBg(sheet, row, 1, 1, 8, C.BG); row++;

  // ── Détail par bien ───────────────────────────────────────────────────────
  biensImmo.forEach(b => {
    const r   = immoRentabilite(b);
    const rr  = immoRentabiliteReelle(b, depensesImmo, year);
    const crd = immoCapitalRestantDu(b, now);
    const remb = Math.max(0, Number(b.montant_credit || 0) - crd);
    const hasCr = Number(b.montant_credit || 0) > 0;
    const pctRemb = hasCr ? Math.round(remb / Number(b.montant_credit) * 100) : null;

    // Titre du bien
    sheet.getRange(row, 1, 1, 8).setBackground('#1e3a5f')
      .setBorder(false, false, false, false, false, false);
    mergeWrite(sheet, row, 1, 6, b.nom,
      { size: 13, bold: true, fg: C.WHITE, bg: '#1e3a5f', align: 'left' });
    sheet.getRange(row, 7).setValue(b.surface_m2 ? b.surface_m2 + ' m²' : '').setFontColor(C.MUTED).setFontSize(9).setBackground('#1e3a5f');
    sheet.getRange(row, 8).setValue('').setBackground('#1e3a5f');
    row++;

    // Infos générales
    [['Prix d\'achat', fmtEur(Number(b.prix_achat || 0)), C.WHITE],
     ['Loyer annuel HT', fmtEur(Number(b.loyer_annuel_ht || 0)), C.GREEN],
     ['Loyer mensuel HT', fmtEur(Number(b.loyer_annuel_ht || 0) / 12), C.GREEN],
     ['Taxe foncière', fmtEur(Number(b.taxe_fonciere || 0)) + '/an', C.MUTED],
    ].forEach(([lbl, val, fg], i) => {
      const col = i * 2 + 1;
      sheet.getRange(row, col).setValue(lbl).setFontColor(C.MUTED).setFontSize(8).setBackground(C.CARD).setHorizontalAlignment('center');
      sheet.getRange(row, col + 1).setValue('').setBackground(C.CARD);
    });
    row++;
    [fmtEur(Number(b.prix_achat || 0)),
     fmtEur(Number(b.loyer_annuel_ht || 0)),
     fmtEur(Number(b.loyer_annuel_ht || 0) / 12),
     fmtEur(Number(b.taxe_fonciere || 0)) + '/an',
    ].forEach((val, i) => {
      const col = i * 2 + 1;
      const fg  = i === 1 || i === 2 ? C.GREEN : C.WHITE;
      mergeWrite(sheet, row, col, 2, val, { size: 10, bold: true, fg, bg: C.CARD, align: 'center' });
    });
    row++;
    setBg(sheet, row, 1, 1, 8, C.BG); row++;

    // Rentabilité théorique
    row = writeSectionHeader(sheet, row, 'Rentabilité théorique');
    const colsTheo = hasCr
      ? ['Indicateur', 'Pendant crédit', 'Post crédit', '', '', '', '', '']
      : ['Indicateur', 'Valeur', '', '', '', '', '', ''];
    colsTheo.forEach((h, i) => {
      sheet.getRange(row, i + 1).setValue(h).setFontColor(C.MUTED2).setFontSize(8).setFontWeight('bold').setBackground(C.BG);
    });
    row++;

    [
      ['Rendement brut',    r.rendBrut.toFixed(2) + '%',                   r.rendBrut.toFixed(2) + '%',     C.WHITE,  C.WHITE],
      ['Rendement net',     r.rendNetCredit.toFixed(2) + '%',               r.rendNetPost.toFixed(2) + '%',  r.rendNetCredit >= 0 ? C.GREEN : C.RED, r.rendNetPost >= 0 ? C.GREEN : C.RED],
      ['Cashflow annuel',   (r.cfAnnCredit >= 0 ? '+' : '') + fmtEur(r.cfAnnCredit), (r.cfAnnPost >= 0 ? '+' : '') + fmtEur(r.cfAnnPost), r.cfAnnCredit >= 0 ? C.GREEN : C.RED, r.cfAnnPost >= 0 ? C.GREEN : C.RED],
      ['Cashflow mensuel',  (r.cfMensCredit >= 0 ? '+' : '') + fmtEur(r.cfMensCredit) + '/mois', (r.cfMensPost >= 0 ? '+' : '') + fmtEur(r.cfMensPost) + '/mois', r.cfMensCredit >= 0 ? C.GREEN : C.RED, r.cfMensPost >= 0 ? C.GREEN : C.RED],
    ].forEach(([label, valCredit, valPost, fgCredit, fgPost]) => {
      sheet.getRange(row, 1).setValue(label).setFontColor(C.TEXT).setFontSize(9).setBackground(C.CARD);
      if (hasCr) {
        sheet.getRange(row, 2).setValue(valCredit).setFontColor(fgCredit).setFontSize(9).setFontWeight('bold').setBackground(C.CARD);
        sheet.getRange(row, 3).setValue(valPost).setFontColor(fgPost).setFontSize(9).setBackground(C.CARD);
      } else {
        sheet.getRange(row, 2).setValue(valPost).setFontColor(fgPost).setFontSize(9).setFontWeight('bold').setBackground(C.CARD);
        sheet.getRange(row, 3).setValue('').setBackground(C.CARD);
      }
      setBg(sheet, row, 4, 1, 5, C.CARD);
      row++;
    });
    setBg(sheet, row, 1, 1, 8, C.BG); row++;

    // Réel année en cours
    row = writeSectionHeader(sheet, row, `Réel ${year}`);
    if (rr && (rr.moisLoyers > 0 || rr.moisCharges > 0)) {
      [
        ['Loyers HT perçus',   fmtEur(rr.loyersHt),                                       C.GREEN],
        ['Dépenses + TF',      '−' + fmtEur(rr.depenses + rr.taxe),                       C.RED],
        ['Cashflow réel YTD',  (rr.cfReel >= 0 ? '+' : '') + fmtEur(rr.cfReel),           rr.cfReel >= 0 ? C.GREEN : C.RED],
        ['Cashflow projeté',   (rr.cfProjete >= 0 ? '+' : '') + fmtEur(rr.cfProjete / 12) + '/mois', rr.cfProjete >= 0 ? C.GREEN : C.RED],
        ['Mois de données',    `${rr.moisLoyers} loyers · ${rr.moisCharges} charges`,      C.MUTED],
      ].forEach(([label, val, fg]) => {
        sheet.getRange(row, 1).setValue(label).setFontColor(C.TEXT).setFontSize(9).setBackground(C.CARD);
        sheet.getRange(row, 2).setValue(val).setFontColor(fg).setFontSize(9).setFontWeight('bold').setBackground(C.CARD);
        setBg(sheet, row, 3, 1, 6, C.CARD);
        row++;
      });
    } else {
      mergeWrite(sheet, row, 1, 8, `Aucune donnée saisie pour ${year}`, { size: 9, fg: C.MUTED, bg: C.CARD });
      row++;
    }
    setBg(sheet, row, 1, 1, 8, C.BG); row++;

    // Capital crédit
    if (hasCr) {
      row = writeSectionHeader(sheet, row, 'Capital crédit');
      [['Emprunté', fmtEur(Number(b.montant_credit)), C.WHITE],
       ['Remboursé', fmtEur(remb), C.GREEN],
       ['Restant dû', fmtEur(crd), C.AMBER],
       ['Mensualité', fmtEur(immoMensualite(b)) + '/mois', C.WHITE],
      ].forEach(([lbl, val, fg], i) => {
        const col = i * 2 + 1;
        sheet.getRange(row, col).setValue(lbl).setFontColor(C.MUTED).setFontSize(8).setBackground(C.CARD).setHorizontalAlignment('center');
        sheet.getRange(row, col + 1).setValue('').setBackground(C.CARD);
      });
      row++;
      [[Number(b.montant_credit), C.WHITE],
       [remb, C.GREEN],
       [crd,  C.AMBER],
       [null, C.WHITE],
      ].forEach(([val, fg], i) => {
        const col = i * 2 + 1;
        const label = i === 3 ? fmtEur(immoMensualite(b)) + '/mois' : fmtEur(val);
        mergeWrite(sheet, row, col, 2, label, { size: 11, bold: true, fg, bg: C.CARD, align: 'center' });
      });
      row++;

      // Détails crédit
      [
        ['Durée', b.duree_credit_mois + ' mois'],
        ['Taux annuel', (Number(b.taux_credit || 0) * 100).toFixed(2) + '%'],
        ['Avancement', pctRemb + '% remboursé'],
        b.numero_pret ? ['N° prêt', String(b.numero_pret)] : null,
        b.date_debut_credit ? ['Début', fmtDateStr(String(b.date_debut_credit).slice(0, 10))] : null,
      ].filter(Boolean).forEach(([lbl, val]) => {
        sheet.getRange(row, 1).setValue(lbl).setFontColor(C.MUTED).setFontSize(8).setBackground(C.CARD);
        sheet.getRange(row, 2).setValue(val).setFontColor(C.TEXT).setFontSize(9).setBackground(C.CARD);
        setBg(sheet, row, 3, 1, 6, C.CARD);
        row++;
      });

      // Barre de progression
      const filled = Math.max(0, Math.round(pctRemb / 100 * 8));
      const empty  = 8 - filled;
      if (filled > 0) sheet.getRange(row, 1, 1, filled).setBackground('#3b82f6');
      if (empty  > 0) sheet.getRange(row, filled + 1, 1, empty).setBackground('#334155');
      sheet.setRowHeight(row, 10);
      row++;

      setBg(sheet, row, 1, 1, 8, C.BG); row++;
    }

    // Séparateur
    sheet.getRange(row, 1, 1, 8).setBackground('#0f2a47').setRowHeight && sheet.setRowHeight(row, 4);
    row++;
    setBg(sheet, row, 1, 1, 8, C.BG); row++;
  });

  [220, 160, 140, 120, 120, 120, 80, 80].forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  sheet.setFrozenRows(0);
}

// ─── ONGLET RÉSIDENCES ────────────────────────────────────────────────────────

function renderResidencesSheet(ss, residences) {
  let sheet = ss.getSheetByName(RESID_SHEET_NAME);
  if (!sheet) { sheet = ss.insertSheet(RESID_SHEET_NAME); }
  else        { sheet.clearContents(); sheet.clearFormats(); }

  const now = new Date();
  let row = 1;

  // ── En-tête ──────────────────────────────────────────────────────────────
  mergeWrite(sheet, row, 1, 8, '🏡 Résidences',
    { size: 18, bold: true, fg: C.WHITE, bg: C.BG, align: 'left' });
  row++;
  mergeWrite(sheet, row, 1, 8, `${residences.length} bien${residences.length > 1 ? 's' : ''} · Synthèse au ${fmtNow()}`,
    { size: 8, fg: C.MUTED2, bg: C.BG });
  row++;
  setBg(sheet, row, 1, 1, 8, C.BG); row++;

  // ── Totaux globaux ────────────────────────────────────────────────────────
  let totalBrut = 0, totalNet = 0, totalDette = 0, totalRemb = 0, totalPv = 0;
  residences.forEach(r => {
    totalBrut  += residValeurPart(r);
    totalNet   += residPatrimoineNet(r, now);
    totalDette += residCapitalRestantDu(r, now);
    totalRemb  += residCapitalRembourse(r, now);
    totalPv    += residPlusValue(r);
  });

  row = writeSectionHeader(sheet, row, 'Patrimoine résidentiel');
  [['Valeur totale (parts)', fmtEur(Math.round(totalBrut)), C.WHITE],
   ['Patrimoine net', fmtEur(Math.round(totalNet)), C.GREEN],
   ['Restant dû', fmtEur(Math.round(totalDette)), C.AMBER],
   ['Plus-value latente', (totalPv >= 0 ? '+' : '') + fmtEur(Math.round(totalPv)), totalPv >= 0 ? C.GREEN : C.RED],
  ].forEach(([lbl, val, fg], i) => {
    const col = i * 2 + 1;
    sheet.getRange(row, col).setValue(lbl).setFontColor(C.MUTED).setFontSize(8).setBackground(C.CARD).setHorizontalAlignment('center');
    sheet.getRange(row, col + 1).setValue('').setBackground(C.CARD);
  });
  row++;
  [
    [fmtEur(Math.round(totalBrut)), C.WHITE],
    [fmtEur(Math.round(totalNet)),  C.GREEN],
    [fmtEur(Math.round(totalDette)), C.AMBER],
    [(totalPv >= 0 ? '+' : '') + fmtEur(Math.round(totalPv)), totalPv >= 0 ? C.GREEN : C.RED],
  ].forEach(([val, fg], i) => {
    mergeWrite(sheet, i * 2 + 1 <= 8 ? row : row, i * 2 + 1, 2, val, { size: 12, bold: true, fg, bg: C.CARD, align: 'center' });
  });
  row++;
  setBg(sheet, row, 1, 1, 8, C.BG); row++;

  // Tableau récap
  ['Résidence', 'Type', 'Part', 'Valeur estimée', 'Valeur ma part', 'Patrimoine net', '', ''].forEach((h, i) => {
    sheet.getRange(row, i + 1).setValue(h).setFontColor(C.MUTED2).setFontSize(8).setFontWeight('bold').setBackground(C.BG);
  });
  row++;
  residences.forEach(r => {
    const net     = Math.round(residPatrimoineNet(r, now));
    const valPart = Math.round(residValeurPart(r));
    const valRef  = Math.round(residValeurRef(r));
    const qp      = residQP(r);
    const typeLbl = r.type === 'principale' ? 'Principale' : r.type === 'secondaire' ? 'Secondaire' : 'Familiale';
    sheet.getRange(row, 1).setValue(r.nom).setFontColor(C.WHITE).setFontSize(10).setFontWeight('bold').setBackground(C.CARD);
    sheet.getRange(row, 2).setValue(typeLbl).setFontColor(C.BLUE).setFontSize(9).setBackground(C.CARD);
    sheet.getRange(row, 3).setValue(Math.round(qp * 100) + '%').setFontColor(C.MUTED).setFontSize(9).setBackground(C.CARD);
    sheet.getRange(row, 4).setValue(fmtEur(valRef)).setFontColor(C.MUTED).setFontSize(9).setBackground(C.CARD);
    sheet.getRange(row, 5).setValue(fmtEur(valPart)).setFontColor(C.WHITE).setFontSize(9).setBackground(C.CARD);
    sheet.getRange(row, 6).setValue(fmtEur(net)).setFontColor(net >= 0 ? C.GREEN : C.RED).setFontSize(9).setFontWeight('bold').setBackground(C.CARD);
    setBg(sheet, row, 7, 1, 2, C.CARD);
    row++;
  });
  setBg(sheet, row, 1, 1, 8, C.BG); row++;

  // ── Détail par résidence ──────────────────────────────────────────────────
  residences.forEach(r => {
    const qp      = residQP(r);
    const valTot  = residValeurRef(r);
    const valPart = residValeurPart(r);
    const pxPart  = residPrixAchatPart(r);
    const crd     = residCapitalRestantDu(r, now);
    const remb    = residCapitalRembourse(r, now);
    const net     = residPatrimoineNet(r, now);
    const pv      = residPlusValue(r);
    const C2      = Number(r.montant_credit || 0);
    const hasCr   = C2 > 0;
    const mens    = residMensualite(r);
    const assur   = Number(r.mensualite_assurance || 0);
    const soldee  = r.credit_part_soldee == 1 || r.credit_part_soldee === 'true' || r.credit_part_soldee === true;
    const pct     = hasCr ? Math.round((soldee ? C2 : remb) / C2 * 100) : 100;
    const typeLbl = r.type === 'principale' ? 'Principale' : r.type === 'secondaire' ? 'Secondaire' : 'Familiale';

    let dateFin = '—';
    if (hasCr && r.date_debut_credit && Number(r.duree_credit_mois)) {
      const d = new Date(r.date_debut_credit);
      d.setMonth(d.getMonth() + Number(r.duree_credit_mois));
      dateFin = Utilities.formatDate(d, Session.getScriptTimeZone(), 'MM/yyyy');
    }

    // Titre résidence
    sheet.getRange(row, 1, 1, 8).setBackground('#2d1f6e');
    mergeWrite(sheet, row, 1, 5, r.nom, { size: 13, bold: true, fg: C.WHITE, bg: '#2d1f6e', align: 'left' });
    sheet.getRange(row, 6).setValue(typeLbl).setFontColor('#c4b5fd').setFontSize(9).setBackground('#2d1f6e').setHorizontalAlignment('center');
    sheet.getRange(row, 7).setValue(qp < 1 ? 'Part : ' + Math.round(qp * 100) + '%' : '').setFontColor('#c4b5fd').setFontSize(8).setBackground('#2d1f6e');
    sheet.getRange(row, 8).setValue('').setBackground('#2d1f6e');
    row++;

    // Bloc patrimoine
    row = writeSectionHeader(sheet, row, 'Patrimoine');
    const patriRows = qp < 1
      ? [
          ["Prix d'achat total",      fmtEur(Number(r.prix_achat || 0)),     C.MUTED],
          ["Prix d'achat ma part",    fmtEur(Math.round(pxPart)),            C.TEXT],
          ['Valeur estimée totale',   fmtEur(Math.round(valTot)),            C.MUTED],
          ['Valeur estimée ma part',  fmtEur(Math.round(valPart)),           C.GREEN],
          ['Plus-value latente',      (pv >= 0 ? '+' : '') + fmtEur(Math.round(pv)), pv >= 0 ? C.GREEN : C.RED],
          ['Patrimoine net',          fmtEur(Math.round(net)),               C.GREEN],
        ]
      : [
          ["Prix d'achat",            fmtEur(Number(r.prix_achat || 0)),     C.TEXT],
          ['Valeur estimée',          fmtEur(Math.round(valPart)),           C.GREEN],
          ['Plus-value latente',      (pv >= 0 ? '+' : '') + fmtEur(Math.round(pv)), pv >= 0 ? C.GREEN : C.RED],
          hasCr ? ['Capital crédit',  fmtEur(C2),                           C.MUTED] : null,
          hasCr ? ['Capital remboursé', soldee ? fmtEur(C2) + ' ✓' : fmtEur(Math.round(remb)), C.BLUE] : null,
          hasCr ? ['Restant dû',      soldee ? 'Soldé ✓' : fmtEur(Math.round(crd)), crd > 0 ? C.AMBER : C.GREEN] : null,
          ['Patrimoine net',          fmtEur(Math.round(net)),               C.GREEN],
        ].filter(Boolean);

    patriRows.forEach(([lbl, val, fg]) => {
      sheet.getRange(row, 1).setValue(lbl).setFontColor(C.TEXT).setFontSize(9).setBackground(C.CARD);
      sheet.getRange(row, 2).setValue(val).setFontColor(fg).setFontSize(9).setFontWeight(lbl === 'Patrimoine net' ? 'bold' : 'normal').setBackground(C.CARD);
      setBg(sheet, row, 3, 1, 6, C.CARD);
      row++;
    });

    // Barre progression crédit
    if (hasCr && qp >= 1) {
      const filled = Math.max(0, Math.round(pct / 100 * 8));
      const empty  = 8 - filled;
      if (filled > 0) sheet.getRange(row, 1, 1, filled).setBackground('#3b82f6');
      if (empty  > 0) sheet.getRange(row, filled + 1, 1, empty).setBackground('#334155');
      sheet.setRowHeight(row, 8);
      row++;
      mergeWrite(sheet, row, 1, 8, (soldee ? '100% — Soldé ✓' : pct + '% remboursé'),
        { size: 8, fg: C.MUTED, bg: C.CARD, align: 'right' });
      row++;
    }
    setBg(sheet, row, 1, 1, 8, C.BG); row++;

    // Bloc crédit
    if (hasCr) {
      row = writeSectionHeader(sheet, row, 'Crédit');
      [
        ['Montant',           fmtEur(C2),                                        C.WHITE],
        ['Durée',             r.duree_credit_mois + ' mois',                     C.TEXT],
        ['Taux annuel',       (Number(r.taux_credit || 0) * 100).toFixed(2) + '%', C.TEXT],
        ['Mensualité crédit', fmtEur(Math.round(mens)) + '/mois',                C.AMBER],
        assur > 0 ? ['Assurance', fmtEur(assur) + '/mois', C.TEXT] : null,
        ['Mensualité totale', fmtEur(Math.round(mens + assur)) + '/mois',        C.WHITE],
        r.numero_pret ? ['N° prêt', String(r.numero_pret), C.MUTED] : null,
        r.date_debut_credit ? ['Début crédit', fmtDateStr(String(r.date_debut_credit).slice(0, 10)), C.TEXT] : null,
        ['Fin estimée', dateFin, C.TEXT],
      ].filter(Boolean).forEach(([lbl, val, fg]) => {
        sheet.getRange(row, 1).setValue(lbl).setFontColor(C.TEXT).setFontSize(9).setBackground(C.CARD);
        sheet.getRange(row, 2).setValue(val).setFontColor(fg).setFontSize(9).setFontWeight('bold').setBackground(C.CARD);
        setBg(sheet, row, 3, 1, 6, C.CARD);
        row++;
      });
      setBg(sheet, row, 1, 1, 8, C.BG); row++;
    }

    // Bloc caractéristiques
    row = writeSectionHeader(sheet, row, 'Caractéristiques');
    [
      ['Type', typeLbl],
      ['Quote-part', Math.round(qp * 100) + '%'],
      r.date_valeur_estimee ? ['Valeur MAJ le', fmtDateStr(String(r.date_valeur_estimee).slice(0, 10))] : null,
    ].filter(Boolean).forEach(([lbl, val]) => {
      sheet.getRange(row, 1).setValue(lbl).setFontColor(C.TEXT).setFontSize(9).setBackground(C.CARD);
      sheet.getRange(row, 2).setValue(val).setFontColor(C.MUTED).setFontSize(9).setBackground(C.CARD);
      setBg(sheet, row, 3, 1, 6, C.CARD);
      row++;
    });
    setBg(sheet, row, 1, 1, 8, C.BG); row++;

    // Séparateur
    sheet.getRange(row, 1, 1, 8).setBackground('#1a0d4a');
    sheet.setRowHeight(row, 4);
    row++;
    setBg(sheet, row, 1, 1, 8, C.BG); row++;
  });

  [220, 160, 100, 100, 100, 100, 80, 80].forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  sheet.setFrozenRows(0);
}

// ─── ONGLET DÉPENSES ──────────────────────────────────────────────────────────

function renderDepensesSheet(ss, categories, items, entries, aids) {
  let sheet = ss.getSheetByName(DEP_SHEET_NAME);
  if (!sheet) { sheet = ss.insertSheet(DEP_SHEET_NAME); }
  else        { sheet.clearContents(); sheet.clearFormats(); }

  const year = new Date().getFullYear();
  let row = 1;

  // ── En-tête ──────────────────────────────────────────────────────────────
  mergeWrite(sheet, row, 1, 8, `💰 Dépenses ${year}`,
    { size: 18, bold: true, fg: C.WHITE, bg: C.BG, align: 'left' });
  row++;
  mergeWrite(sheet, row, 1, 8, `Actualisé le ${fmtNow()}`,
    { size: 8, fg: C.MUTED2, bg: C.BG });
  row++;
  setBg(sheet, row, 1, 1, 8, C.BG); row++;

  // ── Calculs ───────────────────────────────────────────────────────────────
  // Map entry: "itemId_year_month" → montant
  const entryMap = {};
  entries.forEach(e => {
    const annee = Number(e.annee || e.year || 0);
    const mois  = Number(e.mois  || e.month || 0);
    entryMap[`${e.item_id}_${annee}_${mois}`] = Number(e.montant || 0);
  });

  // Mois avec au moins une entrée pour l'année
  const monthsWithData = new Set();
  entries.filter(e => Number(e.annee || e.year) === year).forEach(e => {
    monthsWithData.add(Number(e.mois || e.month));
  });
  const trackedMonths = monthsWithData.size || 1;

  // Grand total
  let grandTotal = 0;
  items.forEach(item => {
    for (let m = 1; m <= 12; m++) grandTotal += entryMap[`${item.id}_${year}_${m}`] || 0;
  });
  const grandAvg   = grandTotal / trackedMonths;
  const aidsTotal  = aids.reduce((s, a) => s + Number(a.montant || 0), 0);

  // ── Synthèse ─────────────────────────────────────────────────────────────
  row = writeSectionHeader(sheet, row, 'Synthèse');
  [['Total dépenses ' + year, fmtEur(grandTotal),        C.RED],
   ['Moyenne mensuelle',      fmtEur(grandAvg) + '/mois', C.WHITE],
   ['Mois de données',        trackedMonths + ' mois',    C.MUTED],
   ['Aides mensuelles',       fmtEur(aidsTotal) + '/mois', C.GREEN],
  ].forEach(([lbl, val, fg], i) => {
    const col = i * 2 + 1;
    sheet.getRange(row, col).setValue(lbl).setFontColor(C.MUTED).setFontSize(8).setBackground(C.CARD).setHorizontalAlignment('center');
    sheet.getRange(row, col + 1).setValue('').setBackground(C.CARD);
  });
  row++;
  [[fmtEur(grandTotal), C.RED],
   [fmtEur(grandAvg) + '/mois', C.WHITE],
   [trackedMonths + ' mois', C.MUTED],
   [fmtEur(aidsTotal) + '/mois', C.GREEN],
  ].forEach(([val, fg], i) => {
    mergeWrite(sheet, row, i * 2 + 1, 2, val, { size: 12, bold: true, fg, bg: C.CARD, align: 'center' });
  });
  row++;
  setBg(sheet, row, 1, 1, 8, C.BG); row++;

  // ── Détail par type ───────────────────────────────────────────────────────
  const TYPES = [
    { key: 'vital',    label: 'Vital',    bg: '#7c3aed' },
    { key: 'confort',  label: 'Confort',  bg: '#1d4ed8' },
    { key: 'loisir',   label: 'Loisirs',  bg: '#065f46' },
    { key: 'épargne',  label: 'Épargne',  bg: '#b45309' },
    { key: 'immo',     label: 'Immo',     bg: '#1e3a5f' },
    { key: 'autre',    label: 'Autre',    bg: '#374151' },
  ];

  row = writeSectionHeader(sheet, row, 'Détail par type');

  TYPES.forEach(type => {
    const typeCats = categories.filter(c => c.type === type.key);
    if (!typeCats.length) return;

    // Calcul du total du type
    let typeTotal = 0;
    typeCats.forEach(cat => {
      const catItems = items.filter(i => i.category_id === cat.id);
      catItems.forEach(item => {
        for (let m = 1; m <= 12; m++) typeTotal += entryMap[`${item.id}_${year}_${m}`] || 0;
      });
    });
    if (!typeTotal) return;

    const typeAvg = typeTotal / trackedMonths;

    // En-tête type
    mergeWrite(sheet, row, 1, 4, type.label, { size: 11, bold: true, fg: C.WHITE, bg: type.bg });
    mergeWrite(sheet, row, 5, 2, fmtEur(typeTotal), { size: 11, bold: true, fg: C.WHITE, bg: type.bg, align: 'right' });
    mergeWrite(sheet, row, 7, 2, fmtEur(typeAvg) + '/mois', { size: 9, fg: C.WHITE, bg: type.bg, align: 'right' });
    row++;

    // En-têtes colonnes
    ['Catégorie / Poste', '', '', '', 'Total ' + year, '', 'Moy./mois', ''].forEach((h, i) => {
      sheet.getRange(row, i + 1).setValue(h).setFontColor(C.MUTED2).setFontSize(8).setFontWeight('bold').setBackground(C.BG);
    });
    row++;

    // Tri catégories par ordre
    const sortedCats = typeCats.slice().sort((a, b) => {
      const oa = a.ordre !== undefined && a.ordre !== '' ? Number(a.ordre) : Infinity;
      const ob = b.ordre !== undefined && b.ordre !== '' ? Number(b.ordre) : Infinity;
      return oa - ob;
    });

    sortedCats.forEach(cat => {
      const catItems = items.filter(i => i.category_id === cat.id);
      let catTotal = 0;
      catItems.forEach(item => {
        for (let m = 1; m <= 12; m++) catTotal += entryMap[`${item.id}_${year}_${m}`] || 0;
      });
      if (!catTotal) return;
      const catAvg = catTotal / trackedMonths;

      // Ligne catégorie
      mergeWrite(sheet, row, 1, 4, cat.nom, { size: 10, bold: true, fg: C.TEXT, bg: C.CARD2 });
      mergeWrite(sheet, row, 5, 2, fmtEur(catTotal), { size: 10, bold: true, fg: C.WHITE, bg: C.CARD2, align: 'right' });
      mergeWrite(sheet, row, 7, 2, fmtEur(catAvg) + '/mois', { size: 9, fg: C.MUTED, bg: C.CARD2, align: 'right' });
      row++;

      // Lignes postes (sous-items)
      catItems.forEach(item => {
        let itemTotal = 0;
        for (let m = 1; m <= 12; m++) itemTotal += entryMap[`${item.id}_${year}_${m}`] || 0;
        if (!itemTotal) return;
        const itemAvg = itemTotal / trackedMonths;

        sheet.getRange(row, 1).setValue('').setBackground(C.CARD);
        mergeWrite(sheet, row, 2, 3, '↳ ' + item.nom, { size: 9, fg: C.MUTED, bg: C.CARD });
        mergeWrite(sheet, row, 5, 2, fmtEur(itemTotal), { size: 9, fg: C.MUTED, bg: C.CARD, align: 'right' });
        mergeWrite(sheet, row, 7, 2, fmtEur(itemAvg) + '/mois', { size: 8, fg: C.MUTED2, bg: C.CARD, align: 'right' });
        row++;
      });
    });

    // Ligne sous-total type
    mergeWrite(sheet, row, 1, 4, 'Sous-total ' + type.label,
      { size: 9, bold: true, fg: C.WHITE, bg: '#1e293b' });
    mergeWrite(sheet, row, 5, 2, fmtEur(typeTotal),
      { size: 9, bold: true, fg: C.WHITE, bg: '#1e293b', align: 'right' });
    mergeWrite(sheet, row, 7, 2, fmtEur(typeAvg) + '/mois',
      { size: 9, fg: C.MUTED, bg: '#1e293b', align: 'right' });
    row++;
    setBg(sheet, row, 1, 1, 8, C.BG); row++;
  });

  // ── Aides mensuelles ──────────────────────────────────────────────────────
  if (aids.length) {
    row = writeSectionHeader(sheet, row, 'Aides & revenus mensuels');
    ['Aide', '', '', '', 'Montant mensuel', '', '', ''].forEach((h, i) => {
      sheet.getRange(row, i + 1).setValue(h).setFontColor(C.MUTED2).setFontSize(8).setFontWeight('bold').setBackground(C.BG);
    });
    row++;

    aids.forEach(a => {
      mergeWrite(sheet, row, 1, 4, a.nom || a.label || '—', { size: 9, fg: C.TEXT, bg: C.CARD });
      mergeWrite(sheet, row, 5, 2, fmtEur(Number(a.montant || 0)) + '/mois', { size: 9, bold: true, fg: C.GREEN, bg: C.CARD, align: 'right' });
      setBg(sheet, row, 7, 1, 2, C.CARD);
      row++;
    });

    // Total aides
    mergeWrite(sheet, row, 1, 4, 'Total aides', { size: 9, bold: true, fg: C.WHITE, bg: C.CARD2 });
    mergeWrite(sheet, row, 5, 2, fmtEur(aidsTotal) + '/mois', { size: 10, bold: true, fg: C.GREEN, bg: C.CARD2, align: 'right' });
    setBg(sheet, row, 7, 1, 2, C.CARD2);
    row++;
    setBg(sheet, row, 1, 1, 8, C.BG); row++;
  }

  // ── Grand total ───────────────────────────────────────────────────────────
  row = writeSectionHeader(sheet, row, 'Grand total');
  [
    ['Total brut ' + year, fmtEur(grandTotal), C.RED],
    ['Aides mensuelles', '−' + fmtEur(aidsTotal * 12) + '/an', C.GREEN],
    ['Net annuel', fmtEur(grandTotal - aidsTotal * 12), C.WHITE],
    ['Moy. mensuelle nette', fmtEur((grandTotal - aidsTotal * 12) / trackedMonths) + '/mois', C.WHITE],
  ].forEach(([lbl, val, fg]) => {
    sheet.getRange(row, 1).setValue(lbl).setFontColor(C.TEXT).setFontSize(9).setBackground(C.CARD);
    sheet.getRange(row, 2).setValue(val).setFontColor(fg).setFontSize(10).setFontWeight('bold').setBackground(C.CARD);
    setBg(sheet, row, 3, 1, 6, C.CARD);
    row++;
  });
  setBg(sheet, row, 1, 1, 8, C.BG); row++;

  [220, 80, 80, 80, 120, 60, 120, 60].forEach((w, i) => sheet.setColumnWidth(i + 1, w));
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

  setBg(sheet, row, 1, 1, 8, C.CARD);
  const valLabel = totalCharges > 0 ? 'Valeur nette' : 'Valeur totale';
  if (!totalCharges) {
    mergeWrite(sheet, row, 1, 2, valLabel, { size: 8, fg: C.MUTED, bg: C.CARD, align: 'center' });
  } else {
    sheet.getRange(row, 1).setValue(valLabel).setFontColor(C.MUTED).setFontSize(8).setBackground(C.CARD).setHorizontalAlignment('center');
    sheet.getRange(row, 2).setValue('Valeur brute').setFontColor(C.MUTED).setFontSize(8).setBackground(C.CARD).setHorizontalAlignment('center');
  }
  mergeWrite(sheet, row, 3, 2, 'Investi',    { size: 8, fg: C.MUTED, bg: C.CARD, align: 'center' });
  mergeWrite(sheet, row, 5, 2, 'Plus-value', { size: 8, fg: C.MUTED, bg: C.CARD, align: 'center' });
  setBg(sheet, row, 7, 1, 2, C.CARD);
  row++;

  const mainVal = totalCharges > 0 ? nette : total;
  sheet.getRange(row, 1).setValue(mainVal).setFontSize(13).setFontWeight('bold').setFontColor(C.WHITE)
    .setBackground(C.CARD).setHorizontalAlignment('center').setNumberFormat('#,##0');
  if (totalCharges > 0) {
    sheet.getRange(row, 2).setValue(total).setFontSize(10).setFontColor(C.MUTED).setBackground(C.CARD)
      .setHorizontalAlignment('center').setNumberFormat('#,##0');
  } else {
    sheet.getRange(row, 2).setValue('').setBackground(C.CARD);
  }
  mergeWrite(sheet, row, 3, 2, fmtEur(invested),
    { size: 13, bold: true, fg: C.WHITE, bg: C.CARD, align: 'center' });
  mergeWrite(sheet, row, 5, 2,
    `${pv >= 0 ? '+' : ''}${fmtEur(pv)} (${pv >= 0 ? '+' : ''}${pvPct}%)`,
    { size: 11, bold: true, fg: pvColor, bg: C.CARD, align: 'center' });
  setBg(sheet, row, 7, 1, 2, C.CARD);
  row++;

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

  const first     = entries[0];
  const last      = entries[entries.length - 1];
  const change    = last.valeur_actuelle - first.valeur_actuelle;
  const changePct = first.valeur_actuelle > 0 ? ((change / first.valeur_actuelle) * 100).toFixed(2) : 0;
  const trendColor = change >= 0 ? C.GREEN : C.RED;
  const sign       = change >= 0 ? '+' : '';

  sheet.getRange(row, 1).setValue('Dernière valeur').setFontColor(C.MUTED).setFontSize(8).setBackground(C.CARD);
  sheet.getRange(row, 2).setValue(fmtEur(last.valeur_actuelle)).setFontColor(C.WHITE).setFontSize(11).setFontWeight('bold').setBackground(C.CARD);
  sheet.getRange(row, 3).setValue(`${sign}${fmtEur(change)} (${sign}${changePct}%)`).setFontColor(trendColor).setFontSize(10).setBackground(C.CARD);
  sheet.getRange(row, 4).setValue(`sur ${entries.length} entrée${entries.length > 1 ? 's' : ''}`).setFontColor(C.MUTED2).setFontSize(8).setBackground(C.CARD);
  setBg(sheet, row, 5, 1, 4, C.CARD);
  row++;

  ['Date', 'Valeur', 'Investi', 'Plus-value', 'PV %', '', '', ''].forEach((h, i) => {
    sheet.getRange(row, i + 1).setValue(h).setFontColor(C.MUTED2).setFontSize(8).setFontWeight('bold').setBackground(C.BG);
  });
  row++;

  entries.slice(-10).reverse().forEach(h => {
    const pv      = h.pv_euros;
    const pvColor = pv >= 0 ? C.GREEN : C.RED;
    sheet.getRange(row, 1).setValue(fmtDateStr(h.date)).setFontColor(C.MUTED).setFontSize(9).setBackground(C.CARD);
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
    sheet.getRange(row, i + 1).setValue(h).setFontColor(C.MUTED2).setFontSize(8).setFontWeight('bold').setBackground(C.BG);
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

    const groupTotal = group.reduce((sum, env) => {
      const pos = allPositions.filter(p => p.envelope_id === env.id);
      return sum + calcEnvelopeStats(env, pos, priceByIsin, cryptoBySymbol).total;
    }, 0);

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
    sheet.getRange(row, i + 1).setValue(h).setFontColor(C.MUTED2).setFontSize(8).setFontWeight('bold').setBackground(C.BG);
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

  sheet.getRange(row, 1).setValue('Total charges').setFontColor(C.MUTED).setFontSize(9).setFontWeight('bold').setBackground(C.CARD);
  sheet.getRange(row, 2).setValue(`−${fmtEur(totalCharges)}`).setFontColor(C.RED).setFontSize(10).setFontWeight('bold').setBackground(C.CARD);
  setBg(sheet, row, 3, 1, 6, C.CARD);
  row++;

  setBg(sheet, row, 1, 1, 8, C.BG); row++;
  return row;
}

// ─── BLOC ENVELOPPE ──────────────────────────────────────────────────────────

function renderEnvelopeBlock(sheet, startRow, env, allPositions, priceByIsin, cryptoBySymbol) {
  const positions = allPositions.filter(p => p.envelope_id === env.id);
  const { total, invested } = calcEnvelopeStats(env, positions, priceByIsin, cryptoBySymbol);
  const pv      = total - invested;
  const pvPct   = invested > 0 ? ((pv / invested) * 100).toFixed(1) : '0.0';
  const pvColor = pv >= 0 ? C.GREEN : C.RED;
  const typeBg  = { bourse: '#1d4ed8', crypto: '#6d28d9', 'épargne': '#065f46' };

  let row = startRow;

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
    sheet.getRange(row, i + 1).setValue(h).setFontColor(C.MUTED2).setFontSize(8).setFontWeight('bold').setBackground(C.BG);
  });
  row++;

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
  const prix     = currentPriceCalc(pos.identifiant, env.type, priceByIsin, cryptoBySymbol);
  const pa       = Number(pos.prix_achat) || 0;
  const qty      = Number(pos.quantite)   || 0;
  const valAchat = isEpargne ? pa : pa * qty;
  const valAct   = isEpargne ? pa : prix * qty;
  const posPv    = valAct - valAchat;
  const posPvPct = valAchat > 0 ? ((posPv / valAchat) * 100).toFixed(1) : '0.0';
  const pvColor  = posPv >= 0 ? C.GREEN : C.RED;

  const etfInfo  = priceByIsin[pos.identifiant];
  const etfNom   = env.type === 'bourse'
    ? (etfInfo?.nom || '')
    : (cryptoBySymbol[String(pos.identifiant).toUpperCase()]?.nom || '');
  const etfType  = etfInfo?.type || '';
  const label    = etfNom || pos.identifiant;
  const typeFg   = etfType === 'action' ? C.BLUE : etfType === 'bond' ? C.AMBER : C.MUTED;

  if (isEpargne) {
    sheet.getRange(row, 1).setValue(label).setFontColor(C.TEXT).setFontSize(9).setBackground(C.CARD);
    sheet.getRange(row, 2).setValue(pa).setFontColor(C.WHITE).setFontSize(9).setBackground(C.CARD).setNumberFormat('#,##0 "€"');
    sheet.getRange(row, 3).setValue(`${qty}%`).setFontColor(C.MUTED).setFontSize(9).setBackground(C.CARD);
    setBg(sheet, row, 4, 1, 5, C.CARD);
  } else {
    sheet.getRange(row, 1).setValue(pos.identifiant).setFontColor(C.MUTED).setFontSize(8).setBackground(C.CARD);
    sheet.getRange(row, 2).setValue(label).setFontColor(C.TEXT).setFontSize(9).setBackground(C.CARD);
    sheet.getRange(row, 3).setValue(isBourse ? (etfType || '') : fmtEur(prix)).setFontColor(isBourse ? typeFg : C.MUTED).setFontSize(9).setBackground(C.CARD);
    sheet.getRange(row, 4).setValue(`${qty} × ${fmtEur(pa)}`).setFontColor(C.MUTED).setFontSize(9).setBackground(C.CARD);
    sheet.getRange(row, 5).setValue(fmtEur(valAct)).setFontColor(C.WHITE).setFontSize(9).setBackground(C.CARD);
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

// ─── CALCULS FINANCIERS — IMMOBILIER ─────────────────────────────────────────

function immoMensualite(b) {
  const C = Number(b.montant_credit || 0);
  const t = Number(b.taux_credit    || 0) / 12;
  const n = Number(b.duree_credit_mois || 0);
  if (!C || !n) return 0;
  if (t === 0)  return C / n;
  return C * t * Math.pow(1 + t, n) / (Math.pow(1 + t, n) - 1);
}

function immoCapitalRestantDu(b, now) {
  const C    = Number(b.montant_credit    || 0);
  const t    = Number(b.taux_credit       || 0) / 12;
  const n    = Number(b.duree_credit_mois || 0);
  const debt = b.date_debut_credit ? new Date(b.date_debut_credit) : null;
  if (!C || !n || !debt || isNaN(debt.getTime())) return C;
  const k = Math.max(0, Math.round((now - debt) / (1000 * 60 * 60 * 24 * 30.4375)));
  const p = Math.min(k, n);
  if (t === 0) return Math.max(0, C - (C / n) * p);
  return C * (Math.pow(1 + t, n) - Math.pow(1 + t, p)) / (Math.pow(1 + t, n) - 1);
}

function immoRentabilite(b) {
  const prix   = Number(b.prix_achat || 0);
  const loyer  = Number(b.loyer_annuel_ht || 0);
  const chg    = Number(b.charges_annuelles || Number(b.charges_mensuelles || 0) * 12);
  const tf     = Number(b.taxe_fonciere || 0);
  const mens   = immoMensualite(b);
  const mensAss    = Number(b.mensualite_assurance || 0);
  const mensAssPno = Number(b.mensualite_assurance_pno || 0);

  const rendBrut      = prix > 0 ? (loyer / prix * 100) : 0;
  const cfAnnCredit   = loyer - chg - tf - (mens + mensAss) * 12 - mensAssPno * 12;
  const cfAnnPost     = loyer - chg - tf - mensAssPno * 12;
  const rendNetCredit = prix > 0 ? (cfAnnCredit / prix * 100) : 0;
  const rendNetPost   = prix > 0 ? (cfAnnPost   / prix * 100) : 0;

  return {
    rendBrut, rendNetCredit, rendNetPost,
    cfAnnCredit, cfAnnPost,
    cfMensCredit: cfAnnCredit / 12,
    cfMensPost:   cfAnnPost   / 12,
  };
}

function immoRentabiliteReelle(b, depenses, year) {
  const bienDeps = depenses.filter(d => d.bien_id === b.id);

  // Loyers
  const loyerDeps = bienDeps.filter(d => d.type === 'loyer' && d.periode_debut && d.periode_fin);
  let loyersHt = 0, moisLoyers = 0;
  const moisLoyerSeen = new Set();
  loyerDeps.forEach(d => {
    const debut = new Date(d.periode_debut);
    const fin   = new Date(d.periode_fin);
    let cur = new Date(debut);
    while (cur <= fin) {
      if (cur.getFullYear() === year) {
        const key = `${cur.getFullYear()}-${cur.getMonth()}`;
        if (!moisLoyerSeen.has(key)) {
          moisLoyerSeen.add(key);
          loyersHt += Number(d.montant_ht || d.montant_ttc || 0) / Math.max(1, Math.round((fin - debut) / (1000*60*60*24*30.4375)) + 1);
          moisLoyers++;
        }
      }
      cur.setMonth(cur.getMonth() + 1);
    }
  });

  // Dépenses hors loyer
  const depHors = bienDeps.filter(d => d.type !== 'loyer' && d.type !== 'tva_reversee' && d.date);
  let depenses_ = 0, moisCharges = 0;
  const moisChargeSeen = new Set();
  depHors.forEach(d => {
    const dat = new Date(d.date);
    if (dat.getFullYear() === year) {
      depenses_ += Number(d.montant_ttc || d.montant_ht || 0);
      const key = `${dat.getMonth()}`;
      if (!moisChargeSeen.has(key)) { moisChargeSeen.add(key); moisCharges++; }
    }
  });

  const taxe      = Number(b.taxe_fonciere || 0);
  const cfReel    = loyersHt - depenses_ - taxe;
  const moisRef   = Math.max(moisLoyers, moisCharges, 1);
  const cfProjete = moisRef > 0 ? (cfReel / moisRef) * 12 : 0;
  const rendProjete = Number(b.prix_achat || 0) > 0 ? cfProjete / Number(b.prix_achat) * 100 : 0;

  return { loyersHt, depenses: depenses_, taxe, cfReel, cfProjete, rendProjete, moisLoyers, moisCharges };
}

// ─── CALCULS FINANCIERS — RÉSIDENCES ─────────────────────────────────────────

function residQP(r) {
  return Math.min(1, Math.max(0, Number(r.quote_part || 1)));
}

function residValeurRef(r) {
  return Number(r.valeur_estimee || r.prix_achat || 0);
}

function residValeurPart(r) {
  return residValeurRef(r) * residQP(r);
}

function residPrixAchatPart(r) {
  return Number(r.prix_achat || 0) * residQP(r);
}

function residMensualite(r) {
  const C = Number(r.montant_credit || 0);
  const t = Number(r.taux_credit    || 0) / 12;
  const n = Number(r.duree_credit_mois || 0);
  if (!C || !n) return 0;
  if (t === 0)  return C / n;
  return C * t * Math.pow(1 + t, n) / (Math.pow(1 + t, n) - 1);
}

function residCapitalRestantDu(r, now) {
  const C    = Number(r.montant_credit    || 0);
  const t    = Number(r.taux_credit       || 0) / 12;
  const n    = Number(r.duree_credit_mois || 0);
  const debt = r.date_debut_credit ? new Date(r.date_debut_credit) : null;
  const soldee = r.credit_part_soldee == 1 || r.credit_part_soldee === 'true' || r.credit_part_soldee === true;
  if (soldee || !C || !n || !debt || isNaN(debt.getTime())) return 0;
  const k = Math.max(0, Math.round((now - debt) / (1000 * 60 * 60 * 24 * 30.4375)));
  const p = Math.min(k, n);
  if (t === 0) return Math.max(0, C - (C / n) * p);
  return C * (Math.pow(1 + t, n) - Math.pow(1 + t, p)) / (Math.pow(1 + t, n) - 1);
}

function residCapitalRembourse(r, now) {
  return Math.max(0, Number(r.montant_credit || 0) - residCapitalRestantDu(r, now));
}

function residPatrimoineNet(r, now) {
  return residValeurPart(r) - residCapitalRestantDu(r, now);
}

function residPlusValue(r) {
  return residValeurPart(r) - residPrixAchatPart(r);
}

// ─── CALCULS PATRIMOINE FINANCIER ────────────────────────────────────────────

function currentPriceCalc(identifiant, type, priceByIsin, cryptoBySymbol) {
  if (identifiant === 'LIQUIDITES') return 1;
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
        if (pos.identifiant === 'LIQUIDITES') { cash += val; return; }
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
