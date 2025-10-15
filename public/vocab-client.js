// ========================================
// Vokabeltrainer Client - ERWEITERT
// ========================================

let ws;
let audioContext = null;
let audioUnlocked = false;

// Vokabeln
let words = [];
let currentIndex = 0;

// Versuchszähler
let currentAttempts = 0;
const MAX_ATTEMPTS = 2;

// Score & Stats
let score = 0;
let streak = 0;
let bestStreak = 0;
let correctCount = 0;
let wrongCount = 0;

// Speech Recognition
let recognition = null;
let isRecording = false;

// DOM Elemente
const startBtn = document.getElementById('start-btn');
const setupSection = document.getElementById('setup');
const questionSection = document.getElementById('quiz');
const feedbackSection = document.getElementById('feedback');
const resultsSection = document.getElementById('results');
const germanWordEl = document.getElementById('german-word');
const textAnswerInput = document.getElementById('text-answer');
const submitBtn = document.getElementById('submit-btn');
const recordBtn = document.getElementById('record-btn');
const scoreEl = document.getElementById('score');
const streakEl = document.getElementById('streak');
const currentQuestionEl = document.getElementById('current-question');
const hintBtn = document.getElementById('hint-btn');
const hintText = document.getElementById('hint-text');
const scenarioSelect = document.getElementById('scenario');
const difficultySelect = document.getElementById('difficulty');
const transcriptionDisplay = document.getElementById('transcription-display');
const transcriptionText = document.getElementById('transcription-text');

// ========================================
// Audio Context entsperren
// ========================================
async function unlockAudio() {
  if (audioUnlocked) return true;
  
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Test-Sound erzeugen
    const buffer = audioContext.createBuffer(1, 1, 22050);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start(0);
    
    audioUnlocked = true;
    console.log('✅ Audio Context entsperrt!');
    return true;
  } catch (e) {
    console.error('❌ Audio unlock failed:', e);
    return false;
  }
}

// ========================================
// Audio abspielen (Web Audio API)
// ========================================
async function playAudioFromBase64(base64Audio) {
  try {
    if (!audioContext) {
      await unlockAudio();
    }
    
    // Base64 → ArrayBuffer
    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // ArrayBuffer dekodieren
    const audioBuffer = await audioContext.decodeAudioData(bytes.buffer);
    
    // AudioBufferSourceNode erstellen
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    source.start(0);
    
    console.log('🔊 Audio wird abgespielt');
    
    return new Promise((resolve) => {
      source.onended = () => {
        console.log('✅ Audio beendet');
        resolve();
      };
    });
    
  } catch (error) {
    console.error('❌ Audio playback error:', error);
    throw error;
  }
}

// ========================================
// TTS für einzelnes Wort abrufen
// ========================================
async function speakWord(word) {
  try {
    const response = await fetch('/api/vocab/speak-word', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word })
    });
    
    if (!response.ok) throw new Error('TTS request failed');
    
    const data = await response.json();
    await playAudioFromBase64(data.audio);
    
  } catch (error) {
    console.error('❌ TTS Error:', error);
  }
}

// ========================================
// Tipp abrufen
// ========================================
async function getHint() {
  try {
    hintBtn.disabled = true;
    hintBtn.textContent = '⏳ Tipp wird geladen...';
    
    const word = words[currentIndex];
    
    const response = await fetch('/api/vocab/get-hint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        word: word.en, 
        germanWord: word.de 
      })
    });
    
    if (!response.ok) throw new Error('Hint request failed');
    
    const data = await response.json();
    
    // Tipp anzeigen
    hintText.textContent = `💡 ${data.hint}`;
    hintText.style.display = 'block';
    hintBtn.style.display = 'none';
    
  } catch (error) {
    console.error('❌ Hint Error:', error);
    hintBtn.textContent = '💡 Tipp';
    hintBtn.disabled = false;
  }
}

