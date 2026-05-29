// webapp.gs
// Web App — point d'entrée unique pour l'app HTML.
// Déployer via : Extensions > Apps Script > Déployer > Nouvelle déploiement
//   Type : Application Web
//   Exécuter en tant que : Moi
//   Accès : Tout le monde (l'authentification est gérée par le token SECRET_TOKEN)

// ─── AUTHENTIFICATION ────────────────────────────────────────────────────────

function isAuthorized(token) {
  const secret = PropertiesService.getScriptProperties().getProperty('SECRET_TOKEN');
  return secret && token === secret;
}

// ─── LECTURE ─────────────────────────────────────────────────────────────────
// Token passé en paramètre URL : ?token=xxx

function doGet(e) {
  if (!isAuthorized(e.parameter.token)) {
    return jsonResponse({ ok: false, error: 'Non autorisé' });
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const data = {
      portfolios:     sheetToObjects(ss, 'portfolios'),
      sub_portfolios: sheetToObjects(ss, 'sub_portfolios'),
      envelopes:      sheetToObjects(ss, 'envelopes'),
      positions:      sheetToObjects(ss, 'positions'),
      prices:         sheetToObjects(ss, 'prices'),
      crypto_prices:  sheetToObjects(ss, 'crypto_prices'),
      charges:        sheetToObjects(ss, 'charges'),
      history:        sheetToObjects(ss, 'history'),
      fire_profile:        sheetToObjects(ss, 'fire_profile'),
      vpw:                 getVpwData(),
      expense_categories:  sheetToObjects(ss, 'expense_categories'),
      expense_items:       sheetToObjects(ss, 'expense_items'),
      expense_entries:     sheetToObjects(ss, 'expense_entries'),
    };
    return jsonResponse({ ok: true, data });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ─── ÉCRITURE ────────────────────────────────────────────────────────────────
// Token passé dans le body : { token: 'xxx', action: '...', ... }
// Le body est envoyé en text/plain pour éviter le preflight CORS.

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    if (!isAuthorized(payload.token)) {
      return jsonResponse({ ok: false, error: 'Non autorisé' });
    }

    const { action } = payload;

    const handlers = {
      createPortfolio:    () => createRow('portfolios',     { id: newId('p'), nom: payload.nom, cible_actions: Number(payload.cible_actions), cible_obligations: Number(payload.cible_obligations), cible_cash: Number(payload.cible_cash) }),
      updatePortfolio:    () => updateRow('portfolios',     payload.id, { nom: payload.nom, cible_actions: Number(payload.cible_actions), cible_obligations: Number(payload.cible_obligations), cible_cash: Number(payload.cible_cash) }),
      deletePortfolio:    () => deleteRow('portfolios',     payload.id),

      createSubPortfolio: () => createRow('sub_portfolios', { id: newId('sp'), nom: payload.nom, portfolio_id: payload.portfolio_id }),
      updateSubPortfolio: () => updateRow('sub_portfolios', payload.id, { nom: payload.nom, portfolio_id: payload.portfolio_id }),
      deleteSubPortfolio: () => deleteRow('sub_portfolios', payload.id),

      createEnvelope:     () => createRow('envelopes',      { id: newId('e'), nom: payload.nom, type: payload.type, portfolio_id: payload.portfolio_id, sub_portfolio_id: payload.sub_portfolio_id || '' }),
      updateEnvelope:     () => updateRow('envelopes',      payload.id, { nom: payload.nom, type: payload.type }),
      deleteEnvelope:     () => deleteRow('envelopes',      payload.id),

      addPosition:        () => createRow('positions',      { id: newId('pos'), envelope_id: payload.envelope_id, identifiant: payload.identifiant, nom: payload.nom || '', quantite: Number(payload.quantite), prix_achat: Number(payload.prix_achat), date_achat: payload.date_achat || new Date().toISOString().slice(0, 10) }),
      updatePosition:     () => updateRow('positions',      payload.id, { nom: payload.nom, quantite: Number(payload.quantite), prix_achat: Number(payload.prix_achat) }),
      deletePosition:     () => deleteRow('positions',      payload.id),

      addPrice:           () => upsertPrice(payload),
      addCryptoPrice:     () => upsertCryptoPrice(payload),

      createCharge:       () => createRow('charges', { id: newId('chg'), portfolio_id: payload.portfolio_id, nom: payload.nom, montant: Number(payload.montant), date_fin: payload.date_fin || '' }),
      updateCharge:       () => updateRow('charges', payload.id, { nom: payload.nom, montant: Number(payload.montant), date_fin: payload.date_fin || '' }),
      deleteCharge:       () => deleteRow('charges', payload.id),

      saveFireProfile:    () => upsertFireProfile(payload),

      createExpenseCategory: () => {
        const ss2 = SpreadsheetApp.getActiveSpreadsheet();
        ensureSheet(ss2, 'expense_categories', ['id','nom','type','couleur']);
        return createRow('expense_categories', { id: newId('ec'), nom: payload.nom, type: payload.type, couleur: payload.couleur || 'slate' });
      },
      updateExpenseCategory: () => updateRow('expense_categories', payload.id, { nom: payload.nom, type: payload.type, couleur: payload.couleur || 'slate' }),
      deleteExpenseCategory: () => deleteRow('expense_categories', payload.id),

      createExpenseItem: () => {
        const ss2 = SpreadsheetApp.getActiveSpreadsheet();
        ensureSheet(ss2, 'expense_items', ['id','category_id','nom']);
        return createRow('expense_items', { id: newId('ei'), category_id: payload.category_id, nom: payload.nom });
      },
      updateExpenseItem:      () => updateRow('expense_items', payload.id, { nom: payload.nom, category_id: payload.category_id }),
      deleteExpenseItem:      () => deleteRow('expense_items', payload.id),

      upsertExpenseEntry:     () => upsertExpenseEntry(payload),
      deleteExpenseEntry:     () => deleteExpenseEntry(payload),
    };

    if (!handlers[action]) {
      return jsonResponse({ ok: false, error: `Action inconnue : ${action}` });
    }

    const result = handlers[action]();
    return jsonResponse({ ok: true, result });

  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// ─── UTILITAIRES ─────────────────────────────────────────────────────────────

function sheetToObjects(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const [headers, ...rows] = sheet.getDataRange().getValues();
  return rows.map(row => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
}

function getSheetAndIndex(ss, tabName, id) {
  const sheet = ss.getSheetByName(tabName);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  const rowIndex = data.findIndex((row, i) => i > 0 && row[idCol] === id);
  return { sheet, headers, rowIndex: rowIndex + 1 };
}

function createRow(tabName, obj) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(tabName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  sheet.appendRow(headers.map(h => obj[h] ?? ''));
  return obj;
}

function updateRow(tabName, id, fields) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const { sheet, headers, rowIndex } = getSheetAndIndex(ss, tabName, id);
  if (rowIndex < 1) throw new Error(`Ligne introuvable : ${id}`);
  Object.entries(fields).forEach(([key, val]) => {
    const col = headers.indexOf(key) + 1;
    if (col > 0) sheet.getRange(rowIndex, col).setValue(val);
  });
  return { id, ...fields };
}

function deleteRow(tabName, id) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const { sheet, rowIndex } = getSheetAndIndex(ss, tabName, id);
  if (rowIndex < 1) throw new Error(`Ligne introuvable : ${id}`);
  sheet.deleteRow(rowIndex);
  return { deleted: id };
}

function upsertPrice(payload) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('prices');
  const data  = sheet.getDataRange().getValues();
  const headers   = data[0];
  const isinCol   = headers.indexOf('isin');
  const prixCol   = headers.indexOf('prix_actuel');
  const majCol    = headers.indexOf('derniere_maj');

  const existingRow = data.findIndex((row, i) => i > 0 && row[isinCol] === payload.isin);

  if (existingRow === -1) {
    // Nouvel ISIN — on insère et on récupère le prix immédiatement
    sheet.appendRow([payload.isin, payload.nom || '', payload.type || '', '', '']);
    const newRow = sheet.getLastRow();
    const prix = fetchJustETFPrice(payload.isin);
    if (prix !== null) {
      sheet.getRange(newRow, prixCol + 1).setValue(Number(prix));
      sheet.getRange(newRow, majCol  + 1).setValue(new Date().toISOString());
    }
  }
}

