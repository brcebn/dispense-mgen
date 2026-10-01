// Dispense MGEN — moteur natif macOS (JavaScript for Automation + PDFKit), sans dépendance.
//
// Pré-remplit l'attestation sur l'honneur « Demande de dispense d'affiliation »
// (MGEN / CNP, réf. DISP MEJSESR DIG 042026) à partir de données JSON.
//
// Usage :
//   osascript -l JavaScript remplir_dispense.js donnees/moi.json
//   osascript -l JavaScript remplir_dispense.js donnees/moi.json --annee 2028 --flatten
//   osascript -l JavaScript remplir_dispense.js - --decalage 1 < donnees.json   # JSON sur stdin (Raccourcis)
//
// Options :
//   --annee AAAA      année de la dispense (prime sur "annee" du JSON)
//   --decalage N      si aucune année n'est fournie : année en cours + N
//   --modele PDF      formulaire vierge (prime sur "modele" du JSON)
//   --dossier DIR     dossier de sortie (prime sur "dossier_sortie" du JSON)
//   --flatten         aplatit le formulaire (plus éditable)
//   --dialogue        fenêtre de fin avec boutons « Ouvrir le PDF » / « Afficher dans le Finder »
//                     (utilisé par le raccourci : un clic sur une notification osascript ouvre
//                     l'Éditeur de script, impossible à rediriger vers le fichier)
//   --sans-notif      ni notification ni fenêtre
//
// Règles d'année (date_effet, date_fin, date_signature — jamais date_naissance) :
//   "JJ/MM"        → complétée avec l'année ; date_fin ≤ date_effet bascule sur l'année suivante ;
//   date complète  → année recalée, écart avec date_effet conservé.
//   Sans date_signature : date du jour.
//
// La logique (validation, dates, nom de fichier) est pure et testée sous Node ;
// seule la fonction run() touche à macOS.

'use strict';

// ---------------------------------------------------------------------------
// Correspondance avec le formulaire
// ---------------------------------------------------------------------------

const CHAMPS_TEXTE = {
  nom_naissance: 'Nom de naissance',
  nom_usage: 'Nom dusage',
  prenom: 'Prénom',
  email: 'Email',
  fait_a: 'Fait à',
  telephone: 'Téléphone',
  signature: 'Signature',
};

// Champs « comb » de 8 cases : JJMMAAAA
const CHAMPS_DATE = {
  date_naissance: 'Date de naissance',
  date_effet: 'Date effet dispense',
  date_signature: 'Le',
};

// Motif => [case à cocher, champ date associé]. Les noms du PDF source sont incohérents
// (undefined, undefined_2…) : correspondance établie d'après la position des widgets.
const MOTIFS = {
  1: ['1 Couvert par un contrat santé individuel à la mise en place du contrat collectif par votre employeur ou à votre date dembauche',
    'Date déchéance annuelle du contrat'],
  2: ['2 Bénéficiaire en tant quassuré dun contrat collectif santé obligatoire souscrit par un autre employeur du secteur privé ou public',
    'fonction publique détat hospitalière ou territoriale'],
  3: ['3 Bénéficiaire en tant quayant droit à titre facultatif ou obligatoire dun contrat collectif santé obligatoire souscrit par lemployeur',
    'du secteur privé ou public de votre conjoint ou de votre parent'],
  4: ['4 En CDD et couvert par un contrat santé individuel Date de fin de CDD', 'undefined'],
  5: ['5 Bénéficiaire de la Complémentaire Santé Solidaire CSS Date de fin de CSS', 'undefined_2'],
  6: ['6 Couvert par le régime complémentaire dAssurance maladie des industries électriques et gazières CAMIEG',
    'Date de fin de couverture'],
  7: ['7 Bénéficiaire en tant quayant droit dun contrat santé individuel financé avec un  versement santé dun employeur',
    'Date de fin de couverture_2'],
  8: ['8 Couvert par un contrat collectif santé pour les militaires Date de fin de couverture', 'undefined_3'],
};

const LIBELLES_MOTIFS = {
  1: "Contrat santé individuel (date d'échéance annuelle)",
  2: "Assuré d'un contrat collectif obligatoire d'un autre employeur (date de fin de couverture)",
  3: 'Ayant droit du contrat collectif du conjoint / parent (date de fin de couverture)',
  4: 'CDD + contrat individuel (date de fin de CDD)',
  5: 'Complémentaire Santé Solidaire (date de fin de CSS)',
  6: 'CAMIEG (date de fin de couverture)',
  7: "Ayant droit d'un contrat individuel avec versement santé (date de fin de couverture)",
  8: 'Contrat collectif militaires (date de fin de couverture)',
};

