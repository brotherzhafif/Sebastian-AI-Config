'use strict';

// ============================================================
// HERMES BRIDGE — Full Rewrite
// OpenAI-compatible API → Google Gemini
// ============================================================

const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const express = require('express');
require('dotenv').config();

// ============================================================
// CONFIG
// ============================================================
const PORT            = process.env.PORT || 9089;
const DEFAULT_MODEL   = 'gemini-2.5-flash';
const REQUEST_TIMEOUT = 10_000;   // ms per token attempt
const SESSION_TTL     = 20 * 60 * 1000; // 20 menit

// Model fallback chain — urut dari paling capable ke paling ringan
const MODEL_FALLBACK_CHAIN = [
  'gemini-2.5-flash',
  'gemini-3.5-flash',
  'gemini-flash-latest',
  'gemini-3-flash-preview',
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.1-flash-lite-preview',
  'gemini-flash-lite-latest',
];

// Alias: nama tidak resmi dari client → nama model yang ada
const MODEL_ALIASES = {
  'gemini-3-flash-live':   'gemini-flash-latest',
  'gemini-3.5-pro':        'gemini-2.5-flash',
  'gemini-2.5-pro':        'gemini-2.5-flash',
  'gemini-3.5-flash-lite': 'gemini-2.5-flash-lite',
  'gemini-flash':          'gemini-flash-latest',
  'gemini-flash-lite':     'gemini-flash-lite-latest',
};

function resolveModel(requested) {
  if (!requested) return DEFAULT_MODEL;
  if (MODEL_ALIASES[requested]) {
    const resolved = MODEL_ALIASES[requested];
    console.log(`🔄 Model alias: ${requested} → ${resolved}`);
    return resolved;
  }
  return requested;
}

// ============================================================
// PERSONA LOADER
// ============================================================
function loadPersona() {
  const files = [
    path.join(__dirname, 'SOUL.md'),
    path.join(__dirname, 'memories', 'MEMORY.md'),
    path.join(__dirname, 'memories', 'USER.md'),
  ];
  return files
    .map(f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } })
    .filter(Boolean)
    .join('\n\n---\n\n');
}

const PERSONA = loadPersona();
console.log(`🧠 Persona dimuat (${PERSONA.length} chars)`);

// ============================================================
// TOKEN POOL — auto-detect dari env, tanpa perlu edit manual
// ============================================================
function buildTokenPool() {
  const seen = new Set();
  const pool = [];

  const push = (val) => {
    if (!val) return;
    const v = val.trim();
    // Validasi: panjang masuk akal, bukan nama model, belum ada
    if (v.length > 25 && !v.toLowerCase().includes('gemini-') && !seen.has(v)) {
      seen.add(v);
      pool.push(v);
    }
  };

  // 1. Scan semua env key yang mengandung GEMINI / GOOGLE
  for (const [key, val] of Object.entries(process.env)) {
    if (/GEMINI|GOOGLE/i.test(key) && !/URL|HOST|MODEL/i.test(key)) {
      // Support koma-separated dalam satu variabel
      String(val).split(',').forEach(push);
    }
  }

  // 2. Fallback eksplisit kalau belum ada sama sekali
  if (pool.length === 0) {
    ['GEMINI_API_KEY', 'GOOGLE_API_KEY'].forEach(k => push(process.env[k]));
  }

  return pool;
}

const TOKEN_POOL = buildTokenPool();
if (TOKEN_POOL.length === 0) {
  console.error('❌ Tidak ada token API ditemukan di .env! Bridge tidak bisa berjalan.');
  process.exit(1);
}
console.log(`🔑 ${TOKEN_POOL.length} token terdeteksi:`);
TOKEN_POOL.forEach((t, i) =>
  console.log(`   [${i}] ${t.slice(0, 7)}...${t.slice(-4)}`)
);

// ============================================================
// SESSION MAP — sticky token per sesi chat
// ============================================================
const sessionMap = new Map(); // key → { tokenIndex, timer }

function getSessionIndex(key) {
  return sessionMap.get(key)?.tokenIndex ?? null;
}

function setSessionIndex(key, index) {
  const existing = sessionMap.get(key);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => sessionMap.delete(key), SESSION_TTL);
  sessionMap.set(key, { tokenIndex: index, timer });
}

// Pointer global round-robin (untuk sesi baru)
let globalIndex = 0;

