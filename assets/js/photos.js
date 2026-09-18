// Photos prises depuis l'application. Elles sont conservées en IndexedDB :
// une photo de téléphone pèse plusieurs centaines de kilo-octets, bien au-delà
// de ce que localStorage peut absorber. Les photos livrées avec le classeur
// restent, elles, de simples fichiers sous data/photos/.
//
// Certains navigateurs refusent IndexedDB à une page affichée dans un cadre
// d'un autre site, ou en navigation privée. Plutôt que de bloquer l'ajout
// d'un vin, on retombe alors sur une réserve en mémoire : les photos tiennent
// le temps de la session et l'application reste utilisable. `enMemoire()` dit
// si c'est le cas, pour prévenir honnêtement.

import * as synchro from './nuage.js';

const BASE = 'cave-a-vin';
const MAGASIN = 'photos';
const COTE_MAX = 1400;
const QUALITE = 0.82;
// Copie réduite qui voyage avec la cave quand le dépôt de l'hébergeur est
// fermé. C'est alors la seule image que voient les autres appareils, d'où une
// définition confortable. Elle vit dans son propre document, lu à la demande
// et jamais dans les instantanés, ce qui permet de ne pas la rogner.
const APERCU_COTE = 640;
const APERCU_QUALITE = 0.7;
// Une photo déposée chez l'hébergeur porte ce préfixe : elle suit alors la
// cave d'un appareil à l'autre, au lieu de rester dans un seul navigateur.
const PREFIXE_PARTAGE = 'a:';

let connexion = null;
let repliMemoire = false;
const memoire = new Map();

/** Lire `requete.error` lève quand la requête n'est pas terminée. */
function erreurDe(requete, defaut) {
  try {
    return requete.error || new Error(defaut);
  } catch {
    return new Error(defaut);
  }
}

export const enMemoire = () => repliMemoire;

let depotPartage;

/** Dépôt de fichiers de l'hébergeur, quand il en offre un. */
async function partage() {
  if (depotPartage !== undefined) return depotPartage;
  const use = globalThis.claude?.use;
  depotPartage = typeof use === 'function'
    ? await use('assets').catch(() => null)
    : null;
  return depotPartage;
}

const estPartagee = (cle) => String(cle || '').startsWith(PREFIXE_PARTAGE);
const identifiantPartage = (cle) => String(cle).slice(PREFIXE_PARTAGE.length);
const adressePartagee = (cle) => `/_blob/${identifiantPartage(cle)}`;

function ouvrir() {
  if (connexion) return connexion;
  connexion = new Promise((resoudre, rejeter) => {
    if (!('indexedDB' in globalThis) || !indexedDB) {
      rejeter(new Error('stockage des photos indisponible'));
      return;
    }
    let requete;
    try {
      requete = indexedDB.open(BASE, 1);
    } catch (erreur) {
      // Safari lève ici quand le stockage est refusé à la page.
      rejeter(erreur);
      return;
    }
    requete.onupgradeneeded = () => {
      const base = requete.result;
      if (!base.objectStoreNames.contains(MAGASIN)) base.createObjectStore(MAGASIN);
    };
    requete.onsuccess = () => resoudre(requete.result);
    requete.onerror = () => rejeter(erreurDe(requete, 'stockage refusé'));
    requete.onblocked = () => rejeter(new Error('stockage occupé'));
  });
  connexion.catch(() => { connexion = null; });
  return connexion;
}

function transaction(mode, action) {
  return ouvrir().then((base) => new Promise((resoudre, rejeter) => {
    let requete;
    try {
      const tx = base.transaction(MAGASIN, mode);
      requete = action(tx.objectStore(MAGASIN));
    } catch (erreur) {
      rejeter(erreur);
      return;
    }
    requete.onsuccess = () => resoudre(requete.result);
    requete.onerror = () => rejeter(erreurDe(requete, 'écriture refusée'));
  }));
}

