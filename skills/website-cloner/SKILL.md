---
name: website-cloner
description: >
  Deterministic website cloning skill that reverse-engineers any website into a pixel-accurate
  reproduction. Use this skill whenever the user asks to clone, replicate, copy, reproduce, or
  rebuild an existing website or webpage. Also trigger when the user says things like "make it
  look exactly like this site", "copy this design", "rebuild this page", "match this website",
  "recreate this UI", or provides a URL and asks for it to be turned into code. This skill
  treats the target site as a deterministic spec — not an inspiration — and follows a rigorous
  extraction-then-reconstruction protocol to achieve pixel-perfect results. Supports both live
  sites and Wayback Machine archived pages. Do NOT use for designing original websites or for
  "inspired by" requests where the user wants a new design that merely borrows ideas.
---

# Website Cloner v4

A deterministic protocol for reverse-engineering any website into a pixel-accurate reproduction.

**Core principle: the target site IS the spec.** Every visual decision has already been made.
Your job is forensic extraction followed by mechanical reconstruction.

**Effort calibration:** A complex marketing homepage (10+ sections) is a multi-session project.
Phase 1 (extraction) typically takes 1-2 hours. Phase 2 (reconstruction) takes 3-5x longer
because each section requires iterative comparison and refinement. The hero section is the
hardest — it can take 15+ iterations to match because it sets the typographic scale, container
pattern, and color system. Subsequent sections go significantly faster because those patterns
are already established. Plan accordingly.

## Prerequisites

Before starting, verify a browser automation tool is available. The bundled scripts
use Playwright, but the protocol itself is browser-agnostic — any tool that can
automate a browser, inject JavaScript, and take screenshots works (Playwright, Puppeteer,
dev-browser, agent-browser). If using a different tool, adapt the script API calls
while keeping the extraction logic identical.

Default setup (Playwright):
- `npm install playwright && npx playwright install chromium`
- `npm install pixelmatch pngjs sharp`

If cloning from Wayback Machine, read `references/wayback-machine.md` BEFORE starting.

## Overview: The Two-Phase Protocol

```
Phase 1: EXTRACTION (analyze everything, download everything, write nothing)
  Step 1 → Capture reference screenshots at all breakpoints
  Step 2 → Download ALL assets (images, SVGs, fonts, backgrounds)
  Step 3 → Extract Site DNA (typography, colors, spacing, layout, components)
  Step 4 → Extract pseudo-element styles (::before, ::after)
  Step 5 → Map interactive states (hover, focus, active) including pseudo-element deltas
  Step 6 → Record scroll-linked behaviors and animations
  Step 7 → Extract padding chains / content alignment map
  Step 8 → Compile the Site DNA JSON document

Phase 2: RECONSTRUCTION (section-iterative build from DNA + assets)
  Step 9  → Generate design tokens (CSS custom properties)
  Step 10 → Build, compare, and fix EACH SECTION iteratively:
            For each section N:
              a. Build Section N using DNA values + downloaded assets
              b. Screenshot Section N
              c. Run section-level pixelmatch comparison
              d. Generate element-level comparison checklist
              e. Fix deviations until section passes (≥98% match)
              f. Move to Section N+1
  Step 11 → Implement animations and interactions
  Step 12 → Final cross-breakpoint audit
```

**Critical rules:**
1. Phase 1 must be 100% complete before any Phase 2 work begins.
2. Assets must be downloaded BEFORE reconstruction — never use placeholders for first pass.
3. Each section must pass visual comparison before moving to the next.

---

## Phase 1: Site DNA Extraction

### Step 1: Reference Screenshots

Capture full-page and above-fold screenshots at these breakpoints:

```
Breakpoints: 1440px, 1024px, 768px, 375px
```

For each breakpoint capture: full-page (scrolled), above-fold (viewport only), and
individual section crops (one per major section). Save to `clone-workspace/references/screenshots/`.

Additionally, capture **section-level screenshots** by screenshotting each `<section>`, `<header>`,
`<footer>`, and major `<div>` individually. These are used for section-iterative comparison
in Phase 2. Name them: `{breakpoint}-section-{index}-{id-or-tag}.png`.

### Step 2: Asset Download (MANDATORY — not optional)

This is the single highest-impact step. Without real assets, reconstruction accuracy
drops to ~40%. With them, first-pass accuracy reaches 80%+.

Run the asset extraction script: `node scripts/extract-assets.js <target-url>`

If the script is unavailable, perform these extraction passes manually:

#### 2a. Network-Level Asset Capture
Register a response listener BEFORE page.goto() to intercept all HTTP responses.
Capture every image, font, stylesheet, and media resource. Save raw bytes organized
by type: `assets/images/`, `assets/fonts/`, `assets/css/`, `assets/media/`.

