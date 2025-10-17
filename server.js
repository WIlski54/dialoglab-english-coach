// ========================================
// DialogLab - English Coach Server
// Komplett mit Dialog-Lab, Vokabel-Trainer & Bild-Quiz
// ========================================

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const OpenAI = require('openai');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ========================================
// Express & Server Setup
// ========================================
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Body Parser Limits
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// CORS Middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Static Files
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

const PORT = process.env.PORT || 3000;

// ========================================
// OpenAI Setup
// ========================================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ========================================
// File Upload Setup
// ========================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

// ========================================
// Data Storage
// ========================================
const dialogSessions = new Map();
const vocabStats = {
  words: new Map(),
  totalAttempts: 0,
  totalErrors: 0
};
const quizSessions = [];

// ========================================
// MODUL 1: Dialog-Lab WebSocket
// ========================================
wss.on('connection', (ws) => {
  console.log('📡 Client verbunden');
  let sessionId = null;

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'start_session') {
        sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        dialogSessions.set(sessionId, {
          sessionId,
          studentName: data.studentName,
          scenario: data.scenario,
          messages: [],
          startTime: new Date(),
          status: 'active'
        });

        ws.send(JSON.stringify({
          type: 'session_started',
          sessionId,
          systemMessage: getScenarioPrompt(data.scenario)
        }));

        console.log(`✅ Session gestartet: ${sessionId} für ${data.studentName}`);
      }

      if (data.type === 'user_message' && sessionId) {
        const session = dialogSessions.get(sessionId);
        
        session.messages.push({
          role: 'user',
          content: data.message
        });

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: getScenarioPrompt(session.scenario)
            },
            ...session.messages
          ],
          temperature: 0.7
        });

        const aiResponse = completion.choices[0].message.content;
        
        session.messages.push({
          role: 'assistant',
          content: aiResponse
        });

        ws.send(JSON.stringify({
          type: 'ai_response',
          message: aiResponse
        }));
      }

      if (data.type === 'end_session' && sessionId) {
        const session = dialogSessions.get(sessionId);
        if (session) {
          session.status = 'finished';
          session.endTime = new Date();
        }
        console.log(`🏁 Session beendet: ${sessionId}`);
      }

    } catch (error) {
      console.error('❌ WebSocket Fehler:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Ein Fehler ist aufgetreten'
      }));
    }
  });

  ws.on('close', () => {
    console.log('📡 Client getrennt');
  });
});

function getScenarioPrompt(scenario) {
  const prompts = {
    restaurant: `You are a friendly waiter in an English restaurant. Help the student practice ordering food. Be encouraging and patient. Speak only English. Keep responses conversational and natural. Correct mistakes gently by rephrasing correctly.`,
    
    shopping: `You are a helpful shop assistant in an English store. Help the student practice shopping conversations. Be encouraging and patient. Speak only English. Keep responses conversational and natural. Correct mistakes gently by rephrasing correctly.`,
    
    airport: `You are a friendly airport staff member. Help the student practice airport conversations like check-in, security, and finding gates. Be encouraging and patient. Speak only English. Keep responses conversational and natural. Correct mistakes gently by rephrasing correctly.`,
    
    doctor: `You are a caring doctor in an English clinic. Help the student practice describing symptoms and medical conversations. Be encouraging and patient. Speak only English. Keep responses conversational and natural. Correct mistakes gently by rephrasing correctly.`,
    
    hotel: `You are a friendly hotel receptionist. Help the student practice hotel conversations like check-in, room service, and asking for directions. Be encouraging and patient. Speak only English. Keep responses conversational and natural. Correct mistakes gently by rephrasing correctly.`
  };

  return prompts[scenario] || prompts.restaurant;
}

// ========================================
// MODUL 2: Vokabel-Trainer API
// ========================================

