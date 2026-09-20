# Async intake, sample review

A fictional patient intake, end to end: a parent completes a guided form on a phone, two model calls turn the sample documents and the sample recording into a draft, and a reviewer checks every claim against its source before approving anything.

Live: https://async-intake.theaipipe.com

Everything on the page is invented. The family, the practice, the health plan, the numbers. The banner says so, and the server only ever processes the sample media the page provides.

## What is in the sample

- One intake file: a parent, a child, a referral letter (received), an insurance card (not received), one recorded answer about scheduling.
- The parent's flow (`/intake`): English and Spanish, save and resume in this browser, sample documents to attach, a prompt with preparation time and a local camera and microphone check that sends nothing.
- The reviewer's view (`/review`): every proposition of the draft with its exact statement (editable), its source (the page with the passage marked, or the audio segment with start and end), its nature (extraction, rephrase, inference, or computed by rule), the criterion applied and its rule, and its state (proposed, corrected, approved) with the earlier values and their author.
- Three rules, run for real:
  1. A required item is missing → a request to the family is prepared, in the parent's language. It is not sent.
  2. Two sources disagree, or an extraction is uncertain → the file waits for a reviewer. Nothing is chosen for the family.
  3. The reviewer approves the current version → the file moves to its next administrative step, and the journal keeps the approved version.

## What runs for real, and what does not

- Transcription of the recording and extraction from the documents are two model calls (`src/lib/ai/pipeline.ts`). The models come from the environment, never from the code. The review shown first is a recorded run (`src/lib/fixtures/recorded-draft.json`); the "Run again" button repeats the two calls live, under a daily cap held in the memory of one server process (`src/lib/limits.ts`), with the durable limit being the spend limit on the provider workspace this deployment calls. When the cap is reached, the recorded review stays available and says it is recorded.
- Every quote the models return is checked against the document text layer, and every audio segment is located by the code from the quoted words (`src/lib/engine/verify.ts`). What fails the check is withheld and listed.
- The review state, the form progress and the resume code live in the browser. No account, no server-side record, no cross-device resume, no message sent, no upload of the visitor's own files.
- No compliance claim of any kind. What would come before any patient data is listed on the page and is not claimed here.

## Run it

```bash
npm install
npm test            # engine, source check, rules, text guards, recorded fixture; no network
npm run dev         # http://localhost:3000, recorded review only unless the variables below are set
```

Live runs need `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `GEMINI_API_KEY`, `GEMINI_MODEL` and `DEMO_SPEND_LIMIT_USD` (the monthly limit set on the provider workspace). Optional: `DEMO_DAILY_CAP` (default 40) and `DEMO_ADDRESS_DAILY_CAP` (default 5).

```bash
npm run fixtures            # recompute the recorded run (two real calls)
npm run translation:review  # ask a second model to read the Spanish copy (one real call)
npm run sample:render       # re-render the sample documents from sample/documents.json (needs playwright)
```

## Layout

- `src/lib/template.ts`: the intake template, which questions are fields and which one is a recorded prompt, which documents are requested.
- `src/lib/sample.ts`, `sample/`: the fictional media and their text layers, the sample submission.
- `src/lib/engine/`: raw model shapes, the source check, the review (propositions, rules, actions, journal).
- `src/lib/ai/`: the two model calls and their prompts.
- `src/app/api/rerun/`: the live run, capped.
- `src/components/`: landing, parent flow, reviewer view.
- `tests/`: 58 tests, including counter-examples that must fail the source check.
