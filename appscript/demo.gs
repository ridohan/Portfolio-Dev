// demo.gs
// Initialise des données de démonstration réalistes dans toutes les feuilles.
// Fonction principale : initDemoData()
//
// ⚠️  ATTENTION : cette fonction EFFACE et RECRÉE toutes les données.
//     Ne pas exécuter sur un compte avec de vraies données.

function initDemoData() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const now = new Date();

  _log('🚀 Initialisation des données de démo...');

  _initPortfolios(ss);
  _initExpenses(ss, now);
  _initImmo(ss, now);
  _initResidences(ss, now);
  _initFireProfile(ss);
  _initMilestones(ss);

  SpreadsheetApp.flush();
  _log('✅ Données de démo initialisées avec succès !');
}

function _log(msg) {
  Logger.log(msg);
}

// ─── IDs stables ─────────────────────────────────────────────────────────────

const D = {
  // Portfolios
  PF1: 'p_demo_01', PF2: 'p_demo_02',
  // Enveloppes
  E_PEA: 'e_demo_01', E_CTO: 'e_demo_02', E_LA: 'e_demo_03',
  E_LDDS: 'e_demo_04', E_AV: 'e_demo_05', E_CRYPTO: 'e_demo_06',
  E_PER: 'e_demo_07', E_CEL: 'e_demo_08',
  // Biens immo
  IMMO1: 'bi_demo_01', IMMO2: 'bi_demo_02',
  // Résidence
  RESID1: 're_demo_01',
  // Expense categories
  CAT_LOG: 'ec_demo_01', CAT_VIE: 'ec_demo_02', CAT_AUTO: 'ec_demo_03',
  CAT_ABO: 'ec_demo_04', CAT_LOI: 'ec_demo_05', CAT_SAN: 'ec_demo_06',
};

// ─── PORTFOLIOS & POSITIONS ───────────────────────────────────────────────────

