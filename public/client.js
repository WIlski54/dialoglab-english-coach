let ws;
const chat = document.getElementById('chat');
const txt = document.getElementById('text');
const connectBtn = document.getElementById('connect');
const sendBtn = document.getElementById('send');
const voiceBtn = document.getElementById('voice-btn');

// Speech Recognition Setup
let recognition = null;
let isRecording = false;

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
    
    // Wenn finales Ergebnis
    if (event.results[0].isFinal) {
      console.log('Final transcript:', transcript);
    }
  };

  recognition.onend = () => {
    isRecording = false;
    voiceBtn.classList.remove('recording');
    voiceBtn.innerHTML = '🎤 Speak';
    txt.placeholder = 'Or type your answer...';
    
    // Automatisch senden wenn Text vorhanden
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

// Audio abspielen aus Base64
function playAudio(base64Audio) {
  try {
    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    
    const audio = new Audio(url);
    audio.play()
      .then(() => console.log('🔊 Playing OpenAI TTS audio'))
      .catch(err => console.error('Audio playback error:', err));
    
    audio.onended = () => URL.revokeObjectURL(url);
  } catch (e) {
    console.error('Failed to play audio:', e);
  }
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

connectBtn.onclick = () => {
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

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}/ws`;
  
  console.log('Connecting to:', wsUrl);
  add('ai', '🔌 Connecting to server...');
  
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('✅ WebSocket connected');
    add('ai', '✅ Connected! Initializing AI with high-quality voice...');
    
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
    
    // Speech Recognition initialisieren
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
        
        // OpenAI TTS Audio abspielen
        if (msg.audio) {
          playAudio(msg.audio);
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
