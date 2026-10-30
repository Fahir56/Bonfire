const $ = id => document.getElementById(id);
let token = null, user = null, servers = [], channels = [], activeServer = null, activeChannel = null, socket = null;
let localStream = null, voicePeers = new Map(), voiceServer = null, activeDM = null, selectedFile = null, selectedPreviewUrl = null;
let lastMsg = null, unread = 0, stickToBottom = true, loadTicket = 0, lastTypingSent = 0, askEscape = null;
const typers = new Map();
const presence = new Map(); // userId -> 'online' | 'afk' | 'offline'
let members = [], myStatus = 'online', sentStatus = null, membersReload;
const STATUS_LABEL = { online: 'Online', afk: 'AFK', offline: 'Offline' };
const STATUS_TIP = { online: 'Online', afk: 'AFK — tabbed out', offline: 'Offline' };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const palette = ['#8c6eb3', '#d07a4f', '#4f93a3', '#c4607f', '#5e9e6b', '#b0894a', '#6a7fd0', '#c76ad0'];
const EMOJIS = ['🔥', '😂', '🥹', '😭', '💀', '🤝', '👀', '✨', '❤️', '👍', '🎉', '🙏', '😎', '🤔', '😤', '🥳', '🫡', '😴', '🍕', '🌭', '🍿', '🐸', '🦆', '💯'];

/* ---------- small helpers ---------- */
let toastTimer;
function toast(s, onClick) {
  const t = $('toast'); t.textContent = s; t.classList.add('show'); t.classList.toggle('clickable', !!onClick);
  t.onclick = onClick ? () => { t.classList.remove('show'); onClick() } : null;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), onClick ? 5000 : 2600);
}
function initials(s) { return [...(s || '?').trim()][0]?.toUpperCase() || '?' }
function safe(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) }
function time(s) { return new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
function colorFor(s) { let h = 0; for (const c of String(s || '?')) h = (h * 31 + c.codePointAt(0)) >>> 0; return palette[h % palette.length] }
function avatar(name, cls = 'avatar', attrs = '') { return `<div class="${cls}" ${attrs} style="background:${colorFor(name)}">${safe(initials(name))}</div>` }
function avatarWithStatus(name, id) { const st = statusOf(id); return `<div class="avatar-wrap">${avatar(name)}<i class="status-dot ${st}" data-presence="${safe(id)}" data-tip="${STATUS_TIP[st]}"></i></div>` }
function dayKey(d) { return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate() }
function dayLabel(d) {
  const today = new Date(), y = new Date(); y.setDate(today.getDate() - 1);
  if (dayKey(d) === dayKey(today)) return 'Today';
  if (dayKey(d) === dayKey(y)) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
function linkify(escaped) { return escaped.replace(/(https?:\/\/[^\s<]+[^\s<.,!?;:)\]'"])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>') }
function isMobile() { return matchMedia('(max-width:680px)').matches }
function shake(el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); blip('err') }
async function api(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(opts.headers || {}) } });
  let d = {}; try { d = await r.json() } catch { }
  if (!r.ok) throw Error(d.error || 'Request failed');
  return d;
}

/* ---------- sounds (tiny WebAudio blips, toggleable) ---------- */
let soundOn = (() => { try { return localStorage.getItem('bonfireSound') !== 'off' } catch { return true } })(), actx = null;
function blip(kind = 'pop') {
  if (!soundOn) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
    const [a, b, vol] = { pop: [480 + Math.random() * 120, 900, .05], send: [380, 1300, .06], err: [220, 120, .035], boop: [760, 520, .045] }[kind];
    o.type = kind === 'err' ? 'triangle' : 'sine';
    o.frequency.setValueAtTime(a, t); o.frequency.exponentialRampToValueAtTime(b, t + .09);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + .012); g.gain.exponentialRampToValueAtTime(.0001, t + .15);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + .17);
  } catch { }
}
function renderSound() { $('soundToggle').textContent = soundOn ? '🔊' : '🔈'; $('soundToggle').dataset.tip = soundOn ? 'Sounds on' : 'Sounds off' }
$('soundToggle').onclick = () => { soundOn = !soundOn; try { localStorage.setItem('bonfireSound', soundOn ? 'on' : 'off') } catch { } renderSound(); toast(soundOn ? 'Boops enabled 🔊' : 'Shhh… 🤫') };
renderSound();

/* ---------- particles ---------- */
const SPARK_COLORS = ['#ff8a4c', '#ffc06b', '#ff5d8f', '#5fe0a0', '#7cc6ff'];
function sparks(x, y, n = 8, { emoji = null, spread = 1, up = false } = {}) {
  if (reduceMotion) return;
  for (let i = 0; i < n; i++) {
    const el = document.createElement(emoji ? 'span' : 'i');
    if (emoji) el.textContent = Array.isArray(emoji) ? emoji[i % emoji.length] : emoji;
    else el.style.background = SPARK_COLORS[i % SPARK_COLORS.length];
    $('fx').append(el);
    const ang = up ? -Math.PI / 2 + (Math.random() - .5) * 1.6 : Math.random() * Math.PI * 2;
    const dist = (35 + Math.random() * 65) * spread, dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist + (up ? 0 : 25);
    const s = .6 + Math.random() * .8, rot = (Math.random() - .5) * 540;
    el.animate([
      { transform: `translate(${x}px,${y}px) translate(-50%,-50%) scale(${s})`, opacity: 1 },
      { transform: `translate(${x + dx}px,${y + dy}px) translate(-50%,-50%) rotate(${rot}deg) scale(0)`, opacity: 0 }
    ], { duration: 650 + Math.random() * 450, easing: 'cubic-bezier(.15,.8,.3,1)' }).onfinish = () => el.remove();
  }
}
function centerOf(el) { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] }

