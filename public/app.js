const $ = id => document.getElementById(id);
let token = null, user = null, servers = [], channels = [], activeServer = null, activeChannel = null, socket = null;
let localStream = null, voicePeers = new Map(), voiceServer = null, activeDM = null, selectedFile = null, selectedPreviewUrl = null;
let newBelow = 0, stickToBottom = true, loadTicket = 0, lastTypingSent = 0, askEscape = null;
let view = null;          // what the chat pane shows: { kind: 'channel'|'dm', id, msgs, hasMore, loading, loadingOlder, ticket }
let replyTo = null, editingId = null, mention = null, reactTarget = null;
const typers = new Map();
const presence = new Map(); // userId -> 'online' | 'afk' | 'offline'
let members = [], myStatus = 'online', sentStatus = null, membersReload;
let dmList = [];             // sidebar conversations, newest first
const allChannels = new Map(); // every channel in every server you're in (for unread dots + Ctrl+K)
const lastActivity = new Map(); // 'c:<channelId>' | 'd:<userId>' -> newest message time (ms)
const pings = new Map();        // same keys -> unread mentions / DMs
let lastRead = {}, drafts = {};
const STATUS_LABEL = { online: 'Online', afk: 'AFK', offline: 'Offline' };
const STATUS_TIP = { online: 'Online', afk: 'AFK — tabbed out', offline: 'Offline' };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const palette = ['#8c6eb3', '#d07a4f', '#4f93a3', '#c4607f', '#5e9e6b', '#b0894a', '#6a7fd0', '#c76ad0'];
const EMOJIS = ['🔥', '😂', '🥹', '😭', '💀', '🤝', '👀', '✨', '❤️', '👍', '🎉', '🙏', '😎', '🤔', '😤', '🥳', '🫡', '😴', '🍕', '🌭', '🍿', '🐸', '🦆', '💯'];
const QUICK_REACTS = ['❤️', '😂', '🔥'];
let limits = { photoMaxMB: 10, videoMaxMB: 30, photoHours: 72, videoHours: 12, messageDays: 90 };
const input = $('messageInput');

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
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
function stripMd(s) { return String(s || '').replace(/```|`|\*\*|~~|\|\|/g, '').replace(/\s+/g, ' ').trim() }
function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s }
function hoursText(h) { return h % 24 === 0 && h >= 48 ? `${h / 24} days` : `${h} hours` }
function renderLimitHint() { $('limitHint').textContent = `Photos up to ${limits.photoMaxMB} MB (vanish after ${hoursText(limits.photoHours)}) · videos up to ${limits.videoMaxMB} MB (vanish after ${hoursText(limits.videoHours)})` }
function isMobile() { return matchMedia('(max-width:680px)').matches }
function shake(el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); blip('err') }
function load(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback } catch { return fallback } }
function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)) } catch { } }
async function api(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(opts.headers || {}) } });
  let d = {}; try { d = await r.json() } catch { }
  if (!r.ok) throw Error(d.error || 'Request failed');
  return d;
}

/* ---------- audio: tiny UI boops + a proper notification chime ---------- */
let soundOn = (() => { try { return localStorage.getItem('bonfireSound') !== 'off' } catch { return true } })(), actx = null;
function audio() {
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); return actx } catch { return null }
}
// Browsers only allow sound after you've interacted with the page, so wake the audio engine on the first tap/keypress.
['pointerdown', 'keydown'].forEach(ev => addEventListener(ev, () => audio(), { passive: true }));
function blip(kind = 'pop') {
  if (!soundOn) return;
  const ctx = audio(); if (!ctx) return;
  try {
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    const [a, b, vol] = { pop: [480 + Math.random() * 120, 900, .05], send: [380, 1300, .06], err: [220, 120, .035], boop: [760, 520, .045] }[kind];
    o.type = kind === 'err' ? 'triangle' : 'sine';
    o.frequency.setValueAtTime(a, t); o.frequency.exponentialRampToValueAtTime(b, t + .09);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + .012); g.gain.exponentialRampToValueAtTime(.0001, t + .15);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + .17);
  } catch { }
}
/* Notification chime: a bright 4-note bell (~1.5s) through a compressor so it's loud without crackling.
   DMs, mentions and regular messages each get their own melody so you can tell them apart by ear. */
const CHIMES = {
  dm: [[659.25, 0], [987.77, .15], [1318.51, .30], [1567.98, .48]],
  mention: [[783.99, 0], [1046.5, .13], [1318.51, .26], [1046.5, .42], [1567.98, .56]],
  message: [[880, 0], [1174.66, .16], [1396.91, .32]]
};
function chime(kind = 'mention', force = false) {
  if (!notifyPrefs.sound && !force) return;
  const ctx = audio(); if (!ctx) return;
  try {
    const t0 = ctx.currentTime + .03, master = ctx.createGain(), comp = ctx.createDynamicsCompressor();
    master.gain.value = 1.4 * notifyPrefs.volume;
    comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 6; comp.attack.value = .002; comp.release.value = .3;
    master.connect(comp).connect(ctx.destination);
    for (const [f, dt] of CHIMES[kind] || CHIMES.mention) {
      const t = t0 + dt;
      // fundamental + bell-like overtones, each with a long ring-out
      for (const [type, mult, vol, len] of [['sine', 1, .6, 1.1], ['triangle', 2, .22, .7], ['sine', 3.01, .08, .45], ['square', 1, .03, .25]]) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type; o.frequency.value = f * mult;
        g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + .008); g.gain.exponentialRampToValueAtTime(.0001, t + len);
        o.connect(g).connect(master); o.start(t); o.stop(t + len + .05);
      }
    }
  } catch { }
}
function renderSound() { $('soundToggle').textContent = soundOn ? '🔊' : '🔈'; $('soundToggle').dataset.tip = soundOn ? 'Button sounds on' : 'Button sounds off' }
$('soundToggle').onclick = () => { soundOn = !soundOn; try { localStorage.setItem('bonfireSound', soundOn ? 'on' : 'off') } catch { } renderSound(); toast(soundOn ? 'Boops enabled 🔊' : 'Shhh… 🤫 (notification chimes are set separately under 🔔)') };
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

