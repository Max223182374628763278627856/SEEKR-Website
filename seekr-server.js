// ============================================================
// SEEKR BACKEND v1.0 — Moteur de recherche IA souverain
// Node.js + Express | Sécurisé | Universel
// Déploiement: Render.com (Web Service)
// ============================================================

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================================
// BASE DE DONNÉES SQLite (persistante sur Render.com via disk)
// ============================================================
const DB_PATH = process.env.DB_PATH || './seekr.db';
const db = new Database(DB_PATH);

// Activer WAL pour performances + sécurité
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Création des tables
db.exec(`
  CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    domain TEXT NOT NULL UNIQUE,
    api_key TEXT NOT NULL UNIQUE,
    api_key_hash TEXT NOT NULL,
    platform TEXT DEFAULT 'html',
    settings TEXT DEFAULT '{}',
    created_at INTEGER DEFAULT (unixepoch()),
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    external_id TEXT,
    name TEXT NOT NULL,
    description TEXT,
    price REAL,
    currency TEXT DEFAULT 'EUR',
    category TEXT,
    tags TEXT,
    image_url TEXT,
    product_url TEXT,
    stock INTEGER DEFAULT 1,
    metadata TEXT DEFAULT '{}',
    updated_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (site_id) REFERENCES sites(id)
  );

  CREATE TABLE IF NOT EXISTS searches (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    query TEXT NOT NULL,
    query_normalized TEXT,
    intent TEXT,
    intent_score REAL,
    results_count INTEGER DEFAULT 0,
    response_ms INTEGER,
    timestamp INTEGER DEFAULT (unixepoch()),
    ip_hash TEXT,
    user_agent_hash TEXT
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    search_id TEXT,
    type TEXT NOT NULL,
    product_id TEXT,
    value REAL,
    metadata TEXT DEFAULT '{}',
    timestamp INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    started_at INTEGER DEFAULT (unixepoch()),
    last_seen INTEGER DEFAULT (unixepoch()),
    search_count INTEGER DEFAULT 0,
    converted INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    created_at INTEGER DEFAULT (unixepoch()),
    last_login INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_searches_site ON searches(site_id);
  CREATE INDEX IF NOT EXISTS idx_searches_ts ON searches(timestamp);
  CREATE INDEX IF NOT EXISTS idx_events_site ON events(site_id);
  CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
  CREATE INDEX IF NOT EXISTS idx_products_site ON products(site_id);
  CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
`);

// ============================================================
// SÉCURITÉ — Middlewares
// ============================================================

// Helmet: headers de sécurité HTTP
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS: autoriser seulement les domaines enregistrés
app.use(cors({
  origin: (origin, callback) => {
    // Autoriser les requêtes sans origin (Postman, mobile apps)
    if (!origin) return callback(null, true);
    // Autoriser le dashboard
    if (process.env.DASHBOARD_URL && origin === process.env.DASHBOARD_URL) return callback(null, true);
    // Vérifier si le domaine est enregistré
    const site = db.prepare('SELECT id FROM sites WHERE domain = ? AND active = 1').get(
      origin.replace(/^https?:\/\//, '').replace(/\/$/, '').split('/')[0]
    );
    if (site) return callback(null, true);
    // En dev, autoriser localhost
    if (process.env.NODE_ENV !== 'production' && origin.includes('localhost')) return callback(null, true);
    callback(new Error('Domaine non autorisé par SEEKR'));
  },
  credentials: true
}));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Rate Limiting — Anti-abus
const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,             // 60 recherches/min par IP (largement suffisant)
  message: { error: 'Trop de requêtes. Réessayez dans un moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { error: 'Limite API atteinte.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // 10 tentatives de connexion max / 15min
  message: { error: 'Trop de tentatives de connexion.' }
});

// ============================================================
// HELPERS
// ============================================================

function hashIp(ip) {
  return crypto.createHash('sha256').update(ip + process.env.HASH_SALT || 'seekr_salt').digest('hex').slice(0, 16);
}

