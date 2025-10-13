import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID as uuidv4 } from 'crypto';

const app = express();
const server = http.createServer(app);

// ---------- CORS + Static ----------
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || ORIGINS.includes('*') || ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return next();
  }
  return res.status(403).send('CORS blocked');
});

app.use(express.static('public'));

app.get('/envcheck', (_, res) => {
  const key = process.env.OPENAI_API_KEY || '';
  res.json({
    keyLoaded: key.length > 20,
    model: process.env.CHAT_MODEL || 'gpt-4o-mini',
    origins: process.env.ALLOWED_ORIGINS || null
  });
});
app.get('/healthz', (_, res) => res.status(200).send('ok'));

// ---------- WS Gateways ----------
const wssStudent = new WebSocketServer({ noServer: true, path: '/ws' });
const wssTeacher = new WebSocketServer({ noServer: true, path: '/ws-teacher' });

server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/ws-teacher')) {
    wssTeacher.handleUpgrade(req, socket, head, ws => wssTeacher.emit('connection', ws, req));
  } else {
    wssStudent.handleUpgrade(req, socket, head, ws => wssStudent.emit('connection', ws, req));
  }
});

// ---------- Session-Store ----------
const sessions = new Map(); // id -> { scenario, level, messages[], vocaHit[], errs[] }

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CHAT_MODEL = process.env.CHAT_MODEL || 'gpt-4o-mini';
const TTS_MODEL = process.env.TTS_MODEL || 'tts-1';
const TTS_VOICE = process.env.TTS_VOICE || 'alloy';

// Vokabel-Ziele
const TARGETS = {
  shop: ['price', 'cheap', 'expensive', 'how much', 'kilo', 'cash', 'card', 'change'],
  airport: ['passport', 'boarding pass', 'gate', 'destination', 'luggage', 'customs'],
  school: ['subject', 'break', 'homework', 'classroom', 'timetable'],
  food: ['menu', 'order', 'allergy', 'vegetarian', 'spicy', 'delicious'],
  present: ['gift', 'color', 'size', 'budget', 'recommend', 'describe']
};

function assess(text, scenario = 'shop') {
  const hits = [], errs = [];
  const lower = (text || '').toLowerCase();
  (TARGETS[scenario] || []).forEach(w => lower.includes(w) && hits.push(w));
  if (text && text.length && !/[.!?]$/.test(text)) errs.push('punctuation');
  return { hits, errs };
}

// ---------- OpenAI Chat API ----------
async function getChatResponse(messages) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: messages,
      max_tokens: 150,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Chat API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// ---------- OpenAI TTS API ----------
async function generateSpeech(text) {
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      voice: TTS_VOICE,
      input: text,
      speed: 1.0
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`TTS API error: ${response.status} - ${error}`);
  }

  // Audio als Buffer zurückgeben
  const audioBuffer = await response.arrayBuffer();
  return Buffer.from(audioBuffer);
}

// ---------- Teacher-Dashboard ----------
wssTeacher.on('connection', ws => {
  const snapshot = Array.from(sessions.entries()).map(([id, s]) => ({ 
    id, 
    scenario: s.scenario,
    level: s.level,
    lastText: s.lastText || '',
    vocaHit: s.vocaHit || [],
    errs: s.errs || []
  }));
  ws.send(JSON.stringify(snapshot));
});

function broadcastToTeachers(data) {
  for (const t of wssTeacher.clients) {
    if (t.readyState === WebSocket.OPEN) {
      t.send(JSON.stringify(data));
    }
  }
}