/* ---------- ask / confirm dialog (replaces prompt() and confirm()) ---------- */
function ask({ title, hint = '', placeholder = '', value = '', emoji = '✨', ok = "Let's go", input: withInput = true, danger = false, allowEmpty = false }) {
  return new Promise(res => {
    $('askTitle').textContent = title; $('askHint').textContent = hint; $('askEmoji').textContent = emoji; $('askOk').textContent = ok;
    $('askOk').classList.toggle('danger', danger);
    const inp = $('askInput'); inp.placeholder = placeholder; inp.value = value; inp.classList.toggle('hidden', !withInput);
    $('askModal').classList.remove('hidden'); setTimeout(() => withInput ? (inp.focus(), inp.select()) : $('askOk').focus(), 60);
    const done = v => { $('askModal').classList.add('hidden'); askEscape = null; res(v) };
    $('askForm').onsubmit = e => {
      e.preventDefault(); if (!withInput) return done(true);
      const v = inp.value.trim(); if (!v && !allowEmpty) return shake($('askForm')); done(v);
    };
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
$('signout').onclick = () => { saveDraft(); if (socket) socket.disconnect(); leaveVoice(); localStorage.removeItem('bonfireToken'); location.reload() };

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
    lastRead = load('bonfireRead:' + user.id, {}); drafts = load('bonfireDrafts:' + user.id, {});
    api('/api/config').then(d => { limits = { ...limits, ...d.limits }; renderLimitHint() }).catch(() => { }); renderLimitHint();
    socket = io({ auth: cb => cb({ token, status: currentStatus() }) });
    socket.on('connect', () => { sentStatus = null; syncStatus(); setConn(true); if (view?.kind === 'channel') socket.emit('channel:join', { channelId: view.id }); if (activeServer) loadMembers(false) });
    socket.on('disconnect', () => setConn(false));
    socket.on('connect_error', () => { setConn(false); toast('Connection issue. Please sign in again.') });
    socket.on('message:new', m => { if (view?.kind === 'channel' && m.channel_id === view.id) appendIncoming(m) });
    socket.on('dm:new', onDM);
    socket.on('channel:activity', onChannelActivity);
    socket.on('message:updated', onMessageUpdated);
    socket.on('message:deleted', onMessageDeleted);
    socket.on('reaction:update', ({ messageId, reactions }) => { const m = view?.msgs.find(x => x.id === messageId); if (m) { m.reactions = reactions; rerenderMessage(messageId) } });
    socket.on('channel:created', ({ channel: c }) => { allChannels.set(c.id, c); if (c.server_id === activeServer?.id && !channels.some(x => x.id === c.id)) { channels.push(c); renderChannels() } });
    socket.on('channel:updated', ({ channel: c }) => {
      allChannels.set(c.id, { ...allChannels.get(c.id), ...c });
      const i = channels.findIndex(x => x.id === c.id); if (i >= 0) { channels[i] = { ...channels[i], ...c }; renderChannels() }
      if (view?.kind === 'channel' && view.id === c.id) { activeChannel = channels[i] || c; renderChannelHeader() }
    });
    socket.on('channel:deleted', ({ id }) => {
      allChannels.delete(id); channels = channels.filter(c => c.id !== id); renderChannels();
      if (view?.kind === 'channel' && view.id === id) { toast('That channel was deleted 🧹'); selectChannel(channels[0]) }
    });
    socket.on('server:updated', ({ id, name }) => { const s = servers.find(x => x.id === id); if (s) { s.name = name; renderServers(); if (activeServer?.id === id) $('serverName').textContent = name } });
    socket.on('members:changed', ({ serverId }) => { if (serverId === activeServer?.id) loadMembers(false) });
    socket.on('typing', onTyping);
    socket.on('presence:update', ({ userId, status }) => setPresence(userId, status));
    socket.on('app:error', toast);
    socket.on('voice:peer-joined', peerJoined); socket.on('voice:peer-left', peerLeft); socket.on('voice:signal', handleSignal);
    if (matchMedia('(max-width:1000px)').matches) $('app').classList.add('no-members');
    await loadDMs();
    await loadServers();
    loadFriends();
    const invite = new URLSearchParams(location.search).get('invite');
    if (invite) { await joinByCode(invite); history.replaceState({}, '', location.pathname) }
    maybeOfferDesktopNotifications();
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
function onFocusChange() {
  syncStatus();
  if (document.hasFocus()) { if (view && isNearBottom()) markRead(viewKey()); startPendingNotifTimers() }
}
addEventListener('focus', onFocusChange); addEventListener('blur', onFocusChange); document.addEventListener('visibilitychange', onFocusChange);
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

/* ==========================================================================
   UNREAD TRACKING — dots for unread chats, badges for mentions & DMs.
   "Last read" is remembered per device in localStorage.
   ========================================================================== */
const keyOf = (kind, id) => (kind === 'dm' ? 'd:' : 'c:') + id;
const viewKey = () => view ? keyOf(view.kind, view.id) : null;
function noteActivity(key, at, seed = false) {
  const t = +new Date(at); if (!t) return;
  if (!(lastActivity.get(key) >= t)) lastActivity.set(key, t);
  if (seed && lastRead[key] === undefined) lastRead[key] = t; // first time we've seen this chat: treat its history as read
}
const isUnread = key => (lastActivity.get(key) || 0) > (lastRead[key] || 0);
function markRead(key) {
  if (!key) return;
  const t = lastActivity.get(key) || 0; let changed = false;
  if ((lastRead[key] || 0) < t) { lastRead[key] = t; changed = true }
  if (pings.has(key)) { pings.delete(key); changed = true }
  if (changed) { save('bonfireRead:' + user.id, lastRead); renderUnread() }
}
function setBadge(el, n) {
  let b = el.querySelector(':scope > .badge');
  if (!n) { b?.remove(); return }
  if (!b) { b = document.createElement('span'); b.className = 'badge'; el.append(b) }
  b.textContent = n > 99 ? '99+' : n;
}
let lastFavCount = -1;
function renderUnread() {
  const current = viewKey();
  document.querySelectorAll('#channelList .channel').forEach(b => { const k = 'c:' + b.dataset.id; b.classList.toggle('unread', k !== current && isUnread(k)); setBadge(b, k !== current && pings.get(k)) });
  document.querySelectorAll('#serverList .server-icon').forEach(b => {
    let un = false, n = 0;
    for (const c of allChannels.values()) if (c.server_id === b.dataset.id) { const k = 'c:' + c.id; if (k !== current && isUnread(k)) un = true; n += pings.get(k) || 0 }
    b.classList.toggle('unread', un); setBadge(b, n);
  });
  document.querySelectorAll('#dmList .dm-item').forEach(b => { const k = 'd:' + b.dataset.openDm; b.classList.toggle('unread', k !== current && isUnread(k)); setBadge(b, pings.get(k)) });
  let total = 0; for (const v of pings.values()) total += v;
  const any = [...lastActivity.keys()].some(k => k !== current && isUnread(k));
  document.title = (total ? `(${total}) ` : any ? '• ' : '') + 'Bonfire';
  if (total !== lastFavCount) { lastFavCount = total; setFavicon(total) }
}
const favLink = document.querySelector('link[rel=icon]'), favBase = favLink.href;
function setFavicon(n) {
  if (!n) { favLink.href = favBase; return }
  try {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    x.font = '50px serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('🔥', 28, 38);
    x.fillStyle = '#ff3b5c'; x.beginPath(); x.arc(45, 19, 17, 0, 7); x.fill();
    x.fillStyle = '#fff'; x.font = 'bold 22px sans-serif'; x.fillText(n > 9 ? '9+' : String(n), 45, 20);
    favLink.href = c.toDataURL();
  } catch { }
}

/* ---------- servers & channels ---------- */
async function loadServers() {
  const d = await api('/api/servers'); servers = d.servers;
  for (const c of d.channels || []) { allChannels.set(c.id, c); if (c.last_message_at) noteActivity('c:' + c.id, c.last_message_at, true) }
  save('bonfireRead:' + user.id, lastRead);
  if (!servers.length) { const n = await api('/api/servers', { method: 'POST', body: JSON.stringify({ name: 'Bonfire' }) }); servers = [n.server]; allChannels.set(n.channel.id, n.channel) }
  renderServers();
  // Pick up where you left off
  const last = load('bonfireLast:' + user.id, null);
  const start = servers.find(s => s.id === last?.serverId) || servers[0];
  if (last?.kind === 'dm' && last.peer) { await selectServer(start.id, { skipChannel: true }); await openDM(last.peer) }
  else await selectServer(start.id, { channelId: last?.kind === 'channel' ? last.id : null });
}
function renderServers() {
  $('serverList').innerHTML = servers.map(s => `<button class="server-icon ${s.id === activeServer?.id ? 'active' : ''}" data-id="${s.id}" data-tip="${safe(s.name)}" aria-label="${safe(s.name)}">${safe(initials(s.name))}</button>`).join('');
  document.querySelectorAll('.server-icon').forEach(b => b.onclick = () => selectServer(b.dataset.id));
  renderUnread();
}
async function selectServer(id, { channelId = null, skipChannel = false } = {}) {
  activeServer = servers.find(s => s.id === id); if (!activeServer) return;
  $('serverName').textContent = activeServer.name; renderServers(); closePopovers();
  const d = await api(`/api/servers/${id}/channels`); channels = d.channels;
  for (const c of channels) { allChannels.set(c.id, c); if (c.last_message_at) noteActivity('c:' + c.id, c.last_message_at) }
  renderChannels();
  loadMembers();
  if (skipChannel) return;
  const target = channels.find(c => c.id === channelId) || (view?.kind === 'channel' && channels.find(c => c.id === view.id)) || channels[0];
  if (view?.kind !== 'channel' || view.id !== target.id) await selectChannel(target, { keepDrawer: true });
}
function goToChannel(serverId, channelId) {
  if (activeServer?.id !== serverId) return selectServer(serverId, { channelId });
  return selectChannel(channels.find(c => c.id === channelId) || allChannels.get(channelId));
}
function renderChannels() {
  $('channelList').innerHTML = channels.map(c => `<button class="channel ${view?.kind === 'channel' && c.id === view.id ? 'active' : ''}" data-id="${c.id}"><span class="hash">#</span>${safe(c.name)}</button>`).join('');
  document.querySelectorAll('.channel').forEach(b => b.onclick = () => selectChannel(channels.find(c => c.id === b.dataset.id)));
  renderUnread();
}
function renderChannelHeader() {
  const c = activeChannel; if (!c) return;
  $('chatSigil').textContent = '#'; $('channelName').textContent = c.name;
  $('channelTopic').textContent = c.topic || (activeServer?.owner_id === user.id ? 'No topic yet — set one from the server menu ▾' : 'No topic yet — just vibes.');
  input.placeholder = 'Message #' + c.name;
}
async function selectChannel(c, { keepDrawer = false } = {}) {
  if (!c) return;
  activeDM = null; activeChannel = c;
  if (!keepDrawer) closeDrawers();
  renderChannelHeader();
  socket.emit('channel:join', { channelId: c.id });
  await loadView('channel', c.id);
}

/* ==========================================================================
   MESSAGES
   ========================================================================== */
async function loadView(kind, id) {
  saveDraft(); cancelReply(); closeMention(); editingId = null; typers.clear(); renderTyping();
  const v = view = { kind, id, msgs: [], hasMore: false, loading: true, loadingOlder: false, ticket: ++loadTicket };
  newBelow = 0; stickToBottom = true;
  restoreDraft(); renderChannels(); renderDMList(); renderMessagesAll(); updateJump();
  save('bonfireLast:' + user.id, { kind, id, serverId: activeServer?.id, peer: kind === 'dm' ? activeDM : null });
  try {
    const d = await api(kind === 'dm' ? '/api/dms/' + id : `/api/channels/${id}/messages`);
    if (view !== v) return;
    v.msgs = d.messages; v.hasMore = d.hasMore;
    if (v.msgs.length) noteActivity(viewKey(), v.msgs[v.msgs.length - 1].created_at);
  } catch (e) { toast(e.message) }
  if (view !== v) return;
  v.loading = false; renderMessagesAll(); scrollBottom(); markRead(viewKey()); maybeLoadOlder();
  if (!isMobile()) input.focus();
}
function welcomeHTML() {
  if (view.kind === 'dm') return `<div class="welcome"><div class="welcome-icon">👋</div><h2>@${safe(activeDM?.username)}</h2><p>This is the very start of your DMs with <b>@${safe(activeDM?.username)}</b>. Say hi!</p><p class="retention">🧹 Messages are cleared after ${limits.messageDays} days.</p></div><div class="dm-banner">💌 Direct messages are only visible to you two.</div>`;
  return `<div class="welcome"><div class="welcome-icon">🔥</div><h2>Welcome to #${safe(activeChannel?.name)}!</h2><p>This is the beginning of <b>#${safe(activeChannel?.name)}</b>. Say something nice.</p><p class="retention">🧹 Messages are cleared after ${limits.messageDays} days.</p></div>`;
}
function loaderState() { return view.loading || view.loadingOlder ? ['busy', 'Loading messages…'] : ['', 'Scroll up for older messages'] }
function renderMessagesAll() {
  const top = document.createElement('div');
  if (view.loading || view.hasMore) { const [cls, text] = loaderState(); top.className = 'history-loader ' + cls; top.innerHTML = `<span class="spinner"></span><span>${text}</span>` }
  else top.innerHTML = welcomeHTML();
  const nodes = [top]; let prev = null;
  for (const m of view.msgs) { nodes.push(...buildMessageNodes(m, prev)); prev = m }
  $('messages').replaceChildren(...nodes);
}
function rerenderKeepScroll() { const b = $('messages'), fromBottom = b.scrollHeight - b.scrollTop; renderMessagesAll(); b.scrollTop = b.scrollHeight - fromBottom }
const needsDivider = (m, prev) => !prev || dayKey(new Date(prev.created_at)) !== dayKey(new Date(m.created_at));
const isCompact = (m, prev) => prev && !needsDivider(m, prev) && prev.user_id === m.user_id && !m.reply && new Date(m.created_at) - new Date(prev.created_at) < 5 * 60e3;
function buildMessageNodes(m, prev, animate = false) {
  const nodes = [];
  if (needsDivider(m, prev)) { const d = document.createElement('div'); d.className = 'day-divider'; d.innerHTML = `<span>${safe(dayLabel(new Date(m.created_at)))}</span>`; nodes.push(d) }
  nodes.push(buildArticle(m, prev, animate));
  return nodes;
}
function mentionsMe(content) { return !!user && new RegExp(`(^|\\s)@${escapeRe(user.username)}(?![a-z0-9_])`, 'i').test(content || '') }
function nameOf(id) { if (id === user.id) return 'You'; return members.find(m => m.id === id)?.display_name || dmList.find(d => d.id === id)?.display_name || (activeDM?.id === id ? activeDM.display_name : 'someone') }
function buildArticle(m, prev, animate = false) {
  const n = m.display_name || 'Bonfire friend', at = new Date(m.created_at), mine = m.user_id === user?.id, compact = isCompact(m, prev);
  const pinged = !mine && (mentionsMe(m.content) || m.reply?.user_id === user.id), editing = editingId === m.id;
  const text = (m.content || '').trim();
  const jumbo = text && text.length <= 16 && /\p{Extended_Pictographic}/u.test(text) && !/[\p{L}\p{N}]/u.test(text);
  const media = mediaHTML(m);
  const el = document.createElement('article');
  el.className = 'message' + (compact ? ' compact' : '') + (mine ? ' mine' : '') + (pinged ? ' mentions-me' : '') + (editing ? ' editing' : '') + (animate ? ' new' : '');
  el.dataset.message = m.id;
  const who = `data-user="${safe(m.user_id)}" data-name="${safe(n)}"`;
  const reply = !m.reply ? '' : m.reply.deleted
    ? `<div class="reply-ref deleted"><span class="reply-curve"></span><span class="reply-snippet">Original message was deleted</span></div>`
    : `<div class="reply-ref" data-jump="${safe(m.reply.id)}"><span class="reply-curve"></span>${avatar(m.reply.display_name, 'avatar mini')}<b>${safe(m.reply.display_name)}</b><span class="reply-snippet">${safe(stripMd(m.reply.content)) || (m.reply.attachment ? '🖼️ Attachment' : '')}</span></div>`;
  const body = editing
    ? `<div class="edit-box"><textarea maxlength="4000" rows="1">${safe(m.content)}</textarea><small>Esc to <a data-act="cancel-edit">cancel</a> · Enter to <a data-act="save-edit">save</a></small></div>`
    : (m.content ? `<div class="message-text${jumbo ? ' jumbo' : ''}">${format(m.content)}${m.edited_at ? `<span class="edited" title="Edited ${safe(new Date(m.edited_at).toLocaleString())}">(edited)</span>` : ''}</div>` : '');
  const canDelete = mine || (view?.kind === 'channel' && activeServer?.owner_id === user.id);
  el.innerHTML = reply +
    (compact ? `<time class="stamp" title="${safe(at.toLocaleString())}">${time(m.created_at)}</time>` : avatar(n, 'avatar author', who)) +
    `<div class="message-body">${compact ? '' : `<div class="message-meta"><b class="author" ${who}>${safe(n)}</b><time title="${safe(at.toLocaleString())}">${time(m.created_at)}</time></div>`}${body}${media}${reactionsHTML(m)}</div>` +
    `<div class="msg-actions">${QUICK_REACTS.map(e => `<button data-act="quick" data-emoji="${e}" data-tip="React ${e}">${e}</button>`).join('')}<button data-act="react" data-tip="More reactions">😀</button><button data-act="reply" data-tip="Reply">↩️</button>${mine ? '<button data-act="edit" data-tip="Edit">✏️</button>' : ''}${m.content ? '<button data-act="copy" data-tip="Copy text">📋</button>' : ''}${canDelete ? '<button data-act="delete" class="danger" data-tip="Delete (Shift+click skips the check)">🗑️</button>' : ''}</div>`;
  el.querySelectorAll('img.message-media,video.message-media').forEach(x => {
    x.addEventListener(x.tagName === 'IMG' ? 'load' : 'loadedmetadata', () => { if (stickToBottom) scrollBottom() }, { once: true });
    // If it fails to load, ask the server whether it expired (410) — a video the browser just can't play stays as-is
    x.addEventListener('error', () => fetch(x.currentSrc || x.src, { method: 'HEAD' }).then(r => { if (r.status === 410 || r.status === 404) { m.attachment_expired = true; rerenderMessage(m.id) } }).catch(() => { }), { once: true });
  });
  return el;
}
/* Photos and videos expire: show a live countdown, then a placeholder */
function mediaHTML(m) {
  if (!m.attachment_id) return '';
  const video = String(m.mime_type || '').startsWith('video/'), exp = m.attachment_expires_at ? +new Date(m.attachment_expires_at) : 0;
  if (m.attachment_expired || (exp && exp <= Date.now())) return `<div class="media-expired">${video ? '🎬' : '🖼️'} This ${video ? 'video' : 'photo'} has expired</div>`;
  const url = '/api/uploads/' + encodeURIComponent(m.attachment_id) + '?token=' + encodeURIComponent(token);
  const el = video
    ? `<video class="message-media" controls preload="metadata" src="${url}"></video>`
    : `<a href="${url}" target="_blank" rel="noopener"><img class="message-media" loading="lazy" alt="${safe(m.filename || 'Shared image')}" src="${url}"></a>`;
  return `<div class="media-wrap">${el}${exp ? `<span class="expiry" data-exp="${exp}" data-tip="Disappears ${safe(new Date(exp).toLocaleString())}">${expiryText(exp)}</span>` : ''}</div>`;
}
function expiryText(exp) {
  const mins = Math.max(1, Math.ceil((exp - Date.now()) / 6e4)), h = Math.floor(mins / 60);
  const d = Math.floor(h / 24), part = (n, u) => n ? ` ${n}${u}` : '';
  return '⏳' + (h >= 24 ? `${part(d, 'd')}${part(h % 24, 'h')}` : h >= 1 ? `${part(h, 'h')}${part(mins % 60, 'm')}` : ` ${mins}m`) + ' left';
}
setInterval(() => {
  if (!view) return;
  document.querySelectorAll('#messages .expiry[data-exp]').forEach(b => {
    const exp = +b.dataset.exp;
    if (exp > Date.now()) { b.textContent = expiryText(exp); return }
    const m = view.msgs.find(x => x.id === b.closest('.message')?.dataset.message);
    if (m) { m.attachment_expired = true; rerenderMessage(m.id) }
  });
}, 30000);
function reactionsHTML(m) {
  if (!m.reactions?.length) return '';
  return `<div class="reactions">${m.reactions.map(r => `<button class="reaction${r.users.includes(user.id) ? ' mine' : ''}" data-react="${safe(r.emoji)}" data-tip="${safe(clip(r.users.map(nameOf).join(', '), 80))}">${r.emoji}<b>${r.users.length}</b></button>`).join('')}<button class="reaction add" data-act="react" data-tip="Add reaction">＋</button></div>`;
}
/* Tiny markdown: **bold** *italic* ~~strike~~ `code` ```blocks``` ||spoilers|| > quotes, links and @mentions */
function format(raw) {
  const keep = [], hold = html => `\u0000${keep.push(html) - 1}\u0000`;
  let s = safe(raw)
    .replace(/```(?:[a-z0-9+#-]*\n)?([\s\S]*?)```/gi, (_, code) => hold(`<pre class="code-block"><code>${code.replace(/^\n+|\n+$/g, '')}</code></pre>`))
    .replace(/`([^`\n]+)`/g, (_, code) => hold(`<code class="inline-code">${code}</code>`))
    .replace(/(https?:\/\/[^\s<]+[^\s<.,!?;:)\]'"])/g, url => hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`));
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+?)~~/g, '<s>$1</s>')
    .replace(/\|\|([^|\n]+?)\|\|/g, '<span class="spoiler" title="Click to reveal">$1</span>')
    .replace(/(^|\s)@([a-z0-9_]{3,24})(?![a-z0-9_])/gi, (_, pre, name) => `${pre}<span class="mention${name.toLowerCase() === user.username ? ' self' : ''}" data-mention="${name.toLowerCase()}">@${name}</span>`);
  s = s.split('\n').map(line => line.startsWith('&gt; ') ? `<span class="quote">${line.slice(5)}</span>` : line).join('\n');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[i]);
}
function findMsgEl(id) { return $('messages').querySelector(`.message[data-message="${CSS.escape(id)}"]`) }
function rerenderMessage(id) {
  if (!view) return;
  const i = view.msgs.findIndex(m => m.id === id), old = findMsgEl(id); if (i < 0 || !old) return;
  const keep = stickToBottom, el = buildArticle(view.msgs[i], view.msgs[i - 1]);
  if (old.classList.contains('active')) el.classList.add('active');
  old.replaceWith(el);
  if (keep) scrollBottom();
}
function appendIncoming(m) {
  if (!view || view.msgs.some(x => x.id === m.id)) return;
  const mine = m.user_id === user.id, near = isNearBottom(), prev = view.msgs[view.msgs.length - 1];
  view.msgs.push(m);
  if (!view.loading) $('messages').append(...buildMessageNodes(m, prev, true));
  noteActivity(viewKey(), m.created_at);
  typers.delete(m.user_id); renderTyping();
  if (mine || near) scrollBottom(true); else { newBelow++; updateJump(); blip('boop') }
  if (document.hasFocus() && (mine || near)) markRead(viewKey());
}
function onMessageUpdated(m) {
  const i = view?.msgs.findIndex(x => x.id === m.id); if (i == null || i < 0) return;
  view.msgs[i] = m; if (editingId !== m.id) rerenderMessage(m.id);
}
function onMessageDeleted({ id }) {
  if (replyTo?.id === id) cancelReply();
  if (editingId === id) editingId = null;
  const v = view, el = findMsgEl(id); if (!v || !v.msgs.some(m => m.id === id)) return;
  const drop = () => { if (view !== v) return; v.msgs = v.msgs.filter(m => m.id !== id); rerenderKeepScroll() };
  if (el && !reduceMotion) { el.classList.add('poof'); setTimeout(drop, 280) } else drop();
}

