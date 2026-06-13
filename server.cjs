'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const LOG = {
  boot:     (...a) => console.log (`[🚀 BOOT    ]`, ...a),
  persona:  (...a) => console.log (`[🧠 PERSONA ]`, ...a),
  token:    (...a) => console.log (`[🔑 TOKEN   ]`, ...a),
  req:      (...a) => console.log (`[📥 REQUEST ]`, ...a),
  session:  (...a) => console.log (`[📌 SESSION ]`, ...a),
  think:    (...a) => console.log (`[💭 THINK   ]`, ...a),
  race:     (...a) => console.log (`[🏁 RACE    ]`, ...a),
  win:      (...a) => console.log (`[🏆 WIN     ]`, ...a),
  fallback: (...a) => console.log (`[🔄 FALLBACK]`, ...a),
  tool:     (...a) => console.log (`[🔧 TOOL    ]`, ...a),
  out:      (...a) => console.log (`[📤 OUTPUT  ]`, ...a),
  trim:     (...a) => console.log (`[✂️  TRIM    ]`, ...a),
  db:       (...a) => console.log (`[🗄️  DB      ]`, ...a),
  queue:    (...a) => console.log (`[⏳ QUEUE   ]`, ...a),
  memory:   (...a) => console.log (`[💾 MEMORY  ]`, ...a),
  warn:     (...a) => console.warn (`[⚠️  WARN    ]`, ...a),
  err:      (...a) => console.error(`[🚨 ERROR   ]`, ...a),
  quota:    (...a) => console.warn (`[🚫 QUOTA   ]`, ...a),
  exhaust:  (...a) => console.error(`[💀 EXHAUST ]`, ...a),
};

const PORT = process.env.PORT || 9089;
const DEFAULT_MODEL = 'gemini-2.5-flash';
const TIMEOUT_NORMAL = 30_000;
const TIMEOUT_TOOL   = 60_000;

const LOG_SUPPRESS = new Set(['GET:/v1/models', 'GET:/v1/models/']);

const ws = require('ws');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  {
    auth: { persistSession: false },
    global: { headers: { 'x-application-name': 'brotherzhafif' } },
    realtime: { transport: ws }
  }
);

const MODEL_FALLBACK_CHAIN = [
  'gemini-2.5-flash',
  'gemini-3.5-flash',
  'gemini-flash-latest',
  'gemini-3-flash-preview',
];

const OPENROUTER_COPILOT_CHAIN = [
  'qwen/qwen3-coder:free',       // 1. Paling stabil untuk Tool Call & Koding + Context jumbo
  'poolside/laguna-m.1:free',    // 2. Terbukti 'WIN' di log kamu, cepat
  'openai/gpt-oss-120b:free',    // 3. Backup format familiar
  'nvidia/nemotron-3-ultra:free' // 4. Last resort
];

const OPENROUTER_WHATSAPP_CHAIN = [
  'meta-llama/llama-3.3-70b-instruct:free',  // Cepat, conversational
  'google/gemma-4-31b-it:free',              // Ringan, responsif
  'openai/gpt-oss-20b:free',                 // Backup ringan
  'nvidia/nemotron-3-nano-30b-a3b:free',     // Last resort ringan
];

const MODEL_ALIASES = {
  'gemini-3-flash-live':  'gemini-flash-latest',
  'gemini-3.5-pro':       'gemini-2.5-flash',
  'gemini-2.5-pro':       'gemini-2.5-flash',
  'gemini-flash':         'gemini-flash-latest',
};

const MEMORY_CONFIG = {
  max_turns: 16,
  trim_chars: 150,
  injection_turns: 4,
  summary_threshold: 6,
  purgeDays: 30,
};

const SEMANTIC_TRIGGERS = /\b(tadi|kemarin|sebelumnya|waktu itu|dulu|minggu lalu|bulan lalu|pernah|ingat|inget|lupa|apa yang|kapan kita|kita pernah|terakhir kali)\b/i;

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