/* Every button gets a jelly boing + a tiny burst + a boop */
const SQUISHY = 'button, .attach, .server-logo, .me-avatar, .member, .avatar.author';
document.addEventListener('click', e => {
  const b = e.target.closest(SQUISHY); if (!b) return;
  b.classList.remove('boing'); void b.offsetWidth; b.classList.add('boing');
  hideTip();
  if (b.classList.contains('send')) return; // send has its own bigger effect
  blip('pop');
  const [x, y] = e.detail ? [e.clientX, e.clientY] : centerOf(b);
  sparks(x, y, 6);
});
document.addEventListener('animationend', e => { if (e.animationName === 'jelly') e.target.classList.remove('boing'); if (e.animationName === 'shake') e.target.classList.remove('shake') });

/* ---------- tooltips ---------- */
const tip = $('tip');
function hideTip() { tip.classList.remove('show') }
document.addEventListener('pointerover', e => {
  const t = e.target.closest('[data-tip]'); if (!t || e.pointerType === 'touch') return;
  tip.textContent = t.dataset.tip;
  const r = t.getBoundingClientRect(), side = !!t.closest('.servers');
  tip.classList.toggle('below', !side);
  if (side) { tip.style.left = r.right + 14 + 'px'; tip.style.top = r.top + r.height / 2 - tip.offsetHeight / 2 + 'px' }
  else {
    tip.style.left = Math.min(innerWidth - tip.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2)) + 'px';
    tip.style.top = (r.bottom + tip.offsetHeight + 14 > innerHeight ? r.top - tip.offsetHeight - 8 : r.bottom + 8) + 'px';
  }
  tip.classList.add('show');
});
document.addEventListener('pointerout', e => { const t = e.target.closest('[data-tip]'); if (t && !t.contains(e.relatedTarget)) hideTip() });

/* ---------- ask dialog (replaces prompt()) ---------- */
function ask({ title, hint = '', placeholder = '', value = '', emoji = '✨', ok = "Let's go" }) {
  return new Promise(res => {
    $('askTitle').textContent = title; $('askHint').textContent = hint; $('askEmoji').textContent = emoji; $('askOk').textContent = ok;
    const inp = $('askInput'); inp.placeholder = placeholder; inp.value = value;
    $('askModal').classList.remove('hidden'); setTimeout(() => { inp.focus(); inp.select() }, 60);
    const done = v => { $('askModal').classList.add('hidden'); askEscape = null; res(v) };
    $('askForm').onsubmit = e => { e.preventDefault(); const v = inp.value.trim(); if (!v) return shake($('askForm')); done(v) };
    $('askCancel').onclick = () => done(null);
    $('askModal').onclick = e => { if (e.target === $('askModal')) done(null) };
    askEscape = () => done(null);
  });
}

/* ---------- auth ---------- */
async function auth(mode) {
  $('authError').textContent = '';
  const username = $('username').value.trim(), password = $('password').value;
  if (!username || !password) { $('authError').textContent = 'Enter your username and password.'; shake($('authCard')); return }
  const btn = $(mode); btn.disabled = true;
  try {
    const d = await api('/api/auth/' + mode, { method: 'POST', body: JSON.stringify({ username, password }) });
    token = d.token; user = d.user; localStorage.setItem('bonfireToken', token);
    sparks(...centerOf(btn), 22, { emoji: ['🔥', '✨', '🎉'], spread: 2.2 }); blip('send');
    await boot();
  } catch (e) { $('authError').textContent = e.message; shake($('authCard')) }
  finally { btn.disabled = false }
}
$('signin').onclick = () => auth('signin'); $('signup').onclick = () => auth('signup');
$('password').addEventListener('keydown', e => { if (e.key === 'Enter') auth('signin') });
$('username').addEventListener('keydown', e => { if (e.key === 'Enter') $('password').focus() });
$('signout').onclick = () => { if (socket) socket.disconnect(); leaveVoice(); localStorage.removeItem('bonfireToken'); location.reload() };

