# freqlab Website Specification

A one-page marketing website for freqlab - an AI-powered VST/CLAP plugin development tool for macOS.

## Project Overview

| Field | Value |
|-------|-------|
| **Domain** | freqlab.app |
| **Purpose** | Marketing landing page with "name your price" checkout via Polar.sh |
| **Framework** | Astro |
| **Deployment** | Cloudflare Pages |
| **Style** | Dark, modern, audio-focused - matching the desktop app aesthetic |

---

## Design Philosophy

**The website should feel premium, cutting-edge, and visually striking.**

### Aesthetic Goals
- **High-end audio software vibe** - Think Ableton, Native Instruments, Output
- **Sophisticated dark mode** - Not flat black, use depth with layered grays
- **Subtle motion** - Animated waveforms, smooth transitions, floating elements
- **Glass morphism** - Frosted glass cards with backdrop blur
- **Accent glow effects** - Green accents should softly illuminate nearby elements
- **Clean whitespace** - Let the content breathe, don't crowd sections
- **Premium typography** - Inter font, careful hierarchy, generous line-height

### Visual Inspiration
- Vercel's marketing site (clean, dark, animated)
- Linear.app (glass effects, smooth animations)
- Raycast.com (developer-focused but beautiful)
- Splice.com (audio-focused, modern)

### What to Avoid
- Generic startup templates
- Flat, boring layouts
- Overly busy backgrounds
- Cheap-looking gradients
- Stock photo energy

**This should look like a tool made by someone who cares about design.**

---

## Important Links

| Platform | URL |
|----------|-----|
| **Domain** | https://freqlab.app |
| **GitHub** | https://github.com/jamesontucker/freqlab |
| **X/Twitter** | https://x.com/nanoshrine |
| **Instagram** | https://instagram.com/nanoshrine |
| **Website** | https://nanoshrineinteractive.com |

**Creator**: nanoshrine

---

## Tech Stack

### Astro + Cloudflare Pages

```bash
# Create project
pnpm create astro@latest freqlab-website
cd freqlab-website

# Install dependencies
pnpm add @polar-sh/astro
```

### Environment Variables

```env
POLAR_ACCESS_TOKEN=XXX
POLAR_SUCCESS_URL=https://freqlab.app/success?checkout_id={CHECKOUT_ID}
```

### Polar.sh Integration

Reference: https://polar.sh/docs/integrate/sdk/adapters/astro

```typescript
// src/pages/api/checkout.ts
import { Checkout } from "@polar-sh/astro";

export const GET = Checkout({
  accessToken: import.meta.env.POLAR_ACCESS_TOKEN,
  successUrl: import.meta.env.POLAR_SUCCESS_URL
});
```

---

## Design System

### Color Palette

```css
:root {
  /* Backgrounds */
  --bg-primary: #0f0f0f;
  --bg-secondary: #171717;
  --bg-tertiary: #1f1f1f;
  --bg-elevated: #262626;

  /* Accent (Green) */
  --accent: #2DA86E;
  --accent-hover: #34B87A;
  --accent-subtle: rgba(76, 219, 153, 0.15);

  /* Text */
  --text-primary: #fafafa;
  --text-secondary: #a1a1aa;
  --text-muted: #71717a;

  /* Border */
  --border: #27272a;

  /* Status */
  --success: #10b981;
  --warning: #f59e0b;
  --error: #ef4444;
}
```

### Gradient

The signature gradient used throughout:
```css
.gradient-text {
  background: linear-gradient(135deg, #2DA86E 0%, #36C07E 50%, #4CDB99 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.gradient-bg {
  background: linear-gradient(135deg, #2DA86E 0%, #36C07E 100%);
}
```

### Typography

```css
body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.5;
}
```

Use Inter from Google Fonts or Fontsource.

### Visual Effects

```css
/* Glass morphism for cards */
.glass {
  background: rgba(23, 23, 23, 0.8);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border);
  border-radius: 12px;
}

/* Subtle glow on accent elements */
.glow {
  box-shadow: 0 0 20px rgba(45, 168, 110, 0.3);
}
```

---

## Logo

### Waveform Logo SVG

