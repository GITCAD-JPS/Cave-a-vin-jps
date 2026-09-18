// Lecture d'une photo d'étiquette et rapprochement avec la cave.
//
// La reconnaissance de texte tourne entièrement dans le navigateur, par
// Tesseract embarqué sous assets/vendor/tesseract. Rien n'est envoyé nulle
// part, et rien n'est chargé depuis un site tiers : la lecture fonctionne
// donc hors ligne dans la cave, et aucun hébergeur ne peut la bloquer.
//
// Une étiquette de vin reste un exercice difficile pour un moteur de texte :
// le résultat sert à proposer, jamais à décider. Tout reste corrigeable, et
// si le moteur ne peut pas démarrer, les parcours photo fonctionnent quand
// même, sans préremplissage.

import { sansAccent } from './model.js';

const DOSSIER = 'assets/vendor/tesseract';
const SOURCE_TESSERACT = `${DOSSIER}/tesseract.min.js`;
const LANGUES = ['fra', 'ita'];
// Le moteur charge un ouvrier, un cœur WebAssembly et ses données de langue.
// Même servis depuis le même site, cela peut échouer : ce délai garantit
// qu'on rend la main plutôt que de laisser tourner indéfiniment.
const DELAI_MAX = 45000;
// Mesuré sur un lot de photos d'étiquettes prises comme on le fait vraiment :
// au-delà, la lecture ne s'améliore pas, et se dégrade même. Le moteur
// travaille sur une hauteur de ligne normalisée, lui donner plus de pixels ne
// lui apprend rien de plus.
const COTE_LECTURE = 1400;

let chargement = null;
let indisponible = false;
const languesChargees = new Map();

/** La lecture a-t-elle déjà échoué au point de ne plus valoir la peine ? */
export const lectureIndisponible = () => indisponible;

function chargerMoteur() {
  if (chargement) return chargement;
  chargement = new Promise((resoudre, rejeter) => {
    if (globalThis.Tesseract) {
      resoudre(globalThis.Tesseract);
      return;
    }
    const balise = document.createElement('script');
    balise.src = SOURCE_TESSERACT;
    balise.async = true;
    balise.onload = () => (globalThis.Tesseract
      ? resoudre(globalThis.Tesseract)
      : rejeter(new Error('Moteur de lecture introuvable')));
    balise.onerror = () => rejeter(new Error('Moteur de lecture inaccessible'));
    document.head.append(balise);
  });
  chargement.catch(() => { chargement = null; });
  return chargement;
}

/**
 * Charge les données d'une langue et rend ce que le moteur attend.
 *
 * Elles sont stockées en base64 dans du JSON plutôt qu'en `.traineddata.gz`
 * brut : certains hébergeurs ne servent que les types web usuels et refusent
 * les binaires. Les octets sont fournis directement au moteur, ce qui évite
 * de lui faire télécharger quoi que ce soit.
 */
async function chargerLangue(code) {
  if (languesChargees.has(code)) return languesChargees.get(code);
  const reponse = await fetch(`${DOSSIER}/langues/${code}.traineddata.gz.json`);
  if (!reponse.ok) throw new Error(`langue ${code} introuvable (${reponse.status})`);
  const base64 = await reponse.json();
  const binaire = atob(base64);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i += 1) octets[i] = binaire.charCodeAt(i);
  const langue = { code, data: octets };
  languesChargees.set(code, langue);
  return langue;
}

/**
 * Lit le texte d'une photo d'étiquette.
 * `onProgres` reçoit une fraction entre 0 et 1.
 * Renvoie null si la lecture n'a pas pu se faire, sans jamais rester en plan.
 */
/**
 * Remet la photo dans un état que le moteur sait lire.
 *
 * Deux pièges propres aux téléphones, invisibles l'un comme l'autre : une
 * photo prise verticalement porte son orientation dans ses métadonnées, et un
 * iPhone livre parfois du HEIC, que le moteur ne décode pas. Dans les deux cas
 * il ne rend rien, sans dire pourquoi. Repasser par le navigateur, qui sait
 * décoder et redresser, écarte les deux, et lève franchement s'il ne peut pas.
 *
 * La taille est ramenée à `COTE_LECTURE`, mesuré comme le meilleur compromis :
 * au-delà, la lecture ne s'améliore pas et se dégrade même.
 */