/* ---------- scroll: stick to bottom, jump button, infinite history ---------- */
function isNearBottom() { const b = $('messages'); return b.scrollHeight - b.scrollTop - b.clientHeight < 140 }
function scrollBottom(smooth = false) {
  const b = $('messages');
  if (smooth && !reduceMotion) b.scrollTo({ top: b.scrollHeight, behavior: 'smooth' }); else b.scrollTop = b.scrollHeight;
  newBelow = 0; stickToBottom = true; updateJump();
}
function updateJump() {
  const show = newBelow > 0 || !isNearBottom();
  $('jumpBtn').classList.toggle('hidden', !show);
  $('jumpText').textContent = newBelow ? `${newBelow} new message${newBelow > 1 ? 's' : ''}` : 'Jump to latest';
}
$('messages').addEventListener('scroll', () => {
  stickToBottom = isNearBottom();
  if (stickToBottom) { newBelow = 0; if (document.hasFocus()) markRead(viewKey()) }
  updateJump(); maybeLoadOlder();
}, { passive: true });
$('jumpBtn').onclick = () => scrollBottom(true);
function maybeLoadOlder() { if (view?.hasMore && !view.loading && !view.loadingOlder && $('messages').scrollTop < 300) loadOlder() }
async function loadOlder() {
  const v = view; if (!v?.hasMore || v.loadingOlder || v.loading || !v.msgs.length) return;
  v.loadingOlder = true;
  const loader = $('messages').firstElementChild; if (loader?.classList.contains('history-loader')) { loader.classList.add('busy'); loader.lastElementChild.textContent = 'Loading messages…' }
  try {
    const d = await api((v.kind === 'dm' ? '/api/dms/' + v.id : `/api/channels/${v.id}/messages`) + '?before=' + encodeURIComponent(v.msgs[0].id));
    if (view !== v) return;
    v.msgs = [...d.messages.filter(m => !v.msgs.some(x => x.id === m.id)), ...v.msgs]; v.hasMore = d.hasMore;
  } catch (e) { toast(e.message) }
  finally { v.loadingOlder = false }
  if (view === v) { rerenderKeepScroll(); requestAnimationFrame(maybeLoadOlder) }
}
async function jumpTo(id) {
  let el = findMsgEl(id);
  for (let tries = 0; !el && view?.hasMore && tries < 15; tries++) { await loadOlder(); el = findMsgEl(id) }
  if (!el) { toast("Couldn't find that message 🕵️"); return }
  el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

/* ---------- message actions: react, reply, edit, copy, delete ---------- */
$('messages').addEventListener('click', e => {
  const art = e.target.closest('.message'), act = e.target.closest('[data-act]');
  if (act && art) return messageAction(act.dataset.act, art.dataset.message, act, e);
  const r = e.target.closest('[data-react]'); if (r && art) return toggleReaction(art.dataset.message, r.dataset.react);
  const j = e.target.closest('[data-jump]'); if (j) return jumpTo(j.dataset.jump);
  const sp = e.target.closest('.spoiler:not(.revealed)'); if (sp) return sp.classList.add('revealed');
  const men = e.target.closest('.mention'); if (men) { const m = members.find(x => x.username === men.dataset.mention); if (m) openUser(m.id, m.display_name, m.username); return }
  const img = e.target.closest('img.message-media'); if (img && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); return openLightbox(img.src, img.alt) }
  // Touch screens have no hover, so a tap shows the action bar
  if (art && matchMedia('(hover:none)').matches && !e.target.closest('a,video,.author,textarea,.reaction')) {
    document.querySelectorAll('.message.active').forEach(x => x !== art && x.classList.remove('active')); art.classList.toggle('active');
  }
});
$('messages').addEventListener('dblclick', e => {
  const art = e.target.closest('.message');
  if (!art || e.target.closest('a,video,textarea,.msg-actions,.reaction,.author,.reply-ref')) return;
  window.getSelection()?.removeAllRanges();
  toggleReaction(art.dataset.message, '❤️');
  sparks(e.clientX, e.clientY, 10, { emoji: ['❤️', '💖', '✨'], spread: 1.4 });
});
function messageAction(act, id, btn, e) {
  const m = view?.msgs.find(x => x.id === id); if (!m) return;
  if (act === 'quick') toggleReaction(id, btn.dataset.emoji);
  else if (act === 'react') openReactPicker(id, btn);
  else if (act === 'reply') startReply(m);
  else if (act === 'edit') startEdit(id);
  else if (act === 'copy') navigator.clipboard?.writeText(m.content).then(() => toast('Copied 📋'), () => toast("Couldn't copy"));
  else if (act === 'delete') deleteMessage(m, e.shiftKey);
  else if (act === 'cancel-edit') cancelEdit();
  else if (act === 'save-edit') saveEdit(id, findMsgEl(id)?.querySelector('.edit-box textarea')?.value ?? m.content);
}
function toggleReaction(id, emoji) { socket.emit('reaction:toggle', { messageId: id, emoji }) }
function openReactPicker(id, btn) {
  reactTarget = id; const pop = $('reactPop'); pop.classList.remove('hidden');
  const r = btn.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
  pop.style.top = (r.top - h - 8 > 8 ? r.top - h - 8 : r.bottom + 8) + 'px';
}
$('reactPop').innerHTML = EMOJIS.map(e => `<button type="button" data-emoji="${e}">${e}</button>`).join('');
$('reactPop').onclick = e => { const b = e.target.closest('[data-emoji]'); if (!b || !reactTarget) return; toggleReaction(reactTarget, b.dataset.emoji); $('reactPop').classList.add('hidden') };