```svg
<svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M20 40V35M26 40V30M32 40V25M38 40V20M44 40V25M50 40V30M56 40V35M62 40V32"
        stroke="url(#logoGrad)" stroke-width="4" stroke-linecap="round"/>
  <path d="M20 40V45M26 40V50M32 40V55M38 40V60M44 40V55M50 40V50M56 40V45M62 40V48"
        stroke="url(#logoGrad)" stroke-width="4" stroke-linecap="round"/>
  <defs>
    <linearGradient id="logoGrad" x1="0" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse">
      <stop stop-color="#2DA86E"/>
      <stop offset="1" stop-color="#36C07E"/>
    </linearGradient>
  </defs>
</svg>
```

---

## Page Sections

### 1. Hero Section

**Layout**: Centered, full viewport height with subtle gradient background

**Content**:
- **Platform Badge**: "macOS 12+" pill/badge (prominent, near top)
- Logo (waveform SVG)
- Title: "freqlab" (gradient text)
- Tagline: "Create audio plugins through conversation"
- Subtitle: "Describe what you want. Watch Claude build it. Hear it instantly."
- CTA Button: "Get freqlab" → scrolls to pricing section

**Platform Badge Design**:
```html
<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-bg-tertiary border border-border text-sm text-text-secondary">
  <svg><!-- Apple logo --></svg>
  macOS 12+
</span>
```

**Visual Elements**:
- Subtle animated waveform in background (CSS or canvas)
- Floating particles or grid pattern
- Logo should have subtle glow animation

---

### 2. Demo/Preview Section

**Layout**: Full-width with app screenshot or video

**Content**:
- Heading: "See it in action"
- Large screenshot or short video loop showing:
  - Chat interface with Claude streaming responses
  - Real-time build output
  - Audio preview panel with spectrum analyzer and waveform
  - Plugin editor window open
- Caption: "Describe → Build → Preview → Iterate"

**Design Notes**:
- Screenshot should have glass border treatment
- Consider subtle parallax on scroll

---

### 3. Features Section

**Layout**: Organized into categories with feature cards (2-3 columns on desktop)

#### Conversational Development

| Icon | Feature | Description |
|------|---------|-------------|
| 🧠 | Persistent Sessions | Each project gets its own Claude agent that remembers your plugin's architecture, parameters, and history |
| 💬 | Streaming Responses | Watch Claude write code in real-time as it modifies your plugin |
| 📎 | File Attachments | Drop in reference files, specs, or examples to guide development |
| ⏪ | One-Click Revert | Every change auto-commits to git. Revert to any point instantly |

#### Audio Preview

| Icon | Feature | Description |
|------|---------|-------------|
| 🔄 | Hot Reload | Plugin reloads automatically when code changes - no restart needed |
| 🎛️ | Test Signals | Built-in sine, noise, sweep, impulse, and chirp generators |
| 🎵 | Sample Playback | Load WAV, MP3, or AAC files as input for testing |
| 📊 | Spectrum Analyzer | Real-time frequency visualization with smooth 60fps rendering |
| 📈 | Waveform Display | Time-domain view to see clipping, transients, compression |
| 🔊 | Level Metering | Stereo meters with dB readout and clipping indicators |
| 🎹 | Plugin Editor | Open your plugin's actual GUI while previewing |

#### Build System

| Icon | Feature | Description |
|------|---------|-------------|
| 📦 | One-Click Build | Compile VST3 + CLAP formats with a single button |
| 📺 | Streaming Output | Watch the build in real-time, catch errors early |
| 🏷️ | Versioned Artifacts | Each build saves to `output/{name}/v{version}/` |
| 🚀 | DAW Publishing | Copy plugins directly to your DAW's plugin folder |
| 📤 | Project Export | Share entire projects as zip files |

#### Plugin Templates

| Type | UI Options | Description |
|------|------------|-------------|
| **Effect** | WebView / egui / Headless | Process incoming audio (EQ, compression, reverb, etc.) |
| **Instrument** | WebView / egui / Headless | Generate audio from MIDI (synths, samplers, etc.) |

**Card Design**:
- Dark glass background
- Icon with accent color
- Bold title
- Muted description text
- Subtle hover effect (border glow or lift)

---

### 4. How It Works Section

**Layout**: Horizontal steps or vertical timeline, with embedded video

**The Workflow**:
```
Describe → Build → Preview → Iterate
```

**Video Embed**:
```html
<!-- YouTube video showcasing the app workflow -->
<div class="video-container aspect-video rounded-xl overflow-hidden border border-border">
  <iframe
    src="https://www.youtube.com/embed/VIDEO_ID"
    title="freqlab Demo"
    frameborder="0"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
    allowfullscreen
    class="w-full h-full"
  ></iframe>
</div>
```

