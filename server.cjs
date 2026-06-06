'use strict';

// ============================================================
// HERMES BRIDGE v10.1 (Supabase + Dozzle Optimized)
// OpenAI-compatible API → Google Gemini
// + Token Compression + Remote Logging + Live Dozzle Stream
// ============================================================

const fs = require('fs');
const path = require('path');
const https = require('https');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// ============================================================
// CONFIG & INITIALIZATION
// ============================================================
const PORT = process.env.PORT || 9089;
const DEFAULT_MODEL = 'gemini-2.5-flash';
const REQUEST_TIMEOUT = 10_000;

// Import modul ws penangkal crash WebSocket pada Node under v22
const ws = require('ws'); 

// Inisialisasi Supabase Core dengan Global Transport WebSocket
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  {
    auth: { persistSession: false }, // Mencegah memori leak / session overhead di RAM
    global: {
      headers: { 'x-application-name': 'hermes-bridge' }
    },
    realtime: {
      transport: ws // Memaksa Supabase menggunakan engine dari package 'ws'
    }
  }
);

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

const MODEL_ALIASES = {
  'gemini-3-flash-live': 'gemini-flash-latest',
  'gemini-3.5-pro': 'gemini-2.5-flash',
  'gemini-2.5-pro': 'gemini-2.5-flash',
  'gemini-3.5-flash-lite': 'gemini-2.5-flash-lite',
  'gemini-flash': 'gemini-flash-latest',
  'gemini-flash-lite': 'gemini-flash-lite-latest',
};

function resolveModel(requested) {
  if (!requested) return DEFAULT_MODEL;
  if (MODEL_ALIASES[requested]) {
    return MODEL_ALIASES[requested];
  }
  return requested;
}

// ============================================================
// SUPABASE REMOTE LOGGER (Asynchronous / Non-blocking)
// ============================================================
function recordRequestRemote({ model, inputTokens, outputTokens, tokenIdx, success, ms }) {
  // Berjalan di background agar tidak mengorbankan kecepatan respon API utama
  supabase
    .from('hermes_requests')
    .insert([
      {
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        token_index: tokenIdx,
        success,
        latency_ms: ms,
      },
    ])
    .then(({ error }) => {
      if (error) console.error(`❌ Supabase Log Error: ${error.message}`);
    });
}

// ============================================================
// TOKEN COMPRESSION ("few token do trick")
// ============================================================
const COMPRESSION_RULES = [
  [/\bplease\b/gi, ''],
  [/\bkindly\b/gi, ''],
  [/\bcould you\b/gi, ''],
  [/\bwould you\b/gi, ''],
  [/\bi would like(?: you)? to\b/gi, ''],
  [/\bcan you please\b/gi, ''],
  [/\bi want you to\b/gi, ''],
  [/\bfeel free to\b/gi, ''],
  [/\bin order to\b/gi, 'to'],
  [/\bdue to the fact that\b/gi, 'because'],
  [/\bat this point in time\b/gi, 'now'],
  [/\bfor the purpose of\b/gi, 'for'],
  [/\bwith regard to\b/gi, 'about'],
  [/\bin the event that\b/gi, 'if'],
  [/\bprior to\b/gi, 'before'],
  [/\bsubsequent to\b/gi, 'after'],
  [/\bin addition to\b/gi, 'also'],
  [/\ba large number of\b/gi, 'many'],
  [/\bthe majority of\b/gi, 'most'],
  [/\bit is important to note that\b/gi, ''],
  [/\bplease note that\b/gi, ''],
  [/\bas you may know\b/gi, ''],
  [/\bneedless to say\b/gi, ''],
  [/\bwithout further ado\b/gi, ''],
  [/\n\s*\n+/g, '\n'],       // Mampatkan enter beruntun (baris kosong) menjadi 1 enter
  [/[\r\t]/g, ''],            // Hapus karakter carriage return dan tab tersembunyi
  [/\b(pikirkan|coba|tolong|mohon|saja|tampaknya|sepertinya)\b/gi, ''], // Bersihkan filler words lokal
  [/  +/g, ' '],
  [/^ /gm, ''],
];