function startReply(m) {
  replyTo = { id: m.id, name: m.display_name, content: m.content, attachment: !!m.attachment_id };
  renderReplyBar(); input.focus();
}
function cancelReply() { replyTo = null; renderReplyBar() }
function renderReplyBar() {
  $('replyBar').innerHTML = replyTo ? `<span>↩️ Replying to <b>${safe(replyTo.name)}</b></span><span class="reply-snippet">${safe(stripMd(replyTo.content)) || (replyTo.attachment ? '🖼️ Attachment' : '')}</span><button type="button" class="icon-btn" id="cancelReply" aria-label="Cancel reply" data-tip="Cancel (Esc)">✕</button>` : '';
  if (replyTo) $('cancelReply').onclick = cancelReply;
}
function startEdit(id) {
  const m = view?.msgs.find(x => x.id === id); if (!m || m.user_id !== user.id) return;
  if (editingId && editingId !== id) { const prev = editingId; editingId = null; rerenderMessage(prev) }
  editingId = id; rerenderMessage(id);
  const ta = findMsgEl(id)?.querySelector('.edit-box textarea'); if (!ta) return;
  autosizeEl(ta, 300); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); ta.scrollIntoView({ block: 'nearest' });
}
function saveEdit(id, value) {
  const m = view?.msgs.find(x => x.id === id); if (!m) return;
  const v = value.trim();
  if (v === (m.content || '').trim()) return cancelEdit();
  if (!v && !m.attachment_id) { cancelEdit(); return deleteMessage(m) }
  socket.emit('message:edit', { id, content: v });
  m.content = v; m.edited_at = new Date().toISOString(); editingId = null; rerenderMessage(id); input.focus();
}
function cancelEdit() { const id = editingId; editingId = null; if (id) rerenderMessage(id); input.focus() }
$('messages').addEventListener('keydown', e => {
  const ta = e.target.closest('.edit-box textarea'); if (!ta) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit() }
  else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); saveEdit(ta.closest('.message').dataset.message, ta.value) }
});
$('messages').addEventListener('input', e => { if (e.target.matches('.edit-box textarea')) autosizeEl(e.target, 300) });
async function deleteMessage(m, skipConfirm = false) {
  if (!skipConfirm) {
    const ok = await ask({ title: 'Delete this message?', hint: m.content ? `“${clip(stripMd(m.content), 120)}”` : 'The attachment will be gone for good.', emoji: '🗑️', ok: 'Delete', input: false, danger: true });
    if (!ok) return;
  }
  socket.emit('message:delete', { id: m.id });
}

