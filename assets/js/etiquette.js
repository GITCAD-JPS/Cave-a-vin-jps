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
import { lireParGoogle } from './vision.js';

const DOSSIER = 'assets/vendor/tesseract';
const SOURCE_TESSERACT = `${DOSSIER}/tesseract.min.js`;
const LANGUES = ['fra', 'ita'];
// Le moteur charge un ouvrier, un cœur WebAssembly et ses données de langue.
// Même servis depuis le même site, cela peut échouer : ce délai garantit
// qu'on rend la main plutôt que de laisser tourner indéfiniment.
const DELAI_MAX = 45000;
// Une photo de plus ne doit pas faire expirer le lot entier.
const DELAI_PAR_PHOTO = 20000;
// Ce qui compte n'est pas la taille de la photo, mais celle des lettres une
// fois la photo réduite. Sur un gros plan d'étiquette, 1400 px suffisaient. Sur
// une bouteille entière photographiée en portrait, l'étiquette n'occupe qu'une
// petite part du cadre, et 1400 px la rendaient illisible. Mesuré sur un lot
// mêlant les deux cadrages : 1400 px lit 78 % des mots, 2000 px en lit 88 %, et
// monter plus haut redescend à 86 % puis 81 %.
const COTE_LECTURE = 2000;
// Une étiquette n'est pas une page de texte : quelques lignes centrées, de
// tailles très différentes, sans colonnes ni paragraphes. Chercher une mise en
// page fait perdre 8 points sur le lot d'essai, et les photos sombres ne
// rendent alors plus rien du tout. Le moteur embarqué traite déjà l'image
// comme un bloc unique de lui-même, ce réglage ne fait que le garantir si son
// défaut venait à changer.
const DECOUPAGE_BLOC = '6';

let chargement = null;
let indisponible = false;
let derniereRaison = '';
const languesChargees = new Map();

/** La lecture a-t-elle déjà échoué au point de ne plus valoir la peine ? */
export const lectureIndisponible = () => indisponible;

/**
 * Pourquoi la lecture améliorée n'a pas servi la dernière fois.
 *
 * Un repli silencieux laisserait croire que la clé fonctionne alors qu'elle
 * est refusée. Le parcours photo s'en sert pour le dire une fois.
 */
export const raisonDuRepli = () => derniereRaison;

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
 * Lit le texte d'une ou plusieurs photos d'étiquette.
 *
 * Les deux faces d'une bouteille se complètent : l'avant porte le nom en
 * grandes lettres courbées, que le moteur lit mal, l'arrière porte les mêmes
 * mots en petit et bien droit, avec en prime le degré et le volume. Mesuré sur
 * une vraie bouteille : l'avant seul rend 2 mots attendus sur 8, l'arrière
 * seul 5, les deux ensemble 6.
 *
 * `onProgres` reçoit une fraction entre 0 et 1, sur l'ensemble des photos.
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
 * assez de pixels pour les étiquettes photographiées de loin, sans les
 * artefacts que le moteur récolte au-delà.
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

