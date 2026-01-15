import type { Express } from 'express';

export function registerOverlayRoutes(app: Express) {
  app.get('/overlay/credits/t/:token', (req, res) => {
    const token = String(req.params?.token || '').trim();
    if (!token) return res.status(400).send('Bad Request');

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    const nonce = typeof res.locals?.cspNonce === 'string' ? res.locals.cspNonce : '';
    const nonceAttr = nonce ? ` nonce="${nonce}"` : '';

    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Credits Overlay</title>
    <style${nonceAttr}>
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #fff; }
      .wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
      .panel {
        max-width: 92vw;
        max-height: 92vh;
        padding: 20px 24px;
        background: rgba(0,0,0,0.18);
        border-radius: 20px;
        backdrop-filter: blur(6px);
        box-shadow: 0 0 90px rgba(0,0,0,0.6);
        overflow: hidden;
      }
      .title { font-weight: 800; font-size: 26px; margin: 0 0 12px 0; opacity: 0.95; }
      .list { display: flex; flex-direction: column; gap: 8px; font-weight: 800; font-size: 26px; }
      .section { margin-top: 12px; }
      .section h3 { margin: 0 0 8px 0; font-size: 18px; opacity: 0.8; font-weight: 700; }
      .muted { opacity: 0.7; font-size: 14px; font-weight: 600; }
      .item { display: flex; align-items: center; gap: 10px; }
      .num { min-width: 2.2em; opacity: 0.9; }
      .avatar { width: 28px; height: 28px; border-radius: 999px; object-fit: cover; flex: 0 0 auto; }
      .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .is-hidden { display: none; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="panel" id="panel">
        <div class="title" id="title">Credits</div>
        <div class="muted" id="status">Connecting...</div>
        <div class="section is-hidden" id="donorsSection">
          <h3 id="donorsTitle">Donors</h3>
          <div class="list" id="donors"></div>
        </div>
        <div class="section is-hidden" id="chattersSection">
          <h3 id="chattersTitle">Chatters</h3>
          <div class="list" id="chatters"></div>
        </div>
      </div>
    </div>
    <script${nonceAttr} src="/socket.io/socket.io.js"></script>
    <script${nonceAttr}>
      const TOKEN = ${JSON.stringify(token)};

      const statusEl = document.getElementById('status');
      const donorsSection = document.getElementById('donorsSection');
      const chattersSection = document.getElementById('chattersSection');
      const donorsEl = document.getElementById('donors');
      const chattersEl = document.getElementById('chatters');
      const titleEl = document.getElementById('title');
      const donorsTitleEl = document.getElementById('donorsTitle');
      const chattersTitleEl = document.getElementById('chattersTitle');

      let cfg = { creditsStyleJson: null };
      let renderCfg = {
        titleText: 'Credits',
        donorsTitleText: 'Donors',
        chattersTitleText: 'Chatters',
        showNumbers: false,
        showAvatars: false,
        avatarSize: 28,
        avatarRadius: 999,
      };

      function safeParseJson(s) {
        try { return JSON.parse(s); } catch { return null; }
      }

      function applyStyle(styleJson) {
        if (!styleJson) return;
        const obj = safeParseJson(styleJson);
        if (!obj || typeof obj !== 'object') return;

        const panel = document.getElementById('panel');
        if (obj.fontFamily) {
          const ff = String(obj.fontFamily);
          document.body.style.fontFamily = ff;
          titleEl.style.fontFamily = ff;
          donorsTitleEl.style.fontFamily = ff;
          chattersTitleEl.style.fontFamily = ff;
        }
        const fontSize = Number(obj.fontSize);
        if (Number.isFinite(fontSize)) {
          donorsEl.style.fontSize = fontSize + 'px';
          chattersEl.style.fontSize = fontSize + 'px';
          titleEl.style.fontSize = Math.max(14, Math.round(fontSize * 1.0)) + 'px';
          donorsTitleEl.style.fontSize = fontSize + 'px';
          chattersTitleEl.style.fontSize = fontSize + 'px';
        }
        if (obj.fontWeight) {
          const fw = String(obj.fontWeight);
          donorsEl.style.fontWeight = fw;
          chattersEl.style.fontWeight = fw;
          titleEl.style.fontWeight = fw;
          donorsTitleEl.style.fontWeight = fw;
          chattersTitleEl.style.fontWeight = fw;
        }
        if (obj.fontColor) {
          const fc = String(obj.fontColor);
          document.body.style.color = fc;
          titleEl.style.color = fc;
          donorsTitleEl.style.color = fc;
          chattersTitleEl.style.color = fc;
        }
        const bgOpacity = Number(obj.bgOpacity);
        if (Number.isFinite(bgOpacity)) panel.style.background = 'rgba(0,0,0,' + bgOpacity + ')';
        const blur = Number(obj.blur);
        if (Number.isFinite(blur)) panel.style.backdropFilter = 'blur(' + blur + 'px)';
        const radius = Number(obj.radius);
        if (Number.isFinite(radius)) panel.style.borderRadius = radius + 'px';
        const shadowBlur = Number(obj.shadowBlur);
        const shadowOpacity = Number(obj.shadowOpacity);
        if (Number.isFinite(shadowBlur) && Number.isFinite(shadowOpacity)) {
          panel.style.boxShadow = '0 0 ' + shadowBlur + 'px rgba(0,0,0,' + shadowOpacity + ')';
        }

        if (typeof obj.titleText === 'string') renderCfg.titleText = obj.titleText.trim() || 'Credits';
        if (typeof obj.donorsTitleText === 'string') renderCfg.donorsTitleText = obj.donorsTitleText.trim() || 'Donors';
        if (typeof obj.chattersTitleText === 'string') renderCfg.chattersTitleText = obj.chattersTitleText.trim() || 'Chatters';
        titleEl.textContent = renderCfg.titleText;
        donorsTitleEl.textContent = renderCfg.donorsTitleText;
        chattersTitleEl.textContent = renderCfg.chattersTitleText;

        renderCfg.showNumbers = Boolean(obj.showNumbers);
        renderCfg.showAvatars = Boolean(obj.showAvatars);
        const avatarSize = Number(obj.avatarSize);
        if (Number.isFinite(avatarSize)) renderCfg.avatarSize = Math.max(12, Math.min(96, Math.round(avatarSize)));
        const avatarRadius = Number(obj.avatarRadius);
        if (Number.isFinite(avatarRadius)) renderCfg.avatarRadius = Math.max(0, Math.min(999, Math.round(avatarRadius)));
      }

      function makeLineItem(index, text, avatarUrl) {
        const wrap = document.createElement('div');
        wrap.className = 'item';

        if (renderCfg.showNumbers) {
          const num = document.createElement('span');
          num.className = 'num';
          num.textContent = String(index + 1) + '.';
          wrap.appendChild(num);
        }

        if (renderCfg.showAvatars && avatarUrl) {
          const img = document.createElement('img');
          img.className = 'avatar';
          img.src = String(avatarUrl);
          img.referrerPolicy = 'no-referrer';
          img.loading = 'lazy';
          img.style.width = renderCfg.avatarSize + 'px';
          img.style.height = renderCfg.avatarSize + 'px';
          img.style.borderRadius = renderCfg.avatarRadius + 'px';
          wrap.appendChild(img);
        }

        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = text || '';
        wrap.appendChild(name);
        return wrap;
      }

      function renderState(state) {
        const donors = Array.isArray(state && state.donors) ? state.donors : [];
        const chatters = Array.isArray(state && state.chatters) ? state.chatters : [];

        donorsEl.innerHTML = '';
        chattersEl.innerHTML = '';

        if (donors.length) {
          donorsSection.classList.remove('is-hidden');
          const sliced = donors.slice(0, 200);
          for (let i = 0; i < sliced.length; i++) {
            const d = sliced[i];
            const name = d && d.name ? String(d.name) : '';
            const amount = d && typeof d.amount === 'number' && d.amount ? d.amount : 0;
            const currency = d && d.currency ? String(d.currency) : '';
            const text = name ? (name + (amount ? (' - ' + amount + ' ' + currency) : '')) : '';
            donorsEl.appendChild(makeLineItem(i, text, d && d.avatarUrl ? String(d.avatarUrl) : null));
          }
        } else {
          donorsSection.classList.add('is-hidden');
        }

        if (chatters.length) {
          chattersSection.classList.remove('is-hidden');
          const sliced = chatters.slice(0, 500);
          for (let i = 0; i < sliced.length; i++) {
            const c = sliced[i];
            const text = c && c.name ? String(c.name) : '';
            chattersEl.appendChild(makeLineItem(i, text, c && c.avatarUrl ? String(c.avatarUrl) : null));
          }
        } else {
          chattersSection.classList.add('is-hidden');
        }
      }

      const socket = io({ transports: ['websocket', 'polling'] });
      socket.on('connect', () => {
        statusEl.textContent = 'Connected';
        socket.emit('join:overlay', { token: TOKEN });
      });
      socket.on('disconnect', () => {
        statusEl.textContent = 'Disconnected';
      });
      socket.on('credits:config', (payload) => {
        cfg = payload || { creditsStyleJson: null };
        applyStyle(cfg.creditsStyleJson);
      });
      socket.on('credits:state', (payload) => {
        statusEl.textContent = 'Live';
        renderState(payload || { donors: [], chatters: [] });
      });
    </script>
  </body>
</html>`;

    return res.status(200).send(html);
  });
}