// ============================================================
// SCHEMA SANITIZER — buang field yang Gemini tidak suka
// ============================================================
const BANNED_KEYS = new Set(['$comment', '$schema', 'enumDescriptions', 'additionalProperties']);

function sanitizeSchema(obj) {
  if (Array.isArray(obj)) return obj.map(sanitizeSchema);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!BANNED_KEYS.has(k)) out[k] = sanitizeSchema(v);
    }
    return out;
  }
  return obj;
}

// ============================================================
// PAYLOAD TRANSFORMER — OpenAI format → Gemini format
// ============================================================
function toGeminiPayload(body) {
  const messages = body.messages || [];
  const contents = [];

  let hasSystem = false;

  for (const msg of messages) {
    // Tool/function response
    if (msg.role === 'tool' || msg.role === 'function') {
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name: msg.name || 'terminal', response: { output: msg.content } } }],
      });
      continue;
    }

    // System prompt → inject persona
    if (msg.role === 'system') {
      hasSystem = true;
      const text = PERSONA ? `${PERSONA}\n\n---\n\n${msg.content || ''}` : (msg.content || '');
      contents.push({ role: 'user', parts: [{ text }] });
      continue;
    }

    const parts = [];
    if (msg.content) parts.push({ text: msg.content });

    // tool_calls dari riwayat asisten
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        let args = {};
        try { args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments; } catch {}
        parts.push({ functionCall: { name: tc.function.name, args } });
      }
    }

    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts,
    });
  }

  // Prepend persona kalau tidak ada system message
  if (!hasSystem && PERSONA) {
    contents.unshift({ role: 'user', parts: [{ text: PERSONA }] });
  }

  const payload = { contents };

  if (body.tools?.length) {
    payload.tools = [{
      functionDeclarations: body.tools.map(t => ({
        name: t.function.name,
        description: t.function.description || '',
        parameters: t.function.parameters ? sanitizeSchema(t.function.parameters) : undefined,
      })),
    }];
  }

  return JSON.stringify(payload);
}

// ============================================================
// GEMINI REQUEST — single attempt, fast-fail on 429/403
// ============================================================
function callGemini(body, apiKey, tokenIndex, model) {
  return new Promise((resolve, reject) => {
    const payload = toGeminiPayload(body);
    let done = false;

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${model}:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      // ⚡ Fast-fail: quota/auth langsung reject dari status HTTP
      if (res.statusCode === 429 || res.statusCode === 403) {
        done = true;
        req.destroy();
        return reject({ type: 'QUOTA', status: res.statusCode, index: tokenIndex });
      }

      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        if (done) return;
        try {
          const json = JSON.parse(raw);
          if (json.error) {
            const code    = json.error.code;
            const message = json.error.message || '';
            if (code === 429 || code === 403 || /quota/i.test(message)) {
              return reject({ type: 'QUOTA', message, index: tokenIndex });
            }
            // 404 atau pesan "not found / invalid" → model tidak valid
            if (code === 404 || /not found|invalid.*model|model.*not.*exist|unsupported/i.test(message)) {
              return reject({ type: 'API_ERROR', message, index: tokenIndex });
            }
            return reject({ type: 'API_ERROR', message, index: tokenIndex });
          }
          resolve(json);
        } catch (e) {
          reject({ type: 'PARSE_ERROR', message: e.message, index: tokenIndex });
        }
      });
    });

    // ⏱️ Timeout: jangan tunggu terlalu lama
    req.setTimeout(REQUEST_TIMEOUT, () => {
      done = true;
      req.destroy();
      reject({ type: 'TIMEOUT', index: tokenIndex });
    });

    req.on('error', e => {
      if (!done) reject({ type: 'NETWORK_ERROR', message: e.message, index: tokenIndex });
    });

    req.write(payload);
    req.end();
  });
}

// ============================================================
// SMART FALLBACK — race 2 token paralel + model fallback chain
// ============================================================

