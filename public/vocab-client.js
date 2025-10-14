// ========================================
// VOKABELTRAINER - CLIENT LOGIK
// ========================================

// DOM-Elemente
const setupSection = document.getElementById('setup');
const quizSection = document.getElementById('quiz');
const resultsSection = document.getElementById('results');
const feedbackSection = document.getElementById('feedback');

const scenarioSelect = document.getElementById('scenario');
const difficultySelect = document.getElementById('difficulty');
const startBtn = document.getElementById('start-btn');

const currentQuestionEl = document.getElementById('current-question');
const scoreEl = document.getElementById('score');
const streakEl = document.getElementById('streak');
const germanWordEl = document.getElementById('german-word');

const recordBtn = document.getElementById('record-btn');
const textAnswerInput = document.getElementById('text-answer');
const submitBtn = document.getElementById('submit-btn');
const nextBtn = document.getElementById('next-btn');

// Quiz-State
let words = [];
let currentIndex = 0;
let score = 0;
let streak = 0;
let bestStreak = 0;
let correctCount = 0;
let wrongCount = 0;

// Audio-Aufnahme
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

// ========================================
// START QUIZ
// ========================================
startBtn.addEventListener('click', async () => {
  const scenario = scenarioSelect.value;
  const difficulty = difficultySelect.value;
  
  startBtn.disabled = true;
  startBtn.textContent = 'Lädt...';
  
  try {
    // Vokabeln vom Server holen
    const response = await fetch('/api/vocab/get-words', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario, difficulty })
    });
    
    if (!response.ok) throw new Error('Failed to load vocabulary');
    
    const data = await response.json();
    words = data.words;
    
    // Quiz starten
    currentIndex = 0;
    score = 0;
    streak = 0;
    bestStreak = 0;
    correctCount = 0;
    wrongCount = 0;
    
    setupSection.style.display = 'none';
    quizSection.classList.add('active');
    
    showQuestion();
    initAudioRecorder();
    
  } catch (error) {
    console.error('Start error:', error);
    alert('Fehler beim Laden der Vokabeln. Bitte versuche es erneut.');
    startBtn.disabled = false;
    startBtn.textContent = 'Start!';
  }
});

// ========================================
// FRAGE ANZEIGEN
// ========================================
function showQuestion() {
  if (currentIndex >= words.length) {
    showResults();
    return;
  }
  
  const word = words[currentIndex];
  
  currentQuestionEl.textContent = `${currentIndex + 1}/${words.length}`;
  scoreEl.textContent = score;
  streakEl.textContent = streak > 0 ? `${streak}🔥` : '0';
  germanWordEl.textContent = word.de;
  
  textAnswerInput.value = '';
  textAnswerInput.disabled = false;
  submitBtn.disabled = false;
  recordBtn.disabled = false;
  
  feedbackSection.classList.remove('show');
  feedbackSection.classList.remove('correct');
  feedbackSection.classList.remove('incorrect');
}

// ========================================
// AUDIO-AUFNAHME INITIALISIEREN
// ========================================
async function initAudioRecorder() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 44100
      } 
    });
    
    // MediaRecorder mit webm/opus (iOS & Android kompatibel)
    const options = { mimeType: 'audio/webm;codecs=opus' };
    
    // Fallback für Safari
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options.mimeType = 'audio/mp4';
    }
    
    mediaRecorder = new MediaRecorder(stream, options);
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };
    
    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
      audioChunks = [];
      
      await checkPronunciation(audioBlob);
    };
    
    console.log('✅ Audio recorder initialized');
    
  } catch (error) {
    console.error('Microphone error:', error);
    recordBtn.disabled = true;
    recordBtn.textContent = '🎤 Mikrofon nicht verfügbar';
  }
}

// ========================================
// AUFNAHME STARTEN/STOPPEN
// ========================================
recordBtn.addEventListener('click', () => {
  if (!mediaRecorder) {
    alert('Mikrofon nicht verfügbar. Bitte gib die Antwort per Text ein.');
    return;
  }
  
  if (isRecording) {
    // Aufnahme stoppen
    mediaRecorder.stop();
    isRecording = false;
    recordBtn.classList.remove('recording');
    recordBtn.textContent = '🎤 Aufnehmen & Sprechen';
    recordBtn.disabled = true;
  } else {
    // Aufnahme starten
    audioChunks = [];
    mediaRecorder.start();
    isRecording = true;
    recordBtn.classList.add('recording');
    recordBtn.textContent = '🔴 STOP (Aufnahme läuft)';
    
    // Nach 5 Sekunden automatisch stoppen
    setTimeout(() => {
      if (isRecording) {
        recordBtn.click();
      }
    }, 5000);
  }
});