/* Rising embers behind the sign-in card */
function startEmbers() {
  const c = $('embers'), ctx = c.getContext('2d'); if (reduceMotion) return;
  let w, h; const dots = [];
  const size = () => { w = c.width = innerWidth * devicePixelRatio; h = c.height = innerHeight * devicePixelRatio };
  size(); addEventListener('resize', size);
  for (let i = 0; i < 70; i++) dots.push({ x: Math.random() * w, y: Math.random() * h, r: (Math.random() * 2.2 + .6) * devicePixelRatio, v: (Math.random() * .7 + .25) * devicePixelRatio, p: Math.random() * 6.28 });
  (function frame() {
    if ($('auth').classList.contains('hidden')) return;
    ctx.clearRect(0, 0, w, h);
    for (const d of dots) {
      d.y -= d.v; d.p += .02; d.x += Math.sin(d.p) * .5 * devicePixelRatio;
      if (d.y < -10) { d.y = h + 10; d.x = Math.random() * w }
      const a = Math.min(1, d.y / h) * .9;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 6.28);
      ctx.fillStyle = `rgba(255,${140 + (d.r * 20 | 0)},76,${a})`; ctx.shadowBlur = 12; ctx.shadowColor = '#ff8a4c'; ctx.fill();
    }
    requestAnimationFrame(frame);
  })();
}
function showAuth() { $('auth').classList.remove('hidden'); startEmbers(); setTimeout(() => $('username').focus(), 100) }

/* ---------- boot ---------- */
async function boot() {
  try {
    if (!user) user = (await api('/api/me')).user;
    $('auth').classList.add('hidden'); $('app').classList.remove('hidden');
    $('myName').textContent = user.display_name; $('myAvatar').textContent = initials(user.display_name); $('myAvatar').style.background = colorFor(user.display_name);
    socket = io({ auth: cb => cb({ token, status: currentStatus() }) });
    socket.on('connect', () => { sentStatus = null; syncStatus(); setConn(true); if (activeChannel && !activeDM) socket.emit('channel:join', { channelId: activeChannel.id }); if (activeServer) loadMembers(false) });
    socket.on('disconnect', () => setConn(false));
    socket.on('connect_error', () => { setConn(false); toast('Connection issue. Please sign in again.') });
    socket.on('message:new', m => { if (!activeDM && m.channel_id === activeChannel?.id) incoming(m) });
    socket.on('dm:new', m => {
      if (activeDM && ((m.sender_id === user.id && m.recipient_id === activeDM.id) || (m.sender_id === activeDM.id && m.recipient_id === user.id))) incoming(m);
      else if (m.sender_id !== user.id) { toast(`💌 New DM from ${m.display_name} — tap to reply`, () => openUser(m.sender_id, m.display_name)); blip('boop') }
    });
    socket.on('typing', onTyping);
    socket.on('presence:update', ({ userId, status }) => setPresence(userId, status));
    socket.on('app:error', toast);
    socket.on('voice:peer-joined', peerJoined); socket.on('voice:peer-left', peerLeft); socket.on('voice:signal', handleSignal);
    if (matchMedia('(max-width:1000px)').matches) $('app').classList.add('no-members');
    await loadServers();
    loadFriends();
    const invite = new URLSearchParams(location.search).get('invite');
    if (invite) { await joinByCode(invite); history.replaceState({}, '', location.pathname) }
  } catch (e) { localStorage.removeItem('bonfireToken'); token = null; user = null; $('app').classList.add('hidden'); showAuth(); $('authError').textContent = e.message }
}
function setConn(ok) { document.querySelector('.server-bottom').classList.toggle('offline', !ok); document.querySelector('.server-bottom').dataset.tip = ok ? 'Connected' : 'Reconnecting…'; renderMe(); renderOnlinePill() }

/* ---------- presence: online (focused) / afk (open, not focused) / offline ---------- */
function currentStatus() { return document.visibilityState === 'visible' && document.hasFocus() ? 'online' : 'afk' }
function statusOf(id) { return id === user?.id ? (socket?.connected ? myStatus : 'offline') : presence.get(id) || 'offline' }
function syncStatus() {
  myStatus = currentStatus(); renderMe();
  if (socket?.connected && sentStatus !== myStatus) { socket.emit('presence', { status: myStatus }); sentStatus = myStatus; if (members.some(m => m.id === user.id)) renderMembers() }
}
addEventListener('focus', syncStatus); addEventListener('blur', syncStatus); document.addEventListener('visibilitychange', syncStatus);
function renderMe() {
  if (!user) return;
  const st = statusOf(user.id);
  $('myStatus').className = st; $('myStatus').textContent = st === 'afk' ? 'AFK 💤' : STATUS_LABEL[st];
  setDot($('myDot'), st);
}
function setDot(dot, st) {
  if (dot.classList.contains(st)) return;
  dot.className = 'status-dot ' + st + ' changed'; dot.dataset.tip = STATUS_TIP[st];
  dot.addEventListener('animationend', () => dot.classList.remove('changed'), { once: true });
}
function setPresence(id, st) {
  if (presence.get(id) === st) return;
  presence.set(id, st);
  if (members.some(m => m.id === id)) renderMembers();
  else if (st !== 'offline' && activeServer) { clearTimeout(membersReload); membersReload = setTimeout(() => loadMembers(false), 300) } // someone new just joined
  document.querySelectorAll(`[data-presence="${CSS.escape(id)}"]`).forEach(d => setDot(d, st));
  if (activeDM?.id === id) renderDMTopic();
}
function renderOnlinePill() {
  const pill = document.querySelector('.online-pill'), ok = !!socket?.connected;
  pill.classList.toggle('offline', !ok);
  if (!ok) { $('onlineText').textContent = 'reconnecting…'; return }
  const on = members.filter(m => statusOf(m.id) === 'online').length, afk = members.filter(m => statusOf(m.id) === 'afk').length;
  $('onlineText').textContent = `${on} online` + (afk ? ` · ${afk} afk` : '');
}