**Steps** (below video):
1. **Describe** - "Tell Claude what you want: 'Create a vintage tape saturation effect with warmth control'"
2. **Build** - "One click compiles your plugin to VST3 and CLAP formats"
3. **Preview** - "Hot reload lets you hear changes instantly with built-in test signals"
4. **Iterate** - "Refine the sound through conversation. Revert anytime if needed."

**Design Notes**:
- Video should be prominently featured, full-width on mobile
- Each step should have a small illustration or icon below the video
- Connect steps with a subtle line/path
- Consider animated reveal on scroll

---

### 5. Requirements Section

**Layout**: Clean card with checklist-style items

**Content**:
```
## What You'll Need

Before using freqlab, make sure you have:

✓ macOS 12 (Monterey) or later
✓ Xcode Command Line Tools
✓ Rust (via rustup.rs)
✓ Claude Code CLI (requires Anthropic subscription)

freqlab checks these on first launch and guides you through setup.
```

**Design Notes**:
- Use checkmark icons
- Link "rustup.rs" and mention Anthropic subscription
- Keep it honest but not scary - these are one-time setup steps

---

### 6. Tech Stack Section (Optional)

**Layout**: Simple horizontal logo row or badges

**Technologies**:
- Tauri 2.x
- nih-plug (Rust audio framework)
- Claude Code CLI
- React + TypeScript

**Design Notes**:
- Keep minimal - just show credibility
- Muted colors, don't distract from main content

---

### 7. Pricing Section

**Layout**: Centered card with Polar.sh integration

**Content**:
```
# Name Your Price

freqlab is available for whatever you think it's worth.

[Price Input: $___] (minimum $1)

[Get freqlab Button]

---

Want it for free? freqlab is open source.
Build it yourself from the source code.

[View on GitHub →]
```

**Design Notes**:
- Large, prominent card with glass effect
- Price input should be styled to match theme
- GitHub link should be secondary/muted
- Add trust indicators if available (download count, stars, etc.)

**Polar Integration**:
```astro
<!-- Pricing component -->
<form action="/api/checkout" method="GET">
  <input
    type="number"
    name="amount"
    min="100"
    placeholder="5.00"
    class="price-input"
  />
  <button type="submit" class="cta-button">
    Get freqlab
  </button>
</form>
```

---

### 8. Important Notes Section

**Layout**: Subtle callout boxes or accordion

**Content**:

#### Unsigned Plugins
> Plugins built with freqlab are unsigned. macOS Gatekeeper may block them on first run.
>
> To fix, run in Terminal:
> ```bash
> xattr -cr /path/to/YourPlugin.clap
> xattr -cr /path/to/YourPlugin.vst3
> ```

#### Code Review
> Claude generates the plugin code. While templates include safety limiters, always review generated code before distributing plugins.

#### Licensing
> freqlab is GPL-3.0 licensed. Plugins use nih-plug:
> - **VST3 plugins** must be GPL-3.0 (provide source on request)
> - **CLAP-only plugins** have no such requirement
> - You can sell plugins, but must share source if asked

---

### 9. Footer

**Layout**: Simple, minimal

**Content**:
- Logo (small)
- Social Links: GitHub | X | Instagram | Website
- "A nanoshrine experiment"
- Copyright © 2026 nanoshrine

**Links**:
```html
<a href="https://github.com/jamesontucker/freqlab">GitHub</a>
<a href="https://x.com/nanoshrine">X</a>
<a href="https://instagram.com/nanoshrine">Instagram</a>
<a href="https://nanoshrineinteractive.com">nanoshrineinteractive.com</a>
```

---

## Responsive Design

### Breakpoints

```css
/* Mobile first */
@media (min-width: 640px) { /* sm */ }
@media (min-width: 768px) { /* md */ }
@media (min-width: 1024px) { /* lg */ }
@media (min-width: 1280px) { /* xl */ }
```

### Mobile Considerations

- Hero: Stack vertically, reduce font sizes, platform badge above title
- Features: Single column, collapsible categories
- Screenshots: Full width with horizontal scroll if needed
- Pricing card: Full width with padding
- Requirements: Simplified list view

---

## Animations

### Scroll Animations

Use Astro's built-in view transitions or a library like `@midudev/tailwind-animations`:

```css
/* Fade in on scroll */
.fade-in {
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 0.6s ease, transform 0.6s ease;
}

.fade-in.visible {
  opacity: 1;
  transform: translateY(0);
}
```

### Micro-interactions

