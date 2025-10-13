let ws;
const chat = document.getElementById('chat');
const txt = document.getElementById('text');
const connectBtn = document.getElementById('connect');
const sendBtn = document.getElementById('send');

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
    // Base64 zu Blob konvertieren
    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    
    // Audio-Element erstellen und abspielen
    const audio = new Audio(url);
    audio.play()
      .then(() => console.log('🔊 Audio playing'))
      .catch(err => console.error('Audio playback error:', err));
    
    // URL nach Abspielen freigeben
    audio.onended = () => URL.revokeObjectURL(url);
  } catch (e) {
    console.error('Failed to play audio:', e);
  }
}

connectBtn.onclick = () => {
  const scenario = document.getElementById('scenario').value;
  const level = document.getElementById('level').value;

  // Alte Verbindung schließen
  if (ws) {
    ws.close();
  }

  // Chat leeren
  chat.innerHTML = '';

  // WebSocket-URL
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}/ws`;
  
  console.log('Connecting to:', wsUrl);
  add('ai', '🔌 Verbinde mit Server...');
  
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('✅ WebSocket connected');
    add('ai', '✅ Verbunden! Initialisiere KI...');
    
    // Session initialisieren
    ws.send(JSON.stringify({
      type: 'client.init',
      scenario: scenario,
      level: level
    }));
    
    // UI anpassen
    connectBtn.disabled = true;
    connectBtn.textContent = 'Verbunden ✓';
    sendBtn.disabled = false;
    txt.disabled = false;
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

      // KI-Antwort mit Audio
      if (msg.type === 'server.response') {
        if (msg.text) {
          add('ai', msg.text);
        }
        
        // Audio abspielen
        if (msg.audio) {
          playAudio(msg.audio);
        }
        return;
      }

      // Fehler
      if (msg.type === 'error') {
        console.error('Error:', msg);
        add('ai', `⚠️ Fehler: ${msg.message || 'Unbekannter Fehler'}`);
        return;
      }

    } catch (e) {
      console.error('Message parse error:', e);
      add('ai', '⚠️ Fehler beim Verarbeiten der Nachricht');
    }
  };

  ws.onerror = (e) => {
    console.error('❌ WebSocket error:', e);
    add('ai', '❌ Verbindungsfehler. Prüfe die Konsole.');
  };

  ws.onclose = (e) => {
    console.warn('🔴 WebSocket closed:', e.code, e.reason);
    add('ai', '🔴 Verbindung geschlossen. Bitte neu verbinden.');
    
    // UI zurücksetzen
    connectBtn.disabled = false;
    connectBtn.textContent = 'Connect';
    sendBtn.disabled = true;
    txt.disabled = true;
  };
};

sendBtn.onclick = () => {
  const val = txt.value.trim();
  
  if (!val) {
    console.warn('No text to send');
    return;
  }
  
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('Connection not ready');
    add('ai', '⚠️ Keine Verbindung! Bitte zuerst "Connect" klicken.');
    return;
  }

  // Nachricht anzeigen
  add('user', val);
  
  // Lade-Indikator hinzufügen
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'bubble ai loading';
  loadingDiv.textContent = '💭 KI denkt nach...';
  loadingDiv.id = 'loading-indicator';
  chat.appendChild(loadingDiv);
  chat.scrollTop = chat.scrollHeight;

  // An Server senden
  ws.send(JSON.stringify({
    type: 'client.text',
    text: val
  }));
  
  // Lade-Indikator nach 500ms entfernen
  setTimeout(() => {
    const loader = document.getElementById('loading-indicator');
    if (loader) loader.remove();
  }, 500);
  
  // Eingabefeld leeren
  txt.value = '';
  txt.focus();
};

// Enter zum Senden
txt.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendBtn.click();
  }
});

// Initial: Buttons deaktiviert
sendBtn.disabled = true;
txt.disabled = true;