/* ---------- servers & channels ---------- */
async function loadServers() {
  const d = await api('/api/servers'); servers = d.servers;
  if (!servers.length) { const n = await api('/api/servers', { method: 'POST', body: JSON.stringify({ name: 'Bonfire' }) }); servers = [n.server] }
  renderServers(); await selectServer(servers[0].id);
}
function renderServers() {
  $('serverList').innerHTML = servers.map(s => `<button class="server-icon ${s.id === activeServer?.id ? 'active' : ''}" data-id="${s.id}" data-tip="${safe(s.name)}" aria-label="${safe(s.name)}">${safe(initials(s.name))}</button>`).join('');
  document.querySelectorAll('.server-icon').forEach(b => b.onclick = () => selectServer(b.dataset.id));
}
async function selectServer(id) {
  activeServer = servers.find(s => s.id === id); if (!activeServer) return;
  $('serverName').textContent = activeServer.name; renderServers();
  const d = await api(`/api/servers/${id}/channels`); channels = d.channels; renderChannels();
  loadMembers();
  if (activeDM || !channels.some(c => c.id === activeChannel?.id)) await selectChannel(channels[0], { keepDrawer: true });
}
function renderChannels() {
  $('channelList').innerHTML = channels.map(c => `<button class="channel ${!activeDM && c.id === activeChannel?.id ? 'active' : ''}" data-id="${c.id}"><span class="hash">#</span>${safe(c.name)}</button>`).join('');
  document.querySelectorAll('.channel').forEach(b => b.onclick = () => selectChannel(channels.find(c => c.id === b.dataset.id)));
}
async function selectChannel(c, { keepDrawer = false } = {}) {
  if (!c) return;
  activeDM = null; activeChannel = c; renderChannels(); typers.clear(); renderTyping();
  if (!keepDrawer) closeDrawers();
  $('chatSigil').textContent = '#'; $('channelName').textContent = c.name; $('channelTopic').textContent = c.topic || 'No topic yet — just vibes.';
  $('messageInput').placeholder = 'Message #' + c.name;
  socket.emit('channel:join', { channelId: c.id });
  resetMessages('channel', c.name);
  const ticket = ++loadTicket;
  try {
    const d = await api(`/api/channels/${c.id}/messages`);
    if (ticket !== loadTicket) return;
    d.messages.forEach(m => renderMessage(m)); scrollBottom();
  } catch (e) { toast(e.message) }
  if (!isMobile()) $('messageInput').focus();
}

/* ---------- messages ---------- */
function resetMessages(kind, name) {
  const box = $('messages'); box.innerHTML = ''; lastMsg = null; unread = 0; stickToBottom = true;
  if (kind === 'dm') box.insertAdjacentHTML('beforeend', `<div class="welcome"><div class="welcome-icon">👋</div><h2>@${safe(name)}</h2><p>This is the very start of your DMs with <b>@${safe(name)}</b>. Say hi!</p></div><div class="dm-banner">💌 Direct messages are only visible to you two.</div>`);
  else box.insertAdjacentHTML('beforeend', `<div class="welcome"><div class="welcome-icon">🔥</div><h2>Welcome to #${safe(name)}!</h2><p>This is the beginning of <b>#${safe(name)}</b>. Say something nice.</p></div>`);
  updateJump();
}
function renderMessage(m, { animate = false } = {}) {
  const box = $('messages');
  if (box.querySelector(`[data-message="${CSS.escape(String(m.id))}"]`)) return;
  const n = m.display_name || 'Bonfire friend', at = new Date(m.created_at), mine = m.user_id === user?.id;
  if (!lastMsg || dayKey(lastMsg.at) !== dayKey(at)) { box.insertAdjacentHTML('beforeend', `<div class="day-divider"><span>${safe(dayLabel(at))}</span></div>`); lastMsg = null }
  const compact = lastMsg && lastMsg.user === m.user_id && at - lastMsg.at < 5 * 60e3;
  let media = '';
  if (m.attachment_id) {
    const url = '/api/uploads/' + encodeURIComponent(m.attachment_id) + '?token=' + encodeURIComponent(token);
    media = String(m.mime_type || '').startsWith('video/')
      ? `<video class="message-media" controls preload="metadata" src="${url}"></video>`
      : `<a href="${url}" target="_blank" rel="noopener"><img class="message-media" loading="lazy" alt="${safe(m.filename || 'Shared image')}" src="${url}"></a>`;
  }
  const text = (m.content || '').trim();
  const jumbo = text && text.length <= 16 && /\p{Extended_Pictographic}/u.test(text) && !/[\p{L}\p{N}]/u.test(text);
  const el = document.createElement('article');
  el.className = 'message' + (compact ? ' compact' : '') + (mine ? ' mine' : '') + (animate ? ' new' : '');
  el.dataset.message = m.id;
  const who = `data-user="${safe(m.user_id)}" data-name="${safe(n)}"`;
  el.innerHTML = (compact ? `<time class="stamp">${time(m.created_at)}</time>` : avatar(n, 'avatar author', who)) +
    `<div class="message-body">${compact ? '' : `<div class="message-meta"><b class="author" ${who}>${safe(n)}</b><time title="${safe(at.toLocaleString())}">${time(m.created_at)}</time></div>`}` +
    `${m.content ? `<div class="message-text${jumbo ? ' jumbo' : ''}">${linkify(safe(m.content))}</div>` : ''}${media}</div>`;
  el.querySelectorAll('img,video').forEach(x => x.addEventListener(x.tagName === 'IMG' ? 'load' : 'loadedmetadata', () => { if (stickToBottom) scrollBottom() }, { once: true }));
  el.addEventListener('dblclick', e => { if (e.target.closest('a,video')) return; window.getSelection()?.removeAllRanges(); sparks(e.clientX, e.clientY, 10, { emoji: ['❤️', '🔥', '✨', '💖'], spread: 1.4 }); blip('boop') });
  box.append(el);
  lastMsg = { user: m.user_id, at };
}
function incoming(m) {
  const mine = m.user_id === user.id, near = isNearBottom();
  renderMessage(m, { animate: true }); typers.delete(m.user_id); renderTyping();
  if (mine || near) scrollBottom(true);
  else { unread++; updateJump(); blip('boop') }
}
function isNearBottom() { const b = $('messages'); return b.scrollHeight - b.scrollTop - b.clientHeight < 140 }
function scrollBottom(smooth = false) {
  const b = $('messages');
  if (smooth && !reduceMotion) b.scrollTo({ top: b.scrollHeight, behavior: 'smooth' }); else b.scrollTop = b.scrollHeight;
  unread = 0; stickToBottom = true; updateJump();
}
function updateJump() {
  const show = unread > 0 || !isNearBottom();
  $('jumpBtn').classList.toggle('hidden', !show);
  $('jumpText').textContent = unread ? `${unread} new message${unread > 1 ? 's' : ''}` : 'Jump to latest';
}
$('messages').addEventListener('scroll', () => { stickToBottom = isNearBottom(); if (stickToBottom) unread = 0; updateJump() }, { passive: true });
$('jumpBtn').onclick = () => scrollBottom(true);

