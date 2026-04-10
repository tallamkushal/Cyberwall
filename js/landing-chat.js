(function () {
  const SERVER = window.location.hostname === 'localhost' ? 'http://localhost:3001' : '';
  let messages = [];
  let isOpen = false;
  let isTyping = false;

  // ── STYLES ──────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #cw-chat-btn {
      position: fixed; bottom: 88px; right: 24px; z-index: 9999;
      width: 52px; height: 52px; border-radius: 50%;
      background: linear-gradient(135deg, #1a47e8, #7c3aed);
      color: white; border: none; cursor: grab;
      box-shadow: 0 4px 20px rgba(26,71,232,0.4);
      display: flex; align-items: center; justify-content: center;
      font-size: 22px; transition: transform 0.25s, box-shadow 0.25s;
      touch-action: none; user-select: none;
    }
    #cw-chat-btn:hover { transform: scale(1.1); box-shadow: 0 8px 28px rgba(26,71,232,0.5); }
    #cw-chat-btn.cw-dragging,
    #cw-chat-btn.cw-dragging:hover { cursor: grabbing; transform: scale(1.08); transition: none; }
    #cw-chat-btn .cw-notif {
      position: absolute; top: -3px; right: -3px;
      width: 14px; height: 14px; border-radius: 50%;
      background: #ef4444; border: 2px solid white;
      animation: cw-pulse 2s ease-in-out infinite;
    }
    @keyframes cw-pulse { 0%,100%{transform:scale(1);} 50%{transform:scale(1.2);} }

    #cw-chat-panel {
      position: fixed; bottom: 152px; right: 24px; z-index: 9999;
      width: 360px; max-height: 520px;
      background: white; border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.15), 0 4px 16px rgba(0,0,0,0.08);
      display: flex; flex-direction: column; overflow: hidden;
      transform: scale(0.9) translateY(16px); opacity: 0;
      transition: all 0.25s cubic-bezier(0.34,1.56,0.64,1);
      pointer-events: none;
      border: 1px solid rgba(26,71,232,0.1);
    }
    #cw-chat-panel.open {
      transform: scale(1) translateY(0); opacity: 1; pointer-events: all;
    }

    .cw-header {
      background: linear-gradient(135deg, #1a47e8, #7c3aed);
      padding: 16px 18px; display: flex; align-items: center; gap: 12px;
    }
    .cw-avatar {
      width: 38px; height: 38px; border-radius: 50%;
      background: rgba(255,255,255,0.2);
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; flex-shrink: 0;
    }
    .cw-header-info { flex: 1; }
    .cw-header-name { font-size: 14px; font-weight: 700; color: white; font-family: 'DM Sans', sans-serif; }
    .cw-header-status { font-size: 12px; color: rgba(255,255,255,0.7); display: flex; align-items: center; gap: 5px; }
    .cw-status-dot { width: 6px; height: 6px; border-radius: 50%; background: #4ade80; }
    .cw-close {
      background: rgba(255,255,255,0.15); border: none; color: white;
      width: 28px; height: 28px; border-radius: 8px; cursor: pointer;
      font-size: 14px; display: flex; align-items: center; justify-content: center;
      transition: background 0.2s;
    }
    .cw-close:hover { background: rgba(255,255,255,0.25); }

    .cw-messages {
      flex: 1; overflow-y: auto; padding: 16px; display: flex;
      flex-direction: column; gap: 12px; min-height: 0;
      scrollbar-width: thin; scrollbar-color: #e5e7eb transparent;
    }

    .cw-bubble-wrap { display: flex; align-items: flex-end; gap: 8px; }
    .cw-bubble-wrap.user { flex-direction: row-reverse; }

    .cw-bubble-avatar {
      width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
      background: linear-gradient(135deg, #1a47e8, #7c3aed);
      display: flex; align-items: center; justify-content: center; font-size: 12px;
    }

    .cw-bubble {
      max-width: 78%; padding: 10px 14px; border-radius: 16px;
      font-size: 13.5px; line-height: 1.6; font-family: 'DM Sans', sans-serif;
    }
    .cw-bubble.bot {
      background: #f3f4f6; color: #111827; border-bottom-left-radius: 4px;
    }
    .cw-bubble.user {
      background: linear-gradient(135deg, #1a47e8, #7c3aed);
      color: white; border-bottom-right-radius: 4px;
    }

    .cw-typing {
      display: flex; align-items: center; gap: 4px; padding: 12px 14px;
      background: #f3f4f6; border-radius: 16px; border-bottom-left-radius: 4px;
      width: fit-content;
    }
    .cw-typing span {
      width: 6px; height: 6px; border-radius: 50%; background: #9ca3af;
      animation: cw-bounce 1.2s ease-in-out infinite;
    }
    .cw-typing span:nth-child(2) { animation-delay: 0.2s; }
    .cw-typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes cw-bounce { 0%,60%,100%{transform:translateY(0);} 30%{transform:translateY(-5px);} }

    #cw-greeting {
      position: fixed; z-index: 9998;
      background: white; border-radius: 12px;
      padding: 10px 14px; font-size: 13px; font-family: 'DM Sans', sans-serif;
      color: #111827; line-height: 1.5; font-weight: 600;
      box-shadow: 0 4px 20px rgba(0,0,0,0.13), 0 1px 4px rgba(0,0,0,0.06);
      border: 1px solid rgba(26,71,232,0.12);
      white-space: nowrap;
      transform-origin: bottom center;
      animation: cw-greet-in 0.35s cubic-bezier(0.34,1.56,0.64,1) both;
      cursor: pointer;
    }
    #cw-greeting::after {
      content: ''; position: absolute; bottom: -7px; left: 50%; transform: translateX(-50%);
      width: 0; height: 0;
      border-left: 7px solid transparent;
      border-right: 7px solid transparent;
      border-top: 7px solid white;
      filter: drop-shadow(0 2px 1px rgba(0,0,0,0.06));
    }
    @keyframes cw-greet-in { from { opacity:0; transform:scale(0.7) translateY(8px); } to { opacity:1; transform:scale(1) translateY(0); } }

    .cw-suggestions {
      padding: 0 14px 12px; display: flex; flex-wrap: wrap; gap: 6px;
    }
    .cw-chip {
      background: #f0f4ff; border: 1px solid #c7d7fb; color: #1a47e8;
      border-radius: 20px; padding: 5px 12px; font-size: 12px; font-weight: 500;
      cursor: pointer; transition: all 0.15s; font-family: 'DM Sans', sans-serif;
      white-space: nowrap;
    }
    .cw-chip:hover { background: #1a47e8; color: white; border-color: #1a47e8; }

    .cw-input-row {
      padding: 12px 14px; border-top: 1px solid #f3f4f6;
      display: flex; gap: 8px; align-items: center;
    }
    .cw-input {
      flex: 1; border: 1px solid #e5e7eb; border-radius: 10px;
      padding: 9px 13px; font-size: 13.5px; font-family: 'DM Sans', sans-serif;
      outline: none; transition: border-color 0.2s; resize: none; max-height: 80px;
      line-height: 1.5;
    }
    .cw-input:focus { border-color: #1a47e8; }
    .cw-send {
      width: 36px; height: 36px; border-radius: 10px; flex-shrink: 0;
      background: linear-gradient(135deg, #1a47e8, #7c3aed);
      border: none; color: white; cursor: pointer; font-size: 15px;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.2s;
    }
    .cw-send:hover { transform: scale(1.05); }
    .cw-send:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

    @media (max-width: 480px) {
      #cw-chat-panel {
        width: 100vw; right: 0; left: 0; bottom: 0;
        max-height: 75vh; border-radius: 20px 20px 0 0;
        transform: translateY(100%);
      }
      #cw-chat-panel.open {
        transform: translateY(0);
      }
      #cw-chat-btn {
        bottom: 80px; right: 16px;
      }
      #cw-greeting {
        /* positionGreeting() handles exact placement on mobile too */
      }
    }
  `;
  document.head.appendChild(style);

  // ── HTML ────────────────────────────────────────────────────────────────
  const btn = document.createElement('button');
  btn.id = 'cw-chat-btn';
  btn.innerHTML = '🛡<span class="cw-notif"></span>';
  btn.title = 'Chat with Wally — ProCyberWall AI';
  document.body.appendChild(btn);

  const panel = document.createElement('div');
  panel.id = 'cw-chat-panel';
  panel.innerHTML = `
    <div class="cw-header">
      <div class="cw-avatar">🛡</div>
      <div class="cw-header-info">
        <div class="cw-header-name">Wally — ProCyberWall AI</div>
        <div class="cw-header-status"><span class="cw-status-dot"></span> Online · replies instantly</div>
      </div>
      <button class="cw-close" id="cw-close-btn">✕</button>
    </div>
    <div class="cw-messages" id="cw-messages"></div>
    <div class="cw-suggestions" id="cw-suggestions">
      <span class="cw-chip">How does it work?</span>
      <span class="cw-chip">How much does it cost?</span>
      <span class="cw-chip">Do I need tech skills?</span>
      <span class="cw-chip">What attacks do you block?</span>
    </div>
    <div class="cw-input-row">
      <textarea class="cw-input" id="cw-input" rows="1" placeholder="Ask me anything..."></textarea>
      <button class="cw-send" id="cw-send">➤</button>
    </div>
  `;
  document.body.appendChild(panel);

  btn.title = 'Chat with Wally · Drag to reposition';

  // ── DRAG & REPOSITION ──────────────────────────────────────────────────────
  let hasDragged = false;
  let dragState  = null;

  function applyBtnPos(left, top) {
    const bw = btn.offsetWidth  || 52;
    const bh = btn.offsetHeight || 52;
    left = Math.max(8, Math.min(left, window.innerWidth  - bw - 8));
    top  = Math.max(8, Math.min(top,  window.innerHeight - bh - 8));
    btn.style.left   = left + 'px';
    btn.style.top    = top  + 'px';
    btn.style.right  = 'auto';
    btn.style.bottom = 'auto';
  }

  function repositionPanel() {
    if (window.innerWidth <= 480) {
      // Let CSS media query handle the mobile full-screen layout
      panel.style.left = panel.style.top = panel.style.right = panel.style.bottom = '';
      return;
    }
    const r  = btn.getBoundingClientRect();
    const pw = 360, ph = 520, gap = 12;
    const vw = window.innerWidth, vh = window.innerHeight;

    // Horizontal: prefer left of button → right → centred
    let left = r.left - pw - gap;
    if (left < 8) left = r.right + gap;
    if (left + pw > vw - 8) left = r.left + r.width / 2 - pw / 2;
    left = Math.max(8, Math.min(left, vw - pw - 8));

    // Vertical: prefer above → below
    let top = r.top - ph - gap;
    if (top < 8) top = r.bottom + gap;
    top = Math.max(8, Math.min(top, vh - ph - 8));

    panel.style.left   = left + 'px';
    panel.style.top    = top  + 'px';
    panel.style.right  = 'auto';
    panel.style.bottom = 'auto';
  }

  function positionGreeting(el) {
    const r   = btn.getBoundingClientRect();
    const ew  = el.offsetWidth  || 160;
    const eh  = el.offsetHeight || 40;
    // Center bubble horizontally over the button, sit just above it
    const left = Math.max(8, Math.min(r.left + r.width / 2 - ew / 2, window.innerWidth - ew - 8));
    const top  = Math.max(8, r.top - eh - 12);
    el.style.left   = left + 'px';
    el.style.top    = top  + 'px';
    el.style.right  = 'auto';
    el.style.bottom = 'auto';
  }

  // Restore saved position on load
  const savedPos = JSON.parse(localStorage.getItem('cw-wally-pos') || 'null');
  if (savedPos) applyBtnPos(savedPos.left, savedPos.top);

  // Re-clamp button on viewport resize
  window.addEventListener('resize', () => {
    if (btn.style.left) applyBtnPos(parseFloat(btn.style.left), parseFloat(btn.style.top));
    if (isOpen) repositionPanel();
  });

  let isDragging = false;

  function onDragMove(e) {
    if (!isDragging || !dragState) return;
    if (e.cancelable) e.preventDefault();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const dx = clientX - dragState.startX;
    const dy = clientY - dragState.startY;
    if (!hasDragged && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
    hasDragged = true;
    btn.classList.add('cw-dragging');
    applyBtnPos(dragState.btnX + dx, dragState.btnY + dy);
    if (isOpen) repositionPanel();
  }

  function onDragEnd() {
    if (!isDragging) return;
    isDragging = false;
    btn.classList.remove('cw-dragging');
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup',   onDragEnd);
    document.removeEventListener('touchmove', onDragMove);
    document.removeEventListener('touchend',  onDragEnd);
    if (hasDragged) {
      localStorage.setItem('cw-wally-pos', JSON.stringify({
        left: parseFloat(btn.style.left),
        top:  parseFloat(btn.style.top),
      }));
      repositionPanel();
    }
    dragState = null;
  }

  function onDragStart(e) {
    if (e.button != null && e.button !== 0) return; // left mouse button only
    hasDragged = false;
    isDragging = true;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const r = btn.getBoundingClientRect();
    dragState = { startX: clientX, startY: clientY, btnX: r.left, btnY: r.top };
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup',   onDragEnd);
    document.addEventListener('touchmove', onDragMove, { passive: false });
    document.addEventListener('touchend',  onDragEnd);
  }

  btn.addEventListener('mousedown',  onDragStart);
  btn.addEventListener('touchstart', onDragStart, { passive: true });

  // ── LOGIC ────────────────────────────────────────────────────────────────
  const msgContainer = document.getElementById('cw-messages');
  const input = document.getElementById('cw-input');
  const sendBtn = document.getElementById('cw-send');
  const suggestions = document.getElementById('cw-suggestions');

  const MSG_LIMIT = 5;
  let userMsgCount = parseInt(sessionStorage.getItem('cw-msg-count') || '0', 10);

  function showWhatsAppCTA() {
    const row = document.querySelector('.cw-input-row');
    if (!row || row.dataset.cta) return;
    row.dataset.cta = '1';
    row.innerHTML = `
      <div style="width:100%;text-align:center;padding:4px 0 2px">
        <div style="font-size:12px;color:#6b7280;margin-bottom:8px">Want to keep chatting? Continue on WhatsApp 👇</div>
        <a href="https://wa.me/919844482193?text=Hi%20ProCyberWall!%20I%20have%20some%20questions." target="_blank"
          style="display:flex;align-items:center;justify-content:center;gap:8px;background:#25d366;color:white;font-weight:700;
          font-size:13.5px;padding:10px 18px;border-radius:12px;text-decoration:none;font-family:'DM Sans',sans-serif;
          transition:background 0.2s;width:100%"
          onmouseover="this.style.background='#1ebe5d'" onmouseout="this.style.background='#25d366'">
          <span style="font-size:18px">💬</span> Chat with us on WhatsApp
        </a>
        <div style="font-size:11px;color:#9ca3af;margin-top:6px">We typically reply within a few minutes</div>
      </div>`;
  }

  function openPanel() {
    if (isOpen) return;
    isOpen = true;
    repositionPanel();
    panel.classList.add('open');
    btn.querySelector('.cw-notif')?.remove();
    if (messages.length === 0) {
      setTimeout(() => {
        addBotMessage("Hi there! 👋 I'm Wally, ProCyberWall's AI assistant. Ask me anything — pricing, how it works, what attacks we block. I'm here to help!");
        if (userMsgCount >= MSG_LIMIT) setTimeout(showWhatsAppCTA, 600);
      }, 400);
    } else if (userMsgCount >= MSG_LIMIT) {
      setTimeout(showWhatsAppCTA, 200);
    }
    input.focus();
  }

  function togglePanel() {
    if (isOpen) {
      isOpen = false;
      panel.classList.remove('open');
    } else {
      openPanel();
    }
  }

  function addBotMessage(text) {
    const wrap = document.createElement('div');
    wrap.className = 'cw-bubble-wrap';
    wrap.innerHTML = `<div class="cw-bubble-avatar">🛡</div><div class="cw-bubble bot">${text}</div>`;
    msgContainer.appendChild(wrap);
    msgContainer.scrollTop = msgContainer.scrollHeight;
    return wrap.querySelector('.cw-bubble');
  }

  function addUserMessage(text) {
    const wrap = document.createElement('div');
    wrap.className = 'cw-bubble-wrap user';
    const bubble = document.createElement('div');
    bubble.className = 'cw-bubble user';
    bubble.textContent = text;
    wrap.appendChild(bubble);
    msgContainer.appendChild(wrap);
    msgContainer.scrollTop = msgContainer.scrollHeight;
  }

  function showTyping() {
    const wrap = document.createElement('div');
    wrap.className = 'cw-bubble-wrap';
    wrap.id = 'cw-typing-wrap';
    wrap.innerHTML = `<div class="cw-bubble-avatar">🛡</div><div class="cw-typing"><span></span><span></span><span></span></div>`;
    msgContainer.appendChild(wrap);
    msgContainer.scrollTop = msgContainer.scrollHeight;
  }

  function removeTyping() {
    document.getElementById('cw-typing-wrap')?.remove();
  }

  async function sendMessage(text) {
    if (!text.trim() || isTyping) return;

    // Enforce session message limit
    if (userMsgCount >= MSG_LIMIT) {
      showWhatsAppCTA();
      return;
    }

    isTyping = true;
    sendBtn.disabled = true;
    suggestions.style.display = 'none';

    userMsgCount++;
    sessionStorage.setItem('cw-msg-count', userMsgCount);

    addUserMessage(text);
    messages.push({ role: 'user', content: text });
    input.value = '';
    input.style.height = 'auto';

    showTyping();

    try {
      const res = await fetch(`${SERVER}/api/ai-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, domain: '', plan: 'visitor' })
      });

      removeTyping();
      const bubble = addBotMessage('');
      let fullText = '';

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.text) { fullText += data.text; bubble.textContent = fullText; msgContainer.scrollTop = msgContainer.scrollHeight; }
            if (data.done) {
              messages.push({ role: 'assistant', content: fullText });
              if (userMsgCount >= MSG_LIMIT) {
                setTimeout(() => {
                  addBotMessage("That's all I can share here — but I'd love to keep helping! 😊 Tap below to continue on WhatsApp.");
                  showWhatsAppCTA();
                }, 500);
              }
            }
          } catch {}
        }
      }
    } catch {
      removeTyping();
      addBotMessage('Sorry, I had trouble connecting. Please try again in a moment.');
    }

    isTyping = false;
    sendBtn.disabled = false;
  }

  // Greeting bubble on page load
  const greeting = document.createElement('div');
  greeting.id = 'cw-greeting';
  greeting.textContent = 'Hey, I\'m Wally AI 👋';
  document.body.appendChild(greeting);
  // Two rAF frames so the element is rendered and measurable before positioning
  requestAnimationFrame(() => requestAnimationFrame(() => positionGreeting(greeting)));
  greeting.addEventListener('click', () => { greeting.remove(); togglePanel(); });
  setTimeout(() => greeting.remove(), 5000);

  // Events
  btn.addEventListener('click', () => { if (hasDragged) { hasDragged = false; return; } togglePanel(); });
  document.getElementById('cw-close-btn').addEventListener('click', togglePanel);

  sendBtn.addEventListener('click', () => sendMessage(input.value));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input.value); }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 80) + 'px';
  });

  suggestions.querySelectorAll('.cw-chip').forEach(chip => {
    chip.addEventListener('click', () => sendMessage(chip.textContent));
  });
})();
