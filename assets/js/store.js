// État de l'application : chargement, persistance et actions métier.
//
// Les données vivent dans localStorage, et rejoignent la cave partagée quand
// un code d'accès est enregistré. Une installation neuve démarre sur une cave
// vide : ce qui la remplit vient de la saisie, d'une sauvegarde restaurée, ou
// du partage rejoint.

import {
  EMPLACEMENTS, aujourdhui, entier, identifiant,
  normaliserDegustation, normaliserVin,
} from './model.js';
import * as photos from './photos.js';
import * as synchro from './nuage.js';

const CLE_DONNEES = 'cave-a-vin.donnees.v1';
const CLE_PREFERENCES = 'cave-a-vin.preferences.v1';
export const VERSION_DONNEES = 1;
// Affichée dans les réglages : sans elle, impossible de savoir à distance si
// un appareil tourne encore sur une version en cache. À faire suivre sw.js.
export const VERSION_APP = '25';

const etat = {
  vins: [],
  degustations: [],
  preferences: { theme: 'auto', affichage: 'grille', lectureAuto: false },
  charge: false,
  majLe: '',
};

const abonnes = new Set();

export function abonner(rappel) {
  abonnes.add(rappel);
  return () => abonnes.delete(rappel);
}

function notifier() {
  for (const rappel of abonnes) rappel(etat);
}

export const donnees = () => etat;
export const etatSynchro = () => synchro.etat();
/** Le partage est-il réellement branché, quel que soit son état du moment ? */
export const partageBranche = () => synchro.synchroActive();
/** Cette version sait-elle joindre une cave partagée ? */
export const partageConfigure = () => synchro.configure();
/** Le code d'accès enregistré sur cet appareil, vide s'il n'y en a pas. */
export const codePartage = () => synchro.codeConfigure();
export const inventerCode = () => synchro.inventerCode();

/**
 * Change la cave partagée à laquelle cet appareil se rattache.
 *
 * Le rechargement n'est pas une facilité : tout l'état de la synchronisation,
 * de la file d'attente au document témoin, se rapporte à une cave précise.
 * Repartir de zéro est plus sûr que de démêler l'ancien du nouveau.
 */
export function definirCodePartage(valeur) {
  synchro.enregistrerCode(valeur);
  location.reload();
}

/**
 * Rejoint une cave neuve en laissant ici le contenu de cet appareil.
 *
 * Créer un partage publie d'ordinaire la cave de l'appareil, ce qui est
 * exactement ce qu'on veut quand on relie un deuxième téléphone. Repartir
 * de rien est l'autre besoin, et il faut vider le local avant de changer de
 * code, sans quoi le contenu serait publié dans la nouvelle cave. L'ancienne
 * n'est pas touchée : on la quitte, on ne l'efface pas.
 */
export function demarrerCaveVide(valeur) {
  adopter({ vins: [], degustations: [] });
  enregistrer();
  synchro.enregistrerCode(valeur);
  location.reload();
}
export const vins = () => etat.vins;
export const degustations = () => etat.degustations;
export const preferences = () => etat.preferences;
export const trouverVin = (id) => etat.vins.find((v) => v.id === id) || null;
export const trouverDegustation = (id) => etat.degustations.find((d) => d.id === id) || null;
export const degustationsDuVin = (id) => etat.degustations.filter((d) => d.vinId === id);

// --- persistance ------------------------------------------------------------

function lireLocal(cle) {
  try {
    const brut = localStorage.getItem(cle);
    return brut ? JSON.parse(brut) : null;
  } catch {
    return null;
  }
}

let stockageRefuse = false;

/** Le navigateur refuse-t-il de garder la cave d'une visite à l'autre ? */
export const stockageDurable = () => !stockageRefuse;

function ecrireLocal(cle, valeur) {
  try {
    localStorage.setItem(cle, JSON.stringify(valeur));
    return true;
  } catch (erreur) {
    // Navigation privée, cadre d'un autre site, quota atteint : la cave
    // continue de fonctionner mais ne survivra pas à la fermeture.
    console.error('Écriture impossible dans le stockage local', erreur);
    stockageRefuse = true;
    return false;
  }
}

function enregistrer() {
  etat.majLe = new Date().toISOString();
  const ok = ecrireLocal(CLE_DONNEES, {
    version: VERSION_DONNEES,
    majLe: etat.majLe,
    vins: etat.vins,
    degustations: etat.degustations,
  });
  notifier();
  return ok;
}

export function enregistrerPreferences(modifications) {
  etat.preferences = { ...etat.preferences, ...modifications };
  ecrireLocal(CLE_PREFERENCES, etat.preferences);
  notifier();
}

function adopter(paquet) {
  etat.vins = (paquet.vins || []).map(normaliserVin);
  etat.degustations = (paquet.degustations || []).map(normaliserDegustation);
  etat.majLe = paquet.majLe || '';
}

