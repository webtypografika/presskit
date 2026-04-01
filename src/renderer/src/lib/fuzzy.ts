/**
 * Normalize a string for fuzzy matching:
 * - lowercase
 * - remove accents/diacritics (Greek & Latin)
 */
export function normalize(str: string): string {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * Fuzzy match: checks if query words appear in text (in any order)
 */
export function fuzzyMatch(text: string, query: string): boolean {
  const normalizedText = normalize(text)
  const words = normalize(query).split(/\s+/).filter(Boolean)
  return words.every(w => normalizedText.includes(w))
}
