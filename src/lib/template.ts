/**
 * The intake template of the sample: which questions are form fields, which
 * document items are requested, and which question is a recorded prompt.
 *
 * It is a file in this repository, read by the parent flow and by the review.
 * It is not an administration screen: changing it here means a deployment.
 * Every label is fictional and administrative. Nothing here scores anything.
 */
export type FieldType = "text" | "date" | "tel" | "email" | "select" | "multi";

export interface FieldQuestion {
  kind: "field";
  id: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
}

export interface PromptQuestion {
  kind: "prompt";
  id: string;
  prepSeconds: number;
  maxSeconds: number;
  retakes: number;
  /** The fictional recording the page provides for this prompt. */
  sampleMediaId: string;
}

export interface DocumentItem {
  id: string;
  required: boolean;
  /** The fictional file the page provides for this item, when there is one. */
  sampleMediaId?: string;
}

export interface TemplateSection {
  id: "child" | "guardian" | "scheduling" | "documents" | "recorded" | "signature";
  questions?: (FieldQuestion | PromptQuestion)[];
  documents?: DocumentItem[];
}

export interface IntakeTemplate {
  id: string;
  organization: string;
  sections: TemplateSection[];
}

export const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
export type Day = (typeof DAYS)[number];

export const TIME_OPTIONS = ["morning", "early_afternoon", "after_3pm", "evening"] as const;
export const LOCATION_OPTIONS = ["home", "center", "either"] as const;
export const LANGUAGE_OPTIONS = ["english", "spanish", "both", "other"] as const;
export const RELATIONSHIP_OPTIONS = ["parent", "legal_guardian", "other"] as const;
export const CONTACT_LANGUAGE_OPTIONS = ["en", "es"] as const;

export const TEMPLATE: IntakeTemplate = {
  id: "family-intake-sample-v1",
  organization: "Sample Behavioral Health",
  sections: [
    {
      id: "child",
      questions: [
        { kind: "field", id: "child_first_name", type: "text", required: true },
        { kind: "field", id: "child_last_name", type: "text", required: true },
        { kind: "field", id: "child_dob", type: "date", required: true },
        { kind: "field", id: "home_language", type: "select", options: [...LANGUAGE_OPTIONS] },
      ],
    },
    {
      id: "guardian",
      questions: [
        { kind: "field", id: "guardian_name", type: "text", required: true },
        { kind: "field", id: "relationship", type: "select", options: [...RELATIONSHIP_OPTIONS] },
        { kind: "field", id: "phone", type: "tel", required: true },
        { kind: "field", id: "email", type: "email" },
        { kind: "field", id: "contact_language", type: "select", options: [...CONTACT_LANGUAGE_OPTIONS] },
      ],
    },
    {
      id: "scheduling",
      questions: [
        { kind: "field", id: "preferred_days", type: "multi", options: [...DAYS] },
        { kind: "field", id: "preferred_time", type: "select", options: [...TIME_OPTIONS] },
        { kind: "field", id: "location", type: "select", options: [...LOCATION_OPTIONS] },
      ],
    },
    {
      id: "documents",
      documents: [
        { id: "referral_letter", required: true, sampleMediaId: "referral-letter" },
        { id: "insurance_card", required: true, sampleMediaId: "insurance-card" },
      ],
    },
    {
      id: "recorded",
      questions: [
        {
          kind: "prompt",
          id: "scheduling_prompt",
          prepSeconds: 20,
          maxSeconds: 60,
          retakes: 1,
          sampleMediaId: "recording-scheduling",
        },
      ],
    },
    { id: "signature" },
  ],
};

export function fieldQuestions(template: IntakeTemplate = TEMPLATE): FieldQuestion[] {
  return template.sections.flatMap((section) =>
    (section.questions ?? []).filter((q): q is FieldQuestion => q.kind === "field"),
  );
}

export function promptQuestions(template: IntakeTemplate = TEMPLATE): PromptQuestion[] {
  return template.sections.flatMap((section) =>
    (section.questions ?? []).filter((q): q is PromptQuestion => q.kind === "prompt"),
  );
}

export function documentItems(template: IntakeTemplate = TEMPLATE): DocumentItem[] {
  return template.sections.flatMap((section) => section.documents ?? []);
}
