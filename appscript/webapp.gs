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

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