/** Passe en réserve mémoire dès qu'IndexedDB se dérobe, une fois pour toutes. */
async function avecRepli(action, actionMemoire) {
  if (repliMemoire) return actionMemoire();
  try {
    return await action();
  } catch (erreur) {
    console.info('Photos conservées en mémoire seulement', erreur);
    repliMemoire = true;
    return actionMemoire();
  }
}

export const lire = (cle) => avecRepli(
  () => transaction('readonly', (m) => m.get(cle)),
  () => memoire.get(cle),
).then((blob) => blob ?? (estPartagee(cle) ? recupererPartagee(cle) : undefined));

/** Récupère une photo déposée chez l'hébergeur, pour la relire ou l'exporter. */
async function recupererPartagee(cle) {
  try {
    const reponse = await fetch(adressePartagee(cle));
    return reponse.ok ? await reponse.blob() : undefined;
  } catch {
    return undefined;
  }
}
export const ecrire = (cle, blob) => avecRepli(
  () => transaction('readwrite', (m) => m.put(blob, cle)),
  () => { memoire.set(cle, blob); },
);
export const supprimer = async (cle) => {
  if (estPartagee(cle)) {
    const depot = await partage();
    await depot?.delete(identifiantPartage(cle)).catch(() => {});
    return undefined;
  }
  await synchro.effacerApercu(cle).catch(() => {});
  return avecRepli(
    () => transaction('readwrite', (m) => m.delete(cle)),
    () => { memoire.delete(cle); },
  );
};
export const clefs = () => avecRepli(
  () => transaction('readonly', (m) => m.getAllKeys()),
  () => [...memoire.keys()],
);

/** Réduit une image choisie ou photographiée avant de la stocker. */
export async function redimensionner(fichier, cote = COTE_MAX, qualite = QUALITE) {
  const bitmap = await creerBitmap(fichier);
  const source = Math.max(bitmap.width || 0, bitmap.height || 0);
  if (!source) return fichier;

  const facteur = Math.min(1, cote / source);
  const largeur = Math.max(1, Math.round(bitmap.width * facteur));
  const hauteur = Math.max(1, Math.round(bitmap.height * facteur));

  const toile = document.createElement('canvas');
  toile.width = largeur;
  toile.height = hauteur;
  const contexte = toile.getContext('2d');
  if (!contexte) return fichier;
  contexte.drawImage(bitmap, 0, 0, largeur, hauteur);
  if (bitmap.close) bitmap.close();

  // toBlob rend null quand la conversion échoue : la photo d'origine fait
  // alors très bien l'affaire.
  const blob = await new Promise((r) => {
    try {
      toile.toBlob(r, 'image/jpeg', qualite);
    } catch {
      r(null);
    }
  });
  return blob || fichier;
}

/**
 * Décode une image en la remettant à l'endroit.
 *
 * Une photo prise verticalement porte son orientation dans ses métadonnées
 * plutôt que dans ses pixels, et les navigateurs ne s'accordent pas sur le
 * fait de l'appliquer d'eux-mêmes. Le demander explicitement coûte un mot et
 * évite une photo couchée, que le moteur de lecture ne déchiffrerait pas.
 */
function creerBitmap(fichier) {
  if ('createImageBitmap' in globalThis) {
    return createImageBitmap(fichier, { imageOrientation: 'from-image' })
      .catch(() => createImageBitmap(fichier));
  }
  return new Promise((resoudre, rejeter) => {
    const image = new Image();
    const url = URL.createObjectURL(fichier);
    image.onload = () => { URL.revokeObjectURL(url); resoudre(image); };
    image.onerror = () => { URL.revokeObjectURL(url); rejeter(new Error('Image illisible')); };
    image.src = url;
  });
}

// Les URL d'objet sont mises en cache : une même photo est affichée dans la
// liste, dans la fiche et dans le journal, sans recréer l'URL à chaque rendu.
const urls = new Map();

