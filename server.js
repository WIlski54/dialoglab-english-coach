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

app.use(express.json({ limit: '50mb' }));
app.use(express.static('.'));

const PORT = process.env.PORT || 3000;

// ========================================
// OpenAI Setup
// ========================================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const CHAT_MODEL = process.env.CHAT_MODEL || 'gpt-4o-mini';
const TTS_MODEL = process.env.TTS_MODEL || 'tts-1';
const TTS_VOICE = process.env.TTS_VOICE || 'alloy';

// ========================================
// Multer Setup für Bild-Upload
// ========================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = './uploads/images';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Nur Bilder sind erlaubt!'));
    }
  }
});

// ========================================
// Globale Variablen
// ========================================

// Bild-Quiz State
let activeImageQuiz = {
  imageUrl: null,
  imagePath: null,
  detectedObjects: [],
  studentsAnswers: new Map(),
  isActive: false
};

// Lehrer-Login
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || 'lehrer123';
const activeSessions = new Set();

// ========================================
// WebSocket Connection Handler
// ========================================
wss.on('connection', (ws) => {
  console.log('✅ Neue WebSocket Verbindung');
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      console.log('📨 Nachricht empfangen:', data.type);
      
      // Verarbeite verschiedene Message-Types hier wenn nötig
      
    } catch (error) {
      console.error('❌ WebSocket message error:', error);
    }
  });
  
  ws.on('close', () => {
    console.log('🔌 WebSocket Verbindung geschlossen');
  });
});

// ========================================
// DIALOG-LAB APIs
// ========================================

