// ========================================
// Vokabeltrainer Client - FINAL mit Audio
// ========================================

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
const audioButton = document.getElementById('audio-button'); // Zugriff auf den Audio-Button

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
    
    // Wichtig: Kurze Pause, um sicherzustellen, dass der Context wirklich aktiv ist
    await new Promise(resolve => setTimeout(resolve, 50)); 
    
    audioUnlocked = true;
    console.log('✅ Audio Context entsperrt!');
    return true;
  } catch (e) {
    console.error('❌ Audio unlock failed:', e);
    // Versuchen, den Context bei der nächsten Interaktion zu erstellen
    audioUnlocked = false; 
    return false;
  }
}

// ========================================
// KORRIGIERTE TTS-Funktion (Sprachausgabe)
// ========================================
async function speakWord(word) {
  if (!word) {
    console.warn("Kein Wort zum Aussprechen übergeben.");
    return;
  }
  
  try {
    // Sicherstellen, dass der Audio Context bereit ist
    if (!audioContext || audioContext.state === 'suspended') {
      await unlockAudio();
    }
     // Falls immer noch nicht bereit (z.B. User hat nie interagiert), abbrechen
    if (!audioUnlocked) { 
        alert("Audio kann nicht abgespielt werden. Bitte interagiere zuerst mit der Seite (z.B. Klick).");
        return;
    }
    
    console.log(`🔊 Versuche "${word}" auszusprechen...`);
    
    // API-Aufruf an den korrekten Endpunkt
    const response = await fetch('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: word }) 
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`TTS request failed: ${response.status} ${errorText}`);
    }
    
    // Server sendet direkt ein Audio-Blob
    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    
    // Fehlerbehandlung für das Audio-Element selbst
    audio.onerror = (e) => {
        console.error("❌ Fehler beim Abspielen des Audio-Elements:", e);
        alert("Fehler beim Abspielen der Aussprache.");
    };

    audio.play();
    console.log('▶️ Audio wird abgespielt');
    
  } catch (error) {
    console.error('❌ TTS Error:', error);
    alert('Fehler bei der Sprachausgabe. Details siehe Konsole.');
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
    
    // Korrekter API-Pfad
    const response = await fetch('/api/vocab-hint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        english: word.en, // Server erwartet 'english' und 'german'
        german: word.de 
      })
    });
    
    if (!response.ok) throw new Error('Hint request failed');
    
    const data = await response.json();
    
    // Tipp anzeigen
    hintText.textContent = `💡 ${data.hint}`;
    hintText.style.display = 'block';
    hintBtn.style.display = 'none'; // Button ausblenden nach Tipp
    
  } catch (error) {
    console.error('❌ Hint Error:', error);
    hintBtn.textContent = '💡 Tipp'; // Button zurücksetzen im Fehlerfall
    hintBtn.disabled = false;
  }
}

// ========================================
// Speech Recognition Setup
// ========================================
function setupSpeechRecognition() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    console.warn("Speech Recognition nicht verfügbar.");
    recordBtn.disabled = true;
    recordBtn.title = 'Spracherkennung nicht verfügbar in diesem Browser.';
    // Verstecke den Button ganz, wenn es gar nicht geht
    recordBtn.style.display = 'none'; 
    // Zeige die Texteingabe als Fallback prominenter an
    document.querySelector('.or-divider').style.display = 'none'; 
    return;
  }
  
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.lang = 'en-US'; // Zielsprache Englisch
  recognition.continuous = false; // Nur eine Äußerung erkennen
  recognition.interimResults = false; // Nur finale Ergebnisse
  
  recognition.onstart = () => {
    isRecording = true;
    recordBtn.classList.add('recording');
    recordBtn.textContent = '👂 Höre zu...'; // Geändert für Klarheit
  };
  
  recognition.onend = () => {
    isRecording = false;
    recordBtn.classList.remove('recording');
    recordBtn.textContent = '🎤 Aufnehmen & Sprechen';
  };
  
  recognition.onerror = (event) => {
    console.error('❌ Recognition error:', event.error);
    isRecording = false; // Sicherstellen, dass der Status zurückgesetzt wird
    recordBtn.classList.remove('recording');
    recordBtn.textContent = '🎤 Aufnehmen & Sprechen';
    // Spezifisches Feedback für häufige Fehler
    if (event.error === 'no-speech') {
        alert("Ich habe nichts gehört. Bitte versuche es lauter oder näher am Mikrofon.");
    } else if (event.error === 'audio-capture') {
        alert("Problem mit dem Mikrofon. Stelle sicher, dass es verbunden und nicht stummgeschaltet ist.");
    } else if (event.error === 'not-allowed') {
        alert("Zugriff auf das Mikrofon wurde verweigert. Bitte erlaube den Zugriff in den Browser-Einstellungen.");
    } else {
        alert(`Spracherkennungsfehler: ${event.error}`);
    }
  };
  
  recognition.onresult = async (event) => {
    const transcript = event.results[0][0].transcript;
    console.log('📝 Transkript:', transcript);
    
    // Transkription sofort anzeigen
    transcriptionText.textContent = transcript;
    transcriptionDisplay.style.display = 'block';
    
    // Kurze Pause für visuelles Feedback
    await new Promise(resolve => setTimeout(resolve, 500)); // Kürzere Pause
    
    // Antwort automatisch prüfen
    await checkAnswer(transcript, 'voice');
  };
}

