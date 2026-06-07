'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const LOG = {
  boot:    (...a) => console.log (`[🚀 BOOT    ]`, ...a),
  persona: (...a) => console.log (`[🧠 PERSONA ]`, ...a),
  token:   (...a) => console.log (`[🔑 TOKEN   ]`, ...a),
  req:     (...a) => console.log (`[📥 REQUEST ]`, ...a),
  session: (...a) => console.log (`[📌 SESSION ]`, ...a),
  think:   (...a) => console.log (`[💭 THINK   ]`, ...a),
  race:    (...a) => console.log (`[🏁 RACE    ]`, ...a),
  win:     (...a) => console.log (`[🏆 WIN     ]`, ...a),
  fallback:(...a) => console.log (`[🔄 FALLBACK]`, ...a),
  tool:    (...a) => console.log (`[🔧 TOOL    ]`, ...a),
  out:     (...a) => console.log (`[📤 OUTPUT  ]`, ...a),
  trim:    (...a) => console.log (`[✂️  TRIM    ]`, ...a),
  db:      (...a) => console.log (`[🗄️  DB      ]`, ...a),
  queue:   (...a) => console.log (`[⏳ QUEUE   ]`, ...a),
  memory:  (...a) => console.log (`[💾 MEMORY  ]`, ...a),
  warn:    (...a) => console.warn (`[⚠️  WARN    ]`, ...a),
  err:     (...a) => console.error(`[🚨 ERROR   ]`, ...a),
  quota:   (...a) => console.warn (`[🚫 QUOTA   ]`, ...a),
  exhaust: (...a) => console.error(`[💀 EXHAUST ]`, ...a),
};

const PORT = process.env.PORT || 9089;
const DEFAULT_MODEL = 'gemini-2.5-flash';
const TIMEOUT_NORMAL = 10_000;
const TIMEOUT_TOOL   = 30_000;
const QUEUE_RETRY_DELAY = 15_000;
const QUEUE_MAX_RETRIES = 3;
const MEMORY_MAX_TURNS = 10;
const MEMORY_SUMMARY_THRESHOLD = 20;

const LOG_SUPPRESS = new Set(['GET:/v1/models', 'GET:/v1/models/']);

const ws = require('ws');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  {
    auth: { persistSession: false },
    global: { headers: { 'x-application-name': 'hermes-bridge' } },
    realtime: { transport: ws }
  }
);

const MODEL_FALLBACK_CHAIN = [
  'gemini-2.5-flash',
  'gemini-3.5-flash',
  'gemini-flash-latest',
  'gemini-3-flash-preview',
];

const MODEL_ALIASES = {
  'gemini-3-flash-live':  'gemini-flash-latest',
  'gemini-3.5-pro':       'gemini-2.5-flash',
  'gemini-2.5-pro':       'gemini-2.5-flash',
  'gemini-flash':         'gemini-flash-latest',
};

function resolveModel(requested) {
  if (!requested) return DEFAULT_MODEL;
  if (MODEL_ALIASES[requested]) {
    const resolved = MODEL_ALIASES[requested];
    LOG.think(`Model alias: "${requested}" → "${resolved}"`);
    return resolved;
  }
  return requested;
}

function recordRequestRemote({ model, inputTokens, outputTokens, tokenIdx, success, ms }) {
  LOG.db(`Logging → model=${model} in=${inputTokens} out=${outputTokens} tok#${tokenIdx} ${success ? 'OK' : 'FAIL'} ${ms}ms`);
  supabase.from('hermes_requests')
    .insert([{ model, input_tokens: inputTokens, output_tokens: outputTokens, token_index: tokenIdx, success, latency_ms: ms }])
    .then(({ error }) => { if (error) LOG.err(`Supabase insert gagal: ${error.message}`); });
}

