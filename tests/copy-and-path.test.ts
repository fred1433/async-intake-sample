/**
 * Words the functions must keep, Spanish that the engine composes, and the
 * resume path of the sample file. From the second reviewer's list on the
 * finished result (20 September 2026), groups C, D and E.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addToRequest, buildReview, requestText } from "../src/lib/engine/review";
import { DICTIONARIES } from "../src/lib/i18n";
import { sampleIntakeDraft, submissionFromDraft } from "../src/lib/intake-draft";
import { loadReview, resetToSample } from "../src/lib/review-store";
import { SAMPLE_REFERENCE, SAMPLE_SUBMISSION } from "../src/lib/sample";
import { INTAKE_PREFIX, loadJSON } from "../src/lib/storage";
import { promptQuestions, TEMPLATE } from "../src/lib/template";
import { NOW, RAW_DRAFT, draft, submission } from "./helpers";

const ROOT = path.resolve(import.meta.dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const UI = walk(path.join(ROOT, "src"));
const uiText = () => UI.map((f) => readFileSync(f, "utf8")).join("\n");

class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

describe("C. words the functions keep", () => {
  it("13. the request card does not say the AI drafted it: rule 1 composes it", () => {
    expect(uiText()).not.toMatch(/Draft by AI/);
    expect(uiText()).toMatch(/Prepared by rule/);
  });

  it("14. saving the form is not sending: no Sent, no Enviado, and the text says nothing left the device", () => {
    for (const lang of ["en", "es"] as const) {
      const d = DICTIONARIES[lang];
      expect(d.review.sentTitle).not.toMatch(/^(Sent|Enviado)$/);
      expect(d.review.sentIntro("SB-0000")).not.toMatch(/office will write|oficina le escribir/);
      expect(d.review.submit).not.toMatch(/Send to the office|Enviar a la oficina/);
    }
    expect(DICTIONARIES.en.review.sentTitle).toBe("Saved for sample review");
    expect(DICTIONARIES.es.review.sentTitle).toBe("Guardado para la revisión de muestra");
    expect(DICTIONARIES.en.review.sentIntro("SB-0000")).toMatch(/Nothing was sent/);
    expect(DICTIONARIES.es.review.sentIntro("SB-0000")).toMatch(/No se envió nada/);
  });

  it("15. no active instruction the sample does not enforce: the prompt says what the device check is", () => {
    const flat = JSON.stringify(DICTIONARIES, (_k, v) => (typeof v === "function" ? v("60", "60") : v));
    expect(flat).not.toMatch(/One retake allowed|Se permite una repetici/);
    expect(flat).not.toMatch(/Up to 60 seconds|Hasta 60 segundos/);
    expect(DICTIONARIES.en.prompt.deviceNote).toBe("Optional 10-second camera and microphone check. Nothing is uploaded.");
    expect(DICTIONARIES.es.prompt.deviceNote).toMatch(/10 segundos/);
    const prompt = promptQuestions(TEMPLATE)[0] as unknown as Record<string, unknown>;
    expect(prompt.maxSeconds).toBeUndefined();
    expect(prompt.retakes).toBeUndefined();
  });

  it("16. the provider license line says not checked, not present", () => {
    const state = buildReview(submission(), draft(), NOW);
    const license = state.propositions.find((p) => p.id.endsWith(":license"))!;
    expect(license.finding).toBe("not_checked");
    expect(license.statement).toMatch(/Not checked/);
  });

  it("17. no persistent \"Computed just now\" in the page: a live draft is dated", () => {
    expect(uiText()).not.toMatch(/Computed just now/);
  });

  it("18. the two invented date rules say they are sample administrative rules", () => {
    const state = buildReview(submission(), draft(), NOW);
    const referral = state.propositions.find((p) => p.id === "field:referral-letter:referral_date")!;
    expect(referral.criterion?.rule).toMatch(/Sample administrative rule/);
    const s = submission();
    s.documents.insurance_card = { status: "received", mediaId: "insurance-card", receivedAt: NOW };
    const withCard = buildReview(s, draft(), NOW);
    expect(withCard.propositions.find((p) => p.id === "field:insurance-card:effective_date")?.criterion?.rule).toMatch(/Sample administrative rule/);
  });

  it("19. the panel names the providers actually used, without model names", () => {
    const about = readFileSync(path.join(ROOT, "src/components/landing/About.tsx"), "utf8");
    expect(about).toMatch(/Anthropic/);
    expect(about).toMatch(/Google/);
    expect(about).not.toMatch(/claude-|gemini-|sonnet|opus/i);
    expect(about).not.toMatch(/never taken from the model|never reprised as is/i);
  });
});

describe("D. Spanish the engine composes", () => {
  const spanish = () => {
    const s = submission({ language: "es" });
    s.answers.contact_language = "es";
    return s;
  };

  it("20. a time or place to confirm is asked in Spanish, from structured data, never from the English statement", () => {
    // The recording says after three, at home (both in the quoted words); the form says morning, at the center.
    const s = spanish();
    s.answers.preferred_time = "morning";
    s.answers.location = "center";
    s.answers.preferred_days = ["tuesday"];
    let state = buildReview(s, draft(), NOW);
    expect(state.propositions.find((p) => p.id === "xcheck:time")?.finding).toBe("conflicting");
    expect(state.propositions.find((p) => p.id === "xcheck:location")?.finding).toBe("conflicting");
    state = addToRequest(state, "xcheck:time", NOW);
    state = addToRequest(state, "xcheck:location", NOW);
    const text = state.request!.text;
    expect(text).not.toMatch(/The form|recorded answer|To confirm/);
    expect(text).toMatch(/su formulario indica mañana, y en su respuesta grabada dice a partir de las 15:00/);
    expect(text).toMatch(/su formulario indica en el centro, y en su respuesta grabada dice en casa/);
    expect(text).toMatch(/También quisiéramos confirmar algunas cosas:/);
  });

  it("20b. a form day the recording does not mention is asked in Spanish too", () => {
    const s = spanish();
    s.answers.preferred_days = ["monday"];
    let state = buildReview(s, draft(), NOW);
    state = addToRequest(state, "xcheck:days", NOW);
    expect(state.request!.text).toMatch(/su formulario indica lunes, y en su respuesta grabada menciona los martes/);
    expect(state.request!.text).not.toMatch(/The form|Monday/);
  });

  it("21. an unusable recording is asked for again as a recording, not as a photo", () => {
    const truncated = draft(RAW_DRAFT, { segments: [{ start: 0, end: 1.5, text: "Tuesdays work best for" }], complete: false, note: "The audio stops after 1.5 seconds." });
    const es = buildReview(spanish(), truncated, NOW);
    expect(es.request!.text).toMatch(/Su respuesta grabada: no pudimos usar la grabación. ¿Podría grabar su respuesta de nuevo\?/);
    expect(es.request!.text).not.toMatch(/foto/);
    const en = buildReview(submission(), truncated, NOW);
    expect(en.request!.text).toMatch(/we could not use the recording. Could you record your answer again\?/);
    expect(en.request!.text).not.toMatch(/photo/);
  });

  it("22. the request follows the preferred language for messages, with the form language as the fallback", () => {
    const s = submission({ language: "en" });
    s.answers.contact_language = "es";
    expect(requestText(s, [], [{ propositionId: "doc:insurance_card", kind: "missing_item" }], "SB-0000")).toMatch(/^Hola Jordan:/);
    const t = submission({ language: "es" });
    t.answers.contact_language = "en";
    expect(requestText(t, [], [{ propositionId: "doc:insurance_card", kind: "missing_item" }], "SB-0000")).toMatch(/^Hi Jordan,/);
    const u = submission({ language: "es" });
    delete u.answers.contact_language;
    expect(requestText(u, [], [{ propositionId: "doc:insurance_card", kind: "missing_item" }], "SB-0000")).toMatch(/^Hola Jordan:/);
  });

  it("22b. media titles and the sample badge have a Spanish label", () => {
    expect(DICTIONARIES.es.media["referral-letter"]).toBeTruthy();
    expect(DICTIONARIES.es.media["referral-letter"]).not.toBe(DICTIONARIES.en.media["referral-letter"]);
    expect(DICTIONARIES.es.prompt.sampleBadge).toBe("muestra");
    expect(DICTIONARIES.en.prompt.sampleBadge).toBe("sample");
  });
});

describe("E. the demonstration path", () => {
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = { localStorage: new MemoryStorage() };
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("23. the code shown in the sample request resumes a saved form: the sample file has an intake draft", () => {
    loadReview(NOW);
    const saved = loadJSON<{ code: string; step: number; documents: Record<string, { status: string }> }>(INTAKE_PREFIX + SAMPLE_REFERENCE);
    expect(saved?.code).toBe(SAMPLE_REFERENCE);
    expect(saved?.documents.insurance_card.status).toBe("missing");
    expect(saved?.documents.referral_letter.status).toBe("received");
    window.localStorage.clear();
    resetToSample(NOW);
    expect(loadJSON(INTAKE_PREFIX + SAMPLE_REFERENCE)).toBeTruthy();
  });

  it("23b. a sample form saved again continues the sample submission: version 2, same first submission date", () => {
    const form = sampleIntakeDraft();
    form.documents.insurance_card = { status: "received", mediaId: "insurance-card", receivedAt: NOW };
    const again = submissionFromDraft(form, null, NOW);
    expect(again.reference).toBe(SAMPLE_REFERENCE);
    expect(again.version).toBe(SAMPLE_SUBMISSION.version + 1);
    expect(again.submittedAt).toBe(SAMPLE_SUBMISSION.submittedAt);
    expect(again.documents.insurance_card.status).toBe("received");
    const fresh = submissionFromDraft({ ...form, code: "SB-NEW1" }, null, NOW);
    expect(fresh.version).toBe(1);
    expect(fresh.submittedAt).toBe(NOW);
  });

  it("23c. the sample draft carries a signature, so the signature step is complete as displayed", () => {
    expect(sampleIntakeDraft().signature?.name).toBe(SAMPLE_SUBMISSION.signature?.name);
  });

  it("24. the parent side speaks of this device, not of browsers and production builds", () => {
    for (const lang of ["en", "es"] as const) {
      const d = DICTIONARIES[lang];
      expect(d.resumeHelp).not.toMatch(/browser|navegador|production|producción/i);
      expect(d.savedNote).not.toMatch(/browser|navegador/i);
    }
  });
});