function compressText(text) {
  if (!text || typeof text !== 'string') return text;
  if (text.length < 100) return text;

  let out = text;
  for (const [pattern, replacement] of COMPRESSION_RULES) {
    out = out.replace(pattern, replacement);
  }
  return out.trim();
}

function compressMessages(messages) {
  return messages.map(msg => {
    if (msg.role === 'user' && typeof msg.content === 'string') {
      return { ...msg, content: compressText(msg.content) };
    }
    return msg;
  });
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
// TOKEN POOL
// ============================================================
function buildTokenPool() {
  const seen = new Set();
  const pool = [];
  const push = (val) => {
    if (!val) return;
    const v = val.trim();
    if (v.length > 25 && !v.toLowerCase().includes('gemini-') && !seen.has(v)) {
      seen.add(v);
      pool.push(v);
    }
  };

  for (const [key, val] of Object.entries(process.env)) {
    if (/GEMINI|GOOGLE/i.test(key) && !/URL|HOST|MODEL/i.test(key)) {
      String(val).split(',').forEach(push);
    }
  }

  if (pool.length === 0) {
    ['GEMINI_API_KEY', 'GOOGLE_API_KEY'].forEach(k => push(process.env[k]));
  }
  return pool;
}

const TOKEN_POOL = buildTokenPool();
if (TOKEN_POOL.length === 0) {
  console.error('❌ Tidak ada token API ditemukan di .env!');
  process.exit(1);
}
console.log(`🔑 ${TOKEN_POOL.length} token terdeteksi.`);

let globalIndex = 0;

// ============================================================
// REMOTE SESSION MANAGER (Supabase-backed)
// ============================================================
async function getSessionIndexRemote(key) {
  const { data, error } = await supabase
    .from('hermes_sessions')
    .select('token_index')
    .eq('session_key', key)
    .maybeSingle();
  
  if (error) {
    console.error(`⚠️ Gagal mengambil sesi dari Supabase: ${error.message}`);
    return null;
  }
  return data ? data.token_index : null;
}

function setSessionIndexRemote(key, index) {
  supabase
    .from('hermes_sessions')
    .upsert({ session_key: key, token_index: index, updated_at: new Date() }, { onConflict: 'session_key' })
    .then(({ error }) => {
      if (error) console.error(`❌ Gagal menyimpan sesi ke Supabase: ${error.message}`);
    });
}

// ============================================================
// SCHEMA SANITIZER & TRANSFORMER
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

function toGeminiPayload(body) {
  const rawMessages = body.messages || [];
  
  const systemMessages = rawMessages.filter(msg => msg.role === 'system');
  let chatMessages = rawMessages.filter(msg => msg.role !== 'system');

  // Menjaga kuota token agar tidak membengkak ekstrem
  const MAX_HISTORY = 15;
  if (chatMessages.length > MAX_HISTORY) {
    console.log(`✂️  Context Trim: Memotong riwayat obrolan dari ${chatMessages.length} menjadi ${MAX_HISTORY}`);
    chatMessages = chatMessages.slice(-MAX_HISTORY);
  }

  const messages = compressMessages([...systemMessages, ...chatMessages]);
  
  const contents = [];
  let hasSystem = false;

  for (const msg of messages) {
    if (msg.role === 'tool' || msg.role === 'function') {
      contents.push({ role: 'user', parts: [{ functionResponse: { name: msg.name || 'terminal', response: { output: msg.content } } }] });
      continue;
    }
    if (msg.role === 'system') {
      hasSystem = true;
      const text = PERSONA ? `${PERSONA}\n\n---\n\n${msg.content || ''}` : (msg.content || '');
      contents.push({ role: 'user', parts: [{ text }] });
      continue;
    }

    const parts = [];
    if (msg.content) parts.push({ text: msg.content });
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        let args = {};
        try { args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments; } catch {}
        parts.push({ functionCall: { name: tc.function.name, args } });
      }
    }
    contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts });
  }

  if (!hasSystem && PERSONA) contents.unshift({ role: 'user', parts: [{ text: PERSONA }] });

  const payload = { contents };

  if (body.tools?.length) {
    payload.tools = [{ functionDeclarations: body.tools.map(t => ({
      name: t.function.name,
      description: t.function.description || '',
      parameters: t.function.parameters ? sanitizeSchema(t.function.parameters) : undefined,
    }))}];
  }

  return JSON.stringify(payload);
}