const COMPRESSION_RULES = [
  [/\bplease\b/gi, ''], [/\bkindly\b/gi, ''], [/\bcould you\b/gi, ''],
  [/\bwould you\b/gi, ''], [/\bi would like(?: you)? to\b/gi, ''],
  [/\bcan you please\b/gi, ''], [/\bi want you to\b/gi, ''],
  [/\bfeel free to\b/gi, ''], [/\bin order to\b/gi, 'to'],
  [/\bdue to the fact that\b/gi, 'because'], [/\bat this point in time\b/gi, 'now'],
  [/\bfor the purpose of\b/gi, 'for'], [/\bwith regard to\b/gi, 'about'],
  [/\bin the event that\b/gi, 'if'], [/\bprior to\b/gi, 'before'],
  [/\bsubsequent to\b/gi, 'after'], [/\bin addition to\b/gi, 'also'],
  [/\ba large number of\b/gi, 'many'], [/\bthe majority of\b/gi, 'most'],
  [/\bit is important to note that\b/gi, ''], [/\bplease note that\b/gi, ''],
  [/\bas you may know\b/gi, ''], [/\bneedless to say\b/gi, ''],
  [/\bwithout further ado\b/gi, ''], [/\n\s*\n+/g, '\n'], [/[\r\t]/g, ''],
  [/\b(pikirkan|coba|tolong|mohon|saja|tampaknya|sepertinya)\b/gi, ''],
  [/  +/g, ' '], [/^ /gm, ''],
];

function compressText(text) {
  if (!text || typeof text !== 'string') return text;
  if (text.length < 100) return text;
  let out = text;
  for (const [pattern, replacement] of COMPRESSION_RULES) out = out.replace(pattern, replacement);
  return out.trim();
}

function compressMessages(messages) {
  return messages.map(msg => {
    if (msg.role === 'user' && typeof msg.content === 'string') {
      const before = msg.content.length;
      const compressed = compressText(msg.content);
      const after = compressed.length;
      if (before !== after) LOG.think(`Compression: ${before} → ${after} chars (-${before - after})`);
      return { ...msg, content: compressed };
    }
    return msg;
  });
}

function loadPersona() {
  const files = [
    path.join(__dirname, 'SOUL.md'),
    path.join(__dirname, 'memories', 'MEMORY.md'),
    path.join(__dirname, 'memories', 'USER.md'),
  ];
  return files.map(f => { try { return require('fs').readFileSync(f, 'utf8'); } catch { return ''; } })
    .filter(Boolean).join('\n\n---\n\n');
}

const PERSONA = loadPersona();
LOG.persona(`Persona dimuat (${PERSONA.length} chars)`);

function buildTokenPool() {
  const seen = new Set();
  const pool = [];
  const push = (val) => {
    if (!val) return;
    const v = val.trim();
    if (v.length > 25 && !v.toLowerCase().includes('gemini-') && !seen.has(v)) { seen.add(v); pool.push(v); }
  };
  for (const [key, val] of Object.entries(process.env)) {
    if (/GEMINI|GOOGLE/i.test(key) && !/URL|HOST|MODEL/i.test(key)) String(val).split(',').forEach(push);
  }
  if (pool.length === 0) ['GEMINI_API_KEY', 'GOOGLE_API_KEY'].forEach(k => push(process.env[k]));
  return pool;
}

const TOKEN_POOL = buildTokenPool();
if (TOKEN_POOL.length === 0) { LOG.err('Tidak ada token API ditemukan di .env!'); process.exit(1); }
LOG.token(`${TOKEN_POOL.length} token terdeteksi: [${TOKEN_POOL.map((_, i) => `tok#${i}`).join(', ')}]`);

let globalIndex = 0;
let isExhausted = false;
let exhaustedUntil = 0;
const pendingQueue = [];

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    pendingQueue.push({ fn, resolve, reject, retries: 0 });
    LOG.queue(`Request di-queue (${pendingQueue.length} pending)`);
    processQueue();
  });
}

async function processQueue() {
  if (!isExhausted || Date.now() < exhaustedUntil) return;
  if (pendingQueue.length === 0) return;
  isExhausted = false;
  LOG.queue(`Queue terbuka — memproses ${pendingQueue.length} request pending`);
  while (pendingQueue.length > 0) {
    const item = pendingQueue.shift();
    try { const result = await item.fn(); item.resolve(result); }
    catch (err) {
      item.retries++;
      if (item.retries < QUEUE_MAX_RETRIES) { LOG.queue(`Retry ${item.retries}/${QUEUE_MAX_RETRIES}`); pendingQueue.unshift(item); break; }
      else { LOG.exhaust(`Request drop setelah ${QUEUE_MAX_RETRIES} retries`); item.reject(err); }
    }
  }
}

setInterval(() => { if (pendingQueue.length > 0 && Date.now() >= exhaustedUntil) processQueue(); }, 5_000);

