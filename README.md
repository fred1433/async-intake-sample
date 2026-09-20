# Async intake, sample review

A fictional patient intake, end to end: a parent completes a guided form on a phone, two model calls turn the sample documents and the sample recording into a draft, and a reviewer checks every claim against its source before approving anything.

Live: https://async-intake.theaipipe.com

Everything on the page is invented. The family, the practice, the health plan, the numbers. The banner says so, and the server only ever processes the sample media the page provides.

## What is in the sample

- One intake file: a parent, a child, a referral letter (received), an insurance card (not received), one recorded answer about scheduling.
- The parent's flow (`/intake`): English and Spanish, save and resume on this device (the sample file resumes with its own code), sample documents to attach, a prompt with preparation time and an optional 10-second camera and microphone check that sends nothing.
- The reviewer's view (`/review`): every proposition of the draft with its exact statement (editable), its source (the page with the passage marked, or the audio segment with start and end), what the code checked about it, its nature (extraction, rephrase, inference, or computed by rule), the criterion applied and its rule, and its state (proposed, corrected, approved) with the earlier values and their author. The request to the family can be corrected before it is approved; the journal keeps every approved text.
- Three rules, run for real:
  1. A required item is missing → a request to the family is prepared, in the parent's language. It is not sent.
  2. Two sources disagree, or an extraction is uncertain → the file waits for a reviewer. Nothing is chosen for the family.
  3. The reviewer approves the current version → the file moves to its next administrative step, and the journal keeps the approved version.

## What runs for real, and what does not

- Transcription of the recording (a Google model) and extraction from the documents and the transcript (an Anthropic model) are two model calls (`src/lib/ai/pipeline.ts`). The models come from the environment, never from the code. The review shown first is a recorded run (`src/lib/fixtures/recorded-draft.json`); the "Run again" button repeats the two calls live, under a daily cap held in the memory of one server process (`src/lib/limits.ts`), with the durable limit being the spend limit on the provider workspace this deployment calls. When the cap is reached, the recorded review stays available and says it is recorded. One counter, taken before the first call, bounds both providers; a transcript is kept for the day so a failed extraction does not repeat the transcription; repeated provider errors pause live runs.
- Every quote the models return is checked against the document text layer, every value against its quote and every machine-form date against the dates written in the passage. Every audio segment is located by the code from the quoted words, within the timestamps the transcription returned, and checked against the length of the recording; the days, hour and place a claim carries must be in the quoted words, negation included; a free statement must stay administrative and be supported by its quote (`src/lib/engine/verify.ts`). What fails the check is withheld and shown in the review as not evaluable, with its reason, never as a fact. The wording of a rephrased statement is the model's: the claim says what the code checked, and the reviewer judges the wording against the recording. Whether a recording was cut off is what the transcription model reports; the code does not detect that on its own.
- Every proposition carries a digest of what its source gave it (statement, nature, finding, evidence, criterion). A new draft or a new submission that changes any of it proposes the item again, with the reviewer's earlier work in the history; a request whose text changes after approval goes back to draft with the approved text kept; the file approval names a SHA-256 of the whole content, request included, and ends the moment any of it changes (`src/lib/engine/review.ts`). A form the family saves again replaces the whole file under review, not only its added documents.
- The review state, the form progress and the resume code live on the device. No account, no server-side record, no cross-device resume, no message sent, no upload of the visitor's own files. Saving the form hands it to the reviewer view on the same device; it sends nothing.
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
npm run translation:review  # ask a second model to read the Spanish copy and the messages the rules compose (one real call)
npm run sample:render       # re-render the sample documents from sample/documents.json (needs playwright)
```

## Layout

- `src/lib/template.ts`: the intake template, which questions are fields and which one is a recorded prompt, which documents are requested.
- `src/lib/intake-draft.ts`: the form in progress on the device, and how it becomes a submission.
- `src/lib/sample.ts`, `sample/`: the fictional media and their text layers, the sample submission.
- `src/lib/engine/`: raw model shapes, the source check, the review (propositions, rules, actions, journal).
- `src/lib/ai/`: the two model calls and their prompts.
- `src/app/api/rerun/`: the live run, capped.
- `src/components/`: landing, parent flow, reviewer view.
- `tests/`: the engine, the source check, the rules, the text guards, the recorded fixture, and the counter-examples of the second reviewer (20 September 2026), each red before its correction.
