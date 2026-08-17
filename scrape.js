/**
 * Phase 2: visit every discovered product URL and extract full details.
 *
 * Resumable: URLs already scraped (recorded in done-urls.json) are skipped,
 * so you can safely stop (Ctrl+C) and re-run later.
 *
 * Output: ./output/products.jsonl  (one JSON object per line)
 */
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const pLimit = require('p-limit');
const config = require('./config');
const { fetchWithRetry, sleep } = require('./utils/http');

const URLS_FILE = path.join(__dirname, config.paths.urlsFile);
const PRODUCTS_FILE = path.join(__dirname, config.paths.productsFile);
const DONE_FILE = path.join(__dirname, config.paths.doneUrlsFile);

function loadJsonSafe(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function text($el) {
  return $el.text().replace(/\s+/g, ' ').trim();
}

function extractTabs($) {
  const tabs = {};
  $('.woocommerce-tabs .panel, [id^="tab-"]').each((_, el) => {
    const $el = $(el);
    const id = $el.attr('id') || '';
    const key = id.replace(/^tab-/, '') || `panel_${Object.keys(tabs).length}`;
    const content = text($el);
    if (content) tabs[key] = content;
  });
  return tabs;
}

function extractImages($) {
  const images = new Set();
  $('.woocommerce-product-gallery img, .product-images img, figure.woocommerce-product-gallery__wrapper img')
    .each((_, el) => {
      const $el = $(el);
      const src =
        $el.attr('data-large_image') ||
        $el.attr('data-src') ||
        $el.attr('src');
      if (src) images.add(src);
    });
  return [...images];
}

function extractPrice($) {
  const priceBlock = $('.summary .price, p.price, .product .price').first();
  const amounts = [];
  priceBlock.find('.amount').each((_, el) => amounts.push(text($(el))));

  const isOnSale = priceBlock.find('del').length > 0;
  return {
    raw: text(priceBlock),
    regularPrice: isOnSale ? amounts[0] || null : amounts[0] || null,
    salePrice: isOnSale ? amounts[amounts.length - 1] || null : null,
    onSale: isOnSale,
  };
}

function parseProductPage(html, url) {
  const $ = cheerio.load(html);

  const title = text($('h1.product_title, h1.entry-title').first());
  const sku = text($('.sku').first()) || null;
  const categories = $('.posted_in a')
    .map((_, el) => text($(el)))
    .get();
  const shortDescription = text(
    $('.woocommerce-product-details__short-description, .product-short-description').first()
  );
  const availability = text($('.stock').first()) || null;

  const price = extractPrice($);
  const images = extractImages($);
  const tabs = extractTabs($);

  return {
    url,
    title: title || null,
    sku,
    categories,
    price,
    availability,
    shortDescription: shortDescription || null,
    tabs,
    images,
    scrapedAt: new Date().toISOString(),
  };
}

async function main() {
  const urls = loadJsonSafe(URLS_FILE, null);
  if (!urls) {
    console.error(`No URLs found at ${URLS_FILE}. Run "npm run discover" first.`);
    process.exit(1);
  }

  const doneUrls = new Set(loadJsonSafe(DONE_FILE, []));
  const remaining = urls.filter((u) => !doneUrls.has(u));

  console.log(`Total URLs: ${urls.length}. Already done: ${doneUrls.size}. Remaining: ${remaining.length}.`);

  fs.mkdirSync(path.dirname(PRODUCTS_FILE), { recursive: true });
  const outStream = fs.createWriteStream(PRODUCTS_FILE, { flags: 'a' });

  const limit = pLimit(config.concurrency);
  let completed = 0;
  let failed = 0;

  const tasks = remaining.map((url) =>
    limit(async () => {
      try {
        await sleep(config.minDelayMs);
        const html = await fetchWithRetry(url);
        const product = parseProductPage(html, url);

        outStream.write(JSON.stringify(product) + '\n');
        doneUrls.add(url);
        completed++;

        if (completed % 10 === 0) {
          fs.writeFileSync(DONE_FILE, JSON.stringify([...doneUrls]));
          console.log(`Progress: ${completed}/${remaining.length} scraped, ${failed} failed.`);
        }
      } catch (err) {
        failed++;
        console.error(`Failed: ${url} — ${err.message}`);
      }
    })
  );

  await Promise.all(tasks);

  fs.writeFileSync(DONE_FILE, JSON.stringify([...doneUrls]));
  outStream.end();

  console.log(`\nDone. Scraped ${completed} products (${failed} failures).`);
  console.log(`Output: ${PRODUCTS_FILE}`);
}

main().catch((err) => {
  console.error('Fatal error during scrape:', err);
  process.exit(1);
});