// ============================================================
// GEMINI REQUEST CORE
// ============================================================
function callGemini(body, apiKey, tokenIndex, model) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const payload = toGeminiPayload(body);
    let done = false;

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${model}:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    };

    const req = https.request(options, (res) => {
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
            const code = json.error.code;
            const message = json.error.message || '';
            if (code === 429 || code === 403 || /quota/i.test(message)) {
              return reject({ type: 'QUOTA', message, index: tokenIndex });
            }
            return reject({ type: 'API_ERROR', message, index: tokenIndex });
          }

          const ms = Date.now() - t0;
          const usage = json.usageMetadata || {};
          
          recordRequestRemote({
            model,
            inputTokens: usage.promptTokenCount || 0,
            outputTokens: usage.candidatesTokenCount || 0,
            tokenIdx: tokenIndex,
            success: true,
            ms,
          });

          resolve(json);
        } catch (e) {
          reject({ type: 'PARSE_ERROR', message: e.message, index: tokenIndex });
        }
      });
    });

    req.setTimeout(REQUEST_TIMEOUT, () => {
      done = true;
      req.destroy();
      reject({ type: 'TIMEOUT', index: tokenIndex });
    });

    req.on('error', e => { if (!done) reject({ type: 'NETWORK_ERROR', message: e.message, index: tokenIndex }); });
    req.write(payload);
    req.end();
  });
}

// ============================================================
// FALLBACK & OPENAI BUILDER ENGINE
// ============================================================
async function tryModelWithPool(body, model, startIndex) {
  const total = TOKEN_POOL.length;
  let offset = 0;

  while (offset < total) {
    const indices = [];
    for (let i = 0; i < 2 && offset + i < total; i++) indices.push((startIndex + offset + i) % total);

    const attempts = indices.map(idx => callGemini(body, TOKEN_POOL[idx], idx, model).then(res => ({ res, idx })));

    try {
      return await Promise.any(attempts);
    } catch (errs) {
      const errors = errs.errors || [];
      const isModelError = errors.some(e => e?.type === 'API_ERROR' && /not found|invalid|does not exist|unsupported/i.test(e?.message || ''));
      if (isModelError) return null;
      offset += indices.length;
    }
  }
  return null;
}

async function callWithFallback(body, requestedModel, startIndex) {
  const resolvedModel = resolveModel(requestedModel);
  const modelQueue = [resolvedModel, ...MODEL_FALLBACK_CHAIN.filter(m => m !== resolvedModel)];

  for (let i = 0; i < modelQueue.length; i++) {
    const model = modelQueue[i];
    const result = await tryModelWithPool(body, model, startIndex);
    if (result) return { ...result, model };
  }
  throw new Error('POOL_EXHAUSTED');
}

