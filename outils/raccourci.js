// Génère le plist d'un raccourci Apple « Dispense MGEN » autonome et partageable :
//
//   [Commentaire] mode d'emploi
//   [Texte] × 15   une action par champ : c'est là qu'on saisit / modifie les données
//   [Dictionnaire] clé → sortie de chaque action Texte
//   [Texte de]     dictionnaire → JSON
//   [Script shell] moteur remplir_dispense.js embarqué, JSON sur stdin, fenêtre de fin
//
// Pas de questions d'import : elles bouclent à l'ajout sur macOS récent (bug Apple,
// vérifié : un raccourci minimal avec une seule question boucle aussi). La version
// partagée contient à la place des repères ⟨…⟩ que le moteur traite comme vides.
//
// Usage (natif, via install.command) :
//   osascript -l JavaScript outils/raccourci.js --racine DIR --sortie x.plist [--donnees f.json] [--partage]
// Affiche le nom du raccourci sur stdout. Format non documenté par Apple : clés relevées
// dans le compilateur open source Cherri (github.com/electrikmilk/cherri).

'use strict';

// [clé JSON, libellé (nom de la sortie), repère affiché dans la version partagée]
const CHAMPS = [
  ['nom_naissance', 'Nom de naissance', '⟨Nom de naissance⟩'],
  ['nom_usage', "Nom d'usage", "⟨Nom d'usage — facultatif⟩"],
  ['prenom', 'Prénom', '⟨Prénom⟩'],
  ['date_naissance', 'Date de naissance', '⟨Date de naissance JJ/MM/AAAA⟩'],
  ['telephone', 'Téléphone', '⟨Téléphone — facultatif⟩'],
  ['email', 'E-mail', '⟨E-mail — facultatif⟩'],
  ['motif', 'Motif', '⟨Motif 1 à 8 — voir le commentaire⟩'],
  ['date_effet', "Date d'effet", "⟨Date d'effet JJ/MM⟩"],
  ['date_fin', 'Date de fin', '⟨Date de fin de couverture JJ/MM⟩'],
  ['date_signature', 'Date de signature', '⟨Date de signature JJ/MM — facultatif, sinon jour de génération⟩'],
  ['fait_a', 'Fait à', '⟨Ville (Fait à)⟩'],
  ['signature', 'Signature', '⟨Signature : Prénom NOM⟩'],
  ['annee', 'Année', '⟨Année — laisser ainsi pour l\'année prochaine⟩'],
  ['modele', 'Formulaire vierge', '~/Documents/Dispense MGEN/attestation_honneur_dispense.pdf'],
  ['dossier_sortie', 'Dossier de sortie', '~/Documents/Dispense MGEN'],
];

const COMMENTAIRE = [
  'Dispense MGEN — génère l\'attestation sur l\'honneur de dispense d\'affiliation pré-remplie.',
  '',
  'Remplace chaque ⟨repère⟩ des actions Texte ci-dessous par ta valeur (un repère laissé tel quel',
  'compte comme vide). Dates JJ/MM : l\'année est ajoutée automatiquement (année prochaine).',
  'Le formulaire vierge MGEN doit se trouver au chemin indiqué. Une notification signale la fin.',
  '',
  'Motifs : 1 contrat individuel · 2 contrat collectif d\'un autre employeur · 3 ayant droit du',
  'contrat du conjoint/parent · 4 CDD · 5 CSS · 6 CAMIEG · 7 versement santé · 8 militaires.',
  '',
  'Automatisation : Heure de la journée › 10:00 › Annuel, 1er septembre › ce raccourci ›',
  'Exécuter immédiatement. Si demandé : Réglages › Avancé › Autoriser l\'exécution de scripts.',
].join('\n');

const FIN_MOTEUR = '__MOTEUR_JXA__';

// --- plist XML minimal ------------------------------------------------------

const echap = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function plist(v, ind = '') {
  const i2 = `${ind}\t`;
  if (typeof v === 'string') return `${ind}<string>${echap(v)}</string>`;
  if (typeof v === 'boolean') return `${ind}<${v}/>`;
  if (Number.isInteger(v)) return `${ind}<integer>${v}</integer>`;
  if (Array.isArray(v)) return v.length ? `${ind}<array>\n${v.map((x) => plist(x, i2)).join('\n')}\n${ind}</array>` : `${ind}<array/>`;
  const cles = Object.keys(v);
  if (!cles.length) return `${ind}<dict/>`;
  return `${ind}<dict>\n${cles.map((k) => `${i2}<key>${echap(k)}</key>\n${plist(v[k], i2)}`).join('\n')}\n${ind}</dict>`;
}

// --- briques Raccourcis -------------------------------------------------------

let compteur = 0;
const uuid = () => {
  compteur += 1;
  const h = (n, l) => n.toString(16).toUpperCase().padStart(l, '0');
  return `D15BE45E-${h(compteur, 4)}-4000-8000-${h(Date.now() % 0xffffffffffff, 12)}`;
};
const texteSimple = (s) => ({ Value: { string: s }, WFSerializationType: 'WFTextTokenString' });
const sortieAction = (id, nom) => ({ OutputName: nom, OutputUUID: id, Type: 'ActionOutput' });
const texteVariable = (id, nom) => ({
  Value: { attachmentsByRange: { '{0, 1}': sortieAction(id, nom) }, string: '￼' },
  WFSerializationType: 'WFTextTokenString',
});
const piece = (id, nom) => ({ Value: sortieAction(id, nom), WFSerializationType: 'WFTextTokenAttachment' });
const action = (identifiant, parametres) => ({
  WFWorkflowActionIdentifier: `is.workflow.actions.${identifiant}`,
  WFWorkflowActionParameters: parametres,
});

