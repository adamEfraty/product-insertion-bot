/**
 * Phase 3: reads scraped products and assigns each one to your real
 * WooCommerce categories (dutypharm.com) using an AI model.
 *
 * Provider: set AI_PROVIDER=openai (default), AI_PROVIDER=gemini, or
 * AI_PROVIDER=claude.
 * Requires OPENAI_API_KEY (default), GEMINI_API_KEY, or ANTHROPIC_API_KEY
 * depending on which provider you use.
 *
 * Input:  output/products-api.jsonl (preferred) or output/products.jsonl
 * Output: output/products-categorized.jsonl
 *         Each line = original product + a new "myCategories" field:
 *         [{ "id": 93, "name": "מגנזיום", "slug": "מגנזיום", "path": "תוספי תזונה > מינרלים > מגנזיום" }]
 *
 * Resumable — already-classified product URLs are tracked and skipped
 * on rerun.
 */
const fs = require('fs');
const path = require('path');
const pLimit = require('p-limit');

const PROVIDER = (process.env.AI_PROVIDER || 'openai').toLowerCase();
const PROVIDERS = {
  openai: './utils/openai',
  gemini: './utils/gemini',
  claude: './utils/claude',
};
if (!PROVIDERS[PROVIDER]) {
  console.error(`Unknown AI_PROVIDER "${PROVIDER}". Use one of: ${Object.keys(PROVIDERS).join(', ')}`);
  process.exit(1);
}
const { classifyProduct } = require(PROVIDERS[PROVIDER]);
console.log(`Using AI provider: ${PROVIDER}`);

const { getClassifiableCategories, getCategoryById } = require('./utils/categoryTree');

const API_PRODUCTS_FILE = path.join(__dirname, './output/products-api.jsonl');
const HTML_PRODUCTS_FILE = path.join(__dirname, './output/products.jsonl');
const OUT_FILE = path.join(__dirname, './output/products-categorized.jsonl');
const DONE_FILE = path.join(__dirname, './output/categorize-done-urls.json');

const CONCURRENCY = 3; // keep modest — this is hitting the Claude API per product

function loadJsonSafe(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function loadProducts() {
  let file;
  if (fs.existsSync(API_PRODUCTS_FILE)) {
    file = API_PRODUCTS_FILE;
  } else if (fs.existsSync(HTML_PRODUCTS_FILE)) {
    file = HTML_PRODUCTS_FILE;
  } else {
    console.error(
      `No product data found. Expected one of:\n  ${API_PRODUCTS_FILE}\n  ${HTML_PRODUCTS_FILE}\n` +
      `Run "npm run try-api" or "npm run scrape" first.`
    );
    process.exit(1);
  }

  console.log(`Reading products from ${file}`);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  return lines.map((l) => JSON.parse(l));
}

// Normalize the "identity" URL across the two possible product shapes
// (Store API objects use "permalink", HTML-scraped objects use "url").
function getProductUrl(product) {
  return product.permalink || product.url;
}

async function main() {
  const categories = getClassifiableCategories();
  console.log(`Loaded ${categories.length} classifiable categories.`);

  const products = loadProducts();
  console.log(`Loaded ${products.length} products.`);

  const doneUrls = new Set(loadJsonSafe(DONE_FILE, []));
  const remaining = products.filter((p) => !doneUrls.has(getProductUrl(p)));
  console.log(`Already categorized: ${doneUrls.size}. Remaining: ${remaining.length}.`);

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  const outStream = fs.createWriteStream(OUT_FILE, { flags: 'a' });

  const limit = pLimit(CONCURRENCY);
  let completed = 0;
  let failed = 0;

  const tasks = remaining.map((product) =>
    limit(async () => {
      const url = getProductUrl(product);
      try {
        const categoryIds = await classifyProduct(product, categories);
        const myCategories = categoryIds
          .map((id) => getCategoryById(id))
          .filter(Boolean)
          .map((c) => ({ id: c.id, name: c.name, slug: c.slug, path: c.path }));

        const enriched = { ...product, myCategories };
        outStream.write(JSON.stringify(enriched) + '\n');

        doneUrls.add(url);
        completed++;

        if (completed % 10 === 0) {
          fs.writeFileSync(DONE_FILE, JSON.stringify([...doneUrls]));
          console.log(`Progress: ${completed}/${remaining.length} categorized, ${failed} failed.`);
        }
      } catch (err) {
        failed++;
        console.error(`Failed to categorize: ${url} — ${err.message}`);
      }
    })
  );

  await Promise.all(tasks);

  fs.writeFileSync(DONE_FILE, JSON.stringify([...doneUrls]));
  outStream.end();

  console.log(`\nDone. Categorized ${completed} products (${failed} failures).`);
  console.log(`Output: ${OUT_FILE}`);
}

main().catch((err) => {
  console.error('Fatal error during categorization:', err);
  process.exit(1);
});
