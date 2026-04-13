---
name: website-cloner
description: >
  Deterministic website cloning skill that reverse-engineers any website into a pixel-accurate
  reproduction. Use this skill whenever the user asks to clone, replicate, copy, reproduce, or
  rebuild an existing website or webpage. Also trigger when the user says things like "make it
  look exactly like this site", "copy this design", "rebuild this page", "match this website",
  "recreate this UI", or provides a URL and asks for it to be turned into code. This skill
  treats the target site as a deterministic spec, not an inspiration, and follows a rigorous
  extraction-then-reconstruction protocol to achieve pixel-perfect results. Supports both live
  sites and Wayback Machine archived pages. Do NOT use for designing original websites or for
  "inspired by" requests where the user wants a new design that merely borrows ideas.
---

# Website Cloner v5

Sub-agent dispatched orchestration. The heavy lifting (browser automation, DOM extraction, code
generation, pixelmatch) runs in isolated sub-agents that return short summaries. The main
conversation only sees those summaries, so cloning a 10-section marketing site no longer eats
the orchestrator's context window.

**Core principle: the target site IS the spec.** Every visual decision has already been made.
Your job is to dispatch agents, read their summaries, and decide what to dispatch next.

## Architecture

Three sub-agents, one shared workspace on disk. The workspace is the source of truth. Agents
write artifacts (site-dna.json, built sections, diff images) and return a structured summary
(`STATUS`, `WROTE`, `KEY_FINDINGS`, `NEXT`). You read the summary and dispatch the next agent.

- `website-cloner:extractor` — Phase 1. Runs once. Produces `site-dna.json`, downloaded assets,
  and reference screenshots.
- `website-cloner:reconstructor` — Phase 2a. Runs once per section. On `section_index === 0`
  it also generates global tokens. Builds HTML/CSS for that section only.
- `website-cloner:comparator` — Phase 2b. Runs once per section after the reconstructor.
  Screenshots the built section, pixelmatches against reference, writes diff + report.

Read `references/sub-agent-protocol.md` before dispatching anything. It defines the JSON input
shape and the summary format every agent returns.

## Orchestration Protocol

### 1. Workspace setup

Create `clone-workspace/` (or a user-specified directory) in the current working directory.
Use its absolute path everywhere. This is the value you pass as `workspace` to every agent.

```
clone-workspace/
├── site-dna.json             # written by extractor
├── assets/                   # written by extractor
├── references/screenshots/   # written by extractor
├── tokens/                   # written by reconstructor (section 0)
├── sections/NN-slug/         # written by reconstructor, one dir per section
├── comparisons/NN-slug/      # written by comparator
├── diff-images/              # written by comparator
├── errors/                   # failure reports from any agent
└── agent-log-*.md            # per-run agent logs
```

### 2. Dispatch the extractor

```
Task({
  subagent_type: "website-cloner:extractor",
  description: "Extract Phase 1 from <url>",
  prompt: "{\"workspace\": \"<abs-path>\", \"target_url\": \"<url>\"}"
})
```

Wait for the summary. If `STATUS != ok`, halt and surface the failure + the path in
`WARNINGS`/`NEXT` to the user. Do not proceed.

### 3. Determine section count

Read `<workspace>/site-dna.json` with the Read tool and count entries in the `sections` array.
Record the count as `N`. Each section has an index `0..N-1` and a slug you can use for logging.

### 4. Per-section loop

For each `section_index` from `0` to `N-1`:

```
attempts = 0
notes = ""
loop:
  dispatch reconstructor with { workspace, target_url, section_index, notes }
  if reconstructor STATUS != ok: halt, surface to user
  dispatch comparator with { workspace, target_url, section_index }
  parse comparator summary:
    - STATUS == ok  →  section passes, break to next section
    - STATUS == partial  →  build notes from comparator KEY_FINDINGS (top deviations)
                             and the path in WROTE pointing at comparisons/NN-*/report.md
    - STATUS == failed  →  halt, surface to user
  attempts += 1
  if attempts >= 3: save state, ask the user how to proceed
```