/* ---------- lightbox ---------- */
function openLightbox(src, alt) { $('lightImg').src = src; $('lightImg').alt = alt || ''; $('lightOpen').href = src; $('lightbox').classList.remove('hidden') }
function closeLightbox() { $('lightbox').classList.add('hidden'); $('lightImg').removeAttribute('src') }
$('lightbox').onclick = e => { if (!e.target.closest('a')) closeLightbox() };

/* ==========================================================================
   COMPOSER
   ========================================================================== */
function autosizeEl(el, max) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, max) + 'px' }
function autosize() { autosizeEl(input, 180) }
function updateCharCount() {
  const n = input.value.length, el = $('charCount');
  el.classList.toggle('hidden', n < 3500); el.classList.toggle('warn', n > 3900); el.textContent = `${4000 - n} left`;
}
let draftTimer;
input.addEventListener('input', () => { autosize(); sendTyping(); updateMentionPop(); updateCharCount(); clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 400) });
input.addEventListener('click', updateMentionPop);
input.addEventListener('keyup', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') updateMentionPop() });
input.addEventListener('blur', () => setTimeout(closeMention, 150));
input.addEventListener('keydown', e => {
  if (mention) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); mention.index = (mention.index + (e.key === 'ArrowDown' ? 1 : -1) + mention.items.length) % mention.items.length; renderMentionPop(); return }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(mention.index); return }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMention(); return }
  }
  if (e.key === 'Escape' && replyTo) { e.preventDefault(); e.stopPropagation(); cancelReply(); return }
  if (e.key === 'ArrowUp' && !input.value && !e.altKey) {
    const last = [...(view?.msgs || [])].reverse().find(m => m.user_id === user.id);
    if (last) { e.preventDefault(); startEdit(last.id) }
    return;
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('composer').requestSubmit() }
});
input.addEventListener('paste', e => { const f = [...(e.clipboardData?.files || [])][0]; if (f) { e.preventDefault(); setFile(f) } });

/* drafts: whatever you half-typed stays put per channel/DM, even across reloads */
function saveDraft() {
  const k = viewKey(); if (!k || !user) return;
  if (input.value.trim()) drafts[k] = input.value; else delete drafts[k];
  save('bonfireDrafts:' + user.id, drafts);
}
function restoreDraft() { input.value = drafts[viewKey()] || ''; autosize(); updateCharCount() }
addEventListener('beforeunload', saveDraft);

/* @mention autocomplete */
function updateMentionPop() {
  const pos = input.selectionStart, mt = input.value.slice(0, pos).match(/(^|\s)@([a-z0-9_]{0,24})$/i);
  if (!mt || !view) return closeMention();
  const q = mt[2].toLowerCase();
  const pool = view.kind === 'dm' ? [activeDM] : members;
  const items = pool.filter(m => m && m.id !== user.id && m.username && (m.username.startsWith(q) || m.display_name.toLowerCase().includes(q))).slice(0, 8);
  if (!items.length) return closeMention();
  mention = { start: pos - q.length - 1, end: pos, items, index: Math.min(mention?.index || 0, items.length - 1) };
  renderMentionPop();
}
function renderMentionPop() {
  $('mentionPop').classList.remove('hidden');
  $('mentionPop').innerHTML = '<div class="label">MENTION SOMEONE</div>' + mention.items.map((m, i) => `<button type="button" class="mention-item${i === mention.index ? ' on' : ''}" data-i="${i}">${avatar(m.display_name)}<b>${safe(m.display_name)}</b><small>@${safe(m.username)}</small></button>`).join('');
}
function pickMention(i) {
  const m = mention.items[i], tag = '@' + m.username + ' ';
  input.value = input.value.slice(0, mention.start) + tag + input.value.slice(mention.end);
  const caret = mention.start + tag.length; closeMention(); input.focus(); input.setSelectionRange(caret, caret); autosize();
}
function closeMention() { mention = null; $('mentionPop').classList.add('hidden') }
$('mentionPop').addEventListener('mousedown', e => { e.preventDefault(); const b = e.target.closest('[data-i]'); if (b) pickMention(+b.dataset.i) });