function scriptShell(moteur) {
  if (moteur.includes(FIN_MOTEUR)) throw new Error(`le moteur ne doit pas contenir ${FIN_MOTEUR}`);
  return [
    '# Dispense MGEN — moteur embarqué, généré par outils/raccourci.js (ne pas éditer ici).',
    '# Entrée (stdin) : les champs ci-dessus en JSON.',
    'MOTEUR=$(mktemp "${TMPDIR:-/tmp}/dispense-mgen.XXXXXX") || exit 1',
    'trap \'rm -f "$MOTEUR"\' EXIT',
    `cat > "$MOTEUR" <<'${FIN_MOTEUR}'`,
    moteur.replace(/\n$/, ''),
    FIN_MOTEUR,
    'osascript -l JavaScript "$MOTEUR" - --decalage 1 --flatten --dialogue',
  ].join('\n');
}

// valeurs : contenu des actions Texte ; renvoie { nom, xml }
function construire({ moteur, valeurs = {}, nom = 'Dispense MGEN' }) {
  compteur = 0;
  const actions = [action('comment', { WFCommentActionText: COMMENTAIRE })];
  const items = [];

  CHAMPS.forEach(([cle, libelle]) => {
    const id = uuid();
    const valeur = valeurs[cle] === undefined || valeurs[cle] === null ? '' : String(valeurs[cle]);
    actions.push(action('gettext', { CustomOutputName: libelle, UUID: id, WFTextActionText: valeur }));
    items.push({ WFItemType: 0, WFKey: texteSimple(cle), WFValue: texteVariable(id, libelle) });
  });

  const dico = uuid();
  actions.push(action('dictionary', {
    CustomOutputName: 'Données', UUID: dico,
    WFItems: { Value: { WFDictionaryFieldValueItems: items }, WFSerializationType: 'WFDictionaryFieldValue' },
  }));
  const json = uuid();
  actions.push(action('detect.text', { CustomOutputName: 'JSON', UUID: json, WFInput: piece(dico, 'Données') }));
  actions.push(action('runshellscript', {
    UUID: uuid(), Script: scriptShell(moteur), Shell: '/bin/zsh', InputMode: 'to stdin', Input: piece(json, 'JSON'),
  }));
  return { nom, xml: enveloppe(actions) };
}

function enveloppe(actions) {
  const racine = {
    WFWorkflowActions: actions,
    WFWorkflowClientVersion: '2607.0.2',
    WFWorkflowHasOutputFallback: false,
    WFWorkflowHasShortcutInputVariables: false,
    WFWorkflowIcon: { WFWorkflowIconGlyphNumber: 59446, WFWorkflowIconStartColor: 4282601983 },
    WFWorkflowImportQuestions: [],
    WFWorkflowInputContentItemClasses: [],
    WFWorkflowMinimumClientVersion: 900,
    WFWorkflowMinimumClientVersionString: '900',
    WFWorkflowOutputContentItemClasses: [],
    WFWorkflowTypes: [],
  };
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
    + `<plist version="1.0">\n${plist(racine)}\n</plist>\n`;
}

// Défauts des champs : version perso (données JSON + chemins de ce dossier) ou partage (vierge)
function valeursDefaut({ donnees, partage, racine }) {
  if (partage) return Object.fromEntries(CHAMPS.map(([cle, , repere]) => [cle, repere]));
  const v = Object.assign({}, donnees || {});
  if (v.signature && typeof v.signature === 'object') v.signature = v.signature.texte;
  delete v.annee; // la version planifiée prend toujours l'année prochaine
  v.modele = v.modele || `${racine}/modele/attestation_honneur_dispense.pdf`;
  v.dossier_sortie = v.dossier_sortie || `${racine}/sorties`;
  return v;
}

/* global ObjC, $ */
function run(argv) {
  ObjC.import('Foundation');
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    if (a === '--partage') opts.partage = true;
    else opts[a.replace(/^--/, '')] = String(argv[++i]);
  }
  const lire = (p) => {
    const s = $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null);
    if (s.isNil()) throw new Error(`lecture impossible : ${p}`);
    return ObjC.unwrap(s);
  };
  const ecrire = (xml, chemin) => {
    if (!$(xml).writeToFileAtomicallyEncodingError(chemin, true, $.NSUTF8StringEncoding, null)) {
      throw new Error(`écriture impossible : ${chemin}`);
    }
  };
  const donnees = opts.donnees ? JSON.parse(lire(opts.donnees)) : null;
  const prenom = donnees && donnees.prenom ? ` – ${donnees.prenom}` : '';
  const { nom, xml } = construire({
    moteur: lire(`${opts.racine}/remplir_dispense.js`),
    valeurs: valeursDefaut({ donnees, partage: opts.partage, racine: opts.racine }),
    nom: opts.partage ? 'Dispense MGEN' : `Dispense MGEN${prenom}`,
  });
  ecrire(xml, opts.sortie);
  return nom;
}

if (typeof module !== 'undefined') module.exports = { construire, valeursDefaut, CHAMPS, scriptShell };