// Chat API
app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    
    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: messages
    });
    
    const reply = completion.choices[0].message.content;
    console.log('💬 Chat response:', reply.substring(0, 50) + '...');
    
    res.json({ reply });
  } catch (error) {
    console.error('❌ Chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

// TTS API
app.post('/api/tts', async (req, res) => {
  try {
    const { text } = req.body;
    
    console.log('🔊 TTS für:', text.substring(0, 50));
    
    const mp3Response = await openai.audio.speech.create({
      model: TTS_MODEL,
      voice: TTS_VOICE,
      input: text
    });
    
    const buffer = Buffer.from(await mp3Response.arrayBuffer());
    const audioBase64 = buffer.toString('base64');
    
    res.json({ audio: audioBase64 });
  } catch (error) {
    console.error('❌ TTS error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// VOKABEL-TRAINER APIs
// ========================================

// TTS für einzelnes Wort
app.post('/api/vocab/speak-word', async (req, res) => {
  try {
    const { word } = req.body;
    
    if (!word) {
      return res.status(400).json({ error: 'Missing word' });
    }
    
    console.log('🔊 Generating TTS for:', word);
    
    const mp3Response = await openai.audio.speech.create({
      model: TTS_MODEL,
      voice: TTS_VOICE,
      input: word
    });
    
    const buffer = Buffer.from(await mp3Response.arrayBuffer());
    const audioBase64 = buffer.toString('base64');
    
    res.json({ audio: audioBase64 });
    
  } catch (error) {
    console.error('❌ TTS generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Tipp generieren mit ChatGPT
app.post('/api/vocab/get-hint', async (req, res) => {
  try {
    const { word, germanWord } = req.body;
    
    if (!word || !germanWord) {
      return res.status(400).json({ error: 'Missing word or germanWord' });
    }
    
    console.log('💡 Generating hint for:', word);
    
    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a helpful English teacher. Generate a SHORT hint (max 10 words) in German to help a student guess the English word. The hint should be helpful but not give away the entire answer.'
        },
        {
          role: 'user',
          content: `Das deutsche Wort ist "${germanWord}". Das englische Wort ist "${word}". Gib einen kurzen Tipp auf Deutsch.`
        }
      ]
    });
    
    const hint = completion.choices[0].message.content.trim();
    
    res.json({ hint });
    
  } catch (error) {
    console.error('❌ Hint generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// BILD-QUIZ APIs
// ========================================

// Bild hochladen (Lehrer)
app.post('/api/teacher/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Kein Bild hochgeladen' });
    }
    
    const imageUrl = `/uploads/images/${req.file.filename}`;
    const imagePath = req.file.path;
    
    console.log('📸 Bild hochgeladen:', imageUrl);
    
    res.json({
      success: true,
      imageUrl: imageUrl,
      imagePath: imagePath,
      message: 'Bild erfolgreich hochgeladen'
    });
    
  } catch (error) {
    console.error('❌ Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bild analysieren mit GPT-5 Vision
app.post('/api/teacher/analyze-image', async (req, res) => {
  try {
    const { imageUrl } = req.body;
    
    if (!imageUrl) {
      return res.status(400).json({ error: 'Keine Bild-URL angegeben' });
    }
    
    console.log('🔍 Analysiere Bild:', imageUrl);
    
    // Vollständige URL konstruieren
    const fullImageUrl = imageUrl.startsWith('http') 
      ? imageUrl 
      : `${req.protocol}://${req.get('host')}${imageUrl}`;
    
    // GPT-5 Vision API Call
    const response = await openai.chat.completions.create({
      model: 'gpt-5',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze this image and list ALL visible objects in English. 
              Return ONLY a JSON array of object names (common nouns, lowercase, singular form).
              Include objects, people, animals, furniture, nature elements, etc.
              Example format: ["apple", "tree", "car", "person", "dog"]
              Be thorough and list at least 15-30 objects if possible.`
            },
            {
              type: 'image_url',
              image_url: { url: fullImageUrl }
            }
          ]
        }
      ],
      max_tokens: 500,
      temperature: 0.3
    });
    
    const content = response.choices[0].message.content;
    console.log('📝 GPT-5 Vision Antwort:', content);
    
    // JSON extrahieren
    let detectedObjects = [];
    try {
      detectedObjects = JSON.parse(content);
    } catch (e) {
      const jsonMatch = content.match(/\[.*\]/s);
      if (jsonMatch) {
        detectedObjects = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Konnte keine Objekte aus der Antwort extrahieren');
      }
    }
    
    // Normalisieren: lowercase, trim, deduplizieren
    detectedObjects = [...new Set(
      detectedObjects
        .map(obj => obj.toLowerCase().trim())
        .filter(obj => obj.length > 0)
    )];
    
    console.log('✅ Erkannte Objekte:', detectedObjects);
    
    res.json({
      success: true,
      objects: detectedObjects,
      count: detectedObjects.length
    });
    
  } catch (error) {
    console.error('❌ Analyse error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bild-Quiz starten & an Schüler senden
app.post('/api/teacher/start-image-quiz', (req, res) => {
  try {
    const { imageUrl, objects } = req.body;
    
    if (!imageUrl || !objects || objects.length === 0) {
      return res.status(400).json({ error: 'Bild-URL und Objekte erforderlich' });
    }
    
    // Quiz-State aktualisieren
    activeImageQuiz = {
      imageUrl: imageUrl,
      detectedObjects: objects,
      studentsAnswers: new Map(),
      isActive: true,
      startTime: Date.now()
    };
    
    console.log('🎯 Bild-Quiz gestartet mit', objects.length, 'Objekten');
    
    // Broadcast an alle verbundenen Schüler
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'image_quiz_start',
          imageUrl: imageUrl,
          totalObjects: objects.length,
          message: 'Neues Bild-Quiz gestartet!'
        }));
      }
    });
    
    res.json({
      success: true,
      message: 'Quiz gestartet und an alle Schüler gesendet',
      activeQuiz: {
        imageUrl: activeImageQuiz.imageUrl,
        objectCount: activeImageQuiz.detectedObjects.length
      }
    });
    
  } catch (error) {
    console.error('❌ Start quiz error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Objekt-Antwort prüfen (Schüler)
app.post('/api/student/check-object', (req, res) => {
  try {
    const { studentId, object } = req.body;
    
    if (!activeImageQuiz.isActive) {
      return res.status(400).json({ 
        error: 'Kein aktives Quiz',
        correct: false 
      });
    }
    
    const normalizedObject = object.toLowerCase().trim();
    
    // Prüfe ob Objekt im Bild ist
    const isCorrect = activeImageQuiz.detectedObjects.includes(normalizedObject);
    
    // Prüfe ob Schüler dieses Objekt bereits genannt hat
    if (!activeImageQuiz.studentsAnswers.has(studentId)) {
      activeImageQuiz.studentsAnswers.set(studentId, new Set());
    }
    
    const studentAnswers = activeImageQuiz.studentsAnswers.get(studentId);
    const alreadyGuessed = studentAnswers.has(normalizedObject);
    
    let points = 0;
    let message = '';
    
    if (!isCorrect) {
      message = `"${object}" ist nicht im Bild!`;
    } else if (alreadyGuessed) {
      message = `"${object}" hast du bereits genannt!`;
    } else {
      studentAnswers.add(normalizedObject);
      points = 10;
      message = `Richtig! "${object}" gefunden! +${points} Punkte`;
    }
    
    console.log(`🎯 Schüler ${studentId}: ${object} → ${isCorrect ? '✅' : '❌'} (${points} Punkte)`);
    
    res.json({
      correct: isCorrect && !alreadyGuessed,
      points: points,
      message: message,
      alreadyGuessed: alreadyGuessed,
      totalFound: studentAnswers.size,
      totalObjects: activeImageQuiz.detectedObjects.length
    });
    
  } catch (error) {
    console.error('❌ Check object error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Quiz beenden (Lehrer)
app.post('/api/teacher/end-image-quiz', (req, res) => {
  try {
    if (!activeImageQuiz.isActive) {
      return res.status(400).json({ error: 'Kein aktives Quiz' });
    }
    
    // Statistiken sammeln
    const stats = {
      duration: Date.now() - activeImageQuiz.startTime,
      totalObjects: activeImageQuiz.detectedObjects.length,
      students: []
    };
    
    activeImageQuiz.studentsAnswers.forEach((answers, studentId) => {
      stats.students.push({
        id: studentId,
        found: answers.size,
        objects: Array.from(answers)
      });
    });
    
    // Broadcast Quiz-Ende an alle Schüler
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'image_quiz_end',
          message: 'Quiz beendet!',
          stats: stats
        }));
      }
    });
    
    console.log('🏁 Quiz beendet:', stats);
    
    // Quiz zurücksetzen
    activeImageQuiz.isActive = false;
    
    res.json({
      success: true,
      message: 'Quiz beendet',
      stats: stats
    });
    
  } catch (error) {
    console.error('❌ End quiz error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Quiz-Status abrufen
app.get('/api/quiz/status', (req, res) => {
  res.json({
    isActive: activeImageQuiz.isActive,
    imageUrl: activeImageQuiz.imageUrl,
    totalObjects: activeImageQuiz.detectedObjects.length,
    connectedStudents: activeImageQuiz.studentsAnswers.size
  });
});

// ========================================
// LEHRER-LOGIN APIs
// ========================================

// Lehrer Login
app.post('/api/teacher/login', (req, res) => {
  try {
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Passwort erforderlich' 
      });
    }
    
    // Passwort prüfen
    if (password === TEACHER_PASSWORD) {
      const sessionId = Math.random().toString(36).substring(2);
      activeSessions.add(sessionId);
      
      console.log('✅ Lehrer eingeloggt - Session:', sessionId);
      
      res.json({
        success: true,
        message: 'Login erfolgreich',
        sessionId: sessionId
      });
    } else {
      console.log('❌ Falsches Passwort');
      
      res.status(401).json({
        success: false,
        error: 'Falsches Passwort'
      });
    }
    
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Session validieren
app.post('/api/teacher/validate-session', (req, res) => {
  try {
    const { sessionId } = req.body;
    
    if (activeSessions.has(sessionId)) {
      res.json({ valid: true });
    } else {
      res.json({ valid: false });
    }
    
  } catch (error) {
    console.error('❌ Validation error:', error);
    res.status(500).json({ 
      valid: false, 
      error: error.message 
    });
  }
});

// Logout
app.post('/api/teacher/logout', (req, res) => {
  try {
    const { sessionId } = req.body;
    
    if (sessionId) {
      activeSessions.delete(sessionId);
      console.log('👋 Lehrer ausgeloggt');
    }
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('❌ Logout error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ========================================
// Statische Dateien
// ========================================
app.use('/uploads', express.static('uploads'));

// ========================================
// Server starten
// ========================================
server.listen(PORT, () => {
  console.log('🚀 DialogLab Server gestartet!');
  console.log(`📍 Port: ${PORT}`);
  console.log(`💬 Chat Model: ${CHAT_MODEL}`);
  console.log(`🔊 TTS Model: ${TTS_MODEL}`);
  console.log(`🔐 Lehrer-Passwort gesetzt: ${process.env.TEACHER_PASSWORD ? '✅' : '⚠️ Standard'}`);
  console.log('');
  console.log('✅ Module geladen:');
  console.log('   - Dialog-Lab');
  console.log('   - Vokabel-Trainer');
  console.log('   - Bild-Quiz (GPT-5 Vision)');
  console.log('   - Lehrer-Login System');
});