// Coba satu model dengan seluruh token pool (race 2 paralel)
async function tryModelWithPool(body, model, startIndex) {
  const total = TOKEN_POOL.length;
  let offset = 0;

  while (offset < total) {
    const indices = [];
    for (let i = 0; i < 2 && offset + i < total; i++) {
      indices.push((startIndex + offset + i) % total);
    }

    console.log(`⚡ Racing token [${indices.join(', ')}] untuk model ${model}`);

    const attempts = indices.map(idx =>
      callGemini(body, TOKEN_POOL[idx], idx, model).then(res => ({ res, idx }))
    );

    try {
      const winner = await Promise.any(attempts);
      console.log(`🏆 Token [${winner.idx}] menang dengan model ${model}`);
      return { ...winner, model };
    } catch (errs) {
      // Cek apakah gagal karena model tidak valid (bukan quota)
      // AggregateError berisi array errors dari setiap promise
      const errors = errs.errors || [];
      const isModelError = errors.some(e =>
        e?.type === 'API_ERROR' &&
        /not found|invalid|does not exist|unsupported/i.test(e?.message || '')
      );
      if (isModelError) {
        console.warn(`❌ Model "${model}" tidak valid di Gemini API, skip ke model berikutnya`);
        return null; // sinyal untuk coba model lain
      }

      console.warn(`⚠️  Semua token [${indices.join(', ')}] gagal, lanjut batch berikutnya...`);
      offset += indices.length;
    }
  }

  return null; // pool habis untuk model ini
}

// Iterasi model fallback chain
async function callWithFallback(body, requestedModel, startIndex) {
  // Bangun daftar model yang akan dicoba: model asli dulu, lalu chain
  const resolvedModel = resolveModel(requestedModel);
  const modelQueue = [
    resolvedModel,
    ...MODEL_FALLBACK_CHAIN.filter(m => m !== resolvedModel),
  ];

  for (const model of modelQueue) {
    const result = await tryModelWithPool(body, model, startIndex);
    if (result) return result;
    console.warn(`⚠️  Model "${model}" gagal total, coba model berikutnya...`);
  }

  throw new Error('POOL_EXHAUSTED');
}

// ============================================================
// RESPONSE BUILDER — translate Gemini response → OpenAI format
// ============================================================
function buildOpenAIResponse(geminiRes, chunkId, model, stream, res) {
  const candidate = geminiRes.candidates?.[0];
  const parts     = candidate?.content?.parts || [];
  const firstPart = parts[0];

  // Tool call response
  if (firstPart?.functionCall) {
    const toolCalls = parts
      .filter(p => p.functionCall)
      .map((p, i) => ({
        id: `call_${chunkId}_${i}`,
        type: 'function',
        function: {
          name: p.functionCall.name,
          arguments: JSON.stringify(p.functionCall.args || {}),
        },
      }));

    const payload = {
      id: chunkId,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: null, tool_calls: toolCalls },
        finish_reason: 'tool_calls',
      }],
    };

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.write(`data: ${JSON.stringify({ ...payload, object: 'chat.completion.chunk', choices: [{ index: 0, delta: payload.choices[0].message, finish_reason: 'tool_calls' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    return res.json(payload);
  }

  // Normal text response
  const text = parts.map(p => p.text || '').join('');

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const chunk = {
      id: chunkId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    res.write('data: [DONE]\n\n');
    return res.end();
  }

  return res.json({
    id: chunkId,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

function sendError(chunkId, model, message, stream, res) {
  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.write(`data: ${JSON.stringify({ id: chunkId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { content: message }, finish_reason: 'stop' }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    return res.end();
  }
  return res.json({
    id: chunkId, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, message: { role: 'assistant', content: message }, finish_reason: 'stop' }],
  });
}

// ============================================================
// MAIN HANDLER
// ============================================================
async function handleChat(req, res) {
  const body      = req.body;
  const messages  = body.messages || [];
  const stream    = body.stream === true;
  const model     = body.model || DEFAULT_MODEL;
  const maxTokens = body.max_tokens || 9999;
  const chunkId   = `chatcmpl-${Date.now()}`;

  if (!messages.length) {
    return res.json({ choices: [{ message: { role: 'assistant', content: 'Bridge aktif!' } }] });
  }

  // ── Intercept title generation (shallow request) ──────────
  const lastContent = String(messages.at(-1)?.content || '').toLowerCase();
  if (
    maxTokens <= 30 ||
    lastContent.includes('title') ||
    lastContent.includes('judul') ||
    lastContent.includes('summarize this session')
  ) {
    console.log('🤫 Intercept: title generation');
    return res.json({
      id: chunkId, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, message: { role: 'assistant', content: 'Sebastian Session' }, finish_reason: 'stop' }],
    });
  }

  // ── Session key → sticky token ────────────────────────────
  const sessionKey   = String(messages[0]?.content || '').slice(0, 60) || 'default';
  const cachedIndex  = getSessionIndex(sessionKey);
  const startIndex   = cachedIndex ?? globalIndex;

  if (cachedIndex === null) {
    console.log(`🆕 Sesi baru, mulai dari token [${startIndex}]`);
  } else {
    console.log(`📌 Sesi lanjut, token [${startIndex}]`);
  }

  try {
    const { res: geminiRes, idx: winnerIdx, model: usedModel } = await callWithFallback(body, model, startIndex);

    // Update sticky session & round-robin pointer
    setSessionIndex(sessionKey, winnerIdx);
    globalIndex = (winnerIdx + 1) % TOKEN_POOL.length;

    if (usedModel !== model) {
      console.log(`ℹ️  Response menggunakan model fallback: ${usedModel} (diminta: ${model})`);
    }

    return buildOpenAIResponse(geminiRes, chunkId, usedModel, stream, res);

  } catch (err) {
    console.error('🚨 Pool exhausted:', err.message);
    return sendError(chunkId, model, 'Tuan Zhafif, Sebastian Sedang Istirahat Karena Kelelahan', stream, res);
  }
}