**Pass/fail rule.** The comparator owns the 95% threshold. `STATUS: ok` means the section is
at or above 95% pixel match. `STATUS: partial` means below threshold and the reconstructor
should rerun with the comparator's notes. Do not second-guess the threshold in the orchestrator.

**Notes format for retries.** When re-dispatching the reconstructor, put the top 2-5 deviations
from the comparator's `KEY_FINDINGS` plus a pointer to `comparisons/<NN>-<slug>/report.md` into
the `notes` field. The reconstructor reads the report directly, you do not quote it inline.

### 5. Animations and interactions (orchestrator-driven)

After every section passes, layer in animations and interactions on the reconstructed build.
This step is not yet in a sub-agent (carried forward from v4 Step 11):

1. Apply CSS transitions on interactive elements using hover/focus/active deltas recorded in
   `site-dna.json` (state deltas and pseudo-element deltas).
2. Wire scroll-triggered animations: IntersectionObserver for fade/slide-ins, scroll listeners
   for parallax, AOS data attributes for AOS-style reveals.
3. Add page-load animations and remaining micro-interactions.

Code patterns live in `references/reconstruction-patterns.md`. Do this in the orchestrator
thread (or dispatch a copywriter-style utility Edit pass) without a dedicated agent.

### 6. Cross-breakpoint audit (orchestrator-driven)

Carried forward from v4 Step 12. Run the existing `scripts/section-compare.js` helper for each
section at `1440, 1024, 768, 375` against the reference screenshots the extractor captured.

- Per-section bar: ≥95% match at each breakpoint.
- Full-page bar: ≥98% match at each breakpoint (higher because inter-section spacing matters).

If any breakpoint fails, you have two options: rerun the reconstructor for that section with
`breakpoint` set to the failing viewport and notes pointing at the diff, or fix inline in the
orchestrator if the issue is a small responsive rule. Log the decision.

### 7. Final report

Read every `<workspace>/comparisons/*/report.md` the comparator wrote. Synthesize a one-page
summary for the user:

- Per-section pixel match %, sorted worst to best.
- Any section under 98% gets its diff image path called out inline so the user can click through.
- Warnings (missing assets, font substitutions, 404s) aggregated from extractor and comparator.
- Cross-breakpoint audit results from Step 6.
- A single recommendation: ship as-is, iterate specific sections, or escalate.

## What lives where (v5)

- `agents/extractor.md` — Phase 1 (Steps 1-8 of v4: screenshots, site-dna, assets, state deltas).
- `agents/reconstructor.md` — Phase 2a (Step 9 tokens on section 0, Step 10a build one section).
- `agents/comparator.md` — Phase 2b (Steps 10b-d: screenshot, pixelmatch, element checklist).
- `references/sub-agent-protocol.md` — agent I/O contract. Read before dispatching.
- `references/site-dna-schema.md` — DNA document schema.
- `references/reconstruction-patterns.md` — code patterns the reconstructor and orchestrator use.
- `references/wayback-machine.md` — Wayback-specific extraction guidance.
- `references/v4-skill-archive.md` — frozen copy of the v4 monolithic SKILL.md body.
- `scripts/` — Playwright + pixelmatch helpers (`extract-site-dna.js`, `extract-assets.js`,
  `extract-state-deltas.js`, `generate-tokens.js`, `section-compare.js`, `visual-diff.js`).

## Failure and resumption

Every agent writes `workspace/errors/<name>-<timestamp>.md` on failure. On resume, the
workspace is durable. Read the last agent summary or the latest error file, then re-dispatch
the specific agent that failed. You do not need to rerun the extractor unless `site-dna.json`
is missing or corrupt.

## Version history

- **v5** (current): sub-agent dispatched. Orchestration only, no inline extraction or building.
- **v4**: monolithic skill. Full protocol archived at `references/v4-skill-archive.md`. Refer
  to it when porting remaining steps into future sub-agents.
