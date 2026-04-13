# Site DNA Schema Reference

This document defines the complete schema for the `site-dna.json` file produced
by Phase 1 extraction. Every field is populated with computed (resolved) values,
never authored CSS source values.

## Top-Level Structure

```json
{
  "meta": { ... },
  "typography": [ ... ],
  "colors": { ... },
  "spacing": { ... },
  "layout": { "1440px": { ... }, "1024px": { ... }, "768px": { ... }, "375px": { ... } },
  "components": { "1440px": { ... }, "1024px": { ... }, "768px": { ... }, "375px": { ... } },
  "interactiveStates": [ ... ],
  "pseudoElements": [ ... ],
  "alignmentMap": { "sections": [ ... ], "alignmentConsistency": { ... } },
  "scrollBehaviors": { ... },
  "assets": { ... },
  "warnings": [ ... ]
}
```

**v3 additions:** `pseudoElements` captures rendered `::before`/`::after` styles.
`alignmentMap` traces the padding chain from viewport edge to content for each section.
`typography` entries now include `context.section` and `context.role` for section-grouped mapping.

**Multi-breakpoint fields:** `layout` and `components` are keyed by breakpoint width
(e.g., `"1440px"`, `"375px"`). This captures structural changes at different viewports —
hidden elements, reorganized grids, collapsed navigation, etc.

## meta

```json
{
  "sourceUrl": "https://example.com",
  "extractedAt": "2025-01-15T10:30:00.000Z",
  "breakpoints": [1440, 1024, 768, 375],
  "pageTitle": "Example — The best example site"
}
```

## typography

Array of text styles grouped by section and role, sorted by page position then font-size.
Unlike v2 which deduplicated purely by CSS values, v3 preserves section context so you
know which style goes where during reconstruction.

```json
[
  {
    "fontFamily": "\"Inter\", sans-serif",
    "fontSize": "12px",
    "fontWeight": "800",
    "lineHeight": "18px",
    "letterSpacing": "normal",
    "textTransform": "uppercase",
    "color": "rgb(26, 26, 26)",
    "fontStyle": "normal",
    "textDecoration": "none solid rgb(26, 26, 26)",
    "context": {
      "section": "nav",
      "tag": "a",
      "role": "nav-link",
      "sampleText": "Platform",
      "sampleClasses": "nav-link active",
      "position": { "top": 45, "left": 320 }
    },
    "occurrences": 6
  },
  {
    "fontFamily": "\"Lora\", serif",
    "fontSize": "72px",
    "fontWeight": "400",
    "lineHeight": "79px",
    "letterSpacing": "-0.02em",
    "textTransform": "none",
    "color": "rgb(255, 255, 255)",
    "fontStyle": "italic",
    "textDecoration": "none solid rgb(255, 255, 255)",
    "context": {
      "section": "hero",
      "tag": "h1",
      "role": "heading-h1",
      "sampleText": "The WordPress platform for all",
      "sampleClasses": "hero-title",
      "position": { "top": 380, "left": 192 }
    },
    "occurrences": 1
  }
]
```

**Usage notes:**
- `context.section` identifies which page section this style belongs to
- `context.role` is inferred: "nav-link", "heading-h1", "body-text", "button-label", "caption", etc.
- `context.position` gives the page-level coordinates for mapping styles to locations
- Styles are sorted by `position.top` (page order), then by `fontSize` descending
- `fontFamily` is the resolved value — may include fallback stack
- `fontSize` and `lineHeight` are always in px (computed values)
- `letterSpacing` may be in px or em depending on browser resolution
- `occurrences` counts matching elements within the same section

## colors

```json
{
  "text": ["rgb(17, 17, 17)", "rgb(107, 114, 128)", "rgb(255, 255, 255)"],
  "background": ["rgb(255, 255, 255)", "rgb(249, 250, 251)", "rgb(17, 17, 17)"],
  "border": ["rgb(229, 231, 235)", "rgb(209, 213, 219)"],
  "shadows": [
    "rgba(0, 0, 0, 0.1) 0px 1px 3px 0px, rgba(0, 0, 0, 0.06) 0px 1px 2px 0px"
  ],
  "gradients": [
    "linear-gradient(135deg, rgb(59, 130, 246), rgb(147, 51, 234))"
  ]
}
```