function upsertCryptoPrice(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('crypto_prices');
  const data = sheet.getDataRange().getValues();
  const exists = data.some((row, i) => i > 0 && row[0] === payload.symbole);
  if (!exists) {
    sheet.appendRow([payload.symbole, payload.nom || '', '', '']);
  }
}

function newId(prefix) {
  return `${prefix}_${Date.now()}`;
}

// ─── VPW (Variable Percentage Withdrawal) ─────────────────────────────────────
// Lit les résultats pré-calculés de l'onglet "VPW Retirement" pour les exposer
// dans le front-end. Le calcul reste intégralement dans Google Sheets.
//
// Stratégie : on charge toute la plage utile en une requête, puis on cherche
// chaque label par plage de lignes pour éviter les faux positifs.
// Si la feuille n'existe pas, retourne null (front-end affiche rien).

function getVpwData() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('VPW Retirement');
  if (!sheet) return null;

  try {
    const rows = Math.min(sheet.getLastRow(), 90);
    const cols = Math.min(sheet.getLastColumn(), 8);
    const data = sheet.getRange(1, 1, rows, cols).getValues();

    // Retourne la première valeur numérique à droite du label,
    // sur les lignes [rowMin, rowMax] (1-based, inclusif).
    const findNum = (label, rowMin, rowMax) => {
      for (let r = rowMin - 1; r < Math.min(rowMax, rows); r++) {
        for (let c = 0; c < cols; c++) {
          if (String(data[r][c]).includes(label)) {
            for (let k = c + 1; k < cols; k++) {
              if (data[r][k] !== null && data[r][k] !== '' && typeof data[r][k] === 'number') {
                return data[r][k];
              }
            }
          }
        }
      }
      return null;
    };

    // ── Cellules lues (ajuste les plages si ta feuille diffère) ──────────────
    // D10 : Age
    // D16 : Monthly Portfolio Withdrawal  ← suggestion principale (cellule verte)
    // D23 : Portfolio Loss                ← correction de marché simulée
    // D24 : Portfolio Balance After Loss
    // D25 : Monthly Income Reduction
    // D26 : Monthly Income After Loss     ← retrait après perte
    // D36 : Portfolio Withdrawal          ← retrait annuel normal
    // D55 : VPW Table Percentage          ← stocké en décimal (0.045 → 4.5 %)
    const vpwPctRaw = findNum('VPW Table Percentage', 54, 57);

    return {
      age:               findNum('Age',                          9,  12),
      monthlyWithdrawal: findNum('Monthly Portfolio Withdrawal', 14, 18),
      portfolioLoss:     findNum('Portfolio Loss',               22, 24),
      balanceAfterLoss:  findNum('Portfolio Balance After Loss', 23, 26),
      monthlyReduction:  findNum('Monthly Income Reduction',     24, 27),
      monthlyAfterLoss:  findNum('Monthly Income After Loss',    24, 28),
      annualWithdrawal:  findNum('Portfolio Withdrawal',         34, 38),
      // vpwPct : converti en % lisible (0.045 → 4.5)
      vpwPct: vpwPctRaw !== null ? parseFloat((vpwPctRaw * 100).toFixed(2)) : null,
    };
  } catch (e) {
    Logger.log('getVpwData error : ' + e.message);
    return null;
  }
}

