const ws = new WebSocket(`${location.origin.replace('http','ws')}/ws-teacher`);
const rows = new Map();

ws.onopen = () => {
  console.log('✅ Teacher Dashboard connected');
};

ws.onmessage = (ev) => {
  try {
    const data = JSON.parse(ev.data);
    console.log('📊 Received data:', data);
    
    // Wenn es ein Array ist (initiale Snapshot)
    if (Array.isArray(data)) {
      data.forEach(s => upsert(s.id, s));
      return;
    }
    
    // Wenn es ein einzelnes Session-Update ist
    if (data.id) {
      upsert(data.id, data);
      return;
    }
    
    // Session entfernen
    if (data.type === 'session.remove' && data.id) {
      remove(data.id);
      return;
    }
    
  } catch (e) {
    console.error('Failed to parse teacher message:', e);
  }
};

ws.onerror = (e) => {
  console.error('❌ Teacher WebSocket error:', e);
};

ws.onclose = () => {
  console.warn('🔴 Teacher Dashboard disconnected');
};

function upsert(id, s) {
  const tbody = document.querySelector('#t tbody');
  
  // WICHTIG: Platzhalter entfernen, sobald erste Session kommt!
  const placeholder = tbody.querySelector('.empty-state');
  if (placeholder) {
    placeholder.closest('tr').remove();
  }
  
  let tr = rows.get(id);
  if (!tr) {
    tr = document.createElement('tr');
    rows.set(id, tr);
    tbody.appendChild(tr);
  }
  
  // Daten mit Fallbacks
  const scenario = s.scenario || '';
  const level = s.level || '';
  const lastText = (s.lastText || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  
  // vocaHit (nicht hits!) vom Server
  const vocabHits = (s.vocaHit || []).join(', ');
  const errors = (s.errs || []).join(', ');
  
  tr.innerHTML = `
    <td>${id.slice(0,8)}...</td>
    <td><strong>${scenario}</strong></td>
    <td><span style="background: #667eea; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px;">${level}</span></td>
    <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis;">${lastText || '<em>Noch keine Nachricht</em>'}</td>
    <td class="hit">${vocabHits || '-'}</td>
    <td class="err">${errors || '-'}</td>
  `;
}

function remove(id) {
  const tr = rows.get(id);
  if (tr) tr.remove();
  rows.delete(id);
  
  // Platzhalter wieder anzeigen, wenn keine Sessions mehr da sind
  const tbody = document.querySelector('#t tbody');
  if (tbody.children.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">
          <div class="empty-state-icon">📊</div>
          <div><strong>Keine aktiven Sessions</strong></div>
          <div style="font-size: 13px; margin-top: 8px;">Schüler müssen sich zuerst verbinden</div>
        </td>
      </tr>
    `;
  }
}