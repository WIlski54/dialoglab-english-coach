let ws;
const chat = document.getElementById('chat');
const txt = document.getElementById('text');
const connectBtn = document.getElementById('connect');
const sendBtn = document.getElementById('send');
const voiceBtn = document.getElementById('voice-btn');

// Speech Recognition Setup
let recognition = null;
let isRecording = false;

// Audio Context für iOS - ZENTRAL für alle Audio-Operationen
let audioContext = null;
let audioUnlocked = false;

// Audio Context entsperren mit Test-Sound
async function unlockAudioWithSound() {
  if (audioUnlocked) return true;
  
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Test-Sound erzeugen (sehr kurz und leise)
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = 440;
    gainNode.gain.value = 0.01; // Sehr leise
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.03); // 30ms
    
    // Warten bis Sound abgespielt wurde
    await new Promise(resolve => setTimeout(resolve, 50));
    
    audioUnlocked = true;
    console.log('🔊 Audio fully unlocked with test sound');
    return true;
  } catch (e) {
    console.warn('Audio unlock failed:', e);
    return false;
  }
}

// 🔧 NEUE FUNKTION: Audio über Web Audio API abspielen
async function playAudioViaWebAudioAPI(base64Audio) {
  try {
    if (!audioContext) {
      throw new Error('AudioContext not initialized');
    }

    // Base64 -> Binary -> ArrayBuffer
    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // ArrayBuffer dekodieren
    const audioBuffer = await audioContext.decodeAudioData(bytes.buffer);
    
    // BufferSource erstellen und abspielen
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    source.start(0);
    
    console.log('🔊 Playing audio via Web Audio API');
    
    // Promise zurückgeben für sequentielle Wiedergabe
    return new Promise((resolve) => {
      source.onended = () => {
        console.log('✅ Audio playback finished');
        resolve();
      };
    });
    
  } catch (e) {
    console.error('Web Audio API playback error:', e);
    throw e;
  }
}

// Haupt-Abspielfunktion mit Fallback
async function playAudio(base64Audio, retryCount = 0) {
  try {
    // PRIMÄR: Web Audio API verwenden
    await playAudioViaWebAudioAPI(base64Audio);
    
  } catch (primaryError) {
    console.error('Primary playback failed:', primaryError);
    
    // FALLBACK 1: Retry einmal
    if (retryCount < 1) {
      console.log('🔄 Retrying with Web Audio API...');
      await new Promise(resolve => setTimeout(resolve, 300));
      return playAudio(base64Audio, retryCount + 1);
    }
    
    // FALLBACK 2: Klassisches Audio-Element als letzte Option
    console.log('⚠️ Falling back to Audio element');
    try {
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      
      const audio = new Audio(url);
      audio.load();
      
      await audio.play();
      console.log('🔊 Fallback: Audio element succeeded');
      
      audio.onended = () => URL.revokeObjectURL(url);
      
    } catch (fallbackError) {
      console.error('Fallback also failed:', fallbackError);
      // FALLBACK 3: Manueller Button
      showManualPlayButton(base64Audio);
    }
  }
}