function _initPortfolios(ss) {
  _log('  → Portfolios...');

  // ── portfolios ────────────────────────────────────────────────────────────
  _resetSheet(ss, 'portfolios', ['id','nom','cible_actions','cible_obligations','cible_cash'], ['cible_actions','cible_obligations','cible_cash']);
  const pfSheet = ss.getSheetByName('portfolios');
  pfSheet.appendRow([D.PF1, 'Patrimoine Perso', 70, 10, 20]);
  pfSheet.appendRow([D.PF2, 'Retraite',         80, 15,  5]);

  // ── sub_portfolios ────────────────────────────────────────────────────────
  _resetSheet(ss, 'sub_portfolios', ['id','nom','portfolio_id']);
  // Pas de sous-portfolio pour simplifier

  // ── envelopes ─────────────────────────────────────────────────────────────
  _resetSheet(ss, 'envelopes', ['id','nom','type','portfolio_id','sub_portfolio_id']);
  const envSheet = ss.getSheetByName('envelopes');
  // Portfolio 1 — Patrimoine Perso
  envSheet.appendRow([D.E_PEA,    'PEA Boursorama',   'bourse',  D.PF1, '']);
  envSheet.appendRow([D.E_CTO,    'CTO Degiro',       'bourse',  D.PF1, '']);
  envSheet.appendRow([D.E_LA,     'Livret A',         'épargne', D.PF1, '']);
  envSheet.appendRow([D.E_LDDS,   'LDDS',             'épargne', D.PF1, '']);
  envSheet.appendRow([D.E_AV,     'Assurance Vie',    'épargne', D.PF1, '']);
  envSheet.appendRow([D.E_CRYPTO, 'Kraken',           'crypto',  D.PF1, '']);
  // Portfolio 2 — Retraite
  envSheet.appendRow([D.E_PER,    'PER Linxea',       'bourse',  D.PF2, '']);
  envSheet.appendRow([D.E_CEL,    "CEL CIC",          'épargne', D.PF2, '']);

  // ── positions ─────────────────────────────────────────────────────────────
  _resetSheet(ss, 'positions', ['id','envelope_id','identifiant','nom','quantite','prix_achat','date_achat'], ['quantite','prix_achat']);
  const posSheet = ss.getSheetByName('positions');
  const today = _isoDate(new Date());

  // PEA Boursorama — ETF monde + Europe
  posSheet.appendRow(['pos_demo_01', D.E_PEA, 'IE00B4L5Y983', 'iShares Core MSCI World',          14.5, 88.32,  '2022-03-15']);
  posSheet.appendRow(['pos_demo_02', D.E_PEA, 'IE00BK5BQT80', 'iShares Core MSCI World UCITS',    22.0, 76.10,  '2022-06-20']);
  posSheet.appendRow(['pos_demo_03', D.E_PEA, 'FR0011871128', 'Lyxor PEA Monde',                  30.0, 34.50,  '2023-01-10']);
  posSheet.appendRow(['pos_demo_04', D.E_PEA, 'FR0011550185', 'Lyxor Core MSCI World',             18.0, 41.20,  '2023-04-05']);

  // CTO Degiro — diversification
  posSheet.appendRow(['pos_demo_05', D.E_CTO, 'IE00B5BMR087', 'iShares Core S&P 500',              8.0, 385.50, '2021-11-08']);
  posSheet.appendRow(['pos_demo_06', D.E_CTO, 'IE00B53SZB19', 'iShares MSCI World UCITS',          5.0, 104.20, '2022-02-14']);
  posSheet.appendRow(['pos_demo_07', D.E_CTO, 'IE000BI8OT95', 'Amundi Prime All Country World',   12.0,  27.80, '2023-07-20']);
  posSheet.appendRow(['pos_demo_08', D.E_CTO, 'IE00BDBRDM35', 'Vanguard FTSE All-World',           6.0, 103.40, '2023-09-12']);
  posSheet.appendRow(['pos_demo_09', D.E_CTO, 'IE00BJ0KDQ92', 'iShares MSCI World Quality Factor', 9.0,  18.90, '2024-01-15']);

  // Livret A — épargne (prix_achat = solde, quantite = taux %)
  posSheet.appendRow(['pos_demo_10', D.E_LA,  'LIVRET_A',     'Livret A',                           1, 22000,  '2020-01-01']);

  // LDDS
  posSheet.appendRow(['pos_demo_11', D.E_LDDS,'LDDS',         'LDDS',                               1, 8500,   '2020-01-01']);

  // Assurance Vie — fonds euros
  posSheet.appendRow(['pos_demo_12', D.E_AV,  'FONDS_EUROS',  'Fonds Euros Linxea Spirit',          1, 35000,  '2020-06-01']);

  // Crypto — BTC uniquement
  posSheet.appendRow(['pos_demo_13', D.E_CRYPTO, 'BTC',       'Bitcoin',                         0.42, 38500,  '2022-11-20']);

  // PER — ETF retraite
  posSheet.appendRow(['pos_demo_14', D.E_PER, 'LU1681043599', 'Amundi MSCI World',                20.0, 312.00, '2021-04-01']);
  posSheet.appendRow(['pos_demo_15', D.E_PER, 'IE00B53SZB19', 'iShares MSCI World UCITS',         15.0, 104.20, '2021-04-01']);

  // CEL
  posSheet.appendRow(['pos_demo_16', D.E_CEL, 'CEL',          'CEL CIC',                            1, 3200,   '2020-01-01']);

  // ── prices (cours fictifs mais réalistes) ─────────────────────────────────
  _resetSheet(ss, 'prices', ['isin','nom','type','prix_actuel','derniere_maj'], ['prix_actuel']);
  const priceSheet = ss.getSheetByName('prices');
  const maj = _isoDate(new Date());
  [
    ['IE00B4L5Y983', 'iShares Core MSCI World',           'action', 102.45],
    ['IE00BK5BQT80', 'iShares Core MSCI World UCITS',     'action',  91.30],
    ['FR0011871128', 'Lyxor PEA Monde',                   'action',  41.80],
    ['FR0011550185', 'Lyxor Core MSCI World',             'action',  49.60],
    ['IE00B5BMR087', 'iShares Core S&P 500',              'action', 438.20],
    ['IE00B53SZB19', 'iShares MSCI World UCITS',          'action', 119.50],
    ['IE000BI8OT95', 'Amundi Prime All Country World',    'action',  32.10],
    ['IE00BDBRDM35', 'Vanguard FTSE All-World',           'action', 118.70],
    ['IE00BJ0KDQ92', 'iShares MSCI World Quality Factor', 'action',  22.40],
    ['LU1681043599', 'Amundi MSCI World',                 'action', 368.50],
  ].forEach(([isin, nom, type, prix]) => priceSheet.appendRow([isin, nom, type, prix, maj]));

  // ── crypto_prices ─────────────────────────────────────────────────────────
  _resetSheet(ss, 'crypto_prices', ['symbole','nom','prix_actuel','derniere_maj'], ['prix_actuel']);
  ss.getSheetByName('crypto_prices').appendRow(['BTC', 'Bitcoin', 62450, maj]);

  // ── charges ───────────────────────────────────────────────────────────────
  _resetSheet(ss, 'charges', ['id','portfolio_id','nom','montant','date_fin'], ['montant']);
  const chgSheet = ss.getSheetByName('charges');
  chgSheet.appendRow(['chg_demo_01', D.PF1, 'Frais courtage Degiro', 30,  '2026-12-31']);
  chgSheet.appendRow(['chg_demo_02', D.PF1, 'Frais tenue PEA',       24,  '']);

  // ── history (snapshot synthétique des 6 derniers mois) ───────────────────
  _resetSheet(ss, 'history', ['date','envelope_id','valeur_investie','valeur_actuelle','pv_euros','pv_pct'], ['valeur_investie','valeur_actuelle','pv_euros','pv_pct']);
  const histSheet = ss.getSheetByName('history');
  // Données synthétiques par enveloppe — progression réaliste
  const histData = [
    // [envelope_id, invested, actuel_m-5, actuel_m-4, actuel_m-3, actuel_m-2, actuel_m-1, actuel_now]
    [D.E_PEA,    11200, 11800, 12100, 12400, 12900, 13200, 13580],
    [D.E_CTO,    22000, 23100, 23800, 24200, 25100, 25800, 26320],
    [D.E_PER,     8820,  9200,  9400,  9650,  9900, 10100, 10380],
    [D.E_CRYPTO, 16170, 18000, 19500, 22000, 24500, 26000, 26229],
  ];
  for (let mAgo = 5; mAgo >= 0; mAgo--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - mAgo);
    const dateStr = _isoDate(d);
    histData.forEach(([envId, inv, v5, v4, v3, v2, v1, v0]) => {
      const actuel = [v5, v4, v3, v2, v1, v0][5 - mAgo];
      const pv     = actuel - inv;
      const pct    = inv > 0 ? (pv / inv * 100).toFixed(2) : 0;
      histSheet.appendRow([dateStr, envId, inv, actuel, pv, pct]);
    });
  }

  _log('    ✓ Portfolios, enveloppes, positions, prix, historique');
}