function upsertFireProfile(payload) {
  const ss     = SpreadsheetApp.getActiveSpreadsheet();
  const fields = ['capital', 'rendement', 'inflation', 'duree', 'versement', 'depenses',
                  'swr', 'dwzMode', 'dureeFire', 'reserveFinale', 'depart', 'age'];

  let sheet = ss.getSheetByName('fire_profile');
  if (!sheet) {
    sheet = ss.insertSheet('fire_profile');
    sheet.getRange(1, 1, 1, fields.length).setValues([fields]);
  }

  const values = fields.map(f => (payload[f] !== undefined ? payload[f] : ''));

  if (sheet.getLastRow() < 2) {
    sheet.appendRow(values);
  } else {
    // Un seul profil → on écrase la ligne 2
    sheet.getRange(2, 1, 1, fields.length).setValues([values]);
  }

  return { saved: true };
}

// ─── DÉPENSES ─────────────────────────────────────────────────────────────────

function ensureSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
}

function upsertExpenseEntry(payload) {
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const headers = ['id', 'item_id', 'annee', 'mois', 'montant'];
  const sheet   = ensureSheet(ss, 'expense_entries', headers);

  const lastRow = sheet.getLastRow();
  const data    = lastRow >= 2
    ? sheet.getRange(1, 1, lastRow, headers.length).getValues()
    : [headers];

  const hdrs       = data[0];
  const itemCol    = hdrs.indexOf('item_id');
  const anneeCol   = hdrs.indexOf('annee');
  const moisCol    = hdrs.indexOf('mois');
  const montantCol = hdrs.indexOf('montant');
  const idCol      = hdrs.indexOf('id');

  const rowIdx = data.findIndex((row, i) =>
    i > 0 &&
    String(row[itemCol])  === String(payload.item_id) &&
    Number(row[anneeCol]) === Number(payload.annee)   &&
    Number(row[moisCol])  === Number(payload.mois)
  );

  if (rowIdx === -1) {
    const id = newId('ee');
    sheet.appendRow([id, payload.item_id, Number(payload.annee), Number(payload.mois), Number(payload.montant)]);
    return { id, item_id: payload.item_id, annee: payload.annee, mois: payload.mois, montant: payload.montant };
  } else {
    sheet.getRange(rowIdx + 1, montantCol + 1).setValue(Number(payload.montant));
    return { id: data[rowIdx][idCol], item_id: payload.item_id, annee: payload.annee, mois: payload.mois, montant: payload.montant };
  }
}

function deleteExpenseEntry(payload) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('expense_entries');
  if (!sheet || sheet.getLastRow() < 2) return { deleted: false };

  const data    = sheet.getDataRange().getValues();
  const hdrs    = data[0];
  const itemCol  = hdrs.indexOf('item_id');
  const anneeCol = hdrs.indexOf('annee');
  const moisCol  = hdrs.indexOf('mois');

  const rowIdx = data.findIndex((row, i) =>
    i > 0 &&
    String(row[itemCol])  === String(payload.item_id) &&
    Number(row[anneeCol]) === Number(payload.annee)   &&
    Number(row[moisCol])  === Number(payload.mois)
  );

  if (rowIdx === -1) return { deleted: false };
  sheet.deleteRow(rowIdx + 1);
  return { deleted: true };
}

// ─── UTILITAIRE ───────────────────────────────────────────────────────────────

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