// ---------- Student WebSocket ----------
wssStudent.on('connection', client => {
  const sid = uuidv4();
  
  sessions.set(sid, {
    scenario: 'shop',
    level: 'A2',
    startedAt: Date.now(),
    messages: [],
    lastText: '',
    vocaHit: [],
    errs: []
  });
  
  console.log('🟢 Client connected:', sid);

  // Initiale Begrüßung senden
  (async () => {
    try {
      const s = sessions.get(sid);
      const systemPrompt = {
        role: 'system',
        content: `You are a friendly English conversation coach for German students (grades 7-10). 
Keep your responses very short (1-2 sentences maximum). 
Be encouraging and correct mistakes gently. 
The current scenario is "${s.scenario}" and the student's level is ${s.level}.
Stay within this scenario and use vocabulary appropriate for ${s.level} level.`
      };

      const initialMessage = {
        role: 'user',
        content: `Start a friendly conversation about the "${s.scenario}" scenario. Greet the student and ask a simple question to begin.`
      };

      s.messages.push(systemPrompt, initialMessage);
      
      const aiResponse = await getChatResponse(s.messages);
      s.messages.push({ role: 'assistant', content: aiResponse });

      // Audio generieren
      const audioBuffer = await generateSpeech(aiResponse);
      const audioBase64 = audioBuffer.toString('base64');

      client.send(JSON.stringify({
        type: 'server.response',
        text: aiResponse,
        audio: audioBase64
      }));

      console.log('✅ Initial greeting sent:', aiResponse);

    } catch (error) {
      console.error('❌ Initial greeting error:', error);
      client.send(JSON.stringify({
        type: 'error',
        message: 'Failed to initialize conversation'
      }));
    }
  })();

  // Client-Nachrichten verarbeiten
  client.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const s = sessions.get(sid);
      if (!s) return;

      if (msg.type === 'client.init') {
        s.scenario = msg.scenario || 'shop';
        s.level = msg.level || 'A2';
        
        // System-Prompt aktualisieren
        s.messages[0] = {
          role: 'system',
          content: `You are a friendly English conversation coach for German students (grades 7-10). 
Keep your responses very short (1-2 sentences maximum). 
Be encouraging and correct mistakes gently. 
The current scenario is "${s.scenario}" and the student's level is ${s.level}.
Stay within this scenario and use vocabulary appropriate for ${s.level} level.`
        };

        broadcastToTeachers([{ 
          id: sid, 
          scenario: s.scenario, 
          level: s.level,
          lastText: s.lastText,
          vocaHit: s.vocaHit,
          errs: s.errs
        }]);
        return;
      }

      if (msg.type === 'client.text') {
        const text = (msg.text || '').trim();
        if (!text) return;

        console.log('📝 Student message:', text);

        // Assessment
        s.lastText = text;
        const { hits, errs } = assess(text, s.scenario);
        s.vocaHit.push(...hits);
        s.errs.push(...errs);

        // Nachricht zur Historie hinzufügen
        s.messages.push({ role: 'user', content: text });

        // Chat API aufrufen
        const aiResponse = await getChatResponse(s.messages);
        s.messages.push({ role: 'assistant', content: aiResponse });

        console.log('🤖 AI response:', aiResponse);

        // Audio generieren
        const audioBuffer = await generateSpeech(aiResponse);
        const audioBase64 = audioBuffer.toString('base64');

        // An Client senden
        client.send(JSON.stringify({
          type: 'server.response',
          text: aiResponse,
          audio: audioBase64
        }));

        console.log('✅ Response sent with audio');

        // Teacher-Dashboard updaten
        broadcastToTeachers([{ 
          id: sid, 
          scenario: s.scenario, 
          level: s.level,
          lastText: s.lastText,
          vocaHit: s.vocaHit,
          errs: s.errs
        }]);
      }

    } catch (error) {
      console.error('❌ Message processing error:', error);
      client.send(JSON.stringify({
        type: 'error',
        message: error.message || 'Processing error'
      }));
    }
  });

  client.on('close', () => {
    sessions.delete(sid);
    console.log('🔴 Client disconnected:', sid);
    broadcastToTeachers({ type: 'session.remove', id: sid });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ DialogLab server running on :${PORT}`));