// ─── DÉPENSES ─────────────────────────────────────────────────────────────────

function _initExpenses(ss, now) {
  _log('  → Dépenses...');

  // ── expense_categories ───────────────────────────────────────────────────
  _resetSheet(ss, 'expense_categories', ['id','nom','type','color','ordre']);
  const catSheet = ss.getSheetByName('expense_categories');
  catSheet.appendRow([D.CAT_LOG,  'Logement',         'vital',   'blue',    1]);
  catSheet.appendRow([D.CAT_VIE,  'Vie quotidienne',  'vital',   'emerald', 2]);
  catSheet.appendRow([D.CAT_AUTO, 'Voitures',         'confort', 'amber',   3]);
  catSheet.appendRow([D.CAT_ABO,  'Abonnements',      'confort', 'purple',  4]);
  catSheet.appendRow([D.CAT_LOI,  'Loisirs',          'loisir',  'pink',    5]);
  catSheet.appendRow([D.CAT_SAN,  'Santé',            'vital',   'red',     6]);

  // ── expense_items ────────────────────────────────────────────────────────
  _resetSheet(ss, 'expense_items', ['id','category_id','nom']);
  const itemSheet = ss.getSheetByName('expense_items');

  const items = {
    // Logement
    ei_log_1:  [D.CAT_LOG,  'Remboursement crédit RP'],
    ei_log_2:  [D.CAT_LOG,  'Charges copropriété'],
    ei_log_3:  [D.CAT_LOG,  'Électricité / Gaz'],
    ei_log_4:  [D.CAT_LOG,  'Internet & Téléphone'],
    ei_log_5:  [D.CAT_LOG,  'Assurance habitation'],
    // Vie quotidienne
    ei_vie_1:  [D.CAT_VIE,  'Courses alimentaires'],
    ei_vie_2:  [D.CAT_VIE,  'Restaurants / Cafés'],
    ei_vie_3:  [D.CAT_VIE,  'Hygiène & beauté'],
    // Voitures
    ei_auto_1: [D.CAT_AUTO, 'Assurance voiture'],
    ei_auto_2: [D.CAT_AUTO, 'Carburant'],
    ei_auto_3: [D.CAT_AUTO, 'Entretien & Réparations'],
    // Abonnements
    ei_abo_1:  [D.CAT_ABO,  'Netflix'],
    ei_abo_2:  [D.CAT_ABO,  'Spotify'],
    ei_abo_3:  [D.CAT_ABO,  'Amazon Prime'],
    ei_abo_4:  [D.CAT_ABO,  'Salle de sport'],
    // Loisirs
    ei_loi_1:  [D.CAT_LOI,  'Sorties & Cinéma'],
    ei_loi_2:  [D.CAT_LOI,  'Voyages'],
    ei_loi_3:  [D.CAT_LOI,  'Culture & Livres'],
    // Santé
    ei_san_1:  [D.CAT_SAN,  'Mutuelle'],
    ei_san_2:  [D.CAT_SAN,  'Médecin & Spécialistes'],
    ei_san_3:  [D.CAT_SAN,  'Pharmacie'],
  };
  Object.entries(items).forEach(([id, [catId, nom]]) => itemSheet.appendRow([id, catId, nom]));

  // ── expense_aids ─────────────────────────────────────────────────────────
  _resetSheet(ss, 'expense_aids', ['id','nom','montant'], ['montant']);
  const aidSheet = ss.getSheetByName('expense_aids');
  aidSheet.appendRow(['ea_demo_01', 'Prime activité', 180]);

  // ── expense_entries ──────────────────────────────────────────────────────
  _resetSheet(ss, 'expense_entries', ['id','item_id','annee','mois','montant','note'], ['annee','mois','montant']);
  const entrySheet = ss.getSheetByName('expense_entries');

  // Montants mensuels de référence par poste (légère variation d'un mois à l'autre)
  const baseAmounts = {
    ei_log_1:  780,   // crédit RP
    ei_log_2:  120,   // charges copro
    ei_log_3:   95,   // elec/gaz (variable selon saison)
    ei_log_4:   45,   // internet
    ei_log_5:   22,   // assurance
    ei_vie_1:  380,   // courses
    ei_vie_2:  140,   // restos
    ei_vie_3:   50,   // hygiène
    ei_auto_1:  65,   // assurance voiture
    ei_auto_2:  90,   // carburant
    ei_auto_3:   0,   // entretien (ponctuel)
    ei_abo_1:   17,   // Netflix
    ei_abo_2:   10,   // Spotify
    ei_abo_3:    6,   // Amazon
    ei_abo_4:   40,   // salle de sport
    ei_loi_1:   60,   // sorties
    ei_loi_2:    0,   // voyages (ponctuel)
    ei_loi_3:   25,   // culture
    ei_san_1:   85,   // mutuelle
    ei_san_2:    0,   // médecin (ponctuel)
    ei_san_3:   18,   // pharmacie
  };

  const year = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12

  // Génère les entrées pour les mois de janvier jusqu'au mois courant
  let entryId = 1;
  for (let m = 1; m <= currentMonth; m++) {
    Object.entries(baseAmounts).forEach(([itemId, base]) => {
      if (!base) {
        // Dépenses ponctuelles : apparaissent certains mois
        const ponctuel = _poncutelAmount(itemId, m, year);
        if (!ponctuel) return;
        entrySheet.appendRow([`ee_demo_${String(entryId).padStart(4,'0')}`, itemId, year, m, ponctuel, '']);
        entryId++;
        return;
      }
      // Variation ±10% autour du montant de base
      const variation = base * (0.90 + Math.random() * 0.20);
      const montant   = Math.round(variation);
      entrySheet.appendRow([`ee_demo_${String(entryId).padStart(4,'0')}`, itemId, year, m, montant, '']);
      entryId++;
    });
  }

  _log('    ✓ Catégories, postes, entrées (' + (entryId - 1) + ' lignes), aides');
}

