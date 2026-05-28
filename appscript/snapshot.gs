// snapshot.gs
// Snapshot journalier : calcule la valeur de chaque enveloppe et l'écrit dans history.
// Déclencheur recommandé : chaque jour à 18h via un Time-driven trigger.

function takeDailySnapshot() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const envelopes    = sheetToObjects(ss, 'envelopes');
  const positions    = sheetToObjects(ss, 'positions');
  const prices       = sheetToObjects(ss, 'prices');
  const cryptoPrices = sheetToObjects(ss, 'crypto_prices');
  const histSheet    = ss.getSheetByName('history');

  const today = new Date().toISOString().slice(0, 10);

  // Index des prix par identifiant pour lookup rapide
  const priceIndex = {};
  prices.forEach(p => { priceIndex[p.isin] = Number(p.prix_actuel) || 0; });
  cryptoPrices.forEach(p => { priceIndex[p.symbole] = Number(p.prix_actuel) || 0; });

  envelopes.forEach(envelope => {
    const envelopePositions = positions.filter(p => p.envelope_id === envelope.id);
    if (envelopePositions.length === 0) return;

    let valeurInvestie = 0;
    let valeurActuelle = 0;

    envelopePositions.forEach(pos => {
      const quantite    = Number(pos.quantite)   || 0;
      const prixAchat   = Number(pos.prix_achat) || 0;
      const prixActuel  = priceIndex[pos.identifiant] || 0;

      // Pour l'épargne, identifiant = nom du compte, pas de prix externe
      // La valeur actuelle = montant saisi (prix_achat = montant actuel pour l'épargne)
      const isEpargne = envelope.type === 'épargne';

      valeurInvestie += isEpargne ? prixAchat : prixAchat * quantite;
      valeurActuelle += isEpargne ? prixAchat : prixActuel * quantite;
    });

    const pvEuros = valeurActuelle - valeurInvestie;
    const pvPct   = valeurInvestie > 0
      ? ((valeurActuelle / valeurInvestie - 1) * 100).toFixed(2)
      : 0;

    histSheet.appendRow([today, envelope.id, valeurInvestie, valeurActuelle, pvEuros, pvPct]);
  });

  Logger.log(`Snapshot du ${today} terminé.`);
}