/* ---------- composer ---------- */
const input = $('messageInput');
function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 180) + 'px' }
input.addEventListener('input', () => { autosize(); sendTyping() });
input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('composer').requestSubmit() } });
input.addEventListener('paste', e => { const f = [...(e.clipboardData?.files || [])][0]; if (f) { e.preventDefault(); setFile(f) } });

function setFile(f) {
  if (selectedPreviewUrl) URL.revokeObjectURL(selectedPreviewUrl);
  selectedFile = f || null; selectedPreviewUrl = null;
  if (!f) { $('uploadPreview').innerHTML = ''; $('fileInput').value = ''; return }
  if (!/^(image\/(png|jpeg|gif|webp)|video\/(mp4|webm|quicktime))$/.test(f.type)) { toast('Only PNG, JPG, GIF, WebP, MP4, WebM or MOV'); selectedFile = null; return }
  if (f.size > 20 * 1024 * 1024) { toast('File must be 20 MB or smaller.'); selectedFile = null; return }
  selectedPreviewUrl = URL.createObjectURL(f);
  const thumb = f.type.startsWith('image/') ? `<img src="${selectedPreviewUrl}" alt="">` : '<div class="vid">🎬</div>';
  const size = f.size > 1048576 ? (f.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(f.size / 1024)) + ' KB';
  $('uploadPreview').innerHTML = `<div class="upload-chip">${thumb}<span>${safe(f.name)}<small>${size} · ready to send</small></span><button type="button" class="icon-btn" id="clearFile" aria-label="Remove file">✕</button></div>`;
  $('clearFile').onclick = () => setFile(null);
  input.focus();
}
$('fileInput').onchange = () => setFile($('fileInput').files[0]);
const chatEl = document.querySelector('.chat');
chatEl.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault() });
chatEl.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) { e.preventDefault(); setFile(f) } });