async function loadMemory(sessionKey) {
  const { data, error } = await supabase.from('hermes_memory').select('summary, turns').eq('session_key', sessionKey).maybeSingle();
  if (error) { LOG.warn(`Gagal load memory: ${error.message}`); return null; }
  if (!data) return null;
  LOG.memory(`Memory loaded untuk session "${sessionKey.slice(0, 20)}" — summary=${data.summary?.length || 0} chars, turns=${data.turns?.length || 0}`);
  return data;
}

function saveMemory(sessionKey, turns, summary) {
  const trimmedTurns = turns.slice(-MEMORY_MAX_TURNS);
  supabase.from('hermes_memory')
    .upsert({ session_key: sessionKey, summary: summary || null, turns: trimmedTurns, updated_at: new Date() }, { onConflict: 'session_key' })
    .then(({ error }) => {
      if (error) LOG.err(`Gagal save memory: ${error.message}`);
      else LOG.memory(`Memory saved → session="${sessionKey.slice(0, 20)}" turns=${trimmedTurns.length}`);
    });
}

function buildMemoryInjection(memoryData) {
  if (!memoryData) return '';
  const parts = [];
  if (memoryData.summary) parts.push(`## Ringkasan Percakapan Sebelumnya\n${memoryData.summary}`);
  if (memoryData.turns?.length) parts.push(`## Konteks Turn Terakhir\n${memoryData.turns.map(t => `${t.role}: ${t.content}`).join('\n')}`);
  return parts.length ? `\n\n---\n\n${parts.join('\n\n')}` : '';
}

async function summarizeIfNeeded(sessionKey, turns, model) {
  if (turns.length < MEMORY_SUMMARY_THRESHOLD) return null;
  LOG.memory(`History panjang (${turns.length} turns) → summarize ke Gemini`);
  const summaryPrompt = `Rangkum percakapan berikut secara singkat dalam 3-5 kalimat, fokus pada hal-hal penting yang perlu diingat:\n\n${turns.map(t => `${t.role}: ${t.content}`).join('\n')}`;
  try {
    const payload = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: summaryPrompt }] }] });
    const apiKey = TOKEN_POOL[globalIndex % TOKEN_POOL.length];
    const summary = await new Promise((resolve, reject) => {
      const options = { hostname: 'generativelanguage.googleapis.com', path: `/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } };
      const req = https.request(options, (res) => {
        let raw = '';
        res.on('data', c => { raw += c; });
        res.on('end', () => { try { const json = JSON.parse(raw); resolve(json.candidates?.[0]?.content?.parts?.[0]?.text || ''); } catch { reject(new Error('Parse error')); } });
      });
      req.setTimeout(15_000, () => { req.destroy(); reject(new Error('Timeout')); });
      req.on('error', reject);
      req.write(payload); req.end();
    });
    LOG.memory(`Summary generated: "${summary.slice(0, 80)}..."`);
    return summary;
  } catch (e) { LOG.warn(`Summarize gagal: ${e.message}`); return null; }
}

async function getSessionIndexRemote(key) {
  const { data, error } = await supabase.from('hermes_sessions').select('token_index').eq('session_key', key).maybeSingle();
  if (error) { LOG.warn(`Gagal ambil sesi: ${error.message}`); return null; }
  return data ? data.token_index : null;
}

function setSessionIndexRemote(key, index) {
  supabase.from('hermes_sessions')
    .upsert({ session_key: key, token_index: index, updated_at: new Date() }, { onConflict: 'session_key' })
    .then(({ error }) => {
      if (error) LOG.err(`Gagal simpan sesi: ${error.message}`);
      else LOG.db(`Sesi disimpan → key="${key.slice(0, 20)}" tok#${index}`);
    });
}

const BANNED_KEYS = new Set(['$comment', '$schema', 'enumDescriptions', 'additionalProperties']);
function sanitizeSchema(obj) {
  if (Array.isArray(obj)) return obj.map(sanitizeSchema);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) { if (!BANNED_KEYS.has(k)) out[k] = sanitizeSchema(v); }
    return out;
  }
  return obj;
}

