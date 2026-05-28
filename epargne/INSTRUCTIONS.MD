# Enveloppe Épargne — Instructions

## Contexte

Une enveloppe de type **épargne** représente un compte à capital garanti et rémunéré (ex : Livret A, LDDS, LEP, fonds euros d'une assurance-vie). Elle contient des **positions** correspondant chacune à un compte ou support d'épargne distinct.

Dans le cadre du **3-fund portfolio**, toute l'épargne contribue à la poche **Cash**.

---

## Structure d'une position

### Champs saisis à l'ajout et mis à jour manuellement

| Champ | Type | Description |
|---|---|---|
| `Nom` | string | Nom du compte (ex : "Livret A BNP", "Fonds Euro Linxea Spirit") |
| `Montant actuel` | number | Solde actuel du compte (en €) — mis à jour manuellement |
| `Taux` | number | Taux de rendement annuel brut (en %) |

> La valeur actuelle n'est pas calculée automatiquement — c'est l'utilisateur qui la met à jour quand il le souhaite (ex : après réception d'un relevé).

### Pas de résolution externe

Contrairement à la bourse, les positions épargne ne dépendent d'aucune API externe. Toutes les données sont saisies et maintenues manuellement.

---

## Données calculées

| Donnée | Formule |
|---|---|
| Rendement annuel estimé (€) | `montant actuel × taux / 100` |
| Rendement mensuel estimé (€) | `rendement annuel / 12` |

---

## Agrégation au niveau de l'enveloppe

| Donnée | Description |
|---|---|
| Montant total | Somme des montants actuels de toutes les positions |
| Rendement annuel estimé | Somme des rendements annuels de chaque position |
| Taux moyen pondéré | Moyenne des taux pondérée par les montants |

---

## Contribution au 3-fund portfolio

Toutes les positions épargne contribuent à la poche **Cash** du 3-fund portfolio, sans distinction entre livrets et fonds euros.

Voir [Vue 3-fund portfolio](../GENERAL.MD#3-fund-portfolio) pour la définition complète des poches.

---

## Flux d'ajout d'une position

1. L'utilisateur saisit le **nom**, le **montant actuel** et le **taux**.
2. La position est créée immédiatement — aucune résolution externe.
3. L'utilisateur met à jour le **montant actuel** ponctuellement (ex : après un versement ou un relevé d'intérêts).

---

## Voir aussi

- [Structure globale du projet](../GENERAL.MD)
- [Architecture technique](../TECHNICAL.MD)
- [Enveloppe Bourse](../bourse/INSTRUCTIONS.MD)