// TTS für Vokabeln
app.post('/api/speak', async (req, res) => {
  try {
    const { text } = req.body;
    
    const mp3 = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'alloy',
      input: text
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());
    res.set('Content-Type', 'audio/mpeg');
    res.send(buffer);
  } catch (error) {
    console.error('TTS Error:', error);
    res.status(500).json({ error: 'TTS fehlgeschlagen' });
  }
});

// KI-Tipp für Vokabeln
app.post('/api/vocab-hint', async (req, res) => {
  try {
    const { english, german } = req.body;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Du bist ein hilfreicher Englischlehrer. Gib einen kurzen, hilfreichen Tipp zum Lernen dieses Vokabels. Maximal 2 Sätze auf Deutsch.'
        },
        {
          role: 'user',
          content: `Englisch: ${english}\nDeutsch: ${german}`
        }
      ],
      temperature: 0.7,
      max_tokens: 100
    });

    res.json({ hint: completion.choices[0].message.content });
  } catch (error) {
    console.error('Hint Error:', error);
    res.status(500).json({ error: 'Tipp konnte nicht generiert werden' });
  }
});

// Aussprache-Check
app.post('/api/check-pronunciation', async (req, res) => {
  try {
    const { audio } = req.body;
    
    const audioBuffer = Buffer.from(audio.split(',')[1], 'base64');
    
    const transcription = await openai.audio.transcriptions.create({
      file: await toFile(audioBuffer, 'audio.webm'),
      model: 'whisper-1'
    });

    res.json({ 
      transcription: transcription.text,
      success: true 
    });
  } catch (error) {
    console.error('Pronunciation Check Error:', error);
    res.status(500).json({ error: 'Aussprachebewertung fehlgeschlagen' });
  }
});

// Helper für File-Upload
async function toFile(buffer, filename) {
  const blob = new Blob([buffer]);
  return new File([blob], filename);
}

// Vokabel-Statistik speichern
app.post('/api/vocab-stats', (req, res) => {
  try {
    const { english, german, correct } = req.body;
    
    const key = `${english}|${german}`;
    
    if (!vocabStats.words.has(key)) {
      vocabStats.words.set(key, {
        english,
        german,
        attempts: 0,
        errors: 0
      });
    }
    
    const wordStat = vocabStats.words.get(key);
    wordStat.attempts++;
    if (!correct) {
      wordStat.errors++;
      vocabStats.totalErrors++;
    }
    vocabStats.totalAttempts++;
    
    res.json({ success: true });
  } catch (error) {
    console.error('Stats Error:', error);
    res.status(500).json({ error: 'Statistik konnte nicht gespeichert werden' });
  }
});

// Vokabel-Statistik abrufen (für Dashboard)
app.get('/api/vocab-stats', (req, res) => {
  try {
    const wordsArray = Array.from(vocabStats.words.values());
    
    // Top 20 schwierigste Vokabeln
    const difficultWords = wordsArray
      .filter(w => w.attempts >= 2)
      .sort((a, b) => {
        const errorRateA = a.errors / a.attempts;
        const errorRateB = b.errors / b.attempts;
        if (errorRateB !== errorRateA) {
          return errorRateB - errorRateA;
        }
        return b.attempts - a.attempts;
      })
      .slice(0, 20);
    
    res.json({
      totalAttempts: vocabStats.totalAttempts,
      totalErrors: vocabStats.totalErrors,
      difficultWords
    });
  } catch (error) {
    console.error('Get Stats Error:', error);
    res.status(500).json({ error: 'Statistik konnte nicht abgerufen werden' });
  }
});

// ========================================
// MODUL 3: Bild-Quiz API
// ========================================

