/**
 * Visual Diff Checkpoint Tool
 * 
 * Usage: node visual-diff.js <reference-screenshot> <clone-url-or-path> [options]
 *   --width <px>          Viewport width (default: 1440)
 *   --threshold <0-1>     pixelmatch color threshold (default: 0.1)
 *   --output <dir>        Output directory (default: ./clone-workspace/diffs)
 *   --full-page           Capture full page instead of viewport-only
 * 
 * Takes a screenshot of the clone, then runs pixel-level diff against the
 * reference image using pixelmatch. Outputs:
 *   1. The clone screenshot
 *   2. A diff image highlighting every mismatched pixel in red
 *   3. A JSON report with mismatch percentage and pass/fail verdict
 * 
 * Requirements: npm install playwright pixelmatch pngjs
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

// Dynamically import pixelmatch (it's ESM-only in newer versions)
let pixelmatch;

async function loadPixelmatch() {
  try {
    // Try CommonJS require first (older versions)
    pixelmatch = require('pixelmatch');
  } catch (e) {
    // Fall back to dynamic import for ESM versions
    const mod = await import('pixelmatch');
    pixelmatch = mod.default || mod;
  }
}

/**
 * Resize a PNG buffer to target dimensions by cropping or padding.
 * When images have different heights (common with full-page captures),
 * we pad the shorter one with white pixels to match.
 */
function normalizeImages(img1, img2) {
  const width = Math.max(img1.width, img2.width);
  const height = Math.max(img1.height, img2.height);
  
  function resizeToCanvas(img, targetW, targetH) {
    if (img.width === targetW && img.height === targetH) return img;
    
    const resized = new PNG({ width: targetW, height: targetH });
    // Fill with white (so padding areas don't trigger diffs on transparent bg)
    for (let i = 0; i < resized.data.length; i += 4) {
      resized.data[i] = 255;     // R
      resized.data[i + 1] = 255; // G
      resized.data[i + 2] = 255; // B
      resized.data[i + 3] = 255; // A
    }
    // Copy original pixels
    for (let y = 0; y < Math.min(img.height, targetH); y++) {
      for (let x = 0; x < Math.min(img.width, targetW); x++) {
        const srcIdx = (y * img.width + x) * 4;
        const dstIdx = (y * targetW + x) * 4;
        resized.data[dstIdx] = img.data[srcIdx];
        resized.data[dstIdx + 1] = img.data[srcIdx + 1];
        resized.data[dstIdx + 2] = img.data[srcIdx + 2];
        resized.data[dstIdx + 3] = img.data[srcIdx + 3];
      }
    }
    return resized;
  }
  
  return {
    img1: resizeToCanvas(img1, width, height),
    img2: resizeToCanvas(img2, width, height),
    width,
    height,
  };
}

