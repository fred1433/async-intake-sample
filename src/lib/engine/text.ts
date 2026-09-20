/**
 * One convention of equality for two texts, shared by the deduplication of
 * the fields a draft proposes and by the criteria that compare a field with
 * the intake form. Case, runs of spaces and the punctuation at the ends of
 * words are ignored; word boundaries are kept, so "Mary Ann Lee" and
 * "Maryann Lee" are two texts, and two values to show. Nothing else is read.
 */

/** The folded form of a text: lowercase, one space between words, no punctuation at the ends of words. */
export function foldText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean)
    .join(" ");
}

/** True when two texts are the same under the shared convention. */
export function sameText(a: string, b: string): boolean {
  return foldText(a) === foldText(b);
}
