// Tests de la logique pure du moteur : node --test test/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normaliser, nomSortie, valeursFormulaire, parseArgs, iso } = require('../remplir_dispense.js');

const AUJ = { a: 2026, m: 10, j: 1 };
const base = {
  nom_naissance: 'Durand', nom_usage: '', prenom: 'Claire', date_naissance: '14/05/1985',
  telephone: '+33 6 01 02 03 04', email: 'claire.durand@example.fr', motif: '3', fait_a: 'Lyon',
  date_effet: '30/09', date_fin: '30/09', date_signature: '01/09', signature: 'Claire DURAND',
};
const run = (surcharges = {}, opts = {}) => normaliser({ ...base, ...surcharges }, { aujourdhui: AUJ, ...opts });
const dates = (r) => [r.valeurs.date_effet, r.valeurs.date_fin, r.valeurs.date_signature].map((d) => d && iso(d));

test('JJ/MM + annee du JSON', () => {
  const r = run({ annee: '2027' });
  assert.deepEqual(r.erreurs, []);
  assert.deepEqual(dates(r), ['2027-09-30', '2028-09-30', '2027-09-01']);
});

test('--annee prime sur le JSON', () => {
  assert.deepEqual(dates(run({ annee: '2027' }, { annee: '2030' })), ['2030-09-30', '2031-09-30', '2030-09-01']);
});

test('décalage : année en cours + 1 si aucune année fournie', () => {
  assert.deepEqual(dates(run({ annee: '' }, { decalage: '1' })), ['2027-09-30', '2028-09-30', '2027-09-01']);
});

test('annee du JSON prime sur le décalage', () => {
  assert.deepEqual(dates(run({ annee: '2029' }, { decalage: '1' }))[0], '2029-09-30');
});

test('fin < effet en JJ/MM → année suivante', () => {
  assert.deepEqual(dates(run({ annee: 2027, date_effet: '01/09', date_fin: '31/08' })).slice(0, 2), ['2027-09-01', '2028-08-31']);
});

test('dates complètes : écart conservé', () => {
  const r = run({ date_effet: '2026-09-01', date_fin: '2027-08-31', date_signature: '15/08/2026' }, { annee: 2028 });
  assert.deepEqual(dates(r), ['2028-09-01', '2029-08-31', '2028-08-15']);
});

test('dates complètes sans année : inchangées', () => {
  const r = run({ date_effet: '30/09/2027', date_fin: '30/09/2028', date_signature: '01/09/2027' });
  assert.deepEqual(dates(r), ['2027-09-30', '2028-09-30', '2027-09-01']);
});

test('29/02 recalé sur année non bissextile', () => {
  assert.equal(dates(run({ date_effet: '2028-02-29', date_fin: '2028-12-31' }, { annee: 2027 }))[0], '2027-02-28');
});

test('JJ/MM sans année → erreur explicite', () => {
  assert.match(run({ annee: '' }).erreurs.join(), /année est requise/);
});

test('date impossible', () => {
  assert.match(run({ annee: 2027, date_effet: '30/02' }).erreurs.join(), /30\/02 n'existe pas en 2027/);
});

test('signature absente → date du jour', () => {
  assert.equal(dates(run({ annee: 2027, date_signature: '' }))[2], '2026-10-01');
});

test('erreurs cumulées', () => {
  const r = run({ annee: 2027, prenom: '', motif: '12', telephone: '123', email: 'a@b', date_naissance: '31/02/1990' });
  assert.equal(r.erreurs.length, 5, r.erreurs.join('\n'));
});

test('motif 1 > 12 mois → avertissement', () => {
  const r = run({ annee: 2027, motif: 1, date_effet: '01/01/2027', date_fin: '15/01/2028' });
  assert.equal(r.avertissements.length, 1);
});

test('normalisations : majuscules, téléphone, signature objet (ancien JSON)', () => {
  const r = run({ annee: 2027, nom_usage: 'Martin', signature: { texte: 'A. D.' } });
  assert.equal(r.valeurs.nom_naissance, 'DURAND');
  assert.equal(r.valeurs.telephone, '0601020304');
  assert.equal(r.valeurs.signature, 'A. D.');
  assert.equal(nomSortie(r.valeurs), 'attestation_dispense_2027_MARTIN_Claire.pdf');
});

test('nom de fichier sans accents', () => {
  const r = run({ annee: 2027, prenom: 'Léa-Hélène', nom_naissance: "D'Éon" });
  assert.equal(nomSortie(r.valeurs), 'attestation_dispense_2027_D-EON_Lea-Helene.pdf');
});

test('valeurs du formulaire : une seule case cochée, date du bon motif', () => {
  const f = valeursFormulaire(run({ annee: 2027 }).valeurs);
  const cases = Object.entries(f).filter(([, x]) => typeof x === 'boolean');
  assert.equal(cases.filter(([, x]) => x).length, 1);
  assert.equal(f['du secteur privé ou public de votre conjoint ou de votre parent'], '30092028');
  assert.equal(f['Date effet dispense'], '30092027');
  assert.equal(f.Le, '01092027');
  assert.equal(f['Téléphone'], '0601020304');
  assert.equal(f.undefined, '');
});

test('parseArgs', () => {
  assert.deepEqual(parseArgs(['-', '--decalage', '1', '--flatten', '--dialogue']), { flatten: true, retour: 'dialogue', decalage: '1', source: '-' });
  assert.equal(parseArgs(['x.json']).retour, 'notification');
  assert.equal(parseArgs(['x.json', '--sans-notif']).retour, 'aucun');
  assert.throws(() => parseArgs(['--nope']), /option inconnue/);
});