function buildOpenAIResponse(geminiRes, chunkId, model, stream, res) {
  const candidate = geminiRes.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const firstPart = parts[0];

  if (firstPart?.functionCall) {
    const toolCalls = parts.filter(p => p.functionCall).map((p, i) => ({
      id: `call_${chunkId}_${i}`, type: 'function',
      function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) },
    }));

    const payload = {
      id: chunkId, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: toolCalls }, finish_reason: 'tool_calls' }],
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

  const text = parts.map(p => p.text || '').join('');
  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write(`data: ${JSON.stringify({ id: chunkId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: 'stop' }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    return res.end();
  }

  return res.json({
    id: chunkId, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
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
  return res.json({ id: chunkId, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message: { role: 'assistant', content: message }, finish_reason: 'stop' }] });
}

// ============================================================
// MAIN EXPRESS ROUTER HANDLER
// ============================================================
async function handleChat(req, res) {
  const body = req.body;
  const messages = body.messages || [];
  const stream = body.stream === true;
  const model = body.model || DEFAULT_MODEL;
  const maxTokens = body.max_tokens || 9999;
  const chunkId = `chatcmpl-${Date.now()}`;

  if (!messages.length) return res.json({ choices: [{ message: { role: 'assistant', content: 'Bridge aktif!' } }] });

  const lastContent = String(messages.at(-1)?.content || '').toLowerCase();
  if (maxTokens <= 30 || lastContent.includes('title') || lastContent.includes('judul') || lastContent.includes('summarize this session')) {
    return res.json({ id: chunkId, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message: { role: 'assistant', content: 'Sebastian Session' }, finish_reason: 'stop' }] });
  }

  const sessionKey = String(messages[0]?.content || '').slice(0, 60) || 'default';
  
  const cachedIndex = await getSessionIndexRemote(sessionKey);
  const startIndex = cachedIndex ?? globalIndex;

  // Stream Log Sesi ke Dozzle
  if (cachedIndex === null) {
    console.log(`🆕 Sesi Baru [${sessionKey.slice(0, 20)}...] → Mulai dengan mengacak token pool [${startIndex}]`);
  } else {
    console.log(`📌 Sesi Lanjut [${sessionKey.slice(0, 20)}...] → Mengunci rute token pool [${startIndex}]`);
  }

  try {
    const { res: geminiRes, idx: winnerIdx, model: usedModel } = await callWithFallback(body, model, startIndex);
    
    setSessionIndexRemote(sessionKey, winnerIdx);
    globalIndex = (winnerIdx + 1) % TOKEN_POOL.length;

    // Stream Log Kemenangan Balapan ke Dozzle
    console.log(`🏆 Token [${winnerIdx}] MENANG balapan untuk model: ${usedModel}`);

    return buildOpenAIResponse(geminiRes, chunkId, usedModel, stream, res);
  } catch (err) {
    // Stream Log Kegagalan ke Dozzle
    console.error(`🚨 Pool Exhausted atau Gangguan Jaringan: ${err.message}`);

    recordRequestRemote({ model, inputTokens: 0, outputTokens: 0, tokenIdx: -1, success: false, ms: 0 });
    return sendError(chunkId, model, 'Tuan Zhafif, Sebastian Sedang Istirahat Karena Kelelahan', stream, res);
  }
}

// ============================================================
// EXPRESS INITIALIZATION & MIDDLEWARES
// ============================================================
const app = express();
app.use(express.json({ limit: '50mb' }));

// Middleware Logger Global Terintegrasi Dozzle (stdout stream)
app.use((req, res, next) => {
  console.log(`→ [${req.method}] ${req.url} | IP: ${req.ip}`);
  next();
});

// Import berkas dashboard baru yang baru saja kita buat
const initDashboardRouter = require('./dashboard.cjs');
// Daftarkan router dashboard ke rute /dashboard
app.use('/dashboard', initDashboardRouter(supabase));

const MODELS_LIST = {
  object: 'list',
  data: MODEL_FALLBACK_CHAIN.map(id => ({ id, object: 'model', created: 1700000000, owned_by: 'google' }))
};

app.post('/v1/chat/completions', handleChat);
app.post('/chat/completions', handleChat);
app.get('/v1/models', (_, res) => res.json(MODELS_LIST));

// Catch-all route fallback
app.use((req, res) => {
  if (req.method === 'POST') return handleChat(req, res);
  // Jika request liar mengarah ke root biasa, kita arahkan sekalian untuk redirect ke dashboard baru
  if (req.path === '/' || req.path === '') {
    return res.redirect('/dashboard');
  }
  return res.json({ status: "Hermes Bridge Active", engine: "Sebastian Engine v10.1" });
});

app.listen(PORT, () =>
  console.log(`🚀 Hermes v10.1 (Supabase Core) running on port ${PORT} | Dashboard: http://localhost:${PORT}/dashboard`)
);