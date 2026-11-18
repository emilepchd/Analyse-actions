# Analyse Actions

Application locale d'analyse d'actions : tu tapes le nom ou le symbole d'une action et l'application récupère toutes les données publiques disponibles (Yahoo Finance, graphique TradingView, et en option Financial Modeling Prep) puis calcule les indicateurs.

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
| Analyse technique | **graphique TradingView** interactif (widget gratuit, cours différés) avec indicateurs au choix : moyennes mobiles 50/200 j, Bollinger, RSI, MACD, stochastique, Ichimoku ; **signaux techniques calculés** par l'application (position vs moyennes mobiles 20/50/100/200 j, croisement doré ou de la mort, RSI, MACD, momentum, Bollinger, verdict de Vente forte à Achat fort, performances 1 mois à 1 an) |
| Score /100 | 5 axes notés sur 5 (croissance, valorisation, qualité, rentes, risque), radar, pondération selon un profil (croissance, équilibré, rendement, value, défensif) |
| Perspectives | objectif moyen/bas/haut des analystes et potentiel, consensus, cours estimé à 5 ans et espérance de rendement annuel, valeur DCF, mes cibles 1 an et 5 ans |
| Actionnariat | initiés, institutionnels, principaux détenteurs |
| Analystes | répartition Achat/Conserver/Vente, historique des prix cibles par banque sur le graphique, tableau des relèvements/abaissements |
| Résultats & estimations | chiffre d'affaires et bénéfice net + estimations, BPA publié vs récurrent (hors exceptionnels), surprises aux publications, révisions du consensus |
| Marges, rentabilité, dette | marges brute/opérationnelle/nette/FCF, ROE, ROIC, dette nette, dette nette/EBITDA, couverture des intérêts, cash-flow, rachats d'actions |
| Valorisation | historique du PE (ajusté, forward, publié) et **DCF interactif** (curseurs) |
| Risque | drawdowns historiques, volatilités, bêta, fourchette probable à 6 mois |
| Dividendes, initiés, actualités, description | |
| Données complémentaires (option FMP) | pour les grandes actions américaines couvertes par l'offre gratuite de Financial Modeling Prep : chiffre d'affaires **par division et par région**, estimations sur plusieurs années, historique des relèvements/abaissements, scores Altman Z et Piotroski F, note et DCF de FMP |
| Ma note d'analyse | avis personnel, cibles 1 an / 5 ans, note de moat (intégrée au score qualité) |

Autres pages : **Accueil** (indices, matières premières, taux, devises), **Suivi** (liste de suivi triable), **Recherche & classement** (CAC 40, grandes valeurs européennes, géants US ou liste perso, filtre PEA, tri par solde/qualité/croissance/risque/dividende), **Portefeuille** (saisie ou import CSV `symbole;quantité;PRU`, répartition, risque, croissance et potentiel pondérés, dividendes attendus), **Calendrier** (publications et détachements à venir), **Réglages** (clé Financial Modeling Prep, affichage et indicateurs du graphique TradingView).

Tes listes, notes et portefeuille sont enregistrés dans ton navigateur (localStorage). Tu peux aussi lister des symboles dans **`suivi.txt`** (un par ligne) : ils sont ajoutés automatiquement à la page Suivi au lancement suivant.

## Financial Modeling Prep (optionnel, gratuit)

L'application fonctionne sans. Avec une clé gratuite, elle ajoute des données sur les grandes actions américaines.

1. Crée un compte gratuit sur https://site.financialmodelingprep.com/register (aucune carte bancaire ; garde l'offre gratuite « Basic »).
2. Connecte-toi, ouvre ton tableau de bord (« Dashboard ») et copie ta clé (« API Key »).
3. Dans l'application, page **Réglages**, colle la clé puis clique sur « Enregistrer et tester ».

La clé est enregistrée sur ton PC dans `%LOCALAPPDATA%\AnalyseActions\config.json` (hors OneDrive et hors Git). Tu peux aussi la fournir par la variable d'environnement `FMP_API_KEY`.

Ce que permet l'offre gratuite : 250 requêtes par jour, 5 ans d'historique, et seulement une liste fixe d'environ 90 grandes actions américaines (aucune action européenne). L'application ne fait aucune requête pour une action hors États-Unis, mémorise 7 jours les actions américaines non couvertes, garde les réponses en cache 1 à 7 jours et s'arrête à 240 requêtes par jour.

## Symboles

Les symboles sont ceux de Yahoo Finance : `AAPL`, `GOOGL`, `MC.PA` (LVMH), `AI.PA` (Air Liquide), `ASML.AS`, `SAP.DE`… La barre de recherche les trouve à partir du nom.

## Limites

- Données gratuites, retardées et parfois incomplètes, surtout pour les petites valeurs et hors États-Unis (pas d'options donc risque calculé en volatilité historique, peu d'estimations).
- La répartition du chiffre d'affaires par région et par division n'est disponible gratuitement que pour les grandes actions américaines couvertes par FMP.
- Le graphique TradingView gratuit n'affiche pas les actions de la Bourse de Londres : un lien ouvre alors le graphique sur le site de TradingView.
- L'éligibilité PEA est déduite du pays du siège : à vérifier auprès de ton courtier.
- Aucune donnée ne constitue un conseil en investissement.
