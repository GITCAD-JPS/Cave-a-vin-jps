// Le dialogue où l'on met une étiquette à plat, partagé entre l'ajout d'une
// bouteille et la modification d'une fiche. Le calcul lui-même est dans
// aplatir.js, ce module ne fait que le présenter et recueillir les six points.

import { aplatir, reperesSurMesure } from './aplatir.js';
import { bouton, dialogue, el, message, vider } from './dom.js';

const ORDRE_REPERES = [
  ['hg', 'coin haut gauche'], ['hm', 'milieu du bord haut'], ['hd', 'coin haut droit'],
  ['bd', 'coin bas droit'], ['bm', 'milieu du bord bas'], ['bg', 'coin bas gauche'],
];

/** Une photo dans une toile, à une taille où le redressement reste rapide. */
async function toileDe(source) {
  if (!source) throw new Error('photo introuvable');
  const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' })
    .catch(() => createImageBitmap(source));
  // Mille six cents pixels suffisent largement pour une vignette d'étiquette,
  // et le redressement se fait pixel par pixel : au-delà, l'attente se voit.
  const facteur = Math.min(1, 1600 / (Math.max(bitmap.width, bitmap.height) || 1));
  const toile = document.createElement('canvas');
  toile.width = Math.round(bitmap.width * facteur);
  toile.height = Math.round(bitmap.height * facteur);
  toile.getContext('2d', { willReadFrequently: true })
    .drawImage(bitmap, 0, 0, toile.width, toile.height);
  if (bitmap.close) bitmap.close();
  return toile;
}

/**
 * Redresser une étiquette photographiée sur la bouteille.
 *
 * Six repères posés au doigt sur ses bords suffisent : les quatre coins disent
 * où elle s'arrête, les deux milieux disent comment elle se courbe. Ils sont
 * placés d'avance là où l'étiquette semble être, et l'aperçu précède toujours
 * l'enregistrement.
 *
 * `charger` rend la photo à redresser — toujours celle d'origine quand on l'a,
 * jamais une étiquette déjà mise à plat, qu'on redresserait une seconde fois.
 * `onGarder` reçoit l'image à plat.
 */
