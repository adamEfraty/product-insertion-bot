# marshal.co.il product scraper

Scrapes the full product catalog from https://marshal.co.il/ — name, price,
SKU, categories, description, additional-info/ingredients tabs, images, etc.

Before running a full-site crawl, please check `https://marshal.co.il/robots.txt`
and the site's terms of use yourself, and keep the concurrency/delay settings
in `config.js` reasonable so you don't hammer their server.

## Setup

```bash
npm install
```

## Step 0 — try the native WooCommerce API first (recommended)

Before scraping HTML, try this — it's faster, more reliable, and returns
the **real WooCommerce data structure** (the same object shape WooCommerce
itself uses internally: `id`, `name`, `regular_price`, `sale_price`,
`description`, `short_description`, `categories`, `images`, `attributes`,
etc.) instead of something reconstructed from HTML:

```bash
npm run try-api
```

This calls WooCommerce's public Store API
(`/wp-json/wc/store/v1/products`), which many stores expose without
authentication. If it works, you're done — `output/products-api.jsonl`
has everything, in the native schema, and you can skip everything below.

If it fails (some stores block or disable this endpoint), the script
will tell you clearly, and you should fall back to the HTML-based
scraper described below.

One caveat even if the API works: custom tabs some themes add via page
builders (e.g. a bespoke "Ingredients" section built in Elementor rather
than as a real WooCommerce attribute) may not appear in the Store API
response, since they're not part of WooCommerce's data model at all.
If you need that content too, run the HTML scraper's `tabs` extraction
as a supplement and merge on `permalink`/`url`.

## Usage — HTML-based fallback (two phases)

**1. Discover all product URLs** (tries the site's XML sitemap first, falls
back to crawling category pages if there's no sitemap):

```bash
npm run discover
```

This writes `output/product-urls.json`.

**2. Scrape full details for every discovered product:**

```bash
npm run scrape
```

This writes `output/products.jsonl` (one JSON object per line — easy to
append to and to stream/process without loading everything in memory).

If it gets interrupted (Ctrl+C, network hiccup, etc.), just run
`npm run scrape` again — it skips URLs already recorded in
`output/done-urls.json` and picks up where it left off.

**3. (Optional) Export to CSV for Excel/Sheets:**

```bash
npm run export-csv
```

Writes `output/products.csv`.

## Tuning

Edit `config.js`:
- `concurrency` — how many requests run in parallel (default 3)
- `minDelayMs` — minimum pause between request starts (default 400ms)
- `maxRetries` / `retryBaseDelayMs` — retry behavior on failures

## About the selectors

`scrape.js` targets standard WooCommerce markup (`.product_title`, `.price`,
`.sku`, `.posted_in`, `.woocommerce-tabs .panel`, `.woocommerce-product-gallery`,
etc.). WooCommerce sites are pretty consistent, but if the theme has custom
markup for things like an "Ingredients" tab, you may need to tweak the
selectors in `extractTabs()` / `extractPrice()` / `extractImages()` in
`scrape.js`. Easiest way to check: open a product page in your browser,
right-click → Inspect, and look at the actual class/id names, then adjust.

The `tabs` object in each product record is generic — it captures whatever
tab panels exist on the page keyed by their `id` (minus the `tab-` prefix),
so if the site has an "Ingredients" tab it should show up as
`tabs.ingredients` automatically without any code changes.
