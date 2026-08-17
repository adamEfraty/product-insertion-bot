/**
 * Fetches products via WooCommerce's public Store API, which returns the
 * REAL native WooCommerce product schema (id, name, regular_price,
 * sale_price, description, short_description, categories, images,
 * attributes, etc.) — no HTML parsing/reconstruction involved.
 *
 * Endpoint: GET /wp-json/wc/store/v1/products?page=N&per_page=100
 *
 * This endpoint is public/unauthenticated on many WooCommerce sites, but
 * some stores disable or firewall it. This script will tell you clearly
 * if that's the case, so you can fall back to discover.js + scrape.js
 * (HTML-based) instead.
 *
 * Output: ./output/products-api.jsonl (one raw WooCommerce product object per line)
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { fetchWithRetry, sleep } = require('./utils/http');

const OUT_FILE = path.join(__dirname, './output/products-api.jsonl');
const PER_PAGE = 100;

async function main() {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  const outStream = fs.createWriteStream(OUT_FILE, { flags: 'w' });

  let page = 1;
  let total = 0;

  console.log('Checking whether the WooCommerce Store API is exposed...');

  while (true) {
    const url = `${config.baseUrl}/wp-json/wc/store/v1/products?page=${page}&per_page=${PER_PAGE}`;
    console.log(`Fetching page ${page}: ${url}`);

    let data;
    try {
      data = await fetchWithRetry(url, { retries: 1 });
    } catch (err) {
      const status = err.response ? err.response.status : null;
      if (page === 1) {
        console.error(
          `\nStore API is not accessible (status ${status || err.code}).\n` +
          `This site likely doesn't expose /wp-json/wc/store/v1/products publicly.\n` +
          `Fall back to the HTML-based scraper instead: "npm run discover" then "npm run scrape".`
        );
        process.exit(1);
      } else {
        console.log(`Stopping — page ${page} failed (status ${status || err.code}), assuming end of catalog.`);
        break;
      }
    }

    const products = typeof data === 'string' ? JSON.parse(data) : data;

    if (!Array.isArray(products) || products.length === 0) {
      console.log('No more products. Done paginating.');
      break;
    }

    for (const product of products) {
      outStream.write(JSON.stringify(product) + '\n');
      total++;
    }

    console.log(`  -> ${products.length} products on this page (total so far: ${total})`);

    if (products.length < PER_PAGE) break;
    page++;
    await sleep(config.minDelayMs);
  }

  outStream.end();
  console.log(`\nDone. Saved ${total} native WooCommerce product objects to ${OUT_FILE}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