// ============================================================
// COPILOT SESSION — TOOL OUTPUT COMPRESSION
// ============================================================
const TOOL_COMPRESSION_RULES = [
  // Hapus ANSI escape codes
  [/\x1b\[[0-9;]*m/g, ''],
  // Hapus timestamp umum (ISO, log format)
  [/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?\b/g, ''],
  // Hapus progress bar / spinner characters
  [/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g, ''],
  // Hapus noise npm
  [/^.*npm warn deprecated.*$/gim, ''],
  [/^.*\d+ packages? (installed|audited|funded).*$/gim, ''],
  // Hapus baris hanya separator/dashes
  [/^[-=*]{3,}$/gm, ''],
  // Trim trailing whitespace per baris
  [/[ \t]+$/gm, ''],
  // Collapse baris kosong berulang
  [/\n{2,}/g, '\n'],
];

const TOOL_OUTPUT_MAX_CHARS = 4000;

function compressToolOutput(content, reqId) {
  if (!content || typeof content !== 'string') return content;
  let out = content;
  for (const [pattern, replacement] of TOOL_COMPRESSION_RULES) out = out.replace(pattern, replacement);
  out = out.trim();

  if (out.length > TOOL_OUTPUT_MAX_CHARS) {
    const head = out.slice(0, Math.floor(TOOL_OUTPUT_MAX_CHARS * 0.6));
    const tail = out.slice(-Math.floor(TOOL_OUTPUT_MAX_CHARS * 0.3));
    const removed = content.length - out.length;
    LOG.trim(`[${reqId}] Tool output truncated: ${content.length} → head+tail (removed ~${removed} chars)`);
    out = `${head}\n\n...[dipotong, ${removed} chars dihilangkan]...\n\n${tail}`;
  }

  return out;
}

// ============================================================
// COPILOT SESSION — toOpenRouterPayload with tool compression
// ============================================================
function compressOpenRouterMessages(messages, sessionKey, reqId) {
  if (sessionKey !== 'copilot') return messages;
  return messages.map(msg => {
    // Compress tool/function result content
    if ((msg.role === 'tool' || msg.role === 'function') && typeof msg.content === 'string') {
      const before = msg.content.length;
      const compressed = compressToolOutput(msg.content, reqId);
      const after = compressed.length;
      if (before !== after) LOG.trim(`[${reqId}] OpenRouter tool msg compressed: ${before} → ${after} chars`);
      return { ...msg, content: compressed };
    }
    // Compress tool_result inside content array (OpenAI format)
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      const newContent = msg.content.map(part => {
        if (part.type === 'tool_result' && typeof part.content === 'string') {
          const before = part.content.length;
          const compressed = compressToolOutput(part.content, reqId);
          const after = compressed.length;
          if (before !== after) LOG.trim(`[${reqId}] OpenRouter tool_result part compressed: ${before} → ${after} chars`);
          return { ...part, content: compressed };
        }
        return part;
      });
      return { ...msg, content: newContent };
    }
    return msg;
  });
}

function stripResponseTags(text) {
  if (!text || typeof text !== 'string') return text;
  const match = text.match(/<response>([\s\S]*?)<\/response>/i);
  if (match) return match[1].trim();
  return text.replace(/<compact>[\s\S]*?<\/compact>/gi, '').trim();
}

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

