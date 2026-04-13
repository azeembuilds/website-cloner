/**
 * Design Token Generator
 * 
 * Usage: node generate-tokens.js <site-dna-path> [--output <tokens.css>]
 * 
 * Reads site-dna.json and mechanically generates a CSS custom properties
 * file. No interpretation — direct mapping from extracted values to tokens.
 */

const fs = require('fs');

function rgbToHex(rgb) {
  if (!rgb || rgb === 'none' || rgb === 'transparent') return rgb;
  const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return rgb;
  const [, r, g, b] = match.map(Number);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function dedupeAndSort(arr) {
  return [...new Set(arr)].sort();
}

function generateTokens(dnaPath, outputPath) {
  const dna = JSON.parse(fs.readFileSync(dnaPath, 'utf-8'));
  const lines = [];
  
  lines.push('/*');
  lines.push(` * Design Tokens — generated from site-dna.json`);
  lines.push(` * Source: ${dna.meta.sourceUrl}`);
  lines.push(` * Extracted: ${dna.meta.extractedAt}`);
  lines.push(` * DO NOT EDIT MANUALLY — regenerate from DNA if values need updating`);
  lines.push(' */');
  lines.push('');
  lines.push(':root {');
  
  // ── TYPOGRAPHY TOKENS ──
  lines.push('  /* ── Typography ── */');
  
  // Extract unique font families
  const fontFamilies = new Set();
  (dna.typography || []).forEach(t => {
    const primary = t.fontFamily.split(',')[0].trim().replace(/['"]/g, '');
    fontFamilies.add(primary);
  });
  
  const fontList = [...fontFamilies];
  if (fontList.length > 0) lines.push(`  --font-primary: ${(dna.typography[0] || {}).fontFamily || 'sans-serif'};`);
  if (fontList.length > 1) {
    // Find the body font (most occurrences, not the largest)
    const bodyFont = [...(dna.typography || [])].sort((a, b) => b.occurrences - a.occurrences)[0];
    if (bodyFont) lines.push(`  --font-body: ${bodyFont.fontFamily};`);
  }
  
  // Font size scale
  const fontSizes = [...new Set((dna.typography || []).map(t => parseFloat(t.fontSize)))].sort((a, b) => a - b);
  const sizeNames = ['xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl'];
  fontSizes.forEach((size, i) => {
    const name = i < sizeNames.length ? sizeNames[i] : `size-${i}`;
    lines.push(`  --text-${name}: ${size}px;`);
  });
  
  // Line heights
  const lineHeights = [...new Set((dna.typography || []).map(t => t.lineHeight).filter(l => l !== 'normal'))];
  lineHeights.forEach((lh, i) => {
    lines.push(`  --leading-${i}: ${lh};`);
  });
  
  // Font weights
  const fontWeights = [...new Set((dna.typography || []).map(t => t.fontWeight))].sort();
  const weightNames = { '100': 'thin', '200': 'extralight', '300': 'light', '400': 'normal', '500': 'medium', '600': 'semibold', '700': 'bold', '800': 'extrabold', '900': 'black' };
  fontWeights.forEach(w => {
    const name = weightNames[w] || `w${w}`;
    lines.push(`  --font-${name}: ${w};`);
  });
  
  // Letter spacing
  const letterSpacings = [...new Set((dna.typography || []).map(t => t.letterSpacing).filter(l => l !== 'normal' && l !== '0px'))];
  letterSpacings.forEach((ls, i) => {
    lines.push(`  --tracking-${i}: ${ls};`);
  });
  
  lines.push('');
  
  // ── COLOR TOKENS ──
  lines.push('  /* ── Colors ── */');
  
  const textColors = (dna.colors?.text || []).map(rgbToHex);
  textColors.forEach((c, i) => {
    lines.push(`  --color-text-${i}: ${c};`);
  });
  
  const bgColors = (dna.colors?.background || []).map(rgbToHex);
  bgColors.forEach((c, i) => {
    lines.push(`  --color-bg-${i}: ${c};`);
  });
  
  const borderColors = (dna.colors?.border || []).map(rgbToHex);
  borderColors.forEach((c, i) => {
    lines.push(`  --color-border-${i}: ${c};`);
  });
  
  lines.push('');
  
  // ── SHADOW TOKENS ──
  if (dna.colors?.shadows?.length) {
    lines.push('  /* ── Shadows ── */');
    dna.colors.shadows.forEach((s, i) => {
      lines.push(`  --shadow-${i}: ${s};`);
    });
    lines.push('');
  }
  
  // ── GRADIENT TOKENS ──
  if (dna.colors?.gradients?.length) {
    lines.push('  /* ── Gradients ── */');
    dna.colors.gradients.forEach((g, i) => {
      lines.push(`  --gradient-${i}: ${g};`);
    });
    lines.push('');
  }
  
  // ── SPACING TOKENS ──
  lines.push('  /* ── Spacing Scale ── */');
  const scale = dna.spacing?.inferredScale || [];
  scale.forEach((val, i) => {
    lines.push(`  --space-${i + 1}: ${val}px;`);
  });
  lines.push('');
  
  // ── BORDER RADIUS TOKENS ──
  lines.push('  /* ── Border Radius ── */');
  const radii = new Set();
  // Components are keyed by breakpoint — use the largest breakpoint for token extraction
  const bpKeys = Object.keys(dna.components || {}).filter(k => k.endsWith('px'));
  const primaryBp = bpKeys.sort((a, b) => parseInt(b) - parseInt(a))[0];
  const primaryComponents = primaryBp ? dna.components[primaryBp] : dna.components;
  // Handle both flat (legacy) and breakpoint-keyed structures
  const buttons = primaryComponents?.buttons || dna.components?.buttons || [];
  const media = primaryComponents?.media || dna.components?.media || [];
  const cards = primaryComponents?.cards || dna.components?.cards || [];
  
  buttons.forEach(b => {
    if (b.borderRadius && b.borderRadius !== '0px') radii.add(b.borderRadius);
  });
  media.forEach(m => {
    if (m.borderRadius && m.borderRadius !== '0px') radii.add(m.borderRadius);
  });
  cards.forEach(c => {
    if (c.borderRadius && c.borderRadius !== '0px') radii.add(c.borderRadius);
  });
  [...radii].sort((a, b) => parseFloat(a) - parseFloat(b)).forEach((r, i) => {
    lines.push(`  --radius-${i}: ${r};`);
  });
  lines.push('');
  
  // ── TRANSITION TOKENS ──
  lines.push('  /* ── Transitions ── */');
  const transitions = new Set();
  (dna.interactiveStates || []).forEach(is => {
    if (is.transition?.duration && is.transition.duration !== '0s') {
      const key = `${is.transition.duration} ${is.transition.timingFunction}`;
      transitions.add(key);
    }
  });
  [...transitions].forEach((t, i) => {
    lines.push(`  --transition-${i}: ${t};`);
  });
  lines.push('');
  
  // ── LAYOUT TOKENS ──
  lines.push('  /* ── Layout ── */');
  const maxWidths = new Set();
  // Layout is keyed by breakpoint — use primary breakpoint
  const layoutKeys = Object.keys(dna.layout || {}).filter(k => k.endsWith('px'));
  const primaryLayout = layoutKeys.sort((a, b) => parseInt(b) - parseInt(a))[0];
  const layoutSections = primaryLayout ? dna.layout[primaryLayout]?.sections : (dna.layout?.sections || []);
  (layoutSections || []).forEach(s => {
    if (s.maxWidth && s.maxWidth !== 'none') maxWidths.add(s.maxWidth);
  });
  // Also extract from alignment map if available
  (dna.alignmentMap?.sections || []).forEach(s => {
    s.chain?.forEach(c => {
      if (c.maxWidth && c.maxWidth !== 'none') maxWidths.add(c.maxWidth);
    });
  });
  [...maxWidths].forEach((mw, i) => {
    lines.push(`  --container-${i}: ${mw};`);
  });
  
  lines.push('}');
  lines.push('');
  
  const css = lines.join('\n');
  
  if (outputPath) {
    fs.writeFileSync(outputPath, css);
    console.error(`[Tokens] Written to ${outputPath}`);
  }
  
  console.log(css);
  return css;
}

// CLI
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node generate-tokens.js <site-dna-path> [--output <tokens.css>]');
  process.exit(1);
}

let outputPath = null;
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--output' && args[i + 1]) outputPath = args[++i];
}

generateTokens(args[0], outputPath);
