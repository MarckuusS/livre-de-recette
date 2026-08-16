/**
 * Les lanceurs Windows doivent garder des fins de ligne CRLF.
 *
 * POURQUOI UN TEST POUR SI PEU. `cmd.exe` ne lit pas un fichier .bat ligne par
 * ligne : il avance par decalage d'octets. Prive des CR, il se decale d'un cran
 * a chaque ligne et AVALE LE PREMIER CARACTERE des suivantes. Le fichier ne
 * casse pas franchement, il se met a parler une autre langue : "setlocal"
 * devient "tlocal", "echo" devient "cho", "if" devient "f", et le lanceur
 * s'arrete sur une pile d'erreurs qui ne ressemblent a rien de connu.
 *
 * C'est arrive : une simple edition de `mobile.bat` a reecrit le fichier en LF,
 * et le diagnostic a coute plus cher que la correction. `.gitattributes` porte
 * bien `*.bat text eol=crlf`, mais il ne gouverne que ce qui passe par git, pas
 * un outil qui reecrit le fichier sur le disque.
 *
 * Le test vit sous `worker/` faute de mieux : c'est le seul espace de travail
 * dont les tests regardent deja des fichiers de la racine.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const lanceurs = readdirSync(ROOT).filter((f) => f.toLowerCase().endsWith('.bat'))

describe('lanceurs .bat', () => {
  it('il y en a au moins un a verifier', () => {
    // Sans cette garde, un renommage viderait la liste et les tests
    // ci-dessous passeraient en ne verifiant plus rien.
    expect(lanceurs.length).toBeGreaterThan(0)
  })

  it.each(lanceurs)('%s ne contient aucun saut de ligne isole', (nom) => {
    const octets = readFileSync(join(ROOT, nom))
    const isoles: number[] = []
    let ligne = 1
    for (let i = 0; i < octets.length; i += 1) {
      if (octets[i] !== 0x0a) continue
      if (i === 0 || octets[i - 1] !== 0x0d) isoles.push(ligne)
      ligne += 1
    }
    expect(isoles, `${nom} : lignes en LF seul`).toEqual([])
  })
})
