# Reconstruction Patterns Reference

Code patterns for implementing common behaviors detected during extraction.
Use these as starting points — plug in the exact values from `site-dna.json`.

## Scroll-Triggered Fade-In

For elements classified as `fade-in` in `scrollBehaviors.classifications`:

```css
/* Default: hidden */
.scroll-reveal {
  opacity: 0;
  transform: translateY(30px);
  transition: opacity 0.6s ease, transform 0.6s ease;
}

/* When visible */
.scroll-reveal.is-visible {
  opacity: 1;
  transform: translateY(0);
}
```

```javascript
// Use values from classification.details.triggerScrollY to set rootMargin
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target); // animate once
    }
  });
}, {
  threshold: 0.1,
  rootMargin: '0px 0px -50px 0px', // adjust based on triggerScrollY
});

document.querySelectorAll('.scroll-reveal').forEach(el => observer.observe(el));
```

## Parallax Effect

For elements classified as `parallax`:

```javascript
// multiplier from classification.details.multiplier
function initParallax(selector, multiplier) {
  const el = document.querySelector(selector);
  if (!el) return;
  
  const update = () => {
    const scrollY = window.scrollY;
    const rect = el.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;
    const offset = (scrollY - (el.offsetTop - window.innerHeight / 2)) * multiplier;
    el.style.transform = `translateY(${offset}px)`;
  };
  
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        update();
        ticking = false;
      });
      ticking = true;
    }
  });
  
  update(); // initial position
}

// Example: initParallax('.parallax-bg', -0.3);
```

## Sticky Header with Background Transition

For elements classified as `sticky`:

```css
.site-header {
  position: fixed;
  top: 0;
  width: 100%;
  z-index: 50;
  transition: background-color 0.3s ease, box-shadow 0.3s ease;
  /* Use extracted default values */
  background-color: transparent;
}

.site-header.is-scrolled {
  /* Use extracted scrolled-state values */
  background-color: rgba(255, 255, 255, 0.95);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  backdrop-filter: blur(10px);
}
```

```javascript
// triggerScrollY from classification.details.triggerScrollY
const header = document.querySelector('.site-header');
const trigger = 100; // from DNA

window.addEventListener('scroll', () => {
  header.classList.toggle('is-scrolled', window.scrollY > trigger);
});
```

## Hover State Implementation

For elements with `hoverDelta` in `interactiveStates`:

```css
/* Map transition values directly from DNA */
.btn-primary {
  /* defaultState values */
  background-color: var(--color-primary);
  color: var(--color-text-white);
  transform: none;
  box-shadow: var(--shadow-btn);
  /* transition from DNA */
  transition: all 0.2s ease;
}

.btn-primary:hover {
  /* Apply hoverDelta.to values */
  background-color: var(--color-primary-hover);
  transform: translateY(-2px);
  box-shadow: var(--shadow-btn-hover);
}

.btn-primary:focus-visible {
  /* Apply focusDelta.to values */
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
```

## Responsive Layout from Extracted Breakpoints

```css
/* Mobile first — use extracted 375px values as base */
.container {
  width: 100%;
  margin: 0 auto;
  /* padding from DNA layout.sections[n].padding at 375px */
  padding: 0 16px;
}

/* Tablet — use extracted 768px values */
@media (min-width: 768px) {
  .container {
    padding: 0 24px;
  }
  
  .grid-section {
    /* grid values from DNA at 768px */
    grid-template-columns: repeat(2, 1fr);
    gap: 24px;
  }
}

/* Desktop — use extracted 1024px values */
@media (min-width: 1024px) {
  .container {
    padding: 0 32px;
  }
  
  .grid-section {
    grid-template-columns: repeat(3, 1fr);
    gap: 32px;
  }
}

/* Large desktop — use extracted 1440px values */
@media (min-width: 1440px) {
  .container {
    /* maxWidth from DNA */
    max-width: 1280px;
    padding: 0 48px;
  }
}
```

## Slide-In on Scroll

For elements classified as `slide-in`:

```css
.slide-in-left {
  opacity: 0;
  transform: translateX(-60px); /* startTransform from DNA */
  transition: opacity 0.7s ease, transform 0.7s ease;
}

.slide-in-left.is-visible {
  opacity: 1;
  transform: translateX(0); /* endTransform from DNA */
}

.slide-in-right {
  opacity: 0;
  transform: translateX(60px);
  transition: opacity 0.7s ease, transform 0.7s ease;
}

.slide-in-right.is-visible {
  opacity: 1;
  transform: translateX(0);
}
```

## Staggered Animation (Multiple Elements)

When multiple elements of the same type fade/slide in:

```css
.stagger-item {
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 0.5s ease, transform 0.5s ease;
}

.stagger-item.is-visible {
  opacity: 1;
  transform: translateY(0);
}

/* Stagger with nth-child delays */
.stagger-item:nth-child(1) { transition-delay: 0s; }
.stagger-item:nth-child(2) { transition-delay: 0.1s; }
.stagger-item:nth-child(3) { transition-delay: 0.2s; }
.stagger-item:nth-child(4) { transition-delay: 0.3s; }
```

## Scale-on-Scroll (Zoom Effect)

```javascript
function initScaleOnScroll(selector, startScale, endScale) {
  const el = document.querySelector(selector);
  if (!el) return;
  
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        const vh = window.innerHeight;
        
        // Calculate progress (0 = just entering viewport, 1 = fully past)
        const progress = Math.min(1, Math.max(0, 1 - (rect.top / vh)));
        const scale = startScale + (endScale - startScale) * progress;
        
        el.style.transform = `scale(${scale})`;
        ticking = false;
      });
      ticking = true;
    }
  });
}
```

## Image Placeholder Pattern

When original images cannot be used (copyright, authentication):

```html
<!-- Preserve exact aspect ratio from DNA -->
<div class="image-placeholder" 
     style="aspect-ratio: 1.333; background: var(--color-bg-1);"
     data-original-src="https://example.com/hero.jpg"
     data-natural-width="1920"
     data-natural-height="1080">
  <span class="placeholder-label">Image: Hero (1920×1080)</span>
</div>
```

```css
.image-placeholder {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--color-border-0);
  border-radius: var(--radius-0); /* from DNA */
  overflow: hidden;
}

.placeholder-label {
  font-size: var(--text-sm);
  color: var(--color-text-1);
  opacity: 0.6;
}
```

## Font Loading Pattern

```html
<!-- Google Fonts — from assets.fonts where type === 'external' -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

```css
/* Font-face fallback — when exact font requires substitution */
/* Document in font-substitutions.md */
@font-face {
  font-family: 'SubstitutedFont';
  src: url('./fonts/substitute.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
```