// ========================================
// AUSSPRACHE PRÜFEN (WHISPER API mit Base64)
// ========================================
async function checkPronunciation(audioBlob) {
  const word = words[currentIndex];
  
  try {
    // Audio Blob zu Base64 konvertieren
    const base64Audio = await blobToBase64(audioBlob);
    
    const response = await fetch('/api/vocab/check-pronunciation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioBase64: base64Audio,
        expectedWord: word.en
      })
    });
    
    if (!response.ok) throw new Error('Pronunciation check failed');
    
    const result = await response.json();
    
    showFeedback(result);
    
  } catch (error) {
    console.error('Pronunciation check error:', error);
    alert('Fehler bei der Aussprache-Prüfung. Versuche es nochmal!');
    recordBtn.disabled = false;
  }
}

// Blob zu Base64 konvertieren
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result.split(',')[1]; // Remove data:audio/webm;base64,
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ========================================
// TEXT-ANTWORT PRÜFEN
// ========================================
submitBtn.addEventListener('click', () => {
  const answer = textAnswerInput.value.trim().toLowerCase();
  const word = words[currentIndex];
  
  if (!answer) return;
  
  const correct = answer === word.en.toLowerCase();
  
  showFeedback({
    correct: correct,
    transcribed: answer,
    expected: word.en,
    pronunciationScore: null,
    tips: null
  });
});

textAnswerInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    submitBtn.click();
  }
});

// ========================================
// FEEDBACK ANZEIGEN
// ========================================
function showFeedback(result) {
  feedbackSection.classList.add('show');
  
  if (result.correct) {
    // RICHTIG!
    feedbackSection.classList.add('correct');
    feedbackSection.classList.remove('incorrect');
    
    score += 10;
    streak++;
    correctCount++;
    
    if (streak > bestStreak) bestStreak = streak;
    
    let feedbackHTML = `
      <div class="feedback-icon">✅</div>
      <div class="feedback-text">Richtig!</div>
    `;
    
    if (result.pronunciationScore !== null) {
      const stars = '⭐'.repeat(result.pronunciationScore);
      feedbackHTML += `
        <div class="feedback-details">
          Du hast "<strong>${result.transcribed}</strong>" gesagt.<br>
          Aussprache: ${stars}
        </div>
      `;
    } else {
      feedbackHTML += `
        <div class="feedback-details">
          Die Antwort "<strong>${result.transcribed}</strong>" ist korrekt!
        </div>
      `;
    }
    
    if (result.tips && result.tips.length > 0) {
      feedbackHTML += `<div class="feedback-details">${result.tips.join('<br>')}</div>`;
    }
    
    feedbackSection.innerHTML = feedbackHTML + `
      <button class="next-btn" id="next-btn">Nächstes Wort →</button>
    `;
    
  } else {
    // FALSCH!
    feedbackSection.classList.add('incorrect');
    feedbackSection.classList.remove('correct');
    
    streak = 0;
    wrongCount++;
    
    const word = words[currentIndex];
    
    let feedbackHTML = `
      <div class="feedback-icon">❌</div>
      <div class="feedback-text">Nicht ganz richtig</div>
      <div class="feedback-details">
        Du hast "<strong>${result.transcribed}</strong>" gesagt.<br>
        Richtig wäre: "<strong>${word.en}</strong>"
      </div>
    `;
    
    if (result.tips && result.tips.length > 0) {
      feedbackHTML += `<div class="feedback-details">${result.tips.join('<br>')}</div>`;
    }
    
    feedbackSection.innerHTML = feedbackHTML + `
      <button class="next-btn" id="next-btn">Nächstes Wort →</button>
    `;
  }
  
  // Event-Listener für Next-Button
  document.getElementById('next-btn').addEventListener('click', () => {
    currentIndex++;
    showQuestion();
  });
  
  // Input deaktivieren
  textAnswerInput.disabled = true;
  submitBtn.disabled = true;
  recordBtn.disabled = true;
  
  // Score updaten
  scoreEl.textContent = score;
  streakEl.textContent = streak > 0 ? `${streak}🔥` : '0';
}

// ========================================
// ERGEBNISSE ANZEIGEN
// ========================================
function showResults() {
  quizSection.classList.remove('active');
  resultsSection.classList.add('show');
  
  const totalWords = words.length;
  const percentage = Math.round((correctCount / totalWords) * 100);
  
  document.getElementById('final-percentage').textContent = `${percentage}%`;
  document.getElementById('total-correct').textContent = correctCount;
  document.getElementById('total-wrong').textContent = wrongCount;
  document.getElementById('best-streak').textContent = bestStreak > 0 ? `${bestStreak}🔥` : '0';
  
  // Mediastream stoppen
  if (mediaRecorder && mediaRecorder.stream) {
    mediaRecorder.stream.getTracks().forEach(track => track.stop());
  }
}

// ========================================
// INITIAL STATE
// ========================================
console.log('✅ Vocabulary Trainer loaded');
