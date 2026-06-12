# VPW — Variable Percentage Withdrawal
## Documentation technique pour Portfolio Manager

---

## 1. Concept et philosophie

Le VPW (Variable Percentage Withdrawal) est une méthode de retrait dynamique conçue pour **épuiser le capital à un horizon cible**, contrairement à la règle des 4% qui est conçue pour ne jamais manquer d'argent (et laisse donc souvent un capital résiduel important à la mort).

### Comparaison avec les autres méthodes

| Méthode | Philosophie | Retrait | Alignement "Die with Zero" |
|---|---|---|---|
| SWR 4% fixe | Ne jamais manquer | Fixe, indexé inflation | ❌ Ultra-conservateur |
| VPW | Épuiser le capital | Variable selon performance | ✅✅ |
| Guardrails | Ajustement manuel | Semi-variable | ✅ |
| Floor & Upside | Sécuriser le vital + optimiser le reste | Hybride | ✅ |
| Amortissement pur | Épuiser le capital | Fixe mathématique | ✅✅ |

Le VPW est la méthode la plus cohérente avec une philosophie **Die with Zero** car :
- Le capital tend vers 0 à l'horizon cible
- Les retraits augmentent naturellement avec l'âge
- La méthode s'adapte automatiquement à la performance réelle du portefeuille

---

## 2. La formule de base

Le VPW utilise la **formule de la valeur actuelle d'une annuité** — la même mathématique qu'un prêt immobilier, mais à l'envers.

### Formule

```
Retrait annuel = Portfolio × Facteur VPW

Facteur VPW = r / (1 - (1 + r)^(-n))
```

**Paramètres :**
- `Portfolio` = valeur actuelle du portefeuille liquide
- `r` = rendement annuel attendu net de frais (ex. `0.05` pour 5%)
- `n` = nombre d'années restantes = `âge cible - âge actuel`

### Implémentation JavaScript

```javascript
/**
 * Calcule le facteur VPW et le retrait pour une année donnée
 * @param {number} portfolioValue - Valeur du portefeuille en euros
 * @param {number} currentAge - Âge actuel
 * @param {number} targetAge - Âge cible (horizon d'épuisement du capital)
 * @param {number} expectedReturn - Rendement annuel attendu (ex. 0.05)
 * @returns {object} - { vpwFactor, annualWithdrawal, monthlyWithdrawal, yearsRemaining }
 */
function calculateVPW(portfolioValue, currentAge, targetAge, expectedReturn) {
  const n = targetAge - currentAge;
  const r = expectedReturn;

  if (n <= 0) return { vpwFactor: 1, annualWithdrawal: portfolioValue, monthlyWithdrawal: portfolioValue / 12, yearsRemaining: 0 };

  const vpwFactor = r / (1 - Math.pow(1 + r, -n));
  const annualWithdrawal = portfolioValue * vpwFactor;
  const monthlyWithdrawal = annualWithdrawal / 12;

  return {
    vpwFactor,
    annualWithdrawal,
    monthlyWithdrawal,
    yearsRemaining: n
  };
}
```

### Exemple numérique

- Portfolio : **500 000 €**
- Âge actuel : **45 ans**
- Âge cible : **85 ans** → n = 40
- Rendement attendu : **5%**

```
Facteur VPW = 0.05 / (1 - (1.05)^(-40))
            = 0.05 / (1 - 0.1420)
            = 0.05 / 0.858
            = 0.05828

Retrait annuel = 500 000 × 0.05828 = 29 140 €/an = 2 428 €/mois
```

Avec un rendement de **7%** :
```
Facteur VPW = 0.07 / (1 - (1.07)^(-40)) = 0.07501

Retrait annuel = 500 000 × 0.07501 = 37 505 €/an = 3 125 €/mois
```

---

## 3. Extension : revenus futurs

### Principe

Si des revenus futurs réguliers sont attendus (retraite, loyers libérés de crédit, rente), leur **valeur actuelle (Present Value)** est soustraite du portefeuille avant d'appliquer le facteur VPW.

