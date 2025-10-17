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
// Express & Server Setup (ROBUSTERE VERSION)
// ========================================
const app = express();
const server = http.createServer(app);

// WebSocket Server OHNE direkte Server-Bindung initialisieren
const wssDialogLab = new WebSocket.Server({ noServer: true });
const wssImageQuiz = new WebSocket.Server({ noServer: true });

// Manuelles Upgrade-Handling für beide WebSocket-Pfade
server.on('upgrade', (request, socket, head) => {
  const pathname = request.url;

  if (pathname === '/ws') {
    wssDialogLab.handleUpgrade(request, socket, head, (ws) => {
      wssDialogLab.emit('connection', ws, request);
    });
  } else if (pathname === '/image-quiz') {
    wssImageQuiz.handleUpgrade(request, socket, head, (ws) => {
      wssImageQuiz.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});


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

// Image Quiz State
let currentImageQuiz = {
  active: false,
  imageUrl: null,
  objects: [],
  students: new Map(),
  startTime: null
};

// ========================================
// MODUL 1: Dialog-Lab WebSocket
// ========================================

function getScenarioPrompt(scenario, level) {
  const levelGuides = {
    A1: 'Use very simple words and short sentences. Speak slowly. Help with basic vocabulary.',
    A2: 'Use simple everyday language. Keep sentences clear and not too long.',
    B1: 'Use intermediate vocabulary. You can use more complex sentences, but keep it conversational.'
  };

  const prompts = {
    restaurant: `You are a friendly waiter in an English restaurant. Help the student practice ordering food. ${levelGuides[level] || levelGuides.A2} Be encouraging and patient. Speak only English. Keep responses conversational and natural. Correct mistakes gently by rephrasing correctly.`,
    shopping: `You are a helpful shop assistant in an English store. Help the student practice shopping conversations. ${levelGuides[level] || levelGuides.A2} Be encouraging and patient. Speak only English. Keep responses conversational and natural. Correct mistakes gently by rephrasing correctly.`,
    airport: `You are a friendly airport staff member. Help the student practice airport conversations like check-in, security, and finding gates. ${levelGuides[level] || levelGuides.A2} Be encouraging and patient. Speak only English. Keep responses conversational and natural. Correct mistakes gently by rephrasing correctly.`,
    doctor: `You are a caring doctor in an English clinic. Help the student practice describing symptoms and medical conversations. ${levelGuides[level] || levelGuides.A2} Be encouraging and patient. Speak only English. Keep responses conversational and natural. Correct mistakes gently by rephrasing correctly.`,
    hotel: `You are a friendly hotel receptionist. Help the student practice hotel conversations like check-in, room service, and asking for directions. ${levelGuides[level] || levelGuides.A2} Be encouraging and patient. Speak only English. Keep responses conversational and natural. Correct mistakes gently by rephrasing correctly.`,
    school: `You are a friendly teacher helping students with school-related conversations. ${levelGuides[level] || levelGuides.A2} Be encouraging and patient. Speak only English. Keep responses conversational and natural.`,
    shop: `You are a helpful shop assistant. Help the student practice shopping conversations. ${levelGuides[level] || levelGuides.A2} Be encouraging and patient. Speak only English.`,
    food: `You are a friendly restaurant server helping students order food. ${levelGuides[level] || levelGuides.A2} Be encouraging and patient. Speak only English.`,
    present: `You are a helpful shop assistant in a gift shop. Help the student practice buying presents. ${levelGuides[level] || levelGuides.A2} Be encouraging and patient. Speak only English.`
  };

  return prompts[scenario] || prompts.restaurant;
}

wssDialogLab.on('connection', (ws) => {
  console.log('📡 Dialog-Lab Client verbunden');

  let sessionData = {
    messages: [],
    scenario: 'restaurant',
    level: 'A2',
    sessionId: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    studentName: 'Student',
    startTime: new Date(),
    status: 'active'
  };

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      console.log('📨 Dialog-Lab Received:', data.type);

      if (data.type === 'change_scenario') {
        sessionData.scenario = data.scenario || 'restaurant';
        sessionData.level = data.level || 'A2';
        sessionData.messages = [];

        dialogSessions.set(sessionData.sessionId, {
          ...sessionData,
          messages: [...sessionData.messages]
        });

        ws.send(JSON.stringify({
          type: 'scenario_changed',
          scenario: sessionData.scenario,
          level: sessionData.level
        }));

        console.log(`✅ Scenario: ${sessionData.scenario}, Level: ${sessionData.level}`);

        // KI startet automatisch das Gespräch
        try {
          const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: getScenarioPrompt(sessionData.scenario, sessionData.level)
              },
              {
                role: 'user',
                content: 'Start the conversation by greeting me and asking me a question to begin our roleplay.'
              }
            ],
            temperature: 0.7,
            max_tokens: 150
          });

          const aiText = completion.choices[0].message.content;

          sessionData.messages.push({
            role: 'assistant',
            content: aiText
          });

          dialogSessions.set(sessionData.sessionId, {
            ...sessionData,
            messages: [...sessionData.messages]
          });

          let audioBase64 = null;
          try {
            const mp3 = await openai.audio.speech.create({
              model: 'tts-1',
              voice: 'alloy',
              input: aiText
            });

            const buffer = Buffer.from(await mp3.arrayBuffer());
            audioBase64 = buffer.toString('base64');
          } catch (audioError) {
            console.error('TTS Error:', audioError);
          }

          ws.send(JSON.stringify({
            type: 'ai_response',
            text: aiText,
            audio: audioBase64
          }));

          console.log('✅ AI started conversation automatically');

        } catch (error) {
          console.error('Auto-start error:', error);
        }
      }

      if (data.type === 'user_text') {
        const userMessage = data.text;

        sessionData.messages.push({
          role: 'user',
          content: userMessage
        });

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: getScenarioPrompt(sessionData.scenario, sessionData.level)
            },
            ...sessionData.messages
          ],
          temperature: 0.7,
          max_tokens: 200
        });

        const aiText = completion.choices[0].message.content;

        sessionData.messages.push({
          role: 'assistant',
          content: aiText
        });

        dialogSessions.set(sessionData.sessionId, {
          ...sessionData,
          messages: [...sessionData.messages]
        });

        let audioBase64 = null;
        try {
          const mp3 = await openai.audio.speech.create({
            model: 'tts-1',
            voice: 'alloy',
            input: aiText
          });

          const buffer = Buffer.from(await mp3.arrayBuffer());
          audioBase64 = buffer.toString('base64');
        } catch (audioError) {
          console.error('TTS Error:', audioError);
        }

        ws.send(JSON.stringify({
          type: 'ai_response',
          text: aiText,
          audio: audioBase64
        }));

        console.log('✅ AI Response sent with audio');
      }

    } catch (error) {
      console.error('❌ Dialog-Lab WebSocket Error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Ein Fehler ist aufgetreten'
      }));
    }
  });

  ws.on('close', () => {
    console.log('📡 Dialog-Lab Client getrennt');
    if (sessionData) {
      const session = dialogSessions.get(sessionData.sessionId);
      if (session) {
        session.status = 'finished';
        session.endTime = new Date();
      }
    }
  });
});

