# Mosaic Wellness — Website (Structural Recreation)

A complete, responsive, multi-page static website that recreates the **information
architecture, navigation, layout patterns and internal page connections** of
`https://mosaicwellness.in/`.

> **Content note:** This build uses **original copy and clean placeholder/CSS-generated
> visuals** rather than Mosaic Wellness's proprietary images and exact marketing text
> (which are copyrighted). The *structure, page map, navigation and sections* mirror the
> real site so you can use it as a faithful framework, learning reference, or starting
> point for your own build.

---

## 🗺️ Site map & internal connections

```
index.html  (Home)
├── our-brands.html                → hub linking to all 4 brand pages
│   └── brands/
│       ├── man-matters.html       (Men's Wellness)
│       ├── be-bodywise.html       (Women's Wellness)
│       ├── little-joys.html       (Children's Wellness)
│       └── root-labs.html         (Indian Wellness for the World)
├── work-with-us.html              (#opportunities · #fellowship · #mavericks)
├── blog.html
└── contact-us.html                (working demo contact form)
```

**Cross-linking**
- Every page shares the same **sticky header** (with dropdown menus for *Our Brands* and
  *Work with Us*) and **footer** (Our Brands · Work with Us · Company columns).
- Brand cards on Home + Our Brands → deep-link into each brand page.
- Brand pages → breadcrumb back to *Our Brands*, plus CTA links to *Contact Us*.
- Footer + nav appear identically on all 9 pages, so navigation is complete from anywhere.
- Validation: **283 internal links checked, 0 broken.**

---

## 📁 Project structure

```
mosaic-wellness-site/
├── index.html            # Home
├── our-brands.html       # Brands hub
├── work-with-us.html     # Careers (3 paths + openings)
├── blog.html             # Blog listing
├── contact-us.html       # Contact form
├── brands/               # Individual brand pages
│   ├── man-matters.html
│   ├── be-bodywise.html
│   ├── little-joys.html
│   └── root-labs.html
├── css/style.css         # Full design system (~18 KB, no framework)
├── js/main.js            # Nav, mobile menu, scroll-reveal, counters, form
├── sitemap.xml           # SEO sitemap (all 9 URLs)
├── robots.txt            # Crawler directives + sitemap reference
├── assets/
│   ├── favicon.svg       # Scalable favicon (primary)
│   ├── favicon-32.png    # PNG fallback
│   ├── favicon-180.png   # Apple touch icon
│   ├── favicon.ico       # Legacy ICO (16/32/48)
│   └── img/              # (empty — drop your images here)
└── README.md
```

---

## ⬇️ Downloading the package

The whole site is bundled as **`mosaic-wellness-site.zip`**. Download it, then unzip:

```bash
unzip mosaic-wellness-site.zip
cd mosaic-wellness-site
python3 -m http.server 8000   # → http://localhost:8000
```

---

## 🔎 SEO / favicon notes

- **`sitemap.xml`** and **`robots.txt`** both reference `https://www.example.com` —
  find-and-replace that with your real domain before going live.
- The favicon is provided in **SVG, PNG (32 & 180 px) and ICO** for full
  browser + iOS support, and is already linked in every page's `<head>`.

---

## ▶️ How to run

No build step, no dependencies. Either:

1. **Double-click `index.html`** to open in any browser, **or**
2. Serve locally for clean relative paths:
   ```bash
   cd mosaic-wellness-site
   python3 -m http.server 8000
   # open http://localhost:8000
   ```

---

## ✨ Features / best practices applied

- **Semantic HTML5** landmarks (`header`, `nav`, `section`, `footer`), `aria-*` labels,
  `aria-current` on active nav items.
- **Mobile-first responsive** design (breakpoints at 960 / 720 / 480 px) with an
  accessible hamburger menu.
- **CSS custom properties** design system — one palette drives all brand accents.
- **Progressive enhancement** — content works without JS; JS adds scroll reveals,
  animated stat counters, sticky-header shadow and the demo form.
- **Performance** — system + Google fonts with `preconnect`, no heavy libraries,
  pure-CSS gradient art instead of large images.
- **SEO** — unique `<title>` and meta description per page, logical heading hierarchy.

---

## 🔧 Customising

- **Colours:** edit the `:root` variables at the top of `css/style.css`.
- **Real images:** drop files into `assets/img/` and swap the `.cover--*`, `.media`,
  `.thumb` gradient backgrounds for `<img>` tags or `background-image`.
- **Real form:** point the `#contactForm` handler in `js/main.js` at your backend /
  form service (e.g. Formspree, Azure Function).
- **New pages:** copy any existing page, keep the shared header/footer block, and add a
  link in the nav + footer.
```
