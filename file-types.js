'use strict';

// Only browser-safe, explicitly recognized media may be displayed inline. Any
// extension can still be uploaded; everything else is sent as a download.
const INLINE_TYPES = Object.freeze({
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.webp':'image/webp',
  '.mp4':'video/mp4', '.webm':'video/webm', '.mov':'video/quicktime', '.m4v':'video/mp4',
  '.mp3':'audio/mpeg', '.mpeg':'audio/mpeg', '.mpga':'audio/mpeg', '.wav':'audio/wav', '.wave':'audio/wav',
  '.ogg':'audio/ogg', '.oga':'audio/ogg', '.opus':'audio/ogg', '.m4a':'audio/mp4', '.aac':'audio/aac',
  '.flac':'audio/flac', '.weba':'audio/webm', '.aif':'audio/aiff', '.aiff':'audio/aiff'
});
const MAX_FILE_BYTES = 30 * 1024 * 1024;
function cleanFilename(raw) {
  return String(raw || 'untitled').split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f<>:"|?*]/g, '_').slice(0, 180) || 'untitled';
}
function servedMime(name) {
  const ext = require('path').extname(String(name || '')).toLowerCase();
  return INLINE_TYPES[ext] || 'application/octet-stream';
}
function inlineMedia(mime) { return /^(image\/(png|jpeg|gif|webp)|video\/(mp4|webm|quicktime)|audio\/(mpeg|wav|ogg|mp4|aac|flac|webm|aiff))$/.test(mime); }
function retentionHours(mime, rules) {
  return mime.startsWith('video/') ? rules.videoHours : mime.startsWith('audio/') ? rules.audioHours : mime.startsWith('image/') ? rules.photoHours : rules.fileHours;
}
function byteRange(header, length) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (!m[1] && !m[2]) || length <= 0) return false;
  let start, end;
  if (!m[1]) {
    const count = Number(m[2]);
    if (!Number.isSafeInteger(count) || count <= 0) return false;
    start = Math.max(length - count, 0); end = length - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Number(m[2]) : length - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= length || start > end) return false;
    end = Math.min(end, length - 1);
  }
  return { start, end };
}
module.exports = { INLINE_TYPES, MAX_FILE_BYTES, cleanFilename, servedMime, inlineMedia, retentionHours, byteRange };
