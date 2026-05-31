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
      history:        getHistory(ss),
      fire_profile:        sheetToObjects(ss, 'fire_profile'),
      vpw:                 getVpwData(),
      expense_categories:  sheetToObjects(ss, 'expense_categories'),
      expense_items:       sheetToObjects(ss, 'expense_items'),
      expense_entries:     sheetToObjects(ss, 'expense_entries'),
      expense_aids:        sheetToObjects(ss, 'expense_aids'),
      biens_immo:          sheetToObjects(ss, 'biens_immo'),
      depenses_immo:       sheetToObjects(ss, 'depenses_immo'),
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
        ensureSheet(ss2, 'expense_categories', ['id','nom','type','couleur','ordre']);
        const maxOrdre = (() => {
          const sh = ss2.getSheetByName('expense_categories');
          if (!sh || sh.getLastRow() < 2) return 0;
          const hdrs = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
          const oIdx = hdrs.indexOf('ordre');
          if (oIdx === -1) return 0;
          const vals = sh.getRange(2, oIdx+1, sh.getLastRow()-1, 1).getValues().flat();
          return vals.reduce((m,v) => Math.max(m, Number(v)||0), -1) + 1;
        })();
        return createRow('expense_categories', { id: newId('ec'), nom: payload.nom, type: payload.type, couleur: payload.couleur || 'slate', ordre: maxOrdre });
      },
      updateExpenseCategory: () => updateRow('expense_categories', payload.id, { nom: payload.nom, type: payload.type, couleur: payload.couleur || 'slate' }),
      deleteExpenseCategory: () => deleteRow('expense_categories', payload.id),

      reorderCategories: () => {
        const ss2   = SpreadsheetApp.getActiveSpreadsheet();
        const sheet = ss2.getSheetByName('expense_categories');
        if (!sheet || sheet.getLastRow() < 2) return { ok: true };
        const numCols = sheet.getLastColumn();
        const allHdrs = sheet.getRange(1, 1, 1, numCols).getValues()[0];
        // Ajoute la colonne 'ordre' si absente
        let ordreCol = allHdrs.indexOf('ordre');
        if (ordreCol === -1) {
          ordreCol = numCols;
          sheet.getRange(1, ordreCol + 1).setValue('ordre');
          allHdrs.push('ordre');
        }
        const idCol  = allHdrs.indexOf('id');
        const data   = sheet.getRange(2, 1, sheet.getLastRow() - 1, allHdrs.length).getValues();
        payload.items.forEach(({ id, ordre }) => {
          const rowIdx = data.findIndex(row => String(row[idCol]) === String(id));
          if (rowIdx !== -1) sheet.getRange(rowIdx + 2, ordreCol + 1).setValue(Number(ordre));
        });
        return { ok: true };
      },

      createExpenseItem: () => {
        const ss2 = SpreadsheetApp.getActiveSpreadsheet();
        ensureSheet(ss2, 'expense_items', ['id','category_id','nom']);
        return createRow('expense_items', { id: newId('ei'), category_id: payload.category_id, nom: payload.nom });
      },
      updateExpenseItem:      () => updateRow('expense_items', payload.id, { nom: payload.nom, category_id: payload.category_id }),
      deleteExpenseItem:      () => deleteRow('expense_items', payload.id),

      upsertExpenseEntry:     () => upsertExpenseEntry(payload),
      deleteExpenseEntry:     () => deleteExpenseEntry(payload),

      createExpenseAid: () => {
        const ss2 = SpreadsheetApp.getActiveSpreadsheet();
        ensureSheet(ss2, 'expense_aids', ['id','nom','montant']);
        return createRow('expense_aids', { id: newId('ea'), nom: payload.nom, montant: Number(payload.montant) });
      },
      updateExpenseAid: () => updateRow('expense_aids', payload.id, { nom: payload.nom, montant: Number(payload.montant) }),
      deleteExpenseAid: () => deleteRow('expense_aids', payload.id),

      // ─── IMMOBILIER LOCATIF ──────────────────────────────────────────────────
      addBienImmo: () => {
        const ss2 = SpreadsheetApp.getActiveSpreadsheet();
        ensureSheet(ss2, 'biens_immo', ['id','nom','surface_m2','prix_achat','loyer_annuel_ht','taxe_fonciere','charges_annuelles','montant_credit','duree_credit_mois','taux_credit','mensualite_assurance','numero_pret','date_debut_credit']);
        return createRow('biens_immo', {
          id: newId('bi'), nom: payload.nom,
          surface_m2: Number(payload.surface_m2 || 0),
          prix_achat: Number(payload.prix_achat || 0),
          loyer_annuel_ht: Number(payload.loyer_annuel_ht || 0),
          taxe_fonciere: Number(payload.taxe_fonciere || 0),
          charges_annuelles: Number(payload.charges_annuelles || 0),
          montant_credit: Number(payload.montant_credit || 0),
          duree_credit_mois: Number(payload.duree_credit_mois || 0),
          taux_credit: Number(payload.taux_credit || 0),
          mensualite_assurance: Number(payload.mensualite_assurance || 0),
          numero_pret: payload.numero_pret || '',
          date_debut_credit: payload.date_debut_credit || '',
        });
      },
      updateBienImmo: () => updateRow('biens_immo', payload.id, {
        nom: payload.nom,
        surface_m2: Number(payload.surface_m2 || 0),
        prix_achat: Number(payload.prix_achat || 0),
        loyer_annuel_ht: Number(payload.loyer_annuel_ht || 0),
        taxe_fonciere: Number(payload.taxe_fonciere || 0),
        charges_annuelles: Number(payload.charges_annuelles || 0),
        montant_credit: Number(payload.montant_credit || 0),
        duree_credit_mois: Number(payload.duree_credit_mois || 0),
        taux_credit: Number(payload.taux_credit || 0),
        mensualite_assurance: Number(payload.mensualite_assurance || 0),
        numero_pret: payload.numero_pret || '',
        date_debut_credit: payload.date_debut_credit || '',
      }),
      deleteBienImmo: () => {
        const ss2 = SpreadsheetApp.getActiveSpreadsheet();
        deleteRow('biens_immo', payload.id);
        deleteWhere(ss2, 'depenses_immo', 'bien_id', payload.id);
        return { deleted: payload.id };
      },

      addDepenseImmo: () => {
        const ss2 = SpreadsheetApp.getActiveSpreadsheet();
        ensureSheet(ss2, 'depenses_immo', ['id','bien_id','type','date','montant_ttc','tva_rate','montant_ht','periode_debut','periode_fin','note']);
        return createRow('depenses_immo', {
          id: newId('di'), bien_id: payload.bien_id,
          type: payload.type, date: payload.date || '',
          montant_ttc: Number(payload.montant_ttc || 0),
          tva_rate:    payload.tva_rate !== null && payload.tva_rate !== undefined ? Number(payload.tva_rate) : '',
          montant_ht:  Number(payload.montant_ht || 0),
          periode_debut: payload.periode_debut || '',
          periode_fin:   payload.periode_fin || '',
          note: payload.note || '',
        });
      },
      updateDepenseImmo: () => {
        const ss2 = SpreadsheetApp.getActiveSpreadsheet();
        ensureSheet(ss2, 'depenses_immo', ['id','bien_id','type','date','montant_ttc','tva_rate','montant_ht','periode_debut','periode_fin','note']);
        return updateRow('depenses_immo', payload.id, {
          type: payload.type, date: payload.date || '',
          montant_ttc: Number(payload.montant_ttc || 0),
          tva_rate:    payload.tva_rate !== null && payload.tva_rate !== undefined ? Number(payload.tva_rate) : '',
          montant_ht:  Number(payload.montant_ht || 0),
          periode_debut: payload.periode_debut || '',
          periode_fin:   payload.periode_fin || '',
          note: payload.note || '',
        });
      },
      deleteDepenseImmo: () => deleteRow('depenses_immo', payload.id),
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