async function visualDiff(referencePath, cloneTarget, options = {}) {
  await loadPixelmatch();
  
  const width = options.width || 1440;
  const threshold = options.threshold || 0.1;
  const outputDir = options.outputDir || './clone-workspace/diffs';
  const fullPage = options.fullPage || false;
  
  // Tolerance: what percentage of mismatched pixels is acceptable
  // Default 0.5% — accounts for anti-aliasing, sub-pixel rendering, font rendering differences
  const passThreshold = options.passThreshold || 0.5;
  
  fs.mkdirSync(outputDir, { recursive: true });
  
  if (!fs.existsSync(referencePath)) {
    console.error(`[Diff] ✗ Reference screenshot not found: ${referencePath}`);
    process.exit(1);
  }
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width, height: 900 });
  
  const cloneUrl = cloneTarget.startsWith('http') 
    ? cloneTarget 
    : `file://${path.resolve(cloneTarget)}`;
  
  console.error(`[Diff] Loading clone at ${cloneUrl} (${width}px)...`);
  await page.goto(cloneUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  
  const timestamp = Date.now();
  const cloneScreenshotPath = path.join(outputDir, `clone-${width}-${timestamp}.png`);
  const diffImagePath = path.join(outputDir, `diff-${width}-${timestamp}.png`);
  const reportPath = path.join(outputDir, `diff-report-${width}-${timestamp}.json`);
  
  await page.screenshot({ path: cloneScreenshotPath, fullPage });
  await browser.close();
  
  console.error(`[Diff] Clone screenshot: ${cloneScreenshotPath}`);
  
  // ── Pixel-level comparison ──
  const refImg = PNG.sync.read(fs.readFileSync(referencePath));
  const cloneImg = PNG.sync.read(fs.readFileSync(cloneScreenshotPath));
  
  // Normalize sizes (pad shorter image to match)
  const { img1, img2, width: normW, height: normH } = normalizeImages(refImg, cloneImg);
  
  const diffPng = new PNG({ width: normW, height: normH });
  
  const mismatchedPixels = pixelmatch(
    img1.data, img2.data, diffPng.data,
    normW, normH,
    {
      threshold, // Color distance threshold (0 = exact, 1 = any)
      includeAA: false, // Ignore anti-aliasing differences
      alpha: 0.3, // Opacity of unchanged pixels in diff image
      diffColor: [255, 0, 0], // Red for mismatches
      diffColorAlt: [0, 255, 0], // Green for anti-aliased mismatches
    }
  );
  
  // Write diff image
  fs.writeFileSync(diffImagePath, PNG.sync.write(diffPng));
  
  const totalPixels = normW * normH;
  const mismatchPercent = ((mismatchedPixels / totalPixels) * 100).toFixed(3);
  const passed = parseFloat(mismatchPercent) <= passThreshold;
  
  const report = {
    timestamp: new Date().toISOString(),
    reference: referencePath,
    clone: cloneScreenshotPath,
    diffImage: diffImagePath,
    viewport: { width, fullPage },
    dimensions: {
      reference: { width: refImg.width, height: refImg.height },
      clone: { width: cloneImg.width, height: cloneImg.height },
      normalized: { width: normW, height: normH },
      sizeMismatch: refImg.width !== cloneImg.width || refImg.height !== cloneImg.height,
    },
    results: {
      totalPixels,
      mismatchedPixels,
      mismatchPercent: parseFloat(mismatchPercent),
      threshold,
      passThreshold,
      passed,
    },
  };
  
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  
  // Console output
  const icon = passed ? '✓' : '✗';
  const label = passed ? 'PASS' : 'FAIL';
  console.error('');
  console.error(`[Diff] ── Visual Diff Results ──`);
  console.error(`[Diff] ${icon} ${label} — ${mismatchPercent}% pixel mismatch (threshold: ${passThreshold}%)`);
  console.error(`[Diff]   Mismatched pixels: ${mismatchedPixels.toLocaleString()} / ${totalPixels.toLocaleString()}`);
  console.error(`[Diff]   Color threshold: ${threshold}`);
  if (report.dimensions.sizeMismatch) {
    console.error(`[Diff]   ⚠ Size mismatch: reference ${refImg.width}×${refImg.height} vs clone ${cloneImg.width}×${cloneImg.height}`);
    console.error(`[Diff]   Images were padded to ${normW}×${normH} for comparison`);
  }
  console.error(`[Diff]   Diff image: ${diffImagePath}`);
  console.error(`[Diff]   Report: ${reportPath}`);
  console.error('');
  
  // Output JSON to stdout for programmatic use
  console.log(JSON.stringify(report, null, 2));
  
  return report;
}

// ──────────────────────────────────────────────
// CLI Entry Point
// ──────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node visual-diff.js <reference-screenshot> <clone-url-or-path> [options]');
  console.error('');
  console.error('Options:');
  console.error('  --width <px>         Viewport width (default: 1440)');
  console.error('  --threshold <0-1>    pixelmatch color threshold (default: 0.1)');
  console.error('  --pass <percent>     Max mismatch % to pass (default: 0.5)');
  console.error('  --output <dir>       Output directory');
  console.error('  --full-page          Full page capture');
  console.error('');
  console.error('Example:');
  console.error('  node visual-diff.js ./references/1440-full-page.png ./build/index.html --full-page');
  process.exit(1);
}

const opts = {};
for (let i = 2; i < args.length; i++) {
  if (args[i] === '--width' && args[i + 1]) opts.width = parseInt(args[++i]);
  if (args[i] === '--threshold' && args[i + 1]) opts.threshold = parseFloat(args[++i]);
  if (args[i] === '--pass' && args[i + 1]) opts.passThreshold = parseFloat(args[++i]);
  if (args[i] === '--output' && args[i + 1]) opts.outputDir = args[++i];
  if (args[i] === '--full-page') opts.fullPage = true;
}

visualDiff(args[0], args[1], opts).catch(err => {
  console.error('[Diff] Fatal error:', err.message);
  process.exit(1);
});
