// Sauvegarde et export. Le CSV utilise le point-virgule et un BOM UTF-8 :
// c'est ce qu'attend Excel en configuration francophone.

import { EMPLACEMENTS, jourIso, libelleCouleur } from './model.js';
import * as store from './store.js';

const SEPARATEUR = ';';

function echapper(valeur) {
  const texte = valeur === null || valeur === undefined ? '' : String(valeur);
  return /[";\n\r]/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte;
}

function versCsv(entetes, lignes) {
  const corps = [entetes, ...lignes]
    .map((ligne) => ligne.map(echapper).join(SEPARATEUR))
    .join('\r\n');
  return `﻿${corps}\r\n`;
}

export function csvDesVins(vins) {
  const entetes = [
    'Nom du vin', 'Producteur', 'Région / Appellation', 'Cépage', 'Couleur',
    'Millésime', 'Volume', 'Degré (%)', 'Quantité', 'Provenance',
    'Offert par / Acheté chez', 'Date de réception',
    ...EMPLACEMENTS.map((e) => e.libelle),
    'Emplacement précis', 'Statut', 'Note', 'Note /5',
  ];
  const lignes = vins.map((vin) => [
    vin.nom, vin.producteur, vin.region, vin.cepage, libelleCouleur(vin.couleur),
    vin.millesime ?? '', vin.volume, vin.degre ?? '', vin.quantite, vin.provenance,
    vin.source, vin.dateReception,
    ...EMPLACEMENTS.map((e) => vin.emplacements[e.cle] || ''),
    vin.emplacementPrecis,
    vin.statut === 'termine' ? 'Terminé' : 'En cave',
    vin.note, vin.notation ?? '',
  ]);
  return versCsv(entetes, lignes);
}

export function csvDesDegustations(degustations) {
  const entetes = ['Date', 'Nom du vin', 'Producteur', 'Région / Appellation', 'Cépage',
    'Couleur', 'Millésime', 'Contexte', 'Lieu', 'Note /5', 'Commentaire', 'Vient de la cave'];
  const lignes = degustations.map((d) => [
    d.date, d.nom, d.producteur, d.region, d.cepage, libelleCouleur(d.couleur),
    d.millesime ?? '', d.contexte, d.lieu, d.notation ?? '', d.commentaire,
    d.vinId ? 'oui' : 'non',
  ]);
  return versCsv(entetes, lignes);
}

// Traduction des refus de l'hébergeur, pour dire ce qui s'est passé plutôt
// que d'afficher un code en anglais.
const RAISONS = {
  too_large: 'le fichier est trop volumineux',
  rate_limited: 'une demande est déjà en cours, réessayez dans un instant',
  rejected_extension: 'ce format de fichier n’est pas accepté ici',
  extension_not_enabled: 'ce format de fichier n’est pas accepté ici',
  unavailable: 'l’enregistrement de fichiers est indisponible ici',
  not_granted: 'l’enregistrement de fichiers n’a pas été autorisé',
};

/**
 * Remet un fichier à la personne qui l'a demandé.
 *
 * Une page d'artefact ne peut pas déclencher un téléchargement elle-même : le
 * lien reste inerte, sans la moindre erreur, et l'application croirait avoir
 * réussi. L'hébergeur offre pour cela une remise qui demande confirmation.
 * Ailleurs, un lien ordinaire fait très bien l'affaire.
 *
 * Rend 'enregistre', ou 'refuse' si la personne décline. Lève dans tous les
 * autres cas, pour qu'aucun appelant n'annonce une sauvegarde qui n'a pas eu
 * lieu.
 */
export async function telecharger(nomFichier, contenu, type) {
  const blob = contenu instanceof Blob ? contenu : new Blob([contenu], { type });
  const use = globalThis.claude?.use;

  if (typeof use === 'function') {
    const remise = await use('downloads').catch(() => null);
    if (!remise) throw new Error(RAISONS.unavailable);
    try {
      await remise.save({ filename: nomFichier, data: blob });
      return 'enregistre';
    } catch (erreur) {
      if (erreur?.code === 'declined') return 'refuse';
      throw new Error(RAISONS[erreur?.code] || erreur?.message || 'raison inconnue');
    }
  }

  const url = URL.createObjectURL(blob);
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = nomFichier;
  document.body.append(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'enregistre';
}

const horodatage = () => jourIso();

export async function sauvegardeComplete() {
  const paquet = await store.exporterJson({ avecPhotos: true });
  return telecharger(`cave-a-vin-${horodatage()}.json`,
    JSON.stringify(paquet, null, 1), 'application/json');
}

export function exportVinsCsv() {
  return telecharger(`cave-a-vin-${horodatage()}.csv`,
    csvDesVins(store.vins()), 'text/csv;charset=utf-8');
}

export function exportDegustationsCsv() {
  return telecharger(`degustations-${horodatage()}.csv`,
    csvDesDegustations(store.degustations()), 'text/csv;charset=utf-8');
}

export function lireFichierJson(fichier) {
  return new Promise((resoudre, rejeter) => {
    const lecteur = new FileReader();
    lecteur.onload = () => {
      try {
        resoudre(JSON.parse(lecteur.result));
      } catch {
        rejeter(new Error("Ce fichier n'est pas un JSON valide"));
      }
    };
    lecteur.onerror = () => rejeter(new Error('Fichier illisible'));
    lecteur.readAsText(fichier);
  });
}