**Logique :** le portefeuille n'a pas besoin de financer la totalité de la retraite, seulement la partie non couverte par les revenus futurs. Soustraire leur PV aujourd'hui réduit le retrait actuel (on puise moins maintenant car on sait qu'on recevra plus tard).

### Formule — Valeur actuelle d'un revenu futur

```
PV = RevenuAnnuel × [(1 - (1+r)^(-(nFin - nDebut))) / r] × (1+r)^(-nDebut)
```

**Paramètres :**
- `RevenuAnnuel` = montant annuel du revenu futur (en euros)
- `nDebut` = dans combien d'années le revenu commence = `âgeDebut - âgeActuel`
- `nFin` = dans combien d'années le revenu s'arrête = `âgeCible - âgeActuel`
- `r` = rendement attendu

### Formule VPW complète avec revenus futurs

```
Retrait = (Portfolio - Σ PV(revenus futurs)) × Facteur VPW
```

### Implémentation JavaScript

```javascript
/**
 * Calcule la valeur actuelle d'un flux de revenus futurs
 * @param {number} annualAmount - Montant annuel du revenu (en euros)
 * @param {number} startAge - Âge de début du revenu
 * @param {number} endAge - Âge de fin du revenu (= âge cible en général)
 * @param {number} currentAge - Âge actuel
 * @param {number} discountRate - Taux d'actualisation (= rendement attendu)
 * @returns {number} - Valeur actuelle du flux en euros
 */
function presentValueOfFutureIncome(annualAmount, startAge, endAge, currentAge, discountRate) {
  const r = discountRate;
  const nDebut = startAge - currentAge;
  const nFin = endAge - currentAge;
  const duration = nFin - nDebut;

  if (duration <= 0 || nDebut < 0) return 0;

  // Valeur actuelle de l'annuité au moment où elle commence
  const pvAtStart = annualAmount * (1 - Math.pow(1 + r, -duration)) / r;

  // Actualisation jusqu'à aujourd'hui
  const pv = pvAtStart * Math.pow(1 + r, -nDebut);

  return pv;
}

/**
 * Calcule le retrait VPW en tenant compte des revenus futurs
 * @param {number} portfolioValue - Valeur du portefeuille
 * @param {number} currentAge - Âge actuel
 * @param {number} targetAge - Âge cible
 * @param {number} expectedReturn - Rendement attendu
 * @param {Array} futureIncomes - Tableau de revenus futurs (voir structure ci-dessous)
 * @returns {object} - Résultat complet du calcul
 */
function calculateVPWWithFutureIncomes(portfolioValue, currentAge, targetAge, expectedReturn, futureIncomes = []) {
  const r = expectedReturn;
  const n = targetAge - currentAge;

  // Calcul de la PV totale des revenus futurs
  const totalPV = futureIncomes.reduce((sum, income) => {
    return sum + presentValueOfFutureIncome(
      income.annualAmount,
      income.startAge,
      income.endAge || targetAge,
      currentAge,
      r
    );
  }, 0);

  // Portefeuille ajusté
  const adjustedPortfolio = Math.max(0, portfolioValue - totalPV);

  // Facteur VPW
  const vpwFactor = r / (1 - Math.pow(1 + r, -n));

  // Retrait calculé sur le portefeuille ajusté
  const annualWithdrawal = adjustedPortfolio * vpwFactor;
  const monthlyWithdrawal = annualWithdrawal / 12;

  return {
    portfolioValue,
    totalFutureIncomesPV: totalPV,
    adjustedPortfolio,
    vpwFactor,
    annualWithdrawal,
    monthlyWithdrawal,
    yearsRemaining: n
  };
}
```

### Structure d'un revenu futur

```javascript
// Exemple de tableau de revenus futurs
const futureIncomes = [
  {
    label: "Retraite française",
    annualAmount: 12000,    // 1 000 €/mois
    startAge: 65,
    endAge: 85,             // = targetAge par défaut
    growthRate: 0.02        // indexation future (optionnel, pour affichage)
  },
  {
    label: "Loyers libérés (immobilier locatif)",
    annualAmount: 12000,    // ~1 000 €/mois nets une fois crédits éteints
    startAge: 70,           // à adapter selon fin des crédits
    endAge: 85
  }
];
```

### Exemple numérique complet

Avec un portefeuille de 500 000 € et des revenus futurs hypothétiques :

| Revenu | Montant/an | Début | PV aujourd'hui |
|---|---|---|---|
| Retraite | 10 000 € | 65 ans | ~24 000 € |
| Loyers libérés | 12 000 € | 70 ans | ~21 000 € |
| **Total PV** | | | **~45 000 €** |

```
Portfolio ajusté = 500 000 - 45 000 = 455 000 €
Retrait VPW (5%, 40 ans) = 455 000 × 0.05828 = 26 517 €/an = 2 210 €/mois
```

Le retrait actuel est réduit car une partie des besoins futurs sera couverte par d'autres sources.

---

## 4. Projection year-by-year

### Principe

Chaque année, le calcul est relancé avec :
1. La valeur réelle du portefeuille (après performance et retrait de l'année précédente)
2. L'âge mis à jour (n diminue d'un an)
3. Les revenus futurs recalculés avec le nouvel âge

### Implémentation JavaScript

```javascript
/**
 * Projette le portefeuille année par année en mode VPW
 * @param {number} initialPortfolio - Valeur initiale du portefeuille
 * @param {number} currentAge - Âge actuel
 * @param {number} targetAge - Âge cible
 * @param {number} expectedReturn - Rendement annuel attendu
 * @param {Array} futureIncomes - Revenus futurs
 * @param {object} options - Options : floorAmount, ceilingAmount
 * @returns {Array} - Tableau de projections par année
 */
function projectVPW(initialPortfolio, currentAge, targetAge, expectedReturn, futureIncomes = [], options = {}) {
  const { floorAmount = 0, ceilingAmount = Infinity } = options;
  const rows = [];
  let portfolio = initialPortfolio;

  for (let age = currentAge; age < targetAge; age++) {
    const n = targetAge - age;

    // Recalcul des PV des revenus futurs avec l'âge actuel
    const totalPV = futureIncomes.reduce((sum, income) => {
      if (income.startAge <= age) return sum; // Revenu déjà en cours, pas à actualiser
      return sum + presentValueOfFutureIncome(income.annualAmount, income.startAge, income.endAge || targetAge, age, expectedReturn);
    }, 0);

    const adjustedPortfolio = Math.max(0, portfolio - totalPV);
    const vpwFactor = expectedReturn / (1 - Math.pow(1 + expectedReturn, -n));

    // Retrait avec plancher et plafond optionnels
    let withdrawal = adjustedPortfolio * vpwFactor;
    withdrawal = Math.max(floorAmount, Math.min(ceilingAmount, withdrawal));
    withdrawal = Math.min(withdrawal, portfolio); // Ne pas retirer plus que ce qu'on a

    // Revenus reçus cette année (si startAge atteint)
    const incomeThisYear = futureIncomes.reduce((sum, income) => {
      if (age >= income.startAge && age < (income.endAge || targetAge)) {
        return sum + income.annualAmount;
      }
      return sum;
    }, 0);

    const portfolioAfterWithdrawal = portfolio - withdrawal;
    const portfolioNextYear = portfolioAfterWithdrawal * (1 + expectedReturn);

    rows.push({
      age,
      year: new Date().getFullYear() + (age - currentAge),
      portfolio: Math.round(portfolio),
      totalFutureIncomesPV: Math.round(totalPV),
      adjustedPortfolio: Math.round(adjustedPortfolio),
      vpwFactor: vpwFactor,
      withdrawal: Math.round(withdrawal),
      monthlyWithdrawal: Math.round(withdrawal / 12),
      incomeThisYear: Math.round(incomeThisYear),
      totalIncome: Math.round(withdrawal + incomeThisYear),
      portfolioAfterWithdrawal: Math.round(portfolioAfterWithdrawal),
      portfolioNextYear: Math.round(portfolioNextYear)
    });

    portfolio = portfolioNextYear;
  }

  return rows; // portfolio ≈ 0 à targetAge ✅
}
```

---

## 5. Paramètres à exposer dans l'UI

### Paramètres principaux (obligatoires)

| Paramètre | Type | Description | Valeur par défaut suggérée |
|---|---|---|---|
| `portfolioValue` | number | Valeur du portefeuille liquide (hors immo, RP) | Depuis les données du portfolio |
| `currentAge` | number | Âge actuel | À saisir |
| `targetAge` | number | Âge cible d'épuisement du capital | 85 ou 90 |
| `expectedReturn` | number | Rendement annuel attendu net de frais | 0.05 (5%) |

### Paramètres optionnels (avancés)

| Paramètre | Type | Description |
|---|---|---|
| `inflationRate` | number | Taux d'inflation pour afficher les retraits en euros constants |
| `floorAmount` | number | Retrait minimum annuel garanti (couplé au bucket sécurisé) |
| `ceilingAmount` | number | Retrait maximum annuel (pour lisser les très bonnes années) |
| `futureIncomes` | array | Liste des revenus futurs (voir structure ci-dessus) |

### Revenus futurs — champs par entrée

| Champ | Type | Description |
|---|---|---|
| `label` | string | Nom du revenu (ex. "Retraite française") |
| `annualAmount` | number | Montant annuel en euros |
| `startAge` | number | Âge de début |
| `endAge` | number | Âge de fin (défaut = targetAge) |

---

## 6. Outputs à afficher

### Résumé immédiat (cards en haut de page)

- **Retrait mensuel VPW** → ex. `2 428 €/mois`
- **Retrait annuel VPW** → ex. `29 140 €/an`
- **Facteur VPW** → ex. `5.83%`
- **PV revenus futurs soustraite** → ex. `45 000 €`
- **Portfolio ajusté utilisé** → ex. `455 000 €`
- **Ratio retrait / dépenses** → ex. `120%` (marge de sécurité)

### Tableau de projection (année par année)

Colonnes suggérées :
- Année / Âge
- Valeur du portefeuille (début d'année)
- PV revenus futurs
- Portefeuille ajusté
- Retrait VPW annuel / mensuel
- Revenus encaissés cette année (retraite, loyers)
- Total encaissé (retrait + revenus)

### Graphiques

1. **Courbe de décroissance du portefeuille** → doit tendre vers 0 à `targetAge`
2. **Retrait annuel** → fluctue selon la performance, augmente naturellement avec l'âge
3. **Comparaison SWR 4% vs VPW** → montre l'écart de capital résiduel

---

## 7. Cas limites à gérer

```javascript
// Cas 1 : n <= 0 (horizon dépassé)
if (n <= 0) return portfolioValue; // On retire tout

// Cas 2 : PV des revenus > portfolio (ne pas retirer négativement)
const adjustedPortfolio = Math.max(0, portfolioValue - totalPV);

// Cas 3 : Revenu déjà en cours (startAge <= currentAge)
// Ne pas inclure dans la PV, mais l'ajouter dans incomeThisYear

// Cas 4 : Portfolio épuisé avant targetAge (rendement négatif prolongé)
withdrawal = Math.min(withdrawal, portfolio); // Ne jamais retirer plus que disponible
```

---

## 8. Sensibilité aux paramètres clés

Avec portfolio = 500 000 €, âge 45, horizon 85 ans :

| Rendement | Retrait mensuel | Retrait annuel |
|---|---|---|
| 4% | 2 053 €/mois | 24 636 €/an |
| 5% | 2 428 €/mois | 29 140 €/an |
| 6% | 2 842 €/mois | 34 100 €/an |
| 7% | 3 125 €/mois | 37 505 €/an |

Impact de l'horizon cible (rendement 5%) :

| Horizon | Retrait mensuel |
|---|---|
| 75 ans (30 ans) | 2 667 €/mois |
| 80 ans (35 ans) | 2 514 €/mois |
| 85 ans (40 ans) | 2 428 €/mois |
| 90 ans (45 ans) | 2 370 €/mois |
| 95 ans (50 ans) | 2 333 €/mois |

> Plus l'horizon est lointain, plus le retrait actuel est faible — le VPW incite naturellement à consommer davantage en vieillissant.

---

## 9. Intégration dans Portfolio Manager

### Données à récupérer automatiquement depuis le portfolio

```javascript
const vpwInput = {
  // Depuis la synthèse portfolio
  portfolioValue: patrimoine.financier.net, // valeur nette du portefeuille liquide
  
  // À saisir par l'utilisateur (ou stocker en settings)
  currentAge: settings.currentAge,
  targetAge: settings.targetAge,
  expectedReturn: settings.expectedReturn,
  
  // Revenus futurs configurés dans les settings
  futureIncomes: settings.futureIncomes
};
```

### Suggestions d'onglets / sections

1. **Calculateur VPW** → paramètres + résultat immédiat
2. **Projection** → tableau année par année + graphiques
3. **Comparaison** → VPW vs SWR 4% vs Floor & Upside
4. **Sensibilité** → heatmap rendement × horizon → retrait mensuel

---

*Document généré le 12 juin 2026 — Portfolio Manager*
