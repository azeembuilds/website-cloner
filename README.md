# Website Cloner

A Claude Code plugin that clones any live website into editable HTML and CSS. Point it at a URL. Come back to working code that looks like the original.

## What it does

Give it a URL. It extracts everything a website tells the browser (layout, typography, colors, component structure, animations, responsive breakpoints), then reconstructs that site as clean HTML and CSS in a fresh workspace.

Not a screenshot. Not a PDF. A real, editable codebase you can modify, extend, or drop into your own project.

It runs in three phases, each as an isolated Claude Code sub-agent so your main conversation stays unpolluted:

1. **Extractor** visits the site at every breakpoint, captures reference screenshots, downloads assets, and writes a complete `site-dna.json` describing the page.
2. **Reconstructor** builds the page section by section from the DNA file, generating design tokens on the first section so the whole site stays consistent.
3. **Comparator** runs pixel-level diffs between your build and the reference, section by section, and tells you exactly what is off.

That is the whole loop. Extract. Build. Compare. Iterate if the diff is above your threshold.

## Why I built this

I kept hiring agencies and freelancers to clone marketing sites as starting points. Three to five days, five figures, mixed quality. I wanted the output in ten minutes.

Every other "AI website builder" in this space starts from scratch or from a template. This one treats the target site as a deterministic spec and matches it exactly. The output is yours. No vendor lock-in, no subscription, no template library.

## Install

Clone into your Claude Code plugins directory.

```bash
git clone https://github.com/azeembuilds/website-cloner.git ~/.claude/plugins/local/website-cloner
```

Then register the plugin in Claude Code per the local plugin loading flow (see [Claude Code docs on local plugins](https://docs.claude.com/en/docs/claude-code/plugins)).

Requires Node.js 18+ for the scoring scripts (extraction, token generation, visual diff).

## Quickstart

From inside any Claude Code session, just ask Claude to clone a site:

```
Clone https://example.com
```

Claude picks up the skill automatically, dispatches the three sub-agents in sequence, and writes the output to a fresh workspace directory under your current working folder.

Typical runtime: 10 to 20 minutes for a marketing page, depending on how many sections the page has.

## How it works

The plugin is structured as one orchestrating skill plus three sub-agents:

```
website-cloner/
├── skills/website-cloner/      # main orchestration + scripts
│   ├── SKILL.md                # phase dispatch logic
│   ├── scripts/                # extract-assets, generate-tokens, visual-diff
│   └── references/             # Site DNA schema, reconstruction patterns, sub-agent protocol
└── agents/
    ├── extractor.md            # Phase 1
    ├── reconstructor.md        # Phase 2 (one section per dispatch)
    └── comparator.md           # Phase 3 (one section per dispatch)
```

Each sub-agent returns a short summary, not raw output. That keeps your main conversation tight while the agents do the heavy work in isolation.

Full protocol details are in `skills/website-cloner/references/sub-agent-protocol.md`.

## What it handles well

- Static marketing sites (landing pages, product pages, pricing pages)
- Component-heavy layouts with complex grid or flex structures
- Design systems with tokens, typography scales, spacing scales
- Responsive breakpoints (desktop, tablet, mobile)
- Hover states, focus states, subtle animations
- Wayback Machine archived pages (use the archive URL directly)

## Known limitations

- Dynamic content behind auth walls is out of scope (the extractor hits what an unauthenticated browser sees)
- Single Page Apps with heavy client-side rendering need a longer extraction pass
- Video-heavy sites: reconstructs the layout, not the video files
- Font licensing: downloads the font files the site serves, same as any browser would. You are responsible for the license if you ship the output

## License

MIT. Use it, fork it, ship with it. No attribution required.

## Built by

[Azeem Khan](https://www.linkedin.com/in/azeemkhan01/) at [Calyber AI](https://calyber.ai/?utm_source=github&utm_medium=referral&utm_campaign=website-cloner-repo). We ship AI products for founders in two-week sprints.

Report bugs and feature requests in [Issues](https://github.com/azeembuilds/website-cloner/issues).
