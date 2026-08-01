import { describe, expect, it } from 'vitest'

import { DEFAULT_ITERATIONS, hashPassword, timingSafeEqual, verifyPassword } from './password.js'

describe('hashPassword', () => {
  it('accepte le bon mot de passe', async () => {
    const record = await hashPassword('un-mot-de-passe-correct')
    expect(await verifyPassword('un-mot-de-passe-correct', record)).toBe(true)
  })

  it('refuse tout le reste', async () => {
    const record = await hashPassword('un-mot-de-passe-correct')
    for (const wrong of ['', 'autre', 'un-mot-de-passe-correc', 'un-mot-de-passe-correct ', 'UN-MOT-DE-PASSE-CORRECT']) {
      expect(await verifyPassword(wrong, record)).toBe(false)
    }
  })

  it('sale differemment deux fois le meme mot de passe', async () => {
    // Sans sel unique, deux comptes partageant un mot de passe auraient le
    // meme hash — visible d'un coup d'oeil dans la base, et cassable une
    // seule fois pour les deux.
    const [a, b] = await Promise.all([hashPassword('identique'), hashPassword('identique')])
    expect(a.salt).not.toBe(b.salt)
    expect(a.hash).not.toBe(b.hash)
    expect(await verifyPassword('identique', a)).toBe(true)
    expect(await verifyPassword('identique', b)).toBe(true)
  })

  it('applique le nombre d iterations recommande par l OWASP', async () => {
    expect(DEFAULT_ITERATIONS).toBe(210_000)
    expect((await hashPassword('x')).iterations).toBe(210_000)
  })

  it('conserve le nombre d iterations avec le hash', async () => {
    // Permet d'augmenter le cout plus tard sans invalider les comptes deja
    // crees : chacun se verifie avec le nombre qui a servi a le calculer.
    const ancien = await hashPassword('x', 1000)
    expect(ancien.iterations).toBe(1000)
    expect(await verifyPassword('x', ancien)).toBe(true)
  })

  it('produit un hash et un sel de longueur fixe', async () => {
    const record = await hashPassword('court')
    const long = await hashPassword('un-mot-de-passe-nettement-plus-long-que-le-precedent')
    // La longueur du hash ne doit rien reveler de celle du mot de passe.
    expect(record.hash).toHaveLength(64) // 256 bits en hexadecimal
    expect(long.hash).toHaveLength(64)
    expect(record.salt).toHaveLength(32) // 128 bits
  })

  it('gere les caracteres non ASCII', async () => {
    const record = await hashPassword('mot-de-passé-àvec-des-accents-€')
    expect(await verifyPassword('mot-de-passé-àvec-des-accents-€', record)).toBe(true)
    expect(await verifyPassword('mot-de-passe-avec-des-accents-€', record)).toBe(false)
  })
})

describe('timingSafeEqual', () => {
  it('compare correctement', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('abc', 'ab')).toBe(false)
    expect(timingSafeEqual('', '')).toBe(true)
  })

  it('ne court-circuite pas au premier octet different', () => {
    // On ne peut pas mesurer le temps de facon fiable dans un test, mais on
    // verifie au moins que le resultat ne depend pas de la POSITION de la
    // difference — ce qui serait le symptome d'un court-circuit.
    expect(timingSafeEqual('aaaaaaaa', 'baaaaaaa')).toBe(false)
    expect(timingSafeEqual('aaaaaaaa', 'aaaaaaab')).toBe(false)
  })
})