#### 2b. Lazy-Load Triggering
Scroll the entire page in 300px increments with 200ms delays to trigger
IntersectionObserver-based lazy loading. After scrolling, force-load remaining
lazy images by copying `data-src` → `src`, `data-lazy` → `src`, etc.

#### 2c. Inline SVG Extraction
This is critical — many sites use inline SVGs for logos, icons, and decorative elements.
These don't appear in `<img>` tags and won't be caught by network interception.

For each `<svg>` element on the page, extract:
- `outerHTML` (the complete SVG markup)
- `viewBox` attribute
- Computed dimensions (`getBoundingClientRect()`)
- Parent context: which section, whether inside `<a>`, `<button>`, `<nav>`, `<header>`, `<footer>`
- Fill strategy: `currentColor` (inherits CSS color — themeable) vs hardcoded hex/rgb vs mixed
- Classification (use heuristics): logo (in header/nav, 80-300px wide), icon (≤32px, in button),
  decorative (large area, few paths), illustration (many paths/elements)

Save each SVG as a separate `.svg` file in `assets/svg/`. Ensure `xmlns="http://www.w3.org/2000/svg"`
is set (required for standalone files but implicit in HTML5 DOM).

For SVGs using `<use href="#id">` (sprite references), resolve the referenced `<symbol>`
and extract its content with the symbol's viewBox.

#### 2d. Background Image Extraction
Query all elements for `getComputedStyle(el).backgroundImage`. Extract URLs from
`url(...)` values. Download each. Map to the element's section for organized storage.

#### 2e. Font File Extraction
Collect font URLs from:
- `<link>` tags with `href` containing `fonts.googleapis.com`, `fonts.gstatic.com`, `use.typekit.net`
- `@font-face` rules in accessible stylesheets (src descriptor URLs)
- Network responses with `content-type: font/*` or `application/font-*`

#### 2f. Asset Verification
After download, verify:
- Files > 1KB (anything smaller is likely a failed download or placeholder)
- Images render correctly (valid headers)
- SVG files parse as valid XML
- Log any failed downloads with URLs for manual retry

### Step 3: Site DNA Extraction

Run: `node scripts/extract-site-dna.js <target-url>`

This extracts computed values (not authored CSS) for everything on the page.
The extraction must run at ALL breakpoints for layout and components.

#### 3a. Typography System — With Section Context
For every unique text style, extract computed values AND map to the element's context.
Don't just deduplicate by values — group by section and role:

```
Section: Navigation
  - nav-link: Inter 12px weight-800 line-height-1.5 color-#1a1a1a
  - nav-cta: Inter 14px weight-600 line-height-1 color-#fff

Section: Hero  
  - hero-label: Inter 14px weight-700 line-height-1.5 uppercase color-#00e0ff
  - hero-headline: Lora 72px weight-400 italic line-height-1.1 color-#fff
  - hero-description: Inter 18px weight-600 line-height-1.6 color-#e0e0e0
```

This mapping tells you WHICH style goes WHERE — critical for reconstruction.

#### 3b. Colors — extract as in v2 (unchanged)

#### 3c. Spacing — extract as in v2 (unchanged)

#### 3d. Layout — at ALL breakpoints (unchanged from v2)

#### 3e. Components — at ALL breakpoints with full detection (unchanged from v2)

#### 3f. Assets inventory with CORS logging (unchanged from v2)

### Step 4: Pseudo-Element Extraction

Many hover effects, decorative elements, and visual details are implemented via
`::before` and `::after` pseudo-elements. These are invisible to DOM queries but
critical for visual fidelity.

For each element on the page, check for rendered pseudo-elements:

```javascript
const styles = window.getComputedStyle(el, '::before');
const content = styles.getPropertyValue('content');
const display = styles.getPropertyValue('display');
// Renders if content !== 'none' AND content !== 'normal' AND display !== 'none'
```

For each rendered pseudo-element, capture: `content`, `display`, `position`, `top/left/right/bottom`,
`width`, `height`, `opacity`, `z-index`, `background-color`, `background-image`, `transform`,
`border-radius`, `color`, `font-size`, `box-shadow`, `clip-path`, `filter`, `backdrop-filter`.

**Important**: `getComputedStyle(el, '::before')` only works with longhand properties.
Use `getPropertyValue('font-size')`, not `getPropertyValue('font')`.

**Limitation**: No `getBoundingClientRect()` for pseudo-elements (no DOM node exists).
Infer dimensions from computed width/height/position plus parent's bounding box.

### Step 5: Interactive State Mapping (including pseudo-element deltas)

For each interactive element, trigger hover/focus/active and capture the DELTA:

```
For each interactive element:
  1. Capture DEFAULT state (element + its ::before/::after)
  2. Trigger HOVER → wait 300ms for transitions → capture DELTA for:
     - The element's own styles
     - Its ::before pseudo-element (if rendered)
     - Its ::after pseudo-element (if rendered)
  3. Trigger FOCUS → capture DELTA (same three targets)
  4. Record transition properties (duration, easing, delay)
```

Common hover pseudo-element patterns to detect:
- `::before` opacity 0 → 1 (overlay effect, like white background on hover)
- `::after` transform scaleX(0) → scaleX(1) (underline animation)
- `::before` background-color change (color overlay)

### Step 6: Scroll Behavior Recording (unchanged from v2)

### Step 7: Padding Chain / Content Alignment Map

This is the most common source of alignment errors. Extract the FULL nesting chain
from viewport edge to content for each section.

For each major section, find the innermost content container and walk UP the DOM
to `<body>`, recording at each ancestor:
- `paddingLeft`, `paddingRight`, `marginLeft`, `marginRight`
- `borderLeftWidth`, `borderRightWidth`
- `boxSizing` (content-box vs border-box)
- `maxWidth`
- `getBoundingClientRect()` (left, right, width)

The output is a "content alignment map":
```
Section: Utility Bar
  Viewport (1440px) → body (padding: 0) → div.utility-bar (full-width)
    → div.container (max-width: 1440px, margin: 0 auto)
    → Content starts at: 77.5px from left edge

Section: Navigation
  Viewport (1440px) → body → header → nav (max-width: 1440px, margin: 0 auto)
    → div.nav-inner (padding: 0 77.5px)
    → Content starts at: 77.5px from left edge

Section: Hero
  Viewport (1440px) → body → section.hero (full-bleed)
    → div.hero-content (max-width: 1280px, margin: 0 auto, padding: 0 72px)
    → div.hero-inner (padding-left: 120px)
    → Content starts at: 192px from left edge
```

Detect the container strategy for each section:
- **Max-width centered**: maxWidth set + marginLeft ≈ marginRight
- **Full-bleed with padding**: width >98% of viewport + paddingLeft/Right > 10px
- **CSS Grid**: display === 'grid'
- **Asymmetric**: different left/right padding (like hero with left-aligned content)

Also compute **alignment consistency**: group sections by content start position.
If most sections start at 80px but one starts at 192px, that's intentional asymmetry
(like a hero with extra left padding), not a mistake.

### Step 8: Compile the Site DNA Document

Assemble all extracted data into `site-dna.json`. Read `references/site-dna-schema.md`
for the full schema. The DNA document now includes:
- `pseudoElements`: per-element pseudo-element styles and hover deltas
- `alignmentMap`: per-section padding chain and content start position
- `typography`: grouped by section + role (not just deduplicated by values)
- `assets.inlineSvgs`: classified SVG inventory with fill strategies
- `warnings`: CORS-blocked sheets, failed asset downloads, extraction errors

Completeness checklist before proceeding to Phase 2:
- [ ] All breakpoint screenshots captured (full-page + section-level)
- [ ] ALL assets downloaded and verified (images, SVGs, fonts, backgrounds)
- [ ] Inline SVGs extracted, classified, and saved as files
- [ ] Typography mapped by section + role (not just values)
- [ ] Layout extracted at ALL breakpoints
- [ ] Components extracted at ALL breakpoints
- [ ] Pseudo-element styles captured for all rendered ::before/::after
- [ ] Hover/focus deltas include pseudo-element changes
- [ ] Padding chains / content alignment map computed
- [ ] Scroll behaviors classified
- [ ] Warnings reviewed (CORS blocks, failed downloads)

---

## Phase 2: Section-Iterative Reconstruction

**The fundamental change from v2:** Don't build a skeleton and then fill it in.
Build each section completely, compare it, fix it, then move on. This prevents
compounding errors and reduces total iterations.

### Step 9: Generate Design Tokens

From the Site DNA, generate CSS custom properties. This is mechanical — every token
maps directly to an extracted value. Run: `node scripts/generate-tokens.js <site-dna-path>`

Include font loading (`<link>` tags or `@font-face`) based on the assets inventory.
Use the downloaded font files when available.

### Step 10: Section-Iterative Build + Compare

For each section (in page order: utility bar → nav → hero → features → ... → footer):

#### 10a. Build Section N
Write the HTML structure matching the DNA's layout data for this section.
Apply design tokens — never hardcode values that exist as tokens.
Use the downloaded assets (real images, real SVGs) — never placeholders.
Match the padding chain from the alignment map exactly.

#### 10b. Screenshot Section N
Take a screenshot of just this section at the primary breakpoint (1440px).

