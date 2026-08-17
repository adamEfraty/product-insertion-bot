module.exports = {
  baseUrl: 'https://marshal.co.il',

  // Be polite: keep concurrency low and add delay between requests.
  // Bump these up only if you've confirmed the site is fine with it.
  concurrency: 3,
  minDelayMs: 400,   // minimum delay between request starts (per worker)
  maxRetries: 3,
  retryBaseDelayMs: 1000,
  requestTimeoutMs: 20000,

  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 MarshalCatalogBot/1.0 (+contact: you@example.com)',

  paths: {
    urlsFile: './output/product-urls.json',
    productsFile: './output/products.jsonl', // JSON Lines: one product per line, append-friendly
    doneUrlsFile: './output/done-urls.json',  // tracks completed URLs for resume
    csvFile: './output/products.csv',
  },
};