// ========================================
// Antwort prüfen (Hauptlogik)
// ========================================
async function checkAnswer(userAnswer, inputType = 'text') {
  if (!userAnswer) return; // Leere Eingaben ignorieren

  const word = words[currentIndex];
  currentAttempts++;
  
  // Buttons deaktivieren während Prüfung
  submitBtn.disabled = true;
  recordBtn.disabled = true;
  textAnswerInput.disabled = true;
  hintBtn.style.display = 'none'; // Tipp-Button während Prüfung ausblenden
  
  try {
      await checkTextAnswer(userAnswer); // Nur noch eine Prüffunktion
  } catch (error) {
    console.error('❌ Check error:', error);
    // Buttons im Fehlerfall wieder aktivieren
    submitBtn.disabled = false;
    recordBtn.disabled = false;
    textAnswerInput.disabled = false;
    // Zeige Tipp-Button wieder an, wenn 1. Versuch war
    if (currentAttempts < MAX_ATTEMPTS) {
        hintBtn.style.display = 'inline-block';
    }
  }
}

// ========================================
// Text-Antwort prüfen & Statistik senden
// ========================================
async function checkTextAnswer(userAnswer) {
  const word = words[currentIndex];
  const expected = word.en.toLowerCase().trim();
  const given = userAnswer.toLowerCase().trim();
  
  // Hier könnte man Fuzzy Matching einbauen (siehe spätere Erweiterung)
  const isCorrect = expected === given;
  
  // Statistik an den Server senden (Fehler hier abfangen, damit UI weitergeht)
  try {
      await fetch('/api/vocab-stats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            english: word.en, 
            german: word.de,
            correct: isCorrect
          })
      });
  } catch (statsError) {
      console.error("❌ Fehler beim Senden der Statistik:", statsError);
      // Nicht kritisch, UI soll weiterlaufen
  }
  
  // Feedback basierend auf Korrektheit und Versuch anzeigen
  if (isCorrect) {
    await showFeedback({ correct: true, attempt: currentAttempts });
  } else {
    if (currentAttempts >= MAX_ATTEMPTS) {
      await showFeedback({ correct: false, attempt: currentAttempts, expectedWord: word.en, needsTTS: true });
    } else {
      await showFeedback({ correct: false, attempt: currentAttempts, showHint: true });
    }
  }
}