async function uploadSelected() {
  if (!selectedFile) return null;
  const fd = new FormData(); fd.append('file', selectedFile);
  const r = await fetch('/api/uploads', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(d.error || 'Upload failed');
  setFile(null);
  return d.attachment.id;
}
let sending = false;
$('composer').onsubmit = async e => {
  e.preventDefault();
  const content = input.value.trim();
  if (!content && !selectedFile) { shake($('composer')); return }
  if (sending) return; sending = true;
  const send = document.querySelector('.send');
  try {
    const attachmentId = await uploadSelected();
    if (activeDM) socket.emit('dm:send', { toUserId: activeDM.id, content, attachmentId });
    else if (activeChannel) socket.emit('message:send', { channelId: activeChannel.id, content, attachmentId });
    input.value = ''; autosize(); lastTypingSent = 0;
    send.classList.remove('launch'); void send.offsetWidth; send.classList.add('launch');
    const [x, y] = centerOf(send); sparks(x, y, 12, { emoji: ['🔥', '✨', '💫'], up: true, spread: 1.6 }); blip('send');
  } catch (err) { toast(err.message); shake($('composer')) }
  finally { sending = false }
};
document.querySelector('.send').addEventListener('animationend', e => { if (e.animationName === 'launch') e.target.classList.remove('launch') });

/* emoji picker */
$('emojiPop').innerHTML = EMOJIS.map(e => `<button type="button" data-emoji="${e}">${e}</button>`).join('');
$('emojiBtn').onclick = e => { e.stopPropagation(); $('emojiPop').classList.toggle('hidden') };
$('emojiPop').onclick = e => {
  const b = e.target.closest('[data-emoji]'); if (!b) return; e.stopPropagation();
  const s = input.selectionStart ?? input.value.length, t = input.selectionEnd ?? s;
  input.value = input.value.slice(0, s) + b.dataset.emoji + input.value.slice(t);
  input.focus(); input.selectionStart = input.selectionEnd = s + b.dataset.emoji.length; autosize();
};
document.addEventListener('click', e => { if (!e.target.closest('#emojiPop,#emojiBtn')) $('emojiPop').classList.add('hidden') });

/* typing indicator */
function sendTyping() {
  if (!socket || !input.value.trim() || Date.now() - lastTypingSent < 2500) return;
  lastTypingSent = Date.now();
  socket.emit('typing', activeDM ? { toUserId: activeDM.id } : { channelId: activeChannel?.id });
}
function onTyping({ userId, name, channelId, dmFrom } = {}) {
  if (userId === user.id) return;
  const relevant = activeDM ? dmFrom === activeDM.id : channelId === activeChannel?.id;
  if (!relevant) return;
  typers.set(userId, { name, until: Date.now() + 4000 }); renderTyping();
}
function renderTyping() {
  const now = Date.now(); for (const [k, v] of typers) if (v.until < now) typers.delete(k);
  const names = [...typers.values()].map(v => v.name);
  $('typing').innerHTML = names.length ? `<span class="dots"><i></i><i></i><i></i></span><span><b>${safe(names.slice(0, 2).join(', '))}</b>${names.length > 2 ? ` +${names.length - 2}` : ''} ${names.length > 1 ? 'are' : 'is'} typing…</span>` : '';
}
setInterval(() => { if (typers.size) renderTyping() }, 1000);

/* ---------- servers: create / join / invite ---------- */
$('addServer').onclick = async () => {
  const name = await ask({ title: 'Start a new server', hint: 'Give your corner of the internet a name.', placeholder: 'e.g. Snack Club', emoji: '🏕️', ok: 'Create' });
  if (!name) return;
  try {
    const d = await api('/api/servers', { method: 'POST', body: JSON.stringify({ name }) });
    servers.push(d.server); renderServers(); await selectServer(d.server.id);
    toast('Server created 🎉'); sparks(innerWidth / 2, innerHeight / 2, 30, { emoji: ['🎉', '🔥', '✨'], spread: 3 });
  } catch (e) { toast(e.message) }
};
$('addChannel').onclick = async () => {
  if (!activeServer) return;
  const name = await ask({ title: 'New text channel', hint: 'Lowercase, dashes instead of spaces.', placeholder: 'e.g. memes', emoji: '#️⃣', ok: 'Create' });
  if (!name) return;
  try { const d = await api(`/api/servers/${activeServer.id}/channels`, { method: 'POST', body: JSON.stringify({ name }) }); channels.push(d.channel); renderChannels(); await selectChannel(d.channel); toast('Channel created ✨') }
  catch (e) { toast(e.message) }
};
$('invite').onclick = async () => {
  if (!activeServer) return;
  const url = location.origin + location.pathname + '?invite=' + activeServer.invite_code;
  try { await navigator.clipboard.writeText(url); toast('Invite link copied — share it with friends 🔗') }
  catch { await ask({ title: 'Copy this invite link', value: url, emoji: '🔗', ok: 'Done' }) }
};
$('joinServer').onclick = async () => {
  const code = await ask({ title: 'Join a server', hint: 'Paste an invite code or invite link.', placeholder: 'https://…?invite=abc123', emoji: '🚪', ok: 'Join' });
  if (code) joinByCode(code);
};
async function joinByCode(raw) {
  const code = String(raw).includes('invite=') ? new URL(raw, location.origin).searchParams.get('invite') : String(raw).trim();
  try {
    const d = await api('/api/servers/join', { method: 'POST', body: JSON.stringify({ code }) });
    if (!servers.some(s => s.id === d.server.id)) servers.push(d.server);
    renderServers(); await selectServer(d.server.id); toast('Joined ' + d.server.name + ' 🎉');
  } catch (e) { toast(e.message) }
}

/* ---------- members ---------- */
async function loadMembers(animate = true) {
  try {
    const serverId = activeServer.id, d = await api(`/api/servers/${serverId}/members`);
    if (serverId !== activeServer?.id) return;
    members = d.members; d.members.forEach(m => { if (m.id !== user.id) presence.set(m.id, m.status) });
    renderMembers(animate);
  } catch { }
}
/* Members grouped Online → AFK → Offline, like a real campfire roll call */
function renderMembers(animate = false) {
  const groups = { online: [], afk: [], offline: [] };
  members.forEach(m => groups[statusOf(m.id)].push(m));
  let i = 0;
  $('memberList').classList.toggle('settled', !animate);
  $('memberCount').textContent = members.length;
  $('memberList').innerHTML = Object.entries(groups).filter(([, list]) => list.length).map(([st, list]) =>
    `<div class="member-group">${STATUS_LABEL[st].toUpperCase()} — ${list.length}</div>` +
    list.map(m => `<div class="member ${st}" data-user="${safe(m.id)}" data-name="${safe(m.display_name)}" data-username="${safe(m.username || '')}" style="animation-delay:${Math.min(i++, 15) * 35}ms">${avatarWithStatus(m.display_name, m.id)}<span>${safe(m.display_name)}${m.id === user.id ? ' <em>(you)</em>' : ''}${st === 'afk' ? '<span class="zzz">💤</span>' : ''}</span>${m.id === user.id ? '' : '<span class="dm-hint">💬</span>'}</div>`).join('')
  ).join('');
  renderOnlinePill();
}
$('membersToggle').onclick = () => {
  if (matchMedia('(max-width:1000px)').matches) $('app').classList.toggle('members-open');
  else $('app').classList.toggle('no-members');
};

/* ---------- mobile drawers ---------- */
$('menuToggle').onclick = () => $('app').classList.add('drawer-open');
function closeDrawers() { $('app').classList.remove('drawer-open', 'members-open') }
$('scrim').onclick = closeDrawers;

/* ---------- friends & DMs ---------- */
/* Click anyone (member list, message avatar or name) to jump into a DM with them */
function openUser(id, name, username) {
  if (!id) return;
  if (id === user.id) { toast("That's you! Talking to yourself is free though 🪞"); return }
  const m = members.find(x => x.id === id);
  openDM({ id, display_name: name || m?.display_name || 'friend', username: username || m?.username || name || m?.display_name });
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-user]'); if (!t) return;
  openUser(t.dataset.user, t.dataset.name, t.dataset.username);
});

