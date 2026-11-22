# Raphie cold email CLI

Small CLI that writes cold outreach emails for Raphie. You give it a recipient, a company, a short description, and a tone, and it uses OpenAI plus the company-analysis endpoint to write the email, then checks it against the style rules before printing it.

## Setup

Needs Node 22+ (there's an `.nvmrc`). Node runs the TypeScript directly, so there's no build step.

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

Status messages go to stderr and only the email goes to stdout, so `npm start -s -- ... | pbcopy` gets you just the email.

Exit codes: 0 means it's good to send, 2 means it printed a draft that still breaks a rule (it tells you which), 1 is an error, 130 is cancelled.

Other scripts: `npm test`, `npm run typecheck`, `npm run lint`, and `npm run check`, which runs all of them (it's what CI runs).

### Eval

The unit tests use a fake model, so they can't tell you if a prompt change made the emails better or worse. `npm run eval` runs six company profiles (both brief examples, the brief's CLI example, a B2B supplier, an affiliate, and a deliberately vague one) through the real helper and OpenAI, and prints a table: helper tier, detected segment, how many drafts it took, word counts, and any rules still broken.

```
npm run eval                 # one run per case
npm run eval -- --runs 3     # output varies, so more runs gives a better picture
npm run eval -- --show       # print the emails too
```

It makes real API calls, so it's not part of `check` or CI.

Last few runs on gpt-5.4-mini: 24 emails, all passed the rules on the first draft, so the repair loop hasn't actually had to kick in yet. It's there for when it does (different model, longer descriptions, etc). One run had the helper fail and the fallback still wrote a fine email from the description.

Reading through them is what caught the softer stuff the rules don't check. Three of six emails described the company as "sitting in a support-heavy spot", a warm email opened with "Thanks for taking a look" (they haven't looked at anything, it's a cold email), and the model sometimes swapped em dashes for comma splices. Those are all prompt tweaks now. The sign-off sometimes got split over two lines too, which is just normalized in code.

## How it works

1. Look up the company on the helper endpoint (20s timeout, 503s get retried twice with backoff).
2. Decide how much of the response to trust based on `confidence` (see below).
3. Build the prompt. The biggest lever is what kind of company it is (operator, B2B supplier, affiliate, payments) since that changes who's actually filing their tickets. That comes from the description first and the helper's `companyType` only if the description is vague.
4. Generate, then check the draft against the rules. If it breaks any, send it back to the model with the specific problems listed (max 2 times). If it still fails, apply the fixes that can be done safely in code (em dashes, banned openers, "fantastic", extra exclamation marks) and check again.
5. Print it, or print it with a warning if something's still off.

Code is split by area: `src/companyAnalysis/` is the endpoint client and confidence logic, `src/email/` is the prompt, rules, and generation loop, and `src/cli.ts` wires it together.

## Confidence handling

The main idea is that a wrong detail is worse than a missing one. If we tell a payments company their players keep asking about bet settlement, they'll know it's a template right away. The description was written by a person who looked at the company, so it's treated as the source of truth and the helper fills in gaps.

- **0.7 and up**: use everything useful, including regions and compliance themes. Still capped to a few items, and the model is told to only work in one or two.
- **0.4 to 0.7**: only the broad stuff (company type, vertical, likely ticket drivers), framed as guesses, and the description wins on any conflict. The detailed fields are where a bad guess hurts most, so they're dropped.
- **Below 0.4**: ignored completely. The prompt doesn't even mention it, because telling the model "we don't know much" makes it write vaguer filler.

Some fields just get dropped as noise: `isCryptoRelated` only matters when it's true, and `kycAmlIntensity` only when it's high. Values like `"tbd"` and `"n/a"` are treated as missing.

The cutoffs are judgment calls. A couple of things I noticed while testing:

- The same company can get a different confidence on different calls (Riverline came back at 0.99 once and 0.77 another time), so a company near a cutoff can flip tiers between runs.
- It labelled ApexPay as a "platform" at 0.80, even though it's a payments company. That's why the description beats `companyType` even at high confidence.

## Things worth knowing

- Both example emails in the brief actually break the 30 word rule (they have 32 and 33 word sentences). The prompt uses trimmed versions as style references so the model doesn't pick up the habit, and there's a test making sure they pass.
- The prompt asks for sentences under 25 words to leave some room under the real limit.
- The sentence splitter is regex based and will miscount things like "e.g.", which seemed fine for short emails.

## With more time

- Grade the eval output on more than the hard rules, e.g. an LLM judge checking that each email has all the required pieces and actually sounds like it fits the segment. Right now that part is still read by eye with `--show`.
- Cache the helper responses per company, partly for speed and partly because the confidence moves around between calls.
- Better segment detection. Keywords work for the obvious cases but something like "a KYC vendor that also runs a sportsbook" would need more than that.
- Let the user see and edit the draft in the CLI and regenerate with feedback ("shorter", "mention the World Cup").
- Batch mode from a CSV, since nobody sends one cold email at a time.
- Subject lines.
