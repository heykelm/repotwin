# Mesure locale des réponses MCP complètes

Date : 28 octobre 2026. Cette mesure exécute le serveur MCP RepoTwin en mémoire avec de vrais processus locaux (`node --test` et `tsc`). Aucun fournisseur d'IA n'est appelé.

## Reproduction

Depuis la racine du dépôt, avec Node ≥ 22 et les dépendances déjà installées :

```sh
node --import tsx scripts/context-benchmark.mjs
```

Le script crée six dépôts temporaires, exécute `repotwin_create_twin`, puis appelle deux fois `repotwin_run_checks` par cas : `compactOutput: true` et `false`. Les commandes sont donc réellement rejouées. Pour isoler l'effet du formatage sur **la même sortie de commande**, il reconstruit aussi le corps non compact à partir de la réponse compacte observée selon le mapping actuel de `src/mcp/server.ts`. L'appel non compact indépendant vérifie la forme réelle de ce corps. Les sorties des commandes rejouées ont souvent des durées internes et des chemins temporaires différents ; on ne les confond pas avec la paire appariée.

Les données structurées sont dans [context-benchmark.json](./context-benchmark.json). Une paire de réponses MCP complètes appariées pour l'assertion est conservée dans [assertion-compact-mcp.json](./assertion-compact-mcp.json) et [assertion-raw-matched-mcp.json](./assertion-raw-matched-mcp.json). Le drapeau `--preserve-pair` régénère les mesures sans écraser cette paire. Le JSON contient le commit `HEAD` et les empreintes SHA-256 des deux sources modifiées non committées (`server.ts`, `compact-sieve.ts`).

## Taille des réponses complètes, même sortie capturée

| Cas | Statut | Non compact (octets UTF-8) | Compact (octets UTF-8) | Delta compact | Delta estimé, caractères/4 |
| --- | --- | ---: | ---: | ---: | ---: |
| Réussite, 2 tests | réussi | 666 | 665 | −1 | 0 |
| Assertion simple | échec | 2 685 | 2 972 | +287 | +71 |
| Diff multilignes | échec | 2 869 | 3 087 | +218 | +54 |
| Trois erreurs | échec | 4 975 | 5 288 | +313 | +78 |
| Gros logs, capture tronquée | échec | 66 950 | 68 488 | +1 538 | +384 |
| Deux erreurs TypeScript | échec | 1 054 | 2 027 | +973 | +243 |

Sur ces six cas, le compact représente **82 527 octets**, contre **79 199 octets** en non compact : **+3 328 octets (+4,2 %)**. Il s'agit d'un jeu de cas choisi pour tester les limites, pas d'une distribution représentative des usages. Les valeurs de tokens sont uniquement `ceil(nombre de caractères JavaScript / 4)` ; aucun tokenizer de fournisseur ni comptage facturé n'a été utilisé. Les octets UTF-8 et les caractères sont relevés séparément.

## Diagnostics et limites observés

- Dans les échecs, le mode compact renvoie `errorOutput` résumé **et** `rawOutput` complet. Les sentinelles des cas assertion, diff multilignes, erreurs multiples et TypeScript sont présentes dans la réponse complète. Le résumé seul omet plusieurs détails de `node --test` : par exemple le nom du test et la valeur réelle `401` de l'assertion `401 !== 200`. Pour trois échecs, il ne donne qu'un seul objet `extractedFailures`.
- Le cas gros logs dépasse la limite de capture de `runValidationCommand` (64 Kio). La sortie sauvegardée est de 65 535 octets après `trim()` et `outputTruncated` vaut `true`. Le nom du test `large log sentinel` et les marqueurs d'assertion `LARGE_ACTUAL` / `LARGE_EXPECTED`, émis après le bruit, sont absents **des deux modes**. Le compact ne peut pas conserver ce que le runner n'a pas capturé.
- Pour les commandes réussies, les deux modes ne retournent pas de sortie de commande, seulement la liste `passedCommands`. Leur taille est presque identique.
- Les durées de commandes compactes et non compactes enregistrées sont celles de deux exécutions séparées ; leurs écarts ne mesurent pas le temps du parseur. Ce banc ne mesure ni usage fournisseur, ni coût, ni économie de forfait. La réponse compacte peut consommer davantage de contexte parce qu'elle ajoute le résumé et les échecs extraits au diagnostic brut.