function buildGeminiTokenPool() {
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

function buildOpenRouterTokenPool() {
  const seen = new Set();
  const pool = [];
  const push = (val) => {
    if (!val) return;
    const v = val.trim();
    if (v.length > 10 && !seen.has(v)) { seen.add(v); pool.push(v); }
  };
  for (const [key, val] of Object.entries(process.env)) {
    if (/OPENROUTER_API_KEY/i.test(key)) String(val).split(',').forEach(push);
  }
  return pool;
}

const OPENROUTER_TOKEN_POOL = buildOpenRouterTokenPool();
LOG.token(`${OPENROUTER_TOKEN_POOL.length} OpenRouter token terdeteksi`);

const GEMINI_TOKEN_POOL = buildGeminiTokenPool();
LOG.token(`${GEMINI_TOKEN_POOL.length} Gemini token terdeteksi`);

let globalIndex = 0;
const SERVER_START_TIME = Date.now();
let healthStats = { totalRequests: 0, successfulRequests: 0, failedRequests: 0, totalTokens: 0, startTime: new Date(), lastUpdated: new Date() };

// ============================================================
// MULTI-SOURCE MEMORY
// ============================================================
async function loadLocalMemory(sessionKey) {
  const { data, error } = await supabase
    .from('hermes_sessions')
    .select('summary, turns, last_active')
    .eq('session_key', sessionKey)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

function saveLocalMemory(sessionKey, turns, summary) {
  supabase.from('hermes_sessions')
    .upsert(
      { session_key: sessionKey, summary: summary || null, turns, last_active: new Date() },
      { onConflict: 'session_key' }
    )
    .then(({ error }) => {
      if (error) LOG.err(`Gagal save memory: ${error.message}`);
      else LOG.memory(`Memory saved → session="${sessionKey.slice(0, 20)}" turns=${turns.length}`);
    });

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - MEMORY_CONFIG.purgeDays);

  supabase.from('hermes_sessions')
    .update({ turns: [], summary: null })
    .lt('last_active', cutoffDate.toISOString())
    .then(({ error }) => {
      if (error) LOG.warn(`Auto-purge gagal: ${error.message}`);
    });
}

function archiveSummary(sessionKey, oldSummary) {
  if (!oldSummary) return;
  supabase.from('hermes_memory_archive')
    .insert([{ session_key: sessionKey, summary: oldSummary }])
    .then(({ error }) => {
      if (error) LOG.err(`Gagal archive summary: ${error.message}`);
      else LOG.memory(`Archived summary → session="${sessionKey.slice(0, 20)}"`);
    });
}

async function searchLongTermMemory(sessionKey, query, limit = 5) {
  let q = supabase
    .from('hermes_memory_archive')
    .select('summary, created_at')
    .eq('session_key', sessionKey)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (query) {
    q = q.ilike('summary', `%${query}%`);
  }

  const { data, error } = await q;
  if (error || !data?.length) return [];
  return data.map(r => ({
    content: `[${new Date(r.created_at).toLocaleDateString('id-ID')}] ${r.summary}`
  }));
}

function buildMemoryInjection(localData, longTermEntries = []) {
  const parts = [];
  if (localData?.summary) parts.push(`Ringkasan sesi saat ini: ${localData.summary}`);
  if (longTermEntries.length > 0) {
    parts.push(`Riwayat sesi lama:\n${longTermEntries.map(t => t.content).join('\n')}`);
  }
  return parts.length
    ? `\n\n---\n[MEMORY CONTEXT - gunakan sebagai konteks internal, jangan diungkapkan ke user. Jika user bertanya "tadi" atau "sebelumnya", jawab berdasarkan ini.]\n${parts.join('\n\n')}\n[END MEMORY]\n---`
    : '';
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
// 
//  PAYLOAD TRANSFORMER AND GEMINI FALLBACK 
//  
// ============================================================
function toGeminiPayload(body, reqId, memoryInjection, sessionKey) {
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
      let toolContent = msg.content;

      // ── Copilot session: compress tool output ──
      if (sessionKey === 'copilot') {
        const before = (toolContent || '').length;
        toolContent = compressToolOutput(toolContent, reqId);
        const after = (toolContent || '').length;
        if (before !== after) LOG.trim(`[${reqId}] Gemini tool output compressed: ${before} → ${after} chars (-${before - after})`);
      }

      LOG.tool(`[${reqId}] Tool result: name=${msg.name || 'terminal'} → "${String(toolContent || '').slice(0, 80)}"`);
      contents.push({ role: 'user', parts: [{ functionResponse: { name: msg.name || 'terminal', response: { output: toolContent } } }] });
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

    // Re-inject tool_calls as functionCall parts
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
    const payload = body._cachedPayload;
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
            if (/thought_signature/i.test(message)) {
              LOG.warn(`[${reqId}] tok#${tokenIndex} thought_signature error: ${message.slice(0, 120)}`);
              return reject({ type: 'API_ERROR', message, index: tokenIndex });
            }
            LOG.err(`[${reqId}] tok#${tokenIndex} API error (${code}): ${message.slice(0, 120)}`);
            return reject({ type: 'API_ERROR', message, index: tokenIndex });
          }

          const hasContent = json.candidates?.[0]?.content?.parts?.length > 0;
          if (!hasContent) {
            LOG.warn(`[${reqId}] tok#${tokenIndex} Mengembalikan JSON valid tapi tanpa konten/kandidat text.`);
            return reject({ type: 'EMPTY_CONTENT', message: 'No content candidates', index: tokenIndex });
          }

          const finishReason = json.candidates?.[0]?.finishReason;
          if (finishReason && finishReason !== 'STOP' && finishReason !== 'MAX_TOKENS') {
            LOG.warn(`[${reqId}] tok#${tokenIndex} finishReason=${finishReason} → skip`);
            return reject({ type: 'BLOCKED', message: `finishReason: ${finishReason}`, index: tokenIndex });
          }

          const parts = json.candidates[0].content.parts;
          const hasRealContent = parts.some(p => (p.text && p.text.trim().length > 0) || p.functionCall);
          if (!hasRealContent) {
            LOG.warn(`[${reqId}] tok#${tokenIndex} parts ada tapi semua kosong → retry`);
            return reject({ type: 'EMPTY_CONTENT', message: 'Parts exist but all empty', index: tokenIndex });
          }

          const ms = Date.now() - t0;
          const usage = json.usageMetadata || {};
          const inTok = usage.promptTokenCount || 0;
          const outTok = usage.candidatesTokenCount || 0;
          
          LOG.win(`[${reqId}] ✓ ${ms}ms | in=${inTok} out=${outTok} tokens`);
          
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

async function tryModelWithPool(body, model, startIndex, reqId, timeoutMs, sessionKey) {
  body._cachedPayload = toGeminiPayload(body, reqId, body._memoryInjection, sessionKey);
  
  const total = GEMINI_TOKEN_POOL.length;
  const MAX_ROUNDS = 2;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    LOG.think(`[${reqId}] Model=${model} | Round ${round + 1}/${MAX_ROUNDS}`);
    
    for (let offset = 0; offset < total; offset++) {
      const idx = (startIndex + offset) % total;
      LOG.race(`[${reqId}] Trying tok#${idx}`);
      
      try {
        const result = await callGemini(body, GEMINI_TOKEN_POOL[idx], idx, model, reqId, timeoutMs);
        return { res: result, idx };
      } catch (err) {
        LOG.warn(`[${reqId}] tok#${idx} failed: ${err?.type} → next`);
        
        if (/thought_signature/i.test(err?.message || '')) {
          LOG.fallback(`[${reqId}] thought_signature → skip model "${model}"`);
          return null;
        }
        
        if (err?.type === 'API_ERROR' && /not found|invalid|does not exist|unsupported/i.test(err?.message || '')) {
          LOG.fallback(`[${reqId}] Model "${model}" tidak valid → skip`);
          return null;
        }
        
        continue;
      }
    }
    
    if (round < MAX_ROUNDS - 1) {
      LOG.fallback(`[${reqId}] Round ${round + 1} habis → retry 500ms`);
      await new Promise(r => setTimeout(r, 500));
    }
  }
  
  return null;
}

// ============================================================
// 
//  SESSION AND MOCK HANDLER FOR OPENAI RESPONSE
// 
// ============================================================
function toOpenRouterPayload(body, model, memoryInjection, sessionKey, reqId) {
  const rawMessages = body.messages || [];
  const systemMessages = rawMessages.filter(m => m.role === 'system');
  let chatMessages = rawMessages.filter(m => m.role !== 'system');
  const messages = compressMessages([...systemMessages, ...chatMessages]);

  // ── Copilot session: compress tool outputs sebelum dikirim ke OpenRouter ──
  const compressedMessages = compressOpenRouterMessages(messages, sessionKey, reqId || 'or');

  const finalMessages = compressedMessages.map(m => {
    if (m.role === 'system') {
      return { ...m, content: `${PERSONA}\n\n---\n\n${m.content || ''}${memoryInjection || ''}` };
    }
    return m;
  });
  if (!compressedMessages.some(m => m.role === 'system') && PERSONA) {
    finalMessages.unshift({ role: 'system', content: `${PERSONA}${memoryInjection || ''}` });
  }

  const payload = {
    model: model,
    messages: finalMessages,
    stream: false
  };

  if (body.max_tokens) {
    payload.max_tokens = Math.min(Math.max(body.max_tokens || 1024, 512), 4096);
  }

  if (body.tools && body.tools.length > 0) {
    LOG.tool(`[OpenRouter] Meneruskan ${body.tools.length} tools asli ke model: ${model}`);
    payload.tools = body.tools;
  }

  return JSON.stringify(payload);
}

function callOpenRouter(body, model, reqId, timeoutMs, sessionKey, apiKey) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    if (!apiKey) return reject({ type: 'CONFIG_ERROR', message: 'OPENROUTER_API_KEY kosong' });
    const payload = toOpenRouterPayload(body, model, body._memoryInjection, sessionKey, reqId);
    let done = false;
    LOG.race(`[${reqId}] Firing OpenRouter → ${model} (timeout=${timeoutMs}ms)`);
    const options = {
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/brotherzhafif',
        'X-Title': 'Hermes Copilot Engine',
        'Content-Length': Buffer.byteLength(payload)
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        if (done) return;
        try {
          const json = JSON.parse(raw);
          if (json.error) {
            LOG.warn(`[${reqId}] OpenRouter API error: ${json.error.message}`);
            return reject({ type: 'API_ERROR', message: json.error.message });
          }
          const msg = json.choices?.[0]?.message;
          if (!msg) return reject({ type: 'EMPTY_CONTENT', message: 'No choices returned' });
          const ms = Date.now() - t0;
          const usage = json.usage || {};
          LOG.win(`[${reqId}] OpenRouter ✓ ${ms}ms | in=${usage.prompt_tokens || 0} out=${usage.completion_tokens || 0} tokens`);
          recordRequestRemote({ model, inputTokens: usage.prompt_tokens || 0, outputTokens: usage.completion_tokens || 0, tokenIdx: 99, success: true, ms });
          
          const pseudoGemini = {
            candidates: [{
              content: { parts: [] },
              finishReason: 'STOP'
            }],
            usageMetadata: {
              promptTokenCount: usage.prompt_tokens || 0,
              candidatesTokenCount: usage.completion_tokens || 0
            }
          };

          if (msg.tool_calls && msg.tool_calls.length > 0) {
            LOG.tool(`[${reqId}] OpenRouter mendeteksi pemicu tools eksekusi berkas: [${msg.tool_calls.map(t => t.function?.name).join(', ')}]`);
            msg.tool_calls.forEach(tc => {
              let parsedArgs = {};
              try {
                parsedArgs = typeof tc.function.arguments === 'string' 
                  ? JSON.parse(tc.function.arguments) 
                  : tc.function.arguments;
              } catch (e) {
                parsedArgs = { raw: tc.function.arguments };
              }

              pseudoGemini.candidates[0].content.parts.push({
                functionCall: { 
                  name: tc.function.name, 
                  args: parsedArgs 
                }
              });
            });
          } else if (msg.content) {
            pseudoGemini.candidates[0].content.parts.push({ text: msg.content });
          }

          resolve(pseudoGemini);
        } catch (e) {
          LOG.err(`[${reqId}] OpenRouter parse error: ${e.message}`);
          reject({ type: 'PARSE_ERROR', message: e.message });
        }
      });
    });
    req.setTimeout(timeoutMs, () => { done = true; req.destroy(); LOG.warn(`[${reqId}] OpenRouter TIMEOUT`); reject({ type: 'TIMEOUT' }); });
    req.on('error', e => { if (!done) { LOG.err(`[${reqId}] OpenRouter network: ${e.message}`); reject({ type: 'NETWORK_ERROR', message: e.message }); } });
    req.write(payload); req.end();
  });
}

