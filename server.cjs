const fs = require('fs');
const path = require('path');

// Load persona files
const loadPersona = () => {
  try {
    const soul = fs.readFileSync(path.join(__dirname, 'SOUL.md'), 'utf8');
    const memory = fs.readFileSync(path.join(__dirname, 'memories', 'MEMORY.md'), 'utf8');
    const user = fs.readFileSync(path.join(__dirname, 'memories', 'USER.md'), 'utf8');
    return `${soul}\n\n---\n\n${memory}\n\n---\n\n${user}`;
  } catch (err) {
    console.warn('⚠️ Gagal load persona files:', err.message);
    return '';
  }
};

const SEBASTIAN_PERSONA = loadPersona();
console.log(`🧠 Persona Sebastian berhasil dimuat (${SEBASTIAN_PERSONA.length} chars)`);

const express = require('express');
const https = require('https');
require('dotenv').config();

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.url}`);
  next();
});

let tokenPool = [];
const thoughtSignatureCache = new Map();
const sessionTokenMap = new Map(); // Sinkronisasi token agar mengikat per turn chat (Sticky Session)

// =========================================================================
// 🔑 STRATEGI PARSING TOKEN CERDAS (Mendukung Format Lama AIzaSy & Baru AQ.Ab8)
// =========================================================================

// 1. Ambil manual dari variabel penamaan standar utama jika tervalidasi panjang
const explicitKeys = ['GEMINI_API_KEY', 'GOOGLE_API_KEY'];
explicitKeys.forEach(key => {
  const value = process.env[key];
  if (value && value.trim().length > 25) {
    tokenPool.push(value.trim());
  }
});

// 2. Scan otomatis seluruh key .env yang mengandung kata GOOGLE / GEMINI
Object.keys(process.env).forEach(key => {
  if ((key.includes('GEMINI') || key.includes('GOOGLE')) && !key.includes('URL')) {
    const value = process.env[key];
    if (value && typeof value === 'string') {
      const trimmedValue = value.trim();
      // Validasi: Panjang karakter harus masuk akal (>25) & bukan string konfigurasi nama model
      if (
        trimmedValue.length > 25 && 
        !trimmedValue.toLowerCase().includes('gemini-') && 
        !tokenPool.includes(trimmedValue)
      ) {
        tokenPool.push(trimmedValue);
      }
    }
  }
});

// 3. Fallback jika dideklarasikan via daftar koma massal
if (tokenPool.length === 0 && process.env.GEMINI_API_KEYS) {
  tokenPool = process.env.GEMINI_API_KEYS.split(',')
    .map(k => k.trim())
    .filter(k => k.length > 25);
}

console.log(`🔑 Berhasil mendeteksi ${tokenPool.length} token API dari file .env`);
tokenPool.forEach((token, index) => {
  console.log(`   👉 Index [${index}]: ${token.substring(0, 7)}...${token.substring(token.length - 4)}`);
});

let currentTokenIndex = 0;

// ==========================================
// 🧹 UTILITY: Pembersih Skema JSON untuk Gemini API
// ==========================================
const sanitizeGeminiSchema = (obj) => {
  if (Array.isArray(obj)) {
    return obj.map(sanitizeGeminiSchema);
  } else if (obj !== null && typeof obj === 'object') {
    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
      // Hapus properti extended JSON Schema yang dibenci hulu Gemini API
      if (
        key === '$comment' || 
        key === 'enumDescriptions' || 
        key === 'additionalProperties' ||
        key === '$schema'
      ) {
        continue;
      }
      // Rekursi untuk objek bersarang di dalamnya
      cleaned[key] = sanitizeGeminiSchema(value);
    }
    return cleaned;
  }
  return obj;
};

// FUNGSI UTAMA: Konversi format pesan OpenAI/Hermes ke Google AI Native Format
const transformPayloadOpenAIToGoogle = (openAiBody) => {
  const messages = openAiBody.messages || [];
  
  const contents = messages.map(msg => {
    // Jika ada peran function/tool response dari Hermes setelah eksekusi terminal
    if (msg.role === 'tool' || msg.role === 'function') {
      return {
        role: 'user',
        parts: [{ functionResponse: { name: msg.name || "terminal", response: { output: msg.content } } }]
      };
    }

    const parts = [];

    // Inject persona ke system message dari Continue.dev / Copilot
    if (msg.role === 'system') {
      if (SEBASTIAN_PERSONA) {
        parts.push({ text: SEBASTIAN_PERSONA + "\n\n---\n\n" + (msg.content || '') });
      } else {
        parts.push({ text: msg.content || '' });
      }
      return { role: 'user', parts };
    }

    if (msg.content) parts.push({ text: msg.content });
    
   // Jika Hermes/Copilot mengirimkan balik riwayat asisten yang berisi tool_calls sebelumnya
    if (msg.tool_calls) {
      msg.tool_calls.forEach((tc, idx) => {
        let args = {};
        try { 
          args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments; 
        } catch(e){}
        
        // ✨ SOLUSI AKTUAL: Tempelkan langsung SEJAJAR dengan functionCall, bukan di-push terpisah!
        const toolPart = {
          functionCall: { name: tc.function.name, args: args }
        };

        // Dokumentasi Google: Hanya unit functionCall pertama di setiap step yang wajib divalidasi signature-nya
        if (idx === 0) {
          toolPart.thoughtSignature = "skip_thought_signature_validator";
          toolPart.thought_signature = "skip_thought_signature_validator";
        }

        parts.push(toolPart);
      });
    }

    return {
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: parts
    };
  });

  // Kalau tidak ada system message sama sekali, prepend persona sebagai pesan pertama
  const hasSystem = messages.some(m => m.role === 'system');
  if (!hasSystem && SEBASTIAN_PERSONA) {
    contents.unshift({
      role: 'user',
      parts: [{ text: SEBASTIAN_PERSONA }]
    });
  }

  const googlePayload = { contents };

  // Pemetaan Objek Tools dengan Sanitisasi Ketat untuk Gemini API
  if (openAiBody.tools) {
    console.log("🧹 Menyaring schema tools dari Copilot untuk stabilitas Gemini API...");
    googlePayload.tools = [{
      functionDeclarations: openAiBody.tools.map(t => ({
        name: t.function.name,
        description: t.function.description || "Execute system commands",
        parameters: t.function.parameters ? sanitizeGeminiSchema(t.function.parameters) : undefined
      }))
    }];
  }

  return JSON.stringify(googlePayload);
};

const queryGoogleAI = (openAiBody, apiKey, index, requestedModel) => { 
  return new Promise((resolve, reject) => {
    const modelTarget = requestedModel || "gemini-3.5-flash"; 
    const payload = transformPayloadOpenAIToGoogle(openAiBody);

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${modelTarget}:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    let responseText = '';

    const googleReq = https.request(options, (googleRes) => {
      googleRes.on('data', (chunk) => { responseText += chunk.toString(); });
      
      googleRes.on('end', () => {
        try {
          const jsonResponse = JSON.parse(responseText);
          
          if (jsonResponse.error) {
            if (jsonResponse.error.message.includes('quota') || jsonResponse.error.code === 429) {
              console.warn(`⚠️ Token index ke-${index} terkena pembatasan kuota.`);
              return reject({ type: 'QUOTA', message: jsonResponse.error.message });
            }
            return reject({ type: 'GOOGLE_ERROR', message: jsonResponse.error.message });
          }

          resolve(jsonResponse);
        } catch (err) {
          reject({ type: 'PARSE_ERROR', message: 'Gagal parsing JSON dari hulu Google' });
        }
      });
    });

    googleReq.on('error', (e) => reject({ type: 'NETWORK_ERROR', message: e.message }));
    googleReq.write(payload);
    googleReq.end();
  });
};

const handleChat = async (req, res) => {
  const messages = req.body.messages || [];
  const isStreamRequested = req.body.stream === true;
  const maxTokensRequested = req.body.max_tokens || 9999;
  const requestedModel = req.body.model || "gemini-3.5-flash"; 
  const chunkId = `chatcmpl-${Date.now()}`;

  if (messages.length === 0) {
    return res.json({ choices: [{ message: { role: 'assistant', content: 'Bridge aktif!' } }] });
  }

  // === INTERSEPTOR TITLING SUPER AGRESIF ===
  const lastMessageContent = messages[messages.length - 1].content || "";
  if (
    maxTokensRequested <= 30 || 
    lastMessageContent.toLowerCase().includes('title') || 
    lastMessageContent.toLowerCase().includes('judul') ||
    lastMessageContent.toLowerCase().includes('summarize this session') ||
    req.url.includes('v1main')
  ) {
    console.log('🤫 Mencegat request Auxiliary Title Generation...');
    return res.json({
      id: chunkId, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: "gemini-3.5-flash",
      choices: [{ index: 0, message: { role: 'assistant', content: "Sebastian Session" }, finish_reason: "stop" }]
    });
  }

  // 🔑 LOGIK STICKY TOKEN BERDASARKAN STRUKTUR PESAN PERTAMA CHAT
  const firstMessageKey = messages[0]?.content ? messages[0].content.substring(0, 50) : "default_session";
  
  let targetTokenIndex;
  if (sessionTokenMap.has(firstMessageKey)) {
    // Jika multi-turn / tool calling berjalan, PAKSA kunci ke API key yang sama agar tidak tabrakan di internal Google
    targetTokenIndex = sessionTokenMap.get(firstMessageKey);
    console.log(`📌 [Sticky Session] Mengunci Sesi lama pada Token Index ke-${targetTokenIndex}`);
  } else {
    // Jika room baru dimulai, rotasikan token menggunakan round-robin standar
    targetTokenIndex = currentTokenIndex;
    sessionTokenMap.set(firstMessageKey, targetTokenIndex);
    currentTokenIndex = (currentTokenIndex + 1) % tokenPool.length;
    console.log(`🆕 [Sticky Session] Mendaftarkan Sesi Baru ke Token Index ke-${targetTokenIndex}`);
    
    setTimeout(() => { if(sessionTokenMap.has(firstMessageKey)) sessionTokenMap.delete(firstMessageKey); }, 1000 * 60 * 20);
  }

  let attempts = 0;
  const maxAttempts = tokenPool.length; 

  while (attempts < maxAttempts) {
    const activeIndex = (targetTokenIndex + attempts) % tokenPool.length;
    const activeApiKey = tokenPool[activeIndex];
    
    currentTokenIndex = (currentTokenIndex + 1) % tokenPool.length;
    attempts++;

    console.log(`[Round-Robin] Mencoba Token index ke-${activeIndex} untuk model ${requestedModel} (Attempt ${attempts}/${maxAttempts})`);

    try {
      // Lempar seluruh request body OpenAI agar diproses dinamis beserta tools-nya
      const googleRawResponse = await queryGoogleAI(req.body, activeApiKey, activeIndex, requestedModel);
      
      const candidate = googleRawResponse.candidates?.[0];
      const part = candidate?.content?.parts?.[0];

      // Jembatan mengecek apakah Google meminta fungsi pemanggilan Tool (Function Call)
      const hasFunctionCall = part && part.functionCall;
      const aiReply = part?.text || "";

      if (!hasFunctionCall && (!aiReply || aiReply.trim().length === 0)) {
        console.warn(`⚠️ Token index ke-${activeIndex} mengembalikan respons kosong hulu. Skip...`);
        continue;
      }

      // 🛠️ STRATEGI TRANSLASI PEMANGGILAN TOOL JALUR STREAMING/NON-STREAMING 🛠️
      if (hasFunctionCall) {
        console.log(`🔧 [TOOL DETECTED] Google meminta eksekusi fungsi: ${part.functionCall.name}`);
        
        const openAiToolCalls = [{
          id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: "function",
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args || {})
          }
        }];

        if (isStreamRequested) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');

          const streamPayload = {
            id: chunkId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: requestedModel,
            choices: [{ index: 0, delta: { role: "assistant", tool_calls: openAiToolCalls }, finish_reason: null }]
          };
          res.write(`data: ${JSON.stringify(streamPayload)}\n\n`);
          
          const finalStreamPayload = {
            id: chunkId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: requestedModel,
            choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }]
          };
          res.write(`data: ${JSON.stringify(finalStreamPayload)}\n\n`);
          res.write('data: [DONE]\n\n');
          return res.end();
        }

        return res.json({
          id: chunkId, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: requestedModel,
          choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: openAiToolCalls }, finish_reason: "tool_calls" }]
        });
      }

      // JALUR CHAT BIASA (TIDAK MANGGIL TOOL)
      if (isStreamRequested) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const words = aiReply.match(/[\s\S]{1,4}/g) || [aiReply];
        for (const word of words) {
          const streamPayload = {
            id: chunkId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: requestedModel,
            choices: [{ index: 0, delta: { content: word }, finish_reason: null }]
          };
          res.write(`data: ${JSON.stringify(streamPayload)}\n\n`);
          await new Promise(r => setTimeout(r, 12));
        }

        const finalStreamPayload = {
          id: chunkId, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: requestedModel,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
        };
        res.write(`data: ${JSON.stringify(finalStreamPayload)}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      }

      return res.json({
        id: chunkId, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: requestedModel,
        choices: [{ index: 0, message: { role: 'assistant', content: aiReply }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
      });

    } catch (error) {
      if (error.type === 'QUOTA' || error.type === 'EMPTY_TEXT') {
        sessionTokenMap.set(firstMessageKey, (activeIndex + 1) % tokenPool.length);
        continue; 
      }
      console.error(`❌ Fatal Error di Token index ke-${activeIndex}:`, error.message);
      return res.status(500).json({ error: 'Internal technical glitch' });
    }
  }

  return res.status(429).json({ error: 'Semua token limit harian' });
};

