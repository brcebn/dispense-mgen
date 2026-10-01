#!/bin/zsh
# Dispense MGEN — installation 100 % native macOS (aucune dépendance à installer).
#
#   zsh install.command             un raccourci perso par fichier donnees/*.json,
#                                   après un test réel du moteur (PDF dans sorties/)
#   zsh install.command --partage   partage/ : raccourci vierge (repères ⟨…⟩ à remplacer)
#                                   + formulaire + mode d'emploi, à envoyer tel quel
emulate -L zsh
set -e

RACINE=${0:A:h}
cd "$RACINE"
TMP=$(mktemp -d)

ok()   { print -P "%F{green}✔%f $1" }
info() { print -P "%F{yellow}➜%f $1" }
err()  { print -P "%F{red}✘%f $1" >&2 }

# plist XML → raccourci signé. $1 = mode de signature, $2 = sortie, reste = options du générateur
fabriquer() {
  local mode=$1 sortie=$2; shift 2
  local nom
  nom=$(osascript -l JavaScript outils/raccourci.js --racine "$RACINE" --sortie "$TMP/r.plist" "$@")
  plutil -convert binary1 -o "$TMP/r.wflow" "$TMP/r.plist"
  if ! shortcuts sign --mode "$mode" -i "$TMP/r.wflow" -o "$sortie/$nom.shortcut" 2>"$TMP/sign.log"; then
    err "Signature impossible ($mode) : $(<"$TMP/sign.log")"
    [[ $mode == anyone ]] && err "La signature « tout le monde » exige d'être connecté à iCloud."
    return 1
  fi
  print -r -- "$sortie/$nom.shortcut"
}

[[ -f modele/attestation_honneur_dispense.pdf ]] || {
  err "Formulaire vierge absent : place-le dans modele/attestation_honneur_dispense.pdf (voir README)"
  exit 1
}

if [[ $1 == --partage ]]; then
  mkdir -p partage
  fichier=$(fabriquer anyone partage --partage)
  cp modele/attestation_honneur_dispense.pdf partage/
  cp outils/LISEZMOI-partage.txt partage/LISEZMOI.txt
  ok "Prêt à partager : ${fichier:t}, attestation_honneur_dispense.pdf, LISEZMOI.txt"
  open -R "$fichier"
  exit 0
fi

donnees=(donnees/*.json(N))
(( ${#donnees} )) || { err "Aucun fichier donnees/*.json — copie donnees/exemple.json.dist"; exit 1 }

for f in $donnees; do
  info "Test du moteur avec ${f:t}…"
  if sortie=$(osascript -l JavaScript remplir_dispense.js "$f" --decalage 1 --flatten --sans-notif 2>&1); then
    ok "$sortie"
  else
    err "$sortie"
    exit 1
  fi
  fichier=$(fabriquer people-who-know-me "$TMP" --donnees "$f" 2>/dev/null) \
    || fichier=$(fabriquer anyone "$TMP" --donnees "$f")
  open "$fichier"
  ok "Raccourci « ${${fichier:t}%.shortcut} » ouvert dans Raccourcis"
done

print
print -P "%BDans Raccourcis :%b"
print "  1. « Ajouter le raccourci » (les données sont dans les actions Texte, modifiables)."
print "     Supprime d'abord l'éventuelle version précédente du même nom."
print "  2. Automatisation › + › Heure de la journée › 10:00 › Annuel, 1er septembre"
print "     › ce raccourci › Exécuter immédiatement, sans « Notifier lors de l'exécution »."
print "  (Si demandé : Raccourcis › Réglages › Avancé › Autoriser l'exécution de scripts.)"
