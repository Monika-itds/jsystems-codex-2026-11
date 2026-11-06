# x-kom visual reference

Source: [x-kom homepage](https://www.x-kom.pl/), inspected on 2026-11-05 with Playwright CLI in visible Google Chrome at a 1440 x 1000 CSS-pixel viewport. This is an extracted reference, not an official x-kom brand manual. The cookie dialog was dismissed before measurements and screenshots; images were loaded by scrolling the page.

## Assets

| File | Purpose |
| --- | --- |
| [Design tokens](../assets/design-tokens.json) | Structured colors, typography, spacing, radii and component measurements |
| [Homepage screenshot](../assets/homepage.png) | Full desktop page without consent or modal overlays |
| [Logo SVG](../assets/logo.svg) | Visible header wordmark with the Polish tagline and resolved SVG colors |
| [Favicon](../assets/favicon.ico) | Original icon fetched in the page context |
| [Instrument Sans variable font](../assets/fonts/instrument-sans/InstrumentSans-VariableFont_wdth,wght.woff2) | Local copy of the font served by x-kom |

The font and favicon were fetched from `assets.x-kom.pl` through the site's browser context with no failed asset downloads. The logo was extracted from the visible inline header SVG, with computed fill/stroke colors embedded so it renders independently of the website's CSS.

Verify the logo, favicon and font licenses before use or redistribution. Download availability does not establish reuse rights.

## Colors

Values below are measured computed styles or published root CSS custom properties. The blue brand token is distinct from the dark primary call-to-action observed on the homepage.

| Token | Value | Usage and evidence |
| --- | --- | --- |
| `brand.primary` | `#0082fa` | Published `--color-brand700`; brand blue and accents |
| `brand.accent` | `#fa0064` | Published `--color-brand5700`; pink brand accent |
| `brand.purple` | `#8250fa` | Published `--color-brand3700`; logo and accent palette |
| `brand.cyan` | `#0fd2ff` | Published `--color-brand4700`; logo and accent palette |
| `action.primary` | `#222222` | Measured "Kup teraz" button and search action |
| `action.strong` | `#1a1a1a` | Published `--color-buttonStrong`; not the measured CTA fill |
| `background.default` | `#ffffff` | Header and content cards |
| `background.light` | `#f7f7f7` | Secondary canvas between sections |
| `background.input` | `#f2f2f2` | Search field container |
| `background.success` | `#eef7ed` | Discount/coupon badges |
| `background.purple` | `#f4f0ff` | Light purple accent surface |
| `text.primary` | `#1a1a1a` | Main content and headings |
| `text.alternative` | `#444444` | Alternative text and icon tone |
| `text.secondary`, `text.muted` | `#6e6e6e` | Secondary labels and descriptions |
| `text.onDark` | `#ffffff` | Dark buttons and promotional strip |
| `text.link` | `#1c73e7` | Published link color |
| `text.linkHover` | `#004fe1` | Published hover color; interaction not exercised |
| `text.linkActive` | `#003fcd` | Published active color; interaction not exercised |
| `text.linkVisited` | `#6000b0` | Published visited color; interaction not exercised |
| `brand.success` | `#007d00` | Measured promotional prices and badges |
| `brand.error` | `#a30319` | Published `--color-textDanger`; no error was triggered |
| `brand.warning` | `#946a00` | Published `--color-textWarning`; no warning was triggered |
| `border.default` | `#949494` | Published base border |
| `border.muted` | `#ebebeb` | Published muted border |
| `border.selected` | `#1a1a1a` | Published selected border |
| `background.overlay` | `rgba(0,0,0,0.48)` | Published alpha color, not a measured open modal |

The six published logo colors are `#8250fa`, `#c382fa`, `#be0064`, `#0fd2ff`, `#0082fa`, and `#fa0064`. Seasonal Black Weeks imagery introduces additional campaign colors; do not treat every image color as a permanent UI token.

## Typography

Primary family: `"Instrument Sans", sans-serif`. The site declares a normal-style variable font with weight range 400-700, `font-display: swap`, and `font-variation-settings: "wdth" 100`.

Downloaded file: `assets/fonts/instrument-sans/InstrumentSans-VariableFont_wdth,wght.woff2`. Verify its license before using it.

Example declaration below assumes the CSS file lives directly in `assets/`; adjust the URL for the consuming app's actual asset pipeline.

```css
@font-face {
  font-family: "Instrument Sans";
  src: url("./fonts/instrument-sans/InstrumentSans-VariableFont_wdth,wght.woff2") format("woff2");
  font-style: normal;
  font-weight: 400 700;
  font-display: swap;
}

body {
  font-family: "Instrument Sans", sans-serif;
  font-variation-settings: "wdth" 100;
}
```

| Role | Size / line height | Weight |
| --- | --- | --- |
| Main content and product names | 14px / 20px | 400 |
| Small labels and badges | 12-13px; line height varies | 400 |
| Category navigation | 16px; line height varies | 400 |
| Primary CTA | 16px; line height varies | 400 |
| Section heading, e.g. "Hity tygodnia" | 26px / 32px | 600 |
| Logo wrapper h1 | 28px / normal | 700 |

Other visible font sizes: 10, 18, 20 and 24px. The h1 measurement belongs to the logo wrapper, not a text hero heading. Body computed line height is `normal`; do not infer a numerical body line-height token from it. Weights 400 and 600 dominate visible content; 700 was also observed. The font supports intermediate weights, but 500 was not observed in this sample.

## Spacing

A practical 4px base can be inferred from the recurring gaps and padding, with 2px exceptions. This is a normalized implementation scale, not a recovered official spacing specification.

| Value | Observed use or guidance |
| --- | --- |
| 2px | Compact gaps and badge details |
| 4px | Small icon/text gaps |
| 8px | Compact gaps, search input vertical padding |
| 12px | Compact control padding and gaps |
| 16px | Medium gaps and block padding |
| 20px | Input left padding and horizontal content padding |
| 24px | Section padding and primary CTA horizontal padding |
| 32px | Larger content padding and section separation |
| 48px | Large layout gaps |

The primary CTA uses `12px 24px`; the section containing "Hity tygodnia" uses `24px`; the input itself uses `8px 0 8px 20px`. These values are directly measured.

## Border radius

| Token / value | Context |
| --- | --- |
| `none`: 0px | Plain structural wrappers |
| `tiny`: 2px | Small UI details observed on the page |
| `sm`: 4px | Coupon and label badges |
| `md`: 8px | Buttons, search container and category tiles |
| `lg`: 12px | White content sections |
| `r14`: 14px | Additional observed rounded elements |
| `circle`: 100% | Circular imagery and controls |
| `r9`, `r10`, `r16`, `r18`, `r20`, `r24`, `r28` | Published CSS radii: 9, 10, 16, 18, 20, 24, 28px; component use not established |
| `full`: 512px | Published pill radius; visible usage not established |

## Components

### Header and navigation

The desktop header is white with the wordmark on the left, a wide search field in the middle, and account/help/list/cart controls on the right. The measured main header row is 72px high; the category navigation is a separate 58px-high region. Category text is 16px, regular, `#1a1a1a`; promotional categories use accent colors. At this viewport the content fills most of the available width with generous side gutters.

### Buttons

The measured primary "Kup teraz" button uses `#222222`, white text, 16px/400 typography, `12px 24px` padding, no border and 8px corners. The promotional strip link uses white 13px text, `5px 11px` padding, an 8px radius and a `1px solid rgba(255,255,255,0.48)` outline. Hover, focus, pressed and disabled behavior was not exercised; do not infer those states from these resting styles.

### Search input

The search container is 40px high, `#f2f2f2`, borderless, with 8px corners. The inner input is transparent, 14px/20px, `#1a1a1a`, with `8px 0 8px 20px` padding. A category selector and dark icon button share the search row. The inner input's own radius is 0px; apply rounding to the outer container.

### Sections, product cards and badges

The "Hity tygodnia" section is white with 12px corners and 24px padding. Product tiles combine imagery, regular 14px names, price hierarchy, muted supporting text and restrained borders. Discount badges use `#eef7ed` with `#007d00` text, 13px type, 4px corners and `2.5px 4px 1.5px` padding. Green prices communicate promotions, while black and gray remain dominant elsewhere.

### Promotional strip and hero

The top strip is dark, 40px high, with white text and a compact outlined action. The hero is an image-led, rotating campaign carousel with a navigation row. The screenshot captures a single moment; rotating slide content and live countdowns are not stable tokens. Keep permanent navigation and functional controls visually quieter than campaign imagery.

## Logo usage

Use [the saved wordmark](../assets/logo.svg) on a light surface and preserve its viewBox proportions, multicolor symbol and "Technologia po prostu" tagline. It was visually checked after saving. No inverted asset was downloaded or verified; use a light container on dark backgrounds until an approved dark-background variant is supplied. No official minimum size or clear-space rule was recovered.

## Visual style summary

The homepage presents a clean, practical electronics retail interface with white surfaces on a soft gray canvas. Instrument Sans gives the layout a friendly, contemporary tone, while rounded controls keep dense product information approachable. Dark primary actions and restrained typography establish hierarchy without competing with product imagery. Pink, blue, cyan and purple provide brand accents, while green highlights promotional prices. Seasonal banners carry most of the visual intensity.

## Verification and limits

The live desktop page was opened in headed Chrome, cookie consent was dismissed, and a final check found no visible dialog. The full-page screenshot was opened and visually checked after scrolling to load images; the saved SVG was rendered in Chrome and visually checked too. JSON parsing, asset signatures, local document links and Git diff checks are part of the handoff verification.

The source site emitted network errors for third-party advertising/analytics requests and a preload warning; this extraction does not establish a console-clean source site. Mobile layouts, full accessibility behavior, form submission, authentication, checkout and error flows were outside this visual extraction. No application runtime code was changed.
