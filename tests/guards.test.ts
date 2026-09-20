/**
 * Text and shape guards over the repository itself: no em dash, no compliance
 * claim, no "Human reviewed" label, no names that do not belong here, and a
 * Spanish dictionary that mirrors the English one key for key.
 */
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

const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: /—/, why: "em dash" },
  { pattern: /human[\s-]reviewed/i, why: "review is an action the reviewer takes, not a label" },
  { pattern: /HIPAA[\s-]compliant|compliant with HIPAA|HIPAA compliance/i, why: "no compliance claim" },
  { pattern: /\bUpwork\b/i, why: "no marketplace" },
];

describe("text guards over the repository", () => {
  it("scans at least the source, the sample and the tests", () => {
    expect(FILES.some((f) => f.endsWith("src/lib/i18n.ts"))).toBe(true);
    expect(FILES.some((f) => f.endsWith("sample/documents.json"))).toBe(true);
  });

  for (const { pattern, why } of FORBIDDEN) {
    it(`finds no "${pattern.source}" (${why})`, () => {
      const hits = FILES.filter((f) => !f.endsWith("tests/guards.test.ts") && pattern.test(readFileSync(f, "utf8")));
      expect(hits.map((f) => path.relative(ROOT, f))).toEqual([]);
    });
  }

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
    expect(prompts[0].retakes).toBe(1);
    expect(prompts[0].prepSeconds).toBeGreaterThan(0);
  });

  it("requests two documents, both required, both with a sample file", () => {
    const docs = documentItems(TEMPLATE);
    expect(docs.map((d) => d.id)).toEqual(["referral_letter", "insurance_card"]);
    expect(docs.every((d) => d.required && d.sampleMediaId)).toBe(true);
  });
});