// === ROUTES OPENAI STANDARD ===
app.post('/v1/chat/completions', handleChat);
app.post('/chat/completions', handleChat);

app.get('/v1/models', (req, res) => res.json({
  object: "list",
  data: [
    { id: "gemini-2.5-flash", object: "model", created: 1686935002, owned_by: "google" },
    { id: "gemini-3.5-flash", object: "model", created: 1686935002, owned_by: "google" }
  ]
}));

// === ENDPOINT EMBEDDINGS UNTUK #codebase (Original Configuration Maintained) ===
app.post('/v1/embeddings', async (req, res) => {
  const input = req.body.input;
  const texts = Array.isArray(input) ? input : [input];

  // Coba semua token sampai berhasil
  let lastError = null;
  for (let i = 0; i < tokenPool.length; i++) {
    const apiKey = tokenPool[(currentTokenIndex + i) % tokenPool.length];
    
    try {
      const embeddings = await Promise.all(texts.map(async (text, idx) => {
        const payload = JSON.stringify({
          model: "models/gemini-embedding-2",
          content: { parts: [{ text: String(text) }] }
        });

        return new Promise((resolve, reject) => {
          const options = {
            hostname: 'generativelanguage.googleapis.com',
            path: `/v1beta/models/gemini-embedding-2:embedContent?key=${apiKey}`,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload)
            }
          };

          let responseText = '';
          const googleReq = https.request(options, (googleRes) => {
            googleRes.on('data', chunk => responseText += chunk.toString());
            googleRes.on('end', () => {
              try {
                const json = JSON.parse(responseText);
                if (json.error) return reject(json.error);
                resolve({
                  object: "embedding",
                  index: idx,
                  embedding: json.embedding.values
                });
              } catch (e) {
                reject(e);
              }
            });
          });

          googleReq.on('error', reject);
          googleReq.write(payload);
          googleReq.end();
        });
      }));

      // Berhasil, update index
      currentTokenIndex = (currentTokenIndex + i + 1) % tokenPool.length;
      return res.json({
        object: "list",
        data: embeddings,
        model: "gemini-embedding-2",
        usage: { prompt_tokens: 0, total_tokens: 0 }
      });

    } catch (err) {
      console.warn(`⚠️ Embedding token ke-${i} gagal:`, err.message || err);
      lastError = err;
    }
  }

  console.error('❌ Semua token gagal untuk embedding:', lastError);
  return res.status(500).json({ error: 'Embedding failed' });
});

app.use((req, res) => {
  if (req.method === 'POST') {
    return handleChat(req, res);
  } else {
    return res.json({
      id: "gemini-3-flash-live",
      object: "model",
      created: 1686935002,
      owned_by: "google",
      data: [
        { id: "gemini-3-flash-live", object: "model", created: 1686935002, owned_by: "google" },
        { id: "models/gemini-3-flash-live", object: "model", created: 1686935002, owned_by: "google" }
      ]
    });
  }
});

app.listen(8089, () => console.log('🚀 Hermes Live Bridge v8.0 (Advanced Tool Calling) aktif di http://localhost:8089'));
