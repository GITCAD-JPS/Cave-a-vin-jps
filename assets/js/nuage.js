// Partage de la cave par une base de données en ligne.
//
// Ce module est l'un des deux transports de la synchronisation. Il parle
// directement à Firestore en HTTP, sans bibliothèque : une page statique peut
// ainsi partager une cave entre plusieurs appareils, sans serveur à tenir,
// sans compte à créer et sans connexion à demander.
//
// L'accès repose sur un code long et imprévisible qui fait partie du chemin
// des données. Qui ne l'a pas ne trouve rien, exactement comme un lien privé.
// C'est ce qui convient à une cave de particuliers, et il faut le savoir :
// quiconque obtient le code accède à la cave.

import { CONFIGURATION } from './nuage-configuration.js';

const COLLECTIONS = { vins: 'vins', degustations: 'degustations', apercus: 'apercus' };
const CLE_CODE = 'cave-a-vin.code.v1';

// Firestore n'offre pas d'écoute temps réel en HTTP simple. Plutôt que de
// relire toute la cave sans arrêt, on interroge un minuscule document témoin,
// mis à jour à chaque écriture. La cave entière n'est relue que lorsqu'il
// change, ce qui laisse le trafic à quelques centaines d'octets entre deux
// modifications réelles.
const TEMOIN = 'etat';
const PERIODE = 8000;

let code = null;
let rappels = {};
let etatCourant = 'recherche';
let minuteur = null;
let dernierTemoin = null;
const enAttente = [];

export const etat = () => etatCourant;
export const synchroActive = () => Boolean(code);
export const codeConfigure = () => lireCode();
export const configure = () => Boolean(CONFIGURATION.projet && CONFIGURATION.cle);

function changerEtat(valeur) {
  if (etatCourant === valeur) return;
  etatCourant = valeur;
  rappels.onEtat?.(valeur);
}

// --- code d'accès -----------------------------------------------------------

function lireCode() {
  try {
    return localStorage.getItem(CLE_CODE) || '';
  } catch {
    return '';
  }
}

/** Le code vit dans le navigateur : on le saisit une fois par appareil. */
export function enregistrerCode(valeur) {
  const propre = String(valeur || '').trim();
  try {
    if (propre) localStorage.setItem(CLE_CODE, propre);
    else localStorage.removeItem(CLE_CODE);
  } catch { /* la session tiendra quand même */ }
  code = propre || null;
  return code;
}

/** Un code neuf, assez long pour n'être ni deviné ni trouvé par balayage. */
export function inventerCode() {
  const octets = new Uint8Array(16);
  crypto.getRandomValues(octets);
  return [...octets].map((o) => o.toString(36).padStart(2, '0')).join('').slice(0, 24);
}

// --- dialogue avec Firestore ------------------------------------------------

const chemin = (...morceaux) => [
  CONFIGURATION.racine, 'projects', CONFIGURATION.projet, 'databases/(default)/documents',
  'caves', code, ...morceaux,
].join('/');

const avecCle = (url) => `${url}${url.includes('?') ? '&' : '?'}key=${CONFIGURATION.cle}`;

/**
 * Une fiche voyage comme une seule chaîne JSON.
 *
 * Firestore veut un type déclaré par champ, et la traduction d'une fiche
 * entière — nombres, textes, sous-objets d'emplacements — serait du code
 * fragile à écrire et à relire. Une chaîne unique évite tout cela : ce qui
 * part est exactement ce qui revient.
 */
const versDocument = (fiche) => ({
  fields: {
    donnees: { stringValue: JSON.stringify(fiche) },
    modifieLe: { stringValue: String(fiche.modifieLe || '') },
  },
});

function depuisDocument(document_) {
  try {
    return JSON.parse(document_?.fields?.donnees?.stringValue || 'null');
  } catch {
    return null;
  }
}

async function appeler(url, options = {}) {
  const reponse = await fetch(avecCle(url), options);
  if (!reponse.ok) throw new Error(`${reponse.status} ${reponse.statusText}`);
  return reponse.status === 204 ? null : reponse.json();
}

/**
 * Lit une collection entière, page après page.
 *
 * Le service décide seul du nombre de documents qu'il rend, et s'arrête bien
 * avant le millier demandé. S'en tenir à la première page aurait tronqué les
 * grandes caves en silence, et l'application aurait pris ce qui manquait pour
 * des fiches effacées.
 */
const lireCollection = async (collection) => {
  const fiches = [];
  let jeton = '';
  do {
    const suite = jeton ? `&pageToken=${encodeURIComponent(jeton)}` : '';
    const paquet = await appeler(`${chemin(collection)}?pageSize=300${suite}`);
    fiches.push(...(paquet?.documents || []).map(depuisDocument).filter(Boolean));
    jeton = paquet?.nextPageToken || '';
  } while (jeton);
  return fiches;
};