function deleteWhere(ss, tabName, colName, value) {
  const sheet = ss.getSheetByName(tabName);
  if (!sheet || sheet.getLastRow() < 2) return;
  const data   = sheet.getDataRange().getValues();
  const colIdx = data[0].indexOf(colName);
  if (colIdx === -1) return;
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][colIdx]) === String(value)) sheet.deleteRow(i + 1);
  }
}

// ─── HISTORIQUE ───────────────────────────────────────────────────────────────
// Lit l'onglet history, normalise toutes les dates en yyyy-MM-dd (fuseau du
// script) et déduplique par (envelope_id, date_jour) en gardant la dernière
// ligne de la journée — utile quand le snapshot tourne plusieurs fois par jour.

function getHistory(ss) {
  const sheet = ss.getSheetByName('history');
  if (!sheet || sheet.getLastRow() < 2) return [];

  const [headers, ...rows] = sheet.getDataRange().getValues();
  const tz      = Session.getScriptTimeZone();
  const dateIdx = headers.indexOf('date');
  const envIdx  = headers.indexOf('envelope_id');

  const objects = rows.map(row => {
    const obj = Object.fromEntries(headers.map((h, i) => [h, row[i]]));
    if (dateIdx !== -1 && obj.date) {
      const d = obj.date instanceof Date ? obj.date : new Date(obj.date);
      obj.date = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    }
    return obj;
  });

  // Dernière ligne de la journée gagne (ordre naturel = chronologique)
  const seen = new Map();
  objects.forEach(obj => {
    seen.set(`${obj.envelope_id}__${obj.date}`, obj);
  });

  return Array.from(seen.values());
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
  const headers = ['id', 'item_id', 'annee', 'mois', 'montant', 'note'];
  const sheet   = ensureSheet(ss, 'expense_entries', headers);

  const lastRow = sheet.getLastRow();
  const numCols = Math.max(headers.length, sheet.getLastColumn());
  const data    = lastRow >= 2
    ? sheet.getRange(1, 1, lastRow, numCols).getValues()
    : [headers];

  const hdrs       = data[0];
  const itemCol    = hdrs.indexOf('item_id');
  const anneeCol   = hdrs.indexOf('annee');
  const moisCol    = hdrs.indexOf('mois');
  const montantCol = hdrs.indexOf('montant');
  const noteCol    = hdrs.indexOf('note');
  const idCol      = hdrs.indexOf('id');
  const note       = payload.note !== undefined ? String(payload.note || '') : '';

  const rowIdx = data.findIndex((row, i) =>
    i > 0 &&
    String(row[itemCol])  === String(payload.item_id) &&
    Number(row[anneeCol]) === Number(payload.annee)   &&
    Number(row[moisCol])  === Number(payload.mois)
  );

  if (rowIdx === -1) {
    const id = newId('ee');
    sheet.appendRow([id, payload.item_id, Number(payload.annee), Number(payload.mois), Number(payload.montant), note]);
    return { id, item_id: payload.item_id, annee: payload.annee, mois: payload.mois, montant: payload.montant, note };
  } else {
    sheet.getRange(rowIdx + 1, montantCol + 1).setValue(Number(payload.montant));
    if (noteCol !== -1) sheet.getRange(rowIdx + 1, noteCol + 1).setValue(note);
    return { id: data[rowIdx][idCol], item_id: payload.item_id, annee: payload.annee, mois: payload.mois, montant: payload.montant, note };
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