**Usage notes:**
- All color values are in the browser's computed format (usually `rgb()` or `rgba()`)
- Convert to hex during token generation for readability
- Shadows include the full shorthand value — preserve exactly

## spacing

```json
{
  "allValues": [
    { "value": 16, "count": 142 },
    { "value": 24, "count": 98 },
    { "value": 8, "count": 87 }
  ],
  "inferredScale": [4, 8, 12, 16, 20, 24, 32, 48, 64, 96]
}
```

**Usage notes:**
- `allValues` is sorted by frequency (most common first)
- `inferredScale` filters to values appearing 3+ times, sorted ascending
- Use the inferred scale for design tokens; one-off values stay as hardcoded px

## layout

Keyed by breakpoint width. Each breakpoint contains its own set of sections with
computed values at that viewport size.

```json
{
  "1440px": {
    "sections": [
      {
        "index": 0,
        "tag": "header",
        "id": "site-header",
        "classes": "fixed top-0 w-full",
        "rect": { "width": 1440, "height": 80, "top": 0, "left": 0 },
        "display": "flex",
        "flexDirection": "row",
        "justifyContent": "space-between",
        "alignItems": "center",
        "gridTemplateColumns": "none",
        "gridTemplateRows": "none",
        "gap": "normal",
        "maxWidth": "1280px",
        "margin": "0px auto 0px auto",
        "padding": "0px 32px 0px 32px",
        "backgroundColor": "rgba(255, 255, 255, 0.95)",
        "position": "fixed",
        "zIndex": "50",
        "overflow": "visible",
        "childCount": 3,
        "childLayout": [
          {
            "tag": "a",
            "width": 120,
            "height": 40,
            "display": "flex",
            "position": "static",
            "visibility": "visible",
            "hidden": false
          }
        ]
      }
    ]
  },
  "375px": {
    "sections": [ /* same structure, different computed values at mobile */ ]
  }
}
```

**Usage notes:**
- Compare `childLayout[n].hidden` across breakpoints to find elements that
  are hidden at mobile (e.g., desktop nav links replaced by hamburger menu)
- `gridTemplateColumns` changes between breakpoints reveal responsive grid behavior

## components

Keyed by breakpoint width, like layout. Each breakpoint captures what's visible
and how it's sized at that viewport.

