const axios = require('axios');

const MODEL = process.env.OPENAI_MODEL || 'gpt-5.1';
const API_URL = 'https://api.openai.com/v1/chat/completions';

if (!process.env.OPENAI_API_KEY) {
  console.error(
    '\nMissing OPENAI_API_KEY environment variable.\n' +
    'Get a key from https://platform.openai.com/api-keys and set it, e.g.:\n' +
    '  export OPENAI_API_KEY=sk-...\n'
  );
  process.exit(1);
}

const client = axios.create({
  baseURL: API_URL,
  headers: {
    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
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

// OpenAI structured outputs (strict mode) require every property to be
// listed in "required" and additionalProperties: false at every level.
const RESPONSE_SCHEMA = {
  name: 'category_classification',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      categoryIds: {
        type: 'array',
        items: { type: 'integer' },
        description: 'IDs of every category from the provided list that fits this product. Always at least one.',
      },
    },
    required: ['categoryIds'],
    additionalProperties: false,
  },
};

/**
 * Sends one product + the full category list to OpenAI and gets back
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
- Prefer the most specific applicable category (e.g. "Magnesium" over its parent "Minerals") but also include a broader parent category if the product doesn't cleanly fit any specific child category.`;

  const userPrompt = `Category list (id | full path):
${categoryListText}

Product to classify:
${productText}`;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await client.post('', {
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: RESPONSE_SCHEMA,
        },
        max_completion_tokens: 500,
      });

      const message = res.data.choices && res.data.choices[0] && res.data.choices[0].message;
      if (!message || !message.content) throw new Error('No content in OpenAI response');

      const parsed = JSON.parse(message.content);

      if (!Array.isArray(parsed.categoryIds) || parsed.categoryIds.length === 0) {
        throw new Error('Model returned no categoryIds');
      }

      return parsed.categoryIds;
    } catch (err) {
      lastErr = err;
      const status = err.response ? err.response.status : null;
      const body = err.response ? err.response.data : null;
      const errType = body && body.error ? body.error.type : null;
      const errCode = body && body.error ? body.error.code : null;

      // insufficient_quota / billing issues will never succeed on retry —
      // fail fast with a clear message instead of burning through attempts.
      if (status === 429 && (errType === 'insufficient_quota' || errCode === 'insufficient_quota')) {
        console.error(
          `\nOpenAI billing/quota error (insufficient_quota). Retrying won't help.\n` +
          `Check https://platform.openai.com/settings/organization/billing — ` +
          `you likely need to add a payment method or increase your usage limit.\n` +
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