function generateApiKey() {
  return 'sk_seekr_live_' + crypto.randomBytes(24).toString('hex');
}

function verifyApiKey(req, res, next) {
  const key = req.headers['x-seekr-key'] || req.query.key;
  if (!key) return res.status(401).json({ error: 'Clé API manquante' });

  const site = db.prepare('SELECT * FROM sites WHERE api_key = ? AND active = 1').get(key);
  if (!site) return res.status(403).json({ error: 'Clé API invalide' });

  req.site = site;
  next();
}

function verifyJWT(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token manquant' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'seekr_jwt_secret_change_me');
    next();
  } catch {
    res.status(403).json({ error: 'Token invalide ou expiré' });
  }
}

// ============================================================
// MOTEUR DE RECHERCHE IA — Analyse sémantique
// ============================================================

const INTENT_PATTERNS = {
  buy: [/pas\s*cher/i,/promo/i,/solde/i,/acheter/i,/commander/i,/moins\s*de\s*\d/i,/€/,/prix/i,/offre/i,/livraison/i,/taille\s*\d/i,/pointure/i,/disponible/i],
  compare: [/vs\b/i,/ou\b.*\bou\b/i,/compar/i,/meilleur/i,/différence/i,/entre.*et/i,/quel.*choisir/i,/avis/i,/test/i,/top\s*\d/i],
  info: [/qu['']est/i,/comment/i,/pourquoi/i,/c'est quoi/i,/définition/i,/signif/i,/explication/i,/guide/i,/conseil/i],
  browse: [] // défaut
};

const STOP_WORDS = new Set(['le','la','les','un','une','des','de','du','et','en','pour','sur','avec','dans','par','au','aux','ce','ces','mon','ma','mes','son','sa','ses','leur','leurs','qui','que','quoi','dont','où','je','tu','il','elle','nous','vous','ils','elles','très','plus','moins','bien','aussi','tout','tous']);

function normalizeQuery(query) {
  return query
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // supprime accents
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractKeywords(query) {
  const normalized = normalizeQuery(query);
  return normalized.split(' ').filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function detectIntent(query) {
  const q = query.toLowerCase();
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    if (intent === 'browse') continue;
    const score = patterns.filter(p => p.test(q)).length;
    if (score > 0) return { intent, score: Math.min(0.5 + score * 0.2, 1.0) };
  }
  return { intent: 'browse', score: 0.5 };
}

function correctTypo(word, vocabulary) {
  if (vocabulary.has(word)) return word;
  let best = word, bestDist = 3;
  for (const v of vocabulary) {
    const d = levenshtein(word, v);
    if (d < bestDist) { best = v; bestDist = d; }
  }
  return best;
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({length: m+1}, (_,i) => Array.from({length: n+1}, (_,j) => i ? (j ? 0 : i) : j));
  for (let i=1;i<=m;i++) for (let j=1;j<=n;j++)
    dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
  return dp[m][n];
}

function scoreProduct(product, keywords, query) {
  const text = `${product.name} ${product.description || ''} ${product.category || ''} ${product.tags || ''}`.toLowerCase();
  const textNorm = normalizeQuery(text);
  let score = 0;

  for (const kw of keywords) {
    if (textNorm.includes(kw)) score += 10;
    if (normalizeQuery(product.name).includes(kw)) score += 15; // bonus nom exact
    // correspondance partielle (préfixe)
    if (textNorm.split(' ').some(w => w.startsWith(kw) && kw.length >= 3)) score += 5;
  }

  // bonus stock
  if (product.stock > 0) score += 2;

  // bonus popularité simulée (améliorable avec vraies données)
  score += Math.min(product.popularity || 0, 20);

  return Math.min(Math.round(score), 100);
}

function searchProducts(siteId, query, limit = 10) {
  const start = Date.now();
  const keywords = extractKeywords(query);
  const { intent, score: intentScore } = detectIntent(query);

  if (keywords.length === 0) {
    return { results: [], intent, intentScore, ms: Date.now() - start };
  }

  // Récupération produits du site
  const products = db.prepare('SELECT * FROM products WHERE site_id = ? AND stock > 0').all(siteId);

  // Scoring
  const scored = products
    .map(p => ({ ...p, _score: scoreProduct(p, keywords, query) }))
    .filter(p => p._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, limit);

  return {
    results: scored.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      price: p.price,
      currency: p.currency,
      category: p.category,
      image_url: p.image_url,
      product_url: p.product_url,
      score: p._score,
      stock: p.stock > 0
    })),
    intent,
    intentScore,
    keywords,
    ms: Date.now() - start
  };
}

