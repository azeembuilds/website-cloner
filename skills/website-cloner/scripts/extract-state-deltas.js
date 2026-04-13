/**
 * Interactive State Delta Extractor
 * 
 * Usage: node extract-state-deltas.js <url> <site-dna-path>
 * 
 * This script reads the interactive elements from site-dna.json, then uses
 * Playwright to programmatically trigger hover/focus/active states and
 * capture the computed style deltas. This must run separately because
 * hover states can only be triggered from outside the page context.
 * 
 * Output: Updates site-dna.json with hover/focus/active deltas for each element.
 */

const { chromium } = require('playwright');
const fs = require('fs');

const STYLE_PROPERTIES = [
  'backgroundColor', 'color', 'transform', 'opacity', 'boxShadow',
  'borderColor', 'borderWidth', 'outline', 'textDecoration', 'scale',
  'borderRadius', 'padding', 'margin', 'width', 'height',
  'backgroundImage', 'filter', 'backdropFilter',
];

async function extractStateDeltas(url, dnaPath) {
  const dna = JSON.parse(fs.readFileSync(dnaPath, 'utf-8'));
  const interactiveStates = dna.interactiveStates || [];
  
  if (interactiveStates.length === 0) {
    console.error('[States] No interactive elements found in DNA. Skipping.');
    return;
  }
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  
  console.error(`[States] Loading ${url}...`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);
  
  console.error(`[States] Processing ${interactiveStates.length} interactive elements...`);
  
  for (let i = 0; i < interactiveStates.length; i++) {
    const item = interactiveStates[i];
    console.error(`[States] ${i + 1}/${interactiveStates.length}: ${item.selector}`);
    
    try {
      // Skip non-unique selectors — hovering the wrong element corrupts the data
      if (item.selectorIsUnique === false) {
        item.stateExtractionFailed = true;
        item.failReason = 'Selector is not unique — skipped to avoid ambiguity';
        console.error(`  └─ ⚠ Skipped (non-unique selector)`);
        continue;
      }
      
      // Find the element
      const element = await page.$(item.selector);
      if (!element) {
        item.stateExtractionFailed = true;
        item.failReason = 'Element not found with selector';
        continue;
      }
      
      // Verify it's visible
      const isVisible = await element.isVisible();
      if (!isVisible) {
        item.stateExtractionFailed = true;
        item.failReason = 'Element not visible';
        continue;
      }
      
      // Capture default state
      const defaultStyles = await page.evaluate((selector, props) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const cs = window.getComputedStyle(el);
        const result = {};
        props.forEach(p => { result[p] = cs[p]; });
        return result;
      }, item.selector, STYLE_PROPERTIES);
      
      if (!defaultStyles) continue;
      
      // Capture default pseudo-element styles
      const defaultPseudos = await page.evaluate((selector) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const PSEUDO_PROPS = ['content', 'display', 'opacity', 'backgroundColor', 'backgroundImage',
          'transform', 'width', 'height', 'position', 'top', 'left', 'borderRadius', 'boxShadow'];
        const result = {};
        for (const pseudo of ['::before', '::after']) {
          const cs = window.getComputedStyle(el, pseudo);
          const content = cs.getPropertyValue('content');
          const display = cs.getPropertyValue('display');
          if (content !== 'none' && content !== 'normal' && display !== 'none') {
            const styles = {};
            PSEUDO_PROPS.forEach(p => {
              styles[p] = cs.getPropertyValue(p.replace(/[A-Z]/g, m => '-' + m.toLowerCase()));
            });
            result[pseudo] = styles;
          }
        }
        return Object.keys(result).length > 0 ? result : null;
      }, item.selector);
      
      // ── HOVER STATE ──
      await element.hover();
      await page.waitForTimeout(400); // wait for transitions to complete
      
      const hoverStyles = await page.evaluate((selector, props) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const cs = window.getComputedStyle(el);
        const result = {};
        props.forEach(p => { result[p] = cs[p]; });
        return result;
      }, item.selector, STYLE_PROPERTIES);
      
      // Capture hover pseudo-element styles and compute delta
      if (defaultPseudos) {
        const hoverPseudos = await page.evaluate((selector) => {
          const el = document.querySelector(selector);
          if (!el) return null;
          const PSEUDO_PROPS = ['content', 'display', 'opacity', 'backgroundColor', 'backgroundImage',
            'transform', 'width', 'height', 'position', 'top', 'left', 'borderRadius', 'boxShadow'];
          const result = {};
          for (const pseudo of ['::before', '::after']) {
            const cs = window.getComputedStyle(el, pseudo);
            const content = cs.getPropertyValue('content');
            const display = cs.getPropertyValue('display');
            if (content !== 'none' && content !== 'normal' && display !== 'none') {
              const styles = {};
              PSEUDO_PROPS.forEach(p => {
                styles[p] = cs.getPropertyValue(p.replace(/[A-Z]/g, m => '-' + m.toLowerCase()));
              });
              result[pseudo] = styles;
            }
          }
          return Object.keys(result).length > 0 ? result : null;
        }, item.selector);
        
        if (hoverPseudos) {
          const pseudoHoverDelta = {};
          for (const pseudo of ['::before', '::after']) {
            if (defaultPseudos[pseudo] && hoverPseudos[pseudo]) {
              const delta = {};
              Object.keys(defaultPseudos[pseudo]).forEach(prop => {
                if (defaultPseudos[pseudo][prop] !== hoverPseudos[pseudo][prop]) {
                  delta[prop] = { from: defaultPseudos[pseudo][prop], to: hoverPseudos[pseudo][prop] };
                }
              });
              if (Object.keys(delta).length > 0) pseudoHoverDelta[pseudo] = delta;
            } else if (!defaultPseudos[pseudo] && hoverPseudos[pseudo]) {
              pseudoHoverDelta[pseudo] = { _appeared: true, styles: hoverPseudos[pseudo] };
            }
          }
          if (Object.keys(pseudoHoverDelta).length > 0) {
            item.pseudoElementHoverDelta = pseudoHoverDelta;
          }
        }
      }
      
      // Calculate element hover delta
      if (hoverStyles) {
        const hoverDelta = {};
        STYLE_PROPERTIES.forEach(prop => {
          if (hoverStyles[prop] !== defaultStyles[prop]) {
            hoverDelta[prop] = {
              from: defaultStyles[prop],
              to: hoverStyles[prop],
            };
          }
        });
        if (Object.keys(hoverDelta).length > 0) {
          item.hoverDelta = hoverDelta;
        }
      }
      
      // Move mouse away to reset
      await page.mouse.move(0, 0);
      await page.waitForTimeout(400);
      
      // ── FOCUS STATE ──
      await element.focus();
      await page.waitForTimeout(200);
      
      const focusStyles = await page.evaluate((selector, props) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const cs = window.getComputedStyle(el);
        const result = {};
        props.forEach(p => { result[p] = cs[p]; });
        return result;
      }, item.selector, STYLE_PROPERTIES);
      
      if (focusStyles) {
        const focusDelta = {};
        STYLE_PROPERTIES.forEach(prop => {
          if (focusStyles[prop] !== defaultStyles[prop]) {
            focusDelta[prop] = {
              from: defaultStyles[prop],
              to: focusStyles[prop],
            };
          }
        });
        if (Object.keys(focusDelta).length > 0) {
          item.focusDelta = focusDelta;
        }
      }
      
      // Blur to reset
      await page.evaluate((selector) => {
        document.querySelector(selector)?.blur();
      }, item.selector);
      await page.waitForTimeout(200);
      
    } catch (err) {
      item.stateExtractionFailed = true;
      item.failReason = err.message.substring(0, 100);
    }
  }
  
  // Update the DNA file
  dna.interactiveStates = interactiveStates;
  fs.writeFileSync(dnaPath, JSON.stringify(dna, null, 2));
  console.error(`[States] Updated ${dnaPath} with interactive state deltas.`);
  
  await browser.close();
}

// CLI
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node extract-state-deltas.js <url> <site-dna-path>');
  process.exit(1);
}

extractStateDeltas(args[0], args[1]).catch(err => {
  console.error('[States] Fatal error:', err.message);
  process.exit(1);
});