// ============================================================
// PAYLOAD TRANSFORMER — [FIX-1] tool_calls re-injected
// ============================================================
function toGeminiPayload(body, reqId, memoryInjection) {
  const rawMessages = body.messages || [];
  const systemMessages = rawMessages.filter(m => m.role === 'system');
  let chatMessages = rawMessages.filter(m => m.role !== 'system');

  LOG.think(`[${reqId}] Input: ${rawMessages.length} msgs (sys=${systemMessages.length} chat=${chatMessages.length})`);
  rawMessages.forEach((m, i) => {
    const preview = typeof m.content === 'string' ? m.content.slice(0, 120).replace(/\n/g, ' ') : '[non-string]';
    LOG.think(`[${reqId}]   [${i}] role=${m.role} → "${preview}${m.content?.length > 120 ? '...' : ''}"`);
  });

  const MAX_HISTORY = 15;
  if (chatMessages.length > MAX_HISTORY) {
    LOG.trim(`[${reqId}] Context trim: ${chatMessages.length} → ${MAX_HISTORY} msgs`);
    chatMessages = chatMessages.slice(-MAX_HISTORY);
  }

  const messages = compressMessages([...systemMessages, ...chatMessages]);
  const contents = [];
  let hasSystem = false;

  for (const msg of messages) {
    if (msg.role === 'tool' || msg.role === 'function') {
      LOG.tool(`[${reqId}] Tool result: name=${msg.name || 'terminal'} → "${String(msg.content || '').slice(0, 80)}"`);
      contents.push({ role: 'user', parts: [{ functionResponse: { name: msg.name || 'terminal', response: { output: msg.content } } }] });
      continue;
    }

    if (msg.role === 'system') {
      hasSystem = true;
      const memoryPart = memoryInjection || '';
      const text = PERSONA ? `${PERSONA}\n\n---\n\n${msg.content || ''}${memoryPart}` : `${msg.content || ''}${memoryPart}`;
      contents.push({ role: 'user', parts: [{ text }] });
      continue;
    }

    const parts = [];
    if (msg.content) parts.push({ text: msg.content });

    // ✅ [FIX-1] Re-inject tool_calls as functionCall parts
    if (msg.tool_calls?.length) {
      LOG.tool(`[${reqId}] Re-injecting tool_calls into model turn: [${msg.tool_calls.map(t => t.function?.name).join(', ')}]`);
      for (const tc of msg.tool_calls) {
        let args = {};
        try { args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc.function.arguments || {}); } catch {}
        parts.push({ functionCall: { name: tc.function.name, args } });
      }
    }

    if (parts.length > 0) {
      contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts });
    } else {
      LOG.think(`[${reqId}] Skip truly-empty turn (no content, no tool_calls)`);
    }
  }

  if (!hasSystem && PERSONA) {
    LOG.think(`[${reqId}] Inject PERSONA sebagai turn pertama`);
    const memoryPart = memoryInjection || '';
    contents.unshift({ role: 'user', parts: [{ text: `${PERSONA}${memoryPart}` }] });
  }

  if (body.tools?.length) LOG.tool(`[${reqId}] Tools tersedia: ${body.tools.map(t => t.function?.name).join(', ')}`);

  const payload = { contents };
  if (body.tools?.length) {
    payload.tools = [{ functionDeclarations: body.tools.map(t => ({ name: t.function.name, description: t.function.description || '', parameters: t.function.parameters ? sanitizeSchema(t.function.parameters) : undefined })) }];
  }
  return JSON.stringify(payload);
}