const ecrireFiche = (collection, fiche) => appeler(
  `${chemin(collection, fiche.id)}`,
  { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(versDocument(fiche)) },
);

const effacerFiche = (collection, id) => appeler(
  chemin(collection, id), { method: 'DELETE' },
);

/**
 * Marque la cave comme modifiée, pour que les autres appareils le sachent, et
 * rend l'heure posée. La retenir évite de reprendre toute la cave au sondage
 * suivant pour y retrouver ce qu'on vient d'y écrire soi-même.
 */
async function marquerTemoin() {
  const majLe = new Date().toISOString();
  try {
    await appeler(chemin('meta', TEMOIN), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { majLe: { stringValue: majLe } } }),
    });
    return majLe;
  } catch {
    // Sans témoin, les autres appareils l'apprendront à la prochaine écriture.
    return null;
  }
}

async function lireTemoin() {
  try {
    const paquet = await appeler(chemin('meta', TEMOIN));
    return paquet?.fields?.majLe?.stringValue || '';
  } catch (erreur) {
    // Un témoin absent est normal sur une cave qui vient de naître.
    if (String(erreur.message).startsWith('404')) return '';
    throw erreur;
  }
}

// --- mise en route ----------------------------------------------------------

/**
 * Se branche à la cave partagée si un code est enregistré sur cet appareil.
 *
 * Comme pour l'autre transport, la fusion d'arrivée n'envoie que les fiches
 * que le partage ignore ou qu'il connaît moins à jour. Un deuxième appareil
 * part du même classeur, avec les mêmes identifiants, et n'a donc rien à
 * apporter tant qu'il n'a rien modifié.
 */
export async function initialiser({ donneesLocales, onDonnees, onEtat }) {
  rappels = { onDonnees, onEtat };
  if (!configure()) {
    changerEtat('local');
    return false;
  }

  code = lireCode();
  if (!code) {
    changerEtat('sansCode');
    return false;
  }

  try {
    await fusionner(donneesLocales());
    await rapatrier();
    changerEtat('connecte');
  } catch (erreur) {
    console.info('Cave partagée injoignable', erreur);
    changerEtat('attente');
  }

  surveiller();
  addEventListener('online', () => rejouer());
  return true;
}

async function fusionner(locales) {
  const [distantsVins, distantesDegustations] = await Promise.all([
    lireCollection(COLLECTIONS.vins),
    lireCollection(COLLECTIONS.degustations),
  ]);
  const vide = !distantsVins.length && !distantesDegustations.length;

  const envois = [
    ...aEnvoyer(locales.vins, distantsVins, vide)
      .map((vin) => ecrireFiche(COLLECTIONS.vins, vin)),
    ...aEnvoyer(locales.degustations, distantesDegustations, vide)
      .map((d) => ecrireFiche(COLLECTIONS.degustations, d)),
  ];
  // Une cave qui vient de naître n'a pas de témoin, et chaque sondage le
  // redemanderait en vain. On le pose tout de suite, même sans rien à envoyer.
  if (!envois.length) {
    if (vide) await marquerTemoin();
    return;
  }
  await Promise.all(envois);
  await marquerTemoin();
}

/** Fiches que le partage ignore, ou qu'il connaît moins à jour. */
function aEnvoyer(locales, distantes, vide) {
  if (vide) return locales;
  const connues = new Map(distantes.map((f) => [f.id, f.modifieLe || '']));
  return locales.filter((fiche) => (
    !connues.has(fiche.id) || (fiche.modifieLe || '') > connues.get(fiche.id)
  ));
}

/** Relit la cave entière et la donne à l'application. */
async function rapatrier() {
  const [vins, degustations] = await Promise.all([
    lireCollection(COLLECTIONS.vins),
    lireCollection(COLLECTIONS.degustations),
  ]);
  rappels.onDonnees?.('vins', vins);
  rappels.onDonnees?.('degustations', degustations);
  dernierTemoin = await lireTemoin();
}

/**
 * Guette les modifications venues de l'autre appareil.
 *
 * Seul le document témoin est interrogé, quelques centaines d'octets. La cave
 * n'est relue que lorsqu'il a changé, donc jamais tant que personne ne touche
 * à rien.
 */