async function callWithFallback(body, requestedModel, startIndex, reqId, timeoutMs, sessionKey) {
  const isOpenRouterSession = sessionKey === 'copilot' || sessionKey === 'sebastian';

  if (isOpenRouterSession) {
    const chain = sessionKey === 'copilot' ? OPENROUTER_COPILOT_CHAIN : OPENROUTER_WHATSAPP_CHAIN;
    LOG.think(`[${reqId}] OpenRouter chain aktif untuk session: ${sessionKey} (${chain.length} models x ${OPENROUTER_TOKEN_POOL.length || 1} tokens)`);
    
    for (let i = 0; i < chain.length; i++) {
      const model = chain[i];

      const tokens = OPENROUTER_TOKEN_POOL.length > 0 ? OPENROUTER_TOKEN_POOL : [process.env.OPENROUTER_API_KEY];

      for (let t = 0; t < tokens.length; t++) {
        LOG.fallback(`[${reqId}] OpenRouter ${i + 1}/${chain.length}: "${model}" (tok#${t})`);
        try {
          const result = await callOpenRouter(body, model, reqId, timeoutMs, sessionKey, tokens[t]);
          if (result) return { res: result, idx: startIndex, model };
        } catch (err) {
          LOG.warn(`[${reqId}] OpenRouter "${model}" tok#${t} failed (${err?.type}) → next`);
          if (err?.type === 'API_ERROR' && /rate limit/i.test(err?.message || '')) {
            continue;
          }
          break;
        }
      }
    }

    LOG.fallback(`[${reqId}] Semua OpenRouter ${sessionKey} exhausted → last resort Gemini`);
  }

  // Gemini pool (default untuk sesi lain, atau last resort untuk copilot/whatsapp)
  const resolvedModel = resolveModel(requestedModel);
  const modelQueue = [resolvedModel, ...MODEL_FALLBACK_CHAIN.filter(m => m !== resolvedModel)];
  LOG.think(`[${reqId}] Gemini queue: ${modelQueue.join(' → ')}`);

  for (let i = 0; i < modelQueue.length; i++) {
    const model = modelQueue[i];
    LOG.fallback(`[${reqId}] Gemini ${i + 1}/${modelQueue.length}: "${model}"`);
    const result = await tryModelWithPool(body, model, startIndex, reqId, timeoutMs, sessionKey);
    if (result) return { ...result, model };
    LOG.fallback(`[${reqId}] "${model}" gagal → next`);
  }

  LOG.exhaust(`[${reqId}] Semua model & token habis → POOL_EXHAUSTED`);
  throw new Error('POOL_EXHAUSTED');
}