const OBLIGATOIRES = ['nom_naissance', 'prenom', 'date_naissance', 'date_effet', 'motif', 'date_fin', 'fait_a'];

const LIBELLES = {
  nom_naissance: 'Nom de naissance', prenom: 'Prénom', date_naissance: 'Date de naissance',
  date_effet: "Date d'effet", motif: 'Motif', date_fin: 'Date de fin', fait_a: 'Fait à',
};

// Repère non remplacé de la version partagée du raccourci, ex. « ⟨Prénom⟩ » : compte comme vide.
const REPERE = /^\s*⟨[^⟩]*⟩\s*$/;

// ---------------------------------------------------------------------------
// Dates : objets {a, m, j} (pas de Date JS → aucun piège de fuseau horaire)
// ---------------------------------------------------------------------------

const joursDansMois = (a, m) => new Date(Date.UTC(a, m, 0)).getUTCDate();
const valide = (a, m, j) => m >= 1 && m <= 12 && j >= 1 && j <= joursDansMois(a, m);
const cle = (d) => d.a * 10000 + d.m * 100 + d.j;
const avant = (x, y) => cle(x) < cle(y);
const avecAnnee = (d, a) => ({ a, m: d.m, j: Math.min(d.j, joursDansMois(a, d.m)) }); // 29/02 → 28/02
const plusMois = (d, n) => {
  const t = d.m - 1 + n;
  const a = d.a + Math.floor(t / 12);
  const m = (t % 12) + 1;
  return { a, m, j: Math.min(d.j, joursDansMois(a, m)) };
};
const p2 = (n) => String(n).padStart(2, '0');
const comb = (d) => p2(d.j) + p2(d.m) + d.a; // JJMMAAAA
const fr = (d) => `${p2(d.j)}/${p2(d.m)}/${d.a}`;
const iso = (d) => `${d.a}-${p2(d.m)}-${p2(d.j)}`;

// ---------------------------------------------------------------------------
// Normalisation / validation (pure)
// ---------------------------------------------------------------------------

const vide = (v) => v === undefined || v === null || String(v).trim() === '';

