// Mise à plat d'une étiquette photographiée sur une bouteille.
//
// Une étiquette collée sur un cylindre ne se photographie jamais droite : ses
// lignes horizontales se courbent en arcs, et ses bords gauche et droit fuient
// vers l'arrière de la bouteille, où ils se resserrent. Une photo de face en
// garde une image en tonneau, bonne à lire mais laide à regarder et impossible
// à comparer à une autre.
//
// On la redresse à partir de six points posés sur ses bords — les quatre coins,
// plus le milieu du bord haut et celui du bord bas, qui donnent la courbure.
// C'est le procédé décrit par Alexey Zankevich dans unwrap_labels, refait ici
// en JavaScript pour tenir dans une page web : la bibliothèque d'origine est en
// Python, et son portage passerait par dix méga-octets d'OpenCV.
//
// Deux redressements se composent. Le premier suit les arcs : chaque colonne de
// l'image rendue est prélevée entre le bord haut et le bord bas, suivis dans
// leur courbure. Le second rétablit les largeurs : sur un cylindre, ce qui est
// vu de face occupe plus de place que ce qui fuit sur le côté, si bien qu'une
// progression régulière sur l'étiquette déroulée correspond à une progression
// en sinus sur la photo.

/** Courbe passant par trois points, paramétrée de 0 à 1. */
function arc(debut, milieu, fin) {
  // Le point de contrôle d'une quadratique n'est pas sur la courbe : on le
  // place pour qu'elle passe exactement par le milieu mesuré.
  const cx = 2 * milieu.x - (debut.x + fin.x) / 2;
  const cy = 2 * milieu.y - (debut.y + fin.y) / 2;
  return (t) => {
    const r = 1 - t;
    return {
      x: r * r * debut.x + 2 * r * t * cx + t * t * fin.x,
      y: r * r * debut.y + 2 * r * t * cy + t * t * fin.y,
    };
  };
}

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Longueur développée d'un arc, pour savoir quelle largeur lui rendre. */
function longueurArc(courbe, pas = 64) {
  let total = 0;
  let precedent = courbe(0);
  for (let i = 1; i <= pas; i += 1) {
    const point = courbe(i / pas);
    total += distance(precedent, point);
    precedent = point;
  }
  return total;
}

/**
 * Où prélever, sur la photo, le point qui occupe la fraction `u` de la largeur
 * de l'étiquette déroulée.
 *
 * `courbure` dit quelle part du tour de bouteille l'étiquette occupe : 0 pour
 * une étiquette plate, vers 1 pour une qui s'enroule franchement. Au-delà de
 * zéro, les bords sont dilatés et le centre resserré, ce qui rend aux lettres
 * de bord leur largeur.
 */
function redresserLargeur(u, courbure) {
  if (courbure <= 0) return u;
  const angleMax = (Math.PI / 180) * (75 * Math.min(1, courbure));
  return 0.5 + Math.sin((u - 0.5) * 2 * angleMax) / (2 * Math.sin(angleMax));
}

/** Couleur d'un point non entier, prise entre ses quatre voisins. */
function echantillon(source, largeur, hauteur, x, y, sortie, cible) {
  const xi = Math.max(0, Math.min(largeur - 1, x));
  const yi = Math.max(0, Math.min(hauteur - 1, y));
  const x0 = Math.floor(xi);
  const y0 = Math.floor(yi);
  const x1 = Math.min(largeur - 1, x0 + 1);
  const y1 = Math.min(hauteur - 1, y0 + 1);
  const fx = xi - x0;
  const fy = yi - y0;
  const a = (y0 * largeur + x0) * 4;
  const b = (y0 * largeur + x1) * 4;
  const c = (y1 * largeur + x0) * 4;
  const d = (y1 * largeur + x1) * 4;
  for (let k = 0; k < 4; k += 1) {
    const haut = source[a + k] + (source[b + k] - source[a + k]) * fx;
    const bas = source[c + k] + (source[d + k] - source[c + k]) * fx;
    sortie[cible + k] = haut + (bas - haut) * fy;
  }
}

/**
 * Rend l'étiquette à plat, dans une toile.
 *
 * `points` porte les six repères posés sur la photo, en pixels de celle-ci :
 * `hg`, `hm`, `hd` sur le bord haut de gauche à droite, `bg`, `bm`, `bd` sur le
 * bord bas. `courbure` vaut 0 pour ne corriger que les arcs.
 */
export function aplatir(toileSource, points, { courbure = 0.55, coteMax = 1600 } = {}) {
  const largeur = toileSource.width;
  const hauteur = toileSource.height;
  const source = toileSource.getContext('2d', { willReadFrequently: true })
    .getImageData(0, 0, largeur, hauteur).data;

  const haut = arc(points.hg, points.hm, points.hd);
  const bas = arc(points.bg, points.bm, points.bd);

  // La taille rendue suit celle de l'étiquette sur la photo, sans l'inventer
  // plus grande qu'elle n'est.
  const large = Math.round((longueurArc(haut) + longueurArc(bas)) / 2);
  const haute = Math.round((distance(points.hg, points.bg) + distance(points.hd, points.bd)) / 2);
  const facteur = Math.min(1, coteMax / Math.max(large, haute, 1));
  const L = Math.max(16, Math.round(large * facteur));
  const H = Math.max(16, Math.round(haute * facteur));

  const toile = document.createElement('canvas');
  toile.width = L;
  toile.height = H;
  const rendu = toile.getContext('2d').createImageData(L, H);

  for (let i = 0; i < L; i += 1) {
    const u = redresserLargeur(L === 1 ? 0.5 : i / (L - 1), courbure);
    const pointHaut = haut(u);
    const pointBas = bas(u);
    for (let j = 0; j < H; j += 1) {
      const v = H === 1 ? 0 : j / (H - 1);
      echantillon(
        source, largeur, hauteur,
        pointHaut.x + (pointBas.x - pointHaut.x) * v,
        pointHaut.y + (pointBas.y - pointHaut.y) * v,
        rendu.data, (j * L + i) * 4,
      );
    }
  }
  toile.getContext('2d').putImageData(rendu, 0, 0);
  return toile;
}

