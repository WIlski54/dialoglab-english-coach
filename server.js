import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID as uuidv4 } from 'crypto';

const app = express();
const server = http.createServer(app);

// ---------- CORS + Static + JSON ----------
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
app.use(express.json({ limit: '10mb' })); // Größeres Limit für Base64 Audio

app.get('/envcheck', (_, res) => {
  const key = process.env.OPENAI_API_KEY || '';
  res.json({
    keyLoaded: key.length > 20,
    model: process.env.CHAT_MODEL || 'gpt-4o-mini',
    origins: process.env.ALLOWED_ORIGINS || null
  });
});
app.get('/healthz', (_, res) => res.status(200).send('ok'));

// ---------- WS Gateways (Dialog-Lab) ----------
const wssStudent = new WebSocketServer({ noServer: true, path: '/ws' });
const wssTeacher = new WebSocketServer({ noServer: true, path: '/ws-teacher' });

server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/ws-teacher')) {
    wssTeacher.handleUpgrade(req, socket, head, ws => wssTeacher.emit('connection', ws, req));
  } else {
    wssStudent.handleUpgrade(req, socket, head, ws => wssStudent.emit('connection', ws, req));
  }
});

// ---------- Session-Store (Dialog-Lab) ----------
const sessions = new Map();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CHAT_MODEL = process.env.CHAT_MODEL || 'gpt-4o-mini';
const TTS_MODEL = process.env.TTS_MODEL || 'tts-1';
const TTS_VOICE = process.env.TTS_VOICE || 'alloy';