function callGemini(body, apiKey, tokenIndex, model, reqId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const payload = toGeminiPayload(body, reqId, body._memoryInjection);
    let done = false;

    LOG.race(`[${reqId}] Firing tok#${tokenIndex} → ${model} (timeout=${timeoutMs}ms)`);

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${model}:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    };

    const req = https.request(options, (res) => {
      if (res.statusCode === 429 || res.statusCode === 403) {
        done = true; req.destroy();
        LOG.quota(`[${reqId}] tok#${tokenIndex} HTTP ${res.statusCode} — rate limited`);
        return reject({ type: 'QUOTA', status: res.statusCode, index: tokenIndex });
      }
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        if (done) return;
        try {
          const json = JSON.parse(raw);
          if (json.error) {
            const { code, message = '' } = json.error;
            if (code === 429 || code === 403 || /quota/i.test(message)) {
              LOG.quota(`[${reqId}] tok#${tokenIndex} quota error: ${message.slice(0, 80)}`);
              return reject({ type: 'QUOTA', message, index: tokenIndex });
            }
            // ✅ [FIX-3] thought_signature → log warning, retry normally
            if (/thought_signature/i.test(message)) {
              LOG.warn(`[${reqId}] tok#${tokenIndex} thought_signature error (should be rare after FIX-1): ${message.slice(0, 120)}`);
              return reject({ type: 'API_ERROR', message, index: tokenIndex });
            }
            LOG.err(`[${reqId}] tok#${tokenIndex} API error (${code}): ${message.slice(0, 120)}`);
            return reject({ type: 'API_ERROR', message, index: tokenIndex });
          }
          const ms = Date.now() - t0;
          const usage = json.usageMetadata || {};
          const inTok = usage.promptTokenCount || 0;
          const outTok = usage.candidatesTokenCount || 0;
          LOG.win(`[${reqId}] tok#${tokenIndex} ✓ ${ms}ms | in=${inTok} out=${outTok} tokens`);
          recordRequestRemote({ model, inputTokens: inTok, outputTokens: outTok, tokenIdx: tokenIndex, success: true, ms });
          resolve(json);
        } catch (e) {
          LOG.err(`[${reqId}] tok#${tokenIndex} parse error: ${e.message}`);
          reject({ type: 'PARSE_ERROR', message: e.message, index: tokenIndex });
        }
      });
    });

    req.setTimeout(timeoutMs, () => { done = true; req.destroy(); LOG.warn(`[${reqId}] tok#${tokenIndex} TIMEOUT (${timeoutMs}ms)`); reject({ type: 'TIMEOUT', index: tokenIndex }); });
    req.on('error', e => { if (!done) { LOG.err(`[${reqId}] tok#${tokenIndex} network: ${e.message}`); reject({ type: 'NETWORK_ERROR', message: e.message, index: tokenIndex }); } });
    req.write(payload); req.end();
  });
}

// ✅ [FIX-3] thought_signature skip dihapus dari sini
async function tryModelWithPool(body, model, startIndex, reqId, timeoutMs) {
  const total = TOKEN_POOL.length;
  const MAX_ROUNDS = 2;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    LOG.think(`[${reqId}] Model=${model} | Round ${round + 1}/${MAX_ROUNDS}`);
    let offset = 0;
    while (offset < total) {
      const BATCH = Math.min(2, total - offset);
      const indices = Array.from({ length: BATCH }, (_, i) => (startIndex + offset + i) % total);
      LOG.race(`[${reqId}] Batch: [${indices.map(i => `tok#${i}`).join(' vs ')}]`);
      const attempts = indices.map(idx => callGemini(body, TOKEN_POOL[idx], idx, model, reqId, timeoutMs).then(res => ({ res, idx })));
      try {
        return await Promise.any(attempts);
      } catch (aggErr) {
        const errors = aggErr.errors || [];
        LOG.warn(`[${reqId}] Batch gagal: [${errors.map(e => `tok#${e?.index}:${e?.type}`).join(', ')}]`);
        const isModelError = errors.some(e => e?.type === 'API_ERROR' && /not found|invalid|does not exist|unsupported/i.test(e?.message || ''));
        if (isModelError) { LOG.fallback(`[${reqId}] Model "${model}" tidak valid → skip`); return null; }
        offset += BATCH;
      }
    }
    if (round < MAX_ROUNDS - 1) { LOG.fallback(`[${reqId}] Round ${round + 1} habis → retry setelah 500ms`); await new Promise(r => setTimeout(r, 500)); }
  }
  LOG.fallback(`[${reqId}] Model="${model}" exhausted (${MAX_ROUNDS} rounds × ${total} tokens)`);
  return null;
}

async function callWithFallback(body, requestedModel, startIndex, reqId, timeoutMs) {
  const resolvedModel = resolveModel(requestedModel);
  const modelQueue = [resolvedModel, ...MODEL_FALLBACK_CHAIN.filter(m => m !== resolvedModel)];
  LOG.think(`[${reqId}] Model queue: ${modelQueue.join(' → ')}`);
  for (let i = 0; i < modelQueue.length; i++) {
    const model = modelQueue[i];
    LOG.fallback(`[${reqId}] Trying model ${i + 1}/${modelQueue.length}: "${model}"`);
    const result = await tryModelWithPool(body, model, startIndex, reqId, timeoutMs);
    if (result) return { ...result, model };
    LOG.fallback(`[${reqId}] "${model}" gagal → next`);
  }
  LOG.exhaust(`[${reqId}] Semua model & token habis → POOL_EXHAUSTED`);
  throw new Error('POOL_EXHAUSTED');
}

function buildOpenAIResponse(geminiRes, chunkId, model, stream, res, reqId) {
  const candidate = geminiRes.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const firstPart = parts[0];

  if (firstPart?.functionCall) {
    const toolCalls = parts.filter(p => p.functionCall).map((p, i) => ({ id: `call_${chunkId}_${i}`, type: 'function', function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args || {}) } }));
    LOG.out(`[${reqId}] → TOOL_CALLS: [${toolCalls.map(t => t.function.name).join(', ')}]`);
    const payload = { id: chunkId, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: toolCalls }, finish_reason: 'tool_calls' }] };
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache');
      res.write(`data: ${JSON.stringify({ ...payload, object: 'chat.completion.chunk', choices: [{ index: 0, delta: payload.choices[0].message, finish_reason: 'tool_calls' }] })}\n\n`);
      res.write('data: [DONE]\n\n'); return res.end();
    }
    return res.json(payload);
  }

  const text = parts.map(p => p.text || '').join('');
  LOG.out(`[${reqId}] → TEXT: ${text.length} chars | "${text.slice(0, 100).replace(/\n/g, ' ')}"`);

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive');
    res.write(`data: ${JSON.stringify({ id: chunkId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: 'stop' }] })}\n\n`);
    res.write('data: [DONE]\n\n'); return res.end();
  }

  return res.json({ id: chunkId, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
}

function sendError(chunkId, model, message, stream, res, reqId) {
  LOG.err(`[${reqId}] Sending error: "${message}"`);
  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.write(`data: ${JSON.stringify({ id: chunkId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { content: message }, finish_reason: 'stop' }] })}\n\n`);
    res.write('data: [DONE]\n\n'); return res.end();
  }
  return res.json({ id: chunkId, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message: { role: 'assistant', content: message }, finish_reason: 'stop' }] });
}