// ========================================
// Feedback anzeigen
// ========================================
async function showFeedback(result) {
  feedbackSection.classList.remove('correct', 'incorrect'); // Klassen zurücksetzen
  feedbackSection.style.display = 'block'; // Sicherstellen, dass es sichtbar ist
  feedbackSection.classList.add('show'); // Animation hinzufügen
  
  let points = 0;
  let feedbackHTML = '';
  
  if (result.correct) {
    // ---- RICHTIG ----
    feedbackSection.classList.add('correct');
    
    points = (result.attempt === 1) ? 10 : 5; // Punktevergabe
    score += points;
    streak++;
    correctCount++;
    if (streak > bestStreak) bestStreak = streak;
    
    feedbackHTML = `
      <div class="feedback-icon">✅</div>
      <div class="feedback-text">${result.attempt === 1 ? 'Perfekt!' : 'Genau! (2. Versuch)'}</div>
      <div class="feedback-details">
        +${points} Punkte
      </div>
      <button class="next-btn" id="next-btn">Nächstes Wort →</button>
    `;
    
  } else {
    // ---- FALSCH ----
    feedbackSection.classList.add('incorrect');
    
    if (result.attempt >= MAX_ATTEMPTS) {
      // -- Endgültig Falsch --
      streak = 0;
      wrongCount++;
      
      feedbackHTML = `
        <div class="feedback-icon">❌</div>
        <div class="feedback-text">Leider nicht richtig.</div>
        <div class="feedback-details">
          Das richtige Wort war: <strong>"${result.expectedWord}"</strong>
        </div>
      `;
      
      // Korrekte Aussprache vorspielen
      if (result.needsTTS) {
        feedbackHTML += `<div class="tts-playing" id="tts-indicator">🔊 Korrekte Aussprache...</div>`;
        feedbackSection.innerHTML = feedbackHTML; // HTML aktualisieren, um Indicator zu zeigen
        
        try {
            await speakWord(result.expectedWord); // Warten bis Audio fertig ist
            // Indicator entfernen oder ändern
            const ttsIndicator = document.getElementById('tts-indicator');
            if(ttsIndicator) ttsIndicator.textContent = "🔊 Aussprache gehört.";
        } catch (ttsError) {
             const ttsIndicator = document.getElementById('tts-indicator');
             if(ttsIndicator) ttsIndicator.textContent = "⚠️ Aussprache fehlgeschlagen.";
        }

        // Erst danach den "Weiter"-Button hinzufügen
        feedbackHTML = feedbackSection.innerHTML; // Holen Sie sich den aktualisierten HTML
        feedbackHTML += `<button class="next-btn" id="next-btn">Nächstes Wort →</button>`;
        feedbackSection.innerHTML = feedbackHTML;
        // Event Listener für den neu hinzugefügten Button setzen
        document.getElementById('next-btn').addEventListener('click', nextWord);

      } else {
          // Fallback, falls kein TTS gebraucht wird (sollte nicht passieren bei endgültig falsch)
          feedbackHTML += `<button class="next-btn" id="next-btn">Nächstes Wort →</button>`;
          feedbackSection.innerHTML = feedbackHTML;
          document.getElementById('next-btn').addEventListener('click', nextWord);
      }
      
    } else {
      // -- Erster Versuch Falsch --
      feedbackHTML = `
        <div class="feedback-icon">🤔</div>
        <div class="feedback-text">Noch nicht ganz!</div>
        <div class="feedback-details">
          Du hast noch <strong>eine Chance</strong>.
        </div>
      `;
      
      // Tipp-Button anzeigen (wird nur angezeigt, wenn 1. Versuch falsch)
      hintBtn.style.display = 'inline-block';
      
      feedbackHTML += `<button class="next-btn" id="retry-btn">Nochmal versuchen</button>`;
      feedbackSection.innerHTML = feedbackHTML;
      
      // Event Listener für "Nochmal versuchen"
      document.getElementById('retry-btn').addEventListener('click', () => {
        feedbackSection.classList.remove('show');
        transcriptionDisplay.style.display = 'none'; // Transkription ausblenden
        
        // Buttons wieder aktivieren
        submitBtn.disabled = false;
        recordBtn.disabled = false;
        textAnswerInput.disabled = false;
        textAnswerInput.value = ''; // Eingabefeld leeren
        textAnswerInput.focus();
        
        // Tipp-Button bleibt sichtbar für den zweiten Versuch
        hintBtn.style.display = 'inline-block'; 
      });
      
      return; // WICHTIG: Funktion hier beenden, da kein "Nächstes Wort"
    }
  }
  
  // Event Listener für "Nächstes Wort" (nur wenn nicht "Nochmal versuchen")
  if (result.correct || (result.attempt >= MAX_ATTEMPTS && !result.needsTTS) ) {
    feedbackSection.innerHTML = feedbackHTML; // Sicherstellen, dass HTML aktuell ist
    document.getElementById('next-btn').addEventListener('click', nextWord);
  }
  
  // UI-Updates für Score und Streak
  scoreEl.textContent = score;
  streakEl.textContent = `${streak}🔥`;
}

// ========================================
// Nächstes Wort laden
// ========================================
function nextWord() {
  currentIndex++;
  currentAttempts = 0; // Versuche zurücksetzen
  
  if (currentIndex >= words.length) {
    showFinalStats(); // Quiz beenden
  } else {
    showQuestion(); // Nächste Frage anzeigen
  }
}