function buildOpenAIResponse(geminiRes, chunkId, model, stream, res, reqId, sessionKey) {
  const candidate = geminiRes.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const firstPart = parts[0];

  if (firstPart?.functionCall) {
    const toolCalls = parts.filter(p => p.functionCall).map((p, i) => {
      const cleanArgs = JSON.parse(JSON.stringify(p.functionCall.args || {}, (k, v) =>
        typeof v === 'string' ? stripResponseTags(v) : v
      ));
      return {
        id: `call_${chunkId}_${i}`, type: 'function',
        function: { name: p.functionCall.name, arguments: JSON.stringify(cleanArgs) }
      };
    });
    LOG.out(`[${reqId}] → TOOL_CALLS: [${toolCalls.map(t => t.function.name).join(', ')}]`);
    const payload = {
      id: chunkId, object: 'chat.completion',
      created: Math.floor(Date.now() / 1000), model,
      choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: toolCalls }, finish_reason: 'tool_calls' }]
    };
    if (stream) {
      if (!res.headersSent) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
      }
      res.write(`data: ${JSON.stringify({ ...payload, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: toolCalls }, finish_reason: 'tool_calls' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    return res.json(payload);
  }

  const rawText = parts.map(p => p.text || '').join('').trimStart();
  const responseMatch = rawText.match(/<response>([\s\S]*?)<\/response>/i);
  const compactMatch  = rawText.match(/<compact>([\s\S]*?)<\/compact>/i);
  let text       = responseMatch ? responseMatch[1].trim() : rawText;
  const compact  = compactMatch  ? compactMatch[1].trim()  : null;

  if (compact) {
    LOG.memory(`[${reqId}] Compact parsed: "${compact}"`);
    res._inlineCompact = compact;
  }

  // Fallback: tag bocor/tidak closed → strip manual
  if (!responseMatch && /<response>|<\/response>|<compact>|<\/compact>/i.test(text)) {
    LOG.warn(`[${reqId}] Tag <response>/<compact> bocor, fallback strip manual`);
    text = text
      .replace(/<\/?response>/gi, '')
      .replace(/<compact>[\s\S]*$/i, '')
      .replace(/<\/compact>/gi, '')
      .trim();
  }

  // Deteksi output kacau: JSON mentah bocor di LUAR tag <code>, atau kosong
  const textOutsideCode = text.replace(/<code>[\s\S]*?<\/code>/gi, '');
  const looksLikeRawJSON = sessionKey === 'sebastian' &&
    /\{[\s\S]*"question"\s*:[\s\S]*"choices"\s*:\s*\[/i.test(textOutsideCode);
  if (!text || looksLikeRawJSON) {
    LOG.warn(`[${reqId}] Output rusak/bocor (raw JSON di luar <code>, atau kosong) → fallback message`);
    text = 'Maaf, kepikiran sesuatu yang aneh barusan. Bisa diulang pertanyaannya?';
  }

  LOG.out(`[${reqId}] → TEXT: ${text.length} chars | "${text.slice(0, 100).replace(/\n/g, ' ')}"`);

  if (stream) {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
    }
    res.write(`data: ${JSON.stringify({ id: chunkId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: 'stop' }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    return res.end();
  }

  return res.json({ id: chunkId, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } });
}