function setFile(f) {
  if (selectedPreviewUrl) URL.revokeObjectURL(selectedPreviewUrl);
  selectedFile = f || null; selectedPreviewUrl = null;
  if (!f) { $('uploadPreview').innerHTML = ''; $('fileInput').value = ''; return }
  if (!/^(image\/(png|jpeg|gif|webp)|video\/(mp4|webm|quicktime))$/.test(f.type)) { toast('Only PNG, JPG, GIF, WebP, MP4, WebM or MOV'); selectedFile = null; return }
  const video = f.type.startsWith('video/'), maxMB = video ? limits.videoMaxMB : limits.photoMaxMB;
  if (f.size > maxMB * 1024 * 1024) { toast(`${video ? 'Videos' : 'Photos'} can be up to ${maxMB} MB — that one is ${(Math.ceil(f.size / 104857.6) / 10).toFixed(1)} MB`); shake($('composer')); selectedFile = null; $('fileInput').value = ''; return }
  selectedPreviewUrl = URL.createObjectURL(f);
  const thumb = f.type.startsWith('image/') ? `<img src="${selectedPreviewUrl}" alt="">` : '<div class="vid">🎬</div>';
  const size = f.size > 1048576 ? (f.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(f.size / 1024)) + ' KB';
  $('uploadPreview').innerHTML = `<div class="upload-chip">${thumb}<span>${safe(f.name)}<small>${size} · disappears ${hoursText(video ? limits.videoHours : limits.photoHours)} after sending</small></span><button type="button" class="icon-btn" id="clearFile" aria-label="Remove file">✕</button></div>`;
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
  if (!view || sending) return; sending = true;
  const send = document.querySelector('.send');
  try {
    const attachmentId = await uploadSelected(), reply = replyTo?.id || null;
    if (view.kind === 'dm') socket.emit('dm:send', { toUserId: view.id, content, attachmentId, replyTo: reply });
    else socket.emit('message:send', { channelId: view.id, content, attachmentId, replyTo: reply });
    input.value = ''; autosize(); updateCharCount(); lastTypingSent = 0; cancelReply(); saveDraft();
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

/* typing indicator */
function sendTyping() {
  if (!socket || !view || !input.value.trim() || Date.now() - lastTypingSent < 2500) return;
  lastTypingSent = Date.now();
  socket.emit('typing', view.kind === 'dm' ? { toUserId: view.id } : { channelId: view.id });
}
function onTyping({ userId, name, channelId, dmFrom } = {}) {
  if (userId === user.id || !view) return;
  const relevant = view.kind === 'dm' ? dmFrom === view.id : channelId === view.id;
  if (!relevant) return;
  typers.set(userId, { name, until: Date.now() + 4000 }); renderTyping();
}
function renderTyping() {
  const now = Date.now(); for (const [k, v] of typers) if (v.until < now) typers.delete(k);
  const names = [...typers.values()].map(v => v.name);
  $('typing').innerHTML = names.length ? `<span class="dots"><i></i><i></i><i></i></span><span><b>${safe(names.slice(0, 2).join(', '))}</b>${names.length > 2 ? ` +${names.length - 2}` : ''} ${names.length > 1 ? 'are' : 'is'} typing…</span>` : '';
}
setInterval(() => { if (typers.size) renderTyping() }, 1000);

/* ==========================================================================
   SERVERS: create / join / invite / server menu
   ========================================================================== */
$('addServer').onclick = async () => {
  const name = await ask({ title: 'Start a new server', hint: 'Give your corner of the internet a name.', placeholder: 'e.g. Snack Club', emoji: '🏕️', ok: 'Create' });
  if (!name) return;
  try {
    const d = await api('/api/servers', { method: 'POST', body: JSON.stringify({ name }) });
    servers.push(d.server); allChannels.set(d.channel.id, d.channel); renderServers(); await selectServer(d.server.id);
    toast('Server created 🎉'); sparks(innerWidth / 2, innerHeight / 2, 30, { emoji: ['🎉', '🔥', '✨'], spread: 3 });
  } catch (e) { toast(e.message) }
};
async function createChannel() {
  if (!activeServer) return;
  const name = await ask({ title: 'New text channel', hint: 'Lowercase, dashes instead of spaces.', placeholder: 'e.g. memes', emoji: '#️⃣', ok: 'Create' });
  if (!name) return;
  try {
    const d = await api(`/api/servers/${activeServer.id}/channels`, { method: 'POST', body: JSON.stringify({ name }) });
    allChannels.set(d.channel.id, d.channel); if (!channels.some(c => c.id === d.channel.id)) channels.push(d.channel);
    renderChannels(); await selectChannel(d.channel); toast('Channel created ✨');
  } catch (e) { toast(e.message) }
}
$('addChannel').onclick = createChannel;
async function copyInvite() {
  if (!activeServer) return;
  const url = location.origin + location.pathname + '?invite=' + activeServer.invite_code;
  try { await navigator.clipboard.writeText(url); toast('Invite link copied — share it with friends 🔗') }
  catch { await ask({ title: 'Copy this invite link', value: url, emoji: '🔗', ok: 'Done' }) }
}
$('invite').onclick = copyInvite;
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

function closePopovers() {
  ['emojiPop', 'reactPop', 'serverMenu', 'notifPop'].forEach(id => $(id).classList.add('hidden'));
  $('serverMenuBtn').classList.remove('open');
}
document.addEventListener('click', e => {
  // composedPath() still knows where the click happened even if that element re-rendered away
  const path = e.composedPath(), inside = sel => path.some(n => n.matches?.(sel));
  if (!inside('#emojiPop,#emojiBtn')) $('emojiPop').classList.add('hidden');
  if (!inside('#reactPop,[data-act="react"]')) $('reactPop').classList.add('hidden');
  if (!inside('#serverMenu,#serverMenuBtn')) { $('serverMenu').classList.add('hidden'); $('serverMenuBtn').classList.remove('open') }
  if (!inside('#notifPop,#notifBtn')) $('notifPop').classList.add('hidden');
});
$('serverMenuBtn').onclick = () => {
  const menu = $('serverMenu'), open = menu.classList.contains('hidden');
  closePopovers(); if (!open || !activeServer) return;
  const owner = activeServer.owner_id === user.id, ch = view?.kind === 'channel' ? activeChannel : null;
  const items = [
    ['🔗', 'Copy invite link', copyInvite],
    ['#️⃣', 'Create channel', createChannel],
    ['✅', 'Mark server as read', markServerRead],
    owner && ch && ['📝', `Edit #${ch.name} topic`, editTopic],
    owner && ch && ['✏️', `Rename #${ch.name}`, renameChannel],
    owner && ['🏷️', 'Rename server', renameServer],
    owner && ch && channels.length > 1 && ['🗑️', `Delete #${ch.name}`, deleteChannel, 'danger'],
    !owner && ['🚪', 'Leave server', leaveServer, 'danger']
  ].filter(Boolean);
  menu.innerHTML = items.map(([icon, label, , cls], i) => `<button class="${cls || ''}" data-i="${i}">${icon} ${safe(label)}</button>`).join('');
  menu.querySelectorAll('button').forEach(b => b.onclick = () => { closePopovers(); items[+b.dataset.i][2]() });
  menu.classList.remove('hidden'); $('serverMenuBtn').classList.add('open');
};
function markServerRead() { for (const c of allChannels.values()) if (c.server_id === activeServer.id) markRead('c:' + c.id); toast('All caught up ✅') }
async function editTopic() {
  const topic = await ask({ title: `Topic for #${activeChannel.name}`, hint: 'Shown under the channel name. Leave empty to clear.', value: activeChannel.topic || '', placeholder: 'What is this channel for?', emoji: '📝', ok: 'Save', allowEmpty: true });
  if (topic === null) return;
  try { await api('/api/channels/' + activeChannel.id, { method: 'PATCH', body: JSON.stringify({ topic }) }); toast('Topic updated 📝') } catch (e) { toast(e.message) }
}
async function renameChannel() {
  const name = await ask({ title: `Rename #${activeChannel.name}`, value: activeChannel.name, emoji: '✏️', ok: 'Rename' });
  if (!name) return;
  try { await api('/api/channels/' + activeChannel.id, { method: 'PATCH', body: JSON.stringify({ name }) }) } catch (e) { toast(e.message) }
}
async function renameServer() {
  const name = await ask({ title: 'Rename server', value: activeServer.name, emoji: '🏷️', ok: 'Rename' });
  if (!name) return;
  try { await api('/api/servers/' + activeServer.id, { method: 'PATCH', body: JSON.stringify({ name }) }) } catch (e) { toast(e.message) }
}
async function deleteChannel() {
  const ch = activeChannel;
  if (!await ask({ title: `Delete #${ch.name}?`, hint: 'Every message in it goes too. This cannot be undone.', emoji: '🗑️', ok: 'Delete channel', input: false, danger: true })) return;
  try { await api('/api/channels/' + ch.id, { method: 'DELETE' }) } catch (e) { toast(e.message) }
}
async function leaveServer() {
  const s = activeServer;
  if (!await ask({ title: `Leave ${s.name}?`, hint: "You'll need an invite to get back in.", emoji: '🚪', ok: 'Leave', input: false, danger: true })) return;
  try {
    await api(`/api/servers/${s.id}/leave`, { method: 'POST' });
    servers = servers.filter(x => x.id !== s.id); for (const c of [...allChannels.values()]) if (c.server_id === s.id) allChannels.delete(c.id);
    toast(`Left ${s.name} 👋`);
    if (servers.length) { renderServers(); await selectServer(servers[0].id) } else { activeServer = null; await loadServers() }
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

/* ==========================================================================
   DMs + FRIENDS
   ========================================================================== */
/* Click anyone (member list, message avatar or name, @mention) to jump into a DM with them */
function openUser(id, name, username) {
  if (!id) return;
  if (id === user.id) { toast("That's you! Talking to yourself is free though 🪞"); return }
  const m = members.find(x => x.id === id) || dmList.find(x => x.id === id);
  openDM({ id, display_name: name || m?.display_name || 'friend', username: username || m?.username || name || m?.display_name });
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-user]'); if (!t) return;
  openUser(t.dataset.user, t.dataset.name, t.dataset.username);
});
async function loadDMs() {
  try {
    const d = await api('/api/dms'); dmList = d.conversations;
    for (const c of dmList) { presence.set(c.id, c.status); noteActivity('d:' + c.id, c.last_message_at, true) }
    save('bonfireRead:' + user.id, lastRead); renderDMList();
  } catch { }
}
function renderDMList() {
  $('dmList').innerHTML = dmList.length
    ? dmList.map(c => `<button class="dm-item${view?.kind === 'dm' && view.id === c.id ? ' active' : ''}" data-open-dm="${safe(c.id)}">${avatarWithStatus(c.display_name, c.id)}<span>${safe(c.display_name)}</span></button>`).join('')
    : '<p class="dm-empty">Click anyone to start a DM 💬</p>';
  renderUnread();
}
$('dmList').onclick = e => { const b = e.target.closest('[data-open-dm]'); if (!b) return; const c = dmList.find(x => x.id === b.dataset.openDm); if (c) openDM(c) };
$('newDM').onclick = () => openSwitcher('@');
function upsertDM(peer, at) {
  const old = dmList.find(d => d.id === peer.id);
  dmList = [{ ...old, ...peer, last_message_at: at }, ...dmList.filter(d => d.id !== peer.id)];
}
function onDM(m) {
  const mine = m.sender_id === user.id, other = mine ? m.recipient_id : m.sender_id, k = 'd:' + other;
  const peer = mine ? (activeDM?.id === other ? activeDM : dmList.find(d => d.id === other)) : { id: other, username: m.username, display_name: m.display_name };
  if (peer) upsertDM({ id: peer.id, username: peer.username, display_name: peer.display_name }, m.created_at);
  noteActivity(k, m.created_at);
  const inView = view?.kind === 'dm' && view.id === other;
  if (inView) appendIncoming(m);
  if (mine || (inView && document.hasFocus())) { if (mine || isNearBottom()) markRead(k); renderDMList(); return }
  pings.set(k, (pings.get(k) || 0) + 1); renderDMList();
  notify({ kind: 'dm', title: m.display_name, body: m.content || '📎 Sent an attachment', who: m.display_name, open: () => openUser(m.sender_id, m.display_name, m.username) });
}
function onChannelActivity(a) {
  const k = 'c:' + a.channelId;
  if (!allChannels.has(a.channelId)) allChannels.set(a.channelId, { id: a.channelId, server_id: a.serverId, name: 'channel' });
  noteActivity(k, a.at);
  const inView = viewKey() === k;
  if (a.userId === user.id) { markRead(k); return }
  if (inView && document.hasFocus()) { if (isNearBottom()) markRead(k); return } // you're looking right at it
  const pinged = mentionsMe(a.content) || a.replyUserId === user.id;
  if (pinged) pings.set(k, (pings.get(k) || 0) + 1);
  renderUnread();
  const ch = allChannels.get(a.channelId)?.name, srv = servers.find(s => s.id === a.serverId)?.name || '';
  notify({
    kind: pinged ? 'mention' : 'message',
    title: pinged ? `${a.name} mentioned you in #${ch}` : `${a.name} in #${ch}`,
    body: (a.content || '📎 Sent an attachment') + (srv ? `\n· ${srv}` : ''),
    who: a.name, open: () => goToChannel(a.serverId, a.channelId)
  });
}

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
async function openDM(peer) {
  activeDM = { id: peer.id, username: peer.username || peer.display_name, display_name: peer.display_name || peer.username };
  activeChannel = null;
  closeFriends(); closeDrawers(); closeSwitcher();
  $('chatSigil').textContent = '@'; $('channelName').textContent = activeDM.username; renderDMTopic();
  input.placeholder = 'Message @' + activeDM.username;
  await loadView('dm', activeDM.id);
}

/* ==========================================================================
   NOTIFICATIONS — in-app cards, desktop pop-ups, and a loud chime
   ========================================================================== */
let notifyPrefs = { level: 'mentions', desktop: false, sound: true, volume: .8, ...load('bonfireNotify', {}) };
const canDesktop = () => 'Notification' in window && Notification.permission === 'granted';
function saveNotify() { save('bonfireNotify', notifyPrefs); renderNotifBtn() }
function renderNotifBtn() { $('notifBtn').textContent = notifyPrefs.level === 'none' ? '🔕' : '🔔'; $('notifBtn').dataset.tip = { all: 'Notifying: every message', mentions: 'Notifying: DMs & @mentions', none: 'Notifications off' }[notifyPrefs.level] }
renderNotifBtn();
/* kind: 'dm' | 'mention' | 'message'. "message" only alerts when you've chosen "Everything". */
function notify({ kind, title, body, who, open, quiet = false }) {
  if (notifyPrefs.level === 'none' || (kind === 'message' && notifyPrefs.level !== 'all') || quiet) return;
  chime(kind);
  const focused = document.hasFocus();
  if (!focused && notifyPrefs.desktop && canDesktop()) {
    try {
      const n = new Notification(title, { body: clip(body, 180), icon: favLink.href, tag: 'bonfire-' + kind + '-' + (who || ''), renotify: true });
      n.onclick = () => { focus(); open?.(); n.close() };
    } catch { }
  }
  notifCard({ kind, title, body, who, open });
}
function notifCard({ kind, title, body, who, open, action }) {
  const stack = $('notifStack');
  while (stack.children.length >= 4) stack.firstElementChild.remove();
  const card = document.createElement('div');
  card.className = 'notif-card ' + (kind || '');
  card.innerHTML = (who ? avatar(who) : `<div class="ico">${kind === 'setup' ? '🔔' : '🔥'}</div>`) +
    `<div class="txt"><b>${safe(title)}</b><p>${safe(clip(stripMd(body), 220))}</p>${action ? `<button class="btn primary">${safe(action.label)}</button>` : ''}</div><button class="x" aria-label="Dismiss">✕</button><i class="bar"></i>`;
  const dismiss = () => { if (card.classList.contains('out')) return; card.classList.add('out'); setTimeout(() => card.remove(), 300) };
  card.querySelector('.x').onclick = e => { e.stopPropagation(); dismiss() };
  if (action) card.querySelector('.btn').onclick = e => { e.stopPropagation(); dismiss(); action.fn() };
  card.onclick = () => { dismiss(); open?.() };
  card.dismiss = dismiss; card.life = action ? 15000 : 7000;
  stack.append(card);
  // The countdown only starts while you're looking, so nothing disappears while you're tabbed out
  if (document.hasFocus()) startNotifTimer(card); else card.dataset.pending = '1';
}
function startNotifTimer(card) {
  delete card.dataset.pending;
  card.querySelector('.bar').style.animation = `drain ${card.life}ms linear forwards`;
  setTimeout(card.dismiss, card.life);
}
function startPendingNotifTimers() { document.querySelectorAll('.notif-card[data-pending]').forEach(startNotifTimer) }
async function enableDesktop() {
  if (!('Notification' in window)) { toast("This browser doesn't support desktop notifications"); return false }
  const p = await Notification.requestPermission();
  notifyPrefs.desktop = p === 'granted'; saveNotify(); renderNotifPop();
  toast(p === 'granted' ? 'Desktop notifications on 🔔' : 'Your browser blocked notifications — allow them in the site settings');
  return p === 'granted';
}
function maybeOfferDesktopNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'default' || load('bonfireAskedNotify:' + user.id, false)) return;
  save('bonfireAskedNotify:' + user.id, true);
  setTimeout(() => notifCard({ kind: 'setup', title: 'Want desktop notifications?', body: 'Get a pop-up and a chime for DMs and @mentions, even when Bonfire is in the background.', action: { label: 'Turn on 🔔', fn: enableDesktop } }), 1500);
}
function renderNotifPop() {
  const p = notifyPrefs, seg = (v, label) => `<button class="${p.level === v ? 'on' : ''}" data-level="${v}">${label}</button>`;
  $('notifPop').innerHTML = `<h3>🔔 Notifications</h3>
    <div class="label">NOTIFY ME ABOUT</div>
    <div class="seg">${seg('all', 'Everything')}${seg('mentions', 'DMs & @me')}${seg('none', 'Nothing')}</div>
    <div class="label">HOW</div>
    <button class="switch-row ${p.desktop && canDesktop() ? 'on' : ''}" data-toggle="desktop">Desktop pop-ups<i></i></button>
    <button class="switch-row ${p.sound ? 'on' : ''}" data-toggle="sound">Notification chime<i></i></button>
    <div class="vol-row"><span>🔈</span><input type="range" min="0.1" max="1" step="0.05" value="${p.volume}" id="volSlider" aria-label="Chime volume"><span>🔊</span></div>
    <button class="btn secondary" id="testChime">Test chime 🎵</button>`;
  $('notifPop').querySelectorAll('[data-level]').forEach(b => b.onclick = () => { notifyPrefs.level = b.dataset.level; saveNotify(); renderNotifPop() });
  $('notifPop').querySelector('[data-toggle="desktop"]').onclick = async () => {
    if (notifyPrefs.desktop && canDesktop()) { notifyPrefs.desktop = false; saveNotify(); renderNotifPop() } else await enableDesktop();
  };
  $('notifPop').querySelector('[data-toggle="sound"]').onclick = () => { notifyPrefs.sound = !notifyPrefs.sound; saveNotify(); renderNotifPop(); if (notifyPrefs.sound) chime('mention') };
  $('volSlider').oninput = e => { notifyPrefs.volume = +e.target.value; saveNotify() };
  $('volSlider').onchange = () => chime('mention', true);
  $('testChime').onclick = () => { chime('dm', true); notifCard({ kind: 'dm', title: 'This is what a DM looks like', body: 'Hey! 👋 You can click me to open the chat.', who: user.display_name }) };
}
$('notifBtn').onclick = () => { const open = $('notifPop').classList.contains('hidden'); closePopovers(); if (open) { renderNotifPop(); $('notifPop').classList.remove('hidden') } };

