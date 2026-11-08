'use strict';
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
function validateDisplayName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/[<>\u0000-\u001f\u007f]/g, '');
  if (!name || Array.from(name).length > 32) return null;
  return name;
}
// Browser-loadable raster images only. Reject SVG/HTML and MIME/extension spoofing.
function avatarMime(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length || buf.length > MAX_AVATAR_BYTES) return null;
  if (buf.length >= 8 && buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (buf.length >= 3 && buf[0]===255 && buf[1]===216 && buf[2]===255) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('ascii',0,4)==='RIFF' && buf.toString('ascii',8,12)==='WEBP') return 'image/webp';
  if (buf.length >= 6 && (buf.toString('ascii',0,6)==='GIF87a'||buf.toString('ascii',0,6)==='GIF89a')) return 'image/gif';
  return null;
}
function validateUsername(value){
  if(typeof value!=='string')return null;
  const name=value.trim().toLowerCase();
  return /^[a-z0-9_]{3,24}$/.test(name)?name:null;
}
function validModerationReason(s) { return typeof s==='string' ? s.trim().slice(0,300) : ''; }
function canModerateTarget(adminId,targetId,targetUsername,shiftId) { return adminId !== targetId && targetId !== shiftId && targetUsername !== 'shift'; }
module.exports = {MAX_AVATAR_BYTES, validateDisplayName, validateUsername, avatarMime, validModerationReason, canModerateTarget};