// Manueller Play-Button als letzter Fallback
function showManualPlayButton(base64Audio) {
  const existing = document.getElementById('manual-play-btn');
  if (existing) existing.remove();
  
  const playBtn = document.createElement('button');
  playBtn.id = 'manual-play-btn';
  playBtn.textContent = '🔊 Tap to Play Audio';
  playBtn.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    color: white;
    border: none;
    padding: 16px 24px;
    border-radius: 30px;
    font-size: 16px;
    font-weight: bold;
    cursor: pointer;
    z-index: 1000;
    box-shadow: 0 6px 20px rgba(0,0,0,0.3);
    animation: pulse 1.5s infinite;
  `;
  
  playBtn.onclick = async () => {
    try {
      await playAudioViaWebAudioAPI(base64Audio);
      playBtn.remove();
    } catch (e) {
      console.error('Manual play failed:', e);
      add('ai', '⚠️ Audio playback not supported on this device');
      playBtn.remove();
    }
  };
  
  document.body.appendChild(playBtn);
  
  // Auto-remove nach 15 Sekunden
  setTimeout(() => {
    if (playBtn.parentNode) playBtn.remove();
  }, 15000);
}

function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  
  if (!SpeechRecognition) {
    console.warn('Speech Recognition not supported');
    if (voiceBtn) voiceBtn.style.display = 'none';
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    isRecording = true;
    voiceBtn.classList.add('recording');
    voiceBtn.innerHTML = '🔴 Listening...';
    txt.placeholder = 'Speak now...';
  };

  recognition.onresult = (event) => {
    const transcript = Array.from(event.results)
      .map(result => result[0].transcript)
      .join('');
    
    txt.value = transcript;
    
    if (event.results[0].isFinal) {
      console.log('Final transcript:', transcript);
    }
  };

  recognition.onend = () => {
    isRecording = false;
    voiceBtn.classList.remove('recording');
    voiceBtn.innerHTML = '🎤 Speak';
    txt.placeholder = 'Or type your answer...';
    
    if (txt.value.trim()) {
      setTimeout(() => sendBtn.click(), 500);
    }
  };

  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    isRecording = false;
    voiceBtn.classList.remove('recording');
    voiceBtn.innerHTML = '🎤 Speak';
    
    if (event.error === 'no-speech') {
      add('ai', '🎤 I didn\'t hear anything. Try again!');
    }
  };
}

function add(role, text) {
  const div = document.createElement('div');
  div.className = 'bubble ' + (role === 'user' ? 'me' : 'ai');
  div.textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

// Voice Button
if (voiceBtn) {
  voiceBtn.onclick = () => {
    if (!recognition) {
      add('ai', '⚠️ Voice input not supported on this device.');
      return;
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      add('ai', '⚠️ Please connect first!');
      return;
    }

    if (isRecording) {
      recognition.stop();
    } else {
      txt.value = '';
      try {
        recognition.start();
      } catch (e) {
        console.error('Recognition start error:', e);
      }
    }
  };
}

connectBtn.onclick = async () => {
  // Disconnect-Funktion
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
    chat.innerHTML = '';
    add('ai', '👋 Disconnected. Click Connect to start a new conversation.');
    
    connectBtn.disabled = false;
    connectBtn.textContent = '🚀 Connect';
    connectBtn.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
    sendBtn.disabled = true;
    txt.disabled = true;
    txt.value = '';
    
    if (voiceBtn) {
      voiceBtn.disabled = true;
      voiceBtn.style.display = 'none';
    }
    
    return;
  }

  // Connect-Funktion
  const scenario = document.getElementById('scenario').value;
  const level = document.getElementById('level').value;

  if (ws) {
    ws.close();
  }

  chat.innerHTML = '';
  
  add('ai', '🔌 Connecting to server...');
  
  // Audio mit Test-Sound entsperren (iOS-kritisch!)
  add('ai', '🔊 Initializing audio system... (you may hear a brief tone)');
  const audioReady = await unlockAudioWithSound();
  
  if (audioReady) {
    add('ai', '✅ Audio system ready! Using Web Audio API for reliable playback.');
  } else {
    add('ai', '⚠️ Audio might need manual activation on this device.');
  }

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}/ws`;
  
  console.log('Connecting to:', wsUrl);
  
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('✅ WebSocket connected');
    
    add('ai', '✅ Connected! Starting conversation with AI voice coach...');
    
    ws.send(JSON.stringify({
      type: 'client.init',
      scenario: scenario,
      level: level
    }));
    
    connectBtn.disabled = false;
    connectBtn.textContent = '🔴 Disconnect';
    connectBtn.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
    sendBtn.disabled = false;
    txt.disabled = false;
    
    if (voiceBtn) {
      voiceBtn.disabled = false;
      voiceBtn.style.display = 'block';
    }
    
    initSpeechRecognition();
    
    txt.focus();
  };

  ws.onmessage = async (ev) => {
    try {
      let payload;
      
      if (typeof ev.data === 'string') {
        payload = ev.data;
      } else if (ev.data instanceof Blob) {
        payload = await ev.data.text();
      } else {
        payload = String(ev.data);
      }

      const msg = JSON.parse(payload);
      console.log('📨 Received:', msg.type);

      if (msg.type === 'server.response') {
        const loader = document.getElementById('loading-indicator');
        if (loader) loader.remove();
        
        if (msg.text) {
          add('ai', msg.text);
        }
        
        // Audio über Web Audio API abspielen
        if (msg.audio) {
          await playAudio(msg.audio);
        }
        return;
      }

      if (msg.type === 'error') {
        console.error('Error:', msg);
        const loader = document.getElementById('loading-indicator');
        if (loader) loader.remove();
        add('ai', `⚠️ Error: ${msg.message || 'Unknown error'}`);
        return;
      }

    } catch (e) {
      console.error('Message parse error:', e);
      add('ai', '⚠️ Failed to process message');
    }
  };

  ws.onerror = (e) => {
    console.error('❌ WebSocket error:', e);
    add('ai', '❌ Connection error');
  };

  ws.onclose = (e) => {
    console.warn('🔴 WebSocket closed:', e.code, e.reason);
    
    if (chat.children.length > 0) {
      add('ai', '🔴 Connection closed. Click Connect to reconnect.');
    }
    
    connectBtn.disabled = false;
    connectBtn.textContent = '🚀 Connect';
    connectBtn.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
    sendBtn.disabled = true;
    txt.disabled = true;
    
    if (voiceBtn) {
      voiceBtn.disabled = true;
      voiceBtn.style.display = 'none';
    }
  };
};

sendBtn.onclick = () => {
  const val = txt.value.trim();
  
  if (!val) {
    return;
  }
  
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    add('ai', '⚠️ Not connected! Please click "Connect" first.');
    return;
  }

  add('user', val);
  
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'bubble ai loading';
  loadingDiv.textContent = '💭 AI is thinking...';
  loadingDiv.id = 'loading-indicator';
  chat.appendChild(loadingDiv);
  chat.scrollTop = chat.scrollHeight;

  ws.send(JSON.stringify({
    type: 'client.text',
    text: val
  }));
  
  txt.value = '';
  txt.focus();
};

txt.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendBtn.click();
  }
});

// Initial: Buttons deaktiviert
sendBtn.disabled = true;
txt.disabled = true;
if (voiceBtn) {
  voiceBtn.disabled = true;
  voiceBtn.style.display = 'none';
}

// Szenario-Bild dynamisch wechseln
const scenarioSelect = document.getElementById('scenario');
const scenarioImg = document.getElementById('scenario-img');

if (scenarioSelect && scenarioImg) {
  scenarioSelect.addEventListener('change', (e) => {
    const scenario = e.target.value;
    scenarioImg.src = `/${scenario}.png`;
    scenarioImg.alt = scenarioSelect.options[scenarioSelect.selectedIndex].text;
    console.log('Scenario changed to:', scenario);
  });
}
