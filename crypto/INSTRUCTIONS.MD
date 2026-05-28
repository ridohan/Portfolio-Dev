# Enveloppe Crypto — Instructions

## Contexte

Une enveloppe de type **crypto** représente un wallet ou compte d'échange (ex : Binance, Ledger, Coinbase). Elle contient des **positions** sur des cryptomonnaies.

Dans le cadre du **3-fund portfolio**, la crypto contribue à la poche **Actions** (actif risqué).

---

## Structure d'une position

### Champs saisis à l'ajout

| Champ | Type | Description |
|---|---|---|
| `Symbole` | string | Symbole du coin (ex : `BTC`, `ETH`, `SOL`) |
| `Prix d'achat unitaire` | number | Prix payé par unité à l'achat (en €) |
| `Quantité` | number | Nombre d'unités détenues |

### Champs résolus automatiquement

| Champ | Source |
|---|---|
| `Nom` | Onglet `crypto_prices` de la Google Sheet (résolu via le symbole) |
| `Prix actuel` | Onglet `crypto_prices` de la Google Sheet (mis à jour par AppScript) |

> Si le symbole saisi n'existe pas encore dans `crypto_prices`, l'application l'indique et invite l'utilisateur à l'ajouter dans la feuille.

---

## Données calculées

| Donnée | Formule |
|---|---|
| Valeur à l'achat | `prix d'achat × quantité` |
| Valeur actuelle | `prix actuel × quantité` |
| Plus-value latente (€) | `valeur actuelle − valeur à l'achat` |
| Plus-value latente (%) | `(valeur actuelle / valeur à l'achat − 1) × 100` |

---

## Agrégation au niveau de l'enveloppe

| Donnée | Description |
|---|---|
| Valeur totale | Somme des valeurs actuelles de toutes les positions |
| Valeur investie | Somme des valeurs à l'achat de toutes les positions |
| Plus-value totale (€) | Valeur totale − valeur investie |
| Plus-value totale (%) | (Valeur totale / valeur investie − 1) × 100 |

---

## Contribution au 3-fund portfolio

La crypto contribue intégralement à la poche **Actions**, au même titre que les ETF actions en bourse.

---

## Mise à jour des prix via Google Sheets

Les prix sont gérés dans un onglet dédié `crypto_prices` de la Google Sheet :

| Colonne | Description |
|---|---|
| `symbole` | Symbole du coin (ex : `BTC`) |
| `nom` | Nom complet (ex : `Bitcoin`) |
| `prix_actuel` | Prix en € |
| `derniere_maj` | Horodatage de la dernière mise à jour |

L'AppScript met à jour cet onglet via une **API crypto** (ex : CoinGecko API publique) sur un déclencheur horaire, séparément de l'onglet `prices` dédié aux ETF bourse.

---

## Flux d'ajout d'une position

1. L'utilisateur saisit le **symbole**, le **prix d'achat unitaire** et la **quantité**.
2. L'app vérifie que le symbole existe dans `crypto_prices`.
3. Les données calculées sont disponibles immédiatement.

---

## Voir aussi

- [Structure globale du projet](../GENERAL.MD)
- [Architecture technique](../TECHNICAL.MD)
- [Enveloppe Bourse](../bourse/INSTRUCTIONS.MD)
- [Enveloppe Épargne](../epargne/INSTRUCTIONS.MD)