// ============================================================
// ROUTES — AUTH
// ============================================================

// Créer le premier compte admin (setup initial)
app.post('/api/auth/setup', async (req, res) => {
  const existing = db.prepare('SELECT id FROM users LIMIT 1').get();
  if (existing) return res.status(403).json({ error: 'Setup déjà effectué' });

  const { email, password } = req.body;
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'Email et mot de passe requis (min 8 chars)' });
  }

  const hash = await bcrypt.hash(password, 12);
  const id = uuidv4();
  db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(id, email, hash);

  res.json({ success: true, message: 'Compte admin créé. Connectez-vous.' });
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Champs manquants' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(401).json({ error: 'Identifiants incorrects' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Identifiants incorrects' });

  db.prepare('UPDATE users SET last_login = unixepoch() WHERE id = ?').run(user.id);

  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET || 'seekr_jwt_secret_change_me',
    { expiresIn: '24h' }
  );

  res.json({ token, user: { email: user.email, role: user.role } });
});

// ============================================================
// ROUTES — SITES (Dashboard)
// ============================================================

app.get('/api/sites', verifyJWT, (req, res) => {
  const sites = db.prepare('SELECT id, name, domain, api_key, platform, created_at FROM sites WHERE active = 1').all();
  res.json(sites);
});

app.post('/api/sites', verifyJWT, (req, res) => {
  const { name, domain, platform } = req.body;
  if (!name || !domain) return res.status(400).json({ error: 'Nom et domaine requis' });

  const clean = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const existing = db.prepare('SELECT id FROM sites WHERE domain = ?').get(clean);
  if (existing) return res.status(409).json({ error: 'Domaine déjà enregistré' });

  const id = uuidv4();
  const apiKey = generateApiKey();
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

  db.prepare(`INSERT INTO sites (id, name, domain, api_key, api_key_hash, platform)
    VALUES (?, ?, ?, ?, ?, ?)`).run(id, name, clean, apiKey, keyHash, platform || 'html');

  res.json({ id, name, domain: clean, api_key: apiKey, platform: platform || 'html' });
});

