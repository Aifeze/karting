# Kart Club 🏁

Un jeu de karting 3D en vue cockpit, directement dans le navigateur. Direction **Sunset Island** : trois tours, des palmiers et quelques amitiés mises à l’épreuve. Univers et éléments graphiques originaux, sans assets Nintendo.

## Lancer le jeu

Prérequis : **Node.js 22 ou supérieur** (version de développement : 24.19.0).

```sh
npm ci
npm start
```

Ouvrez `http://localhost:3000` dans un navigateur récent avec WebGL activé. `npm run dev` relance automatiquement le serveur lors des modifications. La variable `PORT` permet de changer le port ; le serveur écoute sur `0.0.0.0`.

Pas de compilation, de base de données ou de clé API. Three.js 0.180 est chargé depuis jsDelivr, avec un repli sur la copie locale npm si le CDN ne répond pas. Les polices Barlow Condensed et DM Sans sont incluses localement avec leurs licences OFL.

## Jouer

- **Course rapide** : vous contre trois bots. Fonctionne sans connexion au service Socket.io une fois la page chargée.
- **Créer un salon** : partagez le code de cinq caractères. Vos amis choisissent leur pseudo et utilisent « Code ami ». L’hôte lance la course. Jusqu’à huit humains ; des bots complètent la grille jusqu’à quatre pilotes.
- Un lien `https://votre-site/?room=ABCDE` préremplit le code de salon.
- Trois tours, classement en direct, chronomètre, mini-carte, écran de résultats et revanche en salon.

| Action            | Clavier               | Manette standard    |
| ----------------- | --------------------- | ------------------- |
| Accélérer         | ↑, Z ou W             | RT ou A             |
| Freiner           | ↓ ou S                | LT                  |
| Tourner           | ← / →, Q / D ou A / D | Stick gauche        |
| Déraper           | Maj + direction       | B + stick           |
| Utiliser un objet | Espace                | X                   |
| Pause             | Échap ou P            | Bouton d’interface  |
| Aide / son        | H / M                 | Boutons d’interface |

Des commandes tactiles apparaissent sur les appareils tactiles. Le son est désactivé par défaut ; activez-le avec le bouton en haut à droite ou M. La pause fige le solo. **En multijoueur, les autres pilotes continuent pendant une pause.** Une perte de focus coupe vos commandes. Une déconnexion vous remplace par un bot ; il faut rejoindre un nouveau salon pour rejouer.

La conduite comporte une assistance au suivi du circuit : la direction choisit la trajectoire à l’intérieur du virage. Accélérez, évitez l’herbe et chargez le drift pendant au moins 0,65 seconde. Relâcher Maj libère un mini-turbo ; après 1,8 seconde, les étincelles cyan annoncent un turbo plus long.

### Objets et piste

- **Boîtes mystères** : objet aléatoire, réapparition individuelle après 12 secondes.
- **Turbo** : accélération temporaire, vitesse maximale de 187 km/h sur route.
- **Banane** : piège posé derrière le kart, disparu après une collision ou 28 secondes.
- **Carapace verte** : projectile rapide vers l’avant, dans sa trajectoire.
- **Carapace rouge** : projectile qui suit la trajectoire du prochain adversaire devant lui.
- **Bandes cyan** : accélération au sol ; **huile** : tête-à-queue ; **hors-piste** : limitation de vitesse.

## Multijoueur et architecture

```text
public/
  index.html       Accueil, salon, HUD, aide et résultats
  style.css        Interface responsive et commandes tactiles
  app.js           Entrées, cycle de jeu, UI, client Socket.io
  world.js         Circuit procédural Three.js, karts, cockpit, particules
  shared.js        Circuit et simulation commune client / serveur
  audio.js         Moteur et effets sonores Web Audio
server.js          Serveur Express + Socket.io, salons et simulation à 30 Hz
test/              Tests de simulation, réseau et navigateur
render.yaml        Blueprint Render
```

Le solo exécute la simulation dans le navigateur à pas fixe de 60 Hz. En ligne, le serveur calcule la course à 30 Hz : les clients envoient leurs commandes et reçoivent l’état, le classement et les événements. Les bots utilisent les mêmes règles. Le rendu des karts et de la caméra interpole les états reçus. Les positions, objets et résultats ne sont pas acceptés depuis les clients.

Les salons sont conservés **en mémoire sur une seule instance** et disparaissent à son redémarrage. Pas de comptes ni de persistance des scores. Ne passez pas à plusieurs instances sans ajouter un stockage partagé, une stratégie de simulation par salon et un adaptateur Socket.io. Les entrées sont bornées, les pseudos limités et l’interface insère les noms comme texte.

## Déployer sur Render

1. Commitez ces fichiers et poussez-les dans votre dépôt GitHub.
2. Dans Render, créez un **Blueprint** à partir du dépôt : `render.yaml` déclare le service Node.
3. Ou créez un **Web Service** avec `npm ci --omit=dev` comme Build Command et `npm start` comme Start Command. Health check : `/health`.
4. Utilisez **une seule instance**. `PORT` est fourni automatiquement. Socket.io utilise la même origine, sans URL serveur à configurer.
5. Partagez l’URL HTTPS du service ; les codes de salon fonctionnent entre appareils.

Le plan gratuit peut mettre le service en veille et demander un temps de réveil à la première visite. Le navigateur conserve le mode solo si Socket.io n’est pas disponible. Sur un réseau local, utilisez l’adresse IP de la machine et autorisez le port choisi ; l’accès à la manette et au presse-papiers peut nécessiter HTTPS ou localhost.

## Vérifier

```sh
npm test
npm run test:browser
```

`npm test` vérifie le circuit, la conduite, le drift, les quatre objets, les interactions de piste, une course complète et un vrai salon Socket.io à deux clients. Le test navigateur vérifie l’accueil, l’aide, la conduite, la pause, un salon à deux pages et l’interface mobile. Il vérifie aussi le repli local de Three.js lorsque le CDN est bloqué.

Le test navigateur utilise `/usr/bin/chromium` s’il est disponible. Sinon, exécutez `npx playwright install chromium`, ou définissez `CHROMIUM_PATH` vers votre exécutable. Les captures sont enregistrées dans `test-results/` (ignoré par Git).

## Limites connues

La physique est arcade et assistée, sans moteur de collisions volumétriques. Les projectiles suivent les coordonnées du circuit. Le son est synthétisé, sans fichiers audio. Le multijoueur ne comporte pas encore de reconnexion à une course en cours, de spectateurs ou de matchmaking public. Sur un appareil peu puissant, baissez la résolution de la fenêtre ; la densité de pixels est déjà plafonnée pour limiter le coût du rendu.