// ========================================
// MODUL 2: Vokabel-Trainer API
// ========================================

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

app.post('/api/check-pronunciation', async (req, res) => {
  try {
    const { audio } = req.body;

    const audioBuffer = Buffer.from(audio.split(',')[1], 'base64');

    const tempFile = path.join(__dirname, 'temp_audio.webm');
    fs.writeFileSync(tempFile, audioBuffer);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFile),
      model: 'whisper-1'
    });

    fs.unlinkSync(tempFile);

    res.json({
      transcription: transcription.text,
      success: true
    });
  } catch (error) {
    console.error('Pronunciation Check Error:', error);
    res.status(500).json({ error: 'Aussprachebewertung fehlgeschlagen' });
  }
});

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

app.get('/api/vocab-stats', (req, res) => {
  try {
    const wordsArray = Array.from(vocabStats.words.values());

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
// MODUL 3: Bild-Quiz (Einzelschüler)
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

app.get('/api/quiz-sessions', (req, res) => {
  try {
    res.json(quizSessions);
  } catch (error) {
    console.error('Get Quiz Sessions Error:', error);
    res.status(500).json({ error: 'Quiz-Sessions konnten nicht abgerufen werden' });
  }
});

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
// MODUL 4: Lehrer-Bild-Quiz System
// ========================================

// KORRIGIERTER LOGIN-ENDPUNKT
app.post('/api/teacher/login', (req, res) => {
  const { password } = req.body;
  
  // Liest das Passwort korrekt aus der Render.com-Umgebung
  const correctPassword = process.env.TEACHER_PASSWORD;

  if (password && password === correctPassword) {
    console.log('✅ Lehrer-Login erfolgreich');
    // Bestätigt nur den Erfolg. Der Client kümmert sich um die Session.
    res.json({ success: true });
  } else {
    console.warn('❌ Fehlgeschlagener Lehrer-Login Versuch');
    res.status(401).json({ success: false, error: 'Falsches Passwort!' });
  }
});

app.post('/api/teacher/upload-image', upload.single('image'), (req, res) => {
  try {
    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.json({
      success: true,
      imageUrl
    });
  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ error: 'Upload fehlgeschlagen' });
  }
});

app.post('/api/teacher/analyze-image', async (req, res) => {
  try {
    const { imageUrl } = req.body;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are analyzing an image for an English learning game. List ALL visible objects in the image, one per line. Only return object names in English, nothing else. Use singular forms. Be specific (e.g., "red car" not just "car"). Return 10-20 objects.'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'List all objects you can see in this image:' },
            { type: 'image_url', image_url: { url: imageUrl } }
          ]
        }
      ],
      max_tokens: 300
    });

    const objectsText = completion.choices[0].message.content;
    const objects = objectsText.split('\n')
      .map(line => line.trim().replace(/^[-•*]\s*/, '').toLowerCase())
      .filter(obj => obj.length > 0);

    res.json({
      success: true,
      objects,
      count: objects.length
    });

  } catch (error) {
    console.error('Analyze Error:', error);
    res.status(500).json({ error: 'Analyse fehlgeschlagen' });
  }
});