// ========================================
// Speech Recognition Setup
// ========================================
function setupSpeechRecognition() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    recordBtn.disabled = true;
    recordBtn.title = 'Speech Recognition nicht verfügbar';
    return;
  }
  
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.continuous = false;
  recognition.interimResults = false;
  
  recognition.onstart = () => {
    isRecording = true;
    recordBtn.classList.add('recording');
    recordBtn.textContent = '⏸️ Aufnahme läuft...';
  };
  
  recognition.onend = () => {
    isRecording = false;
    recordBtn.classList.remove('recording');
    recordBtn.textContent = '🎤 Aufnehmen & Sprechen';
  };
  
  recognition.onerror = (event) => {
    console.error('❌ Recognition error:', event.error);
    isRecording = false;
    recordBtn.classList.remove('recording');
    recordBtn.textContent = '🎤 Aufnehmen & Sprechen';
  };
  
  recognition.onresult = async (event) => {
    const transcript = event.results[0][0].transcript;
    console.log('📝 Transkript:', transcript);
    
    // Transkription sofort anzeigen
    transcriptionText.textContent = transcript;
    transcriptionDisplay.style.display = 'block';
    
    // Kurze Pause für visuelles Feedback (800ms)
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // Antwort automatisch prüfen
    await checkAnswer(transcript, 'voice');
  };
}

// ========================================
// Antwort prüfen
// ========================================
async function checkAnswer(userAnswer, inputType = 'text') {
  const word = words[currentIndex];
  currentAttempts++;
  
  // Buttons deaktivieren während Prüfung
  submitBtn.disabled = true;
  recordBtn.disabled = true;
  textAnswerInput.disabled = true;
  
  try {
    // Bei Sprachantwort: Whisper-Analyse
    if (inputType === 'voice') {
      // Hier müssten wir eigentlich das Audio an Whisper senden
      // Vereinfacht: direkte Textprüfung
      await checkTextAnswer(userAnswer);
    } else {
      await checkTextAnswer(userAnswer);
    }
    
  } catch (error) {
    console.error('❌ Check error:', error);
    submitBtn.disabled = false;
    recordBtn.disabled = false;
    textAnswerInput.disabled = false;
  }
}

// ========================================
// Text-Antwort prüfen
// ========================================
async function checkTextAnswer(userAnswer) {
  const word = words[currentIndex];
  const expected = word.en.toLowerCase().trim();
  const given = userAnswer.toLowerCase().trim();
  
  const isCorrect = expected === given;
  
  if (isCorrect) {
    // RICHTIG!
    await showFeedback({
      correct: true,
      transcribed: userAnswer,
      attempt: currentAttempts,
      pronunciationScore: null,
      expectedWord: word.en
    });
  } else {
    // FALSCH!
    if (currentAttempts >= MAX_ATTEMPTS) {
      // Zweiter Versuch auch falsch → 0 Punkte
      await showFeedback({
        correct: false,
        transcribed: userAnswer,
        attempt: currentAttempts,
        expectedWord: word.en,
        needsTTS: true
      });
    } else {
      // Erster Versuch falsch → Tipp geben
      await showFeedback({
        correct: false,
        transcribed: userAnswer,
        attempt: currentAttempts,
        expectedWord: word.en,
        needsTTS: false,
        showHint: true
      });
    }
  }
}