async function normaliser(image) {
  if (!(image instanceof Blob)) return image;
  const bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' })
    .catch(() => createImageBitmap(image))
    .catch(() => null);
  if (!bitmap) throw new Error('photo illisible par le navigateur');

  const source = Math.max(bitmap.width, bitmap.height) || 1;
  const facteur = Math.min(1, COTE_LECTURE / source);
  const toile = document.createElement('canvas');
  toile.width = Math.max(1, Math.round(bitmap.width * facteur));
  toile.height = Math.max(1, Math.round(bitmap.height * facteur));
  const contexte = toile.getContext('2d');
  if (!contexte) return image;
  contexte.drawImage(bitmap, 0, 0, toile.width, toile.height);
  if (bitmap.close) bitmap.close();

  const prete = await new Promise((r) => toile.toBlob(r, 'image/jpeg', 0.9));
  return prete || image;
}

export async function lireEtiquette(image, { onProgres } = {}) {
  let ouvrier = null;
  let minuteur = null;

  const reconnaitre = async () => {
    const [moteur, ...langues] = await Promise.all([
      chargerMoteur(),
      ...LANGUES.map(chargerLangue),
    ]);
    // Tout vient du dossier embarqué. `corePath` désigne le dossier :
    // Tesseract y choisit lui-même la variante SIMD ou son repli. Les
    // données de langue lui sont passées telles quelles, il n'a donc rien à
    // aller chercher ni à mettre dans son propre cache.
    ouvrier = await moteur.createWorker(langues, 1, {
      workerPath: `${DOSSIER}/worker.min.js`,
      corePath: DOSSIER,
      cacheMethod: 'none',
      logger: (etat) => {
        if (etat.status === 'recognizing text' && onProgres) onProgres(etat.progress);
      },
    });
    const { data } = await ouvrier.recognize(await normaliser(image));
    return { texte: data.text || '', confiance: data.confidence ?? 0 };
  };

  const delai = new Promise((_, rejeter) => {
    minuteur = setTimeout(() => rejeter(new Error('délai dépassé')), DELAI_MAX);
  });

  try {
    return await Promise.race([reconnaitre(), delai]);
  } catch (erreur) {
    console.info("Lecture de l'étiquette impossible", erreur);
    indisponible = true;
    return null;
  } finally {
    clearTimeout(minuteur);
    if (ouvrier) ouvrier.terminate().catch(() => {});
  }
}

// --- extraction des champs --------------------------------------------------

const ANNEE_MIN = 1900;
const ANNEE_MAX = new Date().getFullYear() + 1;

/** Champs reconnaissables sans ambiguïté dans le texte d'une étiquette. */
export function extraireChamps(texte) {
  const brut = String(texte || '');
  const champs = {};

  const annees = [...brut.matchAll(/\b(1[89]\d{2}|20\d{2})\b/g)]
    .map((t) => Number(t[1]))
    .filter((a) => a >= ANNEE_MIN && a <= ANNEE_MAX);
  if (annees.length) champs.millesime = Math.max(...annees);

  const degre = brut.match(/(\d{1,2})[.,](\d)\s*%|\b(\d{1,2})\s*%\s*vol/i);
  if (degre) {
    champs.degre = degre[1] ? Number(`${degre[1]}.${degre[2]}`) : Number(degre[3]);
    if (champs.degre < 4 || champs.degre > 22) delete champs.degre;
  }

  const volume = brut.match(/\b(\d{2,4})\s*(cl|ml|l)\b/i);
  if (volume) {
    const nombre = Number(volume[1]);
    const unite = volume[2].toLowerCase();
    const centilitres = unite === 'ml' ? nombre / 10 : unite === 'l' ? nombre * 100 : nombre;
    if (centilitres >= 18 && centilitres <= 600) {
      champs.volume = centilitres === 150 ? '150 cl (Magnum)' : `${centilitres} cl`;
    }
  }

  champs.lignes = lignesCandidates(brut);
  return champs;
}