/**
 * Où l'étiquette se trouve, à vue de nez.
 *
 * Nul besoin d'un modèle savant : une étiquette est une plage claire et unie au
 * milieu d'une bouteille sombre, et c'est assez pour la cerner. On part du
 * centre de la photo, là où l'on vise toujours, et l'on s'étend tant que la
 * clarté se maintient. Le résultat n'a pas à être juste, seulement à épargner
 * six gestes sur sept : les points restent à prendre et à corriger.
 *
 * Rend une boîte en fractions de l'image, ou rien si la plage trouvée est trop
 * petite ou tient toute la photo, deux signes qu'on s'est trompé.
 */
function cernerEtiquette(toile) {
  const COTE = 140;
  const facteur = COTE / (toile.width || 1);
  const L = COTE;
  const H = Math.max(8, Math.round(toile.height * facteur));
  const petite = document.createElement('canvas');
  petite.width = L;
  petite.height = H;
  petite.getContext('2d').drawImage(toile, 0, 0, L, H);
  const px = petite.getContext('2d').getImageData(0, 0, L, H).data;
  const clarte = (x, y) => {
    const i = (y * L + x) * 4;
    return (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114);
  };

  // La référence est prise au centre, où l'on vise la bouteille.
  let centre = 0;
  let comptes = 0;
  for (let y = Math.round(H * 0.4); y < H * 0.6; y += 1) {
    for (let x = Math.round(L * 0.4); x < L * 0.6; x += 1) { centre += clarte(x, y); comptes += 1; }
  }
  if (!comptes) return null;
  centre /= comptes;
  const proche = (v) => Math.abs(v - centre) < 58;

  // Sur chaque ligne, jusqu'où la plage claire s'étend de part et d'autre.
  const gauches = [];
  const droites = [];
  const lignesPleines = [];
  for (let y = 0; y < H; y += 1) {
    const milieu = Math.round(L / 2);
    if (!proche(clarte(milieu, y))) continue;
    let g = milieu;
    let d = milieu;
    while (g > 0 && proche(clarte(g - 1, y))) g -= 1;
    while (d < L - 1 && proche(clarte(d + 1, y))) d += 1;
    if (d - g < L * 0.2) continue;
    gauches.push(g);
    droites.push(d);
    lignesPleines.push(y);
  }
  if (lignesPleines.length < H * 0.15) return null;

  // Le quartile extérieur plutôt que la médiane : l'étiquette s'assombrit sur
  // ses bords, que la courbure éloigne de la lumière, si bien que la moitié des
  // lignes s'arrêtent trop tôt. Mesuré sur quatre photos, l'écart au bord réel
  // tombe de moitié.
  const quartile = (liste, part) => [...liste]
    .sort((a2, b2) => a2 - b2)[Math.floor((liste.length - 1) * part)];
  const x0 = quartile(gauches, 0.25) / L;
  const x1 = quartile(droites, 0.75) / L;
  const y0 = lignesPleines[0] / H;
  const y1 = lignesPleines[lignesPleines.length - 1] / H;
  if (x1 - x0 < 0.25 || y1 - y0 < 0.2) return null;
  if (x1 - x0 > 0.98 && y1 - y0 > 0.98) return null;
  return { x0, x1, y0, y1 };
}

/**
 * Six repères posés d'office, sur l'étiquette si on l'a trouvée.
 *
 * Ils ne sont qu'un point de départ : la courbure d'une bouteille ne se devine
 * pas d'une plage claire, et les coins demandent presque toujours un ajustement.
 */
export function reperesSurMesure(toile) {
  const boite = cernerEtiquette(toile);
  if (!boite) return reperesParDefaut(toile.width, toile.height);
  const { width: L, height: H } = toile;
  const x0 = boite.x0 * L;
  const x1 = boite.x1 * L;
  const xm = (x0 + x1) / 2;
  const y0 = boite.y0 * H;
  const y1 = boite.y1 * H;
  // La hauteur apparente d'une étiquette cylindrique se creuse au milieu du
  // bord haut et se bombe au bord bas, d'environ un vingtième de sa hauteur.
  const fleche = (y1 - y0) * 0.05;
  return {
    hg: { x: x0, y: y0 }, hm: { x: xm, y: y0 + fleche }, hd: { x: x1, y: y0 },
    bg: { x: x0, y: y1 }, bm: { x: xm, y: y1 + fleche }, bd: { x: x1, y: y1 },
  };
}

/** Un cadre franc, quand la photo ne laisse rien deviner. */
export function reperesParDefaut(largeur, hauteur) {
  const x0 = largeur * 0.12;
  const x1 = largeur * 0.88;
  const xm = (x0 + x1) / 2;
  const y0 = hauteur * 0.2;
  const y1 = hauteur * 0.8;
  // Le bord haut d'une étiquette vue de face se creuse, le bord bas se bombe.
  const fleche = hauteur * 0.04;
  return {
    hg: { x: x0, y: y0 }, hm: { x: xm, y: y0 + fleche }, hd: { x: x1, y: y0 },
    bg: { x: x0, y: y1 }, bm: { x: xm, y: y1 + fleche }, bd: { x: x1, y: y1 },
  };
}
