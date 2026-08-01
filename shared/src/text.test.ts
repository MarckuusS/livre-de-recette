import { describe, expect, it } from 'vitest'
import { escapeLike, normalizeName, toFtsQuery } from './text.js'

describe('normalizeName', () => {
  it('plie la casse et les accents', () => {
    expect(normalizeName('Crème Fraîche')).toBe('creme fraiche')
    expect(normalizeName('ÉPINARD')).toBe('epinard')
    expect(normalizeName('Pâté')).toBe('pate')
  })

  it('decompose les ligatures — ce que FTS5 ne fait pas', () => {
    // C'est la raison d'etre de la colonne name_normalized : le tokenizer
    // `unicode61 remove_diacritics 2` retire les accents mais laisse « Œuf »
    // intact, donc « oeuf » ne le trouve jamais (verifie par check-fts5.mjs).
    expect(normalizeName('Œuf')).toBe('oeuf')
    expect(normalizeName('œuf de caille')).toBe('oeuf de caille')
    expect(normalizeName('Ex æquo')).toBe('ex aequo')
    expect(normalizeName('Straße')).toBe('strasse')
  })

  it('collapse les espaces et rogne les bords', () => {
    expect(normalizeName('  tomate   cerise  ')).toBe('tomate cerise')
    expect(normalizeName('tomate\tcerise')).toBe('tomate cerise')
  })

  it('tolere null et undefined', () => {
    expect(normalizeName(null)).toBe('')
    expect(normalizeName(undefined)).toBe('')
    expect(normalizeName('')).toBe('')
  })

  it('est idempotent', () => {
    for (const s of ['Crème Brûlée', 'Œuf', '  Épinard  ']) {
      expect(normalizeName(normalizeName(s))).toBe(normalizeName(s))
    }
  })
})

describe('toFtsQuery', () => {
  it('met chaque token entre guillemets avec un joker de prefixe', () => {
    expect(toFtsQuery('tomate')).toBe('"tomate"*')
    expect(toFtsQuery('pomme de terre')).toBe('"pomme"* "de"* "terre"*')
  })

  it('neutralise un guillemet double sans planter', () => {
    // Bug #3 : `to"mate` cassait la syntaxe FTS5 et remontait une erreur SQL
    // 500 non rattrapee, declenchable par une saisie tout a fait ordinaire.
    expect(toFtsQuery('to"mate')).toBe('"to""mate"*')
    expect(() => toFtsQuery('""""')).not.toThrow()
  })

  it('retire les caracteres de syntaxe FTS5', () => {
    expect(toFtsQuery('tomate*')).toBe('"tomate"*')
    expect(toFtsQuery('name:tomate')).toBe('"nametomate"*')
  })

  it('rend null quand il ne reste rien a chercher', () => {
    // L'appelant doit alors lister sans filtre : un MATCH vide leve en SQLite.
    expect(toFtsQuery('')).toBeNull()
    expect(toFtsQuery('   ')).toBeNull()
    expect(toFtsQuery(null)).toBeNull()
    expect(toFtsQuery('* ^ :')).toBeNull()
  })
})

describe('escapeLike', () => {
  it('echappe les jokers SQL', () => {
    expect(escapeLike('100%')).toBe('100\\%')
    expect(escapeLike('a_b')).toBe('a\\_b')
    expect(escapeLike('c:\\temp')).toBe('c:\\\\temp')
  })
})