// ========================================
// Feedback anzeigen
// ========================================
async function showFeedback(result) {
  feedbackSection.classList.add('show');
  
  let points = 0;
  let feedbackHTML = '';
  
  if (result.correct) {
    // RICHTIG!
    feedbackSection.classList.add('correct');
    feedbackSection.classList.remove('incorrect');
    
    // Punkte je nach Versuch
    if (result.attempt === 1) {
      points = 10;
    } else {
      points = 5;
    }
    
    score += points;
    streak++;
    correctCount++;
    
    if (streak > bestStreak) bestStreak = streak;
    
    feedbackHTML = `
      <div class="feedback-icon">✅</div>
      <div class="feedback-text">${result.attempt === 1 ? 'Perfekt!' : 'Jetzt hast du\'s!'}</div>
      <div class="feedback-details">
        ${result.attempt === 1 ? 
          `Das war richtig! <strong>+${points} Punkte</strong>` : 
          `Das war beim 2. Versuch richtig! <strong>+${points} Punkte</strong>`
        }
      </div>
      <button class="next-btn" id="next-btn">Nächstes Wort →</button>
    `;
    
  } else {
    // FALSCH!
    feedbackSection.classList.add('incorrect');
    feedbackSection.classList.remove('correct');
    
    if (result.attempt >= MAX_ATTEMPTS) {
      // Zweiter Versuch auch falsch
      streak = 0;
      wrongCount++;
      
      feedbackHTML = `
        <div class="feedback-icon">❌</div>
        <div class="feedback-text">Das war leider nicht korrekt</div>
        <div class="feedback-details">
          Das richtige Wort ist: <strong>"${result.expectedWord}"</strong><br>
          💪 Nicht aufgeben! Das nächste klappt bestimmt!
        </div>
      `;
      
      // TTS abspielen
      if (result.needsTTS) {
        feedbackHTML += `<div class="tts-playing">🔊 Hör dir die korrekte Aussprache an...</div>`;
        feedbackSection.innerHTML = feedbackHTML;
        
        await speakWord(result.expectedWord);
        
        // Nach TTS: Next-Button anzeigen
        feedbackHTML += `<button class="next-btn" id="next-btn">Nächstes Wort →</button>`;
        feedbackSection.innerHTML = feedbackHTML;
        document.getElementById('next-btn').addEventListener('click', nextWord);
        
      } else {
        feedbackHTML += `<button class="next-btn" id="next-btn">Nächstes Wort →</button>`;
        feedbackSection.innerHTML = feedbackHTML;
        document.getElementById('next-btn').addEventListener('click', nextWord);
      }
      
    } else {
      // Erster Versuch falsch → Zweite Chance
      feedbackHTML = `
        <div class="feedback-icon">⚠️</div>
        <div class="feedback-text">Nicht ganz! Versuch's nochmal!</div>
        <div class="feedback-details">
          Du hast noch <strong>eine Chance</strong>!
        </div>
      `;
      
      // Tipp-Button anzeigen
      hintBtn.style.display = 'inline-block';
      
      // Tipp abrufen und anzeigen
      if (result.showHint) {
        feedbackHTML += `<div class="hint-loading">💡 Tipp wird geladen...</div>`;
        feedbackSection.innerHTML = feedbackHTML;
        
        try {
          const word = words[currentIndex];
          const response = await fetch('/api/vocab/get-hint', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              word: word.en, 
              germanWord: word.de 
            })
          });
          
          if (response.ok) {
            const data = await response.json();
            
            // Tipp in hint-text anzeigen
            hintText.textContent = `💡 ${data.hint}`;
            hintText.style.display = 'block';
            
            // Hint-loading entfernen
            const hintLoading = feedbackSection.querySelector('.hint-loading');
            if (hintLoading) hintLoading.remove();
          }
        } catch (error) {
          console.error('❌ Hint error:', error);
        }
      }
      
      feedbackHTML += `<button class="next-btn" id="retry-btn">Nochmal versuchen</button>`;
      feedbackSection.innerHTML = feedbackHTML;
      
      document.getElementById('retry-btn').addEventListener('click', () => {
        // Feedback ausblenden, Inputs wieder aktivieren
        feedbackSection.classList.remove('show');
        feedbackSection.classList.remove('incorrect');
        
        // Transkription zurücksetzen
        transcriptionDisplay.style.display = 'none';
        transcriptionText.textContent = '';
        
        submitBtn.disabled = false;
        recordBtn.disabled = false;
        textAnswerInput.disabled = false;
        textAnswerInput.value = '';
        textAnswerInput.focus();
      });
      
      return; // Nicht weitermachen!
    }
  }
  
  // Falls nicht "retry", dann Next-Button Listener
  if (result.correct || result.attempt >= MAX_ATTEMPTS) {
    if (!result.needsTTS) {
      feedbackSection.innerHTML = feedbackHTML;
      document.getElementById('next-btn').addEventListener('click', nextWord);
    }
  }
  
  // Score updaten
  scoreEl.textContent = score;
  streakEl.textContent = streak > 0 ? `${streak}🔥` : '0';
}

