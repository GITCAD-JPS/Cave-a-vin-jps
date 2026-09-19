// Modèle de données : normalisation des fiches, champs dérivés, recherche,
// filtrage, tri et statistiques. Aucun accès au DOM ni au stockage ici.

export const EMPLACEMENTS = [
  { cle: 'caveDroite', libelle: 'Cave droite', court: 'Droite' },
  { cle: 'caveGauche', libelle: 'Cave gauche', court: 'Gauche' },
  { cle: 'armoire', libelle: 'Armoire à vin', court: 'Armoire' },
];

export const COULEURS = [
  { cle: 'rouge', libelle: 'Rouge' },
  { cle: 'blanc', libelle: 'Blanc' },
  { cle: 'rose', libelle: 'Rosé' },
  { cle: 'petillant', libelle: 'Pétillant' },
  { cle: 'liquoreux', libelle: 'Liquoreux' },
  { cle: 'inconnu', libelle: 'À préciser' },
];

export const VOLUMES = ['37.5 cl', '50 cl', '70 cl', '75 cl', '100 cl', '150 cl (Magnum)'];

const LIBELLE_COULEUR = new Map(COULEURS.map((c) => [c.cle, c.libelle]));
const LIBELLE_EMPLACEMENT = new Map(EMPLACEMENTS.map((e) => [e.cle, e.libelle]));

export const libelleCouleur = (cle) => LIBELLE_COULEUR.get(cle) || 'À préciser';
export const libelleEmplacement = (cle) => LIBELLE_EMPLACEMENT.get(cle) || cle;

// --- utilitaires ------------------------------------------------------------