// opts : { annee, decalage, aujourdhui: {a,m,j} } — annee (CLI) > brut.annee > aujourdhui.a + decalage
function normaliser(brutIn, opts = {}) {
  const brut = {};
  Object.entries(brutIn || {}).forEach(([k, x]) => { if (!(typeof x === 'string' && REPERE.test(x))) brut[k] = x; });
  const erreurs = [];
  const avertissements = [];
  const v = {};
  const aujourdhui = opts.aujourdhui;

  // Signature : chaîne, ou { texte } (ancien format JSON)
  if (brut.signature && typeof brut.signature === 'object') brut.signature = brut.signature.texte;

  OBLIGATOIRES.forEach((k) => { if (vide(brut[k])) erreurs.push(`« ${LIBELLES[k]} » est obligatoire`); });

  ['nom_naissance', 'nom_usage', 'prenom', 'email', 'fait_a', 'signature'].forEach((k) => {
    if (!vide(brut[k])) v[k] = String(brut[k]).trim();
  });
  ['nom_naissance', 'nom_usage'].forEach((k) => { if (v[k]) v[k] = v[k].toLocaleUpperCase('fr-FR'); });

  // Année
  let annee = null;
  const sourceAnnee = !vide(opts.annee) ? opts.annee : !vide(brut.annee) ? brut.annee : null;
  if (sourceAnnee !== null) {
    const a = Number(String(sourceAnnee).trim());
    if (Number.isInteger(a) && a >= 2000 && a <= 2100) annee = a;
    else erreurs.push(`annee invalide : ${JSON.stringify(sourceAnnee)} (AAAA attendu)`);
  } else if (!vide(opts.decalage) && aujourdhui) {
    annee = aujourdhui.a + Number(opts.decalage);
  }

  const parse = (k, valeur) => {
    const s = String(valeur).trim();
    let r;
    if ((r = s.match(/^(\d{1,2})\/(\d{1,2})$/))) return { partiel: true, j: +r[1], m: +r[2] };
    let a, m, j;
    if ((r = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) [a, m, j] = [+r[1], +r[2], +r[3]];
    else if ((r = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) [j, m, a] = [+r[1], +r[2], +r[3]];
    else if ((r = s.match(/^(\d{2})(\d{2})(\d{4})$/))) [j, m, a] = [+r[1], +r[2], +r[3]];
    if (a && valide(a, m, j)) return { a, m, j };
    erreurs.push(`${k} : date invalide ${JSON.stringify(valeur)} (formats : JJ/MM/AAAA, AAAA-MM-JJ, JJ/MM si année fournie)`);
    return null;
  };
  const construire = (k, a, m, j) => {
    if (valide(a, m, j)) return { a, m, j };
    erreurs.push(`${k} : ${p2(j)}/${p2(m)} n'existe pas en ${a}`);
    return null;
  };

  if (!vide(brut.date_naissance)) {
    const d = parse('date_naissance', brut.date_naissance);
    if (d && d.partiel) erreurs.push("date_naissance : l'année est obligatoire");
    else if (d) v.date_naissance = d;
  }

  // Période (date_effet, date_fin, date_signature)
  if (!vide(brut.date_effet) && !vide(brut.date_fin)) {
    const effet = parse('date_effet', brut.date_effet);
    const fin = parse('date_fin', brut.date_fin);
    const sig = vide(brut.date_signature) ? null : parse('date_signature', brut.date_signature);

    if (effet && fin) {
      if ([effet, fin, sig].some((d) => d && d.partiel) && annee === null) {
        erreurs.push('dates au format JJ/MM : une année est requise (champ « annee » ou --annee)');
      } else {
        const debut = effet.partiel ? construire('date_effet', annee, effet.m, effet.j)
          : annee !== null ? avecAnnee(effet, annee) : effet;
        if (debut) {
          v.date_effet = debut;
          // Recale une date sur l'année de debut ; date complète : écart avec effet conservé.
          const relative = (k, d, ajuster) => {
            if (d.partiel) {
              const x = construire(k, debut.a, d.m, d.j);
              return x && ajuster ? ajuster(x) : x;
            }
            if (annee !== null) return avecAnnee(d, debut.a + (effet.partiel ? 0 : d.a - effet.a));
            return d;
          };
          // Fin : JJ/MM ≤ effet → année suivante (couverture d'un an, ex. 30/09 → 30/09).
          v.date_fin = relative('date_fin', fin, (x) => (cle(x) <= cle(debut) ? avecAnnee(x, x.a + 1) : x));
          if (sig) v.date_signature = relative('date_signature', sig);
        }
      }
    }
  }
  if (!v.date_signature && vide(brut.date_signature) && aujourdhui) v.date_signature = aujourdhui;

  if (!vide(brut.telephone)) {
    const chiffres = String(brut.telephone).replace(/\D/g, '').replace(/^(?:00)?33/, '0');
    if (/^0\d{9}$/.test(chiffres)) v.telephone = chiffres;
    else erreurs.push(`telephone : 10 chiffres attendus (reçu ${JSON.stringify(brut.telephone)})`);
  }

  if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) erreurs.push(`email invalide : ${JSON.stringify(v.email)}`);

  if (!vide(brut.motif)) {
    const motif = Number(String(brut.motif).trim());
    if (MOTIFS[motif]) v.motif = motif;
    else erreurs.push(`motif doit être un entier de 1 à 8 (reçu ${JSON.stringify(brut.motif)})`);
  }

  if (v.date_effet && v.date_fin) {
    if (avant(v.date_fin, v.date_effet)) erreurs.push(`date_fin (${fr(v.date_fin)}) est antérieure à date_effet (${fr(v.date_effet)})`);
    const limite = plusMois(v.date_effet, 12);
    if (v.motif === 1 && avant(limite, v.date_fin)) {
      avertissements.push(`motif 1 : la dispense ne peut pas dépasser 12 mois (fin au plus tard le ${fr(limite)})`);
    }
  }

  return { valeurs: v, erreurs, avertissements };
}

// attestation_dispense_2027_DUPONT_Camille.pdf
function nomSortie(v) {
  const slug = [v.nom_usage || v.nom_naissance, v.prenom]
    .map((s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-'))
    .join('_');
  return `attestation_dispense_${v.date_effet.a}_${slug}.pdf`;
}

// Valeurs à écrire dans le PDF : { nomDuChamp: texte | booléen }
function valeursFormulaire(v) {
  const champs = {};
  Object.entries(CHAMPS_TEXTE).forEach(([k, champ]) => { champs[champ] = v[k] || ''; });
  Object.entries(CHAMPS_DATE).forEach(([k, champ]) => { champs[champ] = v[k] ? comb(v[k]) : ''; });
  Object.entries(MOTIFS).forEach(([num, [caseACocher, champDate]]) => {
    const choisi = Number(num) === v.motif;
    champs[caseACocher] = choisi;
    champs[champDate] = choisi ? comb(v.date_fin) : '';
  });
  return champs;
}

function parseArgs(argv) {
  const opts = { flatten: false, retour: 'notification' };
  const positionnels = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--annee') opts.annee = argv[++i];
    else if (a === '--decalage') opts.decalage = argv[++i];
    else if (a === '--modele') opts.modele = argv[++i];
    else if (a === '--dossier') opts.dossier = argv[++i];
    else if (a === '--flatten') opts.flatten = true;
    else if (a === '--dialogue') opts.retour = 'dialogue';
    else if (a === '--sans-notif') opts.retour = 'aucun';
    else if (a === '--motifs') opts.motifs = true;
    else if (a.startsWith('--')) throw new Error(`option inconnue : ${a}`);
    else positionnels.push(a);
  }
  opts.source = positionnels[0];
  return opts;
}

// ---------------------------------------------------------------------------
// Couche macOS (JXA) — non exécutée sous Node
// ---------------------------------------------------------------------------

/* global ObjC, $, Application */

function run(argv) {
  ObjC.import('Foundation');
  ObjC.import('AppKit');
  try { ObjC.import('PDFKit'); } catch (e) { ObjC.import('Quartz'); } // PDFKit autonome depuis macOS 10.13

  const app = Application.currentApplication();
  app.includeStandardAdditions = true;
  const TITRE = 'Dispense MGEN';
  let opts = { retour: 'notification' };

  const notifier = (message, sousTitre, son) => {
    if (opts.retour !== 'notification') return;
    try { app.displayNotification(message, { withTitle: TITRE, subtitle: sousTitre, soundName: son || 'Glass' }); } catch (e) { /* pas bloquant */ }
  };
  // Fenêtre au premier plan ; renvoie le bouton choisi (pas de bouton « annuler » → pas d'exception)
  const dialogue = (message, boutons, defaut, icone) => {
    try {
      app.activate();
      return app.displayDialog(message, { withTitle: TITRE, buttons: boutons, defaultButton: defaut, withIcon: icone }).buttonReturned;
    } catch (e) { return null; }
  };
  const chemin = (p) => ObjC.unwrap($(String(p)).stringByExpandingTildeInPath);
  const existe = (p) => $.NSFileManager.defaultManager.fileExistsAtPath(p);
  const lireFichier = (p) => {
    const s = $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null);
    if (s.isNil()) throw new Error(`lecture impossible : ${p}`);
    return ObjC.unwrap(s);
  };
  const lireStdin = () => {
    const data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
    return ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding));
  };
  const scriptDir = () => {
    // Dossier du script quand lancé en CLI (chemin relatif résolu sur le dossier courant).
    const cwd = ObjC.unwrap($.NSFileManager.defaultManager.currentDirectoryPath);
    const args = ObjC.deepUnwrap($.NSProcessInfo.processInfo.arguments) || [];
    const script = args.find((x) => /\.js$/.test(x));
    if (!script) return cwd;
    const absolu = script.startsWith('/') ? script : `${cwd}/${script}`;
    return ObjC.unwrap($(absolu).stringByStandardizingPath.stringByDeletingLastPathComponent);
  };

  try {
    opts = parseArgs(argv.map(String));
    if (opts.motifs) return Object.entries(LIBELLES_MOTIFS).map(([n, l]) => `${n}. ${l}`).join('\n');
    if (!opts.source) throw new Error('Usage : osascript -l JavaScript remplir_dispense.js donnees.json|- [options]');

    const texte = opts.source === '-' ? lireStdin() : lireFichier(chemin(opts.source));
    let brut;
    try { brut = JSON.parse(texte); } catch (e) {
      throw new Error(`données illisibles (JSON attendu) : ${String(texte).slice(0, 120)}`);
    }

    const now = new Date();
    const res = normaliser(brut, {
      annee: opts.annee, decalage: opts.decalage,
      aujourdhui: { a: now.getFullYear(), m: now.getMonth() + 1, j: now.getDate() },
    });
    if (res.erreurs.length) throw new Error(`Données invalides :\n  - ${res.erreurs.join('\n  - ')}`);
    const v = res.valeurs;

    const base = scriptDir();
    const modele = chemin(opts.modele || brut.modele || `${base}/modele/attestation_honneur_dispense.pdf`);
    const dossier = chemin(opts.dossier || brut.dossier_sortie || `${base}/sorties`);
    if (!existe(modele)) throw new Error(`formulaire vierge introuvable : ${modele}`);
    $.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(dossier, true, $(), null);
    const sortie = `${dossier}/${nomSortie(v)}`;

    // --- PDFKit ---
    const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(modele));
    if (doc.isNil()) throw new Error(`PDF illisible : ${modele}`);
    const widgets = {};
    for (let p = 0; p < doc.pageCount; p++) {
      const annots = doc.pageAtIndex(p).annotations;
      for (let i = 0; i < annots.count; i++) {
        const a = annots.objectAtIndex(i);
        const nom = ObjC.unwrap(a.fieldName);
        if (nom) (widgets[nom.normalize('NFC')] = widgets[nom.normalize('NFC')] || []).push(a);
      }
    }
    const police = $.NSFont.fontWithNameSize('Helvetica', 10);
    Object.entries(valeursFormulaire(v)).forEach(([champ, valeur]) => {
      const liste = widgets[champ.normalize('NFC')];
      if (!liste) throw new Error(`champ introuvable dans le PDF : ${champ}`);
      liste.forEach((a) => {
        if (typeof valeur === 'boolean') a.setButtonWidgetState(valeur ? 1 : 0);
        else { a.setFont(police); a.setWidgetStringValue($(valeur)); }
      });
    });

    let ok;
    if (opts.flatten) {
      // PDFDocumentBurnInAnnotationsOption (macOS 13+) n'est pas toujours exposée au pont JXA :
      // on passe la constante si elle existe, sinon les valeurs brutes candidates.
      const options = $.NSMutableDictionary.dictionary;
      const vrai = $.NSNumber.numberWithBool(true);
      const constante = $.PDFDocumentBurnInAnnotationsOption;
      if (constante && !constante.isNil()) options.setObjectForKey(vrai, constante);
      ['PDFDocumentBurnInAnnotationsOption', 'BurnInAnnotations', 'burnInAnnotations']
        .forEach((k) => options.setObjectForKey(vrai, $(k)));
      ok = doc.writeToFileWithOptions(sortie, options);
    } else {
      ok = doc.writeToFile(sortie);
    }
    if (!ok) throw new Error(`écriture impossible : ${sortie}`);

    // Vérifie l'aplatissement en relisant le fichier écrit
    let etat = '';
    if (opts.flatten) {
      const relu = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(sortie));
      let restants = 0;
      for (let p = 0; p < relu.pageCount; p++) {
        const annots = relu.pageAtIndex(p).annotations;
        for (let i = 0; i < annots.count; i++) if (ObjC.unwrap(annots.objectAtIndex(i).fieldName)) restants++;
      }
      etat = restants ? ' — non aplati (champs encore éditables)' : ' — aplati';
    }

    res.avertissements.forEach((w) => console.log(`⚠️  ${w}`));
    const nom = `${v.prenom} ${v.nom_usage || v.nom_naissance}`;
    notifier(`${nom} — ${fr(v.date_effet)} → ${fr(v.date_fin)}`, `✅ Attestation ${v.date_effet.a} prête`);
    if (opts.retour === 'dialogue') {
      const ouvrir = 'Ouvrir le PDF';
      const finder = 'Afficher dans le Finder';
      const choix = dialogue(
        `✅ Attestation ${v.date_effet.a} prête\n\n${nom}\n${fr(v.date_effet)} → ${fr(v.date_fin)}\n\n${sortie.split('/').pop()}`,
        ['Plus tard', finder, ouvrir], ouvrir, 'note',
      );
      const url = $.NSURL.fileURLWithPath(sortie);
      if (choix === ouvrir) $.NSWorkspace.sharedWorkspace.openURL(url);
      if (choix === finder) $.NSWorkspace.sharedWorkspace.activateFileViewerSelectingURLs($.NSArray.arrayWithObject(url));
    }
    return `✅ ${sortie} (${fr(v.date_effet)} → ${fr(v.date_fin)}, motif ${v.motif} : ${LIBELLES_MOTIFS[v.motif]})${etat}`;
  } catch (e) {
    notifier(String(e.message).split('\n').slice(0, 3).join(' '), '❌ Échec', 'Basso');
    if (opts.retour === 'dialogue') dialogue(`❌ Échec de la génération\n\n${e.message}`, ['OK'], 'OK', 'stop');
    throw e;
  }
}

// Export pour les tests Node (ignoré par osascript)
if (typeof module !== 'undefined') {
  module.exports = { normaliser, nomSortie, valeursFormulaire, parseArgs, MOTIFS, LIBELLES_MOTIFS, iso, fr };
}