// ========================================
// Nächstes Wort
// ========================================
function nextWord() {
  currentIndex++;
  currentAttempts = 0;
  
  if (currentIndex >= words.length) {
    showFinalStats();
  } else {
    showQuestion();
  }
}

// ========================================
// Frage anzeigen
// ========================================
function showQuestion() {
  const word = words[currentIndex];
  
  // UI zurücksetzen
  feedbackSection.classList.remove('show');
  feedbackSection.classList.remove('correct');
  feedbackSection.classList.remove('incorrect');
  
  questionSection.classList.add('active');
  questionSection.style.display = 'block';
  resultsSection.classList.remove('show');
  resultsSection.style.display = 'none';
  
  germanWordEl.textContent = word.de;
  textAnswerInput.value = '';
  textAnswerInput.disabled = false;
  submitBtn.disabled = false;
  recordBtn.disabled = false;
  
  hintText.style.display = 'none';
  hintBtn.style.display = 'none';
  hintBtn.disabled = false;
  hintBtn.textContent = '💡 Tipp';
  
  // Transkription zurücksetzen
  transcriptionDisplay.style.display = 'none';
  transcriptionText.textContent = '';
  
  // Fortschritt aktualisieren
  if (currentQuestionEl) {
    currentQuestionEl.textContent = currentIndex + 1;
  }
  
  textAnswerInput.focus();
}

// ========================================
// Finale Statistik
// ========================================
function showFinalStats() {
  questionSection.style.display = 'none';
  feedbackSection.classList.remove('show');
  
  const totalWords = words.length;
  const percentage = Math.round((correctCount / totalWords) * 100);
  
  // Ergebnis-Sektion füllen
  document.getElementById('final-percentage').textContent = percentage + '%';
  document.getElementById('total-correct').textContent = correctCount;
  document.getElementById('total-wrong').textContent = wrongCount;
  document.getElementById('best-streak').textContent = bestStreak + '🔥';
  
  resultsSection.classList.add('show');
  resultsSection.style.display = 'block';
}

