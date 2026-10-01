// Tests du générateur de raccourci : node --test test/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { construire, valeursDefaut, CHAMPS } = require('../outils/raccourci.js');

const RACINE = path.resolve(__dirname, '..');
const moteur = fs.readFileSync(path.join(RACINE, 'remplir_dispense.js'), 'utf8');
const donnees = JSON.parse(fs.readFileSync(path.join(RACINE, 'donnees/exemple.json.dist'), 'utf8'));

// Relit le XML avec un parseur plist indépendant (Python plistlib)
const lirePlist = (xml) => JSON.parse(execFileSync('python3', ['-c',
  'import plistlib,sys,json; print(json.dumps(plistlib.loads(sys.stdin.buffer.read())))'], { input: xml }));

test('plist valide, structure attendue', () => {
  const { xml } = construire({ moteur, valeurs: valeursDefaut({ donnees, racine: '/R' }) });
  const p = lirePlist(xml);
  const ids = p.WFWorkflowActions.map((a) => a.WFWorkflowActionIdentifier.replace('is.workflow.actions.', ''));
  assert.deepEqual(ids, ['comment', ...CHAMPS.map(() => 'gettext'), 'dictionary', 'detect.text', 'runshellscript']);

  // aucune question d'import (elles bouclent à l'ajout sur macOS)
  assert.deepEqual(p.WFWorkflowImportQuestions, []);

  // chaque entrée du dictionnaire référence la sortie d'une action Texte existante
  const uuids = new Map(p.WFWorkflowActions.map((a) => [a.WFWorkflowActionParameters.UUID, a]));
  const dico = p.WFWorkflowActions.at(-3).WFWorkflowActionParameters.WFItems.Value.WFDictionaryFieldValueItems;
  assert.deepEqual(dico.map((i) => i.WFKey.Value.string), CHAMPS.map((c) => c[0]));
  dico.forEach((i) => {
    const ref = i.WFValue.Value.attachmentsByRange['{0, 1}'];
    assert.equal(i.WFValue.Value.string, '￼');
    assert.equal(uuids.get(ref.OutputUUID).WFWorkflowActionIdentifier, 'is.workflow.actions.gettext');
  });
  const shell = p.WFWorkflowActions.at(-1).WFWorkflowActionParameters;
  assert.equal(shell.InputMode, 'to stdin');
  assert.equal(shell.Input.Value.OutputUUID, p.WFWorkflowActions.at(-2).WFWorkflowActionParameters.UUID);
  assert.equal(p.WFWorkflowActions.at(-2).WFWorkflowActionParameters.WFInput.Value.OutputUUID,
    p.WFWorkflowActions.at(-3).WFWorkflowActionParameters.UUID);
  assert.equal([...uuids.keys()].filter(Boolean).length, p.WFWorkflowActions.length - 1); // UUID uniques (hors commentaire)
});

test('défauts : perso = données sans année + chemins locaux ; partage = repères', () => {
  const perso = valeursDefaut({ donnees: { ...donnees, annee: 2027 }, racine: '/R' });
  assert.equal(perso.annee, undefined);
  assert.equal(perso.prenom, 'Camille');
  assert.equal(perso.signature, 'Camille Dupont');
  assert.equal(perso.modele, '/R/modele/attestation_honneur_dispense.pdf');
  const partage = valeursDefaut({ partage: true });
  assert.equal(partage.prenom, '⟨Prénom⟩');
  assert.match(partage.modele, /^~\/Documents\//);
});

test('version partagée telle quelle : le moteur liste les champs à remplir', () => {
  const { normaliser } = require('../remplir_dispense.js');
  const r = normaliser(valeursDefaut({ partage: true }), { decalage: 1, aujourdhui: { a: 2026, m: 10, j: 1 } });
  assert.deepEqual(r.erreurs, ['Nom de naissance', 'Prénom', 'Date de naissance', "Date d'effet", 'Motif', 'Date de fin', 'Fait à']
    .map((l) => `« ${l} » est obligatoire`));
});

test('version partagée remplie (facultatifs laissés en repère) : valide', () => {
  const { normaliser } = require('../remplir_dispense.js');
  const v = { ...valeursDefaut({ partage: true }), nom_naissance: 'Martin', prenom: 'Léa', date_naissance: '01/02/1990',
    motif: '3', date_effet: '01/09', date_fin: '31/08', fait_a: 'Lyon', signature: 'Léa MARTIN' };
  const r = normaliser(v, { decalage: 1, aujourdhui: { a: 2026, m: 10, j: 1 } });
  assert.deepEqual(r.erreurs, []);
  assert.equal(r.valeurs.nom_usage, undefined);
  assert.equal(r.valeurs.telephone, undefined);
  assert.equal(r.valeurs.date_effet.a, 2027);
});

test('le script shell restitue le moteur à l\'identique et lui passe stdin', () => {
  const tmp = fs.mkdtempSync('/tmp/dispense-test-');
  const { xml } = construire({ moteur, valeurs: {} });
  const script = lirePlist(xml).WFWorkflowActions.at(-1).WFWorkflowActionParameters.Script;
  // faux osascript : copie le moteur reçu et le stdin
  fs.writeFileSync(`${tmp}/osascript`, `#!/bin/sh\ncp "$3" "${tmp}/moteur.js"; cat > "${tmp}/stdin"; echo "$4 $5 $6 $7 $8" > "${tmp}/args"\n`, { mode: 0o755 });
  execFileSync('zsh', ['-c', script], { input: '{"prenom":"Léa"}', env: { ...process.env, PATH: `${tmp}:${process.env.PATH}` } });
  assert.equal(fs.readFileSync(`${tmp}/moteur.js`, 'utf8'), moteur.replace(/\n$/, '') + '\n');
  assert.equal(fs.readFileSync(`${tmp}/stdin`, 'utf8'), '{"prenom":"Léa"}');
  assert.equal(fs.readFileSync(`${tmp}/args`, 'utf8').trim(), '- --decalage 1 --flatten --dialogue');
});

