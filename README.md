# 🎬 Drama Studio

Studio local de **micro-dramas africains** au format vertical : un clic, et l'application écrit
une série en 10 épisodes de 60 secondes (via **Claude**, avec ton abonnement — pas de clé API),
génère les **images** de chaque scène, les **voix** des personnages, puis monte l'épisode en
vidéo avec **Remotion**. Tu visionnes, tu retouches, tu valides — et tu produis l'épisode suivant.

## Prérequis (sur ton Mac)

1. **Node.js 20 ou plus** — https://nodejs.org
2. **Claude Code**, connecté à ton compte Claude (abonnement Pro/Max) :
   ```bash
   npm install -g @anthropic-ai/claude-code
   claude          # puis /login pour te connecter
   ```
3. C'est tout. La génération d'images utilise par défaut **Pollinations.ai** (gratuit, sans clé).

## Lancer le studio

```bash
npm install        # la première fois
npm start          # construit l'interface et lance le serveur
```

Puis ouvre **http://localhost:4600** dans ton navigateur.

> Pour développer avec rechargement à chaud : `npm run dev` puis http://localhost:5173.

## Utilisation

1. **Choisis 1 à 3 styles** (Argent, Héritage, Romance, Trahison, Mystique…) et, si tu veux,
   une idée de départ. Clique **« Créer mon drama »**.
2. L'app enchaîne : scénario complet (Claude) → images de l'épisode 1 → voix de chaque réplique.
   Compte 3 à 6 minutes.
3. **Visionne l'épisode 1** instantanément dans le lecteur intégré. Pour chaque scène tu peux :
   - modifier les répliques (puis « Régénérer la voix »),
   - modifier le prompt et **régénérer l'image**, ou importer la tienne,
   - copier le prompt pour générer l'image sur **OpenArt** et la déposer ici.
4. Quand c'est bon : **« Valider et produire le MP4 »** — le rendu se fait sur ta machine
   (le fichier arrive dans `projects/<id>/renders/`).
5. **« Produire l'épisode suivant »** relance le pipeline pour l'épisode 2, et ainsi de suite
   jusqu'au 10ᵉ.

Ajoute une **musique de fond** (MP3 libre de droits) via le bouton 🎵 en haut du projet —
elle sera mixée en boucle, à bas volume, dans tous les épisodes.

## Fournisseur d'images

Copie `.env.example` vers `.env` pour configurer :

| `IMAGE_PROVIDER` | Description |
|---|---|
| `pollinations` *(défaut)* | Gratuit, sans compte. Qualité correcte, idéal pour itérer. |
| `fal` | fal.ai (modèle FLUX) — meilleure qualité, nécessite `FAL_KEY` (payant au volume). |
| `manual` | Aucune génération automatique : copie le prompt de chaque scène dans **OpenArt** (openart.ai), puis importe l'image dans la scène. |

> **Pourquoi pas l'API OpenArt ?** OpenArt n'offre pas d'API publique à ce jour — son centre
> d'aide le confirme. Le mode `manual` permet quand même d'utiliser ton compte OpenArt,
> et le bouton « Copier le prompt » est là pour ça.

## Notes techniques

- **Claude** est appelé en mode headless (`claude -p`) : la génération de scénario passe par
  ton abonnement, dans les limites d'usage de ton forfait.
- **Voix** : synthèse Edge TTS (gratuite), voix françaises distinctes par personnage.
- **Rendu vidéo** : Remotion (`@remotion/renderer`), H.264 1080×1920, 30 i/s. Le premier rendu
  télécharge un navigateur headless (~150 Mo), les suivants sont directs.
- **Stockage** : tout est sur ton disque, dans `projects/` (un dossier par drama).
- Les épisodes durent ~60 s : la durée exacte s'adapte automatiquement aux voix générées.

## Structure du code

```
server/          Serveur Express : pipeline (Claude → images → voix), rendu Remotion, API
src/             Interface React (Vite)
src/remotion/    Composition vidéo partagée entre l'aperçu (Player) et le rendu final
shared/          Catalogue des styles (source unique front + serveur)
projects/        Tes dramas (créé automatiquement, non versionné)
```