export async function charger() {
  etat.preferences = { ...etat.preferences, ...(lireLocal(CLE_PREFERENCES) || {}) };
  const local = lireLocal(CLE_DONNEES);
  if (local && Array.isArray(local.vins)) adopter(local);
  etat.charge = true;
  notifier();

  // La cave s'affiche d'abord depuis le navigateur. Le stockage partagé, s'il
  // existe, se branche ensuite et met les appareils d'accord.
  synchro.initialiser({
    donneesLocales: () => ({ vins: etat.vins, degustations: etat.degustations }),
    onDonnees: appliquerDistant,
    onEtat: notifier,
  }).catch((erreur) => console.info('Synchronisation indisponible', erreur));

  return etat;
}

/**
 * Adopte ce que disent les autres appareils.
 *
 * Une liste vide était autrefois ignorée, par crainte qu'une lecture partielle
 * n'efface la cave. Le transport actuel lève sur la moindre erreur plutôt que
 * de rendre une liste incomplète : une liste vide veut donc dire vide. La
 * garde, elle, empêchait de recevoir un « vider la cave » fait ailleurs, et
 * pire, faisait ressusciter à la connexion suivante tout ce qui venait d'être
 * effacé.
 *
 * `majLe` suit, sans quoi l'application ne verrait pas qu'elle a changé quand
 * le nombre de fiches reste le même : une quantité corrigée sur l'autre
 * appareil n'aurait pas redessiné l'écran.
 */
function appliquerDistant(cle, fiches) {
  if (cle === 'vins') etat.vins = fiches.map(normaliserVin);
  else etat.degustations = fiches.map(normaliserDegustation);

  etat.majLe = new Date().toISOString();
  ecrireLocal(CLE_DONNEES, {
    version: VERSION_DONNEES,
    majLe: etat.majLe,
    vins: etat.vins,
    degustations: etat.degustations,
  });
  notifier();
}

/** Vide la cave, ici et chez tous les appareils qui la partagent. */
export async function vider() {
  adopter({ vins: [], degustations: [] });
  await photos.vider().catch(() => {});
  enregistrer();
  await synchro.remplacerTout(etat).catch(() => {});
}

// --- actions sur les vins ---------------------------------------------------

/** Heure de la modification, telle que la voit l'appareil qui la fait. */
const maintenant = () => new Date().toISOString();

export function ajouterVin(champs) {
  const vin = normaliserVin({ ...champs, id: identifiant('v'), modifieLe: maintenant() });
  etat.vins.unshift(vin);
  enregistrer();
  synchro.ecrireVin(vin);
  return vin;
}

export function modifierVin(id, champs) {
  const index = etat.vins.findIndex((v) => v.id === id);
  if (index === -1) return null;
  const vin = normaliserVin({ ...etat.vins[index], ...champs, id, modifieLe: maintenant() });
  etat.vins[index] = vin;
  enregistrer();
  synchro.ecrireVin(vin);
  return vin;
}

export function supprimerVin(id) {
  const vin = trouverVin(id);
  if (!vin) return false;
  // Les dégustations reprennent la photo du vin : on ne l'efface que si plus
  // personne ne s'en sert.
  if (vin.photoLocale && !photoPartagee(vin.photoLocale, null, id)) {
    photos.supprimer(vin.photoLocale).catch(() => {});
  }
  etat.vins = etat.vins.filter((v) => v.id !== id);
  // Les dégustations gardent leur trace mais perdent le lien vers la fiche.
  const detachees = [];
  etat.degustations = etat.degustations.map((d) => {
    if (d.vinId !== id) return d;
    const detachee = { ...d, vinId: '', modifieLe: maintenant() };
    detachees.push(detachee);
    return detachee;
  });
  enregistrer();
  synchro.effacerVin(id);
  for (const d of detachees) synchro.ecrireDegustation(d);
  return true;
}

/** Ajoute des bouteilles à un emplacement donné. */
export function ajouterBouteilles(id, emplacement, nombre = 1) {
  const vin = trouverVin(id);
  if (!vin) return null;
  const ajout = entier(nombre, 0);
  if (ajout === 0) return vin;
  const emplacements = { ...vin.emplacements };
  if (emplacement) emplacements[emplacement] = (emplacements[emplacement] || 0) + ajout;
  return modifierVin(id, {
    emplacements,
    quantite: vin.quantite + ajout,
    statut: 'en-cave',
  });
}

/** Retire une bouteille d'un emplacement, sans l'enregistrer comme dégustation. */
export function retirerBouteilles(id, emplacement, nombre = 1) {
  const vin = trouverVin(id);
  if (!vin) return null;
  const retrait = Math.min(entier(nombre, 0), vin.quantite);
  if (retrait === 0) return vin;
  const emplacements = { ...vin.emplacements };
  if (emplacement && emplacements[emplacement] > 0) {
    emplacements[emplacement] = Math.max(0, emplacements[emplacement] - retrait);
  }
  const quantite = vin.quantite - retrait;
  return modifierVin(id, {
    emplacements,
    quantite,
    statut: quantite === 0 ? 'termine' : 'en-cave',
  });
}

