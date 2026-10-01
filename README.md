# Dispense MGEN — l'attestation de dispense remplie toute seule, chaque année

Tu es agent·e de l'Éducation nationale, couvert·e par une autre mutuelle (celle de ton
conjoint, un contrat individuel…) et tu dois renvoyer chaque année l'**attestation sur
l'honneur de dispense d'affiliation** au contrat collectif MGEN ? Ce projet la pré-remplit
pour toi, automatiquement, via un raccourci macOS.

- **100 % natif macOS** : JavaScript for Automation (`osascript`) + PDFKit. Rien à installer.
- **Un raccourci autonome** : tes informations sont dans le raccourci, une ligne par champ.
- **Automatique** : une automatisation Raccourcis le lance chaque 1er septembre.
- **Partageable** : un fichier `.shortcut` vierge à envoyer à tes collègues.

> Projet indépendant, sans lien avec la MGEN ni avec CNP Assurances. Vérifie toujours le
> PDF généré avant de l'envoyer.

## Prérequis

- macOS 26 (Tahoe) ou plus récent — automatisations Raccourcis sur Mac.
- Le **formulaire vierge** « Attestation sur l'honneur — Demande de dispense d'affiliation »
  (réf. `DISP MEJSESR DIG 042026`), fourni par la MGEN dans le parcours de demande de
  dispense. Il n'est pas inclus dans ce dépôt : place-le dans
  `modele/attestation_honneur_dispense.pdf`. Une autre version du formulaire peut avoir
  des champs différents (`osascript -l JavaScript remplir_dispense.js --motifs` pour tester).

## Démarrage rapide

```sh
git clone … && cd …
cp donnees/exemple.json.dist donnees/moi.json   # puis édite tes informations
# place le formulaire vierge dans modele/attestation_honneur_dispense.pdf
zsh install.command
```

`install.command` génère d'abord un vrai PDF dans `sorties/` (test), puis ouvre le raccourci
« Dispense MGEN – Prénom » : **Ajouter le raccourci**. Ensuite, dans Raccourcis :

1. **Réglages › Avancé** : coche *Autoriser l'exécution de scripts* ;
2. **Automatisation › +** → *Heure de la journée* → 10:00, **Annuel, 1er septembre** →
   ce raccourci → *Exécuter immédiatement*, sans *Notifier lors de l'exécution*.

Le 1er septembre, une fenêtre propose d'**ouvrir le PDF** ou de l'**afficher dans le Finder**.

## Partager avec des collègues

```sh
zsh install.command --partage
```

Produit `partage/` : `Dispense MGEN.shortcut` (signé « tout le monde », iCloud requis),
le formulaire vierge et un `LISEZMOI.txt`. À envoyer tel quel (AirDrop, mail) : la personne
ajoute le raccourci, remplace les repères `⟨…⟩` par ses informations, et c'est tout.

## Comment c'est fait

```
remplir_dispense.js       moteur : JSON → PDF rempli. CLI et raccourci.
outils/raccourci.js       génère le raccourci (moteur embarqué)
install.command           installation perso / préparation du partage
donnees/                  tes données (non versionnées) + exemple.json.dist
modele/                   formulaire vierge (non versionné)
test/                     tests de la logique (node --test test/)
```

Le raccourci enchaîne : un commentaire (mode d'emploi), **une action Texte par champ**, un
Dictionnaire qui les assemble, sa conversion en JSON, et un script shell qui embarque le
moteur et l'exécute (`--decalage 1 --flatten --dialogue`).

Pas de questions d'import : sur macOS récent, l'ajout d'un raccourci qui en contient boucle
indéfiniment (reproduit avec un raccourci minimal à une seule question). La version
partagée contient à la place des repères `⟨…⟩` ; un repère non remplacé compte comme vide
et la fenêtre d'erreur liste les champs obligatoires manquants.

## En ligne de commande

```sh
osascript -l JavaScript remplir_dispense.js donnees/moi.json
osascript -l JavaScript remplir_dispense.js donnees/moi.json --annee 2028 --flatten
osascript -l JavaScript remplir_dispense.js - --decalage 1 < donnees.json
osascript -l JavaScript remplir_dispense.js --motifs
```

Options : `--annee AAAA`, `--decalage N`, `--modele PDF`, `--dossier DIR`, `--flatten`,
`--dialogue`, `--sans-notif`. Par défaut : `modele/` et `sorties/` à côté du script.

## Règles de l'année

Priorité : `--annee` > champ `annee` > année en cours + `--decalage` (le raccourci passe 1).
L'année s'applique à `date_effet`, `date_fin` et `date_signature`, jamais à `date_naissance` :

| Données                                | Année 2027                   |
|----------------------------------------|------------------------------|
| `"01/01"` → `"31/12"`                  | 01/01/2027 → 31/12/2027      |
| `"01/09"` → `"31/08"` (fin < effet)    | 01/09/2027 → 31/08/2028      |
| `"30/09"` → `"30/09"` (fin = effet)    | 30/09/2027 → 30/09/2028      |
| signature `"01/09"`                    | 01/09/2027                   |
| `"2026-09-01"` → `"2027-08-31"`        | 01/09/2027 → 31/08/2028 (écart conservé) |

Sans `date_signature` : date du jour. Un 29/02 devient 28/02 les années non bissextiles.

## Développement

```sh
node --test test/      # logique pure : dates, validation, structure du raccourci
```

La couche macOS (PDFKit, fenêtres) n'est testable que sur un Mac :
`zsh install.command` fait un test réel de bout en bout.

## Limites connues

- Le format des raccourcis n'est pas documenté par Apple (clés relevées dans le compilateur
  open source [Cherri](https://github.com/electrikmilk/cherri)).
- Signature en texte uniquement (pas d'image).
- Un clic sur une notification `osascript` ouvre l'Éditeur de script : d'où la fenêtre de
  fin plutôt qu'une notification dans le raccourci.
