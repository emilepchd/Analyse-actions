# Analyse Actions

Application locale d'analyse d'actions : tu tapes le nom ou le symbole d'une action et l'application récupère toutes les données publiques disponibles (Yahoo Finance) puis calcule les indicateurs.

## Lancer l'application (Windows)

1. Installe Python 3.10 ou plus récent depuis https://www.python.org/downloads/ en cochant **« Add python.exe to PATH »** (une seule fois).
2. Double-clique sur **`lancer.bat`**.
   La première fois, il installe les dépendances (1 à 2 minutes). Ensuite le navigateur s'ouvre sur http://127.0.0.1:8765.
3. Pour arrêter, ferme la fenêtre noire.

Sous macOS / Linux : `./lancer.sh`.

## Ce que contient chaque fiche action

| Section | Contenu |
|---|---|
| Carte d'identité | logo, cours, variation, ticker, ISIN, pays, place de cotation, capitalisation (Mega/Large/Mid/Small cap), secteur, éligibilité PEA probable, prochaine et dernière publication |
| Graphique de cours | 5J à MAX, échelle log, **régression de tendance** (%/an sur 3, 5, 10 ans ou max, écart actuel en % et en σ, bandes ±1σ/±2σ), dividendes réinvestis, prix cibles des analystes, valeur DCF, mes cibles, publications de résultats (battues/manquées), comparaison avec un indice |
| 4 indicateurs clés | **Croissance BPA anticipée** (consensus, + croissance passée sur 10 ans), **Risque estimé à 6 mois** (volatilité implicite des options, modèle Black-Scholes & Merton, sinon volatilité historique), **Valorisation** (PE NTM ajusté vs moyenne 5 ans, décote/surcote, bascule Publié/Ajusté, PEG), **Dividendes** (annuel estimé, rendement, croissance 5 ans, taux de distribution) |
| Score /100 | 5 axes notés sur 5 (croissance, valorisation, qualité, rentes, risque), radar, pondération selon un profil (croissance, équilibré, rendement, value, défensif) |
| Perspectives | objectif moyen/bas/haut des analystes et potentiel, consensus, cours estimé à 5 ans et espérance de rendement annuel, valeur DCF, mes cibles 1 an et 5 ans |
| Actionnariat | initiés, institutionnels, principaux détenteurs |
| Analystes | répartition Achat/Conserver/Vente, historique des prix cibles par banque sur le graphique, tableau des relèvements/abaissements |
| Résultats & estimations | chiffre d'affaires et bénéfice net + estimations, BPA publié vs récurrent (hors exceptionnels), surprises aux publications, révisions du consensus |
| Marges, rentabilité, dette | marges brute/opérationnelle/nette/FCF, ROE, ROIC, dette nette, dette nette/EBITDA, couverture des intérêts, cash-flow, rachats d'actions |
| Valorisation | historique du PE (ajusté, forward, publié) et **DCF interactif** (curseurs) |
| Risque | drawdowns historiques, volatilités, bêta, fourchette probable à 6 mois |
| Dividendes, initiés, actualités, description | |
| Ma note d'analyse | avis personnel, cibles 1 an / 5 ans, note de moat (intégrée au score qualité) |

Autres pages : **Accueil** (indices, matières premières, taux, devises), **Suivi** (liste de suivi triable), **Recherche & classement** (CAC 40, grandes valeurs européennes, géants US ou liste perso, filtre PEA, tri par solde/qualité/croissance/risque/dividende), **Portefeuille** (saisie ou import CSV `symbole;quantité;PRU`, répartition, risque, croissance et potentiel pondérés, dividendes attendus), **Calendrier** (publications et détachements à venir).

Tes listes, notes et portefeuille sont enregistrés dans ton navigateur (localStorage).

## Symboles

Les symboles sont ceux de Yahoo Finance : `AAPL`, `GOOGL`, `MC.PA` (LVMH), `AI.PA` (Air Liquide), `ASML.AS`, `SAP.DE`… La barre de recherche les trouve à partir du nom.

## Limites

- Données gratuites, retardées et parfois incomplètes, surtout pour les petites valeurs et hors États-Unis (pas d'options donc risque calculé en volatilité historique, peu d'estimations).
- La répartition du chiffre d'affaires par région et par division n'est pas fournie par les sources gratuites.
- L'éligibilité PEA est déduite du pays du siège : à vérifier auprès de ton courtier.
- Aucune donnée ne constitue un conseil en investissement.