app.delete('/api/sites/:id', verifyJWT, (req, res) => {
  db.prepare('UPDATE sites SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ============================================================
// ROUTES — PRODUITS (import universel)
// ============================================================

// Import JSON/CSV de produits
app.post('/api/products/import', verifyJWT, apiLimiter, (req, res) => {
  const { site_id, products } = req.body;
  if (!site_id || !Array.isArray(products)) return res.status(400).json({ error: 'site_id et products[] requis' });

  const site = db.prepare('SELECT id FROM sites WHERE id = ? AND active = 1').get(site_id);
  if (!site) return res.status(404).json({ error: 'Site non trouvé' });

  const insert = db.prepare(`
    INSERT OR REPLACE INTO products (id, site_id, external_id, name, description, price, currency, category, tags, image_url, product_url, stock, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const importMany = db.transaction((prods) => {
    let count = 0;
    for (const p of prods) {
      if (!p.name) continue;
      insert.run(
        p.id || uuidv4(),
        site_id,
        p.external_id || p.id || null,
        String(p.name).slice(0, 500),
        p.description ? String(p.description).slice(0, 2000) : null,
        p.price ? parseFloat(p.price) : null,
        p.currency || 'EUR',
        p.category ? String(p.category).slice(0, 200) : null,
        p.tags ? String(p.tags).slice(0, 500) : null,
        p.image_url || null,
        p.product_url || null,
        p.stock !== undefined ? parseInt(p.stock) : 1,
        JSON.stringify(p.metadata || {})
      );
      count++;
    }
    return count;
  });

  const count = importMany(products);
  res.json({ success: true, imported: count });
});

// Import depuis Shopify
app.post('/api/products/import/shopify', verifyJWT, async (req, res) => {
  const { site_id, shopify_store, shopify_token } = req.body;
  if (!site_id || !shopify_store || !shopify_token) {
    return res.status(400).json({ error: 'site_id, shopify_store et shopify_token requis' });
  }

  try {
    const fetch = (await import('node-fetch')).default;
    const url = `https://${shopify_store}/admin/api/2024-01/products.json?limit=250`;
    const resp = await fetch(url, { headers: { 'X-Shopify-Access-Token': shopify_token } });
    if (!resp.ok) return res.status(400).json({ error: 'Erreur Shopify API' });

    const data = await resp.json();
    const products = data.products.flatMap(p =>
      p.variants.map(v => ({
        id: uuidv4(),
        external_id: String(v.id),
        name: p.variants.length > 1 ? `${p.title} — ${v.title}` : p.title,
        description: p.body_html?.replace(/<[^>]+>/g,'').slice(0,2000),
        price: parseFloat(v.price),
        currency: 'EUR',
        category: p.product_type || p.tags?.split(',')[0]?.trim(),
        tags: p.tags,
        image_url: p.images?.[0]?.src,
        product_url: `https://${shopify_store}/products/${p.handle}`,
        stock: v.inventory_quantity > 0 ? v.inventory_quantity : 0
      }))
    );

    req.body.products = products;
    // Réutiliser l'import générique
    const insert = db.prepare(`INSERT OR REPLACE INTO products (id, site_id, external_id, name, description, price, currency, category, tags, image_url, product_url, stock) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    const count = db.transaction(ps => { ps.forEach(p => insert.run(p.id, site_id, p.external_id, p.name, p.description, p.price, p.currency, p.category, p.tags, p.image_url, p.product_url, p.stock)); return ps.length; })(products);

    res.json({ success: true, imported: count });
  } catch (e) {
    res.status(500).json({ error: 'Erreur import Shopify: ' + e.message });
  }
});

// Import WooCommerce
app.post('/api/products/import/woocommerce', verifyJWT, async (req, res) => {
  const { site_id, store_url, consumer_key, consumer_secret } = req.body;
  if (!site_id || !store_url || !consumer_key || !consumer_secret) {
    return res.status(400).json({ error: 'Paramètres WooCommerce manquants' });
  }

  try {
    const fetch = (await import('node-fetch')).default;
    const auth = Buffer.from(`${consumer_key}:${consumer_secret}`).toString('base64');
    const url = `${store_url}/wp-json/wc/v3/products?per_page=100&status=publish`;
    const resp = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (!resp.ok) return res.status(400).json({ error: 'Erreur WooCommerce API' });

    const wooProducts = await resp.json();
    const insert = db.prepare(`INSERT OR REPLACE INTO products (id, site_id, external_id, name, description, price, currency, category, image_url, product_url, stock) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    const count = db.transaction(ps => {
      ps.forEach(p => insert.run(
        uuidv4(), site_id, String(p.id),
        p.name, p.short_description?.replace(/<[^>]+>/g,'').slice(0,2000) || p.description?.replace(/<[^>]+>/g,'').slice(0,500),
        parseFloat(p.price) || 0, 'EUR',
        p.categories?.[0]?.name || null,
        p.images?.[0]?.src || null,
        p.permalink, p.stock_quantity || 1
      ));
      return ps.length;
    })(wooProducts);

    res.json({ success: true, imported: count });
  } catch (e) {
    res.status(500).json({ error: 'Erreur WooCommerce: ' + e.message });
  }
});

app.get('/api/products/:siteId', verifyJWT, (req, res) => {
  const products = db.prepare('SELECT * FROM products WHERE site_id = ?').all(req.params.siteId);
  res.json(products);
});

app.delete('/api/products/:id', verifyJWT, (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ============================================================
// ROUTES — RECHERCHE (Widget public)
// ============================================================

app.post('/api/search', searchLimiter, verifyApiKey, (req, res) => {
  const { query, session_id, limit = 10 } = req.body;

  if (!query || typeof query !== 'string' || query.length < 1 || query.length > 500) {
    return res.status(400).json({ error: 'Requête invalide' });
  }

  const sid = session_id || uuidv4();
  const ipHash = hashIp(req.ip || '');

  // Upsert session
  db.prepare(`INSERT OR IGNORE INTO sessions (id, site_id) VALUES (?, ?)`)
    .run(sid, req.site.id);
  db.prepare(`UPDATE sessions SET last_seen = unixepoch(), search_count = search_count + 1 WHERE id = ?`)
    .run(sid);

  // Recherche IA
  const { results, intent, intentScore, keywords, ms } = searchProducts(req.site.id, query, Math.min(limit, 20));

  // Log recherche
  const searchId = uuidv4();
  db.prepare(`INSERT INTO searches (id, site_id, session_id, query, query_normalized, intent, intent_score, results_count, response_ms, ip_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(searchId, req.site.id, sid, query, normalizeQuery(query), intent, intentScore, results.length, ms, ipHash);

  res.json({
    search_id: searchId,
    session_id: sid,
    query,
    intent,
    intent_score: intentScore,
    keywords,
    results,
    total: results.length,
    ms
  });
});

// Suggestions (autocomplete)
app.get('/api/suggest', searchLimiter, verifyApiKey, (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json({ suggestions: [] });

  const norm = normalizeQuery(q);
  const products = db.prepare(`
    SELECT DISTINCT name, category FROM products 
    WHERE site_id = ? AND (
      LOWER(name) LIKE ? OR LOWER(category) LIKE ? OR LOWER(tags) LIKE ?
    ) LIMIT 8
  `).all(req.site.id, `%${norm}%`, `%${norm}%`, `%${norm}%`);

  const suggestions = [...new Set(products.map(p => p.name))].slice(0, 5);
  res.json({ suggestions });
});

// ============================================================
// ROUTES — TRACKING (Events)
// ============================================================

app.post('/api/track', searchLimiter, verifyApiKey, (req, res) => {
  const { session_id, search_id, type, product_id, value } = req.body;

  const ALLOWED_TYPES = ['click', 'add_to_cart', 'purchase', 'page_view', 'search_no_result'];
  if (!type || !ALLOWED_TYPES.includes(type)) {
    return res.status(400).json({ error: 'Type d\'événement invalide' });
  }

  const sid = session_id || uuidv4();

  db.prepare(`INSERT INTO events (id, site_id, session_id, search_id, type, product_id, value)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(uuidv4(), req.site.id, sid, search_id || null, type, product_id || null, value || null);

  // Marquer session comme convertie si achat
  if (type === 'purchase') {
    db.prepare('UPDATE sessions SET converted = 1 WHERE id = ?').run(sid);
  }

  res.json({ success: true });
});

// ============================================================
// ROUTES — ANALYTICS (Dashboard)
// ============================================================

app.get('/api/analytics/:siteId', verifyJWT, (req, res) => {
  const { siteId } = req.params;
  const { period = '7d' } = req.query;

  const periods = { '24h': 86400, '7d': 604800, '30d': 2592000, '90d': 7776000 };
  const since = Math.floor(Date.now() / 1000) - (periods[period] || 604800);

  // Métriques globales
  const totalSearches = db.prepare('SELECT COUNT(*) as c FROM searches WHERE site_id = ? AND timestamp > ?').get(siteId, since).c;
  const totalSessions = db.prepare('SELECT COUNT(DISTINCT session_id) as c FROM searches WHERE site_id = ? AND timestamp > ?').get(siteId, since).c;
  const conversions = db.prepare('SELECT COUNT(*) as c FROM sessions WHERE site_id = ? AND converted = 1 AND started_at > ?').get(siteId, since).c;
  const conversionRate = totalSessions > 0 ? ((conversions / totalSessions) * 100).toFixed(1) : 0;

  const buyIntentSearches = db.prepare('SELECT COUNT(*) as c FROM searches WHERE site_id = ? AND intent = "buy" AND timestamp > ?').get(siteId, since).c;
  const intentRate = totalSearches > 0 ? ((buyIntentSearches / totalSearches) * 100).toFixed(1) : 0;

  const avgResponse = db.prepare('SELECT AVG(response_ms) as avg FROM searches WHERE site_id = ? AND timestamp > ?').get(siteId, since).avg || 0;

  // Top requêtes
  const topQueries = db.prepare(`
    SELECT query_normalized as query, COUNT(*) as count, 
    AVG(intent_score) as avg_score, intent
    FROM searches WHERE site_id = ? AND timestamp > ?
    GROUP BY query_normalized ORDER BY count DESC LIMIT 20
  `).all(siteId, since);

  // Distribution intentions
  const intentDist = db.prepare(`
    SELECT intent, COUNT(*) as count FROM searches 
    WHERE site_id = ? AND timestamp > ? GROUP BY intent
  `).all(siteId, since);

  // Évolution journalière
  const daily = db.prepare(`
    SELECT date(timestamp, 'unixepoch') as day,
    COUNT(*) as searches,
    SUM(CASE WHEN intent = 'buy' THEN 1 ELSE 0 END) as buy_intent
    FROM searches WHERE site_id = ? AND timestamp > ?
    GROUP BY day ORDER BY day
  `).all(siteId, since);

  // Top produits cliqués
  const topProducts = db.prepare(`
    SELECT p.name, p.price, p.category, COUNT(e.id) as clicks
    FROM events e JOIN products p ON e.product_id = p.id
    WHERE e.site_id = ? AND e.type = 'click' AND e.timestamp > ?
    GROUP BY p.id ORDER BY clicks DESC LIMIT 10
  `).all(siteId, since);

  // Recherches sans résultat
  const noResults = db.prepare(`
    SELECT query, COUNT(*) as count FROM searches 
    WHERE site_id = ? AND results_count = 0 AND timestamp > ?
    GROUP BY query ORDER BY count DESC LIMIT 10
  `).all(siteId, since);

  res.json({
    period,
    metrics: {
      total_searches: totalSearches,
      total_sessions: totalSessions,
      conversion_rate: parseFloat(conversionRate),
      buy_intent_rate: parseFloat(intentRate),
      avg_response_ms: Math.round(avgResponse)
    },
    top_queries: topQueries,
    intent_distribution: intentDist,
    daily_data: daily,
    top_products: topProducts,
    no_results_queries: noResults
  });
});

// Live feed (dernières recherches)
app.get('/api/analytics/:siteId/live', verifyJWT, (req, res) => {
  const recent = db.prepare(`
    SELECT query, intent, results_count, response_ms, timestamp
    FROM searches WHERE site_id = ?
    ORDER BY timestamp DESC LIMIT 20
  `).all(req.params.siteId);
  res.json(recent);
});

// ============================================================
// ROUTES — HEALTH CHECK
// ============================================================

app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', time: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({ service: 'SEEKR API', version: '1.0.0', docs: '/health' });
});

// ============================================================
// DÉMARRAGE
// ============================================================

app.listen(PORT, () => {
  console.log(`✅ SEEKR Backend démarré sur le port ${PORT}`);
  console.log(`🔒 Mode: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🗄️  DB: ${DB_PATH}`);
});

module.exports = app;
