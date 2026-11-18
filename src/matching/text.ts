const LEGAL_FORMS = new Set(['sas', 'sarl', 'sa', 'sasu', 'eurl']);

// Lower case, no accents, split on anything that is not a letter or a digit.
export function toWords(value: string | null): string[] {
  if (!value) {
    return [];
  }
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

// The legal form (SAS, SARL...) is rarely written in a bank label, so it does not count.
export function supplierWords(supplierName: string | null): string[] {
  return toWords(supplierName).filter((word) => !LEGAL_FORMS.has(word));
}

// True when the words appear in the label one after the other, in the same order.
// No words (an empty name or number) never match.
export function containsWords(labelWords: string[], words: string[]): boolean {
  if (words.length === 0) {
    return false;
  }
  for (let start = 0; start + words.length <= labelWords.length; start++) {
    if (words.every((word, offset) => labelWords[start + offset] === word)) {
      return true;
    }
  }
  return false;
}
