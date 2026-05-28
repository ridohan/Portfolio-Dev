// prices.gs
// Mise à jour automatique des prix ETF (JustETF) et crypto (CoinGecko).
// Déclencheur recommandé : toutes les heures via un Time-driven trigger.

// ─── ETF — JustETF ───────────────────────────────────────────────────────────

function updateETFPrices() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('prices');
  if (!sheet || sheet.getLastRow() < 2) return;

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const isinCol   = headers.indexOf('isin');
  const nomCol    = headers.indexOf('nom');
  const prixCol   = headers.indexOf('prix_actuel');
  const majCol    = headers.indexOf('derniere_maj');

  for (let i = 1; i < data.length; i++) {
    const isin = data[i][isinCol];
    if (!isin) continue;

    try {
      const prix = fetchJustETFPrice(isin);
      if (prix !== null) {
        sheet.getRange(i + 1, prixCol + 1).setValue(prix);
        sheet.getRange(i + 1, majCol + 1).setValue(new Date().toISOString());
      }
    } catch (err) {
      Logger.log(`Erreur prix ETF ${isin} : ${err.message}`);
    }

    Utilities.sleep(500); // Pause entre les requêtes pour éviter le rate limiting
  }
}

function fetchJustETFPrice(isin) {
  // ⚠️ Remplace cette URL par ton endpoint JustETF exact.
  // Exemple de pattern connu : https://www.justetf.com/api/etfs?isin={ISIN}&locale=fr&valuation=EUR
  const url = `https://www.justetf.com/api/etfs?isin=${isin}&locale=fr&valuation=EUR`;

  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: { 'Accept': 'application/json' },
  });

  if (response.getResponseCode() !== 200) return null;

  const json = JSON.parse(response.getContentText());

  // ⚠️ Adapte ce chemin selon la structure réelle du JSON retourné par JustETF.
  // Exemple : json.etfs[0].latestPrice ou json.quote.last, etc.
  return json?.etfs?.[0]?.latestPrice ?? null;
}

// ─── CRYPTO — CoinGecko ──────────────────────────────────────────────────────

function updateCryptoPrices() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('crypto_prices');
  if (!sheet || sheet.getLastRow() < 2) return;

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const geckoIdCol = headers.indexOf('coingecko_id');
  const prixCol    = headers.indexOf('prix_actuel');
  const majCol     = headers.indexOf('derniere_maj');

  // Récupère tous les coingecko_ids non vides
  const ids = data.slice(1)
    .map(row => row[geckoIdCol])
    .filter(id => id);

  if (ids.length === 0) return;

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=eur`;
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });

  if (response.getResponseCode() !== 200) {
    Logger.log('Erreur CoinGecko : ' + response.getContentText());
    return;
  }

  const prices = JSON.parse(response.getContentText());
  const now = new Date().toISOString();

  for (let i = 1; i < data.length; i++) {
    const geckoId = data[i][geckoIdCol];
    if (!geckoId || !prices[geckoId]) continue;

    sheet.getRange(i + 1, prixCol + 1).setValue(prices[geckoId].eur);
    sheet.getRange(i + 1, majCol + 1).setValue(now);
  }
}

// ─── DÉCLENCHEUR COMBINÉ ─────────────────────────────────────────────────────
// Appelle cette fonction depuis le trigger horaire.

function updateAllPrices() {
  updateETFPrices();
  updateCryptoPrices();
}