$('friendsOpen').onclick = async () => { $('friendModal').classList.remove('hidden'); closeDrawers(); await loadFriends() };
function closeFriends() { $('friendModal').classList.add('hidden') }
$('friendsClose').onclick = closeFriends;
$('friendModal').onclick = e => { if (e.target === $('friendModal')) closeFriends() };
$('friendForm').onsubmit = async e => {
  e.preventDefault(); $('friendError').textContent = '';
  if (!$('friendUsername').value.trim()) return shake($('friendForm'));
  try {
    const d = await api('/api/friends/request', { method: 'POST', body: JSON.stringify({ username: $('friendUsername').value }) });
    $('friendUsername').value = ''; toast(d.accepted ? 'You are now friends! 🤝' : 'Friend request sent 📨'); await loadFriends();
  } catch (err) { $('friendError').textContent = err.message; shake($('friendForm')) }
};
async function loadFriends() {
  try {
    const d = await api('/api/friends');
    d.friends.forEach(f => presence.set(f.id, f.status));
    $('friendBadge').textContent = d.incoming.length; $('friendBadge').classList.toggle('hidden', !d.incoming.length);
    $('friendRequests').innerHTML = d.incoming.length
      ? d.incoming.map((f, i) => `<div class="friend-row" style="animation-delay:${i * 40}ms">${avatar(f.display_name)}<span>@${safe(f.username)}</span><button class="primary" data-accept="${f.id}">Accept</button></div>`).join('')
      : '<p class="muted">No pending requests.</p>';
    $('friendList').innerHTML = (d.friends.length
      ? d.friends.map((f, i) => `<div class="friend-row" style="animation-delay:${i * 40}ms">${avatarWithStatus(f.display_name, f.id)}<span>@${safe(f.username)}</span><button data-dm="${f.id}" data-name="${safe(f.display_name)}" data-username="${safe(f.username)}">💬 Message</button></div>`).join('')
      : '<p class="muted">Add a friend by username to start a DM.</p>')
      + (d.outgoing.length ? `<p class="modal-label">WAITING ON</p>` + d.outgoing.map(f => `<div class="friend-row">${avatar(f.display_name)}<span>@${safe(f.username)}</span><small class="muted">pending…</small></div>`).join('') : '');
    document.querySelectorAll('[data-accept]').forEach(b => b.onclick = async () => {
      try { await api('/api/friends/' + b.dataset.accept + '/accept', { method: 'POST' }); await loadFriends(); toast('Friend request accepted 🤝') } catch (e) { toast(e.message) }
    });
    document.querySelectorAll('[data-dm]').forEach(b => b.onclick = () => openDM({ id: b.dataset.dm, display_name: b.dataset.name, username: b.dataset.username }));
  } catch (e) { $('friendError').textContent = e.message }
}
function renderDMTopic() { const st = statusOf(activeDM.id); $('channelTopic').textContent = `Direct message · ${st === 'afk' ? 'AFK 💤' : STATUS_LABEL[st]}` }
async function openDM(friend) {
  activeDM = friend; activeChannel = null; typers.clear(); renderTyping(); renderChannels();
  closeFriends(); closeDrawers();
  $('chatSigil').textContent = '@'; $('channelName').textContent = friend.username; renderDMTopic();
  $('messageInput').placeholder = 'Message @' + friend.username;
  resetMessages('dm', friend.username);
  const ticket = ++loadTicket;
  try { const d = await api('/api/dms/' + friend.id); if (ticket !== loadTicket) return; d.messages.forEach(m => renderMessage(m)); scrollBottom() }
  catch (e) { toast(e.message) }
  if (!isMobile()) input.focus();
}