```json
{
  "1440px": {
    "buttons": [
      {
        "text": "Get Started",
        "selector": "a[data-testid=\"cta-hero\"]",
        "width": 160,
        "height": 48,
        "backgroundColor": "rgb(59, 130, 246)",
        "color": "rgb(255, 255, 255)",
        "border": "0px none rgb(255, 255, 255)",
        "borderRadius": "8px",
        "padding": "12px 24px 12px 24px",
        "fontSize": "16px",
        "fontWeight": "600",
        "fontFamily": "\"Inter\", sans-serif",
        "textTransform": "none",
        "letterSpacing": "normal",
        "boxShadow": "rgba(59, 130, 246, 0.5) 0px 4px 14px 0px",
        "transition": "all 0.2s ease 0s",
        "cursor": "pointer",
        "display": "inline-flex"
      }
    ],
    "cards": [
      {
        "selector": "#features > div:nth-child(2) > div:nth-child(1)",
        "width": 380,
        "height": 320,
        "backgroundColor": "rgb(249, 250, 251)",
        "border": "1px solid rgb(229, 231, 235)",
        "borderRadius": "12px",
        "boxShadow": "rgba(0, 0, 0, 0.05) 0px 1px 2px 0px",
        "padding": "24px 24px 24px 24px",
        "display": "flex",
        "flexDirection": "column",
        "gap": "16px",
        "overflow": "hidden",
        "childCount": 4,
        "hasImage": true,
        "hasText": true,
        "childTags": ["img", "h3", "p", "a"]
      }
    ],
    "navigation": [
      {
        "type": "header",
        "selector": "header.site-header",
        "width": 1440,
        "height": 72,
        "backgroundColor": "rgba(255, 255, 255, 0.95)",
        "position": "fixed",
        "display": "flex",
        "flexDirection": "row",
        "justifyContent": "space-between",
        "alignItems": "center",
        "gap": "32px",
        "padding": "0px 48px 0px 48px",
        "zIndex": "50",
        "backdropFilter": "blur(10px)",
        "linkCount": 5,
        "links": [
          {
            "text": "Features",
            "fontSize": "14px",
            "fontWeight": "500",
            "color": "rgb(55, 65, 81)",
            "textDecoration": "none solid rgb(55, 65, 81)"
          }
        ]
      }
    ],
    "forms": [
      {
        "selector": "form.subscribe-form",
        "width": 480,
        "height": 56,
        "display": "flex",
        "flexDirection": "row",
        "gap": "8px",
        "backgroundColor": "rgba(0, 0, 0, 0)",
        "borderRadius": "0px",
        "padding": "0px 0px 0px 0px",
        "inputCount": 1,
        "inputs": [
          {
            "type": "email",
            "placeholder": "Enter your email",
            "width": 360,
            "height": 48,
            "backgroundColor": "rgb(255, 255, 255)",
            "border": "1px solid rgb(209, 213, 219)",
            "borderRadius": "8px",
            "fontSize": "14px",
            "padding": "12px 16px 12px 16px",
            "color": "rgb(17, 17, 17)"
          }
        ]
      }
    ],
    "media": [
      {
        "tag": "img",
        "selector": "img[alt=\"Hero image\"]",
        "src": "https://example.com/hero.jpg",
        "alt": "Hero image",
        "width": 640,
        "height": 480,
        "objectFit": "cover",
        "borderRadius": "16px",
        "aspectRatio": "1.333"
      }
    ],
    "decorative": [
      {
        "type": "divider",
        "selector": "hr.section-divider",
        "width": 1200,
        "height": 1,
        "backgroundColor": "rgba(0, 0, 0, 0)",
        "borderTop": "1px solid rgb(229, 231, 235)",
        "margin": "64px 0px"
      },
      {
        "type": "badge",
        "selector": "span.badge-new",
        "text": "New",
        "width": 48,
        "height": 24,
        "backgroundColor": "rgb(59, 130, 246)",
        "color": "rgb(255, 255, 255)",
        "borderRadius": "12px",
        "fontSize": "12px",
        "fontWeight": "600",
        "padding": "2px 8px 2px 8px"
      }
    ]
  },
  "375px": {
    /* Same structure — values reflect mobile viewport */
  }
}
```

## interactiveStates

After running `extract-state-deltas.js`, each entry gains `hoverDelta` and
`focusDelta` objects showing only the properties that changed.

Selectors use a robust strategy: data- attributes → id → aria-label → unique
class combo → nth-child path. The `selectorIsUnique` flag indicates whether the
selector resolves to exactly one element (non-unique selectors are skipped during
hover extraction to avoid ambiguity).

```json
[
  {
    "selector": "a[data-testid=\"cta-hero\"]",
    "selectorIsUnique": true,
    "text": "Get Started",
    "defaultState": {
      "backgroundColor": "rgb(59, 130, 246)",
      "color": "rgb(255, 255, 255)",
      "transform": "none",
      "opacity": "1",
      "boxShadow": "rgba(59, 130, 246, 0.5) 0px 4px 14px 0px"
    },
    "transition": {
      "property": "all",
      "duration": "0.2s",
      "timingFunction": "ease",
      "delay": "0s"
    },
    "hoverDelta": {
      "backgroundColor": {
        "from": "rgb(59, 130, 246)",
        "to": "rgb(37, 99, 235)"
      },
      "transform": {
        "from": "none",
        "to": "matrix(1, 0, 0, 1, 0, -2)"
      },
      "boxShadow": {
        "from": "rgba(59, 130, 246, 0.5) 0px 4px 14px 0px",
        "to": "rgba(59, 130, 246, 0.5) 0px 8px 20px 0px"
      }
    },
    "focusDelta": {
      "outline": {
        "from": "rgb(59, 130, 246) none 0px",
        "to": "rgb(59, 130, 246) solid 2px"
      }
    }
  }
]
```

