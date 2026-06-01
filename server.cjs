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
    if (msg.content) parts.push({ text: msg.content });
    
    // Jika Hermes mengirimkan balik instruksi asisten yang berisi tool_calls sebelumnya
    if (msg.tool_calls) {
      msg.tool_calls.forEach(tc => {
        let args = {};
        try { args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments; } catch(e){}
        parts.push({
          functionCall: { name: tc.function.name, args: args }
        });
      });
    }

    return {
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: parts
    };
  });

  const googlePayload = { contents };

  // Pemetaan Objek Tools (Function Declarations) dari Hermes langsung diteruskan ke Google!
  if (openAiBody.tools) {
    googlePayload.tools = [{
      functionDeclarations: openAiBody.tools.map(t => ({
        name: t.function.name,
        description: t.function.description || "Execute system commands",
        parameters: t.function.parameters
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
    console.log('🤫 Mencegat request Auxiliary Title Generation. Mengirimkan judul tiruan aman...');
    return res.json({
      id: chunkId,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "gemini-3.5-flash",
      choices: [{
        index: 0,
        message: { role: 'assistant', content: "Sebastian Session" },
        finish_reason: "stop"
      }]
    });
  }

  let attempts = 0;
  const maxAttempts = tokenPool.length; 

  while (attempts < maxAttempts) {
    const activeIndex = currentTokenIndex;
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
            id: chunkId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: requestedModel,
            choices: [{ index: 0, delta: { role: "assistant", tool_calls: openAiToolCalls }, finish_reason: null }]
          };
          res.write(`data: ${JSON.stringify(streamPayload)}\n\n`);
          
          const finalStreamPayload = {
            id: chunkId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: requestedModel,
            choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }]
          };
          res.write(`data: ${JSON.stringify(finalStreamPayload)}\n\n`);
          res.write('data: [DONE]\n\n');
          return res.end();
        }

        return res.json({
          id: chunkId,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: requestedModel,
          choices: [{
            index: 0,
            message: { role: 'assistant', content: null, tool_calls: openAiToolCalls },
            finish_reason: "tool_calls"
          }]
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
            id: chunkId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: requestedModel,
            choices: [{ index: 0, delta: { content: word }, finish_reason: null }]
          };
          res.write(`data: ${JSON.stringify(streamPayload)}\n\n`);
          await new Promise(r => setTimeout(r, 12));
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