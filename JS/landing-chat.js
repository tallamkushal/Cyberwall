(function () {
  const SERVER = window.location.hostname === 'localhost' ? 'http://localhost:3001' : 'https://cyberwall.onrender.com';
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
      color: white; border: none; cursor: pointer;
      box-shadow: 0 4px 20px rgba(26,71,232,0.4);
      display: flex; align-items: center; justify-content: center;
      font-size: 22px; transition: all 0.25s;
    }
    #cw-chat-btn:hover { transform: scale(1.1); box-shadow: 0 8px 28px rgba(26,71,232,0.5); }
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
      position: fixed; bottom: 152px; right: 24px; z-index: 9998;
      background: white; border-radius: 16px 16px 4px 16px;
      padding: 10px 14px; font-size: 13.5px; font-family: 'DM Sans', sans-serif;
      color: #111827; line-height: 1.5;
      box-shadow: 0 4px 20px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.06);
      border: 1px solid rgba(26,71,232,0.1);
      max-width: 220px;
      animation: cw-greet-in 0.4s cubic-bezier(0.34,1.56,0.64,1) both;
      cursor: pointer;
    }
    #cw-greeting::after {
      content: ''; position: absolute; bottom: -8px; right: 18px;
      width: 0; height: 0;
      border-left: 8px solid transparent;
      border-right: 0px solid transparent;
      border-top: 8px solid white;
    }
    @keyframes cw-greet-in { from { opacity:0; transform:translateY(10px) scale(0.9); } to { opacity:1; transform:translateY(0) scale(1); } }

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
        right: 16px; bottom: 144px;
        max-width: calc(100vw - 32px);
      }
    }
  `;
  document.head.appendChild(style);

  // ── HTML ────────────────────────────────────────────────────────────────
  const btn = document.createElement('button');
  btn.id = 'cw-chat-btn';
  btn.innerHTML = '🛡<span class="cw-notif"></span>';
  btn.title = 'Chat with Wally — CyberWall AI';
  document.body.appendChild(btn);

  const panel = document.createElement('div');
  panel.id = 'cw-chat-panel';
  panel.innerHTML = `
    <div class="cw-header">
      <div class="cw-avatar">🛡</div>
      <div class="cw-header-info">
        <div class="cw-header-name">Wally — CyberWall AI</div>
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

  // ── LOGIC ────────────────────────────────────────────────────────────────
  const msgContainer = document.getElementById('cw-messages');
  const input = document.getElementById('cw-input');
  const sendBtn = document.getElementById('cw-send');
  const suggestions = document.getElementById('cw-suggestions');

  function openPanel() {
    if (isOpen) return;
    isOpen = true;
    panel.classList.add('open');
    btn.querySelector('.cw-notif')?.remove();
    if (messages.length === 0) {
      setTimeout(() => addBotMessage("Hi there! 👋 I'm Wally, CyberWall's AI assistant. Ask me anything — pricing, how it works, what attacks we block. I'm here to help!"), 400);
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
    wrap.innerHTML = `<div class="cw-bubble user">${text}</div>`;
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
    isTyping = true;
    sendBtn.disabled = true;
    suggestions.style.display = 'none';

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
            if (data.done) { messages.push({ role: 'assistant', content: fullText }); }
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
  greeting.textContent = 'Hi! I\'m Wally, your CyberWall AI assistant 👋';
  document.body.appendChild(greeting);
  greeting.addEventListener('click', () => { greeting.remove(); togglePanel(); });
  setTimeout(() => greeting.remove(), 6000);

  // Events
  btn.addEventListener('click', togglePanel);
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
