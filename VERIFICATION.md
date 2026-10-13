# Vérification Roma DB

Validation du 13 octobre 2026 sur Windows, TinyJS 0.50.1 et PostgreSQL **18.6**.

- `npm test` : 11 tests réussis (échappement SQL, validation, options de délégation, signatures de fonctions, protection du serveur partagé, panier et génération du CRUD des bases).
- `npm run test:integration` : 11 tests réussis, exclusivement sur la base créée par devdb `roma_db_test`. Catalogues, héritage, PUBLIC, RLS, privilèges par défaut, conflits, rollback, signatures autoritaires, dépendances, identifiants invalides et refus SSL.
- `npm run package` : TypeScript et Vite validés, exécutable TinyJS compilé, runtime Node et licences inclus dans `dist`.
- `npm run test:portable` : backend compilé vérifié dans une fenêtre isolée avec Node absent du PATH. Coffre-fort Windows, clé privée segmentée, conservation des secrets après édition, connexion PostgreSQL, CRUD, preview SQL, application d’un droit, relecture et nettoyage des fixtures.
- Interface contrôlée : recherche, droits hérités, préparation lecture/écriture, aperçu SQL, blocage des mutations en démonstration, sélection d’une ressource et dépôt d’un rôle au clavier. Le frontend React compilé a été ouvert dans la fenêtre native depuis `dist/roma-db.exe`.
- Aucun CREATE DATABASE ou DROP DATABASE manuel, aucun service de base supplémentaire et aucune modification de C:\dev-infra.

## Limites de validation

PostgreSQL 14–17 est pris en charge par des branches de compatibilité mais n’a pas été testé sur des serveurs réels dans cette session. Une connexion SSL réussie avec un serveur distant et des certificats réels reste à vérifier sur votre environnement. Les tests couvrent les erreurs de connexion et de SSL.

Le paquet est portable et non signé. Windows 10/11 avec WebView2 est nécessaire. Le panier reste en mémoire pendant la session ; il n’est pas restauré après fermeture. L’aperçu web contient des données fictives, explicitement signalées.