function sendError(chunkId, model, message, stream, res, reqId) {
  LOG.err(`[${reqId}] Sending error: "${message}"`);
  if (stream) {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
    }
    res.write(`data: ${JSON.stringify({ id: chunkId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { content: message }, finish_reason: 'stop' }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    return res.end();
  }
  return res.json({ id: chunkId, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message: { role: 'assistant', content: message }, finish_reason: 'stop' }] });
}

function hashKey(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

// ============================================================
// 
//    HANDLE CHAT FUNCTION INPUT AND OUTPUT HANDLER
// 
// ============================================================
async function handleChat(req, res) {
  const body = req.body;
  const messages = body.messages || [];
  const stream = body.stream === true;
  const model = body.model || DEFAULT_MODEL;
  const maxTokens = body.max_tokens || 9999;
  const chunkId = `chatcmpl-${Date.now()}`;
  const reqId = chunkId.slice(-8);
  
  body._t0 = Date.now();

  LOG.req(`[${reqId}] POST /chat | model=${model} msgs=${messages.length} stream=${stream} maxTok=${maxTokens}`);
  healthStats.totalRequests++;

  if (!messages.length) {
    LOG.warn(`[${reqId}] Request kosong → ping`);
    return res.json({ choices: [{ message: { role: 'assistant', content: 'Bridge aktif!' } }] });
  }

  const lastContent = String(messages.at(-1)?.content || '').toLowerCase();
  const sysContent = String(messages.find(m => m.role === 'system')?.content || '');
  const hasToolChain = messages.some(m =>
    m.role === 'tool' ||
    m.role === 'function' ||
    (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0)
  );

  const isTitleRequest =
    !hasToolChain &&
    !body.tools?.length &&
    (maxTokens <= 30 ||
      lastContent.includes('title') ||
      lastContent.includes('judul') ||
      lastContent.includes('summarize this session') ||
      /generate a short.*title/i.test(sysContent));

  if (isTitleRequest) {
    LOG.think(`[${reqId}] Title/summary bypass → balas cepat`);
    return res.json({ id: chunkId, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, message: { role: 'assistant', content: 'Sebastian Session' }, finish_reason: 'stop' }] });
  }

  const timeoutMs = hasToolChain ? TIMEOUT_TOOL : TIMEOUT_NORMAL;
  if (hasToolChain) LOG.think(`[${reqId}] Tool chain detected → timeout=${timeoutMs}ms`);

  const firstUserMsg = String(messages.find(m => m.role === 'user')?.content || '');
  const isCronjob = /\[IMPORTANT:.*cron job/i.test(firstUserMsg) ||
                  /cron job.*failed/i.test(firstUserMsg);
  const sessionKey = isCronjob
    ? `cron_${hashKey(firstUserMsg.slice(0, 100))}`
    : /expert ai programming|vs code|github copilot|cline|roo clinic/i.test(sysContent) ? 'copilot'
    : /asisten pribadi|sebastian/i.test(sysContent) ? 'sebastian'
    : hashKey(sysContent.slice(0, 200));
  const ERROR_MSG = 'Tuan Zhafif, Sebastian Sedang Istirahat Karena Kelelahan';

  const localMemory = isCronjob ? null : await loadLocalMemory(sessionKey);

  const lastUserMsg = String(messages.findLast(m => m.role === 'user')?.content || '');
  const isSemanticQuery = !isCronjob && SEMANTIC_TRIGGERS.test(lastUserMsg) && !!localMemory?.summary;
  const longTermEntries = isSemanticQuery ? await searchLongTermMemory(sessionKey, null, 5) : [];

  if (isSemanticQuery) LOG.memory(`[${reqId}] Semantic trigger aktif → pull long-term memory (${longTermEntries.length} entries)`);

  const memoryInjection = isCronjob ? '' : buildMemoryInjection(localMemory, longTermEntries);

  if (memoryInjection) LOG.memory(`[${reqId}] Memory injected (${memoryInjection.length} chars)`);
  else if (isCronjob) LOG.memory(`[${reqId}] Cronjob → skip memory`);

  body._memoryInjection = memoryInjection;

  const cachedIndex = await getSessionIndexRemote(sessionKey);
  const startIndex = cachedIndex ?? globalIndex;
  if (cachedIndex === null) LOG.session(`[${reqId}] 🆕 Sesi baru "${sessionKey.slice(0, 20)}..." → startIndex=tok#${startIndex}`);
  else LOG.session(`[${reqId}] 📌 Sesi lama "${sessionKey.slice(0, 20)}..." → locked ke tok#${startIndex}`);

  let heartbeat;
  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    heartbeat = setInterval(() => res.write(': ping\n\n'), 5000);
  }

  try {
    const { res: geminiRes, idx: winnerIdx, model: usedModel } = await callWithFallback(body, model, startIndex, reqId, timeoutMs, sessionKey);
    if (heartbeat) clearInterval(heartbeat);
    setSessionIndexRemote(sessionKey, winnerIdx);
    globalIndex = (winnerIdx + 1) % GEMINI_TOKEN_POOL.length;

    if (!isCronjob) {
      const rawAssistantText = geminiRes.candidates?.[0]?.content?.parts
        ?.filter(p => p.text)?.map(p => p.text)?.join('') || '';
      const responseMatch = rawAssistantText.match(/<response>([\s\S]*?)<\/response>/i);
      const compactMatch  = rawAssistantText.match(/<compact>([\s\S]*?)<\/compact>/i);
      const assistantText = responseMatch ? responseMatch[1].trim() : rawAssistantText;
      const compact = compactMatch ? compactMatch[1].trim() : null;
      if (compact) LOG.memory(`[${reqId}] Compact: "${compact}"`);

      const newTurns = [];

      if (lastUserMsg) {
        const userContent = lastUserMsg.length > 200 ? lastUserMsg.slice(0, 200) + '...' : lastUserMsg;
        newTurns.push({ role: 'user', content: userContent, ts: Date.now() });
      }

      if (assistantText || compact) {
        newTurns.push({ role: 'assistant', content: compact || assistantText, ts: Date.now() });
      }

      const previousTurns = Array.isArray(localMemory?.turns) ? localMemory.turns : [];
      let combinedTurns = [...previousTurns, ...newTurns];
      let sessionSummary = localMemory?.summary || null;

      LOG.memory(`[${reqId}] Turns: prev=${previousTurns.length} new=${newTurns.length} combined=${combinedTurns.length}`);

      if (combinedTurns.length >= MEMORY_CONFIG.summary_threshold) {
        const summaryPrompt = `Ringkasan sebelumnya: ${sessionSummary || '(belum ada)'}
          Percakapan baru:
          ${combinedTurns.map(t => `${t.role}: ${t.content}`).join('\n')}

          Buat SATU ringkasan baru yang menggabungkan ringkasan sebelumnya dengan percakapan baru ini. Maksimal 2-3 kalimat (sekitar 50-80 kata), fokus pada topik dan poin penting. Jangan sebut "ringkasan sebelumnya", langsung tulis hasil gabungannya.`; 
        try {
          const summaryBody = { messages: [{ role: 'user', content: summaryPrompt }], _memoryInjection: '' };
          summaryBody._cachedPayload = toGeminiPayload(summaryBody, reqId + '_sum', '');
          const { res: sumRes } = await tryModelWithPool(summaryBody, DEFAULT_MODEL, globalIndex, reqId + '_sum', TIMEOUT_NORMAL);
          const sumParts = sumRes?.candidates?.[0]?.content?.parts || [];
          const sumRaw = sumParts.map(p => p.text || '').join('').trim();
          const sumMatch = sumRaw.match(/<response>([\s\S]*?)<\/response>/i);
          const newSummary = sumMatch ? sumMatch[1].trim() : sumRaw;

          if (newSummary) {
            archiveSummary(sessionKey, sessionSummary);
            sessionSummary = newSummary;
            combinedTurns = [];
            LOG.memory(`[${reqId}] Summary baru: "${newSummary.slice(0, 100)}" | turns direset`);
          }
        } catch (e) {
          LOG.warn(`[${reqId}] Gagal buat summary: ${e.message}`);
        }
      }

      saveLocalMemory(sessionKey, combinedTurns.slice(-MEMORY_CONFIG.summary_threshold), sessionSummary);
    }

    LOG.win(`[${reqId}] ✅ Done — model=${usedModel} winner=tok#${winnerIdx} globalIndex→tok#${globalIndex}`);
    healthStats.successfulRequests++;
    return buildOpenAIResponse(geminiRes, chunkId, usedModel, stream, res, reqId, sessionKey);

  } catch (err) {
    if (heartbeat) clearInterval(heartbeat);
    healthStats.failedRequests++;
    
    if (err?.code === 'ERR_HTTP_HEADERS_SENT' || res.headersSent) {
        LOG.warn(`[${reqId}] Double-response (headers sent), ignoring`);
        return;
    }
    
    const tookMs = Date.now() - (body._t0 || 0);
    LOG.err(`[${reqId}] ERR /chat | model=${model} stream=${stream} took=${tookMs}ms err="${err.message}"`);
    setSessionIndexRemote(sessionKey, (startIndex + 1) % GEMINI_TOKEN_POOL.length);
    recordRequestRemote({ model, inputTokens: 0, outputTokens: 0, tokenIdx: -1, success: false, ms: 0 });
    return sendError(chunkId, model, ERROR_MSG, stream, res, reqId);
  }
}

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use((req, res, next) => { const key = `${req.method}:${req.path}`; if (!LOG_SUPPRESS.has(key)) LOG.req(`→ [${req.method}] ${req.url} | IP: ${req.ip}`); next(); });