#### 10c. Section-Level Visual Comparison
Run: `node scripts/section-compare.js <reference-section.png> <clone-section.png>`

This produces:
1. A pixelmatch diff image (red pixels = differences)
2. Match percentage (target: ≥95% per section)
3. An element-level comparison checklist

Note: font rendering differences between browsers can account for 2-3% mismatch alone.
95% per section is the right bar — overfitting to 98% leads to chasing anti-aliasing ghosts.

#### 10d. Element-Level Comparison Checklist
The comparison generates a structured per-element report:

```
Section: Hero (98.2% pixel match)
  ✓ Background: full-bleed dark gradient — matches
  ✓ Headline font: Lora 72px italic — matches
  ✗ Nav logo width: 160px (should be 148px) — DELTA: 12px
  ✗ Nav link font-weight: 700 (should be 800) — DELTA: 100
  ✗ CTA button border-radius: 4px (should be 8px) — DELTA: 4px
  ✓ Hero description: Inter 18px weight-600 — matches
```

#### 10e. Fix Deviations
For each failing element, look up the exact value in `site-dna.json` and correct.
Re-screenshot, re-compare. Repeat until the section passes (≥95% match).

#### 10f. Move to Section N+1
Only after Section N passes. The cumulative page should still look correct —
occasionally do a full-page screenshot to catch inter-section issues.

**Build order:**
1. Global elements first (header/nav) — they set the page-wide container pattern
2. Hero (highest visual impact, sets the tone)
3. Each subsequent section in page order
4. Footer last

### Step 11: Implement Animations and Interactions

After the static version matches, layer in interactions:

1. CSS transitions on interactive elements (hover, focus, active states)
   - Apply the exact delta values from Step 5 including pseudo-element deltas
   - Use the exact transition properties, durations, and easing curves
2. Scroll-triggered animations
   - For simple fade/slide-ins: IntersectionObserver with extracted thresholds
   - For parallax: scroll listeners with extracted multipliers
   - For AOS-style reveals: include the AOS library and clone the data attributes
3. Page load animations
4. Remaining micro-interactions

Read `references/reconstruction-patterns.md` for code patterns.

### Step 12: Final Cross-Breakpoint Audit

Run section-level comparison at ALL breakpoints:

```
For each breakpoint (1440, 1024, 768, 375):
  For each section:
    1. Screenshot the section
    2. Compare against reference section screenshot
    3. Check ≥95% section match
  Full-page comparison: ≥98% match (the bar is higher here because
  inter-section spacing and global consistency matter)
```

Generate a final comparison report covering all sections at all breakpoints.

---

## Output Structure

```
clone-workspace/
├── references/
│   ├── screenshots/
│   │   ├── 1440-full-page.png
│   │   ├── 1440-section-0-header.png
│   │   ├── 1440-section-1-hero.png
│   │   └── ...
│   └── font-substitutions.md
├── assets/                    # Downloaded assets (NEW in v3)
│   ├── images/
│   ├── svg/                   # Extracted inline SVGs
│   ├── fonts/
│   ├── backgrounds/
│   └── asset-manifest.json    # Maps assets to sections
├── site-dna.json
├── comparison-report.md       # Per-section comparison results
├── diff-images/               # Pixelmatch diff images per section
└── build/
    ├── index.html
    ├── styles/
    │   ├── tokens.css
    │   └── main.css
    ├── scripts/
    │   └── main.js
    └── assets/
        ├── images/
        ├── svg/
        └── fonts/
```

## Wayback Machine Sources

If the target URL is from `web.archive.org`, read `references/wayback-machine.md`
before starting extraction. Key differences:
- Use the `if_` URL modifier to load without the WM toolbar
- Asset URLs need Wayback prefix handling
- Next.js `_next/image` URLs need special decoding
- Rate limit requests to ~2/second
- Some assets may be missing — use the fallback chain

## Edge Cases and Decisions

**Dynamic content (carousels, tabs, accordions):**
Extract the first/default state fully. Document all other states.

**Third-party widgets (chat bubbles, cookie banners):**
Skip unless specifically requested.

**SVG illustrations and custom graphics:**
Download the SVG source. If rasterized, download the raster. Never try to recreate
complex illustrations in CSS.

**Video backgrounds:**
Extract a still frame as fallback. Implement the video if source is accessible.

**Web fonts behind a paywall:**
Use the font substitution protocol. Document every substitution.

## What This Skill Does NOT Do

- Generate "inspired by" designs — this is forensic cloning
- Clone server-side behavior, APIs, or backend logic
- Bypass authentication or scrape login-gated content
- Clone SPAs with complex client-side routing (clones the visual layer only)
