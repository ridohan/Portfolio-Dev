// setup.gs
// Lance ces fonctions UNE SEULE FOIS depuis l'éditeur AppScript.
// Ordre recommandé :
//   1. setSecretToken()
//   2. setCMCApiKey()
//   3. setup()
//   4. setupTriggers()

// 1. Définit le token secret de l'app (protection de la Web App).
function setSecretToken() {
  PropertiesService.getScriptProperties()
    .setProperty('SECRET_TOKEN', 'remplace-par-un-token-long-et-aleatoire');
  Logger.log('Token défini.');
}

// 2. Définit la clé API CoinMarketCap.
function setCMCApiKey() {
  PropertiesService.getScriptProperties()
    .setProperty('CMC_API_KEY', 'remplace-par-ta-cle-cmc');
  Logger.log('Clé CMC définie.');
}

// 3. Crée tous les onglets de la sheet avec leurs en-têtes.

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const tabs = {
    portfolios:     ['id', 'nom', 'cible_actions', 'cible_obligations', 'cible_cash'],
    sub_portfolios: ['id', 'nom', 'portfolio_id'],
    envelopes:      ['id', 'nom', 'type', 'portfolio_id', 'sub_portfolio_id'],
    positions:      ['id', 'envelope_id', 'identifiant', 'quantite', 'prix_achat', 'date_achat'],
    prices:         ['isin', 'nom', 'type', 'prix_actuel', 'derniere_maj'],
    crypto_prices:  ['symbole', 'nom', 'prix_actuel', 'derniere_maj'],
    history:        ['date', 'envelope_id', 'valeur_investie', 'valeur_actuelle', 'pv_euros', 'pv_pct'],
    charges:        ['id', 'portfolio_id', 'nom', 'montant', 'date_fin'],
  };

  Object.entries(tabs).forEach(([name, headers]) => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
    }
    // Écrit les en-têtes seulement si la feuille est vierge
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    }
  });

  Logger.log('Setup terminé — tous les onglets sont prêts.');
}

// 4. Crée les déclencheurs temporels automatiques.
//    ⚠️  À exécuter UNE SEULE FOIS. Supprime les anciens déclencheurs existants
//    pour éviter les doublons avant d'en créer de nouveaux.
function setupTriggers() {
  // Supprime tous les déclencheurs existants sur ce projet
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));

  // refreshDashboards() — toutes les 8 heures
  ScriptApp.newTrigger('refreshDashboards')
    .timeBased()
    .everyHours(8)
    .create();

  // updateAllPrices() — toutes les 4 heures
  ScriptApp.newTrigger('updateAllPrices')
    .timeBased()
    .everyHours(4)
    .create();

  // takeDailySnapshot() — chaque jour entre 18h et 19h
  ScriptApp.newTrigger('takeDailySnapshot')
    .timeBased()
    .everyDays(1)
    .atHour(18)
    .create();

  // Résumé
  const triggers = ScriptApp.getProjectTriggers();
  Logger.log('✅ ' + triggers.length + ' déclencheurs créés :');
  triggers.forEach(t => Logger.log('  · ' + t.getHandlerFunction() + ' — ' + t.getEventType()));
}