export async function url(cle) {
  if (!cle) return '';
  if (urls.has(cle)) return urls.get(cle);
  // Une sauvegarde restaurée peut avoir remis une photo partagée dans ce
  // navigateur : elle prime, elle est là et ne demande aucun réseau.
  const blob = await lire(cle).catch(() => null);
  if (blob) {
    const objet = URL.createObjectURL(blob);
    urls.set(cle, objet);
    return objet;
  }
  if (estPartagee(cle)) return adressePartagee(cle);

  // Photo prise sur un autre appareil, qui n'a pas pu la déposer chez
  // l'hébergeur : c'est sa copie réduite, arrivée avec la cave, qui s'affiche.
  const apercu = await synchro.lireApercu(cle).catch(() => '');
  if (apercu) urls.set(cle, apercu);
  return apercu;
}

export function oublier(cle) {
  const objet = urls.get(cle);
  if (objet) URL.revokeObjectURL(objet);
  urls.delete(cle);
}

export async function enregistrer(fichier) {
  // Une photo d'iPhone peut être en HEIC, très grande, ou refuser de se
  // décoder : on garde alors le fichier tel quel plutôt que d'abandonner.
  const blob = await redimensionner(fichier).catch((erreur) => {
    console.info('Photo conservée sans réduction', erreur);
    return fichier;
  });

  // Déposée chez l'hébergeur, la photo apparaît sur les autres appareils.
  // Sinon elle reste dans ce navigateur, ce qui vaut mieux que rien.
  const depot = await partage();
  if (depot) {
    try {
      const { id } = await depot.upload(blob);
      return `${PREFIXE_PARTAGE}${id}`;
    } catch (erreur) {
      console.info('Photo conservée dans cet appareil seulement', erreur);
    }
  }

  const cle = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await ecrire(cle, blob);
  await partagerApercu(cle, blob);
  return cle;
}

/**
 * Dépose une copie réduite de la photo dans la cave partagée.
 *
 * Elle n'a de sens que là : sans partage, personne n'a besoin de cette copie
 * et elle ne ferait qu'occuper de la place. Son échec ne remet rien en cause,
 * la photo d'origine est déjà rangée et le vin s'enregistre normalement.
 */
async function partagerApercu(cle, blob) {
  if (!synchro.synchroActive()) return;
  try {
    const reduite = await redimensionner(blob, APERCU_COTE, APERCU_QUALITE);
    const image = await versDataUrl(reduite);
    if (image) await synchro.ecrireApercu(cle, image);
  } catch (erreur) {
    console.info('Aperçu partagé non déposé', erreur);
  }
}

/**
 * Convertit les photos en data URL, pour la sauvegarde JSON.
 *
 * `clesUtilisees` vient des fiches : une photo déposée chez l'hébergeur
 * n'est pas dans ce navigateur, elle serait donc absente d'une sauvegarde
 * établie à partir du seul contenu local. Une photo prise sur un autre
 * appareil n'existe nulle part ici : sa copie réduite, elle, est à portée et
 * vaut mieux qu'un vin sans image.
 */
export async function exporter(clesUtilisees = []) {
  const locales = await clefs().catch(() => []);
  const paquet = {};
  for (const cle of new Set([...locales, ...clesUtilisees])) {
    if (!cle) continue;
    const blob = await lire(cle).catch(() => null);
    if (blob) paquet[cle] = await versDataUrl(blob);
    else {
      const apercu = await synchro.lireApercu(cle).catch(() => '');
      if (apercu) paquet[cle] = apercu;
    }
  }
  return paquet;
}

/** Restaure les photos d'une sauvegarde JSON. */
export async function importer(paquet = {}) {
  for (const [cle, dataUrl] of Object.entries(paquet)) {
    const blob = await depuisDataUrl(dataUrl);
    if (blob) await ecrire(cle, blob);
  }
}

export async function vider() {
  const liste = await clefs().catch(() => []);
  for (const cle of liste) {
    oublier(cle);
    await supprimer(cle);
  }
  memoire.clear();
}

function versDataUrl(blob) {
  return new Promise((resoudre) => {
    const lecteur = new FileReader();
    lecteur.onload = () => resoudre(lecteur.result);
    lecteur.onerror = () => resoudre('');
    lecteur.readAsDataURL(blob);
  });
}

async function depuisDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
  return fetch(dataUrl).then((r) => r.blob()).catch(() => null);
}
