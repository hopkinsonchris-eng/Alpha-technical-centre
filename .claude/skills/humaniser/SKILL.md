---
name: humaniser
description: Rewrite a piece of writing so it no longer reads as AI-generated. Use when the user asks to "humanise", "humanize", "de-AI", "make this sound human", "remove the AI tells", or otherwise wants text stripped of LLM style while keeping the meaning and facts unchanged. Works on any prose - articles, emails, web copy, reports, documentation, LinkedIn posts.
---

# Humaniser

Rewrite text so a reader cannot tell a machine wrote it. Keep every fact. Add nothing.

## The three rules

1. **Keep the meaning.** Every claim, number, name, date and qualifier in the input survives in the output, saying the same thing.
2. **Add nothing.** No new facts, no new examples, no invented context, no significance the source never claimed. If you delete a puffed-up clause that contained no information, that is a deletion of noise, not of meaning.
3. **Remove every AI tell.** See below.

Length usually drops. That is expected and correct - most AI tells are padding. Do not pad to hit the original word count.

## Process

1. Read the whole input first. Work out what it actually says - the facts, stripped of decoration.
2. Rewrite it from that understanding, in plain prose. Do not edit the original sentence by sentence; that leaves the AI rhythm intact.
3. Pass over the result against `references/ai-tells.md` and fix what is left.
4. Read it aloud in your head. If a sentence sounds like a press release or a brochure, it fails.
5. Output the rewritten text only. No preamble, no summary of changes, no "here is your humanised text" - unless the user asked for an explanation.

## What to strip

Load `references/ai-tells.md` for the full checklist with examples. The high-frequency offenders:

**Vocabulary.** delve, crucial, pivotal, robust, vibrant, seamless, showcase, underscore, highlight (as a verb), foster, leverage, testament, tapestry, landscape (figurative), intricate, meticulous, garner, bolster, align with, enhance, boasts, comprehensive, key (as adjective), realm, navigate (figurative), transformative, cutting-edge, game-changing, ensure, empower, harness, unlock, elevate.

**Sentence shapes.**
- Trailing "-ing" clauses that editorialise: "..., highlighting its importance", "..., ensuring reliability", "..., reflecting a broader shift". Cut them or turn them into a real clause with a real claim.
- Negative parallelism: "not just X, but Y", "it's not X, it's Y", "X rather than Y".
- Rule of three: three adjectives, three parallel phrases, three-item lists that exist for rhythm rather than content.
- Copula avoidance: "serves as", "stands as", "functions as", "represents", "boasts", "features", "refers to" where "is" or "has" would do.
- Em dashes used for emphasis or punch. Use commas, brackets, full stops or a colon.

**Structure and content.**
- Significance and legacy padding: "marking a pivotal moment", "a testament to", "cementing its place", "reflecting broader trends", "setting the stage for".
- Formulaic endings: a "Conclusion", "Challenges", "Future Outlook" or "In summary" section; a final paragraph that restates what was just said.
- Hedged attribution to nobody: "experts argue", "observers note", "industry reports suggest", "it is widely regarded as", "many consider".
- Didactic disclaimers: "it's important to note", "it's worth remembering", "keep in mind that".
- Bold-lead bullet lists (`**Thing:** description`), title case headings, emoji decoration, thematic breaks before headings.
- Curly quotes and apostrophes where the surrounding document uses straight ones (match the document).
- Boilerplate self-assurance: any sentence about how balanced, neutral, comprehensive or well-sourced the text is.

## What human writing does instead

- Uses **is**, **are**, **has**, **got**, **did**. Short verbs.
- Uses plain words: wrote not authored, used not utilised, moved not relocated, tried not attempted, about not regarding, so not therefore, but not however (sometimes), enough not sufficient.
- Varies sentence length hard. A long sentence that carries a full thought, then a short one. Fragments are allowed if the register suits.
- Repeats a word rather than reaching for a synonym. If the subject is a pump, call it the pump every time - do not cycle through "the unit", "the equipment", "the system".
- States things flatly and lets the reader judge. No adjectives doing the work the facts should do.
- Leaves specifics specific. "Increased 12% over two quarters", not "saw significant growth".
- Will start a sentence with And, But or So when that is how the thought runs.
- Contractions where the register allows it. Formal reports may not want them; an email does.

## Register and voice

Match the source. A technical report stays a technical report - humanising it does not mean making it chatty. Keep:

- The original's tense, person and point of view.
- Any house style already visible in the document (British vs American spelling, serial comma or not, heading style).
- Domain terminology. Jargon that a specialist would genuinely use is not an AI tell. Do not "simplify" a term of art into something vaguer.
- Direct quotes, citations, code, figures and proper nouns **exactly as given**. Never rewrite inside quotation marks.

## Judgement calls

- **A word on the list is not automatically wrong.** "Crucial" in a sentence where something genuinely is crucial, in a document that uses that register, can stay. Density is the tell, not any single word. Strip the ones doing no work.
- **Do not overcorrect into obvious quirk.** Deliberate typos, forced slang and random fragments are their own tell. Aim for competent human prose, not performed casualness.
- **If a passage is entirely padding**, cut it. Report that you cut it if the user might expect it to still be there.
- **If a fact looks wrong or unverifiable**, leave it as written and flag it separately after the rewrite. Do not silently fix or drop it.
- **If the input is already human**, say so and leave it largely alone rather than rewriting for the sake of it.

## Output

Rewritten text, in the same format as the input (markdown in, markdown out; HTML in, HTML out - preserving tags and attributes). Nothing else, unless the user asked for a change log or flagged issues, in which case put those after the text under a short heading.