/* ==========================================================================
   QUICK SWITCHER (Ctrl/Cmd+K)
   ========================================================================== */
let switchItems = [], switchIndex = 0;
function openSwitcher(prefill = '') { closePopovers(); $('switcher').classList.remove('hidden'); $('switchInput').value = prefill; renderSwitcher(); setTimeout(() => $('switchInput').focus(), 30) }
function closeSwitcher() { $('switcher').classList.add('hidden') }
function buildSwitchItems(raw) {
  const q = raw.trim().toLowerCase(), only = q[0] === '#' ? 'channel' : q[0] === '@' ? 'person' : null, term = q.replace(/^[#@]/, '');
  const items = [];
  if (only !== 'person') for (const c of allChannels.values()) {
    const s = servers.find(x => x.id === c.server_id); if (!s) continue;
    items.push({ kind: 'channel', label: '#' + c.name, sub: s.name, key: 'c:' + c.id, text: c.name + ' ' + s.name.toLowerCase(), go: () => goToChannel(c.server_id, c.id) });
  }
  if (only !== 'channel') {
    for (const d of dmList) items.push({ kind: 'person', label: d.display_name, sub: 'Direct message', key: 'd:' + d.id, who: d.display_name, text: (d.username + ' ' + d.display_name).toLowerCase(), go: () => openDM(d) });
    for (const m of members) if (m.id !== user.id && !dmList.some(d => d.id === m.id)) items.push({ kind: 'person', label: m.display_name, sub: 'Member · say hi', who: m.display_name, text: (m.username + ' ' + m.display_name).toLowerCase(), go: () => openUser(m.id, m.display_name, m.username) });
  }
  if (!only) for (const s of servers) items.push({ kind: 'server', label: s.name, sub: 'Server', text: s.name.toLowerCase(), go: () => selectServer(s.id) });
  const score = it => {
    if (!term) return (it.key && isUnread(it.key) ? 2 : 0) + (it.key ? (lastActivity.get(it.key) || 0) / 1e13 : 0) + (it.key && pings.get(it.key) ? 3 : 0);
    return it.text.startsWith(term) ? 3 : it.text.split(/[\s-_]/).some(w => w.startsWith(term)) ? 2 : it.text.includes(term) ? 1 : 0;
  };
  return items.map(it => ({ it, s: score(it) })).filter(x => !term || x.s > 0).sort((a, b) => b.s - a.s).slice(0, 12).map(x => x.it);
}
function renderSwitcher() {
  switchItems = buildSwitchItems($('switchInput').value); switchIndex = Math.min(switchIndex, Math.max(0, switchItems.length - 1));
  $('switchList').innerHTML = switchItems.length ? switchItems.map((it, i) => `<button class="switch-item${i === switchIndex ? ' on' : ''}" data-i="${i}">${it.who ? avatar(it.who) : `<span class="icon">${it.kind === 'channel' ? '#' : safe(initials(it.label))}</span>`}<b>${safe(it.label.replace(/^#/, it.kind === 'channel' ? '' : '#'))}</b>${it.key && isUnread(it.key) ? '<span class="udot"></span>' : ''}<small>${safe(it.sub)}</small></button>`).join('') : '<div class="switch-empty">Nothing found 🔍</div>';
}
function pickSwitch(i) { const it = switchItems[i]; if (!it) return; closeSwitcher(); it.go() }
$('switchInput').addEventListener('input', () => { switchIndex = 0; renderSwitcher() });
$('switchInput').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!switchItems.length) return; switchIndex = (switchIndex + (e.key === 'ArrowDown' ? 1 : -1) + switchItems.length) % switchItems.length; renderSwitcher(); $('switchList').querySelector('.on')?.scrollIntoView({ block: 'nearest' }) }
  else if (e.key === 'Enter') { e.preventDefault(); pickSwitch(switchIndex) }
});
$('switchList').onclick = e => { const b = e.target.closest('[data-i]'); if (b) pickSwitch(+b.dataset.i) };
$('switcher').onclick = e => { if (e.target === $('switcher')) closeSwitcher() };

/* ---------- global keys & fun bits ---------- */
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && user) { e.preventDefault(); $('switcher').classList.contains('hidden') ? openSwitcher() : closeSwitcher(); return }
  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && view?.kind === 'channel' && channels.length) {
    e.preventDefault(); const i = channels.findIndex(c => c.id === view.id);
    return selectChannel(channels[(i + (e.key === 'ArrowUp' ? -1 : 1) + channels.length) % channels.length]);
  }
  if (e.key === 'Escape') {
    if (!$('lightbox').classList.contains('hidden')) return closeLightbox();
    if (askEscape) return askEscape();
    if (!$('switcher').classList.contains('hidden')) return closeSwitcher();
    if (!$('friendModal').classList.contains('hidden')) return closeFriends();
    closePopovers(); closeDrawers(); return;
  }
  // Start typing anywhere and it lands in the message box
  const el = document.activeElement, typingTarget = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  if (user && !typingTarget && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !$('app').classList.contains('hidden') && document.querySelectorAll('.modal:not(.hidden)').length === 0) input.focus();
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