const BRUIT = new Set(['vino', 'vin', 'wine', 'rosso', 'bianco', 'rouge', 'blanc',
  'doc', 'docg', 'igt', 'igp', 'aoc', 'aop', 'italia', 'italy', 'france', 'produce',
  'imbottigliato', 'mis', 'bouteille', 'contient', 'sulfites', 'contains', 'vol',
  'product', 'of', 'des', 'les', 'del', 'della', 'di', 'da', 'the', 'and', 'et']);

/** Lignes du texte assez substantielles pour servir de nom ou de producteur. */
function lignesCandidates(texte) {
  return texte
    .split(/\r?\n/)
    .map((ligne) => ligne.replace(/[^\p{L}\p{N}'’&.\- ]/gu, ' ').replace(/\s+/g, ' ').trim())
    .filter((ligne) => {
      if (ligne.length < 4 || ligne.length > 60) return false;
      const mots = ligne.split(' ').filter((m) => m.length > 2);
      if (!mots.length) return false;
      return mots.some((m) => !BRUIT.has(sansAccent(m)));
    })
    .slice(0, 12);
}

// --- rapprochement avec la cave ---------------------------------------------

const MOTS_IGNORES = new Set([...BRUIT, 'cave', 'domaine', 'chateau', 'tenuta',
  'azienda', 'agricola', 'cantina', 'societa', 'srl', 'spa', 'sas', 'classico',
  'superiore', 'riserva', 'reserve', 'grand', 'cru', 'selection']);

function jetons(texte) {
  return new Set(
    sansAccent(texte)
      .split(/[^a-z0-9]+/)
      .filter((mot) => mot.length >= 4 && !MOTS_IGNORES.has(mot)),
  );
}

/**
 * Classe les vins de `candidats` par ressemblance avec le texte lu.
 * Le score est la part des jetons du vin retrouvés dans le texte, augmentée
 * quand le millésime concorde.
 */
export function rapprocher(texte, candidats, { millesime = null, minimum = 0.2 } = {}) {
  const lus = jetons(texte);
  if (!lus.size) return [];

  return candidats
    .map((vin) => {
      const attendus = jetons(`${vin.nom} ${vin.producteur} ${vin.region} ${vin.cepage}`);
      if (!attendus.size) return null;

      const communs = [...attendus].filter((mot) => lus.has(mot));
      // Un millésime qui concorde conforte une ressemblance, il n'en crée
      // jamais une : sans mot commun, le vin n'est pas un candidat.
      if (!communs.length) return null;
      // Un mot du nom pèse plus qu'un mot de la région : on repère lesquels.
      const motsDuNom = jetons(vin.nom);
      const poids = communs.reduce((total, mot) => total + (motsDuNom.has(mot) ? 2 : 1), 0);
      const maximum = [...attendus].reduce((total, mot) => total + (motsDuNom.has(mot) ? 2 : 1), 0);
      let score = maximum ? poids / maximum : 0;

      if (millesime && vin.millesime === millesime) score += 0.25;
      else if (millesime && vin.millesime && vin.millesime !== millesime) score -= 0.15;

      return { vin, score: Math.min(1, score), motsCommuns: communs };
    })
    .filter((e) => e && e.score >= minimum)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

/** Nom le plus plausible parmi les lignes lues, une fois le bruit écarté. */
export function nomProbable(lignes = []) {
  const notees = lignes.map((ligne) => {
    const mots = ligne.split(' ');
    const utiles = mots.filter((m) => m.length > 3 && !MOTS_IGNORES.has(sansAccent(m)));
    const majuscules = mots.filter((m) => m === m.toUpperCase() && /\p{L}/u.test(m)).length;
    return { ligne, score: utiles.length * 2 + majuscules + Math.min(ligne.length, 30) / 30 };
  });
  notees.sort((a, b) => b.score - a.score);
  return notees[0]?.ligne || '';
}
