import { describe, expect, it } from 'vitest';
import { containsWords, supplierWords, toWords } from './text';

describe('toWords', () => {
  it('lowercases and removes accents', () => {
    expect(toWords('Société Générale')).toEqual(['societe', 'generale']);
  });

  it('splits on anything that is not a letter or a digit', () => {
    expect(toWords('PRLV SEPA ORANGE-SA/2024')).toEqual(['prlv', 'sepa', 'orange', 'sa', '2024']);
  });

  it('keeps the leading zeros of a number', () => {
    expect(toWords('FACT 0512')).toEqual(['fact', '0512']);
  });

  it('gives no word for null, empty or punctuation only', () => {
    expect(toWords(null)).toEqual([]);
    expect(toWords('')).toEqual([]);
    expect(toWords(' - / ')).toEqual([]);
  });
});

describe('supplierWords', () => {
  it('drops the legal form', () => {
    expect(supplierWords('SFRI SARL')).toEqual(['sfri']);
    expect(supplierWords('Atelier Lumière SAS')).toEqual(['atelier', 'lumiere']);
  });

  it('gives no word when the name is null or only a legal form', () => {
    expect(supplierWords(null)).toEqual([]);
    expect(supplierWords('SAS')).toEqual([]);
  });
});

describe('containsWords', () => {
  it('finds whole words in the label', () => {
    expect(containsWords(['virement', 'sfri', 'sarl'], ['sfri'])).toBe(true);
  });

  it('does not find a word inside a longer word', () => {
    expect(containsWords(['prlv', 'sfridge'], ['sfri'])).toBe(false);
  });

  it('needs the words one after the other, in order', () => {
    expect(containsWords(['google', 'cloud', 'emea'], ['google', 'cloud'])).toBe(true);
    expect(containsWords(['cloud', 'google'], ['google', 'cloud'])).toBe(false);
    expect(containsWords(['google', 'x', 'cloud'], ['google', 'cloud'])).toBe(false);
  });

  it('never matches when there are no words (empty invoice number)', () => {
    expect(containsWords(['virement', 'sfri'], [])).toBe(false);
    expect(containsWords([], [])).toBe(false);
  });

  it('does not match when the label is shorter than the words', () => {
    expect(containsWords(['google'], ['google', 'cloud'])).toBe(false);
  });
});