/** Minuscules sans accents, pour comparer et rechercher. */
export function sansAccent(valeur) {
  return String(valeur ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function nombreOuNull(valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  const n = Number(String(valeur).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function entier(valeur, defaut = 0) {
  const n = Number(valeur);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : defaut;
}

export function identifiant(prefixe) {
  return `${prefixe}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Les dates du classeur sont écrites à la main : « 03.07.2026 », « Mai 2026 »,
 * « Entre le 07.08.2026 et le 15.08.2026 ». On garde le texte d'origine pour
 * l'affichage et on en extrait une date triable quand c'est possible.
 */
export function dateTriable(texte) {
  const brut = String(texte ?? '').trim();
  if (!brut) return null;
  const jma = brut.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  if (jma) return `${jma[3]}-${jma[2].padStart(2, '0')}-${jma[1].padStart(2, '0')}`;
  const iso = brut.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const mois = [
    'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre',
  ];
  const normalise = sansAccent(brut);
  const annee = normalise.match(/(19|20)\d{2}/);
  if (!annee) return null;
  const index = mois.findIndex((m) => normalise.includes(m));
  return index === -1 ? `${annee[0]}-00-00` : `${annee[0]}-${String(index + 1).padStart(2, '0')}-00`;
}

/** Date du jour au format « JJ.MM.AAAA », celui utilisé dans le classeur. */
export function aujourdhui() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

// --- normalisation ----------------------------------------------------------

// `modifieLe` porte l'heure à laquelle un appareil a touché la fiche, et reste
// vide sur les fiches issues du classeur, que personne n'a encore modifiées.
// C'est cette heure qui départage deux appareils ayant travaillé chacun de leur
// côté : celle de l'envoi ne dirait que qui a retrouvé le réseau en premier.

export function normaliserVin(brut = {}) {
  const emplacements = {};
  for (const { cle } of EMPLACEMENTS) {
    emplacements[cle] = entier(brut.emplacements?.[cle], 0);
  }
  const vin = {
    id: brut.id || identifiant('v'),
    nom: String(brut.nom ?? '').trim(),
    producteur: String(brut.producteur ?? '').trim(),
    region: String(brut.region ?? '').trim(),
    cepage: String(brut.cepage ?? '').trim(),
    couleur: LIBELLE_COULEUR.has(brut.couleur) ? brut.couleur : 'inconnu',
    millesime: nombreOuNull(brut.millesime),
    volume: String(brut.volume ?? '75 cl').trim() || '75 cl',
    degre: nombreOuNull(brut.degre),
    quantite: entier(brut.quantite, 0),
    provenance: String(brut.provenance ?? '').trim(),
    source: String(brut.source ?? '').trim(),
    dateReception: String(brut.dateReception ?? '').trim(),
    emplacements,
    emplacementPrecis: String(brut.emplacementPrecis ?? '').trim(),
    statut: brut.statut === 'termine' ? 'termine' : 'en-cave',
    note: String(brut.note ?? '').trim(),
    notation: nombreOuNull(brut.notation),
    photo: String(brut.photo ?? '').trim(),
    photoLocale: String(brut.photoLocale ?? '').trim(),
    // La contre-étiquette, quand elle a été prise : elle porte souvent le
    // degré, le volume et la description que la face avant tait.
    photoArriere: String(brut.photoArriere ?? '').trim(),
    modifieLe: String(brut.modifieLe ?? '').trim(),
  };
  vin.bouteillesRangees = Object.values(emplacements).reduce((a, b) => a + b, 0);
  return vin;
}

export function normaliserDegustation(brut = {}) {
  return {
    id: brut.id || identifiant('t'),
    nom: String(brut.nom ?? '').trim(),
    producteur: String(brut.producteur ?? '').trim(),
    region: String(brut.region ?? '').trim(),
    cepage: String(brut.cepage ?? '').trim(),
    couleur: LIBELLE_COULEUR.has(brut.couleur) ? brut.couleur : 'inconnu',
    millesime: nombreOuNull(brut.millesime),
    contexte: String(brut.contexte ?? '').trim(),
    lieu: String(brut.lieu ?? '').trim(),
    date: String(brut.date ?? '').trim(),
    notation: nombreOuNull(brut.notation),
    commentaire: String(brut.commentaire ?? '').trim(),
    photo: String(brut.photo ?? '').trim(),
    photoLocale: String(brut.photoLocale ?? '').trim(),
    vinId: String(brut.vinId ?? '').trim(),
    modifieLe: String(brut.modifieLe ?? '').trim(),
  };
}

// --- champs dérivés ---------------------------------------------------------

/** Répartition des bouteilles d'un vin, emplacements vides exclus. */
export function repartition(vin) {
  return EMPLACEMENTS
    .map((e) => ({ ...e, nombre: vin.emplacements[e.cle] || 0 }))
    .filter((e) => e.nombre > 0);
}

/**
 * Signale les incohérences d'une fiche, pour les afficher sans rien corriger
 * automatiquement : le classeur d'origine en contient et seul le propriétaire
 * de la cave sait laquelle des deux valeurs est la bonne.
 */
export function anomalies(vin) {
  const liste = [];
  if (vin.statut === 'en-cave') {
    if (vin.quantite === 0) liste.push('En cave mais aucune bouteille');
    else if (vin.bouteillesRangees !== vin.quantite) {
      liste.push(vin.bouteillesRangees === 0
        ? 'Emplacement non renseigné'
        : `Emplacements incomplets (${vin.bouteillesRangees} sur ${vin.quantite})`);
    }
  }
  if (vin.couleur === 'inconnu') liste.push('Couleur à préciser');
  if (/à (vérifier|contrôler)/i.test(vin.note)) liste.push('À vérifier');
  return liste;
}

const CHAMPS_RECHERCHE = ['nom', 'producteur', 'region', 'cepage', 'source', 'note',
  'emplacementPrecis', 'provenance', 'dateReception'];

export function texteRecherche(vin) {
  const parts = CHAMPS_RECHERCHE.map((c) => vin[c]).filter(Boolean);
  if (vin.millesime) parts.push(String(vin.millesime));
  parts.push(libelleCouleur(vin.couleur));
  return sansAccent(parts.join(' '));
}

// --- recherche, filtres, tri ------------------------------------------------

export const FILTRES_PAR_DEFAUT = {
  recherche: '',
  couleur: '',
  emplacement: '',
  region: '',
  statut: 'en-cave',
  provenance: '',
  anomalies: false,
  tri: 'nom',
};

export const TRIS = [
  { cle: 'nom', libelle: 'Nom (A→Z)' },
  { cle: 'producteur', libelle: 'Producteur' },
  { cle: 'region', libelle: 'Région' },
  { cle: 'millesime-desc', libelle: 'Millésime (récent)' },
  { cle: 'millesime-asc', libelle: 'Millésime (ancien)' },
  { cle: 'quantite-desc', libelle: 'Quantité (décroissante)' },
  { cle: 'notation-desc', libelle: 'Mieux notés' },
];

const collateur = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

function comparer(tri) {
  const parNom = (a, b) => collateur.compare(a.nom, b.nom);
  switch (tri) {
    case 'producteur':
      return (a, b) => collateur.compare(a.producteur, b.producteur) || parNom(a, b);
    case 'region':
      return (a, b) => collateur.compare(a.region, b.region) || parNom(a, b);
    case 'millesime-desc':
      return (a, b) => (b.millesime ?? -Infinity) - (a.millesime ?? -Infinity) || parNom(a, b);
    case 'millesime-asc':
      return (a, b) => (a.millesime ?? Infinity) - (b.millesime ?? Infinity) || parNom(a, b);
    case 'quantite-desc':
      return (a, b) => b.quantite - a.quantite || parNom(a, b);
    case 'notation-desc':
      return (a, b) => (b.notation ?? -1) - (a.notation ?? -1) || parNom(a, b);
    default:
      return parNom;
  }
}

export function filtrerVins(vins, filtres) {
  const f = { ...FILTRES_PAR_DEFAUT, ...filtres };
  const mots = sansAccent(f.recherche).split(/\s+/).filter(Boolean);
  const resultat = vins.filter((vin) => {
    if (f.statut && vin.statut !== f.statut) return false;
    if (f.couleur && vin.couleur !== f.couleur) return false;
    if (f.region && vin.region !== f.region) return false;
    if (f.provenance && vin.provenance !== f.provenance) return false;
    if (f.emplacement && !(vin.emplacements[f.emplacement] > 0)) return false;
    if (f.anomalies && anomalies(vin).length === 0) return false;
    if (mots.length) {
      const cible = texteRecherche(vin);
      if (!mots.every((m) => cible.includes(m))) return false;
    }
    return true;
  });
  return resultat.sort(comparer(f.tri));
}

export function filtresActifs(filtres) {
  const f = { ...FILTRES_PAR_DEFAUT, ...filtres };
  let nombre = 0;
  if (f.couleur) nombre += 1;
  if (f.emplacement) nombre += 1;
  if (f.region) nombre += 1;
  if (f.provenance) nombre += 1;
  if (f.anomalies) nombre += 1;
  if (f.statut !== FILTRES_PAR_DEFAUT.statut) nombre += 1;
  return nombre;
}

export function trierDegustations(degustations) {
  return [...degustations].sort((a, b) => {
    const da = dateTriable(a.date) || '';
    const db = dateTriable(b.date) || '';
    if (da !== db) return db.localeCompare(da);
    return collateur.compare(a.nom, b.nom);
  });
}

/** Valeurs distinctes d'un champ, triées, pour alimenter les listes de filtres. */
export function valeursDistinctes(vins, champ) {
  const vues = new Set();
  for (const vin of vins) {
    const valeur = String(vin[champ] ?? '').trim();
    if (valeur) vues.add(valeur);
  }
  return [...vues].sort(collateur.compare);
}

// --- statistiques -----------------------------------------------------------

function compter(elements, cle) {
  const total = new Map();
  for (const el of elements) {
    const valeur = typeof cle === 'function' ? cle(el) : el[cle];
    if (!valeur) continue;
    total.set(valeur, (total.get(valeur) || 0) + 1);
  }
  return [...total.entries()]
    .map(([libelle, nombre]) => ({ libelle, nombre }))
    .sort((a, b) => b.nombre - a.nombre || collateur.compare(a.libelle, b.libelle));
}

function additionner(elements, cle, poids) {
  const total = new Map();
  for (const el of elements) {
    const valeur = typeof cle === 'function' ? cle(el) : el[cle];
    if (!valeur) continue;
    total.set(valeur, (total.get(valeur) || 0) + poids(el));
  }
  return [...total.entries()]
    .map(([libelle, nombre]) => ({ libelle, nombre }))
    .filter((e) => e.nombre > 0)
    .sort((a, b) => b.nombre - a.nombre || collateur.compare(a.libelle, b.libelle));
}

export function statistiques(vins, degustations) {
  const enCave = vins.filter((v) => v.statut === 'en-cave');
  const bouteilles = enCave.reduce((total, v) => total + v.quantite, 0);
  const notes = vins.map((v) => v.notation).filter((n) => n !== null);
  const notesDegustations = degustations.map((d) => d.notation).filter((n) => n !== null);
  const toutesNotes = [...notes, ...notesDegustations];

  const parMois = new Map();
  for (const d of degustations) {
    const date = dateTriable(d.date);
    if (!date || date.endsWith('-00-00')) continue;
    const mois = date.slice(0, 7);
    parMois.set(mois, (parMois.get(mois) || 0) + 1);
  }

  return {
    references: enCave.length,
    bouteilles,
    terminees: vins.length - enCave.length,
    degustations: degustations.length,
    noteMoyenne: toutesNotes.length
      ? toutesNotes.reduce((a, b) => a + b, 0) / toutesNotes.length
      : null,
    aVerifier: enCave.filter((v) => anomalies(v).length > 0).length,
    parCouleur: COULEURS
      .map(({ cle, libelle }) => ({
        cle,
        libelle,
        nombre: enCave.filter((v) => v.couleur === cle).reduce((t, v) => t + v.quantite, 0),
      }))
      .filter((c) => c.nombre > 0),
    parEmplacement: EMPLACEMENTS.map(({ cle, libelle }) => ({
      cle,
      libelle,
      nombre: enCave.reduce((t, v) => t + (v.emplacements[cle] || 0), 0),
    })),
    horsEmplacement: Math.max(0, bouteilles - enCave.reduce((t, v) => t + v.bouteillesRangees, 0)),
    parRegion: additionner(enCave, 'region', (v) => v.quantite).slice(0, 12),
    parProducteur: additionner(enCave, 'producteur', (v) => v.quantite).slice(0, 10),
    parMillesime: additionner(enCave, (v) => (v.millesime ? String(v.millesime) : ''),
      (v) => v.quantite).sort((a, b) => collateur.compare(b.libelle, a.libelle)),
    parProvenance: additionner(enCave, 'provenance', (v) => v.quantite),
    parContexte: compter(degustations, 'contexte'),
    degustationsParMois: [...parMois.entries()]
      .map(([mois, nombre]) => ({ libelle: mois, nombre }))
      .sort((a, b) => a.libelle.localeCompare(b.libelle))
      .slice(-12),
  };
}
