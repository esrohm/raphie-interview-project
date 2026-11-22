# Raphie cold email CLI

Small CLI that writes cold outreach emails for Raphie. You give it a recipient, a company, a short description, and a tone. It uses OpenAI plus the company-analysis endpoint to write the email, then checks it against the style rules before printing it.

## Setup

Needs Node 22.18 or newer (there's an `.nvmrc`). That's the version where Node runs TypeScript directly, so there's no build step.

```
npm install
cp .env.example .env   # then add your OPENAI_API_KEY
```

## Usage

```
npm start
```

It asks for the four inputs. You can also pass any of them as flags and it'll only ask for the rest:

```
npm start -- --name "Jane Doe" --company "Riverline Sportsbook" \
  --description "A sportsbook operator with high withdrawal volume and KYC questions" --tone direct
```

A real run (brief example #1, warm tone), copied as is:

```
Looking up Riverline Sportsbook...
Found Riverline Sportsbook (operator, igaming), confidence 0.81.
Writing the email (segment: operator) with gpt-5.4-mini...

Hi Jane,

How's your week going?

I'm reaching out from Raphie. We help sportsbook support teams automate workflows around withdrawals, verification, promo checks, and account access, while keeping tricky cases routed to agents.

Riverline Sportsbook has the kind of player support where repeat questions pile up fast, especially around big game days. That makes iGaming a strong fit for support automation. Raphie helps deflect repetitive tickets, speed up resolution times, and give agents cleaner handoffs on sensitive cases.

If it makes sense, would you be open to a short call next week?

Warm regards, Raphie

Passed all checks.
```

Status messages go to stderr and only the email goes to stdout, so `npm start -s -- ... | pbcopy` copies just the email. `--show-prompt` prints the per-email part of the prompt (the segment angle and whatever helper data passed the confidence check), which is the quickest way to see why two companies got different emails. `DEBUG=1` prints the raw helper response.

Exit codes: 0 means good to send, 2 means it printed a draft that still breaks a rule (and says which), 1 is an error, 130 is cancelled.

`npm run check` runs typecheck, lint, format check, and tests. It's what CI runs.

## How it works

1. In parallel: look up the company on the helper endpoint (20s timeout, 503s retried twice with backoff), and have the model classify the description into a segment (operator, B2B supplier, affiliate, payments, or unknown) with a structured-output call. The helper takes 4 to 12 seconds, so the classifier costs no extra wait.
2. Decide how much of the helper response to trust based on `confidence` (see below).
3. Build the prompt. The segment is the biggest lever, since it decides who's actually filing their tickets. It comes from the description. The helper's `companyType` is only used when the description is too vague to tell, and only at high confidence.
4. Generate, then check the draft. On top of the brief's style rules, it checks for the recipient's first name, the full company name, an actual suggestion to meet (a question or an offer, not just the word "call" somewhere), and for warm tone, a friendly opener before the pitch. If anything fails, the draft goes back to the model with the specific problems listed, up to 2 times.
5. Print it, or print it with a warning if something's still off.

There's deliberately no find-and-replace fallback after the repairs. The obvious one, swapping an em dash for a comma, makes a comma splice, which is exactly what the prompt tells the model not to do. A draft that still fails goes to a human with exit code 2 instead.

`src/companyAnalysis/` is the endpoint client and confidence logic, `src/email/` is the classifier, prompt, rules, and generation loop, and `src/cli.ts` wires it together.

## Confidence handling

A wrong detail is worse than a missing one. If we tell a payments company their players keep asking about bet settlement, they'll know it's a template right away. The description was written by a person who looked at the company, so it's the source of truth and the helper fills in gaps.

- 0.7 and up: use everything useful, including regions and compliance themes. Capped to a few items, and the model is told to work in only one or two.
- 0.4 to 0.7: only the broad stuff (company type, vertical, likely ticket drivers), framed as guesses, and the description wins on any conflict. The detailed fields are where a bad guess hurts most, so they're dropped.
- Below 0.4: ignored completely. The prompt doesn't mention it, because telling the model "we don't know much" makes it write vaguer filler.

`isCryptoRelated` only gets passed along when it's true, and `kycAmlIntensity` only when it's high, since the other values give the email nothing to say. Values like `"tbd"` and `"n/a"` are treated as missing.

The cutoffs are judgment calls. Confidence also moves between calls for the same company: Riverline has come back anywhere from 0.72 to 0.99, and ApexPay from 0.62 to 0.80, always labelled `platform` even though it's a payments provider (and `isCryptoRelated: false`, despite the crypto on-ramps). So a company near a cutoff can flip tiers between runs, and the description has to beat `companyType` even at high confidence.

## Eval

The unit tests use a fake model, so they can't tell you whether a prompt change made the emails better. `npm run eval` runs seven profiles through the real helper and OpenAI: both brief examples, the brief's CLI example, a B2B supplier, an affiliate, a risk/compliance vendor (easy to mistake for an operator, since it names its sportsbook customers), and a deliberately vague one. It prints the helper tier, the segment against the expected one, drafts needed, word counts, a rough value prop keyword check, and any rules still broken. `--runs 3` for more samples, `--show` to print the emails. It makes real API calls, so it's not in CI.

Latest results:

- gpt-5.4-mini: 14 of 14 clean on the first draft, all four value props in every email, and the expected segment in every case.
- To make sure the repair loop works without a fallback behind it, I ran `OPENAI_MODEL=gpt-5.4-nano`: 9 of 14 first drafts broke a rule, and repairs fixed all 9.
- A few runs had the helper fail outright. The classifier still got the segment right and the email was fine.

Reading the emails caught things the rules don't: stock framings ("sits in a support-heavy spot"), "Nice to meet you" in a cold email, comma splices where em dashes used to be, and the model copying an example hedge phrase into every medium-confidence email. Those are all prompt fixes now. Warm emails used to open with "I'm reaching out from Raphie", the same as direct ones, which is why the warm opener became a checked rule.

## Things worth knowing

- Both example emails in the brief break the 30-word rule (they have 32 and 33 word sentences). The prompt uses trimmed versions as style references, and a test makes sure they pass.
- The prompt asks for sentences under 25 words to leave room under the real limit.
- The sentence splitter is regex based. It handles closing quotes and parens, bullets, and curly apostrophes, but splits on "e.g.". That only ever makes the checks stricter.

## With more time

- An LLM judge in the eval for tone and segment fit, instead of reading the output by eye.
- Cache helper responses per company, for speed and because confidence moves between calls.
- Let the user edit the draft in the CLI and regenerate with feedback ("shorter", "mention the World Cup").
- Batch mode from a CSV, and subject lines.

## Considered but skipped

- zod for the helper response and env. Two small shapes, and the helper needed custom `"tbd"`/`"n/a"` handling anyway, so hand-written checks were less code.
- Structured JSON for the email itself. The rules check the final text either way, and plain text kept the repair loop simple. The classifier does use structured output, since there the answer is one value from a fixed list.
- Retrying helper timeouts. A retried slow request is just a second slow request, so a timeout falls back to the description right away.
- Value props and clichés as hard rules. They can be worded too many ways, so they'd flag good emails. They live in the prompt and the eval measures them.
- TypeScript 7. typescript-eslint doesn't support it yet, so it's pinned to 6.0.
