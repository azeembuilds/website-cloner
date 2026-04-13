/**
 * Site DNA Extraction Script
 * 
 * Usage: node extract-site-dna.js <url> [--output <path>] [--breakpoints <widths>]
 * 
 * This script uses Playwright to load a target URL and extract every visual
 * property as computed values. The output is a deterministic Site DNA JSON
 * document that serves as the reconstruction spec.
 * 
 * Requirements: npm install playwright pixelmatch pngjs
 * First run: npx playwright install chromium
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const DEFAULT_BREAKPOINTS = [1440, 1024, 768, 375];
const SCROLL_STEP = 50;
const VIEWPORT_HEIGHT = 900;

// ──────────────────────────────────────────────
// Robust Selector Generator (injected into page)
// ──────────────────────────────────────────────
// This function is serialized and injected into page.evaluate() calls.
// It builds a reliable, unique selector using a priority cascade:
//   1. data-testid / data-id / data-cy / data-qa (test framework attrs)
//   2. id (if present and not auto-generated)
//   3. Unique aria-label + tag
//   4. Unique class combination (verified unique via querySelectorAll)
//   5. nth-child path from nearest identifiable ancestor
const ROBUST_SELECTOR_FN = `
function buildRobustSelector(el) {
  // 1. Data attributes (most stable — set by developers for testing/targeting)
  const dataAttrs = ['data-testid', 'data-id', 'data-cy', 'data-qa', 'data-component', 'data-section'];
  for (const attr of dataAttrs) {
    const val = el.getAttribute(attr);
    if (val) return '[' + attr + '="' + val.replace(/"/g, '\\\\"') + '"]';
  }
  
  // 2. ID (skip if it looks auto-generated: contains random hex/uuid patterns)
  if (el.id && !/[0-9a-f]{8,}|\\d{4,}|^:r/.test(el.id)) {
    return '#' + CSS.escape(el.id);
  }
  
  // 3. Unique aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) {
    const tag = el.tagName.toLowerCase();
    const candidate = tag + '[aria-label="' + ariaLabel.replace(/"/g, '\\\\"') + '"]';
    try {
      if (document.querySelectorAll(candidate).length === 1) return candidate;
    } catch(e) {}
  }
  
  // 4. Unique class combination (try progressively more classes)
  const classList = Array.from(el.classList || []).filter(c => 
    c && !/^\\d/.test(c) && c.length < 60 && !/[0-9a-f]{6,}/.test(c)
  );
  if (classList.length > 0) {
    const tag = el.tagName.toLowerCase();
    for (let len = 1; len <= Math.min(classList.length, 3); len++) {
      const combo = classList.slice(0, len).map(c => '.' + CSS.escape(c)).join('');
      const candidate = tag + combo;
      try {
        if (document.querySelectorAll(candidate).length === 1) return candidate;
      } catch(e) {}
    }
    // Try scoping under parent id
    const parent = el.parentElement;
    if (parent) {
      const parentId = parent.id && !/[0-9a-f]{8,}|\\d{4,}/.test(parent.id) ? '#' + CSS.escape(parent.id) : null;
      if (parentId) {
        const fallback = tag + classList.slice(0, 3).map(c => '.' + CSS.escape(c)).join('');
        const scoped = parentId + ' > ' + fallback;
        try {
          if (document.querySelectorAll(scoped).length === 1) return scoped;
        } catch(e) {}
      }
    }
  }
  
  // 5. nth-child path (always unique, last resort)
  const parts = [];
  let current = el;
  while (current && current !== document.body && parts.length < 5) {
    const tag = current.tagName.toLowerCase();
    if (current.id && !/[0-9a-f]{8,}|\\d{4,}|^:r/.test(current.id)) {
      parts.unshift('#' + CSS.escape(current.id));
      break;
    }
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
      if (siblings.length === 1) {
        parts.unshift(tag);
      } else {
        const index = siblings.indexOf(current) + 1;
        parts.unshift(tag + ':nth-child(' + index + ')');
      }
    } else {
      parts.unshift(tag);
    }
    current = parent;
  }
  return parts.join(' > ');
}
`;

async function extractSiteDNA(url, options = {}) {
  const breakpoints = options.breakpoints || DEFAULT_BREAKPOINTS;
  const outputDir = options.outputDir || './clone-workspace';
  const screenshotDir = path.join(outputDir, 'references', 'screenshots');
  
  fs.mkdirSync(screenshotDir, { recursive: true });
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  await page.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (['media', 'websocket'].includes(type)) {
      route.abort();
    } else {
      route.continue();
    }
  });

  console.error(`[DNA] Loading ${url}...`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);

  const dna = {
    meta: {
      sourceUrl: url,
      extractedAt: new Date().toISOString(),
      breakpoints: breakpoints,
      pageTitle: await page.title(),
    },
    typography: {},
    colors: {},
    spacing: {},
    layout: {},
    components: {},
    interactiveStates: {},
    scrollBehaviors: {},
    assets: {},
    pseudoElements: [],
    alignmentMap: {},
    warnings: [],
  };

  // ──────────────────────────────────────────────
  // STEP 1: Reference Screenshots
  // ──────────────────────────────────────────────
  console.error('[DNA] Capturing reference screenshots...');
  for (const width of breakpoints) {
    await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(screenshotDir, `${width}-full-page.png`), fullPage: true });
    await page.screenshot({ path: path.join(screenshotDir, `${width}-above-fold.png`), fullPage: false });
  }

  // Reset to largest breakpoint for primary extraction
  await page.setViewportSize({ width: breakpoints[0], height: VIEWPORT_HEIGHT });
  await page.waitForTimeout(500);

  // ──────────────────────────────────────────────
  // STEP 2a: Typography (single pass — text styles don't change per breakpoint)
  // ──────────────────────────────────────────────
  console.error('[DNA] Extracting typography...');
  dna.typography = await page.evaluate(() => {
    const styles = new Map();
    document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,span,li,td,th,label,button,input,textarea,blockquote,figcaption,small,strong,em,code,pre').forEach(el => {
      const cs = window.getComputedStyle(el);
      // Include section context in key so same style in different sections stays separate
      const section = el.closest('section, header, footer, nav, main, article');
      const sectionId = section?.id || section?.getAttribute('class')?.split(' ').filter(c => c)[0] || section?.tagName.toLowerCase() || 'body';
      const key = `${sectionId}|${cs.fontFamily}|${cs.fontSize}|${cs.fontWeight}|${cs.lineHeight}|${cs.letterSpacing}|${cs.textTransform}|${cs.color}`;
      if (!styles.has(key)) {
        const tag = el.tagName.toLowerCase();
        // Infer role from context
        let role = el.getAttribute('role') || '';
        if (!role) {
          if (el.closest('nav') && tag === 'a') role = 'nav-link';
          else if (el.closest('button') || tag === 'button') role = 'button-label';
          else if (tag.startsWith('h')) role = `heading-${tag}`;
          else if (tag === 'p') role = 'body-text';
          else if (tag === 'a') role = 'link';
          else if (tag === 'span') role = 'inline';
          else if (tag === 'li') role = 'list-item';
          else if (tag === 'label') role = 'label';
          else if (tag === 'figcaption') role = 'caption';
        }
        
        styles.set(key, {
          fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
          lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, textTransform: cs.textTransform,
          color: cs.color, fontStyle: cs.fontStyle, textDecoration: cs.textDecoration,
          context: {
            section: sectionId,
            tag,
            role,
            sampleText: el.textContent?.trim().substring(0, 60) || '',
            sampleClasses: (el.className?.toString() || '').substring(0, 100),
            position: {
              top: Math.round(el.getBoundingClientRect().top),
              left: Math.round(el.getBoundingClientRect().left),
            },
          },
          occurrences: 1,
        });
      } else {
        styles.get(key).occurrences++;
      }
    });
    return Array.from(styles.values()).sort((a, b) => {
      // Sort by section order (page position), then by font size
      const posA = a.context.position?.top || 0;
      const posB = b.context.position?.top || 0;
      if (Math.abs(posA - posB) > 200) return posA - posB;
      return parseFloat(b.fontSize) - parseFloat(a.fontSize);
    });
  });

  // ──────────────────────────────────────────────
  // STEP 2b: Colors (single pass)
  // ──────────────────────────────────────────────
  console.error('[DNA] Extracting color palette...');
  dna.colors = await page.evaluate(() => {
    const colors = { text: new Set(), background: new Set(), border: new Set(), shadow: [], gradients: new Set() };
    document.querySelectorAll('*').forEach(el => {
      const cs = window.getComputedStyle(el);
      if (cs.color && cs.color !== 'rgba(0, 0, 0, 0)') colors.text.add(cs.color);
      if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') colors.background.add(cs.backgroundColor);
      if (cs.borderColor && cs.borderColor !== 'rgba(0, 0, 0, 0)' && cs.borderWidth !== '0px') colors.border.add(cs.borderColor);
      if (cs.boxShadow && cs.boxShadow !== 'none') colors.shadow.push(cs.boxShadow);
      if (cs.backgroundImage && cs.backgroundImage.includes('gradient')) colors.gradients.add(cs.backgroundImage);
    });
    return {
      text: [...colors.text], background: [...colors.background], border: [...colors.border],
      shadows: [...new Set(colors.shadow)], gradients: [...colors.gradients],
    };
  });

  // ──────────────────────────────────────────────
  // STEP 2c: Spacing (single pass)
  // ──────────────────────────────────────────────
  console.error('[DNA] Extracting spacing system...');
  dna.spacing = await page.evaluate(() => {
    const spacingValues = new Map();
    document.querySelectorAll('*').forEach(el => {
      const cs = window.getComputedStyle(el);
      ['marginTop','marginRight','marginBottom','marginLeft','paddingTop','paddingRight','paddingBottom','paddingLeft','gap','rowGap','columnGap'].forEach(prop => {
        const val = cs[prop];
        if (val && val !== '0px' && val !== 'normal' && val !== 'auto') {
          const px = parseFloat(val);
          if (!isNaN(px) && px > 0 && px < 500) spacingValues.set(px, (spacingValues.get(px) || 0) + 1);
        }
      });
    });
    const sorted = [...spacingValues.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
    return { allValues: sorted, inferredScale: sorted.filter(s => s.count >= 3).map(s => s.value).sort((a, b) => a - b) };
  });

  // ──────────────────────────────────────────────
  // STEP 2d: Layout — MULTI-BREAKPOINT
  // ──────────────────────────────────────────────
  console.error('[DNA] Extracting layout structure (all breakpoints)...');
  dna.layout = {};
  for (const width of breakpoints) {
    await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
    await page.waitForTimeout(500);
    
    dna.layout[`${width}px`] = await page.evaluate(() => {
      const sections = [];
      document.querySelectorAll('header, nav, main, section, footer, article, aside, [role="banner"], [role="main"], [role="contentinfo"]').forEach((el, index) => {
        const cs = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const childLayout = [];
        for (let i = 0; i < Math.min(el.children.length, 20); i++) {
          const child = el.children[i];
          const childCS = window.getComputedStyle(child);
          const childRect = child.getBoundingClientRect();
          childLayout.push({
            tag: child.tagName.toLowerCase(),
            width: Math.round(childRect.width), height: Math.round(childRect.height),
            display: childCS.display, position: childCS.position,
            visibility: childCS.visibility,
            hidden: childRect.width === 0 || childRect.height === 0,
          });
        }
        sections.push({
          index, tag: el.tagName.toLowerCase(), id: el.id || null,
          classes: el.className?.toString()?.substring(0, 200) || '',
          rect: { width: Math.round(rect.width), height: Math.round(rect.height), top: Math.round(rect.top), left: Math.round(rect.left) },
          display: cs.display, flexDirection: cs.flexDirection,
          justifyContent: cs.justifyContent, alignItems: cs.alignItems,
          gridTemplateColumns: cs.gridTemplateColumns, gridTemplateRows: cs.gridTemplateRows,
          gap: cs.gap, maxWidth: cs.maxWidth,
          margin: `${cs.marginTop} ${cs.marginRight} ${cs.marginBottom} ${cs.marginLeft}`,
          padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
          backgroundColor: cs.backgroundColor, position: cs.position,
          zIndex: cs.zIndex, overflow: cs.overflow,
          childCount: el.children.length, childLayout,
        });
      });
      return { sections };
    });
    console.error(`  └─ ${width}px: ${dna.layout[`${width}px`].sections.length} sections`);
  }

  // ──────────────────────────────────────────────
  // STEP 2e: Components — MULTI-BREAKPOINT + FULL DETECTION
  // ──────────────────────────────────────────────
  console.error('[DNA] Extracting component inventory (all breakpoints)...');
  dna.components = {};
  for (const width of breakpoints) {
    await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
    await page.waitForTimeout(500);
    
    dna.components[`${width}px`] = await page.evaluate((selectorFn) => {
      eval(selectorFn);
      const components = { buttons: [], cards: [], navigation: [], forms: [], media: [], decorative: [] };
      
      // ── BUTTONS ──
      document.querySelectorAll('button, a[class*="btn"], a[class*="button"], [role="button"], input[type="submit"], input[type="button"]').forEach(el => {
        const cs = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        components.buttons.push({
          text: el.textContent?.trim().substring(0, 50) || '',
          selector: buildRobustSelector(el),
          width: Math.round(rect.width), height: Math.round(rect.height),
          backgroundColor: cs.backgroundColor, color: cs.color,
          border: cs.border, borderRadius: cs.borderRadius,
          padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
          fontSize: cs.fontSize, fontWeight: cs.fontWeight,
          fontFamily: cs.fontFamily, textTransform: cs.textTransform,
          letterSpacing: cs.letterSpacing, boxShadow: cs.boxShadow,
          transition: cs.transition, cursor: cs.cursor, display: cs.display,
        });
      });
      
      // ── CARDS ──
      // Heuristic: non-layout element with 2+ visual cues (border, shadow, bg, radius, padding)
      // AND 2-15 children, AND not section-width
      document.querySelectorAll('*').forEach(el => {
        const cs = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (rect.width < 100 || rect.height < 80 || rect.width === 0 || rect.height === 0) return;
        
        const hasBorder = cs.borderWidth !== '0px' && cs.borderStyle !== 'none';
        const hasShadow = cs.boxShadow !== 'none';
        const hasDistinctBg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'rgb(255, 255, 255)';
        const hasBorderRadius = parseFloat(cs.borderRadius) > 0;
        const hasPadding = ['paddingTop','paddingBottom','paddingLeft','paddingRight'].some(p => parseFloat(cs[p]) > 4);
        const childCount = el.children.length;
        const visualCues = [hasBorder, hasShadow, hasDistinctBg, hasBorderRadius, hasPadding].filter(Boolean).length;
        
        if (visualCues >= 2 && childCount >= 2 && childCount <= 15) {
          const tag = el.tagName.toLowerCase();
          if (['header','footer','nav','main','section','body','html'].includes(tag)) return;
          if (rect.width > window.innerWidth * 0.9) return;
          
          components.cards.push({
            selector: buildRobustSelector(el),
            width: Math.round(rect.width), height: Math.round(rect.height),
            backgroundColor: cs.backgroundColor, border: cs.border,
            borderRadius: cs.borderRadius, boxShadow: cs.boxShadow,
            padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
            display: cs.display, flexDirection: cs.flexDirection,
            gap: cs.gap, overflow: cs.overflow, childCount,
            hasImage: el.querySelector('img, picture, svg') !== null,
            hasText: el.querySelector('h1,h2,h3,h4,h5,h6,p,span') !== null,
            childTags: Array.from(el.children).slice(0, 10).map(c => c.tagName.toLowerCase()),
          });
        }
      });
      // Dedupe: keep innermost cards (remove ancestors that contain other detected cards)
      components.cards = components.cards.filter((card, i, arr) => {
        try {
          const el = document.querySelector(card.selector);
          if (!el) return true;
          return !arr.some((other, j) => {
            if (i === j) return false;
            try {
              const otherEl = document.querySelector(other.selector);
              return otherEl && el.contains(otherEl) && el !== otherEl;
            } catch(e) { return false; }
          });
        } catch(e) { return true; }
      }).slice(0, 30);
      
      // ── NAVIGATION ──
      document.querySelectorAll('nav, header, [role="navigation"], [role="banner"], [class*="navbar"], [class*="nav-bar"], [class*="menu"], footer').forEach(el => {
        const cs = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        
        const links = [];
        el.querySelectorAll('a').forEach(a => {
          const aRect = a.getBoundingClientRect();
          if (aRect.width === 0 || aRect.height === 0) return;
          const aCS = window.getComputedStyle(a);
          links.push({
            text: a.textContent?.trim().substring(0, 40) || '',
            fontSize: aCS.fontSize, fontWeight: aCS.fontWeight,
            color: aCS.color, textDecoration: aCS.textDecoration,
          });
        });
        
        components.navigation.push({
          type: el.tagName.toLowerCase() === 'footer' ? 'footer' : 
                el.tagName.toLowerCase() === 'header' || el.getAttribute('role') === 'banner' ? 'header' : 'nav',
          selector: buildRobustSelector(el),
          width: Math.round(rect.width), height: Math.round(rect.height),
          backgroundColor: cs.backgroundColor, position: cs.position,
          display: cs.display, flexDirection: cs.flexDirection,
          justifyContent: cs.justifyContent, alignItems: cs.alignItems,
          gap: cs.gap,
          padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
          zIndex: cs.zIndex, backdropFilter: cs.backdropFilter,
          linkCount: links.length, links: links.slice(0, 15),
        });
      });
      
      // ── FORMS ──
      document.querySelectorAll('form, [role="form"], [class*="form"], [class*="signup"], [class*="subscribe"], [class*="contact"]').forEach(el => {
        const cs = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        
        const inputs = [];
        el.querySelectorAll('input, textarea, select').forEach(inp => {
          const inpCS = window.getComputedStyle(inp);
          const inpRect = inp.getBoundingClientRect();
          if (inpRect.width === 0) return;
          inputs.push({
            type: inp.type || inp.tagName.toLowerCase(),
            placeholder: inp.placeholder || '',
            width: Math.round(inpRect.width), height: Math.round(inpRect.height),
            backgroundColor: inpCS.backgroundColor, border: inpCS.border,
            borderRadius: inpCS.borderRadius, fontSize: inpCS.fontSize,
            padding: `${inpCS.paddingTop} ${inpCS.paddingRight} ${inpCS.paddingBottom} ${inpCS.paddingLeft}`,
            color: inpCS.color,
          });
        });
        
        if (inputs.length === 0) return;
        components.forms.push({
          selector: buildRobustSelector(el),
          width: Math.round(rect.width), height: Math.round(rect.height),
          display: cs.display, flexDirection: cs.flexDirection, gap: cs.gap,
          backgroundColor: cs.backgroundColor, borderRadius: cs.borderRadius,
          padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
          inputCount: inputs.length, inputs: inputs.slice(0, 10),
        });
      });
      
      // ── MEDIA ──
      document.querySelectorAll('img, video, picture, svg:not(svg svg)').forEach(el => {
        const cs = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (rect.width < 5 || rect.height < 5) return;
        components.media.push({
          tag: el.tagName.toLowerCase(), selector: buildRobustSelector(el),
          src: el.src || el.querySelector?.('source')?.src || null,
          alt: el.alt || null,
          width: Math.round(rect.width), height: Math.round(rect.height),
          objectFit: cs.objectFit, borderRadius: cs.borderRadius,
          aspectRatio: (rect.width / rect.height).toFixed(3),
        });
      });
      components.media = components.media.slice(0, 40);
      
      // ── DECORATIVE ELEMENTS ──
      const decorative = [];
      
      // Dividers
      document.querySelectorAll('hr, [class*="divider"], [class*="separator"], [class*="line"]').forEach(el => {
        const cs = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        decorative.push({
          type: 'divider', selector: buildRobustSelector(el),
          width: Math.round(rect.width), height: Math.round(rect.height),
          backgroundColor: cs.backgroundColor, borderTop: cs.borderTop,
          margin: `${cs.marginTop} ${cs.marginBottom}`,
        });
      });
      
      // Badges / tags / chips
      document.querySelectorAll('[class*="badge"], [class*="tag"], [class*="chip"], [class*="pill"], [class*="label"]:not(label)').forEach(el => {
        const cs = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 10 || rect.width > 300) return;
        decorative.push({
          type: 'badge', selector: buildRobustSelector(el),
          text: el.textContent?.trim().substring(0, 30) || '',
          width: Math.round(rect.width), height: Math.round(rect.height),
          backgroundColor: cs.backgroundColor, color: cs.color,
          borderRadius: cs.borderRadius, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
          padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
        });
      });
      
      // Overlays / backdrop shapes
      document.querySelectorAll('[class*="overlay"], [class*="backdrop"], [class*="bg-shape"], [class*="blob"]').forEach(el => {
        const cs = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        decorative.push({
          type: 'overlay', selector: buildRobustSelector(el),
          width: Math.round(rect.width), height: Math.round(rect.height),
          backgroundColor: cs.backgroundColor, opacity: cs.opacity,
          backgroundImage: cs.backgroundImage !== 'none' ? cs.backgroundImage : null,
          position: cs.position, zIndex: cs.zIndex,
          borderRadius: cs.borderRadius, filter: cs.filter,
        });
      });
      
      components.decorative = decorative.slice(0, 30);
      return components;
    }, ROBUST_SELECTOR_FN);
    
    const bp = dna.components[`${width}px`];
    console.error(`  └─ ${width}px: ${bp.buttons.length} btn, ${bp.cards.length} card, ${bp.navigation.length} nav, ${bp.forms.length} form, ${bp.media.length} media, ${bp.decorative.length} decor`);
  }

  // Reset to largest breakpoint
  await page.setViewportSize({ width: breakpoints[0], height: VIEWPORT_HEIGHT });
  await page.waitForTimeout(500);

  // ──────────────────────────────────────────────
  // STEP 2f: Assets — with CORS logging
  // ──────────────────────────────────────────────
  console.error('[DNA] Extracting assets...');
  dna.assets = await page.evaluate(() => {
    const assets = {
      fonts: [], images: [], backgroundImages: [],
      icons: { type: 'unknown', details: '' },
      corsBlockedStylesheets: [],
    };
    
    // Font links
    document.querySelectorAll('link[href*="fonts.googleapis.com"], link[href*="fonts.gstatic.com"], link[href*="use.typekit"], link[href*="fonts.adobe"]').forEach(link => {
      assets.fonts.push({ type: 'external', url: link.href });
    });
    
    // @font-face + CORS logging
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule instanceof CSSFontFaceRule) {
            assets.fonts.push({
              type: 'font-face', family: rule.style.fontFamily, src: rule.style.src,
              weight: rule.style.fontWeight || 'normal', style: rule.style.fontStyle || 'normal',
            });
          }
        }
      } catch (e) {
        assets.corsBlockedStylesheets.push({
          href: sheet.href || '(inline stylesheet with cross-origin rules)',
          ownerNode: sheet.ownerNode?.tagName?.toLowerCase() || 'unknown',
          reason: 'SecurityError: Cannot access cssRules due to CORS policy',
        });
      }
    }
    
    // Images
    document.querySelectorAll('img').forEach(img => {
      if (img.src && img.naturalWidth > 0) {
        assets.images.push({
          src: img.src, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
          renderedWidth: Math.round(img.getBoundingClientRect().width),
          renderedHeight: Math.round(img.getBoundingClientRect().height),
          alt: img.alt, loading: img.loading,
        });
      }
    });
    
    // Background images
    document.querySelectorAll('*').forEach(el => {
      const cs = window.getComputedStyle(el);
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && !cs.backgroundImage.includes('gradient')) {
        assets.backgroundImages.push({
          element: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : ''),
          backgroundImage: cs.backgroundImage, backgroundSize: cs.backgroundSize,
          backgroundPosition: cs.backgroundPosition, backgroundRepeat: cs.backgroundRepeat,
        });
      }
    });
    
    // Icon detection
    const svgIcons = document.querySelectorAll('svg');
    const iconFonts = document.querySelectorAll('[class*="fa-"], [class*="icon-"], [class*="material-icons"], .bi, [class*="lucide"]');
    if (svgIcons.length > 3) assets.icons = { type: 'inline-svg', count: svgIcons.length };
    else if (iconFonts.length > 0) assets.icons = { type: 'icon-font', count: iconFonts.length, sampleClasses: iconFonts[0]?.className?.toString() || '' };
    
    return assets;
  });
  
  // Log CORS warnings
  if (dna.assets.corsBlockedStylesheets.length > 0) {
    console.error(`[DNA] ⚠ ${dna.assets.corsBlockedStylesheets.length} stylesheet(s) blocked by CORS:`);
    dna.assets.corsBlockedStylesheets.forEach(s => console.error(`  └─ ${s.href}`));
    dna.warnings.push({
      type: 'cors-blocked-stylesheets',
      message: `${dna.assets.corsBlockedStylesheets.length} stylesheet(s) could not be read due to CORS. Font-face declarations from these sheets are missing.`,
      details: dna.assets.corsBlockedStylesheets,
    });
  }

  // ──────────────────────────────────────────────
  // STEP 3: Interactive State Extraction (robust selectors)
  // ──────────────────────────────────────────────
  console.error('[DNA] Extracting interactive states...');
  dna.interactiveStates = await page.evaluate((selectorFn) => {
    eval(selectorFn);
    const states = [];
    const processedSelectors = new Set();
    
    document.querySelectorAll(
      'a, button, input, textarea, select, [role="button"], [tabindex], [class*="btn"], [class*="link"], [class*="nav"]'
    ).forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      if (rect.top > window.innerHeight * 3) return;
      
      const selector = buildRobustSelector(el);
      if (processedSelectors.has(selector)) return;
      processedSelectors.add(selector);
      
      let selectorIsUnique = false;
      try { selectorIsUnique = document.querySelectorAll(selector).length === 1; } catch(e) {}
      
      const cs = window.getComputedStyle(el);
      states.push({
        selector, selectorIsUnique,
        text: el.textContent?.trim().substring(0, 40) || '',
        defaultState: {
          backgroundColor: cs.backgroundColor, color: cs.color, transform: cs.transform,
          opacity: cs.opacity, boxShadow: cs.boxShadow, borderColor: cs.borderColor,
          borderWidth: cs.borderWidth, outline: cs.outline,
          textDecoration: cs.textDecoration, scale: cs.scale,
        },
        transition: {
          property: cs.transitionProperty, duration: cs.transitionDuration,
          timingFunction: cs.transitionTimingFunction, delay: cs.transitionDelay,
        },
      });
      
      if (states.length > 60) return;
    });
    return states;
  }, ROBUST_SELECTOR_FN);

  // ──────────────────────────────────────────────
  // STEP 3b: Pseudo-Element Extraction
  // ──────────────────────────────────────────────
  console.error('[DNA] Extracting pseudo-element styles...');
  dna.pseudoElements = await page.evaluate(() => {
    const results = [];
    const PROPS = [
      'content', 'display', 'position', 'top', 'left', 'right', 'bottom',
      'width', 'height', 'opacity', 'zIndex', 'backgroundColor', 'backgroundImage',
      'transform', 'borderRadius', 'color', 'fontSize', 'boxShadow',
      'clipPath', 'filter', 'backdropFilter', 'border', 'transition',
    ];
    
    document.querySelectorAll('*').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      if (rect.top > window.innerHeight * 4) return;
      
      for (const pseudo of ['::before', '::after']) {
        const cs = window.getComputedStyle(el, pseudo);
        const content = cs.getPropertyValue('content');
        const display = cs.getPropertyValue('display');
        
        if (content !== 'none' && content !== 'normal' && display !== 'none') {
          const styles = {};
          PROPS.forEach(prop => {
            const val = cs.getPropertyValue(prop.replace(/[A-Z]/g, m => '-' + m.toLowerCase()));
            if (val && val !== 'none' && val !== 'normal' && val !== 'auto' && val !== '0px') {
              styles[prop] = val;
            }
          });
          
          // Always capture content and display
          styles.content = content;
          styles.display = display;
          
          const tag = el.tagName.toLowerCase();
          const id = el.id || '';
          const cls = el.className?.toString()?.split(' ').filter(c => c).slice(0, 2).join('.') || '';
          const selector = tag + (id ? '#' + id : '') + (cls ? '.' + cls : '');
          
          results.push({
            selector,
            pseudo,
            styles,
            parentRect: {
              left: Math.round(rect.left),
              top: Math.round(rect.top),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
          });
        }
      }
    });
    
    return results.slice(0, 100); // cap output
  });
  console.error(`  └─ ${dna.pseudoElements.length} rendered pseudo-elements found`);

  // ──────────────────────────────────────────────
  // STEP 3c: Padding Chain / Content Alignment Map
  // ──────────────────────────────────────────────
  console.error('[DNA] Extracting padding chains...');
  dna.alignmentMap = await page.evaluate(() => {
    const sections = document.querySelectorAll('body > header, body > nav, body > main, body > section, body > footer, body > div, body > article');
    const map = [];
    
    sections.forEach((section, index) => {
      const sectionRect = section.getBoundingClientRect();
      if (sectionRect.height === 0) return;
      
      // Find the innermost content container
      let contentEl = section;
      const containerCandidates = section.querySelectorAll('[class*="container"], [class*="wrapper"], [class*="inner"], [class*="content"]');
      if (containerCandidates.length > 0) {
        // Pick the one with a max-width set, or the first one
        for (const c of containerCandidates) {
          const cs = window.getComputedStyle(c);
          if (cs.maxWidth !== 'none') { contentEl = c; break; }
        }
        if (contentEl === section) contentEl = containerCandidates[0];
      }
      
      // Walk from content container up to body, recording padding chain
      const chain = [];
      let current = contentEl;
      while (current && current !== document.body) {
        const cs = window.getComputedStyle(current);
        const rect = current.getBoundingClientRect();
        chain.unshift({
          tag: current.tagName.toLowerCase(),
          id: current.id || null,
          class: current.className?.toString()?.substring(0, 80) || '',
          paddingLeft: cs.paddingLeft,
          paddingRight: cs.paddingRight,
          marginLeft: cs.marginLeft,
          marginRight: cs.marginRight,
          borderLeftWidth: cs.borderLeftWidth,
          borderRightWidth: cs.borderRightWidth,
          maxWidth: cs.maxWidth,
          boxSizing: cs.boxSizing,
          display: cs.display,
          rect: { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) },
        });
        current = current.parentElement;
      }
      
      // Compute content start position
      const contentRect = contentEl.getBoundingClientRect();
      const contentCS = window.getComputedStyle(contentEl);
      const contentLeft = contentRect.left + parseFloat(contentCS.paddingLeft) + parseFloat(contentCS.borderLeftWidth);
      const contentRight = contentRect.right - parseFloat(contentCS.paddingRight) - parseFloat(contentCS.borderRightWidth);
      
      // Detect container strategy
      const elCS = window.getComputedStyle(contentEl);
      let strategy = 'unknown';
      if (elCS.maxWidth !== 'none' && Math.abs(parseFloat(elCS.marginLeft) - parseFloat(elCS.marginRight)) < 3) {
        strategy = 'max-width-centered';
      } else if (contentRect.width > window.innerWidth * 0.98 && parseFloat(elCS.paddingLeft) > 10) {
        strategy = 'full-bleed-with-padding';
      } else if (elCS.display === 'grid') {
        strategy = 'css-grid';
      } else if (elCS.display === 'flex') {
        strategy = 'flexbox';
      }
      
      map.push({
        index,
        tag: section.tagName.toLowerCase(),
        id: section.id || null,
        class: section.className?.toString()?.substring(0, 80) || '',
        contentStartLeft: Math.round(contentLeft),
        contentStartRight: Math.round(contentRight),
        contentWidth: Math.round(contentRight - contentLeft),
        strategy,
        chain,
      });
    });
    
    // Alignment consistency analysis
    const leftPositions = map.map(s => s.contentStartLeft);
    const positionCounts = {};
    leftPositions.forEach(p => {
      const rounded = Math.round(p / 3) * 3; // group within 3px
      positionCounts[rounded] = (positionCounts[rounded] || 0) + 1;
    });
    const dominantLeft = Object.entries(positionCounts).sort((a, b) => b[1] - a[1])[0];
    
    return {
      sections: map,
      alignmentConsistency: {
        dominantContentStart: dominantLeft ? parseInt(dominantLeft[0]) : null,
        sectionsAtDominant: dominantLeft ? dominantLeft[1] : 0,
        totalSections: map.length,
        alignmentScore: dominantLeft ? ((dominantLeft[1] / map.length) * 100).toFixed(0) + '%' : '0%',
      },
    };
  });
  console.error(`  └─ ${dna.alignmentMap.sections?.length || 0} sections mapped`);
  if (dna.alignmentMap.alignmentConsistency) {
    const ac = dna.alignmentMap.alignmentConsistency;
    console.error(`  └─ Dominant content start: ${ac.dominantContentStart}px (${ac.alignmentScore} of sections)`);
  }

  // ──────────────────────────────────────────────
  // STEP 4: Scroll Behavior Recording
  // ──────────────────────────────────────────────
  console.error('[DNA] Recording scroll behaviors...');
  dna.scrollBehaviors = await recordScrollBehaviors(page);

  // ──────────────────────────────────────────────
  // STEP 5: Write DNA Document
  // ──────────────────────────────────────────────
  const dnaPath = path.join(outputDir, 'site-dna.json');
  fs.writeFileSync(dnaPath, JSON.stringify(dna, null, 2));
  console.error(`[DNA] Site DNA written to ${dnaPath}`);
  console.error(`[DNA] Extraction complete. ${dna.warnings.length} warning(s).`);
  console.log(JSON.stringify(dna, null, 2));

  await browser.close();
  return dna;
}

// ──────────────────────────────────────────────
// Scroll Behavior Recording
// ──────────────────────────────────────────────
async function recordScrollBehaviors(page) {
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  
  await page.evaluate((selectorFn) => {
    eval(selectorFn);
    window.__scrollTrackedElements = new Map();
    
    document.querySelectorAll(
      '[data-aos], [data-scroll], [class*="animate"], [class*="reveal"], [class*="fade"], ' +
      '[class*="slide"], [class*="parallax"], [class*="sticky"], [style*="transform"], ' +
      'section > *, header, [class*="hero"]'
    ).forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const id = `scroll-el-${i}`;
      el.setAttribute('data-scroll-track', id);
      const cs = window.getComputedStyle(el);
      window.__scrollTrackedElements.set(id, {
        selector: buildRobustSelector(el),
        initialTransform: cs.transform, initialOpacity: cs.opacity,
        initialPosition: cs.position, initialTop: cs.top,
        rect: { top: rect.top + window.scrollY, height: rect.height },
      });
    });
  }, ROBUST_SELECTOR_FN);
  
  const timeline = [];
  const totalScrollSteps = Math.ceil(pageHeight / SCROLL_STEP);
  const sampleRate = Math.max(1, Math.floor(totalScrollSteps / 100));
  
  for (let scrollY = 0; scrollY < pageHeight; scrollY += SCROLL_STEP * sampleRate) {
    await page.evaluate((y) => window.scrollTo(0, y), scrollY);
    await page.waitForTimeout(50);
    
    const snapshot = await page.evaluate((scrollPos) => {
      const states = {};
      document.querySelectorAll('[data-scroll-track]').forEach(el => {
        const id = el.getAttribute('data-scroll-track');
        const cs = window.getComputedStyle(el);
        const initial = window.__scrollTrackedElements.get(id);
        if (cs.transform !== initial.initialTransform || cs.opacity !== initial.initialOpacity ||
            cs.position !== initial.initialPosition || cs.top !== initial.initialTop) {
          states[id] = {
            selector: initial.selector, transform: cs.transform, opacity: cs.opacity,
            position: cs.position, top: cs.top, visibility: cs.visibility,
            classList: el.className?.toString()?.substring(0, 200) || '',
          };
        }
      });
      return { scrollY: scrollPos, changedElements: states };
    }, scrollY);
    
    if (Object.keys(snapshot.changedElements).length > 0) timeline.push(snapshot);
  }
  
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  
  return { pageHeight, viewportHeight, timeline: timeline.slice(0, 50), classifications: classifyScrollBehaviors(timeline) };
}

function classifyScrollBehaviors(timeline) {
  if (timeline.length === 0) return [];
  const elementChanges = {};
  timeline.forEach(frame => {
    Object.entries(frame.changedElements).forEach(([id, state]) => {
      if (!elementChanges[id]) elementChanges[id] = [];
      elementChanges[id].push({ scrollY: frame.scrollY, ...state });
    });
  });
  
  const classifications = [];
  Object.entries(elementChanges).forEach(([id, changes]) => {
    if (changes.length < 2) return;
    const entry = { elementId: id, selector: changes[0].selector, type: 'unknown', details: {} };
    
    const opacities = changes.map(c => parseFloat(c.opacity));
    if (opacities[0] < 0.5 && opacities[opacities.length - 1] >= 0.9) {
      entry.type = 'fade-in';
      entry.details = {
        triggerScrollY: changes.find(c => parseFloat(c.opacity) > 0.1)?.scrollY || changes[0].scrollY,
        startOpacity: opacities[0], endOpacity: opacities[opacities.length - 1],
      };
    }
    
    const transforms = changes.map(c => c.transform).filter(t => t !== 'none');
    if (transforms.length > 2) {
      const translateYValues = transforms.map(t => {
        const match = t.match(/matrix\(([^)]+)\)/);
        return match ? (match[1].split(',').map(Number)[5] || 0) : 0;
      });
      if (translateYValues.some(v => v !== 0)) {
        const isLinear = translateYValues.every((v, i) => {
          if (i === 0) return true;
          return Math.abs((v - translateYValues[i - 1]) - (translateYValues[1] - translateYValues[0])) < 5;
        });
        if (isLinear && translateYValues.length > 3) {
          const scrollRange = changes[changes.length - 1].scrollY - changes[0].scrollY;
          const translateRange = translateYValues[translateYValues.length - 1] - translateYValues[0];
          entry.type = 'parallax';
          entry.details = { multiplier: (translateRange / scrollRange).toFixed(4), direction: translateRange > 0 ? 'down' : 'up' };
        } else {
          entry.type = 'slide-in';
          entry.details = { triggerScrollY: changes[0].scrollY, startTransform: transforms[0], endTransform: transforms[transforms.length - 1] };
        }
      }
    }
    
    const positions = changes.map(c => c.position);
    if (positions.includes('fixed') || positions.includes('sticky')) {
      entry.type = 'sticky';
      entry.details = {
        triggerScrollY: changes.find(c => c.position === 'fixed' || c.position === 'sticky')?.scrollY || 0,
        stickyPosition: positions.find(p => p === 'fixed' || p === 'sticky'),
      };
    }
    
    classifications.push(entry);
  });
  return classifications;
}

// ──────────────────────────────────────────────
// CLI Entry Point
// ──────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node extract-site-dna.js <url> [--output <dir>] [--breakpoints <widths>]');
  process.exit(1);
}

const url = args[0];
const options = {};
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--output' && args[i + 1]) options.outputDir = args[++i];
  if (args[i] === '--breakpoints' && args[i + 1]) options.breakpoints = args[++i].split(',').map(Number);
}

extractSiteDNA(url, options).catch(err => {
  console.error('[DNA] Fatal error:', err.message);
  process.exit(1);
});
