# AI tells: full checklist

Reference for the humaniser skill. Based on the patterns catalogued at Wikipedia:Signs of AI writing, generalised to non-Wikipedia prose.

A single item here is not proof of anything. Density is the tell. Strip the ones doing no work; leave the ones that are genuinely the right word.

---

## 1. Content-level tells

### Undue emphasis on significance, legacy and broader trends

Padding that inflates the subject by tying it to something bigger.

Watch for: stands as, serves as, is a testament to, a crucial/pivotal/vital/key role, marking a pivotal moment, underscores its importance, reflects a broader, symbolising its enduring, contributing to the, setting the stage for, represents a shift, key turning point, evolving landscape, focal point, indelible mark, deeply rooted, cementing its place.

> The Statistical Institute of Catalonia was officially established in 1989, marking a pivotal moment in the evolution of regional statistics in Spain.

Fix: `The Statistical Institute of Catalonia was established in 1989.`

Variants: situating the subject inside a "wider debate" or "ongoing discussion" that no source mentions; hedging preambles ("Though it saw only limited application, it contributes to the broader history of...") that concede the subject is minor and then talk up its importance anyway.

### Superficial analysis bolted onto facts

Usually a trailing present participle clause.

Watch for: highlighting..., underscoring..., emphasising..., ensuring..., reflecting..., symbolising..., contributing to..., fostering..., encompassing..., enhancing..., offering valuable insights, aligning with, resonating with.

> As of the 2008 census the population stood at 56,998, creating a lively community within its borders.

Fix: `As of the 2008 census the population was 56,998.`

The test: does the clause add a checkable fact? If not, delete it.

### Promotional / brochure tone

Watch for: boasts a, vibrant, rich, profound, enhancing, showcasing, exemplifies, a commitment to, natural beauty, nestled, in the heart of, groundbreaking, renowned, featuring, a diverse array of, world-class, state-of-the-art, best-in-class, seamless, unparalleled, bespoke, tailored solutions, empowering, unlocking, driving value, at the forefront of.

Especially common when the subject is a company, a person, a place or anything describable as "heritage". Newer models are subtler about it - they avoid outright superlatives but still lean warm and complimentary.

### Vague attribution and overgeneralised opinion

Watch for: experts argue, observers have noted, industry reports suggest, analysts note, critics have pointed out, it is widely regarded as, many consider, several sources, is often described as, scholarship describes.

Also: presenting one source's view as consensus; implying a list is non-exhaustive ("such as...") when it is exhaustive; naming a category of source ("trade publications", "national media outlets") instead of the source.

### Canned notability and source-name-dropping

Naming the *type* of coverage rather than what the coverage said: "profiled in regional media", "covered by trade publications", "written by a leading expert", "maintains an active social media presence", "has received independent coverage".

Fix: say what the source reported, or drop it.

### Formulaic challenge/future sections

The shape: `Despite its [positive thing], [subject] faces several challenges...` followed by a vaguely optimistic close, or a section headed Challenges, Future Outlook, Legacy, Looking Ahead, Conclusion.

The tell is the rigid formula, not the mention of difficulties. Real difficulties, described specifically, are fine.

### Knowledge-cutoff and gap disclaimers

Watch for: as of my last training update, while specific details are limited, not widely documented/available/disclosed, based on available information, in the provided sources, the subject maintains a low profile, keeps personal details private, likely.

These are always speculation, including the claim that the information is undocumented. Delete them. If the original text depends on one, flag it to the user rather than inventing a replacement.

### Didactic disclaimers

it's important to note, it's crucial to remember, it's worth noting, keep in mind, bear in mind, may vary depending on.

### Section summaries and restatement

"In summary", "In conclusion", "Overall", or a final paragraph that repeats the preceding paragraphs. Delete.

---

## 2. Language and grammar tells

### High-density AI vocabulary

Nouns/adjectives: crucial, pivotal, vital, key (adjective), robust, comprehensive, intricate, meticulous, enduring, vibrant, profound, seamless, transformative, cutting-edge, holistic, nuanced, myriad, plethora, realm, landscape (figurative), tapestry (figurative), testament, cornerstone, backbone, ecosystem (figurative), journey (figurative), insights, synergy.

Verbs: delve, underscore, highlight, showcase, foster, garner, bolster, leverage, harness, unlock, empower, elevate, navigate (figurative), align, enhance, ensure, facilitate, encompass, boast, exemplify, spearhead, embark, streamline, curate, resonate.

Connectives: Additionally (especially sentence-initial), Furthermore, Moreover, Notably, Importantly, Consequently, Ultimately, That said, In today's fast-paced world.