// ============================================================
// MAIN HANDLER — [FIX-2] expanded hasToolChain detection
// ============================================================
async function handleChat(req, res) {
  const body = req.body;
  const messages = body.messages || [];
  const stream = body.stream === true;
  const model = body.model || DEFAULT_MODEL;
  const maxTokens = body.max_tokens || 9999;
  const chunkId = `chatcmpl-${Date.now()}`;
  const reqId = chunkId.slice(-8);

  LOG.req(`[${reqId}] POST /chat | model=${model} msgs=${messages.length} stream=${stream} maxTok=${maxTokens}`);

  if (!messages.length) { LOG.warn(`[${reqId}] Request kosong → ping`); return res.json({ choices: [{ message: { role: 'assistant', content: 'Bridge aktif!' } }] }); }

  const lastContent = String(messages.at(-1)?.content || '').toLowerCase();
  if (maxTokens <= 30 || lastContent.includes('title') || lastContent.includes('judul') || lastContent.includes('summarize this session')) {
    LOG.think(`[${reqId}] Title/summary bypass → balas cepat`);
    return res.json({ id: chunkId, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message: { role: 'assistant', content: 'Sebastian Session' }, finish_reason: 'stop' }] });
  }

  // ✅ [FIX-2] Cek seluruh history, bukan hanya last message
  const hasToolChain = messages.some(m =>
    m.role === 'tool' ||
    m.role === 'function' ||
    (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0)
  );
  const timeoutMs = hasToolChain ? TIMEOUT_TOOL : TIMEOUT_NORMAL;
  if (hasToolChain) LOG.think(`[${reqId}] Tool chain detected → timeout=${timeoutMs}ms`);

  const sessionKey = String(messages[0]?.content || '').slice(0, 60) || 'default';
  const memoryData = await loadMemory(sessionKey);
  const memoryInjection = buildMemoryInjection(memoryData);
  if (memoryInjection) LOG.memory(`[${reqId}] Memory injected (${memoryInjection.length} chars)`);
  body._memoryInjection = memoryInjection;

  const cachedIndex = await getSessionIndexRemote(sessionKey);
  const startIndex = cachedIndex ?? globalIndex;
  if (cachedIndex === null) LOG.session(`[${reqId}] 🆕 Sesi baru "${sessionKey.slice(0, 20)}..." → startIndex=tok#${startIndex}`);
  else LOG.session(`[${reqId}] 📌 Sesi lama "${sessionKey.slice(0, 20)}..." → locked ke tok#${startIndex}`);

  if (isExhausted && Date.now() < exhaustedUntil) {
    LOG.queue(`[${reqId}] Pool sedang exhausted → masuk queue (${Math.ceil((exhaustedUntil - Date.now()) / 1000)}s lagi)`);
    try {
      const result = await enqueue(() => callWithFallback(body, model, startIndex, reqId, timeoutMs));
      setSessionIndexRemote(sessionKey, result.idx);
      globalIndex = (result.idx + 1) % TOKEN_POOL.length;
      return buildOpenAIResponse(result.res, chunkId, result.model, stream, res, reqId);
    } catch (err) { return sendError(chunkId, model, 'Tuan Zhafif, Sebastian Sedang Istirahat Karena Kelelahan', stream, res, reqId); }
  }

  try {
    const { res: geminiRes, idx: winnerIdx, model: usedModel } = await callWithFallback(body, model, startIndex, reqId, timeoutMs);
    setSessionIndexRemote(sessionKey, winnerIdx);
    globalIndex = (winnerIdx + 1) % TOKEN_POOL.length;

    const newTurns = messages.filter(m => m.role === 'user' || (m.role === 'assistant' && m.content)).map(m => ({ role: m.role, content: String(m.content || '').slice(0, 500) }));
    const allTurns = [...(memoryData?.turns || []), ...newTurns];
    const summary = await summarizeIfNeeded(sessionKey, allTurns, usedModel);
    saveMemory(sessionKey, summary ? [] : allTurns, summary || memoryData?.summary);

    LOG.win(`[${reqId}] ✅ Done — model=${usedModel} winner=tok#${winnerIdx} globalIndex→tok#${globalIndex}`);
    return buildOpenAIResponse(geminiRes, chunkId, usedModel, stream, res, reqId);

  } catch (err) {
    LOG.exhaust(`[${reqId}] ❌ POOL_EXHAUSTED: ${err.message}`);
    isExhausted = true;
    exhaustedUntil = Date.now() + QUEUE_RETRY_DELAY;
    LOG.queue(`Pool exhausted → queue buka dalam ${QUEUE_RETRY_DELAY / 1000}s`);
    setSessionIndexRemote(sessionKey, (startIndex + 1) % TOKEN_POOL.length);
    recordRequestRemote({ model, inputTokens: 0, outputTokens: 0, tokenIdx: -1, success: false, ms: 0 });
    return sendError(chunkId, model, 'Tuan Zhafif, Sebastian Sedang Istirahat Karena Kelelahan', stream, res, reqId);
  }
}

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use((req, res, next) => { const key = `${req.method}:${req.path}`; if (!LOG_SUPPRESS.has(key)) LOG.req(`→ [${req.method}] ${req.url} | IP: ${req.ip}`); next(); });