// ========================================
// VOKABEL-TRAINER: Vokabel-Listen
// ========================================
const VOCABULARY = {
  shop: {
    easy: [
      { de: 'Apfel', en: 'apple' },
      { de: 'Brot', en: 'bread' },
      { de: 'Milch', en: 'milk' },
      { de: 'Wasser', en: 'water' },
      { de: 'Käse', en: 'cheese' }
    ],
    medium: [
      { de: 'Apfel', en: 'apple' },
      { de: 'Brot', en: 'bread' },
      { de: 'Milch', en: 'milk' },
      { de: 'Wasser', en: 'water' },
      { de: 'Käse', en: 'cheese' },
      { de: 'Banane', en: 'banana' },
      { de: 'Tomate', en: 'tomato' },
      { de: 'Kartoffel', en: 'potato' },
      { de: 'Fleisch', en: 'meat' },
      { de: 'Fisch', en: 'fish' }
    ],
    hard: [
      { de: 'Apfel', en: 'apple' },
      { de: 'Brot', en: 'bread' },
      { de: 'Milch', en: 'milk' },
      { de: 'Wasser', en: 'water' },
      { de: 'Käse', en: 'cheese' },
      { de: 'Banane', en: 'banana' },
      { de: 'Tomate', en: 'tomato' },
      { de: 'Kartoffel', en: 'potato' },
      { de: 'Fleisch', en: 'meat' },
      { de: 'Fisch', en: 'fish' },
      { de: 'Gurke', en: 'cucumber' },
      { de: 'Zwiebel', en: 'onion' },
      { de: 'Karotte', en: 'carrot' },
      { de: 'Salat', en: 'lettuce' },
      { de: 'Reis', en: 'rice' }
    ]
  },
  airport: {
    easy: [
      { de: 'Flugzeug', en: 'airplane' },
      { de: 'Koffer', en: 'suitcase' },
      { de: 'Pass', en: 'passport' },
      { de: 'Ticket', en: 'ticket' },
      { de: 'Flughafen', en: 'airport' }
    ],
    medium: [
      { de: 'Flugzeug', en: 'airplane' },
      { de: 'Koffer', en: 'suitcase' },
      { de: 'Pass', en: 'passport' },
      { de: 'Ticket', en: 'ticket' },
      { de: 'Flughafen', en: 'airport' },
      { de: 'Gepäck', en: 'luggage' },
      { de: 'Ankunft', en: 'arrival' },
      { de: 'Abflug', en: 'departure' },
      { de: 'Tor', en: 'gate' },
      { de: 'Bordkarte', en: 'boarding pass' }
    ],
    hard: [
      { de: 'Flugzeug', en: 'airplane' },
      { de: 'Koffer', en: 'suitcase' },
      { de: 'Pass', en: 'passport' },
      { de: 'Ticket', en: 'ticket' },
      { de: 'Flughafen', en: 'airport' },
      { de: 'Gepäck', en: 'luggage' },
      { de: 'Ankunft', en: 'arrival' },
      { de: 'Abflug', en: 'departure' },
      { de: 'Tor', en: 'gate' },
      { de: 'Bordkarte', en: 'boarding pass' },
      { de: 'Zoll', en: 'customs' },
      { de: 'Verspätung', en: 'delay' },
      { de: 'Umsteigen', en: 'transfer' },
      { de: 'Sicherheitskontrolle', en: 'security check' },
      { de: 'Gepäckausgabe', en: 'baggage claim' }
    ]
  },
  school: {
    easy: [
      { de: 'Buch', en: 'book' },
      { de: 'Stift', en: 'pen' },
      { de: 'Lehrer', en: 'teacher' },
      { de: 'Schüler', en: 'student' },
      { de: 'Tafel', en: 'board' }
    ],
    medium: [
      { de: 'Buch', en: 'book' },
      { de: 'Stift', en: 'pen' },
      { de: 'Lehrer', en: 'teacher' },
      { de: 'Schüler', en: 'student' },
      { de: 'Tafel', en: 'board' },
      { de: 'Hausaufgabe', en: 'homework' },
      { de: 'Fach', en: 'subject' },
      { de: 'Pause', en: 'break' },
      { de: 'Klassenzimmer', en: 'classroom' },
      { de: 'Stundenplan', en: 'timetable' }
    ],
    hard: [
      { de: 'Buch', en: 'book' },
      { de: 'Stift', en: 'pen' },
      { de: 'Lehrer', en: 'teacher' },
      { de: 'Schüler', en: 'student' },
      { de: 'Tafel', en: 'board' },
      { de: 'Hausaufgabe', en: 'homework' },
      { de: 'Fach', en: 'subject' },
      { de: 'Pause', en: 'break' },
      { de: 'Klassenzimmer', en: 'classroom' },
      { de: 'Stundenplan', en: 'timetable' },
      { de: 'Prüfung', en: 'exam' },
      { de: 'Zeugnis', en: 'report card' },
      { de: 'Bibliothek', en: 'library' },
      { de: 'Schulleiter', en: 'principal' },
      { de: 'Schulhof', en: 'schoolyard' }
    ]
  },
  food: {
    easy: [
      { de: 'Essen', en: 'food' },
      { de: 'trinken', en: 'drink' },
      { de: 'Teller', en: 'plate' },
      { de: 'Gabel', en: 'fork' },
      { de: 'Messer', en: 'knife' }
    ],
    medium: [
      { de: 'Essen', en: 'food' },
      { de: 'trinken', en: 'drink' },
      { de: 'Teller', en: 'plate' },
      { de: 'Gabel', en: 'fork' },
      { de: 'Messer', en: 'knife' },
      { de: 'Speisekarte', en: 'menu' },
      { de: 'bestellen', en: 'order' },
      { de: 'Rechnung', en: 'bill' },
      { de: 'lecker', en: 'delicious' },
      { de: 'Kellner', en: 'waiter' }
    ],
    hard: [
      { de: 'Essen', en: 'food' },
      { de: 'trinken', en: 'drink' },
      { de: 'Teller', en: 'plate' },
      { de: 'Gabel', en: 'fork' },
      { de: 'Messer', en: 'knife' },
      { de: 'Speisekarte', en: 'menu' },
      { de: 'bestellen', en: 'order' },
      { de: 'Rechnung', en: 'bill' },
      { de: 'lecker', en: 'delicious' },
      { de: 'Kellner', en: 'waiter' },
      { de: 'Allergie', en: 'allergy' },
      { de: 'vegetarisch', en: 'vegetarian' },
      { de: 'scharf', en: 'spicy' },
      { de: 'Vorspeise', en: 'starter' },
      { de: 'Nachtisch', en: 'dessert' }
    ]
  },
  present: {
    easy: [
      { de: 'Geschenk', en: 'gift' },
      { de: 'Farbe', en: 'color' },
      { de: 'Größe', en: 'size' },
      { de: 'kaufen', en: 'buy' },
      { de: 'Preis', en: 'price' }
    ],
    medium: [
      { de: 'Geschenk', en: 'gift' },
      { de: 'Farbe', en: 'color' },
      { de: 'Größe', en: 'size' },
      { de: 'kaufen', en: 'buy' },
      { de: 'Preis', en: 'price' },
      { de: 'einpacken', en: 'wrap' },
      { de: 'empfehlen', en: 'recommend' },
      { de: 'Geburtstag', en: 'birthday' },
      { de: 'Gutschein', en: 'voucher' },
      { de: 'Qualität', en: 'quality' }
    ],
    hard: [
      { de: 'Geschenk', en: 'gift' },
      { de: 'Farbe', en: 'color' },
      { de: 'Größe', en: 'size' },
      { de: 'kaufen', en: 'buy' },
      { de: 'Preis', en: 'price' },
      { de: 'einpacken', en: 'wrap' },
      { de: 'empfehlen', en: 'recommend' },
      { de: 'Geburtstag', en: 'birthday' },
      { de: 'Gutschein', en: 'voucher' },
      { de:'Qualität', en: 'quality' },
      { de: 'Rabatt', en: 'discount' },
      { de: 'umtauschen', en: 'exchange' },
      { de: 'Garantie', en: 'warranty' },
      { de: 'Rückgabe', en: 'return' },
      { de: 'beschreiben', en: 'describe' }
    ]
  }
};