// ========================================
// Frage anzeigen (UI vorbereiten)
// ========================================
function showQuestion() {
  const word = words[currentIndex];
  
  // UI-Elemente zurücksetzen/aktualisieren
  feedbackSection.classList.remove('show', 'correct', 'incorrect');
  feedbackSection.style.display = 'none'; // Feedback komplett ausblenden
  transcriptionDisplay.style.display = 'none'; // Transkription ausblenden
  
  questionSection.classList.add('active');
  questionSection.style.display = 'block';
  resultsSection.classList.remove('show');
  resultsSection.style.display = 'none';
  
  germanWordEl.textContent = word.de; // Deutsches Wort anzeigen
  textAnswerInput.value = '';
  textAnswerInput.disabled = false;
  submitBtn.disabled = false;
  recordBtn.disabled = false;
  
  hintText.style.display = 'none'; // Tipp-Text ausblenden
  hintBtn.style.display = 'none'; // Tipp-Button ausblenden (wird bei Bedarf gezeigt)
  hintBtn.disabled = false;
  hintBtn.textContent = '💡 Tipp';
  
  // Fortschrittsanzeige aktualisieren
  currentQuestionEl.textContent = `${currentIndex + 1} / ${words.length}`; // Zeigt "1 / 10" an
  scoreEl.textContent = score;
  streakEl.textContent = `${streak}🔥`;
  
  // Audio-Button mit dem *englischen* Wort verknüpfen
  if (audioButton) {
    // Wir entfernen alte Listener und fügen einen neuen hinzu, um sicherzugehen
    audioButton.onclick = () => speakWord(word.en); 
  }
  
  textAnswerInput.focus(); // Fokus auf das Texteingabefeld
}

// ========================================
// Finale Statistik anzeigen
// ========================================
function showFinalStats() {
  questionSection.style.display = 'none';
  feedbackSection.classList.remove('show');
  
  const totalWords = words.length;
  // Sicherstellen, dass nicht durch 0 geteilt wird
  const percentage = totalWords > 0 ? Math.round((correctCount / totalWords) * 100) : 0; 
  
  // Ergebnis-Sektion füllen
  document.getElementById('final-percentage').textContent = percentage + '%';
  document.getElementById('total-correct').textContent = correctCount;
  document.getElementById('total-wrong').textContent = wrongCount;
  document.getElementById('best-streak').textContent = bestStreak + '🔥';
  
  // Ergebnis-Sektion anzeigen
  resultsSection.classList.add('show');
  resultsSection.style.display = 'block';
}