// ========================================
// Start
// ========================================
startBtn.addEventListener('click', async () => {
  // Audio entsperren
  await unlockAudio();
  
  // Speech Recognition Setup
  setupSpeechRecognition();
  
  // Vokabeln basierend auf Auswahl laden
  const scenario = scenarioSelect.value;
  const difficulty = difficultySelect.value;
  
  // Dummy-Vokabeln (später vom Server laden)
  const vocabSets = {
    shop: [
      { de: 'Einkaufswagen', en: 'shopping cart' },
      { de: 'Kasse', en: 'checkout' },
      { de: 'Preis', en: 'price' },
      { de: 'Rabatt', en: 'discount' },
      { de: 'Quittung', en: 'receipt' },
      { de: 'Warenkorb', en: 'basket' },
      { de: 'Öffnungszeiten', en: 'opening hours' },
      { de: 'Umkleidekabine', en: 'fitting room' },
      { de: 'Größe', en: 'size' },
      { de: 'Rückgabe', en: 'return' },
      { de: 'Garantie', en: 'warranty' },
      { de: 'Tasche', en: 'bag' },
      { de: 'Verkäufer', en: 'salesperson' },
      { de: 'Kreditkarte', en: 'credit card' },
      { de: 'Bargeld', en: 'cash' }
    ],
    airport: [
      { de: 'Flugzeug', en: 'airplane' },
      { de: 'Gepäck', en: 'luggage' },
      { de: 'Boarding-Pass', en: 'boarding pass' },
      { de: 'Sicherheitskontrolle', en: 'security check' },
      { de: 'Tor', en: 'gate' },
      { de: 'Abflug', en: 'departure' },
      { de: 'Ankunft', en: 'arrival' },
      { de: 'Handgepäck', en: 'carry-on' },
      { de: 'Reisepass', en: 'passport' },
      { de: 'Zoll', en: 'customs' },
      { de: 'Verspätung', en: 'delay' },
      { de: 'Flugbegleiter', en: 'flight attendant' },
      { de: 'Notausgang', en: 'emergency exit' },
      { de: 'Sitzplatz', en: 'seat' },
      { de: 'Anschnallgurt', en: 'seatbelt' }
    ],
    school: [
      { de: 'Lehrer', en: 'teacher' },
      { de: 'Hausaufgaben', en: 'homework' },
      { de: 'Klassenzimmer', en: 'classroom' },
      { de: 'Prüfung', en: 'exam' },
      { de: 'Bleistift', en: 'pencil' },
      { de: 'Schulbuch', en: 'textbook' },
      { de: 'Tafel', en: 'blackboard' },
      { de: 'Pause', en: 'break' },
      { de: 'Unterricht', en: 'lesson' },
      { de: 'Note', en: 'grade' },
      { de: 'Schüler', en: 'student' },
      { de: 'Stundenplan', en: 'schedule' },
      { de: 'Rucksack', en: 'backpack' },
      { de: 'Radiergummi', en: 'eraser' },
      { de: 'Lineal', en: 'ruler' }
    ],
    food: [
      { de: 'Speisekarte', en: 'menu' },
      { de: 'Rechnung', en: 'bill' },
      { de: 'Kellner', en: 'waiter' },
      { de: 'Tisch', en: 'table' },
      { de: 'Trinkgeld', en: 'tip' },
      { de: 'Vorspeise', en: 'appetizer' },
      { de: 'Hauptgericht', en: 'main course' },
      { de: 'Nachtisch', en: 'dessert' },
      { de: 'Getränk', en: 'beverage' },
      { de: 'Besteck', en: 'cutlery' },
      { de: 'Gabel', en: 'fork' },
      { de: 'Messer', en: 'knife' },
      { de: 'Löffel', en: 'spoon' },
      { de: 'Serviette', en: 'napkin' },
      { de: 'Reservierung', en: 'reservation' }
    ],
    present: [
      { de: 'Geschenk', en: 'present' },
      { de: 'Geburtstag', en: 'birthday' },
      { de: 'Überraschung', en: 'surprise' },
      { de: 'Verpackung', en: 'wrapping' },
      { de: 'Schleife', en: 'bow' },
      { de: 'Karte', en: 'card' },
      { de: 'Feier', en: 'celebration' },
      { de: 'Kuchen', en: 'cake' },
      { de: 'Kerze', en: 'candle' },
      { de: 'Gast', en: 'guest' },
      { de: 'Einladung', en: 'invitation' },
      { de: 'Party', en: 'party' },
      { de: 'Luftballon', en: 'balloon' },
      { de: 'Dekoration', en: 'decoration' },
      { de: 'Wunsch', en: 'wish' }
    ]
  };
  
  words = vocabSets[scenario] || vocabSets.shop;
  
  // Schwierigkeit anwenden
  const wordCounts = { easy: 5, medium: 10, hard: 15 };
  const targetCount = wordCounts[difficulty] || 10;
  
  // Wenn mehr Wörter gewünscht als vorhanden, wiederholen
  while (words.length < targetCount) {
    words = [...words, ...vocabSets[scenario]];
  }
  words = words.slice(0, targetCount);
  
  // UI umschalten
  setupSection.style.display = 'none';
  showQuestion();
});

// Submit Button
submitBtn.addEventListener('click', () => {
  const answer = textAnswerInput.value.trim();
  if (answer) {
    checkAnswer(answer, 'text');
  }
});

// Enter-Taste im Input
textAnswerInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    submitBtn.click();
  }
});

// Record Button
recordBtn.addEventListener('click', () => {
  if (isRecording) {
    recognition.stop();
  } else {
    recognition.start();
  }
});

// Hint Button
hintBtn.addEventListener('click', getHint);
