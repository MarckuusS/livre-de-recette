/**
 * Un code-barres arrive par l'URL.
 *
 * Le point d'entree de scan (`/scan`) ne resout rien et n'ecrit rien : il
 * renvoie vers l'ecran de destination avec `?scan=<code>`. C'est ce hook qui
 * le rattrape a l'arrivee, pour que le code emprunte ensuite EXACTEMENT le
 * chemin d'un code lu par la camera de cet ecran-la — meme fonction, meme
 * feuille, memes cas d'erreur. Rien de ce chemin n'est duplique.
 *
 * TROIS PRECAUTIONS, et chacune repare un defaut precis :
 *
 *   1. On VALIDE avec `isValidEan`, comme la camera. `handleCode` n'a jamais
 *      laisse passer un code invalide ; l'URL, que n'importe qui peut ecrire,
 *      ne doit pas etre l'exception.
 *
 *   2. On EFFACE le parametre aussitot, en `replace`. Une feuille empile sa
 *      propre entree d'historique en s'ouvrant : si le parametre restait, le
 *      geste de retour ramenerait sur la meme adresse et rouvrirait la feuille
 *      en boucle. Un rechargement d'onglet — frequent en magasin — la
 *      rouvrirait aussi.
 *
 *   3. On RETIENT la valeur dans un etat. Elle doit survivre a l'effacement de
 *      l'URL, et parfois attendre : cote Courses, il faut d'abord ouvrir une
 *      session avant qu'un destinataire existe.
 *
 * Le compteur distingue deux arrivees du MEME code — deux articles identiques
 * scannes de suite sont deux lignes, pas une.
 */

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'

import { isValidEan } from '../components/BarcodeScanner.js'

export interface ScanRequest {
  readonly ean: string
  readonly nonce: number
}

export function useScanParam(paramName = 'scan'): ScanRequest | null {
  const [searchParams, setSearchParams] = useSearchParams()
  const raw = searchParams.get(paramName)
  const compteur = useRef(0)
  const [request, setRequest] = useState<ScanRequest | null>(null)

  useEffect(() => {
    if (raw === null) return

    // Meme nettoyage que `BarcodeScanner.handleCode` : les lecteurs ajoutent
    // parfois un separateur, et un code colle a la main peut porter un espace.
    const code = raw.replace(/\D/g, '')
    if (isValidEan(code)) {
      compteur.current += 1
      setRequest({ ean: code, nonce: compteur.current })
    }

    const suite = new URLSearchParams(searchParams)
    suite.delete(paramName)
    setSearchParams(suite, { replace: true })
    // `searchParams` est volontairement absent des dependances : il change a
    // l'instant ou l'on efface le parametre, et l'y mettre relancerait l'effet
    // pour rien. `raw` suffit — c'est la seule valeur qui nous interesse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw])

  return request
}