/* ---------- global keys & fun bits ---------- */
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (askEscape) return askEscape();
  if (!$('friendModal').classList.contains('hidden')) return closeFriends();
  $('emojiPop').classList.add('hidden'); closeDrawers();
});
document.querySelector('.server-logo').addEventListener('click', e => sparks(e.clientX || 38, e.clientY || 38, 14, { emoji: '🔥', spread: 1.8 }));
$('myAvatar').addEventListener('click', e => sparks(e.clientX, e.clientY, 12, { emoji: ['✨', '⭐', '💫'], spread: 1.5 }));

/* ---------- voice: small-group peer-to-peer. Restrictive networks may need a TURN server. ---------- */
async function joinVoice() {
  if (localStream) { leaveVoice(); toast('Left Campfire'); return }
  if (!activeServer) return;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceServer = activeServer.id; socket.emit('voice:join', { serverId: voiceServer });
    $('voiceJoin').classList.add('live'); $('voiceJoin').querySelector('.voice-name').textContent = 'Leave Campfire';
    renderVoiceMembers(); toast('You joined Campfire. Your microphone is live 🎙️');
  } catch (e) { localStream = null; toast('Microphone unavailable: ' + e.message) }
}
function renderVoiceMembers() {
  $('voiceMembers').innerHTML = localStream ? `<div class="voice-person">${avatar(user.display_name)}${safe(user.display_name)} <span class="muted">(you)</span></div>${voicePeers.size ? `<div class="voice-person muted">+ ${voicePeers.size} other${voicePeers.size > 1 ? 's' : ''} by the fire</div>` : ''}` : '';
  $('voiceCount').textContent = localStream ? 1 + voicePeers.size : 0;
}
async function peerJoined(p) {
  if (!localStream || !voiceServer || p.userId === user.id || voicePeers.has(p.userId)) return;
  try { const pc = makePeer(p.userId); const offer = await pc.createOffer(); await pc.setLocalDescription(offer); socket.emit('voice:signal', { serverId: voiceServer, toUserId: p.userId, signal: { description: pc.localDescription } }) }
  catch (e) { console.warn(e) }
}
function makePeer(id) {
  if (voicePeers.has(id)) return voicePeers.get(id);
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  voicePeers.set(id, pc);
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.onicecandidate = e => { if (e.candidate) socket.emit('voice:signal', { serverId: voiceServer, toUserId: id, signal: { candidate: e.candidate } }) };
  pc.ontrack = e => { let a = document.getElementById('audio-' + id); if (!a) { a = document.createElement('audio'); a.id = 'audio-' + id; a.autoplay = true; document.body.append(a) } a.srcObject = e.streams[0] };
  pc.onconnectionstatechange = () => { if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) { pc.close(); voicePeers.delete(id); document.getElementById('audio-' + id)?.remove(); renderVoiceMembers() } };
  renderVoiceMembers();
  return pc;
}
async function handleSignal({ fromUserId, signal }) {
  if (!localStream || !signal) return;
  try {
    const pc = voicePeers.get(fromUserId) || makePeer(fromUserId);
    if (signal.description) {
      await pc.setRemoteDescription(signal.description);
      if (signal.description.type === 'offer') { const answer = await pc.createAnswer(); await pc.setLocalDescription(answer); socket.emit('voice:signal', { serverId: voiceServer, toUserId: fromUserId, signal: { description: pc.localDescription } }) }
    }
    if (signal.candidate) try { await pc.addIceCandidate(signal.candidate) } catch { }
  } catch (e) { console.warn(e) }
}
function peerLeft({ userId: id }) { const pc = voicePeers.get(id); if (pc) pc.close(); voicePeers.delete(id); document.getElementById('audio-' + id)?.remove(); renderVoiceMembers() }
function leaveVoice() {
  if (voiceServer && socket) socket.emit('voice:leave', { serverId: voiceServer });
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  localStream = null; for (const pc of voicePeers.values()) pc.close(); voicePeers.clear();
  document.querySelectorAll('audio[id^="audio-"]').forEach(a => a.remove());
  voiceServer = null;
  $('voiceJoin').classList.remove('live'); $('voiceJoin').querySelector('.voice-name').textContent = 'Campfire';
  $('voiceMembers').innerHTML = ''; $('voiceCount').textContent = '0';
}
$('voiceJoin').onclick = joinVoice;

/* ---------- start ---------- */
(async () => {
  token = localStorage.getItem('bonfireToken');
  if (token) { try { user = (await api('/api/me')).user; await boot(); return } catch { localStorage.removeItem('bonfireToken'); token = null } }
  showAuth();
})();