// Dépenses ponctuelles selon le mois
function _poncutelAmount(itemId, month, year) {
  if (itemId === 'ei_auto_3') {
    // Entretien voiture en mars et septembre
    if (month === 3) return 320;
    if (month === 9) return 180;
  }
  if (itemId === 'ei_loi_2') {
    // Voyages en février et juillet
    if (month === 2) return 680;
    if (month === 7) return 1200;
  }
  if (itemId === 'ei_san_2') {
    // Médecin en janvier, avril
    if (month === 1) return 55;
    if (month === 4) return 30;
  }
  return 0;
}

// ─── IMMOBILIER LOCATIF ───────────────────────────────────────────────────────

function _initImmo(ss, now) {
  _log('  → Immobilier locatif...');

  const IMMO_HEADERS = [
    'id','nom','prix_achat','surface_m2',
    'loyer_annuel_ht','charges_annuelles','taxe_fonciere',
    'montant_credit','taux_credit','duree_credit_mois','date_debut_credit',
    'mensualite_assurance','numero_pret','charges_mensuelles',
  ];
  const IMMO_NUMERIC = ['prix_achat','surface_m2','loyer_annuel_ht','charges_annuelles','taxe_fonciere','montant_credit','taux_credit','duree_credit_mois','mensualite_assurance','charges_mensuelles'];
  const biensSheet = _resetSheet(ss, 'biens_immo', IMMO_HEADERS, IMMO_NUMERIC);

  // Début des crédits : il y a 9 et 6 mois
  const debut1 = new Date(now); debut1.setMonth(debut1.getMonth() - 9);
  const debut2 = new Date(now); debut2.setMonth(debut2.getMonth() - 6);

  _appendRow(biensSheet, IMMO_HEADERS, [
    D.IMMO1, 'Appartement T2 — Lyon 7e', 98000, 42,
    8400, 1200, 720,
    78000, 0.034, 300, _isoDate(debut1),
    20, 'PRD-2024-04721', 100,
  ], IMMO_NUMERIC);
  _appendRow(biensSheet, IMMO_HEADERS, [
    D.IMMO2, 'Studio — Paris 18e', 105000, 22,
    9600, 900, 850,
    84000, 0.032, 300, _isoDate(debut2),
    18, 'PRD-2024-09182', 75,
  ], IMMO_NUMERIC);

  // ── dépenses immo (loyers + échéances + charges) ──────────────────────────
  _resetSheet(ss, 'depenses_immo', [
    'id','bien_id','type','date','montant_ttc','tva_rate','montant_ht',
    'periode_debut','periode_fin','note',
  ], ['montant_ttc','tva_rate','montant_ht']);
  const depSheet = ss.getSheetByName('depenses_immo');
  let depId = 1;

  // Mensualités crédit bien 1 (taux 3.4%, 78K, 300 mois) ≈ 384 €
  // Loyers bien 1 : 700 €/mois HT
  const mens1   = _mensualite(78000, 0.034, 300);
  const mens2   = _mensualite(84000, 0.032, 300);
  const loyer1M = Math.round(8400 / 12);  // 700 €
  const loyer2M = Math.round(9600 / 12);  // 800 €

  // Nombre de mois remplis pour chaque bien depuis le début du crédit
  const moisImmo1 = Math.min(9, now.getMonth() + 1);
  const moisImmo2 = Math.min(6, now.getMonth() + 1);

  [
    { bienId: D.IMMO1, debutCredit: debut1, nMois: moisImmo1, mens: mens1, loyer: loyer1M },
    { bienId: D.IMMO2, debutCredit: debut2, nMois: moisImmo2, mens: mens2, loyer: loyer2M },
  ].forEach(({ bienId, debutCredit, nMois, mens, loyer }) => {

    for (let i = 0; i < nMois; i++) {
      const d = new Date(debutCredit);
      d.setMonth(d.getMonth() + i);
      // Limiter au mois courant
      if (d > now) break;

      const dateStr  = _isoDate(d);
      const periodeD = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-01`;
      const periodeF = periodeD; // mensuel = même mois

      // Loyer perçu
      depSheet.appendRow([
        `di_demo_${String(depId++).padStart(4,'0')}`,
        bienId, 'loyer', dateStr,
        loyer, null, loyer,
        periodeD, periodeF,
        `Loyer ${_moisLabel(d.getMonth())} ${d.getFullYear()}`,
      ]);

      // Échéance prêt
      depSheet.appendRow([
        `di_demo_${String(depId++).padStart(4,'0')}`,
        bienId, 'echeance_pret', dateStr,
        Math.round(mens), null, Math.round(mens),
        null, null,
        `Échéance ${_moisLabel(d.getMonth())} ${d.getFullYear()}`,
      ]);
    }

    // Charge ponctuelle (assurance PNO annuelle)
    const chargeDate = new Date(debutCredit);
    chargeDate.setMonth(chargeDate.getMonth() + 1);
    if (chargeDate <= now) {
      depSheet.appendRow([
        `di_demo_${String(depId++).padStart(4,'0')}`,
        bienId, 'assurance', _isoDate(chargeDate),
        180, null, 180,
        null, null, 'Assurance PNO annuelle',
      ]);
    }
  });

  _log('    ✓ 2 biens, ' + (depId - 1) + ' entrées de dépenses immo');
}

// ─── RÉSIDENCES ───────────────────────────────────────────────────────────────

function _initResidences(ss, now) {
  _log('  → Résidences...');

  const RESID_HEADERS = [
    'id','nom','type','prix_achat','valeur_estimee','date_valeur_estimee',
    'quote_part','montant_credit','taux_credit','duree_credit_mois',
    'date_debut_credit','mensualite_assurance','numero_pret','credit_part_soldee',
  ];
  const RESID_NUMERIC = ['prix_achat','valeur_estimee','quote_part','montant_credit','taux_credit','duree_credit_mois','mensualite_assurance','credit_part_soldee'];
  const residSheet = _resetSheet(ss, 'residences', RESID_HEADERS, RESID_NUMERIC);

  // Crédit commencé il y a 3 ans
  const debutRP = new Date(now);
  debutRP.setFullYear(debutRP.getFullYear() - 3);
  debutRP.setDate(1);

  _appendRow(residSheet, RESID_HEADERS, [
    D.RESID1,
    'Résidence Principale',
    'principale',
    250000,            // prix d'achat
    272000,            // valeur estimée actuelle
    _isoDate(now),     // date MAJ valeur
    1,                 // quote-part 100%
    200000,            // crédit 200K
    0.012,             // taux 1.2%
    240,               // 20 ans
    _isoDate(debutRP),
    35,                // assurance 35€/mois
    'HAB-2021-00347',  // n° prêt
    0,                 // non soldé
  ], RESID_NUMERIC);

  _log('    ✓ 1 résidence principale');
}

// ─── PROFIL FIRE ──────────────────────────────────────────────────────────────

function _initFireProfile(ss) {
  _log('  → Profil FIRE...');

  let sheet = ss.getSheetByName('fire_profile');
  if (!sheet) {
    sheet = ss.insertSheet('fire_profile');
    sheet.appendRow(['key', 'value']);
  } else {
    sheet.clearContents();
    sheet.appendRow(['key', 'value']);
  }

  const profile = {
    patrimoine_actuel:    120000,
    depenses_annuelles:    24000,
    taux_retrait:           4.0,
    rendement_annuel:       7.0,
    age_actuel:              32,
    age_cible_fire:          50,
    apport_mensuel:         800,
  };

  Object.entries(profile).forEach(([key, value]) => sheet.appendRow([key, value]));
  _log('    ✓ Profil FIRE');
}

// ─── JALONS ───────────────────────────────────────────────────────────────────

function _initMilestones(ss) {
  _log('  → Jalons (ui_prefs)...');

  // Les jalons sont stockés dans ui_prefs côté Google Sheets
  let sheet = ss.getSheetByName('ui_prefs');
  if (!sheet) {
    sheet = ss.insertSheet('ui_prefs');
    sheet.appendRow(['key', 'value']);
  }

  // Supprimer l'entrée portfolio_milestones si elle existe déjà
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === 'portfolio_milestones') sheet.deleteRow(i + 1);
  }

  const milestones = [
    { id: 'mile_demo_01', label: 'Cap des 300K',  valeur: 300000, emoji: '🥉' },
    { id: 'mile_demo_02', label: 'Cap des 500K',  valeur: 500000, emoji: '🥈' },
    { id: 'mile_demo_03', label: 'Cap des 700K',  valeur: 700000, emoji: '🥇' },
  ];

  sheet.appendRow(['portfolio_milestones', JSON.stringify(milestones)]);
  _log('    ✓ 3 jalons (300K, 500K, 700K)');
}

// ─── UTILITAIRES ─────────────────────────────────────────────────────────────

function _resetSheet(ss, name, headers, numericCols) {
  // Supprime et recrée la feuille pour garantir un état propre
  // (clearFormats seul ne réinitialise pas les colonnes au format Texte)
  const existing = ss.getSheetByName(name);
  if (existing) ss.deleteSheet(existing);
  const sheet = ss.insertSheet(name);

  // En-têtes en gras
  sheet.appendRow(headers);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

  // Force le format numérique sur toute la colonne (hors en-tête)
  if (numericCols && numericCols.length) {
    numericCols.forEach(colName => {
      const colIdx = headers.indexOf(colName) + 1;
      if (colIdx > 0) {
        sheet.getRange(2, colIdx, sheet.getMaxRows() - 1, 1).setNumberFormat('0.##########');
      }
    });
  }

  return sheet;
}

// Ajoute une ligne en forçant explicitement le type numérique sur chaque valeur
// (appendRow seul peut stocker un nombre comme texte si la colonne a un historique de format Texte)
function _appendRow(sheet, headers, values, numericCols) {
  numericCols = numericCols || [];
  sheet.appendRow(values);
  const row = sheet.getLastRow();
  values.forEach((val, i) => {
    if (numericCols.includes(headers[i]) && val !== null && val !== '') {
      const cell = sheet.getRange(row, i + 1);
      cell.setValue(Number(val));
      cell.setNumberFormat('0.##########');
    }
  });
}

function _isoDate(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function _mensualite(capital, tauxAnnuel, dureesMois) {
  const t = tauxAnnuel / 12;
  if (t === 0) return capital / dureesMois;
  return capital * t * Math.pow(1 + t, dureesMois) / (Math.pow(1 + t, dureesMois) - 1);
}

function _moisLabel(monthIndex) {
  return ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'][monthIndex];
}