- Button hover: Subtle scale + glow
- Card hover: Border color change + slight lift
- Logo: Subtle pulse or wave animation
- Input focus: Border accent color

---

## SEO & Meta

```astro
---
// src/pages/index.astro
const title = "freqlab - Create Audio Plugins Through Conversation";
const description = "AI-powered VST/CLAP plugin development for macOS. Describe what you want, watch Claude build it, hear it instantly. Name your price or build from source.";
const image = "https://freqlab.app/og-image.png"; // 1200x630
const url = "https://freqlab.app";
---

<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{title}</title>
    <meta name="description" content={description} />
    <link rel="canonical" href={url} />

    <!-- Open Graph -->
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    <meta property="og:image" content={image} />
    <meta property="og:url" content={url} />
    <meta property="og:type" content="website" />

    <!-- Twitter -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:site" content="@nanoshrine" />
    <meta name="twitter:title" content={title} />
    <meta name="twitter:description" content={description} />
    <meta name="twitter:image" content={image} />
  </head>
</html>
```

---

## File Structure

```
freqlab-website/
├── src/
│   ├── components/
│   │   ├── Hero.astro
│   │   ├── Demo.astro
│   │   ├── Features.astro
│   │   ├── HowItWorks.astro
│   │   ├── Requirements.astro
│   │   ├── Pricing.astro
│   │   ├── ImportantNotes.astro
│   │   ├── Footer.astro
│   │   ├── Logo.astro
│   │   ├── FeatureCard.astro
│   │   └── PlatformBadge.astro
│   ├── layouts/
│   │   └── Layout.astro
│   ├── pages/
│   │   ├── index.astro
│   │   ├── success.astro
│   │   └── api/
│   │       └── checkout.ts
│   └── styles/
│       └── global.css
├── public/
│   ├── favicon.svg
│   ├── og-image.png
│   └── screenshot.png
├── astro.config.mjs
├── tailwind.config.mjs
└── package.json
```

---

## Cloudflare Pages Deployment

### astro.config.mjs

```javascript
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://freqlab.app',
  output: 'hybrid', // or 'server' for full SSR
  adapter: cloudflare(),
  integrations: [tailwind()],
});
```

### Install adapter

```bash
pnpm add @astrojs/cloudflare @astrojs/tailwind tailwindcss
```

---

## Success Page

After Polar checkout, redirect to `/success`:

```astro
---
// src/pages/success.astro
const checkoutId = Astro.url.searchParams.get('checkout_id');
---

<Layout title="Thank You - freqlab">
  <main class="min-h-screen flex items-center justify-center">
    <div class="glass p-8 text-center max-w-md">
      <div class="text-4xl mb-4">🎉</div>
      <h1 class="text-2xl font-bold mb-2">Thank you!</h1>
      <p class="text-muted mb-6">
        Your download link has been sent to your email.
      </p>
      <a href="/" class="cta-button">Back to Home</a>
    </div>
  </main>
</Layout>
```

---

## Assets Needed

1. **Screenshot**: High-quality app screenshot (dark mode) showing:
   - Chat with Claude streaming
   - Build output panel
   - Preview panel with spectrum/waveform
   - Size: 1920x1080 or similar

2. **OG Image**: Social sharing image - 1200x630
   - Logo + tagline + dark background
   - "Create audio plugins through conversation"

3. **Favicon**: Use the waveform logo SVG

4. **Demo Video** (optional): 15-30 second loop showing the workflow

5. **Apple Logo SVG**: For the macOS badge

---

## Copy Tone

- **Professional but approachable**
- **Technical credibility without jargon overload**
- **Focus on the magic**: "describe → build → hear"
- **Honest about requirements and limitations**
- **Brief, scannable text** - let the visuals do the heavy lifting

---

## Checklist

- [ ] Astro project setup with Cloudflare adapter
- [ ] Tailwind configured with custom colors
- [ ] All page sections implemented:
  - [ ] Hero with macOS badge
  - [ ] Demo/screenshot section
  - [ ] Features (organized by category)
  - [ ] How it works
  - [ ] Requirements
  - [ ] Pricing with Polar.sh
  - [ ] Important notes (unsigned, licensing)
  - [ ] Footer with social links
- [ ] Polar.sh checkout integration working
- [ ] Success page created
- [ ] Responsive design tested
- [ ] Meta tags and OG image
- [ ] Favicon
- [ ] All links working (GitHub, X, Instagram, website)
- [ ] Deployed to Cloudflare Pages
- [ ] Custom domain (freqlab.app) configured
