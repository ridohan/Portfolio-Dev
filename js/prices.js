// prices.js
// Fetch des prix ETF (EODHD ou JustETF fallback) et crypto (CoinGecko) côté front.
// Snapshot journalier de l'historique des enveloppes.

const PRICES_TS_KEY   = 'portfolio_prices_ts';
const SNAPSHOT_TS_KEY = 'portfolio_snapshot_ts';
const CG_IDS_KEY      = 'portfolio_cg_ids'; // symbol → coingecko_id (legacy, non utilisé)

// ─── PRICE SERVICE ────────────────────────────────────────────────────────────

const PriceService = {

  lastRefreshTs() {
    const v = localStorage.getItem(PRICES_TS_KEY);
    return v ? Number(v) : null;
  },

  ageSeconds() {
    const ts = this.lastRefreshTs();
    return ts ? Math.floor((Date.now() - ts) / 1000) : Infinity;
  },

  shouldRefresh() {
    const ts = this.lastRefreshTs();
    if (!ts) return true;
    return (Date.now() - ts) > API.cacheTTL;
  },

  // ─── ETF — JustETF (appels parallèles, ISIN natif) ──────────────────────────

  _getJustETFBase() {
    const proxy = (STATE.ui_prefs?.justetf_proxy_url || '').trim().replace(/\/$/, '');
    return proxy || 'https://www.justetf.com';
  },

  async fetchETFPrice(isin) {
    const url = `${this._getJustETFBase()}/api/etfs/${isin}/quote?locale=fr&currency=EUR`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.latestQuote?.raw ?? null;
  },

  // ─── CRYPTO — CoinGecko ─────────────────────────────────────────────────────
  // `ids` est une liste d'IDs CoinGecko (ex: ['bitcoin', 'ethereum'])
  // stockés directement sur les positions — pas de résolution nécessaire.

  async fetchCryptoPrices(ids) {
    if (!ids.length) return {};
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=eur`
    );
    if (!res.ok) return {};
    const data = await res.json();
    // Retourne { bitcoin: 60000, ethereum: 3000, ... }
    const result = {};
    ids.forEach(id => {
      if (data[id]?.eur != null) result[id] = data[id].eur;
    });
    return result;
  },

  // ─── REFRESH PRINCIPAL ──────────────────────────────────────────────────────

  async fetchETFNames(isins) {
    if (!isins.length) return {};
    try {
      const proxy = (STATE.ui_prefs?.justetf_proxy_url || '').trim().replace(/\/$/, '');
      const url = proxy ? `${proxy}/openfigi/v3/mapping` : 'https://api.openfigi.com/v3/mapping';
      const body = isins.map(isin => ({ idType: 'ID_ISIN', idValue: isin }));
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return {};
      const data = await res.json();
      const names = {};
      isins.forEach((isin, i) => {
        const first = data[i]?.data?.[0]?.name;
        if (first) names[isin] = first.replace(/&amp;/g, '&');
      });
      return names;
    } catch { return {}; }
  },

  async refresh() {
    const now = new Date().toISOString();
    let etfOk = 0, cryptoOk = 0, errors = 0;

    // ISINs uniques dans les enveloppes bourse (hors LIQUIDITES)
    const bourseIds = STATE.envelopes.filter(e => e.type === 'bourse').map(e => e.id);
    const isins = [...new Set(
      STATE.positions
        .filter(p => bourseIds.includes(p.envelope_id) && p.identifiant && p.identifiant !== 'LIQUIDITES' && p.pos_type !== 'épargne')
        .map(p => p.identifiant)
    )];

    // Symboles uniques dans les enveloppes crypto
    const cryptoIds = STATE.envelopes.filter(e => e.type === 'crypto').map(e => e.id);
    const symbols = [...new Set(
      STATE.positions
        .filter(p => cryptoIds.includes(p.envelope_id) && p.identifiant)
        .map(p => p.identifiant)
    )];

    // ── Fetch ETF — JustETF en parallèle ─────────────────────────────────────
    if (isins.length) {
      const results = await Promise.allSettled(isins.map(isin => this.fetchETFPrice(isin)));
      results.forEach((res, i) => {
        const isin = isins[i];
        if (res.status === 'fulfilled' && res.value !== null) {
          const prix = res.value;
          const existing = STATE.prices.find(p => p.isin === isin);
          if (existing) { existing.prix_actuel = prix; existing.derniere_maj = now; }
          else STATE.prices.push({ isin, nom: isin, type: 'ETF', prix_actuel: prix, derniere_maj: now });
          etfOk++;
        } else { errors++; }
      });

      // ── Résolution des noms — uniquement pour les positions sans nom ──────
      const isinsWithoutName = isins.filter(isin =>
        STATE.positions.some(p => p.identifiant === isin && (!p.nom || p.nom === isin))
      );
      if (isinsWithoutName.length) {
        const names = await this.fetchETFNames(isinsWithoutName);
        Object.entries(names).forEach(([isin, name]) => {
          STATE.positions.forEach(p => {
            if (p.identifiant === isin && (!p.nom || p.nom === isin)) p.nom = name;
          });
          // Mettre à jour aussi le nom dans STATE.prices
          const priceEntry = STATE.prices.find(p => p.isin === isin);
          if (priceEntry && (!priceEntry.nom || priceEntry.nom === isin)) priceEntry.nom = name;
        });
      }
    }

    // ── Fetch crypto ─────────────────────────────────────────────────────────
    if (symbols.length) {
      try {
        const prices = await this.fetchCryptoPrices(symbols);
        symbols.forEach(id => {
          const prix = prices[id];
          if (prix == null) return;
          const existing = STATE.crypto_prices.find(p => p.id === id);
          if (existing) { existing.prix_actuel = prix; existing.derniere_maj = now; }
          else STATE.crypto_prices.push({ id, nom: id, prix_actuel: prix, derniere_maj: now });
          cryptoOk++;
        });
      } catch { errors++; }
    }

    localStorage.setItem(PRICES_TS_KEY, String(Date.now()));
    return { etfOk, cryptoOk, errors };
  },
};

// ─── SNAPSHOT SERVICE ─────────────────────────────────────────────────────────

const SnapshotService = {

  lastSnapshotTs() {
    const v = localStorage.getItem(SNAPSHOT_TS_KEY);
    return v ? Number(v) : null;
  },

  ageSeconds() {
    const ts = this.lastSnapshotTs();
    return ts ? Math.floor((Date.now() - ts) / 1000) : Infinity;
  },

  shouldSnapshot() {
    const ts = this.lastSnapshotTs();
    if (!ts) return true;
    return (Date.now() - ts) > 20 * 60 * 60 * 1000;
  },

  take() {
    const today = new Date().toISOString().slice(0, 10);

    // Premier match seulement — miroir de currentPrice() qui utilise .find()
    // Évite que des doublons ISIN fassent écraser le prix récent par un prix ancien
    const priceIndex = {};
    STATE.prices.forEach(p => {
      if (!(p.isin in priceIndex)) priceIndex[p.isin] = Number(p.prix_actuel) || 0;
    });
    STATE.crypto_prices.forEach(p => {
      if (p.id && !(p.id in priceIndex)) priceIndex[p.id] = Number(p.prix_actuel) || 0;
      if (p.symbole) { const k = p.symbole.toUpperCase(); if (!(k in priceIndex)) priceIndex[k] = Number(p.prix_actuel) || 0; }
    });

    const existingIdx = {};
    STATE.history.forEach((h, i) => {
      const d = String(h.date).slice(0, 10);
      existingIdx[`${d}|${h.envelope_id}`] = i;
    });

    STATE.envelopes.filter(e => e.actif !== false).forEach(envelope => {
      const positions = STATE.positions.filter(p => p.envelope_id === envelope.id);
      if (!positions.length) return;

      let valeurInvestie = 0, valeurActuelle = 0;

      positions.forEach(pos => {
        const qte     = Number(pos.quantite)   || 0;
        const pxAchat = Number(pos.prix_achat) || 0;
        const isEpPos = envelope.type === 'épargne' || pos.pos_type === 'épargne';

        if (pos.identifiant === 'LIQUIDITES') {
          valeurInvestie += qte;
          valeurActuelle += qte;
          return;
        }

        if (isEpPos) {
          // valeur_actuelle dissociée de prix_achat si renseignée
          const va = pos.valeur_actuelle != null ? Number(pos.valeur_actuelle) : pxAchat;
          valeurInvestie += pxAchat;
          valeurActuelle += va;
          return;
        }

        const lookupKey = pos.identifiant;
        const pxActuel = priceIndex[lookupKey] || Number(lookupKey) || 0;
        valeurInvestie += pxAchat * qte;
        valeurActuelle += pxActuel * qte;
      });

      const pvEuros = valeurActuelle - valeurInvestie;
      const pvPct   = valeurInvestie > 0
        ? Number(((valeurActuelle / valeurInvestie - 1) * 100).toFixed(2))
        : 0;

      const key   = `${today}|${envelope.id}`;
      const entry = { date: today, envelope_id: envelope.id, valeur_investie: valeurInvestie, valeur_actuelle: valeurActuelle, pv_euros: pvEuros, pv_pct: pvPct };

      if (existingIdx[key] !== undefined) {
        STATE.history[existingIdx[key]] = entry;
      } else {
        STATE.history.push(entry);
        existingIdx[key] = STATE.history.length - 1;
      }
    });

    localStorage.setItem(SNAPSHOT_TS_KEY, String(Date.now()));
  },
};