Note: a word being overused by AI does not make its synonyms suspect. And context matters - "underscore" as a typographic mark or "key" as in a physical key are not tells.

### Copula avoidance

LLMs dodge `is` and `has`.

| AI | Human |
|---|---|
| serves as / stands as / functions as / operates as | is |
| represents a | is a |
| boasts / features / offers / maintains / possesses | has |
| refers to (in a definition) | is |
| ventured into politics as a candidate | was a candidate |
| began his career as | was |
| holds the distinction of being | is / was |

### Negative parallelism

- *Not just X, but Y* - "not only a factory, but a symbol of..."
- *Not X, it's Y* - "it's not a hobby, it's a discipline"
- *X rather than Y* - "prioritising consolidation rather than ideology"
- Across sentences: "He came from an esteemed family. His life, however, took a path that..."

Fix: state the positive claim on its own.

### Rule of three

Three adjectives, three parallel clauses, three-item lists where two or four would be as accurate. Used to make thin analysis look thorough. Break the rhythm - use one item, or two, or five.

### Elegant variation

Cycling synonyms for the same thing across consecutive sentences (the artists / the non-conformists / these creators / like-minded talents) because of a repetition penalty. Human writers repeat the noun. Repeat the noun.

---

## 3. Style and formatting tells

- **Title Case Headings.** Use sentence case unless the document already uses title case.
- **Excessive boldface**, especially bolding every occurrence of a chosen term, or "key takeaways" bolding mid-paragraph.
- **Inline-header vertical lists**: `- **Route details:** starts at...`, `**Timeline and impact:** phase 3 is...`. Bullet-with-bold-lead-and-colon is the single most recognisable AI list shape. Convert to prose, or to plain bullets that just say the thing.
- **Em dashes for emphasis**, especially spaced ones ( — ), and especially several in one piece. Commas, brackets, colons and full stops cover almost every case.
- **Emoji as decoration** on headings or bullets (✨ 🚀 🔑 ✅).
- **Thematic breaks (`---`) before headings.**
- **Curly quotes and apostrophes** (" " ' ') inconsistent with the rest of the document.
- **Skipped heading levels** (jumping to h3 without an h2).
- **Unnecessary small tables** for something that is one sentence of prose.
- **Markdown leaking into a non-markdown context** (`**bold**` inside HTML or plain text).

---

## 4. Residue and machine artefacts

Delete on sight. These prove machine origin outright.

- `:contentReference[oaicite:0]{index=0}`, `oai_citation`, `turn0search0`, `turn0image1`, `attributableIndex`, `citeturn0news0`
- `[cite: 1]`, `[span_1](start_span)`, `[span_1](end_span)`
- `grok_card`, `grok_render_citation_card_json`
- `【85†L261-269】`
- `[attached_file:1]`, `[web:1]`, `ppl-ai-file-upload` URLs
- `:::writing{variant="document" id="12345"}`
- URL parameters: `utm_source=chatgpt.com`, `utm_source=openai`, `utm_source=copilot.com`, `referrer=grok.com` - strip the parameter, keep the URL.
- Placeholder dates like `2025-xx-xx`; unfilled `[insert X here]` templates; `<!-- add if available -->` comments.
- Conversational residue: "Certainly!", "Of course!", "I hope this helps", "Would you like me to...", "Let me know if...", "Here's a draft of...", "As an AI language model".
- Abrupt mid-sentence cut-offs.

---

## 5. Things that are NOT tells

Do not "fix" these. Removing them makes the writing worse and does not make it more human.

- Correct grammar and spelling.
- Formal, academic or technical register.
- Long words that are the right words. Domain jargon a specialist would actually use.
- Transition words in isolation - "however", "therefore", "consequently" are normal English.
- Curly quotes in a document that consistently uses them (Chicago style, Word, macOS defaults).
- Bullet lists as such. Lists are fine; the bold-lead-colon shape is the tell.
- Em dashes used properly, sparingly, unspaced, by a writer who clearly knows what they are.
- Text written before December 2022.

---

## 6. Positive markers to write toward

- Simple `is` / `are` / `has` / `got` constructions.
- Plain verbs: wrote, used, moved, tried, died, made, ran, cut.
- Definitive statements where the facts support them: "the first", "the only", "the best-selling".
- Real hedges where the facts are uncertain: "probably", "roughly", "we think".
- Wordy human constructions that LLMs avoid: "as a result of", "in order to", "all of the", "the fact that", "a part of".
- Sentence-length variation, including short ones. Including fragments, in the right register.
- Concrete numbers, dates, names and places instead of adjectives.
- Starting a sentence with And, But or So.
- Contractions, where the register allows.
