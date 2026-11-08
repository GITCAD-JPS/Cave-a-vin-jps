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
import { clesPhotos } from './model.js';

const COLLECTIONS = { vins: 'vins', degustations: 'degustations', apercus: 'apercus' };
const CLE_CODE = 'cave-a-vin.code.v1';

// Firestore n'offre pas d'écoute temps réel en HTTP simple. Plutôt que de
// relire toute la cave sans arrêt, on interroge un minuscule document témoin,
// mis à jour à chaque écriture. La cave entière n'est relue que lorsqu'il
// change, ce qui laisse le trafic à quelques centaines d'octets entre deux
// modifications réelles.
const TEMOIN = 'etat';
// Une remise à zéro (cave vidée, sauvegarde restaurée) se signale à part : le
// témoin, réécrit en entier à chaque modification, ne saurait la retenir.
const REMISE = 'remise';
const PERIODE = 8000;

// Ce qui doit survivre à la fermeture de l'application, qu'iOS décide seul :
// les modifications pas encore parties, une remise à zéro pas encore publiée,
// et les fiches déjà vues dans la cave partagée.
const CLE_ATTENTE = 'cave-a-vin.attente.v1';
const CLE_REMPLACEMENT = 'cave-a-vin.remplacement.v1';
const CLE_CONNUS = 'cave-a-vin.connus.v1';

let code = null;
let rappels = {};
let etatCourant = 'recherche';
let minuteur = null;
let dernierTemoin = null;
const enAttente = [];
const enVol = new Set();

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

function lireJson(cle) {
  try {
    return JSON.parse(localStorage.getItem(cle) || 'null');
  } catch {
    return null;
  }
}

function ecrireJson(cle, valeur) {
  try {
    if (valeur === null) localStorage.removeItem(cle);
    else localStorage.setItem(cle, JSON.stringify(valeur));
  } catch { /* la session tiendra quand même */ }
}

/**
 * Ce que cet appareil sait de la cave partagée : les fiches qu'il y a déjà
 * vues, et la dernière remise à zéro dont il a pris acte.
 *
 * Sans cette mémoire, une fiche absente du partage ne se distingue pas d'une
 * fiche effacée ailleurs. Un téléphone resté fermé pendant qu'on supprimait un
 * vin, ou qu'on vidait la cave, renvoyait tout à sa réouverture, et ce qui
 * avait été effacé revenait sur tous les appareils.
 */
function lireConnus() {
  const lu = lireJson(CLE_CONNUS);
  if (lu && lu.code === code) return lu;
  return { code, vins: [], degustations: [], synchronise: false, remiseVue: '' };
}

function noterConnus(modifications) {
  ecrireJson(CLE_CONNUS, { ...lireConnus(), ...modifications, code });
}

function connaitre(collection, id, present) {
  if (collection !== COLLECTIONS.vins && collection !== COLLECTIONS.degustations) return;
  const connus = lireConnus();
  const ids = new Set(connus[collection]);
  if (present) ids.add(id);
  else ids.delete(id);
  noterConnus({ [collection]: [...ids] });
}

/** La file des modifications pas encore parties, gardée dans le téléphone. */
function sauverAttente() {
  ecrireJson(CLE_ATTENTE, enAttente.length
    ? { code, operations: enAttente.map(({ collection, fiche, suppression }) => ({ collection, fiche, suppression })) }
    : null);
}

function chargerAttente() {
  const lu = lireJson(CLE_ATTENTE);
  enAttente.splice(0, enAttente.length, ...(lu && lu.code === code ? lu.operations || [] : []));
}

const remplacementEnAttente = () => lireJson(CLE_REMPLACEMENT)?.code === code;

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

async function lireRemise() {
  try {
    const paquet = await appeler(chemin('meta', REMISE));
    return paquet?.fields?.le?.stringValue || '';
  } catch (erreur) {
    if (String(erreur.message).startsWith('404')) return '';
    throw erreur;
  }
}

async function marquerRemise() {
  const le = new Date().toISOString();
  await appeler(chemin('meta', REMISE), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { le: { stringValue: le } } }),
  });
  return le;
}

/**
 * Une remise à zéro faite ailleurs rend caduques les modifications que cet
 * appareil n'avait pas encore pu envoyer : elles portaient sur la cave d'avant,
 * et les rejouer remettrait dans la cave vidée ce qu'on venait d'en ôter.
 */
