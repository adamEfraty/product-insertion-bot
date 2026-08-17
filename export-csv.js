/**
 * Converts a products JSONL file into a CSV for easy spreadsheet viewing.
 * Prefers the categorized output if it exists (includes your custom
 * "myCategories" column); falls back to raw scraped data otherwise.
 */
const fs = require('fs');
const path = require('path');

const CATEGORIZED_FILE = path.join(__dirname, './output/products-categorized.jsonl');
const API_FILE = path.join(__dirname, './output/products-api.jsonl');
const HTML_FILE = path.join(__dirname, './output/products.jsonl');
const CSV_FILE = path.join(__dirname, './output/products.csv');

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function cleanHtml(html) {
  if (!html) return '';
  return String(html)
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

// Store API prices are strings in minor currency units, e.g. "19000" with
// currency_minor_unit=2 means 190.00, not 19000.
function formatApiPrice(product, field) {
  const raw = product.prices && product.prices[field];
  if (raw === undefined || raw === null || raw === '') return '';
  const minorUnit = (product.prices && product.prices.currency_minor_unit) || 2;
  const value = Number(raw) / Math.pow(10, minorUnit);
  const symbol = (product.prices && product.prices.currency_symbol) || '';
  return `${value.toFixed(minorUnit)} ${symbol}`.trim();
}

function pickInputFile() {
  if (fs.existsSync(CATEGORIZED_FILE)) return CATEGORIZED_FILE;
  if (fs.existsSync(API_FILE)) return API_FILE;
  if (fs.existsSync(HTML_FILE)) return HTML_FILE;
  return null;
}

function main() {
  const inputFile = pickInputFile();
  if (!inputFile) {
    console.error('No products file found. Run try-api/scrape (and optionally categorize) first.');
    process.exit(1);
  }
  console.log(`Reading from ${inputFile}`);

  const lines = fs.readFileSync(inputFile, 'utf8').trim().split('\n').filter(Boolean);
  const products = lines.map((l) => JSON.parse(l));

  const hasMyCategories = products.some((p) => p.myCategories);
  const isApiShape = products.some((p) => p.regular_price !== undefined);

  const headers = ['url', 'title', 'sku', 'categories'];
  if (hasMyCategories) headers.push('myCategories');
  headers.push('regularPrice', 'salePrice', 'onSale', 'availability', 'shortDescription', 'description', 'images');

  const rows = [headers.join(',')];

  for (const p of products) {
    const url = p.permalink || p.url;
    const title = cleanHtml(p.name || p.title);
    const sku = p.sku;
    const categories = isApiShape
      ? (p.categories || []).map((c) => c.name).join('; ')
      : (p.categories || []).join('; ');
    const regularPrice = isApiShape ? formatApiPrice(p, 'regular_price') : p.price?.regularPrice;
    const salePrice = isApiShape ? formatApiPrice(p, 'sale_price') : p.price?.salePrice;
    const onSale = isApiShape ? p.on_sale : p.price?.onSale;
    const availability = isApiShape
      ? (p.stock_availability?.text || (p.is_in_stock ? 'In stock' : 'Out of stock'))
      : p.availability;
    const shortDescription = cleanHtml(p.short_description || p.shortDescription);
    const description = isApiShape ? cleanHtml(p.description) : cleanHtml(p.tabs ? p.tabs.description : '');
    const images = isApiShape
      ? (p.images || []).map((i) => i.src).join('; ')
      : (p.images || []).join('; ');

    const row = [url, title, sku, categories];
    if (hasMyCategories) {
      row.push((p.myCategories || []).map((c) => c.path || c.name).join('; '));
    }
    row.push(regularPrice, salePrice, onSale, availability, shortDescription, description, images);

    rows.push(row.map(csvEscape).join(','));
  }

  fs.writeFileSync(CSV_FILE, rows.join('\n'), 'utf8');
  console.log(`Wrote ${products.length} rows to ${CSV_FILE}`);
}

main();
