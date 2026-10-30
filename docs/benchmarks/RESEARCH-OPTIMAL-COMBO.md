# Two-Tier : hypothèse de réduction du contexte

Date initiale : 29 octobre 2026

Révision : 30 octobre 2026

Auteurs initiaux : Antigravity (DeepMind) & Astra

Statut : simulation historique et mesures locales de charge utile, sans validation de consommation facturée

## Constat architectural

L'ancienne réponse compacte contenait le résumé, les échecs structurés et `rawOutput`. Sa charge utile pouvait donc dépasser celle de la réponse brute. Le mode `lazyLogs` évite cette duplication dans la première réponse MCP et permet de demander le log par pages avec `repotwin_get_log`.

Le log récupérable est conservé en mémoire dans le serveur MCP : au plus 8 Mio par commande, jusqu'à la fin de la session, au nettoyage du candidate twin ou à la réexécution de la commande. La capture directe dans `output` reste limitée à 64 Kio. `retrievableLogTruncated` indique si la limite de récupération a été atteinte. Chaque lecture par lignes est limitée à 200 lignes et 64 Kio ; `nextOffset` permet de parcourir le log. Une ligne plus longue se lit par blocs base64 avec `byteOffset` et `nextByteOffset`, au plus 48 Kio bruts par appel. Le résumé du parseur utilise le log récupérable, de sorte qu'un diagnostic placé après les premiers 64 Kio puisse être vu.

## Ce qui était simulé

`scripts/research-threshold-benchmark.mjs` calcule des scénarios à partir de constantes choisies : enveloppe JSON de 450 octets, extrait de 380 octets, taux de consultation de 25 %, réponse agent de 250 tokens et conversion de 4 octets par token. Il ne lance ni test réel, ni modèle et ne lit aucune facture. Les tableaux de son exécution sont des **estimations conditionnelles** ; « total cumulé facturé » y désigne une somme calculée et ne correspond pas à une mesure fournisseur.

Le seuil précis de 600 octets, les parts 80/20 du schéma initial et les économies de tokens annoncées ne sont pas établis. Le seuil dépend du format de sortie, du parseur, de l'enveloppe MCP, des pages demandées et du comportement de l'agent. L'attribution à Astra ne valide pas ces hypothèses.

## Ce qui a été mesuré localement

Une review locale compare les tailles UTF-8 des textes JSON de deux exécutions distinctes de cinq fixtures. Elle montre un gain de charge utile initiale sur le gros log et un surcoût sur les petites sorties. À cette date, le gros log perdait son diagnostic tardif. Après correction, `scripts/twotier-benchmark.mjs` vérifie explicitement les sentinelles dans le résumé ou les objets structurés et dans toutes les pages du log récupéré, y compris après 64 Kio. Les tailles restent des octets de réponse MCP, pas des tokens de modèle.

La récupération de pages supplémentaires augmente la charge utile totale. Le bénéfice dépend donc du nombre de lectures et du contexte complet de la tâche. Aucun gain de forfait ou seuil général ne découle de ces expériences.

## Prochaine validation

Des premiers essais de tâches complètes donnent des résultats mixtes ; voir [REAL-WORKFLOW-EVALUATION.md](REAL-WORKFLOW-EVALUATION.md). Il faut couvrir plus de tâches et de diagnostics, vérifier indépendamment les corrections, enregistrer tous les appels et les tokens rapportés, puis traiter le cache séparément. Aucun appel IA n'est nécessaire aux benchmarks locaux ci-dessus.
