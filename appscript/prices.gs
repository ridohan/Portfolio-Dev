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
        sheet.getRange(i + 1, prixCol + 1).setValue(Number(prix));
        sheet.getRange(i + 1, majCol + 1).setValue(new Date().toISOString());
      }
    } catch (err) {
      Logger.log(`Erreur prix ETF ${isin} : ${err.message}`);
    }

    Utilities.sleep(500); // Pause entre les requêtes pour éviter le rate limiting
  }
}

function fetchJustETFPrice(isin) {

  const currency = 'EUR';
  const locale = 'fr';
  // ⚠️ Remplace cette URL par ton endpoint JustETF exact.
  // Exemple de pattern connu : https://www.justetf.com/api/etfs?isin={ISIN}&locale=fr&valuation=EUR
  const url = `https://www.justetf.com/api/etfs/${isin}/quote?locale=${locale}&currency=${currency}`;


  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: { 'Accept': 'application/json' },
  });

  if (response.getResponseCode() !== 200) return null;

  const json = JSON.parse(response.getContentText());

  // ⚠️ Adapte ce chemin selon la structure réelle du JSON retourné par JustETF.
  // Exemple : json.etfs[0].latestPrice ou json.quote.last, etc.
  return json?.latestQuote?.raw ?? null;
}

// ─── CRYPTO — CoinMarketCap ──────────────────────────────────────────────────────

function updateCryptoPrices() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('crypto_prices');
  if (!sheet || sheet.getLastRow() < 2) return;

  const apiKey = PropertiesService.getScriptProperties().getProperty('CMC_API_KEY');
  if (!apiKey) {
    Logger.log('CMC_API_KEY manquante — lance setCMCApiKey() pour la définir.');
    return;
  }

  // Récupère les 500 plus grosses cryptos converties en EUR
  const url = 'https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest'
    + '?aux=cmc_rank&limit=500&convert=EUR';

  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    headers: { 'X-CMC_PRO_API_KEY': apiKey, 'Accept': 'application/json' },
  });

  if (response.getResponseCode() !== 200) {
    Logger.log('Erreur CoinMarketCap : ' + response.getContentText());
    return;
  }

  const listings = JSON.parse(response.getContentText()).data;

  // Index par symbole : { BTC: { prix: 45000, nom: 'Bitcoin' }, ... }
  const dataBySymbol = {};
  listings.forEach(coin => {
    dataBySymbol[coin.symbol.toUpperCase()] = {
      prix: coin.quote?.EUR?.price ?? null,
      nom:  coin.name ?? '',
    };
  });

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const symCol  = headers.indexOf('symbole');
  const nomCol  = headers.indexOf('nom');
  const prixCol = headers.indexOf('prix_actuel');
  const majCol  = headers.indexOf('derniere_maj');
  const now     = new Date().toISOString();

  for (let i = 1; i < data.length; i++) {
    const symbole = String(data[i][symCol]).toUpperCase();
    const entry = dataBySymbol[symbole];
    if (!entry || entry.prix === null) {
      Logger.log(`Symbole introuvable dans le top 500 CMC : ${symbole}`);
      continue;
    }
    sheet.getRange(i + 1, prixCol + 1).setValue(Number(entry.prix));
    sheet.getRange(i + 1, nomCol  + 1).setValue(entry.nom);
    sheet.getRange(i + 1, majCol  + 1).setValue(now);
  }
}

// ─── DÉCLENCHEUR COMBINÉ ─────────────────────────────────────────────────────
// Appelle cette fonction depuis le trigger horaire.

function updateAllPrices() {
  updateETFPrices();
  updateCryptoPrices();
}
