const axios = require('axios');

const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const API_URL = 'https://api.groq.com/openai/v1/chat/completions';

if (!process.env.GROQ_API_KEY) {
  console.error(
    '\nMissing GROQ_API_KEY environment variable.\n' +
    'Get a key from https://console.groq.com/keys and set it, e.g.:\n' +
    '  export GROQ_API_KEY=gsk_...\n'
  );
  process.exit(1);
}

const client = axios.create({
  baseURL: API_URL,
  headers: {
    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
    'Content-Type': 'application/json',
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
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code))
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
 * Sends one product + the full category list to Groq and gets back
 * the category IDs that best fit. Always forces at least one match.
 * Retries on transient failures / malformed JSON.
 *
 * Uses Groq's "json_object" response mode (broadly supported across
 * models) rather than strict json_schema mode, which is currently only
 * available on a handful of Groq models — json_object + explicit prompt
 * instructions is the more portable choice here.
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

Respond with only the JSON object described in the system instructions.`;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await client.post('', {
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 500,
        temperature: 0.2,
      });

      const message = res.data.choices && res.data.choices[0] && res.data.choices[0].message;
      if (!message || !message.content) throw new Error('No content in Groq response');

      const cleaned = message.content.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned);

      if (!Array.isArray(parsed.categoryIds) || parsed.categoryIds.length === 0) {
        throw new Error('Model returned no categoryIds');
      }

      return parsed.categoryIds;
    } catch (err) {
      lastErr = err;
      const status = err.response ? err.response.status : null;
      const body = err.response ? err.response.data : null;
      const errType = body && body.error ? body.error.type || body.error.code : null;

      // A quota/billing error will never succeed on retry — fail fast.
      if (status === 429 && errType && /quota|credit|balance/i.test(errType)) {
        console.error(
          `\nGroq billing/quota error. Retrying won't help.\n` +
          `Check https://console.groq.com/settings/billing\n` +
          `Full error: ${JSON.stringify(body)}\n`
        );
        throw err;
      }

      const delay = 1500 * Math.pow(2, attempt);
      console.warn(
        `  [retry] classify failed for "${product.title || product.name || product.url}" ` +
        `(attempt ${attempt + 1}/${retries + 1}, status=${status}, type=${errType || 'unknown'}). ` +
        `Body: ${body ? JSON.stringify(body) : err.message}. Waiting ${delay}ms...`
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

module.exports = { classifyProduct };
