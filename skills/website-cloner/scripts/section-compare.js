/**
 * Section-Level Comparison Tool (v3)
 * 
 * Usage: node section-compare.js <reference-screenshot> <clone-url-or-path> [options]
 *   --selector <css>     CSS selector for the section to compare
 *   --width <px>         Viewport width (default: 1440)
 *   --threshold <0-1>    pixelmatch color threshold (default: 0.1)
 *   --output <dir>       Output directory
 *   --dna <path>         Path to site-dna.json for element-level checking
 * 
 * Produces:
 *   1. Section-cropped screenshot of the clone
 *   2. Pixelmatch diff image highlighting mismatches
 *   3. Match percentage with pass/fail verdict
 *   4. Element-level comparison checklist (if --dna provided)
 * 
 * Requirements: npm install playwright pixelmatch pngjs
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

let pixelmatch;

async function loadPixelmatch() {
  try { pixelmatch = require('pixelmatch'); }
  catch (e) { const mod = await import('pixelmatch'); pixelmatch = mod.default || mod; }
}

function normalizeImages(img1, img2) {
  const width = Math.max(img1.width, img2.width);
  const height = Math.max(img1.height, img2.height);
  
  function pad(img, tw, th) {
    if (img.width === tw && img.height === th) return img;
    const out = new PNG({ width: tw, height: th });
    for (let i = 0; i < out.data.length; i += 4) {
      out.data[i] = 255; out.data[i+1] = 255; out.data[i+2] = 255; out.data[i+3] = 255;
    }
    for (let y = 0; y < Math.min(img.height, th); y++) {
      for (let x = 0; x < Math.min(img.width, tw); x++) {
        const si = (y * img.width + x) * 4;
        const di = (y * tw + x) * 4;
        out.data[di] = img.data[si]; out.data[di+1] = img.data[si+1];
        out.data[di+2] = img.data[si+2]; out.data[di+3] = img.data[si+3];
      }
    }
    return out;
  }
  
  return { img1: pad(img1, width, height), img2: pad(img2, width, height), width, height };
}

async function sectionCompare(refPath, cloneTarget, options = {}) {
  await loadPixelmatch();
  
  const width = options.width || 1440;
  const threshold = options.threshold || 0.1;
  const outputDir = options.outputDir || './clone-workspace/diffs';
  const selector = options.selector || null;
  const dnaPath = options.dna || null;
  const passThreshold = 95; // 95% for sections — font rendering diffs eat 2-3%
  
  fs.mkdirSync(outputDir, { recursive: true });
  
  if (!fs.existsSync(refPath)) {
    console.error(`[Compare] ✗ Reference not found: ${refPath}`);
    process.exit(1);
  }
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width, height: 900 });
  
  // Freeze animations for consistent comparison
  const cloneUrl = cloneTarget.startsWith('http') ? cloneTarget : `file://${path.resolve(cloneTarget)}`;
  await page.goto(cloneUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.addStyleTag({
    content: '*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }'
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1000);
  
  const timestamp = Date.now();
  let cloneScreenshot;
  
  if (selector) {
    // Section-level screenshot
    const el = await page.$(selector);
    if (!el) {
      console.error(`[Compare] ✗ Selector not found: ${selector}`);
      await browser.close();
      process.exit(1);
    }
    cloneScreenshot = await el.screenshot();
  } else {
    // Full-page screenshot
    cloneScreenshot = await page.screenshot({ fullPage: true });
  }
  
  const clonePath = path.join(outputDir, `clone-section-${timestamp}.png`);
  const diffPath = path.join(outputDir, `diff-section-${timestamp}.png`);
  const reportPath = path.join(outputDir, `compare-report-${timestamp}.json`);
  const checklistPath = path.join(outputDir, `checklist-${timestamp}.md`);
  
  fs.writeFileSync(clonePath, cloneScreenshot);
  
  // ── Pixel comparison ──
  const refImg = PNG.sync.read(fs.readFileSync(refPath));
  const cloneImg = PNG.sync.read(cloneScreenshot);
  const { img1, img2, width: nw, height: nh } = normalizeImages(refImg, cloneImg);
  const diffPng = new PNG({ width: nw, height: nh });
  
  const mismatchedPixels = pixelmatch(
    img1.data, img2.data, diffPng.data, nw, nh,
    { threshold, includeAA: false, alpha: 0.3, diffColor: [255, 0, 0] }
  );
  
  fs.writeFileSync(diffPath, PNG.sync.write(diffPng));
  
  const totalPixels = nw * nh;
  const matchPercent = ((1 - mismatchedPixels / totalPixels) * 100).toFixed(2);
  const passed = parseFloat(matchPercent) >= passThreshold;
  
  // ── Element-level comparison (if DNA available) ──
  let elementChecklist = [];
  if (dnaPath && fs.existsSync(dnaPath) && selector) {
    const dna = JSON.parse(fs.readFileSync(dnaPath, 'utf-8'));
    
    // Extract element positions from the clone
    const cloneElements = await page.evaluate((sel) => {
      const section = document.querySelector(sel);
      if (!section) return [];
      
      const elements = [];
      const interesting = section.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,button,img,svg,input,nav,ul,li,span[class]');
      
      interesting.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const cs = window.getComputedStyle(el);
        
        elements.push({
          tag: el.tagName.toLowerCase(),
          text: el.textContent?.trim().substring(0, 40) || '',
          id: el.id || null,
          class: el.className?.toString()?.substring(0, 80) || '',
          rect: {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
          fontFamily: cs.fontFamily.split(',')[0].trim().replace(/['"]/g, ''),
          color: cs.color,
          backgroundColor: cs.backgroundColor,
          borderRadius: cs.borderRadius,
        });
      });
      
      return elements;
    }, selector);
    
    // Generate checklist
    elementChecklist = cloneElements.map(el => {
      const label = el.text ? `${el.tag} "${el.text}"` : `${el.tag}${el.id ? '#'+el.id : ''}${el.class ? '.'+el.class.split(' ')[0] : ''}`;
      return {
        element: label,
        position: `(${el.rect.left}, ${el.rect.top})`,
        size: `${el.rect.width}×${el.rect.height}`,
        fontSize: el.fontSize,
        fontWeight: el.fontWeight,
        font: el.fontFamily,
        color: el.color,
        backgroundColor: el.backgroundColor,
        borderRadius: el.borderRadius,
      };
    });
  }
  
  // ── Generate report ──
  const report = {
    timestamp: new Date().toISOString(),
    reference: refPath,
    clone: clonePath,
    diffImage: diffPath,
    selector: selector || 'full-page',
    viewport: width,
    dimensions: {
      reference: { width: refImg.width, height: refImg.height },
      clone: { width: cloneImg.width, height: cloneImg.height },
    },
    results: {
      totalPixels,
      mismatchedPixels,
      matchPercent: parseFloat(matchPercent),
      passThreshold,
      passed,
    },
    elementCount: elementChecklist.length,
  };
  
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  
  // ── Generate markdown checklist ──
  const lines = [
    `# Section Comparison: ${selector || 'Full Page'}`,
    ``,
    `**Match: ${matchPercent}%** ${passed ? '✓ PASS' : '✗ FAIL'} (threshold: ${passThreshold}%)`,
    `**Mismatched pixels:** ${mismatchedPixels.toLocaleString()} / ${totalPixels.toLocaleString()}`,
    ``,
    `Reference: \`${refPath}\``,
    `Clone: \`${clonePath}\``,
    `Diff: \`${diffPath}\``,
    ``,
  ];
  
  if (elementChecklist.length > 0) {
    lines.push(`## Element Checklist (${elementChecklist.length} elements)`);
    lines.push('');
    elementChecklist.forEach(el => {
      lines.push(`- ${el.element}`);
      lines.push(`  Position: ${el.position} | Size: ${el.size}`);
      lines.push(`  Font: ${el.font} ${el.fontSize} wt-${el.fontWeight}`);
      if (el.borderRadius !== '0px') lines.push(`  Border-radius: ${el.borderRadius}`);
      lines.push('');
    });
  }
  
  lines.push('## Next Steps');
  if (passed) {
    lines.push('Section passes. Move to next section.');
  } else {
    lines.push('Review the diff image for red-highlighted areas.');
    lines.push('Cross-reference failing elements against site-dna.json values.');
    lines.push('Fix, re-screenshot, and re-compare.');
  }
  
  fs.writeFileSync(checklistPath, lines.join('\n'));
  
  // ── Console output ──
  const icon = passed ? '✓' : '✗';
  console.error('');
  console.error(`[Compare] ${icon} ${matchPercent}% match (threshold: ${passThreshold}%)`);
  console.error(`  Mismatched: ${mismatchedPixels.toLocaleString()} / ${totalPixels.toLocaleString()} pixels`);
  if (report.dimensions.reference.width !== report.dimensions.clone.width ||
      report.dimensions.reference.height !== report.dimensions.clone.height) {
    console.error(`  ⚠ Size mismatch: ref ${refImg.width}×${refImg.height} vs clone ${cloneImg.width}×${cloneImg.height}`);
  }
  console.error(`  Diff image: ${diffPath}`);
  console.error(`  Checklist: ${checklistPath}`);
  
  console.log(JSON.stringify(report, null, 2));
  
  await browser.close();
  return report;
}

// CLI
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node section-compare.js <reference-screenshot> <clone-url-or-path> [options]');
  console.error('  --selector <css>   Section selector (e.g., "section.hero")');
  console.error('  --width <px>       Viewport width (default: 1440)');
  console.error('  --threshold <0-1>  Color threshold (default: 0.1)');
  console.error('  --dna <path>       site-dna.json for element-level checking');
  console.error('  --output <dir>     Output directory');
  process.exit(1);
}

const opts = {};
for (let i = 2; i < args.length; i++) {
  if (args[i] === '--selector' && args[i+1]) opts.selector = args[++i];
  if (args[i] === '--width' && args[i+1]) opts.width = parseInt(args[++i]);
  if (args[i] === '--threshold' && args[i+1]) opts.threshold = parseFloat(args[++i]);
  if (args[i] === '--dna' && args[i+1]) opts.dna = args[++i];
  if (args[i] === '--output' && args[i+1]) opts.outputDir = args[++i];
}

sectionCompare(args[0], args[1], opts).catch(err => {
  console.error('[Compare] Fatal error:', err.message);
  process.exit(1);
});