const initDashboardRouter = require('./dashboard.cjs');
app.use('/dashboard', initDashboardRouter(supabase, process.env.SUPABASE_URL, process.env.SUPABASE_KEY));

const MODELS_LIST = {
  object: 'list',
  data: [
    ...MODEL_FALLBACK_CHAIN,
    ...OPENROUTER_COPILOT_CHAIN,
    ...OPENROUTER_WHATSAPP_CHAIN,
  ].map(id => ({ id, object: 'model', created: 1700000000, owned_by: 'google' }))
};

// ============================================================
// HEALTH CHECK ENDPOINT
// ============================================================
app.get('/health', (req, res) => {
  healthStats.lastUpdated = new Date();
  const uptime = (Date.now() - healthStats.startTime.getTime()) / 1000;
  const response = {
    status: 'OK',
    uptime: `${uptime.toFixed(2)}s`,
    totalRequests: healthStats.totalRequests,
    successfulRequests: healthStats.successfulRequests,
    failedRequests: healthStats.failedRequests,
    successRate: healthStats.totalRequests === 0 ? 0 : (healthStats.successfulRequests / healthStats.totalRequests * 100).toFixed(2),
    totalTokens: healthStats.totalTokens,
    memoryUsage: process.memoryUsage(),
    config: {
      MAX_TURNS: MEMORY_CONFIG.max_turns,
      TRIM_CHARS: MEMORY_CONFIG.trim_chars,
      INJECTION_TURNS: MEMORY_CONFIG.injection_turns,
      SUMMARY_THRESHOLD: MEMORY_CONFIG.summary_threshold,
      PURGE_DAYS: MEMORY_CONFIG.purgeDays,
      OPENAI_MODEL: process.env.OPENAI_MODEL || 'default',
      GEMINI_MODEL: process.env.GEMINI_MODEL || 'default',
      FALLBACK_MODELS: MODEL_FALLBACK_CHAIN.join(','),
      LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    }
  };
  res.status(200).json(response);
});