## scrollBehaviors

```json
{
  "pageHeight": 5400,
  "viewportHeight": 900,
  "timeline": [
    {
      "scrollY": 400,
      "changedElements": {
        "scroll-el-3": {
          "selector": "div.feature-card",
          "transform": "matrix(1, 0, 0, 1, 0, 50)",
          "opacity": "0",
          "position": "relative",
          "top": "auto",
          "visibility": "visible",
          "classList": "feature-card"
        }
      }
    }
  ],
  "classifications": [
    {
      "elementId": "scroll-el-3",
      "selector": "div.feature-card",
      "type": "fade-in",
      "details": {
        "triggerScrollY": 450,
        "startOpacity": 0,
        "endOpacity": 1
      }
    },
    {
      "elementId": "scroll-el-7",
      "selector": "div.parallax-bg",
      "type": "parallax",
      "details": {
        "multiplier": "-0.3000",
        "direction": "up"
      }
    },
    {
      "elementId": "scroll-el-0",
      "selector": "header.site-header",
      "type": "sticky",
      "details": {
        "triggerScrollY": 100,
        "stickyPosition": "fixed"
      }
    }
  ]
}
```

**Scroll behavior types:**
- `fade-in`: Element transitions from transparent to opaque at a scroll threshold
- `slide-in`: Element transforms (translate) into position at a scroll threshold
- `parallax`: Element translateY moves linearly with scroll (multiplier defines rate)
- `sticky`: Element changes from flow position to fixed/sticky at a threshold
- `scale`: Element scale changes with scroll position
- `rotation`: Element rotation changes with scroll position
- `progress-linked`: Element style is a continuous function of scroll percentage

## assets

```json
{
  "fonts": [
    { "type": "external", "url": "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700" },
    {
      "type": "font-face",
      "family": "\"CustomBrand\"",
      "src": "url('/fonts/custom-brand.woff2') format('woff2')",
      "weight": "400",
      "style": "normal"
    }
  ],
  "images": [
    {
      "src": "https://example.com/hero.jpg",
      "naturalWidth": 1920,
      "naturalHeight": 1080,
      "renderedWidth": 640,
      "renderedHeight": 360,
      "alt": "Hero image",
      "loading": "eager"
    }
  ],
  "backgroundImages": [
    {
      "element": "section#features",
      "backgroundImage": "url(\"https://example.com/pattern.svg\")",
      "backgroundSize": "cover",
      "backgroundPosition": "center center",
      "backgroundRepeat": "no-repeat"
    }
  ],
  "icons": {
    "type": "inline-svg",
    "count": 24
  },
  "corsBlockedStylesheets": [
    {
      "href": "https://cdn.example.com/fonts/custom.css",
      "ownerNode": "link",
      "reason": "SecurityError: Cannot access cssRules due to CORS policy"
    }
  ]
}
```

**Usage notes:**
- `corsBlockedStylesheets` lists every stylesheet that could NOT be read due to CORS.
  Font-face declarations and CSS rules from these sheets are missing from the DNA.
  When this array is non-empty, manual inspection of those stylesheet URLs is recommended.

## warnings

Top-level array of extraction issues that may affect reconstruction accuracy.

```json
[
  {
    "type": "cors-blocked-stylesheets",
    "message": "2 stylesheet(s) could not be read due to CORS. Font-face declarations from these sheets are missing.",
    "details": [
      {
        "href": "https://cdn.example.com/fonts/custom.css",
        "ownerNode": "link",
        "reason": "SecurityError: Cannot access cssRules due to CORS policy"
      }
    ]
  }
]
```

**Warning types:**
- `cors-blocked-stylesheets`: CORS prevented reading one or more stylesheets.
  May contain @font-face, animations, or other rules not captured in the DNA.