export function dialogueMiseAPlat({ titre, libelle, charger, onGarder }) {
  dialogue(titre, (fermer) => {
    const scene = el('div', { class: 'aplat-scene' });
    const apercu = el('div', { class: 'aplat-apercu' });
    const etatLocal = { toile: null, reperes: null, rendu: null, vue: 'reperes' };

    const actions = el('div', { class: 'formulaire-actions' });
    const aide = el('p', { class: 'discret', text: 'Chargement de la photo…' });

    const dessiner = () => {
      vider(scene);
      if (!etatLocal.toile) return;
      const { width: L, height: H } = etatLocal.toile;
      const image = el('img', { src: etatLocal.toile.toDataURL('image/jpeg', 0.9), alt: libelle });
      const cadre = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      cadre.setAttribute('viewBox', `0 0 ${L} ${H}`);
      cadre.setAttribute('class', 'aplat-cadre');
      cadre.setAttribute('preserveAspectRatio', 'none');
      const trait = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      trait.setAttribute('class', 'aplat-contour');
      cadre.append(trait);

      const r = etatLocal.reperes;
      const ctrl = (a, m, b) => ({ x: 2 * m.x - (a.x + b.x) / 2, y: 2 * m.y - (a.y + b.y) / 2 });
      const majTrait = () => {
        const ch = ctrl(r.hg, r.hm, r.hd);
        const cb = ctrl(r.bd, r.bm, r.bg);
        trait.setAttribute('d', `M ${r.hg.x} ${r.hg.y} Q ${ch.x} ${ch.y} ${r.hd.x} ${r.hd.y}`
          + ` L ${r.bd.x} ${r.bd.y} Q ${cb.x} ${cb.y} ${r.bg.x} ${r.bg.y} Z`);
      };
      majTrait();

      const poignees = ORDRE_REPERES.map(([cle, nom]) => {
        const p = el('button', {
          type: 'button', class: 'aplat-poignee', 'aria-label': nom, title: nom,
        });
        const placer = () => {
          p.style.left = `${(r[cle].x / L) * 100}%`;
          p.style.top = `${(r[cle].y / H) * 100}%`;
        };
        placer();
        p.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          p.setPointerCapture(e.pointerId);
          p.classList.add('tenue');
        });
        p.addEventListener('pointermove', (e) => {
          if (!p.hasPointerCapture(e.pointerId)) return;
          const boite = scene.getBoundingClientRect();
          r[cle] = {
            x: Math.max(0, Math.min(L, ((e.clientX - boite.left) / boite.width) * L)),
            y: Math.max(0, Math.min(H, ((e.clientY - boite.top) / boite.height) * H)),
          };
          placer();
          majTrait();
        });
        p.addEventListener('pointerup', (e) => {
          p.releasePointerCapture(e.pointerId);
          p.classList.remove('tenue');
        });
        // Au clavier, pour qui n'a pas d'écran tactile.
        p.addEventListener('keydown', (e) => {
          const pas = e.shiftKey ? 20 : 4;
          const d = { ArrowLeft: [-pas, 0], ArrowRight: [pas, 0], ArrowUp: [0, -pas], ArrowDown: [0, pas] }[e.key];
          if (!d) return;
          e.preventDefault();
          r[cle] = { x: Math.max(0, Math.min(L, r[cle].x + d[0])), y: Math.max(0, Math.min(H, r[cle].y + d[1])) };
          placer();
          majTrait();
        });
        return p;
      });
      scene.append(image, cadre, ...poignees);
    };

    const montrerApercu = () => {
      vider(apercu);
      etatLocal.rendu = aplatir(etatLocal.toile, etatLocal.reperes);
      apercu.append(el('img', {
        src: etatLocal.rendu.toDataURL('image/jpeg', 0.92),
        alt: `${libelle} à plat`,
      }));
    };

    const majActions = () => {
      vider(actions);
      if (etatLocal.vue === 'reperes') {
        aide.textContent = 'L’étiquette a été cernée au jugé. Ajustez les six points '
          + 'sur ses bords : les quatre coins, puis le milieu du bord haut et celui du bord bas.';
        scene.hidden = false;
        apercu.hidden = true;
        actions.append(
          bouton('Annuler', { classe: 'bouton', onclick: fermer }),
          bouton('Voir le résultat', {
            classe: 'bouton bouton-primaire',
            onclick: () => {
              montrerApercu();
              etatLocal.vue = 'apercu';
              majActions();
            },
          }),
        );
        return;
      }
      aide.textContent = 'Si le cadrage ne convient pas, reprenez les points.';
      scene.hidden = true;
      apercu.hidden = false;
      actions.append(
        bouton('Reprendre les points', {
          classe: 'bouton',
          onclick: () => { etatLocal.vue = 'reperes'; majActions(); },
        }),
        bouton('Garder cette image', {
          classe: 'bouton bouton-primaire',
          onclick: async (evenement) => {
            evenement.currentTarget.disabled = true;
            const blob = await new Promise((r2) => etatLocal.rendu.toBlob(r2, 'image/jpeg', 0.92));
            if (!blob) {
              message('Image impossible à enregistrer', 'erreur');
              evenement.currentTarget.disabled = false;
              return;
            }
            fermer();
            try {
              await onGarder(blob);
            } catch (erreur) {
              console.error(erreur);
              message('L’étiquette à plat n’a pas pu être enregistrée', 'erreur');
            }
          },
        }),
      );
    };

    charger().then(toileDe).then((toile) => {
      etatLocal.toile = toile;
      etatLocal.reperes = reperesSurMesure(toile);
      dessiner();
      majActions();
    }).catch(() => {
      aide.textContent = 'Cette photo n’a pas pu être ouverte.';
      vider(actions);
      actions.append(bouton('Fermer', { classe: 'bouton', onclick: fermer }));
    });

    return [aide, scene, apercu, actions];
  }, { largeur: '40rem' });
}
