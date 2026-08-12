/**
 * Scanner un code-barres, puis choisir ce qu'on en fait.
 *
 * Le scan existait a trois endroits — la bibliotheque, le chariot de courses,
 * le frigo — et il fallait avoir devine lequel AVANT de sortir le telephone.
 * Or on ne sait pas toujours : le meme pot de yaourt qu'on tient en rayon peut
 * finir au chariot, au frigo, ou simplement en fiche. Cet ecran inverse
 * l'ordre : on lit d'abord, on decide ensuite.
 *
 * IL NE FAIT PRESQUE RIEN, ET C'EST VOULU. Il ne cree pas d'ingredient, ne
 * touche ni au chariot ni au stock. Il resout le code UNE FOIS pour montrer de
 * quoi on parle, puis renvoie vers l'ecran choisi avec `?scan=<code>`. C'est
 * la que le travail se fait, par le code deja ecrit et deja eprouve de cet
 * ecran-la : sa gestion de la quantite par defaut, de la session de courses,
 * du produit inconnu, du doublon de nom. Refaire ces regles ici en aurait cree
 * une seconde version, qui aurait derive.
 *
 * La resolution n'est pas perdue pour autant : `useBarcode` garde sa reponse
 * une demi-heure, et l'ecran de destination interroge la meme cle.
 */

import { useState } from "react";
import { useNavigate } from "react-router";

import { BarcodeScanner } from "../components/BarcodeScanner.js";
import { MacroCells } from "../components/MacrosDonut.js";
import { Sheet } from "../components/Sheet.js";
import { SourceBadge } from "../components/States.js";
import { Icon, type IconName } from "../icons/index.js";
import { ApiError } from "../lib/api.js";
import { useBarcode, useShoppingSession } from "../lib/queries.js";
import "../styles/accueil.css";

interface Destination {
  readonly cle: string;
  readonly to: (ean: string) => string;
  readonly icon: IconName;
  readonly titre: string;
  readonly detail: string;
}

/**
 * Les trois destinations.
 *
 * `ean` pour la bibliotheque, `scan` pour les deux autres, et la difference
 * n'est pas cosmetique : `?ean=` existait deja sur le formulaire d'ingredient
 * et y signifie « pre-remplis la reference source ». `?scan=` veut dire
 * « traite ce produit ». Deux verbes, deux noms.
 *
 * `&remplir=1` complete le premier : on vient de resoudre le produit et de
 * l'afficher, arriver sur une fiche vide obligerait a rescanner le meme code.
 * La feuille d'import, elle, n'emploie pas ce drapeau — on n'y atterrit
 * qu'apres un « produit inconnu », et reposer la question afficherait un echec
 * en travers d'un formulaire vierge.
 */
const DESTINATIONS: readonly Destination[] = [
  {
    cle: "bibliotheque",
    to: (ean) => `/ingredients/nouveau?ean=${ean}&remplir=1`,
    icon: "ui-basket",
    titre: "Ma bibliothèque",
    detail: "En faire une fiche réutilisable",
  },
  {
    cle: "courses",
    to: (ean) => `/courses?scan=${ean}`,
    icon: "ui-cart",
    titre: "Mon panier",
    detail: "L’ajouter à la session de courses",
  },
  {
    cle: "frigo",
    to: (ean) => `/frigo?scan=${ean}`,
    icon: "ui-fridge",
    titre: "Mon frigo",
    detail: "L’entrer en stock, avec sa date",
  },
];

export function ScanScreen() {
  const navigate = useNavigate();
  const [ean, setEan] = useState<string | null>(null);

  const produit = useBarcode(ean);
  const courses = useShoppingSession();

  // Une session de courses OUVERTE est necessaire pour ajouter au chariot :
  // sans elle, l'envoi echouerait. On presente donc la destination, mais on
  // dit ce qui manque plutot que d'offrir un bouton mort.
  const sansSession = courses.data?.active !== true;

  const inconnu =
    produit.error instanceof ApiError && produit.error.status === 404;

  return (
    <section className="screen screen--scan">
      {/* LE VISEUR EST L'ECRAN. Il reste monte meme quand la fiche est
          ouverte : on voit ce qu'on vient de lire, et « Scanner autre chose »
          ne fait que refermer la fiche au lieu de tout redemarrer. */}
      <BarcodeScanner
        inline
        open
        onClose={() => void navigate(-1)}
        onDetect={(code) => setEan(code)}
        title="Scanner un produit"
        hint="Visez le code-barres du produit"
      />

      {/* UNE VRAIE FEUILLE, et non une carte posee dans la page.
          Collee en bas du flux, elle debordait sans pouvoir defiler : pour
          atteindre la troisieme destination il fallait faire defiler LA PAGE,
          donc le viseur avec, et la fiche restait coupee. `Sheet` borne sa
          hauteur, fait defiler son propre corps et retient le geste a
          l'interieur. C'est le composant deja eprouve partout ailleurs. */}
      <Sheet
        open={ean !== null}
        onClose={() => setEan(null)}
        title={produit.data?.name ?? (ean === null ? "" : `Code ${ean}`)}
        actions={
          <button
            type="button"
            className="button button--secondary"
            onClick={() => setEan(null)}
          >
            Scanner autre chose
          </button>
        }
      >
        {produit.isPending ? (
          <p className="card__lead">Recherche du produit…</p>
        ) : produit.data === undefined ? (
          <p className="card__lead">
            {inconnu
              ? "Aucun produit ne porte ce code chez OpenFoodFacts. Tu peux quand même en faire une fiche : le code y sera conservé."
              : "La recherche n’a pas abouti. Les destinations restent ouvertes : chacune sait retrouver ce code par elle-même."}
          </p>
        ) : (
          <>
            {produit.data.brand !== null && (
              <p className="fiche-scan__marque">
                {produit.data.brand}{" "}
                <SourceBadge source={produit.data.source} />
              </p>
            )}
            <MacroCells total={macrosDe(produit.data)} />
          </>
        )}

        <nav
          className="acces acces--destinations"
          aria-label="Où envoyer ce produit"
        >
          {DESTINATIONS.map((d) => {
            const bloquee = d.cle === "courses" && sansSession;
            return (
              <button
                key={d.cle}
                type="button"
                className="acces__carte"
                onClick={() => ean !== null && void navigate(d.to(ean))}
              >
                <span className="acces__icone" aria-hidden="true">
                  <Icon name={d.icon} size={22} strokeWidth={1.7} />
                </span>
                <span className="acces__label">{d.titre}</span>
                <span className="acces__detail">
                  {/* On n'interdit PAS le bouton : la destination ouvre la
                      feuille de demarrage d'une session, et le code y est
                      conserve le temps qu'elle s'ouvre. */}
                  {bloquee
                    ? "Ouvrira d’abord une session de courses"
                    : d.detail}
                </span>
              </button>
            );
          })}
        </nav>
      </Sheet>
    </section>
  );
}

/** Les macros d'un produit, avec zero pour ce qu'OpenFoodFacts n'a pas donne. */
function macrosDe(p: {
  kcal: number | null;
  proteins: number | null;
  carbs: number | null;
  fats: number | null;
  saturatedFats: number | null;
  sugars: number | null;
  fiber: number | null;
  salt: number | null;
}) {
  return {
    kcal: p.kcal ?? 0,
    proteins: p.proteins ?? 0,
    carbs: p.carbs ?? 0,
    fats: p.fats ?? 0,
    saturatedFats: p.saturatedFats ?? 0,
    sugars: p.sugars ?? 0,
    fiber: p.fiber ?? 0,
    salt: p.salt ?? 0,
  };
}