app.post('/api/teacher/start-image-quiz', (req, res) => {
  try {
    const { imageUrl, objects } = req.body;

    currentImageQuiz = {
      active: true,
      imageUrl,
      objects: objects.map(obj => obj.toLowerCase()),
      students: new Map(),
      startTime: Date.now()
    };

    wssImageQuiz.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'image_quiz_start',
          imageUrl,
          totalObjects: objects.length
        }));
      }
    });

    console.log('✅ Image Quiz gestartet mit', objects.length, 'Objekten');

    res.json({ success: true });
  } catch (error) {
    console.error('Start Quiz Error:', error);
    res.status(500).json({ error: 'Quiz konnte nicht gestartet werden' });
  }
});

app.post('/api/teacher/end-image-quiz', (req, res) => {
  try {
    const duration = Date.now() - currentImageQuiz.startTime;
    const students = Array.from(currentImageQuiz.students.entries()).map(([id, data]) => ({
      id,
      found: data.found.length,
      score: data.score
    }));

    wssImageQuiz.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'image_quiz_end'
        }));
      }
    });

    currentImageQuiz.active = false;

    console.log('✅ Image Quiz beendet');

    res.json({
      success: true,
      stats: {
        duration,
        students
      }
    });
  } catch (error) {
    console.error('End Quiz Error:', error);
    res.status(500).json({ error: 'Quiz konnte nicht beendet werden' });
  }
});

