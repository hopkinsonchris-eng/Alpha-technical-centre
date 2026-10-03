# Wave 5 — Innovation Options

Each option is checked against the AI-leverage list: an LLM reasoning over the firm's own data; pattern recognition the eye would miss; optimisation of habits; first-draft artifacts a person then edits.

## Option A — The three doors, as chosen (RECOMMENDED)

Durable storage, the viewer, Write to… with the full review loop, and the Vault as an OAuth connector for the Claude app.

- LLM over own data: the drafter already writes from the file; this wave gives it the counterparties and the research findings as sources, and gives it a door. The connector puts the same retrieval behind every Claude conversation.
- Pattern recognition: the uncited-sentence gate and the "what this draft does not know" list are the model checking its own claims against the file before a person signs.
- First drafts a person edits: every draft is a note the person accepts paragraph by paragraph; the sent version is immutable.
- Optimisation of habit: none here, stated. The viewer is plumbing.

Why recommended: it is the smallest set that makes the Hub the place to work from and makes the assistant stop forgetting, and every piece is behind the existing scope gateway.

## Option B — Option A plus "Ask this project"

A conversational panel on the project page over the project's records, with citations, using the drafter's retrieval. Strong leverage (LLM over own data, every answer cited) but it duplicates what the connector gives through the Claude app, where the conversation surface is better than anything the Hub could build. Deferred: build it only if the connector proves not enough on the iPad.

## Option C — Option A plus the inbox that files itself

Switch on the mail capture that exists in the code (IMAP and Gmail polling, classification into projects, dispatch rows for sent and received mail). Leverage: pattern recognition (which project a mail belongs to, which contact wrote it) and the "load everything" half of the brief. Deferred to wave 6: it needs mailbox credentials and a decision on which mailbox, and the drafting loop should run first so the sent mails it files are the ones the Hub wrote.

## Option D — Option A with server-side conversion of Word and PowerPoint

A LibreOffice service beside the API, every office file converted to PDF once and cached by hash, one viewer for everything. No AI leverage (stated); fidelity only. Not chosen at W5-D2.