export async function lireEtiquette(images, { onProgres, cleVision = '' } = {}) {
  const photos = (Array.isArray(images) ? images : [images]).filter(Boolean);
  if (!photos.length) return null;

  // Quand une clé a été déposée, on demande d'abord au service de Google, seul
  // capable de lire un nom écrit en arc de cercle. Tout ce qui peut échouer
  // ailleurs — réseau coupé, clé expirée, quota atteint — retombe sur le
  // moteur embarqué, qui lui ne dépend de rien.
  if (cleVision) {
    if (onProgres) onProgres(0.35);
    try {
      const lecture = await lireParGoogle(photos, cleVision);
      if (onProgres) onProgres(1);
      return { ...lecture, parGoogle: true };
    } catch (erreur) {
      console.info('Lecture par Google impossible, repli sur le moteur embarqué', erreur);
      derniereRaison = erreur?.message || '';
      if (onProgres) onProgres(0);
    }
  }

  let ouvrier = null;
  let minuteur = null;

  let lues = 0;
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
        if (etat.status !== 'recognizing text' || !onProgres) return;
        onProgres((lues + etat.progress) / photos.length);
      },
    });
    await ouvrier.setParameters({ tessedit_pageseg_mode: DECOUPAGE_BLOC });

    // Plusieurs photos passent par le même ouvrier : le charger coûte bien
    // plus cher que de lire une image de plus.
    const morceaux = [];
    let confiance = 0;
    for (const photo of photos) {
      const { data } = await ouvrier.recognize(await normaliser(photo));
      if (data.text) morceaux.push(data.text);
      confiance = Math.max(confiance, data.confidence ?? 0);
      lues += 1;
    }
    return { texte: morceaux.join('\n'), confiance, parGoogle: false };
  };

  const delai = new Promise((_, rejeter) => {
    const attente = DELAI_MAX + DELAI_PAR_PHOTO * (photos.length - 1);
    minuteur = setTimeout(() => rejeter(new Error('délai dépassé')), attente);
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

// Mentions imposées et phrases de description. Elles portent souvent le nom
// du domaine — « mis en bouteille au domaine par Gérard Bertrand » — et
// gagnaient donc contre le vrai nom, plus court. Ce sont des tournures, pas
// des mots isolés : c'est la tournure entière qui disqualifie la ligne.
const MENTIONS = [
  /mis\s+en\s+bouteille/i, /imbottigliato/i, /bottled\s+(by|at)/i,
  /appellation/i, /origine\s+(prot|contr)/i, /denominazione/i,
  /produit\s+de/i, /product\s+of/i, /prodotto/i,
  /contient/i, /contains/i, /sulfit/i, /solfit/i, /sulphit/i,
  /agricultur/i, /biolog/i, /demeter/i,
  /est\s+situ/i, /is\s+located/i, /se\s+servir/i, /can\s+be\s+served/i,
  /%\s*vol/i, /\b\d{2,4}\s*(ml|cl)\b/i,
];

// Un nom de domaine coupé en deux par la mise en page : « DOMAINE » puis
// « DE VILLEMAJOU ». La seconde ligne commence par une particule et ne se
// tient pas debout toute seule.
const PARTICULE = /^(de|du|des|d'|d’|la|le|les|dei|della|di)\s/i;

/** Lignes du texte assez substantielles pour servir de nom ou de producteur. */
function lignesCandidates(texte) {
  const brutes = texte
    .split(/\r?\n/)
    .map((ligne) => ligne.replace(/[^\p{L}\p{N}'’&.\- ]/gu, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  // Recoller les suites avant de trier : « DE VILLEMAJOU » seul ne dit rien.
  const recollees = [];
  for (const ligne of brutes) {
    const precedente = recollees[recollees.length - 1];
    if (precedente && PARTICULE.test(ligne) && `${precedente} ${ligne}`.length <= 60) {
      recollees[recollees.length - 1] = `${precedente} ${ligne}`;
    } else {
      recollees.push(ligne);
    }
  }

  return recollees
    .filter((ligne) => {
      if (ligne.length < 4 || ligne.length > 60) return false;
      if (MENTIONS.some((motif) => motif.test(ligne))) return false;
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
/**
 * La ligne qui a le plus de chances d'être le nom du vin.
 *
 * Le nom est écrit en grand sur le haut de la face avant, donc tôt dans le
 * texte lu, et il tient en quelques mots. Compter les majuscules et la
 * longueur faisait au contraire gagner les mentions légales, plus bavardes.
 */
// « Domaine », « Château », « Tenuta » ne distinguent aucun vin d'un autre, et
// sont donc ignorés au moment de rapprocher. Mais une ligne qui commence par
// l'un d'eux est presque toujours le nom du vin, et c'est ce qu'on cherche ici.
const MARQUEURS_NOM = /^(domaine|chateau|château|clos|mas|maison|cave|caves|casa|cascina|tenuta|castello|azienda|cantina|bodega|weingut|quinta|finca|podere|villa|abbaye|manoir)\b/i;

export function nomProbable(lignes = []) {
  const notees = lignes.map((ligne, rang) => {
    const mots = ligne.split(' ');
    const utiles = mots.filter((m) => m.length > 3 && !MOTS_IGNORES.has(sansAccent(m)));
    const capitales = mots.filter((m) => m === m.toUpperCase() && /\p{L}/u.test(m)).length;
    return {
      ligne,
      score: utiles.length * 2
        // Une ligne toute en capitales est un titre, une ligne à moitié en
        // capitales est une phrase qui en contient.
        + (mots.length && capitales === mots.length ? 2 : 0)
        // Ce qui est lu en premier vient du haut de la face avant.
        + Math.max(0, 3 - rang * 0.5)
        + (MARQUEURS_NOM.test(ligne) ? 3 : 0)
        // Passé quelques mots, on n'est plus devant un nom.
        - Math.max(0, mots.length - 5) * 1.5,
    };
  });
  notees.sort((a, b) => b.score - a.score);
  return notees[0]?.ligne || '';
}
