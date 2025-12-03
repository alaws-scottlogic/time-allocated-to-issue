const fs = require('fs');
const path = require('path');
let redisClient = null;
try {
  const { createClient } = require('redis');
  if (process.env.REDIS_URL) {
    redisClient = createClient({ url: process.env.REDIS_URL });
    // connect now (promise)
    redisClient.connect().catch(() => { redisClient = null; });
  }
} catch (e) {
  // redis not installed or configured; ignore
}

const TOKEN_KEY = process.env.GOOGLE_OAUTH_TOKEN_KEY || 'google:oauth:tokens';
const FILE_PATH = path.join(__dirname, '..', 'credentials.json');
const PERSIST_TO_FILE = process.env.GOOGLE_PERSIST_TOKENS === 'true';

async function saveTokens(tokens) {
  if (redisClient) {
    try {
      await redisClient.set(TOKEN_KEY, JSON.stringify(tokens));
      return;
    } catch (e) { /* fall through to file fallback */ }
  }
  // Only persist to the local filesystem if explicitly enabled via env.
  if (PERSIST_TO_FILE) {
    try { fs.writeFileSync(FILE_PATH, JSON.stringify(tokens, null, 2)); } catch (e) { /* ignore */ }
  }
}

async function loadTokens() {
  if (redisClient) {
    try {
      const v = await redisClient.get(TOKEN_KEY);
      if (v) return JSON.parse(v);
    } catch (e) { /* fallback to file */ }
  }
  // Only attempt to load tokens from file if file persistence is enabled
  if (PERSIST_TO_FILE) {
    try {
      if (fs.existsSync(FILE_PATH)) return JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
    } catch (e) { /* ignore */ }
  }
  return null;
}

module.exports = { saveTokens, loadTokens };
