// snapshot.gs
// Snapshot journalier : calcule la valeur de chaque enveloppe et l'écrit dans history.
// Déclencheur recommandé : lancer createDailyTrigger() une seule fois depuis l'éditeur.

function takeDailySnapshot() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const envelopes    = sheetToObjects(ss, 'envelopes');
  const positions    = sheetToObjects(ss, 'positions');
  const prices       = sheetToObjects(ss, 'prices');
  const cryptoPrices = sheetToObjects(ss, 'crypto_prices');
  const histSheet    = ss.getSheetByName('history');

  const today = new Date().toISOString().slice(0, 10);

  // Index des prix par identifiant pour lookup rapide
  // Crypto : lookup en majuscules pour être robuste aux casses
  const priceIndex = {};
  prices.forEach(p => { priceIndex[p.isin] = Number(p.prix_actuel) || 0; });
  cryptoPrices.forEach(p => { priceIndex[(p.symbole || '').toUpperCase()] = Number(p.prix_actuel) || 0; });

  // ─── Déduplication ───────────────────────────────────────────────────────────
  // Construire un index "date|envelope_id" → numéro de ligne (1-based)
  // pour pouvoir mettre à jour la ligne si elle existe déjà.
  const histData = histSheet.getLastRow() > 1
    ? histSheet.getDataRange().getValues()
    : [['date', 'envelope_id', 'valeur_investie', 'valeur_actuelle', 'pv_euros', 'pv_pct']];

  const headers  = histData[0];
  const dateCol  = headers.indexOf('date');
  const envIdCol = headers.indexOf('envelope_id');
  const viCol    = headers.indexOf('valeur_investie') + 1;
  const vaCol    = headers.indexOf('valeur_actuelle') + 1;
  const pvECol   = headers.indexOf('pv_euros')        + 1;
  const pvPCol   = headers.indexOf('pv_pct')          + 1;

  const existingRows = {}; // "date|envelope_id" → rowIndex (sheet, 1-based)
  histData.forEach((row, i) => {
    if (i === 0) return;
    const d = row[dateCol] instanceof Date
      ? row[dateCol].toISOString().slice(0, 10)
      : String(row[dateCol]).slice(0, 10);
    existingRows[`${d}|${row[envIdCol]}`] = i + 1; // +1 because sheet rows are 1-based
  });
  // ─────────────────────────────────────────────────────────────────────────────

  envelopes.forEach(envelope => {
    const envelopePositions = positions.filter(p => p.envelope_id === envelope.id);
    if (envelopePositions.length === 0) return;

    let valeurInvestie = 0;
    let valeurActuelle = 0;

    envelopePositions.forEach(pos => {
      const quantite   = Number(pos.quantite)   || 0;
      const prixAchat  = Number(pos.prix_achat) || 0;

      // Crypto : lookup en majuscules
      const lookupKey  = envelope.type === 'crypto'
        ? (pos.identifiant || '').toUpperCase()
        : pos.identifiant;
      const prixActuel = priceIndex[lookupKey] || 0;

      // Pour l'épargne, prix_achat = montant actuel (pas de prix externe)
      const isEpargne  = envelope.type === 'épargne';
      valeurInvestie  += isEpargne ? prixAchat : prixAchat * quantite;
      valeurActuelle  += isEpargne ? prixAchat : prixActuel * quantite;
    });

    const pvEuros = valeurActuelle - valeurInvestie;
    const pvPct   = valeurInvestie > 0
      ? ((valeurActuelle / valeurInvestie - 1) * 100).toFixed(2)
      : 0;

    const key = `${today}|${envelope.id}`;
    if (existingRows[key]) {
      // Ligne déjà présente pour aujourd'hui → mise à jour sur place
      const rowNum = existingRows[key];
      histSheet.getRange(rowNum, viCol).setValue(valeurInvestie);
      histSheet.getRange(rowNum, vaCol).setValue(valeurActuelle);
      histSheet.getRange(rowNum, pvECol).setValue(pvEuros);
      histSheet.getRange(rowNum, pvPCol).setValue(pvPct);
    } else {
      // Nouvelle entrée
      histSheet.appendRow([today, envelope.id, valeurInvestie, valeurActuelle, pvEuros, pvPct]);
    }
  });

  Logger.log(`Snapshot du ${today} terminé.`);
}

// ─── DÉCLENCHEUR AUTOMATIQUE ─────────────────────────────────────────────────
// Lancer cette fonction UNE SEULE FOIS depuis l'éditeur AppScript
// pour créer le déclencheur quotidien à 18h.

function createDailyTrigger() {
  // Supprimer tout trigger existant sur takeDailySnapshot pour éviter les doublons
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'takeDailySnapshot')
    .forEach(t => ScriptApp.deleteTrigger(t));

  // Créer le nouveau trigger quotidien à 18h
  ScriptApp.newTrigger('takeDailySnapshot')
    .timeBased()
    .everyDays(1)
    .atHour(18)
    .create();

  Logger.log('Trigger quotidien créé : takeDailySnapshot à 18h chaque jour.');
}
