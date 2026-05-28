# Enveloppe Bourse — Instructions

## Contexte

Une enveloppe de type **bourse** représente un compte-titres réel (ex : PEA, CTO, PEA-PME). Elle contient un ensemble de **positions** sur des ETF cotés.

---

## Structure d'une position

Une position représente un ETF détenu dans l'enveloppe.

### Champs saisis à l'ajout

| Champ | Description |
|---|---|
| `ISIN` | Identifiant international de l'ETF |
| `Prix d'achat unitaire` | Prix payé par part à l'achat (en €) |
| `Quantité` | Nombre de parts détenues |

### Champs résolus automatiquement

| Champ | Source |
|---|---|
| `Nom` | Google Sheet (résolu par AppScript via l'ISIN) |
| `Type` | Google Sheet (résolu par AppScript via l'ISIN) |
| `Prix actuel` | Google Sheet (mis à jour automatiquement par AppScript) |

> Si l'ISIN saisi n'existe pas encore dans la Google Sheet, l'application l'indique à l'utilisateur et lui demande de l'ajouter dans la feuille pour que l'AppScript puisse le résoudre.

---

## Données calculées

| Donnée | Formule |
|---|---|
| Valeur à l'achat | `prix d'achat × quantité` |
| Valeur actuelle | `prix actuel × quantité` |
| Plus-value latente (€) | `valeur actuelle − valeur à l'achat` |
| Plus-value latente (%) | `(valeur actuelle / valeur à l'achat − 1) × 100` |

---

## Types de positions

Chaque position est classée dans l'un des deux types suivants, résolu via la Google Sheet :

- **Action** — ETF exposé aux marchés actions (ex : MSCI World, S&P 500, CAC 40)
- **Obligation** — ETF exposé aux marchés obligataires (ex : obligations d'État, corporate bonds)

---

## Agrégation au niveau de l'enveloppe

| Donnée | Description |
|---|---|
| Valeur totale | Somme des valeurs actuelles de toutes les positions |
| Valeur investie | Somme des valeurs à l'achat de toutes les positions |
| Plus-value totale (€) | Valeur totale − valeur investie |
| Plus-value totale (%) | (Valeur totale / valeur investie − 1) × 100 |
| Répartition actions / obligations | % de la valeur totale par type |

---

## Architecture technique

### Stockage des données portfolio

Les données du portfolio (enveloppes, positions, prix d'achat, quantités) sont stockées dans le **`localStorage`** du navigateur.

L'utilisateur peut **exporter** ses données en JSON et les **importer** pour backup/restauration ou migration entre navigateurs.

### Récupération des prix via Google Sheets

Une Google Sheet sert de source de données pour les cours et les métadonnées des ETF.

**Structure de la feuille :**

| ISIN | Nom | Type | Prix actuel |
|---|---|---|---|
| LU0274208692 | Amundi MSCI World | action | 412.50 |
| FR0010754200 | Lyxor Euro Govt Bond | obligation | 185.30 |

L'AppScript Google tourne sur un **déclencheur horaire** pour mettre à jour le `Prix actuel` de chaque ligne. Il est aussi responsable de résoudre le `Nom` et le `Type` à partir de l'ISIN lors de l'ajout d'un nouvel ETF dans la feuille.

**Accès depuis l'app HTML :**

La feuille est publiée publiquement. L'app effectue un `fetch()` sur l'URL de publication pour lire les données au format JSON ou CSV. Aucun token d'authentification requis.

---

## Voir aussi

- [Structure globale du projet](../GENERAL.MD)
- [Architecture technique globale](../TECHNICAL.MD)
- Crypto *(à venir)*
- Épargne *(à venir)*
