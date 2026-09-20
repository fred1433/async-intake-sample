/**
 * Text and shape guards over the repository itself: no em dash, no compliance
 * claim, no "reviewed by a human" label, no name that does not belong here, and a
 * Spanish dictionary that mirrors the English one key for key.
 *
 * The names that must not appear are not written in this file either: the
 * guard compares SHA-256 digests of lowercase words and two-word phrases with a
 * list of digests. This file scans itself like every other file.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DICTIONARIES } from "../src/lib/i18n";
import { documentItems, fieldQuestions, promptQuestions, TEMPLATE } from "../src/lib/template";

const ROOT = path.resolve(import.meta.dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", ".git", ".vercel", "public"].includes(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|md|json|mjs|mts|yml|css|py|txt)$/.test(name)) out.push(full);
  }
  return out;
}

const FILES = walk(ROOT).filter((f) => !f.includes("package-lock.json") && !/AGENTS\.md$|CLAUDE\.md$/.test(f));

// Patterns are assembled from pieces so that this file, scanned like the others, does not match them.
const EM_DASH = String.fromCodePoint(0x2014);
const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: new RegExp(EM_DASH), why: "em dash" },
  { pattern: new RegExp("human[\\s-]" + "reviewed", "i"), why: "review is an action the reviewer takes, not a label" },
  { pattern: new RegExp(["HIPAA[\\s-]" + "compliant", "compliant with " + "HIPAA", "HIPAA " + "compliance"].join("|"), "i"), why: "no compliance claim" },
  { pattern: /\bUpwork\b/i, why: "no marketplace" },
];

/** SHA-256 of lowercase words or two-word phrases that must not appear anywhere in this repository. */
const FORBIDDEN_DIGESTS = new Set([
  "ca6e99a67a7a8aa26bc06888370d71fb66f111b0cef45f80ec223f664bda8367",
  "6827e526d72db22837fcc841720d1b971fe2b3bd9a968a83a91c10e00c9159cc",
  "512762f8951a460c9bb86e8e104242eb0e4412a4ecb4a2c86b0c6321df6b80fc",
  "3dc62d26b14620ec7ce5e12d603bc0ba98c4eaccaaac6d0efae9ec3695ae6d29",
]);

const digest = (text: string) => createHash("sha256").update(text).digest("hex");

/** Words and adjacent word pairs of a text, lowercased, whose digest is in the set. */
export function forbiddenPhrases(text: string, digests: Set<string> = FORBIDDEN_DIGESTS): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const found = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    if (digests.has(digest(words[i]))) found.add(words[i]);
    if (i + 1 < words.length) {
      const pair = `${words[i]} ${words[i + 1]}`;
      if (digests.has(digest(pair))) found.add(pair);
    }
  }
  return [...found];
}

describe("text guards over the repository", () => {
  it("scans at least the source, the sample, the tests and this file", () => {
    expect(FILES.some((f) => f.endsWith("src/lib/i18n.ts"))).toBe(true);
    expect(FILES.some((f) => f.endsWith("sample/documents.json"))).toBe(true);
    expect(FILES.some((f) => f.endsWith("tests/guards.test.ts"))).toBe(true);
  });

  for (const { pattern, why } of FORBIDDEN) {
    it(`finds no "${pattern.source}" (${why})`, () => {
      const hits = FILES.filter((f) => pattern.test(readFileSync(f, "utf8")));
      expect(hits.map((f) => path.relative(ROOT, f))).toEqual([]);
    });
  }

  it("finds no word or phrase whose digest is on the list (no real organization or person)", () => {
    const hits = FILES.filter((f) => forbiddenPhrases(readFileSync(f, "utf8")).length > 0);
    expect(hits.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it("the digest scan does catch a listed word and a listed phrase (self-test with throwaway digests)", () => {
    const digests = new Set([digest("placeholderword"), digest("two words")]);
    expect(forbiddenPhrases("Nothing here.", digests)).toEqual([]);
    expect(forbiddenPhrases("A PlaceholderWord in a sentence.", digests)).toEqual(["placeholderword"]);
    expect(forbiddenPhrases("Two Words, then more.", digests)).toEqual(["two words"]);
    expect(forbiddenPhrases("Two other words.", digests)).toEqual([]);
  });

  it("keeps the page free of model names", () => {
    const uiFiles = FILES.filter((f) => f.includes(`${path.sep}src${path.sep}app`) || f.includes(`${path.sep}src${path.sep}components`));
    const hits = uiFiles.filter((f) => /claude-|gemini-|sonnet|opus/i.test(readFileSync(f, "utf8")));
    expect(hits.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});

function keysOf(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => keysOf(v, prefix ? `${prefix}.${k}` : k));
}

describe("the two languages of the parent flow", () => {
  it("have the same keys", () => {
    expect(keysOf(DICTIONARIES.es).sort()).toEqual(keysOf(DICTIONARIES.en).sort());
  });

  it("label every field, option and document in both languages", () => {
    for (const lang of ["en", "es"] as const) {
      const d = DICTIONARIES[lang];
      for (const q of fieldQuestions(TEMPLATE)) {
        expect(d.fields[q.id], `${lang} ${q.id}`).toBeTruthy();
        for (const option of q.options ?? []) expect(d.options[option], `${lang} ${q.id} ${option}`).toBeTruthy();
      }
      for (const doc of documentItems(TEMPLATE)) expect(d.documents[doc.id], `${lang} ${doc.id}`).toBeTruthy();
    }
  });

  it("differ from each other where it matters", () => {
    expect(DICTIONARIES.es.bannerTop).not.toBe(DICTIONARIES.en.bannerTop);
    expect(DICTIONARIES.es.prompt.question).not.toBe(DICTIONARIES.en.prompt.question);
  });
});

describe("the template", () => {
  it("separates form fields from recorded prompts", () => {
    const fields = fieldQuestions(TEMPLATE);
    const prompts = promptQuestions(TEMPLATE);
    expect(fields.map((f) => f.id)).toContain("preferred_days");
    expect(fields.some((f) => f.id === "scheduling_prompt")).toBe(false);
    expect(prompts.map((p) => p.id)).toEqual(["scheduling_prompt"]);
    expect(prompts[0].prepSeconds).toBeGreaterThan(0);
  });

  it("requests two documents, both required, both with a sample file", () => {
    const docs = documentItems(TEMPLATE);
    expect(docs.map((d) => d.id)).toEqual(["referral_letter", "insurance_card"]);
    expect(docs.every((d) => d.required && d.sampleMediaId)).toBe(true);
  });
});