/**
 * Ouvre une bouteille : elle quitte le stock et rejoint le journal des
 * dégustations. Quand la dernière part, la fiche passe en « terminé ».
 */
export function boireBouteille(id, details = {}) {
  const vin = trouverVin(id);
  if (!vin) return null;

  const emplacement = details.emplacement
    || EMPLACEMENTS.find((e) => vin.emplacements[e.cle] > 0)?.cle
    || '';
  const emplacements = { ...vin.emplacements };
  if (emplacement && emplacements[emplacement] > 0) {
    emplacements[emplacement] = emplacements[emplacement] - 1;
  }
  const quantite = Math.max(0, vin.quantite - 1);

  const degustation = normaliserDegustation({
    id: identifiant('t'),
    nom: vin.nom,
    producteur: vin.producteur,
    region: vin.region,
    cepage: vin.cepage,
    couleur: vin.couleur,
    millesime: vin.millesime,
    contexte: details.contexte || 'À la maison',
    lieu: details.lieu || '',
    date: details.date || aujourdhui(),
    notation: details.notation ?? null,
    commentaire: details.commentaire || '',
    // Une photo prise au moment de boire l'emporte sur l'étiquette de la fiche.
    photo: details.photoLocale ? '' : vin.photo,
    photoLocale: details.photoLocale || vin.photoLocale,
    vinId: vin.id,
    modifieLe: maintenant(),
  });
  etat.degustations.unshift(degustation);
  synchro.ecrireDegustation(degustation);

  modifierVin(id, {
    emplacements,
    quantite,
    statut: quantite === 0 ? 'termine' : 'en-cave',
    notation: details.notation ?? vin.notation,
  });
  return degustation;
}

/** Déplace des bouteilles d'un emplacement vers un autre. */
export function deplacerBouteilles(id, depuis, vers, nombre = 1) {
  const vin = trouverVin(id);
  if (!vin || depuis === vers) return vin;
  const disponible = vin.emplacements[depuis] || 0;
  const deplace = Math.min(entier(nombre, 0), disponible);
  if (deplace === 0) return vin;
  const emplacements = { ...vin.emplacements };
  emplacements[depuis] = disponible - deplace;
  emplacements[vers] = (emplacements[vers] || 0) + deplace;
  return modifierVin(id, { emplacements });
}

// --- actions sur les dégustations -------------------------------------------

export function ajouterDegustation(champs) {
  const degustation = normaliserDegustation({
    ...champs, id: identifiant('t'), modifieLe: maintenant(),
  });
  etat.degustations.unshift(degustation);
  enregistrer();
  synchro.ecrireDegustation(degustation);
  return degustation;
}

export function modifierDegustation(id, champs) {
  const index = etat.degustations.findIndex((d) => d.id === id);
  if (index === -1) return null;
  const degustation = normaliserDegustation({
    ...etat.degustations[index], ...champs, id, modifieLe: maintenant(),
  });
  etat.degustations[index] = degustation;
  enregistrer();
  synchro.ecrireDegustation(degustation);
  return degustation;
}

export function supprimerDegustation(id) {
  const degustation = trouverDegustation(id);
  if (!degustation) return false;
  // La photo locale n'est effacée que si aucune autre fiche ne l'utilise.
  if (degustation.photoLocale && !photoPartagee(degustation.photoLocale, id, null)) {
    photos.supprimer(degustation.photoLocale).catch(() => {});
  }
  etat.degustations = etat.degustations.filter((d) => d.id !== id);
  enregistrer();
  synchro.effacerDegustation(id);
  return true;
}

/** La photo `cle` sert-elle encore, en ignorant les fiches en cours de suppression ? */
function photoPartagee(cle, saufDegustation, saufVin) {
  return etat.vins.some((v) => v.photoLocale === cle && v.id !== saufVin)
    || etat.degustations.some((d) => d.photoLocale === cle && d.id !== saufDegustation);
}

// --- sauvegarde et restauration ---------------------------------------------

export async function exporterJson({ avecPhotos = true } = {}) {
  const clesPhotos = [...etat.vins, ...etat.degustations]
    .map((fiche) => fiche.photoLocale)
    .filter(Boolean);
  return {
    application: 'cave-a-vin',
    version: VERSION_DONNEES,
    exporteLe: new Date().toISOString(),
    vins: etat.vins,
    degustations: etat.degustations,
    photos: avecPhotos ? await photos.exporter(clesPhotos) : {},
  };
}

export async function importerJson(paquet) {
  if (!paquet || !Array.isArray(paquet.vins)) {
    throw new Error("Ce fichier ne contient pas de sauvegarde de la cave");
  }
  if (paquet.photos) await photos.importer(paquet.photos).catch(() => {});
  adopter(paquet);
  enregistrer();
  await synchro.remplacerTout(etat).catch(() => {});
  return { vins: etat.vins.length, degustations: etat.degustations.length };
}
