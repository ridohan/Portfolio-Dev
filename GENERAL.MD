# Portfolio Manager — Instructions générales

## Vue d'ensemble

Le projet est un **gestionnaire de portfolio personnel** permettant de suivre l'ensemble de ses investissements, organisés hiérarchiquement en portfolios, sous-portfolios et enveloppes.

---

## Hiérarchie

```
Portfolio
└── Sous-portfolio (optionnel)
    └── Enveloppe
        └── Positions / Actifs
```

### Portfolio

Un portfolio est le niveau racine. Il regroupe l'ensemble des investissements d'un profil ou d'un objectif donné (ex : "Patrimoine perso", "Retraite", "Projet immobilier").

- Un portfolio a un **nom**.
- Un portfolio peut contenir directement des **enveloppes** ou être structuré en **sous-portfolios**.

### Sous-portfolio

Un sous-portfolio permet de regrouper des enveloppes au sein d'un portfolio (ex : "Investissements long terme", "Épargne de précaution").

- Un sous-portfolio a un **nom**.
- Un sous-portfolio appartient à un seul portfolio parent.
- Un sous-portfolio contient une ou plusieurs **enveloppes**.

### Enveloppe

L'enveloppe représente un compte ou support d'investissement réel (ex : PEA, CTO, Livret A, Compte Binance).

- Une enveloppe a un **nom**.
- Une enveloppe est d'un **seul type** parmi :
  - `bourse` — actions, ETF, obligations cotées
  - `crypto` — cryptomonnaies
  - `épargne` — livrets, fonds euros, dépôts à terme
- Le type d'une enveloppe ne peut pas être mixte.
- Une enveloppe appartient à un sous-portfolio ou directement à un portfolio.

---

## Données agrégées

À chaque niveau de la hiérarchie, les données des niveaux inférieurs sont **agrégées et remontées** :

| Niveau | Ce qui est visible |
|---|---|
| Enveloppe | Valeur totale, performance, détail des positions |
| Sous-portfolio | Somme des enveloppes, répartition par type |
| Portfolio | Vision consolidée de tous les sous-portfolios et enveloppes |

---

## Types d'enveloppes — documentation détaillée

Chaque type d'enveloppe a ses propres règles de gestion, documentées dans les dossiers dédiés :

- [Bourse](./bourse/INSTRUCTIONS.MD) — gestion de positions ETF/actions/obligations
- [Épargne](./epargne/INSTRUCTIONS.MD) — comptes rémunérés, livrets, fonds euros
- [Crypto](./crypto/INSTRUCTIONS.MD) — cryptomonnaies, prix via API CoinGecko

---

## 3-fund portfolio

La vision transversale du portfolio repose sur le principe du **3-fund portfolio** : répartir ses investissements en trois poches distinctes.

| Poche | Source dans l'app |
|---|---|
| **Actions** | Positions de type `action` dans les enveloppes bourse + toutes les positions des enveloppes crypto |
| **Obligations** | Positions de type `obligation` dans les enveloppes bourse |
| **Cash** | Toutes les positions des enveloppes épargne |

À chaque niveau (enveloppe, sous-portfolio, portfolio), l'app affiche la **répartition Actions / Obligations / Cash** en pourcentage de la valeur totale.

L'objectif est de permettre à l'utilisateur de piloter son allocation cible (ex : 70% actions / 20% obligations / 10% cash) et de visualiser l'écart avec son allocation réelle.

### Allocation cible

Chaque portfolio possède une **allocation cible** définie en pourcentage sur les trois poches. La somme doit toujours être égale à 100%.

| Champ | Exemple |
|---|---|
| `cible_actions` | 70% |
| `cible_obligations` | 20% |
| `cible_cash` | 10% |

Une **vue globale** agrège tous les portfolios et compare l'allocation réelle consolidée à une cible globale calculée (moyenne pondérée des cibles par valeur de portfolio).

### Suggestions de rééquilibrage

Quand l'allocation réelle s'écarte de la cible, l'app calcule et affiche les **mouvements à effectuer** pour revenir à l'équilibre. Le rééquilibrage se fait par **arbitrage** : vendre les poches sur-pondérées pour réinvestir dans les poches sous-pondérées.

**Logique de calcul :**

```
Valeur totale          = V
Montant cible poche X  = V × cible_X / 100
Montant actuel poche X = A
Écart poche X          = montant cible − montant actuel
  → positif : sous-pondéré → acheter / investir
  → négatif : sur-pondéré  → vendre / alléger
```

**Deux scénarios couverts :**

1. **Rééquilibrage pur (sans nouveau capital)**
   L'app suggère de vendre les poches sur-pondérées et de réinvestir le produit dans les poches sous-pondérées. Cas typique : des PV latentes fortes sur les actions ont déformé l'allocation.

2. **Rééquilibrage avec nouvel investissement**
   L'utilisateur indique un montant à investir. L'app alloue ce capital en priorité vers les poches sous-pondérées. Si l'écart est trop important pour être absorbé par le seul nouvel investissement, elle suggère en complément des ventes sur les poches sur-pondérées.

**Exemple de suggestions affichées :**

> - Vendre **−2 400 €** d'actions *(sur-pondéré de 3,1% — via votre CTO)*
> - Acheter **+2 400 €** d'obligations *(sous-pondéré de 3,1% — via votre PEA)*
> - Poche cash à l'équilibre

Les suggestions précisent **dans quelle enveloppe agir** en ciblant, pour chaque poche, l'enveloppe du bon type avec le plus grand écart. Pour les ventes, l'app peut également indiquer **quelle position vendre en priorité** en ciblant celles avec la PV latente la plus forte.

---

## Principes généraux

- La structure hiérarchie est **flexible** : un portfolio peut n'avoir aucun sous-portfolio et contenir directement des enveloppes.
- Les noms à tous les niveaux sont **libres** (pas de liste prédéfinie).
- Chaque niveau doit pouvoir afficher sa **valeur totale**, sa **performance globale** et sa **répartition 3-fund**.
