const express = require('express');
const https = require('https');
require('dotenv').config();

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.url}`);
  next();
});

let tokenPool = [];
if (process.env.GEMINI_API_KEY) tokenPool.push(process.env.GEMINI_API_KEY);
if (process.env.GOOGLE_API_KEY) tokenPool.push(process.env.GOOGLE_API_KEY);

Object.keys(process.env).forEach(key => {
  if ((key.includes('GEMINI') || key.includes('GOOGLE')) && !key.includes('URL')) {
    const value = process.env[key];
    if (value && value.length > 20 && !tokenPool.includes(value)) {
      tokenPool.push(value);
    }
  }
});

if (tokenPool.length === 0 && process.env.GEMINI_API_KEYS) {
  tokenPool = process.env.GEMINI_API_KEYS.split(',').map(k => k.trim());
}

console.log(`🔑 Berhasil mendeteksi ${tokenPool.length} token API dari file .env`);

let currentTokenIndex = 0;

const queryGoogleAI = (payload, apiKey, index, requestedModel) => { 
  return new Promise((resolve, reject) => {
    
    // Gunakan fallback jika Hermes tidak mengirimkan nama model secara eksplisit
    const modelTarget = requestedModel || "gemini-3.5-flash"; 

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

          const aiReply = jsonResponse.candidates?.[0]?.content?.parts?.[0]?.text || "";
          if (!aiReply || aiReply.trim().length === 0) {
            return reject({ type: 'EMPTY_TEXT', message: 'Teks kosong dari hulu' });
          }

          resolve(aiReply);
        } catch (err) {
          reject({ type: 'PARSE_ERROR', message: 'Gagal parsing JSON' });
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
  
  // 1. Tangkap model dinamis dari Hermes (contoh: gemini-3.5-flash atau fallback-nya)
  const requestedModel = req.body.model || "gemini-3.5-flash"; 
  const chunkId = `chatcmpl-${Date.now()}`;

  if (messages.length === 0) {
    return res.json({ choices: [{ message: { role: 'assistant', content: 'Bridge aktif!' } }] });
  }

  // === INTERSEPTOR TITLING SUPER AGRESIF (ANTI-WARNING) ===
  const lastMessageContent = messages[messages.length - 1].content || "";
  if (
    maxTokensRequested <= 30 || 
    lastMessageContent.toLowerCase().includes('title') || 
    lastMessageContent.toLowerCase().includes('judul') ||
    lastMessageContent.toLowerCase().includes('summarize this session') ||
    req.url.includes('v1main')
  ) {
    console.log('🤫 Mencegat request Auxiliary Title Generation. Mengirimkan judul tiruan aman...');
    return res.json({
      id: chunkId,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: requestedModel,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: "Sebastian Session" },
        finish_reason: "stop"
      }]
    });
  }

  const contents = messages.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content || "" }]
  }));
  const payload = JSON.stringify({ contents });

  let attempts = 0;
  const maxAttempts = tokenPool.length; 

  while (attempts < maxAttempts) {
    const activeIndex = currentTokenIndex;
    const activeApiKey = tokenPool[activeIndex];
    
    currentTokenIndex = (currentTokenIndex + 1) % tokenPool.length;
    attempts++;

    console.log(`[Round-Robin] Mencoba Token index ke-${activeIndex} untuk model ${requestedModel} (Attempt ${attempts}/${maxAttempts})`);

    try {
      // 2. Oper 'requestedModel' ke fungsi queryGoogleAI agar endpoint path-nya dinamis
      const aiReply = await queryGoogleAI(payload, activeApiKey, activeIndex, requestedModel);
      console.log(`✅ Sukses memproses teks (${aiReply.length} karakter) via Token index ke-${activeIndex}. Stream Mode: ${isStreamRequested}`);

      if (isStreamRequested) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const words = aiReply.match(/[\s\S]{1,4}/g) || [aiReply];
        
        for (const word of words) {
          const streamPayload = {
            id: chunkId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: requestedModel,
            choices: [{ index: 0, delta: { content: word }, finish_reason: null }]
          };
          res.write(`data: ${JSON.stringify(streamPayload)}\n\n`);
          await new Promise(r => setTimeout(r, 15));
        }

        const finalStreamPayload = {
          id: chunkId,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: requestedModel,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
        };
        res.write(`data: ${JSON.stringify(finalStreamPayload)}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      }

      // Jalur Non-Stream (Blocking)
      return res.json({
        id: chunkId,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: requestedModel,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: aiReply },
          finish_reason: "stop"
        }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
      });

    } catch (error) {
      if (error.type === 'QUOTA' || error.type === 'EMPTY_TEXT') {
        continue; 
      }
      console.error(`❌ Fatal Error di Token index ke-${activeIndex}:`, error.message);
      return res.status(500).json({ error: 'Internal technical glitch' });
    }
  }

  return res.status(429).json({ error: 'Semua token limit harian' });
};

// === GLOBAL INTERCEPTOR ===
app.use((req, res) => {
  if (req.method === 'POST') {
    return handleChat(req, res);
  } else {
    // Tangkap rute model dinamis apa saja yang dicari background task Hermes
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

app.listen(8089, () => console.log('🚀 Hermes Live Bridge v7.3 (Clean Edition) aktif di http://localhost:8089'));