app.post('/v1/chat/completions', handleChat);
app.post('/chat/completions', handleChat);
app.get('/v1/models', (_, res) => res.json(MODELS_LIST));
app.use((req, res) => {
  if (req.method === 'POST') return handleChat(req, res);
  if (req.path === '/' || req.path === '') return res.redirect('/dashboard');
  return res.json({ status: 'Hermes Bridge Active', engine: 'Sebastian Engine v11' });
});

app.delete('/memory/all', async (req, res) => {
  const { error } = await supabase.from('hermes_sessions')
    .update({ turns: [], summary: null })
    .neq('session_key', '__never__');
  if (error) return res.status(500).json({ ok: false, error: error.message });
  LOG.memory('Memory: semua sesi direset');
  res.json({ ok: true, message: 'Semua memory sesi direset' });
});

app.delete('/memory/today', async (req, res) => {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const today = wib.toISOString().slice(0, 10);
  const { error, count } = await supabase.from('hermes_sessions')
    .update({ turns: [], summary: null })
    .gte('last_active', `${today}T00:00:00+07:00`)
    .lte('last_active', `${today}T23:59:59+07:00`);
  if (error) return res.status(500).json({ ok: false, error: error.message });
  LOG.memory(`Memory: sesi hari ini direset (count=${count})`);
  res.json({ ok: true, message: `Sesi hari ini (${today}) direset` });
});

app.get('/memory/list', async (req, res) => {
  const { data, error } = await supabase.from('hermes_sessions')
    .select('session_key, summary, last_active')
    .order('last_active', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ ok: false, error: error.message });
  res.json({ ok: true, sessions: data });
});

app.delete('/memory/:sessionKey', async (req, res) => {
  const { sessionKey } = req.params;
  const { error } = await supabase.from('hermes_sessions')
    .update({ turns: [], summary: null })
    .eq('session_key', sessionKey);
  if (error) return res.status(500).json({ ok: false, error: error.message });
  LOG.memory(`Memory: sesi "${sessionKey}" direset`);
  res.json({ ok: true, message: `Sesi "${sessionKey}" direset` });
});

app.get('/memory/search', async (req, res) => {
  const { q, from, to, session = 'sebastian' } = req.query;
  let query = supabase.from('hermes_memory_archive')
    .select('summary, created_at')
    .eq('session_key', session)
    .order('created_at', { ascending: false });

  if (q) query = query.ilike('summary', `%${q}%`);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);

  const { data, error } = await query.limit(50);
  if (error) return res.status(500).json({ ok: false, error: error.message });
  res.json({ ok: true, results: data });
});

app.listen(PORT, () => {
  LOG.boot(`Hermes v11 running on :${PORT}`);
  LOG.boot(`Dashboard → http://localhost:${PORT}/dashboard`);
  LOG.boot(`Pool: ${GEMINI_TOKEN_POOL.length} tokens | Default: ${DEFAULT_MODEL}`);
  LOG.boot(`Timeout: normal=${TIMEOUT_NORMAL}ms tool-chain=${TIMEOUT_TOOL}ms`);
});
