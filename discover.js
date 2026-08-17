/**
 * Phase 1: discover every product URL on the site.
 *
 * Strategy:
 *   1. Try the WordPress/Yoast-style sitemap index first (fast, complete, low load).
 *   2. If no usable sitemap is found, fall back to crawling category pages
 *      and following pagination, collecting /product/ links.
 *
 * Output: ./output/product-urls.json  (a JSON array of unique URLs)
 */
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const config = require('./config');
const { fetchWithRetry, sleep } = require('./utils/http');

const OUT_FILE = path.join(__dirname, config.paths.urlsFile);

function extractLocsFromXml(xml) {
  const matches = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)];
  return matches.map((m) => m[1].trim());
}

async function tryDiscoverViaSitemap() {
  const candidateIndexes = [
    `${config.baseUrl}/sitemap_index.xml`,
    `${config.baseUrl}/sitemap.xml`,
  ];

  for (const indexUrl of candidateIndexes) {
    try {
      console.log(`Trying sitemap index: ${indexUrl}`);
      const xml = await fetchWithRetry(indexUrl, { retries: 1 });
      const subSitemaps = extractLocsFromXml(xml);

      if (subSitemaps.length === 0) continue;

      const productSitemaps = subSitemaps.filter((u) => /product/i.test(u));
      const sitemapsToUse = productSitemaps.length > 0 ? productSitemaps : subSitemaps;

      const productUrls = new Set();
      for (const sm of sitemapsToUse) {
        console.log(`  Fetching sub-sitemap: ${sm}`);
        await sleep(config.minDelayMs);
        const subXml = await fetchWithRetry(sm, { retries: 1 });
        const locs = extractLocsFromXml(subXml);
        for (const loc of locs) {
          if (/\/product\//.test(loc)) productUrls.add(loc.split('?')[0]);
        }
      }

      if (productUrls.size > 0) {
        return [...productUrls];
      }
    } catch (err) {
      console.log(`  Sitemap not usable at ${indexUrl}: ${err.message}`);
    }
  }

  return null;
}

async function discoverCategoryLinks() {
  console.log('Fetching homepage to find category links...');
  const html = await fetchWithRetry(config.baseUrl);
  const $ = cheerio.load(html);

  const categories = new Set();
  $('a[href*="/product-category/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) categories.add(href.split('?')[0].replace(/\/$/, '') + '/');
  });

  return [...categories];
}

async function discoverProductsFromCategory(categoryUrl) {
  const productUrls = new Set();
  let pageNum = 1;
  let consecutiveEmptyPages = 0;

  while (consecutiveEmptyPages < 1) {
    const pageUrl = pageNum === 1 ? categoryUrl : `${categoryUrl}page/${pageNum}/`;
    console.log(`  Crawling ${pageUrl}`);

    let html;
    try {
      await sleep(config.minDelayMs);
      html = await fetchWithRetry(pageUrl, { retries: 2 });
    } catch (err) {
      const status = err.response ? err.response.status : null;
      if (status === 404) break;
      console.warn(`  Failed to fetch ${pageUrl}: ${err.message}`);
      break;
    }

    const $ = cheerio.load(html);
    const foundOnPage = new Set();
    $('a[href*="/product/"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) foundOnPage.add(href.split('?')[0]);
    });

    const newOnes = [...foundOnPage].filter((u) => !productUrls.has(u));
    newOnes.forEach((u) => productUrls.add(u));

    if (foundOnPage.size === 0) {
      consecutiveEmptyPages++;
    } else {
      consecutiveEmptyPages = 0;
    }

    pageNum++;
    if (pageNum > 200) break;
  }

  return [...productUrls];
}

async function discoverViaCategoryCrawl() {
  const categories = await discoverCategoryLinks();
  console.log(`Found ${categories.length} category links.`);

  const allProductUrls = new Set();
  for (const cat of categories) {
    const urls = await discoverProductsFromCategory(cat);
    urls.forEach((u) => allProductUrls.add(u));
    console.log(`  -> ${urls.length} products in ${cat} (total so far: ${allProductUrls.size})`);
  }

  return [...allProductUrls];
}

async function main() {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });

  let urls = await tryDiscoverViaSitemap();

  if (!urls || urls.length === 0) {
    console.log('Sitemap approach found nothing usable. Falling back to category crawl.');
    urls = await discoverViaCategoryCrawl();
  } else {
    console.log(`Discovered ${urls.length} product URLs via sitemap.`);
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(urls, null, 2));
  console.log(`\nSaved ${urls.length} product URLs to ${OUT_FILE}`);
}

main().catch((err) => {
  console.error('Fatal error during discovery:', err);
  process.exit(1);
});
