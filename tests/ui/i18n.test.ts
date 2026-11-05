import { describe, expect, it } from "vitest";

type WordValue = string | ((...args: string[]) => string);
type LanguageWords = Record<string, WordValue>;

const wordModules = import.meta.glob("../../public/js/i18n.js", { eager: true, import: "words" });
const words = Object.values(wordModules)[0] as unknown as Record<string, LanguageWords>;
const memberModules = import.meta.glob("../../public/js/member.js", { query: "?raw", import: "default", eager: true });
const memberSource = Object.values(memberModules)[0] as string;
const functionSamples = ["Mina", "June", "$25"];

function renderedValues(language: LanguageWords): Array<[string, string]> {
  return Object.entries(language).map(([key, value]) => [key, typeof value === "function" ? value(...functionSamples) : value]);
}

describe("member page translations", () => {
  it("has matching keys and value types in Spanish and French", () => {
    for (const [key, englishValue] of Object.entries(words.en)) {
      expect(words.es, `Missing Spanish translation: ${key}`).toHaveProperty(key);
      expect(words.fr, `Missing French translation: ${key}`).toHaveProperty(key);
      expect(typeof words.es[key], `Spanish type mismatch: ${key}`).toBe(typeof englishValue);
      expect(typeof words.fr[key], `French type mismatch: ${key}`).toBe(typeof englishValue);
    }
  });

  it("returns non empty strings without undefined from every translation function", () => {
    for (const [language, dictionary] of Object.entries(words)) {
      for (const [key, value] of Object.entries(dictionary)) {
        if (typeof value === "function") {
          const result = value(...functionSamples);
          expect(typeof result, `${language}.${key} should return a string`).toBe("string");
          expect(result.trim(), `${language}.${key} should not be empty`).not.toBe("");
          expect(result, `${language}.${key} should not contain undefined`).not.toContain("undefined");
        }
      }
    }
  });

  it("does not use dash punctuation in any translation value", () => {
    for (const [language, dictionary] of Object.entries(words)) {
      for (const [key, value] of renderedValues(dictionary)) {
        expect(value, `${language}.${key}`).not.toContain(" - ");
        expect(value, `${language}.${key}`).not.toMatch(/[\u2013\u2014]/);
      }
    }
  });

  it("defines every translation key used by member.js", () => {
    const usedKeys = new Set([...memberSource.matchAll(/\bt\.([A-Za-z_$][\w$]*)/g)].map((match) => match[1]));
    for (const key of usedKeys) expect(words.en, `member.js uses missing translation: ${key}`).toHaveProperty(key);
  });
});
