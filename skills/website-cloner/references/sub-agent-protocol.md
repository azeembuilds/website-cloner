# Sub-Agent Protocol (website-cloner v5)

Contract every website-cloner sub-agent (`extractor`, `reconstructor`, `comparator`) follows. The orchestrator in `SKILL.md` dispatches agents against a shared workspace, each agent writes files and returns a short structured summary. The main context only sees summaries, never raw tool output. This is what lets v5 clone large sites without exhausting the orchestrator's context window.

## The Contract: Input

Every agent is dispatched with a single JSON object in its prompt:

```json
{
  "workspace": "/absolute/path/to/clone-workspace",
  "target_url": "https://example.com",
  "section_index": 3,
  "breakpoint": 1440,
  "notes": "freeform context from orchestrator"
}
```

Field rules:
- `workspace`: required, absolute path. The agent's entire world. Read/write here only.
- `target_url`: required. Live or Wayback URL being cloned.
- `section_index`: required for `reconstructor` and `comparator`; omitted for `extractor`.
- `breakpoint`: optional viewport width. Default `1440`.
- `notes`: optional freeform orchestrator context (e.g. "hero has a video background, capture poster frame only").

Missing required field or nonexistent workspace: fail fast with `STATUS: failed` and a root-cause line.

## The Contract: Output

Two outputs, and only two:

1. **Files written to the workspace.** The real deliverable. Every artifact the orchestrator or downstream agents need must land on disk inside `workspace`. Agents MUST NOT return file contents in their response body.
2. **Structured summary returned to the caller.** Max 300 words. Format:

```
STATUS: ok | partial | failed
WORKSPACE: <absolute path>
WROTE:
  - <relative path or glob> (<size or count, optional>)
  - ...
KEY_FINDINGS:
  - <2-5 bullets, each one line>
WARNINGS: <list, or "none">
NEXT: <one sentence telling the orchestrator what to dispatch or check next>
```

`STATUS` semantics:
- `ok`: everything requested was produced. Orchestrator can proceed.
- `partial`: core deliverable produced, with caveats the orchestrator must see before continuing.
- `failed`: deliverable missing or unusable. See `workspace/errors/` for details.

## Rules

- Agents read and write to `workspace` only. No global state, no home-directory writes, no network caching outside the workspace.
- Agents return paths, not file bodies. If the caller or a downstream agent needs content, it reads the file directly.
- Agents never dispatch other agents. Only `SKILL.md` orchestrates.
- Every run appends detailed progress to `workspace/agent-log-<name>-<timestamp>.md`. This log is for debugging and is never part of the returned summary.
- Summaries are capped at 300 words. If an agent has more to say, it goes in the log.

## Failure Handling

On any failure (missing input, tool crash, asset 404 that blocks the task, pixelmatch threshold miss that the agent can't self-correct), the agent:

1. Writes `workspace/errors/<name>-<timestamp>.md` containing: root cause, stack or command output, state of partial files, and a suggested recovery action.
2. Returns `STATUS: failed` with a one-line root cause in `KEY_FINDINGS` and `NEXT` pointing at the error file.

Partial failures (e.g. 7 of 8 sections reconstructed) return `STATUS: partial`, list the gap in `WARNINGS`, and let the orchestrator decide whether to retry or continue.

## Worked Examples

All three examples use workspace `/tmp/clone-workspace-acme` and `target_url: https://acme.example.com` at breakpoint `1440`.

### Extractor

Input: no `section_index`. Summary:
```
STATUS: ok
WORKSPACE: /tmp/clone-workspace-acme
WROTE:
  - site-dna.json (842 KB)
  - assets/images/ (47 files), assets/svg/ (12), assets/fonts/ (4)
  - references/screenshots/1440-full-page.png
  - references/screenshots/1440-section-{0..7}.png
KEY_FINDINGS:
  - 8 sections: header, hero, features, stats, testimonials, pricing, cta, footer
  - Typography: Inter (body) + Lora (display)
  - 12 distinct colors, dominant navy with cyan accent
  - 3 inline SVGs need fill="currentColor" handling downstream
WARNINGS:
  - 1 background image 404 from origin (see errors/extractor-asset-404.md)
NEXT: dispatch reconstructor for sections 0..7
```

### Reconstructor

Input: `section_index: 1`, `notes: "hero, match gradient and preserve Lora letter-spacing"`. Summary:
```
STATUS: ok
WORKSPACE: /tmp/clone-workspace-acme
WROTE:
  - sections/01-hero/index.html
  - sections/01-hero/styles.css
  - sections/01-hero/notes.md
KEY_FINDINGS:
  - 2-column grid at 1440, stacks below 960
  - Background is a radial gradient, not an image (confirmed via site-dna.json)
  - Headline letter-spacing forced to normal to match extracted value
  - CTA button reuses tokens --color-accent and --radius-pill
WARNINGS: none
NEXT: dispatch comparator for section_index 1
```

### Comparator

Input: `section_index: 1`. Summary:
```
STATUS: partial
WORKSPACE: /tmp/clone-workspace-acme
WROTE:
  - comparisons/01-hero/diff.png
  - comparisons/01-hero/report.json
  - comparisons/01-hero/report.md
KEY_FINDINGS:
  - Pixelmatch delta 0.71% (threshold 0.5%)
  - Headline y-offset 4px too low vs reference
  - CTA button padding-inline short by 6px
  - Gradient stops match within tolerance
WARNINGS:
  - Above threshold, reconstructor rerun recommended before shipping
NEXT: dispatch reconstructor for section_index 1 with notes from report.md, then re-run comparator
```

## Why This Contract

Two goals: preserve the orchestrator's context window, and make handoffs deterministic. Files on disk are the source of truth, summaries are navigation. An agent that follows this contract can be rerun, retried, or swapped out without the orchestrator needing to remember anything beyond the workspace path and the last summary it received.