// ========================================
// API: Vokabeln abrufen
// ========================================
app.post('/api/vocab/get-words', (req, res) => {
  try {
    const { scenario, difficulty } = req.body;
    
    if (!scenario || !difficulty) {
      return res.status(400).json({ error: 'Missing scenario or difficulty' });
    }
    
    const words = VOCABULARY[scenario]?.[difficulty];
    
    if (!words) {
      return res.status(404).json({ error: 'Vocabulary not found' });
    }
    
    // Shuffle
    const shuffled = [...words].sort(() => Math.random() - 0.5);
    
    res.json({ words: shuffled });
    
  } catch (error) {
    console.error('Get words error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// API: TTS für einzelnes Wort
// ========================================
app.post('/api/vocab/speak-word', async (req, res) => {
  try {
    const { word } = req.body;
    
    if (!word) {
      return res.status(400).json({ error: 'Missing word' });
    }
    
    console.log('🔊 Generating TTS for:', word);
    
    const audioBuffer = await generateSpeech(word);
    const audioBase64 = audioBuffer.toString('base64');
    
    res.json({ audio: audioBase64 });
    
  } catch (error) {
    console.error('❌ TTS generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// API: Tipp generieren mit ChatGPT
// ========================================
app.post('/api/vocab/get-hint', async (req, res) => {
  try {
    const { word, germanWord } = req.body;
    
    if (!word || !germanWord) {
      return res.status(400).json({ error: 'Missing word or germanWord' });
    }
    
    console.log('💡 Generating hint for:', word);
    
    const prompt = [
      {
        role: 'system',
        content: 'You are a helpful English teacher. Generate a SHORT hint (max 10 words) in German to help a student guess the English word. The hint should be helpful but not give away the entire answer.'
      },
      {
        role: 'user',
        content: `Das deutsche Wort ist "${germanWord}". Das englische Wort ist "${word}". Gib einen kurzen Tipp auf Deutsch.`
      }
    ];
    
    const hint = await getChatResponse(prompt);
    
    res.json({ hint: hint.trim() });
    
  } catch (error) {
    console.error('❌ Hint generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// API: Whisper Transkription + Bewertung (ERWEITERT)
// ========================================
app.post('/api/vocab/check-pronunciation', async (req, res) => {
  try {
    const { audioBase64, expectedWord, attempt } = req.body;
    
    if (!audioBase64 || !expectedWord) {
      return res.status(400).json({ error: 'Missing audio or expectedWord' });
    }
    
    const attemptNum = attempt || 1;
    
    console.log(`🎤 Checking pronunciation for: ${expectedWord} (Attempt ${attemptNum})`);
    
    // Base64 → Buffer → Blob
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    
    // Whisper API
    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer], { type: 'audio/webm' }), 'audio.webm');
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');
    formData.append('response_format', 'verbose_json');
    
    const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: formData
    });
    
    if (!whisperResponse.ok) {
      const error = await whisperResponse.text();
      throw new Error(`Whisper API error: ${whisperResponse.status} - ${error}`);
    }
    
    const whisperData = await whisperResponse.json();
    const transcribed = whisperData.text.toLowerCase().trim();
    const expected = expectedWord.toLowerCase().trim();
    
    console.log('📝 Transcribed:', transcribed);
    console.log('✓ Expected:', expected);
    
    // Vergleichen - toleranter Match
    const isCorrect = transcribed === expected || 
                      transcribed.includes(expected) ||
                      expected.includes(transcribed);
    
    // Confidence Score berechnen (1-5 Sterne)
    const avgConfidence = whisperData.segments?.reduce((sum, seg) => sum + (seg.avg_logprob || 0), 0) / (whisperData.segments?.length || 1);
    const pronunciationScore = Math.max(0, Math.min(5, Math.round((1 + avgConfidence / 0.5) * 5)));
    
    // Typische Fehler erkennen
    const commonErrors = detectCommonErrors(expected, transcribed);
    
    // Punkteberechnung
    let points = 0;
    let needsTTS = false;
    let feedback = '';
    
    if (!isCorrect) {
      // FALSCHES WORT
      points = 0;
      needsTTS = attemptNum >= 2; // TTS beim 2. Versuch
      
      if (attemptNum === 1) {
        feedback = 'incorrect_first';
      } else {
        feedback = 'incorrect_final';
      }
      
    } else {
      // RICHTIGES WORT - Punkte basierend auf Aussprache
      if (attemptNum === 1) {
        // Erster Versuch
        if (pronunciationScore >= 4) {
          points = pronunciationScore === 5 ? 10 : 9;
          needsTTS = false;
          feedback = 'perfect';
        } else if (pronunciationScore === 3) {
          points = 7;
          needsTTS = true;
          feedback = 'good_needs_improvement';
        } else {
          points = 4;
          needsTTS = true;
          feedback = 'correct_poor_pronunciation';
        }
      } else {
        // Zweiter Versuch
        points = 5;
        needsTTS = pronunciationScore < 4;
        feedback = 'correct_second_attempt';
      }
    }
    
    res.json({
      correct: isCorrect,
      transcribed: transcribed,
      expected: expected,
      pronunciationScore: pronunciationScore,
      points: points,
      needsTTS: needsTTS,
      feedback: feedback,
      tips: commonErrors.length > 0 ? commonErrors : null
    });
    
  } catch (error) {
    console.error('❌ Pronunciation check error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Typische Fehler deutscher Englisch-Lerner
function detectCommonErrors(expected, actual) {
  const tips = [];
  
  // TH-Sound Problem
  if (expected.includes('th') && (actual.includes('s') || actual.includes('z'))) {
    tips.push('💡 Tipp: Für "th" die Zunge zwischen die Zähne!');
  }
  
  // W-Sound Problem
  if (expected.startsWith('w') && actual.startsWith('v')) {
    tips.push('💡 Tipp: "w" wie "u" aussprechen, Lippen rund!');
  }
  
  // V-Sound Problem
  if (expected.includes('v') && actual.includes('w')) {
    tips.push('💡 Tipp: Für "v" leicht auf Unterlippe beißen!');
  }
  
  return tips;
}

// ========================================
// DIALOG-LAB (Bestehendes System)
// ========================================

// Vokabel-Ziele für Dialog-Lab
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

  const audioBuffer = await response.arrayBuffer();
  return Buffer.from(audioBuffer);
}

// Teacher-Dashboard
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

// Student WebSocket (Dialog-Lab)
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

  client.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const s = sessions.get(sid);
      if (!s) return;

      if (msg.type === 'client.init') {
        s.scenario = msg.scenario || 'shop';
        s.level = msg.level || 'A2';
        
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

        s.lastText = text;
        const { hits, errs } = assess(text, s.scenario);
        s.vocaHit.push(...hits);
        s.errs.push(...errs);

        s.messages.push({ role: 'user', content: text });

        const aiResponse = await getChatResponse(s.messages);
        s.messages.push({ role: 'assistant', content: aiResponse });

        console.log('🤖 AI response:', aiResponse);

        const audioBuffer = await generateSpeech(aiResponse);
        const audioBase64 = audioBuffer.toString('base64');

        client.send(JSON.stringify({
          type: 'server.response',
          text: aiResponse,
          audio: audioBase64
        }));

        console.log('✅ Response sent with audio');

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
