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

- Transcription of the recording (a Google model) and extraction from the documents and the transcript (an Anthropic model) are two model calls (`src/lib/ai/pipeline.ts`). The models come from the environment, never from the code. The review shown first is a recorded run (`src/lib/fixtures/recorded-draft.json`); the "Run again" button repeats the calls live, under a daily cap held in the memory of one server process (`src/lib/limits.ts`). When the cap is reached, the recorded review stays available and says it is recorded. One counter, taken before the first call, bounds both providers; a transcript is kept for the day so a failed extraction does not repeat the transcription, and the review then says that the transcription was reused, not called; repeated provider errors pause live runs. The exact reservation: counter, cache and breaker live in the memory of one process, so a restart or a second instance starts them again; the only durable limit is the monthly spend limit set on the Anthropic workspace this deployment calls, and there is no durable cap on the Google side here.
- Every quote the models return is checked against the document text layer, every value against its quote as one contiguous run of words, and every machine-form date against the date written in the value, on a real calendar (February 31 is not a date). Two fields with the same key are one field: merged when they carry the same value, shown side by side and left to the reviewer when they do not. Every audio segment is located by the code from the quoted words, within the timestamps the transcription returned, and checked against the length of the recording. The days, hour and place a claim carries are checked in the spoken clause the quoted words come from, not only in the words the model chose to quote, so a negation the quote left out still counts; "but" and "pero" close a clause, a segment boundary of the transcription does not close an hour phrase, and "no problem with" is not a negation. An hour is named only when the spoken words give its value, AM or PM, and "from", with no minutes: anything less is shown as to confirm. **The code never writes that the form and the recording agree.** A cross-check has two findings: "Sources disagree" when the recorded answer, in the clause of the quoted words, explicitly negates a day, a start hour or a place the form affirms; "To confirm" for everything else, what seems to match included. A statement the model marks uncertain, a name read as uncertain on a document, and a name whose role on the letter is not marked (no "Referring provider:", no "Dr.", no credential) are to confirm as well, with the criterion not assessable. A free statement (`other`) is never assessed: it is listed for the reviewer with its quoted words (`src/lib/engine/verify.ts`, `src/lib/engine/review.ts`). What fails the check is withheld and shown in the review as not evaluable, with its reason, never as a fact; a document the draft named wrongly is listed too. A document that was received but that the run returned nothing for is shown as not read, not as present. The wording of a rephrased statement is the model's: the claim says what the code checked, and the reviewer judges the wording against the recording. Whether a recording was cut off is what the transcription model reports; the code does not detect that on its own.
- Every proposition carries a digest of what its source gave it (statement, nature, finding, evidence, criterion, the structured data as proposed and as established, what the code checked). A new draft or a new submission that changes any of it proposes the item again, with the reviewer's earlier work in the history; a cross-check depends on every statement it was computed from, and is flagged for another look when one of them is proposed again or disappears, as it is when one is corrected. The request to the family carries a digest of its context, in three parts: the recipient (name, email, phone, language of contact) and the child (first and last name); the items asked for, with their kinds and whether their basis is still there; the facts asked about (the structured details and the current statement of every proposition it cites). A corrected or approved text holds only for that context, and goes back to draft, with the approved text kept and the part that changed named, when the text or the context changes, a corrected fact included. An item leaves the request when the family sends the piece (the document or recording slot changed in a new submission) or when the reviewer resolves it; a draft that stops carrying the proposition the item came from does not close it: the item stays open, marked "The draft no longer carries this item; review it". An item in an approved request that is flagged for another look is reviewed on its own; approving the message again does not review it. The file approval names a SHA-256 of the whole content, submission date and request included, and ends the moment any of it changes, a proposition's state included (`src/lib/engine/review.ts`). A form the family saves again replaces the whole file under review, whatever changed in it. A live run started on a file that is reset before it comes back is not applied to the new file. A file with no recording ran one call, the extraction, and its header says so.
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
npm run fixtures               # recompute the recorded run (two real calls); keeps the model answers in recorded-raw.json
npm run fixtures -- --reverify # check the stored model answers again with the current code (no call)
npm run translation:review     # ask a second model to read the Spanish copy and the messages the rules compose (one real call)
npm run sample:render          # re-render the sample documents from sample/documents.json (needs playwright)
```

## Layout

- `src/lib/template.ts`: the intake template, which questions are fields and which one is a recorded prompt, which documents are requested.
- `src/lib/intake-draft.ts`: the form in progress on the device, and how it becomes a submission.
- `src/lib/sample.ts`, `sample/`: the fictional media and their text layers, the sample submission.
- `src/lib/engine/`: raw model shapes, the source check, the review (propositions, rules, actions, journal).
- `src/lib/ai/`: the two model calls and their prompts.
- `src/app/api/rerun/`: the live run, capped.
- `src/components/`: landing, parent flow, reviewer view.
- `tests/`: the engine, the source check, the rules, the text guards, the recorded fixture, and the counter-examples of the second reviewer (20 September 2026): the 21 of the first round (`judge-counterexamples.test.ts`), the 25 of the second (`judge-round2.test.ts`) and the 20 that failed of the third (`judge-round3.test.ts`, with its 15 positive controls) were each run red on the commit they target before their correction, as was the invariant of the fourth pass (`no-computed-agreement.test.ts`: no cross-check ever renders an agreement, on the recorded review and on ten synthetic answers); the other tests written during those passes were written with or after their correction. Two lines of `judge-round2.test.ts` were adapted in the fourth pass and say so where they stand.