app.post('/api/analyze-image', upload.single('image'), async (req, res) => {
  try {
    const { question, studentName } = req.body;
    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are an English teacher helping students practice English by answering questions about images. Answer in clear, simple English. Be encouraging and educational.'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: question },
            { type: 'image_url', image_url: { url: imageUrl } }
          ]
        }
      ],
      max_tokens: 300
    });

    const answer = completion.choices[0].message.content;

    // Session speichern
    const sessionId = `quiz_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const quizSession = {
      sessionId,
      studentName,
      imageUrl,
      questions: [{
        question,
        answer,
        confidence: 0.95,
        timestamp: new Date()
      }],
      timestamp: new Date()
    };

    // Prüfen ob bereits eine Session für dieses Bild existiert
    const existingSession = quizSessions.find(s => s.imageUrl === imageUrl && s.studentName === studentName);
    
    if (existingSession) {
      existingSession.questions.push({
        question,
        answer,
        confidence: 0.95,
        timestamp: new Date()
      });
    } else {
      quizSessions.push(quizSession);
    }

    res.json({ 
      answer,
      success: true,
      sessionId: existingSession ? existingSession.sessionId : sessionId
    });

  } catch (error) {
    console.error('Image Analysis Error:', error);
    res.status(500).json({ error: 'Bildanalyse fehlgeschlagen' });
  }
});

// Quiz-Sessions abrufen (für Dashboard)
app.get('/api/quiz-sessions', (req, res) => {
  try {
    res.json(quizSessions);
  } catch (error) {
    console.error('Get Quiz Sessions Error:', error);
    res.status(500).json({ error: 'Quiz-Sessions konnten nicht abgerufen werden' });
  }
});

// Einzelne Quiz-Session abrufen
app.get('/api/quiz-sessions/:sessionId', (req, res) => {
  try {
    const session = quizSessions.find(s => s.sessionId === req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session nicht gefunden' });
    }
    res.json(session);
  } catch (error) {
    console.error('Get Quiz Session Error:', error);
    res.status(500).json({ error: 'Session konnte nicht abgerufen werden' });
  }
});

// ========================================
// Dialog-Lab Session Management (für Dashboard)
// ========================================

// Alle Sessions abrufen
app.get('/api/sessions', (req, res) => {
  try {
    const sessions = Array.from(dialogSessions.values());
    res.json(sessions);
  } catch (error) {
    console.error('Get Sessions Error:', error);
    res.status(500).json({ error: 'Sessions konnten nicht abgerufen werden' });
  }
});

// Einzelne Session abrufen
app.get('/api/sessions/:sessionId', (req, res) => {
  try {
    const session = dialogSessions.get(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session nicht gefunden' });
    }
    res.json(session);
  } catch (error) {
    console.error('Get Session Error:', error);
    res.status(500).json({ error: 'Session konnte nicht abgerufen werden' });
  }
});

// Session beenden
app.post('/api/sessions/:sessionId/end', (req, res) => {
  try {
    const session = dialogSessions.get(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session nicht gefunden' });
    }
    session.status = 'finished';
    session.endTime = new Date();
    res.json({ success: true });
  } catch (error) {
    console.error('End Session Error:', error);
    res.status(500).json({ error: 'Session konnte nicht beendet werden' });
  }
});

// Session löschen
app.delete('/api/sessions/:sessionId', (req, res) => {
  try {
    const deleted = dialogSessions.delete(req.params.sessionId);
    if (!deleted) {
      return res.status(404).json({ error: 'Session nicht gefunden' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Delete Session Error:', error);
    res.status(500).json({ error: 'Session konnte nicht gelöscht werden' });
  }
});

// ========================================
// Server Start
// ========================================
server.listen(PORT, () => {
  console.log('🚀 ========================================');
  console.log('🎓 DialogLab - English Coach Server');
  console.log('🚀 ========================================');
  console.log(`📡 Server läuft auf Port ${PORT}`);
  console.log(`🌐 http://localhost:${PORT}`);
  console.log('');
  console.log('📚 Module verfügbar:');
  console.log('   💬 Dialog-Lab: /dialog-lab.html');
  console.log('   📖 Vokabel-Trainer: /vocab-trainer.html');
  console.log('   🖼️  Bild-Quiz: /image-quiz.html');
  console.log('   👨‍🏫 Lehrer-Dashboard: /teacher-dashboard.html');
  console.log('🚀 ========================================');
});
