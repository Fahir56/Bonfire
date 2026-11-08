'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {MAX_AVATAR_BYTES,validateDisplayName,validateUsername,avatarMime,canModerateTarget}=require('./moderation-utils');

test('users may change display names but invalid ones are rejected',()=>{
  assert.equal(validateDisplayName('  New Name ✨  '),'New Name ✨');
  assert.equal(validateDisplayName(''),null);
  assert.equal(validateDisplayName('X'.repeat(33)),null);
  assert.equal(validateDisplayName('\0'),null);
});
test('usernames are normalized and bounded to safe handles',()=>{
  assert.equal(validateUsername(' Seal_123 '),'seal_123');
  for(const s of ['','a','invalid username','bad@handle','<script>','x'.repeat(25),null])assert.equal(validateUsername(s),null);
});
test('profile photos are restricted to recognized raster formats and 2 MiB',()=>{
  const png=Buffer.from([137,80,78,71,13,10,26,10,0]);
  assert.equal(avatarMime(png),'image/png');
  assert.equal(avatarMime(Buffer.from([0xff,0xd8,0xff,0x00])),'image/jpeg');
  assert.equal(avatarMime(Buffer.from('GIF89axxxx')),'image/gif');
  assert.equal(avatarMime(Buffer.from('RIFF1234WEBP')),'image/webp');
  assert.equal(avatarMime(Buffer.from('<svg><script>alert(1)</script></svg>')),null);
  assert.equal(avatarMime(Buffer.alloc(MAX_AVATAR_BYTES+1)),null);
});
test('admin cannot moderate itself or the Shift account',()=>{
  const shift='11111111-1111-4111-8111-111111111111';
  const other='22222222-2222-4222-8222-222222222222';
  assert.equal(canModerateTarget(shift,shift,'shift',shift),false);
  assert.equal(canModerateTarget(shift,other,'shift',shift),false);
  assert.equal(canModerateTarget(shift,other,'somebody',shift),true);
  assert.equal(canModerateTarget(shift,other,'somebody',other),false);
});
