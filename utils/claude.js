const axios = require('axios');

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    '\nMissing ANTHROPIC_API_KEY environment variable.\n' +
    'Get a key from https://console.anthropic.com/ and set it, e.g.:\n' +
    '  export ANTHROPIC_API_KEY=sk-ant-...\n'
  );
  process.exit(1);
}

const client = axios.create({
  baseURL: API_URL,
  headers: {
    'x-api-key': process.env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  },
  timeout: 30000,
});

function buildCategoryListText(categories) {
  return categories
    .map((c) => `- id: ${c.id} | path: ${c.path}`)
    .join('\n');
}

// The Store API returns description/short_description as raw HTML with
// numeric HTML entities (e.g. "אייג&#8217;ינג" instead of "אייג'ינג").
// Strip tags and decode entities so the model sees clean text, not markup.
function cleanHtml(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')                        // strip tags
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code)) // numeric entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#8217;|&#8216;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#8211;|&#8212;/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildProductText(product) {
  const tabs = product.tabs || {};
  const description = cleanHtml(tabs.description || product.description || '');
  const shortDescription = cleanHtml(product.shortDescription || product.short_description || '');
  const ingredients = cleanHtml(tabs.ingredients || tabs.additional_information || '');
  const title = cleanHtml(product.title || product.name || '');

  // WooCommerce product attributes (e.g. a "Supplement Type" attribute with
  // terms like "Probiotics", "Collagen") are a strong, clean categorization
  // signal — much less noisy than parsing it out of the HTML description.
  const attributeTerms = (product.attributes || [])
    .flatMap((attr) => (attr.terms || []).map((t) => t.name))
    .filter(Boolean);

  return [
    `Title: ${title}`,
    shortDescription ? `Short description: ${shortDescription}` : null,
    description ? `Description: ${description}` : null,
    ingredients ? `Ingredients / additional info: ${ingredients}` : null,
    attributeTerms.length ? `Product attributes/tags: ${attributeTerms.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends one product + the full category list to Claude and gets back
 * the category IDs that best fit. Always forces at least one match.
 * Retries on transient failures / malformed JSON.
 */
async function classifyProduct(product, categories, { retries = 3 } = {}) {
  const categoryListText = buildCategoryListText(categories);
  const productText = buildProductText(product);

  const systemPrompt = `You are a product categorization assistant for a health, wellness, and pharmacy e-commerce store (dutypharm.com). Your job is to assign each product to the category or categories it best fits from the store's existing category tree.

Rules:
- Choose from the provided category list ONLY. Never invent a category.
- A product can belong to more than one category if genuinely relevant (e.g. a magnesium + melatonin combo product could fit both "Magnesium" and "Sleep & Anxiety").
- Always return at least one category — pick your best guess even if the fit is imperfect. Never return an empty list.
- Prefer the most specific applicable category (e.g. "Magnesium" over its parent "Minerals") but also include a broader parent category if the product doesn't cleanly fit any specific child category.
- Respond with ONLY a JSON object, no other text, no markdown code fences, in this exact shape:
{"categoryIds": [<id>, <id>, ...]}`;

  const userPrompt = `Category list (id | full path):
${categoryListText}

Product to classify:
${productText}

Respond with only the JSON object.`;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await client.post('', {
        model: MODEL,
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const textBlock = res.data.content.find((b) => b.type === 'text');
      if (!textBlock) throw new Error('No text block in Claude response');

      const cleaned = textBlock.text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned);

      if (!Array.isArray(parsed.categoryIds) || parsed.categoryIds.length === 0) {
        throw new Error('Model returned no categoryIds');
      }

      return parsed.categoryIds;
    } catch (err) {
      lastErr = err;
      const status = err.response ? err.response.status : null;
      const delay = 1500 * Math.pow(2, attempt);
      console.warn(
        `  [retry] classify failed for "${product.title || product.url}" ` +
        `(attempt ${attempt + 1}/${retries + 1}, ${status || err.message}). Waiting ${delay}ms...`
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

module.exports = { classifyProduct };
