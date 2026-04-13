# Wayback Machine Extraction Guide

Read this BEFORE starting extraction if the target URL is from `web.archive.org`.
Wayback Machine adds toolbars, rewrites URLs, and has rate limits that affect extraction.

## URL Modifiers

Wayback URLs follow: `web.archive.org/web/[14-digit-timestamp][modifier]/[original_url]`

Available modifiers:
- `if_` — Renders page without the WM toolbar (best for extraction)
- `id_` — Returns raw original bytes with no rewriting at all
- `im_` — Image-specific rewriting
- `js_` — JavaScript-specific rewriting
- `cs_` — CSS-specific rewriting
- (none) — Full rewriting with toolbar

**Recommendation:** Use `if_` for page extraction (no toolbar, but URLs are still rewritten
so assets load correctly). Use `id_` for downloading individual assets (raw original bytes).

Example:
```
With toolbar:  https://web.archive.org/web/20240715000000/https://wpengine.com/
Without:       https://web.archive.org/web/20240715000000if_/https://wpengine.com/
```

## Toolbar Removal (if not using `if_`)

If you must use the standard URL, remove the injected toolbar after page load:

```javascript
await page.evaluate(() => {
  // Remove toolbar elements
  ['wm-ipp-base', 'wm-ipp', 'donato', 'wm-ipp-print'].forEach(id => {
    document.getElementById(id)?.remove();
  });
  
  // Remove injected scripts and styles
  document.querySelectorAll([
    'script[src*="archive.org"]',
    'script[src*="/_static/"]',
    'link[href*="banner-styles"]',
    'script[src*="wombat.js"]',
    'script[src*="bundle-playback"]',
  ].join(',')).forEach(el => el.remove());
  
  // Remove the analytics tracking pixel
  document.querySelectorAll('img[src*="analytics.archive.org"]').forEach(el => el.remove());
});
```

## URL Reversal

To get the original URL from a Wayback URL:

```javascript
function reverseWaybackUrl(url) {
  return url.replace(
    /https?:\/\/web\.archive\.org\/web\/\d{1,14}(?:id_|if_|im_|js_|cs_|fr_|oe_|mp_)?\//g,
    ''
  );
}
```

## Handling Next.js `_next/image` URLs

Next.js `<Image>` components generate URLs like:
```
/_next/image?url=%2Fimages%2Fhero.jpg&w=1080&q=75
```

These are server-side optimization endpoints that Wayback cannot replay. Extract the
actual source image from the `url` query parameter:

```javascript
function extractNextImageUrl(src) {
  const match = src.match(/\/_next\/image\?url=([^&]+)/);
  if (!match) return src;
  return decodeURIComponent(match[1]);
}
```

Then construct a Wayback URL for the original image:
```
https://web.archive.org/web/20240715000000im_/https://wpengine.com/images/hero.jpg
```

## Rate Limiting

Wayback Machine rate limits aggressively:
- CDX API: ~60 requests/minute
- Page fetches: ~2 requests/second recommended
- Assets: batch downloads with 500ms delays between requests

On 429 (Too Many Requests): exponential backoff — 4s, 8s, 16s, 32s delays.
On 503 (Server overloaded): wait 60 seconds before retrying.

```javascript
async function fetchWithRetry(url, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url);
      if (response.status === 429) {
        const delay = Math.pow(2, i + 2) * 1000; // 4s, 8s, 16s
        console.error(`  Rate limited, waiting ${delay/1000}s...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      if (response.status === 503) {
        console.error(`  Server overloaded, waiting 60s...`);
        await new Promise(r => setTimeout(r, 60000));
        continue;
      }
      return response;
    } catch (e) {
      if (i === maxRetries - 1) throw e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}
```

## Asset Fallback Chain

When an asset isn't available at the exact timestamp, try these in order:

1. **Exact timestamp with type modifier**: `/web/20240715000000im_/[url]`
2. **Exact timestamp without modifier**: `/web/20240715000000/[url]`
3. **Any version via redirect**: `/web/im_/[url]` (WM picks closest available)
4. **Latest version**: `/web/2/[url]` (redirects to most recent capture)
5. **Live original URL**: try the original URL directly (site may still have the asset)

## CDX API for Asset Discovery

Use the CDX API to check if an asset was archived:

```
https://web.archive.org/cdx/search/cdx?url=wpengine.com/images/hero.jpg&output=json&filter=statuscode:200&limit=5
```

Returns JSON with available timestamps, MIME types, and sizes. Use `fl=timestamp,original,mimetype,length`
to select specific fields.

## CORS Issues

Wayback-served stylesheets are cross-origin, so `document.styleSheets[n].cssRules` throws
`SecurityError`. This means `@font-face` rules inside those sheets can't be read via JavaScript.

**Workaround:** Use network interception to capture the CSS file content, then parse
`@font-face` rules from the raw text using regex or a CSS parser.

**Alternative:** Use the `id_` modifier to fetch the raw stylesheet directly, then parse it.

## Extraction Script Integration

When using `extract-assets.js` with Wayback Machine sources, pass the `--wayback` flag:

```bash
node scripts/extract-assets.js "https://web.archive.org/web/20240715000000if_/https://wpengine.com/" --wayback
```

This enables:
- Automatic toolbar removal
- Wayback URL prefix handling for asset downloads
- Rate-limited batch downloads
- Next.js image URL extraction
- Asset fallback chain on 404s
