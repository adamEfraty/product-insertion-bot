const axios = require('axios');
const config = require('../config');

const client = axios.create({
  timeout: config.requestTimeoutMs,
  headers: {
    'User-Agent': config.userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'he,en;q=0.8',
  },
  validateStatus: (status) => status >= 200 && status < 400,
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch a URL with retries + exponential backoff.
 * Returns the response body as a string.
 */
async function fetchWithRetry(url, { retries = config.maxRetries } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await client.get(url);
      return res.data;
    } catch (err) {
      lastErr = err;
      const status = err.response ? err.response.status : null;

      // Don't retry on hard 404s - the page just doesn't exist.
      if (status === 404) throw err;

      const delay = config.retryBaseDelayMs * Math.pow(2, attempt);
      console.warn(
        `  [retry] ${url} failed (attempt ${attempt + 1}/${retries + 1}, status=${status || err.code}). Waiting ${delay}ms...`
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

module.exports = { fetchWithRetry, sleep };