async function abandonnerSiRemiseAilleurs() {
  if (!enAttente.length || remplacementEnAttente()) return;
  const connus = lireConnus();
  if (!connus.synchronise) return;
  const remise = await lireRemise();
  if (remise === connus.remiseVue) return;
  enAttente.splice(0);
  sauverAttente();
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

  rappels.donneesLocales = donneesLocales;
  chargerAttente();
  try {
    // Ce qui n'était pas parti avant la fermeture part d'abord, sans quoi la
    // relecture de la cave partagée l'effacerait d'ici.
    await abandonnerSiRemiseAilleurs();
    await rejouer();
    await fusionner(donneesLocales());
    await rapatrier();
    changerEtat(enAttente.length || remplacementEnAttente() ? 'attente' : 'connecte');
  } catch (erreur) {
    console.info('Cave partagée injoignable', erreur);
    changerEtat('attente');
  }

  surveiller();
  addEventListener('online', () => rejouer());
  return true;
}

async function fusionner(locales) {
  if (remplacementEnAttente()) return;
  const [distantsVins, distantesDegustations, remise] = await Promise.all([
    lireCollection(COLLECTIONS.vins),
    lireCollection(COLLECTIONS.degustations),
    lireRemise(),
  ]);
  const vide = !distantsVins.length && !distantesDegustations.length;
  const connus = lireConnus();

  // La cave a été vidée ou restaurée ailleurs depuis notre dernier passage :
  // elle fait foi, et ce que cet appareil en gardait ne doit pas y revenir.
  if (connus.synchronise && remise !== connus.remiseVue) return;

  const envois = [
    ...aEnvoyer(locales.vins, distantsVins, new Set(connus.vins))
      .map((vin) => ecrireFiche(COLLECTIONS.vins, vin)),
    ...aEnvoyer(locales.degustations, distantesDegustations, new Set(connus.degustations))
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

/**
 * Fiches à publier : celles que le partage connaît moins à jour, et celles
 * qu'il n'a jamais eues. Une fiche que cet appareil y avait déjà vue et qui
 * n'y est plus a été effacée ailleurs : elle ne repart pas.
 */
function aEnvoyer(locales, distantes, dejaVues) {
  const distantesParId = new Map(distantes.map((f) => [f.id, f.modifieLe || '']));
  return locales.filter((fiche) => (distantesParId.has(fiche.id)
    ? (fiche.modifieLe || '') > distantesParId.get(fiche.id)
    : !dejaVues.has(fiche.id)));
}

/** Relit la cave entière et la donne à l'application. */
async function rapatrier() {
  // Le témoin est lu avant la cave : une écriture faite pendant la relecture
  // sera vue au sondage suivant, au lieu d'être tenue pour déjà lue.
  const temoin = await lireTemoin();
  const [vins, degustations, remise] = await Promise.all([
    lireCollection(COLLECTIONS.vins),
    lireCollection(COLLECTIONS.degustations),
    lireRemise(),
  ]);
  rappels.onDonnees?.('vins', vins);
  rappels.onDonnees?.('degustations', degustations);
  dernierTemoin = temoin;
  noterConnus({
    vins: vins.map((f) => f.id),
    degustations: degustations.map((f) => f.id),
    synchronise: true,
    remiseVue: remise,
  });
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
      if (temoin !== dernierTemoin) await abandonnerSiRemiseAilleurs();
      await rejouer();
      changerEtat(enAttente.length || remplacementEnAttente() ? 'attente' : 'connecte');
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

/**
 * Relit toute la cave partagée, sur demande.
 *
 * Le sondage ne relit que lorsque le témoin a changé, ce qui est exactement
 * ce qu'il faut d'ordinaire. Mais si un appareil se retrouve pour une raison
 * quelconque avec une copie en retard, plus rien ne l'en sort tant que
 * personne ne touche à la cave. Ce bouton-là en sort.
 */
export async function recharger() {
  if (!code) throw new Error('aucune cave partagée sur cet appareil');
  await rapatrier();
  changerEtat('connecte');
}

export function arreter() {
  clearInterval(minuteur);
  minuteur = null;
}

// --- écritures --------------------------------------------------------------

/**
 * Pousse une modification.
 *
 * Elle est d'abord inscrite dans la file gardée par le téléphone, et n'en sort
 * qu'une fois arrivée : une suppression faite au sous-sol, puis l'application
 * fermée, partait autrefois avec la mémoire, et la fiche revenait.
 */
function pousser(collection, fiche, suppression = false) {
  if (!code) return;
  const operation = { collection, fiche, suppression };
  const index = enAttente.findIndex((o) => o.collection === collection && o.fiche.id === fiche.id);
  if (index === -1) enAttente.push(operation);
  else enAttente[index] = operation;
  sauverAttente();
  if (!remplacementEnAttente()) envoyer(operation);
}

async function envoyer(operation) {
  if (enVol.has(operation)) return;
  enVol.add(operation);
  const { collection, fiche, suppression } = operation;
  try {
    if (suppression) await effacerFiche(collection, fiche.id);
    else await ecrireFiche(collection, fiche);
    // Une modification plus récente de la même fiche a pu prendre sa place
    // dans la file entre-temps : celle-là reste à faire.
    const index = enAttente.indexOf(operation);
    if (index !== -1) { enAttente.splice(index, 1); sauverAttente(); }
    connaitre(collection, fiche.id, !suppression);
    // Le témoin n'est tenu pour lu que s'il n'avait pas bougé depuis le
    // dernier sondage. Sinon un autre appareil a écrit entre-temps, et ce
    // qu'il a fait doit être relu, pas recouvert.
    const avant = await lireTemoin().catch(() => null);
    const pose = await marquerTemoin();
    if (pose && avant === dernierTemoin) dernierTemoin = pose;
    if (!enAttente.length) changerEtat('connecte');
  } catch (erreur) {
    console.info('Modification mise de côté', erreur);
    changerEtat('attente');
  } finally {
    enVol.delete(operation);
  }
}

/**
 * Rejoue ce qui attend : une remise à zéro d'abord, qui rend caduc tout le
 * reste, puis les modifications une à une. Ce qui échoue reste dans la file.
 */
async function rejouer() {
  if (!code) return;
  if (remplacementEnAttente()) {
    try {
      await remplacerMaintenant(rappels.donneesLocales?.() || { vins: [], degustations: [] });
    } catch (erreur) {
      console.info('Remise à zéro toujours en attente', erreur);
      return;
    }
  }
  await Promise.all([...enAttente].map(envoyer));
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

/** Les clés des aperçus déjà déposés dans la cave partagée. */
export const clesApercus = () => (code ? lireApercus() : Promise.resolve([]));

export function effacerApercu(cle) {
  if (!code) return Promise.resolve();
  return appeler(chemin(COLLECTIONS.apercus, cle), { method: 'DELETE' }).catch(() => {});
}

/**
 * Remplace tout le contenu partagé, après une restauration ou une remise à zéro.
 *
 * Rend `{ publie }` : faux quand la cave partagée n'a pas pu être atteinte. La
 * remise reste alors inscrite dans le téléphone et sera rejouée au retour du
 * réseau, ou à la prochaine ouverture. Avant, l'échec était tu : l'écran disait
 * la cave vidée, et la relecture suivante la remplissait de nouveau.
 */
export async function remplacerTout(donnees) {
  if (!code) return { publie: true };
  ecrireJson(CLE_REMPLACEMENT, { code });
  try {
    await remplacerMaintenant(donnees);
    return { publie: true };
  } catch (erreur) {
    console.info('Remise à zéro mise de côté', erreur);
    changerEtat('attente');
    return { publie: false };
  }
}

async function remplacerMaintenant({ vins, degustations }) {
  const [ancienVins, ancienDegustations, anciensApercus] = await Promise.all([
    lireCollection(COLLECTIONS.vins),
    lireCollection(COLLECTIONS.degustations),
    lireApercus(),
  ]);
  const gardes = new Set([...vins, ...degustations].map((f) => f.id));
  // Un aperçu que plus aucune fiche ne réclame n'a plus de raison d'occuper
  // une place : vider la cave doit aussi emporter ses images.
  // Toutes les faces : la contre-étiquette, oubliée ici, perdait son aperçu
  // partagé à chaque restauration.
  const photosGardees = new Set([...vins, ...degustations].flatMap(clesPhotos));

  // Une fiche qui n'a pas pu être écrite ou effacée fait échouer le tout,
  // qui sera rejoué : chaque opération peut l'être sans dommage.
  await Promise.all([
    ...ancienVins.filter((f) => !gardes.has(f.id))
      .map((f) => effacerFiche(COLLECTIONS.vins, f.id)),
    ...ancienDegustations.filter((f) => !gardes.has(f.id))
      .map((f) => effacerFiche(COLLECTIONS.degustations, f.id)),
    ...anciensApercus.filter((cle) => !photosGardees.has(cle))
      .map((cle) => effacerApercu(cle)),
    ...vins.map((v) => ecrireFiche(COLLECTIONS.vins, v)),
    ...degustations.map((d) => ecrireFiche(COLLECTIONS.degustations, d)),
  ]);
  const remise = await marquerRemise();
  // Les modifications qui attendaient portaient sur l'état d'avant : la cave
  // qu'on vient de publier les contient déjà, ou les a écartées exprès.
  enAttente.splice(0);
  sauverAttente();
  ecrireJson(CLE_REMPLACEMENT, null);
  noterConnus({
    vins: vins.map((f) => f.id),
    degustations: degustations.map((f) => f.id),
    synchronise: true,
    remiseVue: remise,
  });
  const avant = await lireTemoin().catch(() => null);
  const pose = await marquerTemoin();
  if (pose && avant === dernierTemoin) dernierTemoin = pose;
}