function surveiller() {
  clearInterval(minuteur);
  // Une cave garnie sur un réseau lent peut mettre plus de huit secondes à
  // revenir. Sans ce garde-fou, deux relectures se chevaucheraient et la plus
  // ancienne pourrait s'appliquer en dernier.
  let occupe = false;
  minuteur = setInterval(async () => {
    if (occupe) return;
    occupe = true;
    try {
      const temoin = await lireTemoin();
      changerEtat('connecte');
      rejouer();
      if (temoin === dernierTemoin) return;
      dernierTemoin = temoin;
      await rapatrier();
    } catch (erreur) {
      console.info('Cave partagée silencieuse', erreur);
      changerEtat('attente');
    } finally {
      occupe = false;
    }
  }, PERIODE);
}

export function arreter() {
  clearInterval(minuteur);
  minuteur = null;
}

// --- écritures --------------------------------------------------------------

/** Pousse une modification, ou la met de côté si la cave ne répond pas. */
function pousser(collection, fiche, suppression = false) {
  if (!code) return;
  const operation = { collection, fiche, suppression };
  const promesse = suppression
    ? effacerFiche(collection, fiche.id)
    : ecrireFiche(collection, fiche);

  promesse
    .then(() => marquerTemoin())
    .then((pose) => { if (pose) dernierTemoin = pose; changerEtat('connecte'); })
    .catch((erreur) => {
      console.info('Modification mise de côté', erreur);
      const index = enAttente.findIndex(
        (o) => o.collection === collection && o.fiche.id === fiche.id,
      );
      if (index === -1) enAttente.push(operation);
      else enAttente[index] = operation;
      changerEtat('attente');
    });
}

/** Rejoue ce qui attend. Ce qui échoue encore retourne dans la file. */
function rejouer() {
  if (!code || !enAttente.length) return;
  for (const { collection, fiche, suppression } of enAttente.splice(0)) {
    pousser(collection, fiche, suppression);
  }
}

export const ecrireVin = (vin) => pousser(COLLECTIONS.vins, vin);
export const effacerVin = (id) => pousser(COLLECTIONS.vins, { id }, true);
export const ecrireDegustation = (d) => pousser(COLLECTIONS.degustations, d);
export const effacerDegustation = (id) => pousser(COLLECTIONS.degustations, { id }, true);

// --- aperçus de photos ------------------------------------------------------

export function ecrireApercu(cle, image) {
  if (!code) return Promise.resolve();
  return appeler(chemin(COLLECTIONS.apercus, cle), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { image: { stringValue: image } } }),
  });
}

export async function lireApercu(cle) {
  if (!code) return '';
  try {
    const paquet = await appeler(chemin(COLLECTIONS.apercus, cle));
    return paquet?.fields?.image?.stringValue || '';
  } catch {
    return '';
  }
}

/** Les clés des aperçus déposés, sans rapatrier les images elles-mêmes. */
async function lireApercus() {
  const cles = [];
  let jeton = '';
  do {
    const suite = jeton ? `&pageToken=${encodeURIComponent(jeton)}` : '';
    const paquet = await appeler(
      `${chemin(COLLECTIONS.apercus)}?pageSize=300&mask.fieldPaths=id${suite}`,
    );
    cles.push(...(paquet?.documents || []).map((d) => d.name.split('/').pop()));
    jeton = paquet?.nextPageToken || '';
  } while (jeton);
  return cles;
}

export function effacerApercu(cle) {
  if (!code) return Promise.resolve();
  return appeler(chemin(COLLECTIONS.apercus, cle), { method: 'DELETE' }).catch(() => {});
}

/** Remplace tout le contenu partagé, après une restauration ou une remise à zéro. */
export async function remplacerTout({ vins, degustations }) {
  if (!code) return;
  const [ancienVins, ancienDegustations, anciensApercus] = await Promise.all([
    lireCollection(COLLECTIONS.vins),
    lireCollection(COLLECTIONS.degustations),
    lireApercus(),
  ]);
  const gardes = new Set([...vins, ...degustations].map((f) => f.id));
  // Un aperçu que plus aucune fiche ne réclame n'a plus de raison d'occuper
  // une place : vider la cave doit aussi emporter ses images.
  const photosGardees = new Set([...vins, ...degustations]
    .map((f) => f.photoLocale).filter(Boolean));

  await Promise.all([
    ...ancienVins.filter((f) => !gardes.has(f.id))
      .map((f) => effacerFiche(COLLECTIONS.vins, f.id).catch(() => {})),
    ...ancienDegustations.filter((f) => !gardes.has(f.id))
      .map((f) => effacerFiche(COLLECTIONS.degustations, f.id).catch(() => {})),
    ...anciensApercus.filter((cle) => !photosGardees.has(cle))
      .map((cle) => effacerApercu(cle)),
    ...vins.map((v) => ecrireFiche(COLLECTIONS.vins, v).catch(() => {})),
    ...degustations.map((d) => ecrireFiche(COLLECTIONS.degustations, d).catch(() => {})),
  ]);
  await marquerTemoin();
}