// ========================================
// Initialisierung & Start-Button Logik
// ========================================
function initializeTrainer() {
    // Event Listener für den Start-Button
    startBtn.addEventListener('click', async () => {
      // Audio sofort beim Start entsperren (erfordert Benutzerinteraktion)
      const audioReady = await unlockAudio();
      if (!audioReady) {
          // Hinweis geben, falls Audio blockiert ist (selten, aber möglich)
          alert("Audio konnte nicht initialisiert werden. Die Sprachausgabe funktioniert möglicherweise nicht.");
      }
      
      // Speech Recognition vorbereiten
      setupSpeechRecognition();
      
      // Vokabeln basierend auf Auswahl laden
      const scenario = scenarioSelect.value;
      const difficulty = difficultySelect.value;
      
      // Dummy-Vokabeln (später durch API-Aufruf ersetzen?)
      // HINWEIS: Diese Vokabellisten sollten idealerweise vom Server kommen oder
      //          zumindest in einer separaten Datei ausgelagert werden.
      const vocabSets = {
        shop: [
          { de: 'Einkaufswagen', en: 'shopping cart' }, { de: 'Kasse', en: 'checkout' }, { de: 'Preis', en: 'price' }, { de: 'Rabatt', en: 'discount' }, { de: 'Quittung', en: 'receipt' }, { de: 'Warenkorb', en: 'basket' }, { de: 'Öffnungszeiten', en: 'opening hours' }, { de: 'Umkleidekabine', en: 'fitting room' }, { de: 'Größe', en: 'size' }, { de: 'Rückgabe', en: 'return' }, { de: 'Garantie', en: 'warranty' }, { de: 'Tasche', en: 'bag' }, { de: 'Verkäufer', en: 'salesperson' }, { de: 'Kreditkarte', en: 'credit card' }, { de: 'Bargeld', en: 'cash' }
        ],
        airport: [
          { de: 'Flugzeug', en: 'airplane' }, { de: 'Gepäck', en: 'luggage' }, { de: 'Boarding-Pass', en: 'boarding pass' }, { de: 'Sicherheitskontrolle', en: 'security check' }, { de: 'Tor', en: 'gate' }, { de: 'Abflug', en: 'departure' }, { de: 'Ankunft', en: 'arrival' }, { de: 'Handgepäck', en: 'carry-on' }, { de: 'Reisepass', en: 'passport' }, { de: 'Zoll', en: 'customs' }, { de: 'Verspätung', en: 'delay' }, { de: 'Flugbegleiter', en: 'flight attendant' }, { de: 'Notausgang', en: 'emergency exit' }, { de: 'Sitzplatz', en: 'seat' }, { de: 'Anschnallgurt', en: 'seatbelt' }
        ],
        school: [
          { de: 'Lehrer', en: 'teacher' }, { de: 'Hausaufgaben', en: 'homework' }, { de: 'Klassenzimmer', en: 'classroom' }, { de: 'Prüfung', en: 'exam' }, { de: 'Bleistift', en: 'pencil' }, { de: 'Schulbuch', en: 'textbook' }, { de: 'Tafel', en: 'blackboard' }, { de: 'Pause', en: 'break' }, { de: 'Unterricht', en: 'lesson' }, { de: 'Note', en: 'grade' }, { de: 'Schüler', en: 'student' }, { de: 'Stundenplan', en: 'schedule' }, { de: 'Rucksack', en: 'backpack' }, { de: 'Radiergummi', en: 'eraser' }, { de: 'Lineal', en: 'ruler' }
        ],
        food: [
          { de: 'Speisekarte', en: 'menu' }, { de: 'Rechnung', en: 'bill' }, { de: 'Kellner', en: 'waiter' }, { de: 'Tisch', en: 'table' }, { de: 'Trinkgeld', en: 'tip' }, { de: 'Vorspeise', en: 'appetizer' }, { de: 'Hauptgericht', en: 'main course' }, { de: 'Nachtisch', en: 'dessert' }, { de: 'Getränk', en: 'beverage' }, { de: 'Besteck', en: 'cutlery' }, { de: 'Gabel', en: 'fork' }, { de: 'Messer', en: 'knife' }, { de: 'Löffel', en: 'spoon' }, { de: 'Serviette', en: 'napkin' }, { de: 'Reservierung', en: 'reservation' }
        ],
        present: [
          { de: 'Geschenk', en: 'present' }, { de: 'Geburtstag', en: 'birthday' }, { de: 'Überraschung', en: 'surprise' }, { de: 'Verpackung', en: 'wrapping' }, { de: 'Schleife', en: 'bow' }, { de: 'Karte', en: 'card' }, { de: 'Feier', en: 'celebration' }, { de: 'Kuchen', en: 'cake' }, { de: 'Kerze', en: 'candle' }, { de: 'Gast', en: 'guest' }, { de: 'Einladung', en: 'invitation' }, { de: 'Party', en: 'party' }, { de: 'Luftballon', en: 'balloon' }, { de: 'Dekoration', en: 'decoration' }, { de: 'Wunsch', en: 'wish' }
        ]
      };
      
      // Wörter laden und auf Anzahl begrenzen
      words = [...vocabSets[scenario] || vocabSets.shop]; // Kopie erstellen
      const wordCounts = { easy: 5, medium: 10, hard: 15 };
      const targetCount = wordCounts[difficulty] || 10;
      
      // Mischen und Auswählen (Fisher-Yates Shuffle)
      for (let i = words.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [words[i], words[j]] = [words[j], words[i]];
      }
      words = words.slice(0, targetCount); // Auf gewünschte Anzahl kürzen
      
      // UI umschalten und erste Frage anzeigen
      setupSection.style.display = 'none';
      currentIndex = 0; // Sicherstellen, dass wir bei 0 starten
      score = 0;
      streak = 0;
      bestStreak = 0;
      correctCount = 0;
      wrongCount = 0;
      showQuestion(); 
    });

    // Event Listener für Text-Submit
    submitBtn.addEventListener('click', () => {
      const answer = textAnswerInput.value.trim();
      checkAnswer(answer, 'text');
    });

    // Event Listener für Enter im Textfeld
    textAnswerInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault(); // Verhindert Formular-Absendung, falls vorhanden
        submitBtn.click();
      }
    });

    // Event Listener für Record-Button
    recordBtn.addEventListener('click', () => {
      if (!recognition) {
        alert("Spracherkennung ist nicht initialisiert.");
        return;
      }
      if (isRecording) {
        recognition.stop();
      } else {
        try {
            // Sicherstellen, dass der Audio Context bereit ist, bevor die Aufnahme startet
            unlockAudio().then(() => {
                recognition.start();
            });
        } catch (e) {
            console.error("Fehler beim Starten der Spracherkennung:", e);
            alert("Konnte die Spracherkennung nicht starten.");
        }
      }
    });

    // Event Listener für Tipp-Button
    hintBtn.addEventListener('click', getHint);
}

// Initialisierung starten, wenn das DOM bereit ist
document.addEventListener('DOMContentLoaded', initializeTrainer);
