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
const questionSection = document.getElementById('question-section');
const feedbackSection = document.getElementById('feedback-section');
const germanWordEl = document.getElementById('german-word');
const textAnswerInput = document.getElementById('text-answer');
const submitBtn = document.getElementById('submit-btn');
const recordBtn = document.getElementById('record-btn');
const scoreEl = document.getElementById('score');
const streakEl = document.getElementById('streak');
const statsSection = document.getElementById('stats-section');
const hintBtn = document.getElementById('hint-btn');
const hintText = document.getElementById('hint-text');

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
    recordBtn.textContent = '🎤 Sprechen';
  };
  
  recognition.onerror = (event) => {
    console.error('❌ Recognition error:', event.error);
    isRecording = false;
    recordBtn.classList.remove('recording');
    recordBtn.textContent = '🎤 Sprechen';
  };
  
  recognition.onresult = async (event) => {
    const transcript = event.results[0][0].transcript;
    console.log('📝 Transkript:', transcript);
    
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
            feedbackHTML = feedbackHTML.replace(
              '<div class="hint-loading">💡 Tipp wird geladen...</div>',
              `<div class="hint-display">💡 Tipp: ${data.hint}</div>`
            );
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
  
  questionSection.style.display = 'block';
  
  germanWordEl.textContent = word.de;
  textAnswerInput.value = '';
  textAnswerInput.disabled = false;
  submitBtn.disabled = false;
  recordBtn.disabled = false;
  
  hintText.style.display = 'none';
  hintBtn.style.display = 'inline-block';
  hintBtn.disabled = false;
  hintBtn.textContent = '💡 Tipp';
  
  textAnswerInput.focus();
}

// ========================================
// Finale Statistik
// ========================================
function showFinalStats() {
  questionSection.style.display = 'none';
  feedbackSection.classList.remove('show');
  
  statsSection.innerHTML = `
    <h2>🎉 Quiz beendet!</h2>
    <div class="stats-grid">
      <div class="stat-item">
        <div class="stat-value">${score}</div>
        <div class="stat-label">Punkte</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${correctCount}</div>
        <div class="stat-label">Richtig</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${wrongCount}</div>
        <div class="stat-label">Falsch</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${bestStreak}🔥</div>
        <div class="stat-label">Beste Serie</div>
      </div>
    </div>
    <button class="next-btn" onclick="location.reload()">Nochmal spielen</button>
  `;
  
  statsSection.style.display = 'block';
}

// ========================================
// Start
// ========================================
startBtn.addEventListener('click', async () => {
  // Audio entsperren
  await unlockAudio();
  
  // Speech Recognition Setup
  setupSpeechRecognition();
  
  // Vokabeln laden (Dummy für Demo)
  words = [
    { de: 'Apfel', en: 'apple' },
    { de: 'Buch', en: 'book' },
    { de: 'Katze', en: 'cat' },
    { de: 'Hund', en: 'dog' },
    { de: 'Haus', en: 'house' }
  ];
  
  // UI umschalten
  startBtn.style.display = 'none';
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
