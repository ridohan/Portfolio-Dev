// setup.gs
// Lance ces fonctions UNE SEULE FOIS depuis l'éditeur AppScript.

// 1. Définit le token secret stocké côté Google (jamais exposé dans le code source).
//    Remplace la valeur par un token long et aléatoire de ton choix.
function setSecretToken() {
  PropertiesService.getScriptProperties()
    .setProperty('SECRET_TOKEN', 'remplace-par-un-token-long-et-aleatoire');
  Logger.log('Token défini.');
}

// 2. Crée tous les onglets de la sheet avec leurs en-têtes.

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const tabs = {
    portfolios:     ['id', 'nom', 'cible_actions', 'cible_obligations', 'cible_cash'],
    sub_portfolios: ['id', 'nom', 'portfolio_id'],
    envelopes:      ['id', 'nom', 'type', 'portfolio_id', 'sub_portfolio_id'],
    positions:      ['id', 'envelope_id', 'identifiant', 'quantite', 'prix_achat', 'date_achat'],
    prices:         ['isin', 'nom', 'type', 'prix_actuel', 'derniere_maj'],
    crypto_prices:  ['symbole', 'coingecko_id', 'nom', 'prix_actuel', 'derniere_maj'],
    history:        ['date', 'envelope_id', 'valeur_investie', 'valeur_actuelle', 'pv_euros', 'pv_pct'],
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
