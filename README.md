# Raphie cold email CLI

Small CLI that writes cold outreach emails for Raphie. You give it a recipient, a company, a short description, and a tone, and it uses OpenAI plus the company-analysis endpoint to write the email, then checks it against the style rules before printing it.

## Setup

Needs Node 22.18 or newer (there's an `.nvmrc`). That's the version where Node started running TypeScript directly without a flag, so there's no build step.

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

Here's a real run (brief example #1, warm tone), copied as is:

```
Looking up Riverline Sportsbook...
Found Riverline Sportsbook (operator, igaming), confidence 0.78.
Writing the email with gpt-5.4-mini...

Hi Jane,

I’m reaching out from Raphie. We help sportsbook support teams automate workflows around withdrawals, KYC, promo checks, and account access.

Riverline Sportsbook likely sees the same patterns every week, then bigger surges on big game days. That makes support automation a good fit, because repetitive player questions can be deflected before they hit the queue. It also helps your team resolve common issues faster and keeps agents focused on withdrawal reviews and other sensitive cases.

Raphie handles policy-aware replies and clean escalation paths when a case needs human review. The goal is to reduce ticket volume without losing control of the process.

Would you be open to a short call next week to see if this could help?

Warm regards, Raphie

Passed all checks.
```

Status messages go to stderr and only the email goes to stdout, so `npm start -s -- ... | pbcopy` gets you just the email.

Add `--show-prompt` to see the per-email part of the prompt, i.e. the angle picked for the company type and whatever helper data made it past the confidence check. It's the quickest way to see why two companies got different emails. `DEBUG=1` prints the raw helper response.

Exit codes: 0 means it's good to send, 2 means it printed a draft that still breaks a rule (it tells you which), 1 is an error, 130 is cancelled.

Other scripts: `npm test`, `npm run typecheck`, `npm run lint`, and `npm run check`, which runs all of them (it's what CI runs).

### Eval

The unit tests use a fake model, so they can't tell you if a prompt change made the emails better or worse. `npm run eval` runs seven company profiles (both brief examples, the brief's CLI example, a B2B supplier, an affiliate, a risk/compliance vendor, and a deliberately vague one) through the real helper and OpenAI, and prints a table: helper tier, detected segment, how many drafts it took, word counts, value prop coverage, and any rules still broken.

```
npm run eval                 # one run per case
npm run eval -- --runs 3     # output varies, so more runs gives a better picture
npm run eval -- --show       # print the emails too
```

It makes real API calls, so it's not part of `check` or CI.

What I saw running it:

- gpt-5.4-mini almost always passes the rules on the first draft. Across about 60 emails, two needed a repair round and both got fixed.
- To make sure the repair loop actually works against a real model and not just the fake one in the tests, I ran it with `OPENAI_MODEL=gpt-5.4-nano`. 5 of 12 first drafts broke a rule and the repair round fixed all 5.
- One run had the helper fail outright and the fallback still wrote a fine email from the description.
- The table also has a rough keyword check for the four value props the brief asks for (automation, resolution time, deflection, helping agents). Early on about one email in four skipped resolution time, because the prompt listed them like a menu. After saying they're all required it's 10 to 12 out of 12. It's only an eval signal, not a rule in the app, since the same idea can be worded too many ways.

Reading through the emails is what caught the softer stuff the rules don't check. Three of six described the company as "sitting in a support-heavy spot", a warm one opened with "Thanks for taking a look" (it's a cold email, they haven't looked at anything), the model sometimes swapped em dashes for comma splices, and when the prompt gave an example of how to hedge a guess, it pasted that exact phrase into every medium-confidence email. Those are all prompt tweaks now. The sign-off sometimes got split over two lines too, which is just normalized in code.

## How it works

1. Look up the company on the helper endpoint (20s timeout, 503s get retried twice with backoff).
2. Decide how much of the response to trust based on `confidence` (see below).
3. Build the prompt. The biggest lever is what kind of company it is (operator, B2B supplier, affiliate, payments) since that changes who's actually filing their tickets. That comes from the description first and the helper's `companyType` only if the description is vague.
4. Generate, then check the draft against the rules. On top of the style rules from the brief, it also checks the email actually has the recipient's first name, the full company name, and an ask for a call or meeting. If it breaks any, send it back to the model with the specific problems listed (max 2 times). If it still fails, apply the fixes that can be done safely in code (em dashes, banned openers, "fantastic", extra exclamation marks) and check again.
5. Print it, or print it with a warning if something's still off.

Code is split by area: `src/companyAnalysis/` is the endpoint client and confidence logic, `src/email/` is the prompt, rules, and generation loop, and `src/cli.ts` wires it together.

## Confidence handling

The main idea is that a wrong detail is worse than a missing one. If we tell a payments company their players keep asking about bet settlement, they'll know it's a template right away. The description was written by a person who looked at the company, so it's treated as the source of truth and the helper fills in gaps.

- 0.7 and up: use everything useful, including regions and compliance themes. Still capped to a few items, and the model is told to only work in one or two.
- 0.4 to 0.7: only the broad stuff (company type, vertical, likely ticket drivers), framed as guesses, and the description wins on any conflict. The detailed fields are where a bad guess hurts most, so they're dropped.
- Below 0.4: ignored completely. The prompt doesn't even mention it, because telling the model "we don't know much" makes it write vaguer filler.

Some fields just get dropped as noise: `isCryptoRelated` only matters when it's true, and `kycAmlIntensity` only when it's high. Values like `"tbd"` and `"n/a"` are treated as missing.

The cutoffs are judgment calls. A couple of things I noticed while testing:

- The same company can get a different confidence on different calls (Riverline came back at 0.99 once and 0.77 another time), so a company near a cutoff can flip tiers between runs.
- It labelled ApexPay as a "platform" at 0.80, even though it's a payments company. That's why the description beats `companyType` even at high confidence.

## Things worth knowing

- Both example emails in the brief actually break the 30 word rule (they have 32 and 33 word sentences). The prompt uses trimmed versions as style references so the model doesn't pick up the habit, and there's a test making sure they pass.
- The prompt asks for sentences under 25 words to leave some room under the real limit.
- The sentence splitter is regex based. It handles sentences ending in quotes or parens, bullets, and curly apostrophes, but it'll still split on things like "e.g.", which seemed fine for short emails. Splitting too often only makes the checks stricter, never looser.

## With more time

- Grade the eval output on more than the hard rules, e.g. an LLM judge checking that each email has all the required pieces and actually sounds like it fits the segment. Right now that part is still read by eye with `--show`.
- Cache the helper responses per company, partly for speed and partly because the confidence moves around between calls.
- Better segment detection. Keywords work for the obvious cases but something like "a KYC vendor that also runs a sportsbook" would need more than that.
- Let the user see and edit the draft in the CLI and regenerate with feedback ("shorter", "mention the World Cup").
- Batch mode from a CSV, since nobody sends one cold email at a time.
- Subject lines.

## Considered but skipped

- zod for validating the helper response and env. There are only two small shapes, and the helper parsing needed custom handling for `"tbd"`/`"n/a"` anyway, so hand-written checks were less code. Worth adding if more external inputs show up.
- Asking the model for structured JSON (greeting, paragraphs, sign-off) instead of plain text. It would make formatting more predictable, but the rules check the final text either way, and plain text kept the prompt and repair loop simpler.
- Letting the model classify the company type. It'd handle odd descriptions better than keywords, but it's another call (a few more seconds) and another thing that can be wrong. Keywords plus the helper as a fallback covered every case I tried.
- `Intl.Segmenter` for sentence splitting. It's built into Node, but the regex is easier to reason about, and when it's wrong it splits too often, which only makes the checks stricter.
- Retrying helper timeouts. A slow response retried is just a second slow response, so a timeout falls back to the description right away. Only 503s get retried.
- Enforcing the value props and cliché list as hard rules. The same idea can be worded too many ways, so it'd flag good emails. Those live in the prompt and get measured by the eval instead.
- TypeScript 7. typescript-eslint doesn't support it yet, so it's pinned to 6.0 for now.