// ============================================================
// EMBEDDINGS
// ============================================================
async function handleEmbeddings(req, res) {
  const input = req.body.input;
  const texts = Array.isArray(input) ? input : [input];

  for (let i = 0; i < TOKEN_POOL.length; i++) {
    const apiKey = TOKEN_POOL[(globalIndex + i) % TOKEN_POOL.length];
    try {
      const embeddings = await Promise.all(texts.map((text, idx) =>
        new Promise((resolve, reject) => {
          const payload = JSON.stringify({
            model: 'models/gemini-embedding-2',
            content: { parts: [{ text: String(text) }] },
          });
          const opts = {
            hostname: 'generativelanguage.googleapis.com',
            path: `/v1beta/models/gemini-embedding-2:embedContent?key=${apiKey}`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
          };
          let raw = '';
          const req = https.request(opts, r => {
            r.on('data', c => { raw += c; });
            r.on('end', () => {
              try {
                const json = JSON.parse(raw);
                if (json.error) return reject(json.error);
                resolve({ object: 'embedding', index: idx, embedding: json.embedding.values });
              } catch (e) { reject(e); }
            });
          });
          req.on('error', reject);
          req.write(payload);
          req.end();
        })
      ));

      globalIndex = (globalIndex + i + 1) % TOKEN_POOL.length;
      return res.json({ object: 'list', data: embeddings, model: 'gemini-embedding-2', usage: { prompt_tokens: 0, total_tokens: 0 } });
    } catch (err) {
      console.warn(`⚠️  Embedding token ke-${i} gagal:`, err.message || err);
    }
  }
  return res.status(500).json({ error: 'Embedding failed: semua token habis' });
}

// ============================================================
// EXPRESS APP
// ============================================================
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use((req, _, next) => { console.log(`→ [${req.method}] ${req.url}`); next(); });

const MODELS_LIST = {
  object: 'list',
  data: [
    { id: 'gemini-2.5-flash',              object: 'model', created: 1700000000, owned_by: 'google' },
    { id: 'gemini-3.5-flash',              object: 'model', created: 1700000000, owned_by: 'google' },
    { id: 'gemini-flash-latest',           object: 'model', created: 1700000000, owned_by: 'google' },
    { id: 'gemini-3-flash-preview',        object: 'model', created: 1700000000, owned_by: 'google' },
    { id: 'gemini-2.5-flash-lite',         object: 'model', created: 1700000000, owned_by: 'google' },
    { id: 'gemini-3.1-flash-lite',         object: 'model', created: 1700000000, owned_by: 'google' },
    { id: 'gemini-3.1-flash-lite-preview', object: 'model', created: 1700000000, owned_by: 'google' },
    { id: 'gemini-flash-lite-latest',      object: 'model', created: 1700000000, owned_by: 'google' },
  ],
};

app.post('/v1/chat/completions', handleChat);
app.post('/chat/completions',    handleChat);
app.post('/v1/embeddings',       handleEmbeddings);
app.get('/v1/models',            (_, res) => res.json(MODELS_LIST));
app.get('/models',               (_, res) => res.json(MODELS_LIST));

// Catch-all
app.use((req, res) => {
  if (req.method === 'POST') return handleChat(req, res);
  return res.json(MODELS_LIST);
});

app.listen(PORT, () =>
  console.log(`🚀 Hermes Bridge aktif di http://localhost:${PORT} | ${TOKEN_POOL.length} token | model default: ${DEFAULT_MODEL}`)
);