const initDashboardRouter = require('./dashboard.cjs');
app.use('/dashboard', initDashboardRouter(supabase));

const MODELS_LIST = { object: 'list', data: MODEL_FALLBACK_CHAIN.map(id => ({ id, object: 'model', created: 1700000000, owned_by: 'google' })) };

app.post('/v1/chat/completions', handleChat);
app.post('/chat/completions', handleChat);
app.get('/v1/models', (_, res) => res.json(MODELS_LIST));
app.use((req, res) => {
  if (req.method === 'POST') return handleChat(req, res);
  if (req.path === '/' || req.path === '') return res.redirect('/dashboard');
  return res.json({ status: 'Hermes Bridge Active', engine: 'Sebastian Engine v10.4' });
});

app.listen(PORT, () => {
  LOG.boot(`Hermes v10.4 running on :${PORT}`);
  LOG.boot(`Dashboard → http://localhost:${PORT}/dashboard`);
  LOG.boot(`Pool: ${TOKEN_POOL.length} tokens | Default: ${DEFAULT_MODEL}`);
  LOG.boot(`Timeout: normal=${TIMEOUT_NORMAL}ms tool-chain=${TIMEOUT_TOOL}ms`);
  LOG.boot(`Queue: retry delay=${QUEUE_RETRY_DELAY}ms max retries=${QUEUE_MAX_RETRIES}`);
});