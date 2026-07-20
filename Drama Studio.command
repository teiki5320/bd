#!/bin/bash
# ──────────────────────────────────────────────
#  🎬 Drama Studio — double-clique pour lancer
# ──────────────────────────────────────────────
DIR="$HOME/bd"

if [ ! -d "$DIR" ]; then
  echo "❌ Dossier $DIR introuvable. Modifie la ligne DIR= dans ce fichier si le projet est ailleurs."
  read -r -p "Appuie sur Entrée pour fermer…"
  exit 1
fi

cd "$DIR" || exit 1

echo "🔄 Mise à jour de Drama Studio…"
git pull --ff-only 2>/dev/null || echo "   (mise à jour ignorée)"
npm install --no-audit --no-fund >/dev/null 2>&1 || true

# Libère le port si un ancien serveur tourne encore
lsof -ti tcp:4600 | xargs kill 2>/dev/null

# Ouvre le navigateur dès que le serveur répond
(
  until curl -s -o /dev/null http://localhost:4600/api/health; do sleep 1; done
  open "http://localhost:4600"
) &

echo ""
echo "🎬 Lancement… laisse cette fenêtre ouverte pendant que tu utilises le studio."
echo "   (pour arrêter : ferme cette fenêtre, ou Ctrl+C)"
echo ""
npm start
