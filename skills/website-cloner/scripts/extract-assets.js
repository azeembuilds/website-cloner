/**
 * Asset Extraction Script (v3)
 * 
 * Usage: node extract-assets.js <url> [--output <dir>] [--wayback]
 * 
 * Five-phase asset pipeline:
 *   1. Network interception (captures all HTTP responses)
 *   2. Scroll to trigger lazy-loaded images
 *   3. Force-load remaining lazy images
 *   4. DOM-level extraction (img src, background-image, fonts, meta)
 *   5. Inline SVG extraction with classification
 * 
 * Requirements: npm install playwright sharp
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ASSET_DIRS = ['images', 'svg', 'fonts', 'css', 'backgrounds', 'favicons', 'media', 'other'];

function safeName(url, ext) {
  const parsed = new URL(url, 'https://placeholder.com');
  let name = path.basename(parsed.pathname) || 'unnamed';
  // Remove query params from name but keep for uniqueness
  if (name.length > 80) name = name.substring(0, 80);
  if (!path.extname(name) && ext) name += ext;
  // Add hash suffix for uniqueness
  const hash = crypto.createHash('md5').update(url).digest('hex').substring(0, 6);
  const base = path.basename(name, path.extname(name));
  return `${base}-${hash}${path.extname(name)}`;
}

function classifyContentType(ct, resourceType) {
  ct = (ct || '').toLowerCase();
  if (ct.includes('image/svg')) return 'svg';
  if (ct.includes('image/')) return 'images';
  if (ct.includes('font/') || ct.includes('application/font') || ct.includes('woff') || ct.includes('ttf') || ct.includes('otf')) return 'fonts';
  if (ct.includes('text/css')) return 'css';
  if (ct.includes('video/') || ct.includes('audio/')) return 'media';
  if (resourceType === 'image') return 'images';
  if (resourceType === 'font') return 'fonts';
  if (resourceType === 'stylesheet') return 'css';
  if (resourceType === 'media') return 'media';
  return null; // skip non-asset resources
}

async function extractAssets(url, options = {}) {
  const outputDir = options.outputDir || './clone-workspace/assets';
  const isWayback = options.wayback || url.includes('web.archive.org');
  
  // Create asset directories
  for (const dir of ASSET_DIRS) {
    fs.mkdirSync(path.join(outputDir, dir), { recursive: true });
  }
  
  const manifest = {
    sourceUrl: url,
    extractedAt: new Date().toISOString(),
    isWayback,
    networkAssets: [],
    domAssets: [],
    inlineSvgs: [],
    failedDownloads: [],
    stats: {},
  };
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    serviceWorkers: 'block', // Prevent SW from intercepting requests
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  
  // ──────────────────────────────────────────────
  // PHASE 1: Network Response Interception
  // ──────────────────────────────────────────────
  console.error('[Assets] Phase 1: Network interception...');
  const captured = new Set();
  
  page.on('response', async (response) => {
    if (response.status() < 200 || response.status() >= 400) return;
    const reqUrl = response.url();
    if (captured.has(reqUrl) || reqUrl.startsWith('data:')) return;
    
    const ct = response.headers()['content-type'] || '';
    const rt = response.request().resourceType();
    const folder = classifyContentType(ct, rt);
    if (!folder) return;
    
    captured.add(reqUrl);
    
    try {
      const buffer = await response.body();
      const ext = ct.includes('svg') ? '.svg' : ct.includes('woff2') ? '.woff2' : ct.includes('woff') ? '.woff' : '';
      const filename = safeName(reqUrl, ext);
      const filepath = path.join(outputDir, folder, filename);
      
      fs.writeFileSync(filepath, buffer);
      manifest.networkAssets.push({
        url: reqUrl,
        type: folder,
        file: `${folder}/${filename}`,
        size: buffer.length,
        contentType: ct,
      });
    } catch (e) {
      // response.body() throws on redirects
    }
  });
  
  // Load the page
  if (isWayback) {
    // Hide WM toolbar by removing injected elements after load
    console.error('[Assets] Wayback Machine detected — will clean toolbar after load');
  }
  
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);
  
  if (isWayback) {
    await page.evaluate(() => {
      ['wm-ipp-base', 'wm-ipp', 'donato', 'wm-ipp-print'].forEach(id => {
        document.getElementById(id)?.remove();
      });
      document.querySelectorAll('script[src*="archive.org"], script[src*="/_static/"], link[href*="banner-styles"]')
        .forEach(el => el.remove());
    });
  }
  
  console.error(`  └─ Captured ${manifest.networkAssets.length} assets via network interception`);
  
  // ──────────────────────────────────────────────
  // PHASE 2: Scroll to Trigger Lazy Loading
  // ──────────────────────────────────────────────
  console.error('[Assets] Phase 2: Triggering lazy-loaded images...');
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      const timer = setInterval(() => {
        window.scrollBy(0, 300);
        if (window.scrollY + window.innerHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 200);
    });
  });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  
  // ──────────────────────────────────────────────
  // PHASE 3: Force-Load Remaining Lazy Images
  // ──────────────────────────────────────────────
  console.error('[Assets] Phase 3: Force-loading lazy images...');
  const forcedCount = await page.evaluate(() => {
    let count = 0;
    const attrs = ['data-src', 'data-lazy', 'data-original', 'data-srcset', 'data-bg'];
    document.querySelectorAll('img').forEach(img => {
      for (const attr of attrs) {
        const val = img.getAttribute(attr);
        if (val && !img.src.includes(val)) {
          img.src = val;
          img.removeAttribute(attr);
          count++;
        }
      }
      img.removeAttribute('loading');
    });
    return count;
  });
  if (forcedCount > 0) {
    await page.waitForTimeout(2000);
    console.error(`  └─ Force-loaded ${forcedCount} lazy images`);
  }
  
  // ──────────────────────────────────────────────
  // PHASE 4: DOM-Level Asset Discovery
  // ──────────────────────────────────────────────
  console.error('[Assets] Phase 4: DOM-level asset discovery...');
  const domUrls = await page.evaluate((isWB) => {
    const urls = { images: [], backgrounds: [], fonts: [], favicons: [], meta: [] };
    
    // Images (src + srcset)
    document.querySelectorAll('img[src]').forEach(img => {
      if (img.src && !img.src.startsWith('data:')) urls.images.push(img.src);
      if (img.srcset) {
        img.srcset.split(',').forEach(entry => {
          const u = entry.trim().split(/\s+/)[0];
          if (u && !u.startsWith('data:')) urls.images.push(u);
        });
      }
    });
    document.querySelectorAll('picture source[srcset]').forEach(source => {
      source.srcset.split(',').forEach(entry => {
        const u = entry.trim().split(/\s+/)[0];
        if (u && !u.startsWith('data:')) urls.images.push(u);
      });
    });
    
    // Background images
    document.querySelectorAll('*').forEach(el => {
      const bg = window.getComputedStyle(el).backgroundImage;
      if (bg && bg !== 'none') {
        const matches = bg.matchAll(/url\(["']?([^"')]+)["']?\)/g);
        for (const m of matches) {
          if (!m[1].startsWith('data:') && !m[1].includes('gradient')) {
            urls.backgrounds.push(m[1]);
          }
        }
      }
    });
    
    // Favicons
    document.querySelectorAll('link[rel*="icon"], link[rel="apple-touch-icon"], link[rel="mask-icon"]').forEach(link => {
      if (link.href) urls.favicons.push(link.href);
    });
    
    // Meta images
    document.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]').forEach(meta => {
      const content = meta.getAttribute('content');
      if (content) urls.meta.push(content);
    });
    
    return urls;
  }, isWayback);
  
  // Download DOM-discovered assets not already captured
  for (const [type, urls] of Object.entries(domUrls)) {
    const folder = type === 'meta' ? 'images' : type;
    for (const assetUrl of [...new Set(urls)]) {
      if (captured.has(assetUrl)) continue;
      try {
        const response = await context.request.get(assetUrl, { timeout: 10000 });
        if (response.ok()) {
          const buffer = await response.body();
          const filename = safeName(assetUrl, '');
          fs.writeFileSync(path.join(outputDir, folder, filename), buffer);
          manifest.domAssets.push({
            url: assetUrl,
            type: folder,
            file: `${folder}/${filename}`,
            size: buffer.length,
          });
          captured.add(assetUrl);
        }
      } catch (e) {
        manifest.failedDownloads.push({ url: assetUrl, type: folder, error: e.message?.substring(0, 100) });
      }
    }
  }
  
  console.error(`  └─ Discovered ${manifest.domAssets.length} additional assets from DOM`);
  
  // ──────────────────────────────────────────────
  // PHASE 5: Inline SVG Extraction + Classification
  // ──────────────────────────────────────────────
  console.error('[Assets] Phase 5: Inline SVG extraction...');
  const svgData = await page.evaluate(() => {
    const svgs = [];
    
    document.querySelectorAll('svg').forEach((svg, index) => {
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      
      // Ensure xmlns for standalone use
      if (!svg.getAttribute('xmlns')) {
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      }
      
      // Analyze fill strategy
      const elements = [svg, ...svg.querySelectorAll('*')];
      let usesCurrentColor = false;
      const hardcodedColors = new Set();
      for (const el of elements) {
        const fill = el.getAttribute('fill');
        const stroke = el.getAttribute('stroke');
        if (fill === 'currentColor' || stroke === 'currentColor') usesCurrentColor = true;
        if (fill && fill !== 'none' && fill !== 'currentColor') hardcodedColors.add(fill);
        if (stroke && stroke !== 'none' && stroke !== 'currentColor') hardcodedColors.add(stroke);
      }
      let fillStrategy = 'none';
      if (usesCurrentColor && hardcodedColors.size === 0) fillStrategy = 'currentColor';
      else if (hardcodedColors.size > 0 && !usesCurrentColor) fillStrategy = 'hardcoded';
      else if (usesCurrentColor && hardcodedColors.size > 0) fillStrategy = 'mixed';
      
      // Context detection
      const inHeader = !!svg.closest('header');
      const inNav = !!svg.closest('nav');
      const inFooter = !!svg.closest('footer');
      const inButton = !!svg.closest('button');
      const inAnchor = !!svg.closest('a');
      const pathCount = svg.querySelectorAll('path, circle, rect, line, polyline, polygon, ellipse').length;
      const totalChildren = svg.querySelectorAll('*').length;
      const area = rect.width * rect.height;
      
      // Classification by score
      let logoScore = 0, iconScore = 0, decorScore = 0, illustScore = 0;
      
      if (inHeader || inNav) logoScore += 5;
      if (rect.width >= 80 && rect.width <= 300 && rect.height >= 15 && rect.height <= 100) logoScore += 4;
      if (inAnchor && (inHeader || inNav)) logoScore += 3;
      const cls = svg.getAttribute('class') || '';
      if (/logo/i.test(cls)) logoScore += 5;
      
      if (rect.width <= 32 && rect.height <= 32) iconScore += 5;
      if (inButton) iconScore += 4;
      if (/icon|lucide|heroicon|feather|fa-/i.test(cls)) iconScore += 5;
      if (svg.getAttribute('aria-hidden') === 'true') iconScore += 2;
      if (pathCount <= 5) iconScore += 2;
      
      if (area > 50000) decorScore += 3;
      if (/wave|divider|blob|bg|shape|pattern/i.test(cls)) decorScore += 5;
      if (pathCount <= 3 && area > 10000) decorScore += 3;
      
      if (pathCount > 20) illustScore += 3;
      if (totalChildren > 30) illustScore += 3;
      if (/illustration|hero|feature/i.test(cls)) illustScore += 5;
      
      const scores = { logo: logoScore, icon: iconScore, decorative: decorScore, illustration: illustScore };
      const classification = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
      
      // Section context
      const section = svg.closest('section, header, footer, nav, main, article');
      const sectionId = section?.id || section?.getAttribute('class')?.split(' ')[0] || section?.tagName.toLowerCase() || 'unknown';
      
      // Check for <use> references
      const useElements = svg.querySelectorAll('use');
      const useRefs = [];
      useElements.forEach(use => {
        const href = use.getAttribute('href') || use.getAttribute('xlink:href');
        if (href) useRefs.push(href);
      });
      
      svgs.push({
        index,
        outerHTML: svg.outerHTML,
        viewBox: svg.getAttribute('viewBox') || null,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        fillStrategy,
        hardcodedColors: [...hardcodedColors],
        classification,
        scores,
        section: sectionId,
        inHeader, inNav, inFooter, inButton, inAnchor,
        pathCount,
        totalChildren,
        useRefs,
        ariaLabel: svg.getAttribute('aria-label') || null,
        role: svg.getAttribute('role') || null,
      });
    });
    
    return svgs;
  });
  
  // Save each SVG as a file
  for (const svg of svgData) {
    const name = `${svg.classification}-${svg.section}-${svg.index}.svg`;
    const filepath = path.join(outputDir, 'svg', name);
    fs.writeFileSync(filepath, svg.outerHTML);
    
    svg.file = `svg/${name}`;
    // Don't store outerHTML in manifest (too large)
    const { outerHTML, ...meta } = svg;
    manifest.inlineSvgs.push(meta);
  }
  
  console.error(`  └─ Extracted ${svgData.length} inline SVGs`);
  console.error(`    └─ ${svgData.filter(s => s.classification === 'logo').length} logos, ` +
    `${svgData.filter(s => s.classification === 'icon').length} icons, ` +
    `${svgData.filter(s => s.classification === 'decorative').length} decorative, ` +
    `${svgData.filter(s => s.classification === 'illustration').length} illustrations`);
  
  // ──────────────────────────────────────────────
  // VERIFICATION
  // ──────────────────────────────────────────────
  console.error('[Assets] Verifying downloads...');
  let verified = 0, tooSmall = 0;
  const allFiles = [];
  for (const dir of ASSET_DIRS) {
    const dirPath = path.join(outputDir, dir);
    if (!fs.existsSync(dirPath)) continue;
    for (const file of fs.readdirSync(dirPath)) {
      const filepath = path.join(dirPath, file);
      const stat = fs.statSync(filepath);
      if (stat.size < 1024 && dir !== 'svg' && dir !== 'favicons') {
        tooSmall++;
        manifest.failedDownloads.push({ file: `${dir}/${file}`, size: stat.size, warning: 'Under 1KB — may be corrupt' });
      } else {
        verified++;
      }
      allFiles.push({ dir, file, size: stat.size });
    }
  }
  
  manifest.stats = {
    totalNetworkAssets: manifest.networkAssets.length,
    totalDomAssets: manifest.domAssets.length,
    totalInlineSvgs: manifest.inlineSvgs.length,
    totalVerified: verified,
    totalSuspicious: tooSmall,
    totalFailed: manifest.failedDownloads.length,
  };
  
  // Write manifest
  const manifestPath = path.join(outputDir, 'asset-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  
  console.error('');
  console.error(`[Assets] ── Extraction Complete ──`);
  console.error(`  Network assets: ${manifest.stats.totalNetworkAssets}`);
  console.error(`  DOM assets: ${manifest.stats.totalDomAssets}`);
  console.error(`  Inline SVGs: ${manifest.stats.totalInlineSvgs}`);
  console.error(`  Verified: ${manifest.stats.totalVerified}`);
  console.error(`  Suspicious (<1KB): ${manifest.stats.totalSuspicious}`);
  console.error(`  Failed: ${manifest.stats.totalFailed}`);
  console.error(`  Manifest: ${manifestPath}`);
  
  await browser.close();
  return manifest;
}

// CLI
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node extract-assets.js <url> [--output <dir>] [--wayback]');
  process.exit(1);
}

const url = args[0];
const options = {};
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--output' && args[i + 1]) options.outputDir = args[++i];
  if (args[i] === '--wayback') options.wayback = true;
}

extractAssets(url, options).catch(err => {
  console.error('[Assets] Fatal error:', err.message);
  process.exit(1);
});