// ========================================
// FINALE VERSION - Erkennt Teile von Objekten (z.B. "apple" in "red apple")
// ========================================
app.post('/api/student/check-object', (req, res) => {
  try {
    const { studentId, object } = req.body;

    if (!currentImageQuiz.active) {
      return res.json({ correct: false, message: 'Kein aktives Quiz', alreadyGuessed: false });
    }

    if (!currentImageQuiz.students.has(studentId)) {
      currentImageQuiz.students.set(studentId, { found: [], score: 0 });
    }

    const studentData = currentImageQuiz.students.get(studentId);
    // Wir nehmen den ganzen Satz des Schülers, um auch Phrasen wie "cheese wedge" zu erkennen
    const spokenPhrase = object.toLowerCase().trim();
    
    let newlyFoundObjects = [];
    let pointsThisTurn = 0;

    // Durchsuche die Liste der KORREKTEN Objekte
    for (const correctObject of currentImageQuiz.objects) {
      // Prüfe, ob der Schüler dieses Objekt (oder einen Teil davon) genannt hat UND es noch nicht gefunden wurde
      if (spokenPhrase.includes(correctObject.replace(/s$/, '')) && !studentData.found.includes(correctObject)) {
        studentData.found.push(correctObject); // Speichere das vollständige, korrekte Objekt
        newlyFoundObjects.push(correctObject);
        pointsThisTurn += 10;
      }
    }

    // Wenn der Schüler einzelne Wörter sagt, die Teile von Objekten sind
    const spokenWords = spokenPhrase.split(' ');
    for (const word of spokenWords) {
        if (word.length < 3) continue; // Ignoriere sehr kurze Wörter wie 'a', 'an'
        for (const correctObject of currentImageQuiz.objects) {
            if (correctObject.includes(word) && !studentData.found.includes(correctObject)) {
                studentData.found.push(correctObject);
                newlyFoundObjects.push(correctObject);
                pointsThisTurn += 10;
            }
        }
    }


    if (newlyFoundObjects.length > 0) {
      studentData.score += pointsThisTurn;
      
      const message = `Super! Du hast gefunden: ${newlyFoundObjects.join(', ')}!`;
      
      return res.json({
        correct: true,
        message: message,
        points: pointsThisTurn,
        totalFound: studentData.found.length,
        alreadyGuessed: false 
      });

    } else {
      const alreadyGuessed = currentImageQuiz.objects.some(obj => spokenPhrase.includes(obj) && studentData.found.includes(obj));
      
      if(alreadyGuessed) {
         return res.json({
            correct: false,
            message: `Diese Objekte hast du schon gefunden. Versuche ein anderes!`,
            totalFound: studentData.found.length,
            alreadyGuessed: true
         });
      }

      return res.json({
        correct: false,
        message: `Leider wurde nichts Passendes in "${object}" gefunden.`,
        totalFound: studentData.found.length,
        alreadyGuessed: false
      });
    }

  } catch (error) {
    console.error('Check Object Error:', error);
    res.status(500).json({ error: 'Fehler beim Prüfen' });
  }
});

wssImageQuiz.on('connection', (ws) => {
  console.log('📡 Image-Quiz Client verbunden');

  if (currentImageQuiz.active) {
    ws.send(JSON.stringify({
      type: 'image_quiz_start',
      imageUrl: currentImageQuiz.imageUrl,
      totalObjects: currentImageQuiz.objects.length
    }));
  }

  ws.on('close', () => {
    console.log('📡 Image-Quiz Client getrennt');
  });
});

// ========================================
// Dialog-Lab Session Management
// ========================================

app.get('/api/sessions', (req, res) => {
  try {
    const sessions = Array.from(dialogSessions.values());
    res.json(sessions);
  } catch (error) {
    console.error('Get Sessions Error:', error);
    res.status(500).json({ error: 'Sessions konnten nicht abgerufen werden' });
  }
});

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
  console.log('   🖼️  Bild-Quiz (Schüler): /student-image-quiz.html');
  console.log('   👨‍🏫 Bild-Quiz (Lehrer): /teacher-image-quiz.html');
  console.log('   👨‍🏫 Lehrer-Dashboard: /teacher-dashboard.html');
  console.log('');
  console.log('🔌 WebSocket Endpunkte:');
  console.log('   💬 Dialog-Lab: /ws');
  console.log('   🖼️  Image-Quiz: /image-quiz');
  console.log('🚀 ========================================');
});


