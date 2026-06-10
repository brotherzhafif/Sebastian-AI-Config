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
const TIMEOUT_NORMAL = 30_000;
const TIMEOUT_TOOL   = 60_000;

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

const MEMORY_CONFIG = {
  max_turns: 16,
  trim_chars: 150,
  injection_turns: 4,
  summary_threshold: 15,
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

function stripResponseTags(text) {
  if (!text || typeof text !== 'string') return text;
  const match = text.match(/<response>([\s\S]*?)<\/response>/i);
  if (match) return match[1].trim();
  return text.replace(/<summary>[\s\S]*?<\/summary>/gi, '').trim();
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

// ============================================================
// MULTI-SOURCE MEMORY
// ============================================================
async function loadLocalMemory(sessionKey) {
  const { data, error } = await supabase
    .from('hermes_memory')
    .select('summary, turns, last_active')
    .eq('session_key', sessionKey)
    .maybeSingle();
  if (error || !data) return null;

  // Filter tool-related turns dari stored memory
  if (data.turns) {
    data.turns = data.turns.filter(t => t.role !== 'tool' && t.role !== 'function');
  }

  return data;
}

function saveLocalMemory(sessionKey, turns, summary) {
  const trimmedTurns = turns;
  supabase.from('hermes_memory')
    .upsert(
      { session_key: sessionKey, summary: summary || null, turns: trimmedTurns, updated_at: new Date(), last_active: new Date() },
      { onConflict: 'session_key' }
    )
    .then(({ error }) => {
      if (error) LOG.err(`Gagal save memory: ${error.message}`);
      else LOG.memory(`Memory saved → session="${sessionKey.slice(0, 20)}" turns=${trimmedTurns.length}`);
    });
}

async function loadRelevantCrossTurns(currentSessionKey) {
  const { data, error } = await supabase
    .from('hermes_memory')
    .select('session_key, turns, last_active')
    .neq('session_key', currentSessionKey)
    .not('turns', 'is', null)
    .order('last_active', { ascending: false })
    .limit(5);
  if (error || !data?.length) return [];
  return data.flatMap(r =>
    (r.turns || []).slice(-2).map(t => ({ role: t.role, content: t.content }))
  );
}

function buildMemoryInjection(localData, crossTurns = []) {
  const parts = [];
  if (localData?.summary) parts.push(`Ringkasan: ${localData.summary}`);
  if (localData?.turns?.length) {
    const recent = localData.turns.slice(-MEMORY_CONFIG.injection_turns);
    parts.push(`Percakapan sebelumnya (lanjutkan dari sini):\n${recent.map(t => `${t.role}: ${t.content}`).join('\n')}`);
  }
  if (crossTurns.length > 0) {
    parts.push(`Konteks sesi lain yang relevan:\n${crossTurns.map(t => `${t.role}: ${t.content}`).join('\n')}`);
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

          // VALIDASI STRUKTUR KONTEN NYATA SEBELUM MENCATAT LOG SUKSES
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

          // ✅ Tambah ini — cek apakah ada teks atau functionCall yang nyata
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
          
          LOG.win(`[${reqId}] tok#${tokenIndex} ✓ ${ms}ms | in=${inTok} out=${outTok} tokens`);
          
          // Catat ke Supabase hanya jika benar-benar lolos validasi konten riyal!
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

async function tryModelWithPool(body, model, startIndex, reqId, timeoutMs) {
  body._cachedPayload = toGeminiPayload(body, reqId, body._memoryInjection);
  
  const total = TOKEN_POOL.length;
  const MAX_ROUNDS = 2;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    LOG.think(`[${reqId}] Model=${model} | Round ${round + 1}/${MAX_ROUNDS}`);
    
    for (let offset = 0; offset < total; offset++) {
      const idx = (startIndex + offset) % total;
      LOG.race(`[${reqId}] Trying tok#${idx}`);
      
      try {
        const result = await callGemini(body, TOKEN_POOL[idx], idx, model, reqId, timeoutMs);
        return { res: result, idx };
      } catch (err) {
        LOG.warn(`[${reqId}] tok#${idx} failed: ${err?.type} → next`);
        
        // thought_signature = model incompatible, skip langsung ke model lain
        if (/thought_signature/i.test(err?.message || '')) {
          LOG.fallback(`[${reqId}] thought_signature → skip model "${model}"`);
          return null;
        }
        
        // model invalid = skip langsung
        if (err?.type === 'API_ERROR' && /not found|invalid|does not exist|unsupported/i.test(err?.message || '')) {
          LOG.fallback(`[${reqId}] Model "${model}" tidak valid → skip`);
          return null;
        }
        
        // quota/rate limit = coba token berikutnya
        // timeout/network = coba token berikutnya
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

async function callWithFallback(body, requestedModel, startIndex, reqId, timeoutMs) {
  const resolvedModel = resolveModel(requestedModel);
  let modelQueue = [resolvedModel, ...MODEL_FALLBACK_CHAIN.filter(m => m !== resolvedModel)];

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
  const summaryMatch  = rawText.match(/<summary>([\s\S]*?)<\/summary>/i);
  const text    = responseMatch ? responseMatch[1].trim() : rawText;
  const summary = summaryMatch  ? summaryMatch[1].trim()  : null;

  if (summary) {
    LOG.memory(`[${reqId}] Inline summary parsed: "${summary.slice(0, 80)}"`);
    res._inlineSummary = summary;
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
    : hashKey(sysContent.slice(0, 200));
  const ERROR_MSG = 'Tuan Zhafif, Sebastian Sedang Istirahat Karena Kelelahan';

  const localMemory = isCronjob ? null : await loadLocalMemory(sessionKey);

  const lastUserMsg = String(messages.findLast(m => m.role === 'user')?.content || '');
  const isSemanticQuery = !isCronjob && SEMANTIC_TRIGGERS.test(lastUserMsg);
  const crossTurns = isSemanticQuery ? await loadRelevantCrossTurns(sessionKey) : [];

  if (isSemanticQuery) LOG.memory(`[${reqId}] Semantic trigger aktif → pull cross turns`);

  const memoryInjection = isCronjob ? '' : buildMemoryInjection(localMemory, crossTurns);

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
    const { res: geminiRes, idx: winnerIdx, model: usedModel } = await callWithFallback(body, model, startIndex, reqId, timeoutMs);
    if (heartbeat) clearInterval(heartbeat);
    setSessionIndexRemote(sessionKey, winnerIdx);
    globalIndex = (winnerIdx + 1) % TOKEN_POOL.length;

    const HERMES_META_PATTERN = /<userRequest>|<environment_info>|<workspace_info>|<editorContext>|<attachments>|<context>|<reminderInstructions>/i;

    // Parse inline summary DULU sebelum save memory
    const rawAssistantText = geminiRes.candidates?.[0]?.content?.parts
      ?.filter(p => p.text)?.map(p => p.text)?.join('') || '';
    const responseMatch = rawAssistantText.match(/<response>([\s\S]*?)<\/response>/i);
    const summaryMatch  = rawAssistantText.match(/<summary>([\s\S]*?)<\/summary>/i);
    const inlineSummary = summaryMatch ? summaryMatch[1].trim() : null;
    if (inlineSummary) LOG.memory(`[${reqId}] Inline summary parsed: "${inlineSummary.slice(0, 80)}"`);

    if (!isCronjob) {
      const assistantText = responseMatch ? responseMatch[1].trim() : rawAssistantText;

      const existingTurns = localMemory?.turns || [];

      // [FIX] Pakai content-anchor bukan count/timestamp
      // Cari turn user/assistant terakhir yang tersimpan, lalu ambil sisanya dari client
      const lastExisting = existingTurns
        .filter(t => t.role === 'user' || t.role === 'assistant')
        .at(-1);

      const allClientTurns = messages
        .filter(m =>
          (m.role === 'user' || (m.role === 'assistant' && m.content)) &&
          m.content !== ERROR_MSG &&
          !HERMES_META_PATTERN.test(m.content || '') &&
          !(m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0)
        )
        .map(m => ({ role: m.role, content: m.content, ts: m.created_at ? new Date(m.created_at).getTime() : Date.now() }));

      let newTurns;
      if (!lastExisting) {
        // Belum ada yang tersimpan, ambil semua
        newTurns = allClientTurns;
      } else {
        // Cari index terakhir di allClientTurns yang match lastExisting
        const anchorIdx = allClientTurns.findLastIndex(
          t => t.role === lastExisting.role &&
               t.content?.trim() === lastExisting.content?.trim()
        );
        if (anchorIdx >= 0) {
          newTurns = allClientTurns.slice(anchorIdx + 1);
        } else {
          // Fallback: tidak ketemu anchor, hitung selisih count
          const existingCount = existingTurns.filter(
            t => t.role === 'user' || t.role === 'assistant'
          ).length;
          newTurns = allClientTurns.slice(existingCount);
          LOG.warn(`[${reqId}] Anchor not found, fallback ke count (existingCount=${existingCount})`);
        }
      }

      const mergedTurns = [...existingTurns, ...newTurns];

      // [FIX] Simpan assistantText (bukan inlineSummary) sebagai konten turn
      // inlineSummary hanya dipakai untuk sessionSummary
      if (assistantText) {
        mergedTurns.push({ role: 'assistant', content: assistantText, ts: Date.now() });
      }

      LOG.memory(`[${reqId}] Turns: existing=${existingTurns.length} new=${newTurns.length} total=${mergedTurns.length}`);

      let sessionSummary = inlineSummary || localMemory?.summary || null;
      if (inlineSummary) LOG.memory(`[${reqId}] Session summary dari inline: "${inlineSummary.slice(0, 80)}"`);

      if (!inlineSummary && mergedTurns.length >= MEMORY_CONFIG.summary_threshold) {
        const summaryPrompt = `Buat ringkasan singkat (maks 2 kalimat) dari percakapan berikut:\n${mergedTurns.map(t => `${t.role}: ${t.content}`).join('\n')}`;
        try {
          const summaryBody = { messages: [{ role: 'user', content: summaryPrompt }], _memoryInjection: '' };
          summaryBody._cachedPayload = toGeminiPayload(summaryBody, reqId + '_sum', '');
          const { res: sumRes } = await tryModelWithPool(summaryBody, DEFAULT_MODEL, globalIndex, reqId + '_sum', TIMEOUT_NORMAL);
          const sumParts = sumRes?.candidates?.[0]?.content?.parts || [];
          const sumRaw = sumParts.map(p => p.text || '').join('').trim();
          const sumMatch = sumRaw.match(/<response>([\s\S]*?)<\/response>/i);
          sessionSummary = sumMatch ? sumMatch[1].trim() : sumRaw;
          LOG.memory(`[${reqId}] Session summary dibuat: "${sessionSummary.slice(0, 80)}"`);
        } catch (e) {
          LOG.warn(`[${reqId}] Gagal buat session summary: ${e.message}`);
        }
      }

      const turnLimit = MEMORY_CONFIG.max_turns + Math.floor(mergedTurns.length / MEMORY_CONFIG.summary_threshold);
      saveLocalMemory(sessionKey, mergedTurns.slice(-turnLimit), sessionSummary);
    }

    LOG.win(`[${reqId}] ✅ Done — model=${usedModel} winner=tok#${winnerIdx} globalIndex→tok#${globalIndex}`);
    return buildOpenAIResponse(geminiRes, chunkId, usedModel, stream, res, reqId);

  } catch (err) {
    if (heartbeat) clearInterval(heartbeat);

    if (err?.code === 'ERR_HTTP_HEADERS_SENT' || res.headersSent) {
      LOG.warn(`[${reqId}] Double-response (headers sent), ignoring`);
      return;
    }

    LOG.exhaust(`[${reqId}] ❌ POOL_EXHAUSTED: ${err.message}`);
    setSessionIndexRemote(sessionKey, (startIndex + 1) % TOKEN_POOL.length);
    recordRequestRemote({ model, inputTokens: 0, outputTokens: 0, tokenIdx: -1, success: false, ms: 0 });
    return sendError(chunkId, model, ERROR_MSG, stream, res, reqId);
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
  return res.json({ status: 'Hermes Bridge Active', engine: 'Sebastian Engine v11' });
});

app.delete('/memory/all', async (req, res) => {
  const { error } = await supabase.from('hermes_memory').delete().neq('session_key', '__never__');
  if (error) return res.status(500).json({ ok: false, error: error.message });
  LOG.memory('Memory: semua sesi dihapus');
  res.json({ ok: true, message: 'Semua memory sesi dihapus' });
});

app.delete('/memory/today', async (req, res) => {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const today = wib.toISOString().slice(0, 10);
  const { error, count } = await supabase.from('hermes_memory')
    .delete()
    .gte('last_active', `${today}T00:00:00+07:00`)
    .lte('last_active', `${today}T23:59:59+07:00`);
  if (error) return res.status(500).json({ ok: false, error: error.message });
  LOG.memory(`Memory: sesi hari ini dihapus (count=${count})`);
  res.json({ ok: true, message: `Sesi hari ini (${today}) dihapus` });
});

app.delete('/memory/:sessionKey', async (req, res) => {
  const { sessionKey } = req.params;
  const { error } = await supabase.from('hermes_memory').delete().eq('session_key', sessionKey);
  if (error) return res.status(500).json({ ok: false, error: error.message });
  LOG.memory(`Memory: sesi "${sessionKey}" dihapus`);
  res.json({ ok: true, message: `Sesi "${sessionKey}" dihapus` });
});

app.get('/memory/list', async (req, res) => {
  const { data, error } = await supabase.from('hermes_memory')
    .select('session_key, summary, last_active')
    .order('last_active', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ ok: false, error: error.message });
  res.json({ ok: true, sessions: data });
});

app.listen(PORT, () => {
  LOG.boot(`Hermes v11 running on :${PORT}`);
  LOG.boot(`Dashboard → http://localhost:${PORT}/dashboard`);
  LOG.boot(`Pool: ${TOKEN_POOL.length} tokens | Default: ${DEFAULT_MODEL}`);
  LOG.boot(`Timeout: normal=${TIMEOUT_NORMAL}ms tool-chain=${TIMEOUT_TOOL}ms`);
});