'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {MAX_FILE_BYTES,cleanFilename,servedMime,inlineMedia,retentionHours,byteRange}=require('./file-types');
const limits={photoHours:72,videoHours:12,audioHours:72,fileHours:72};
test('any file extension can be retained safely and size cap is 30 MiB',()=>{
  assert.equal(MAX_FILE_BYTES,31457280);
  for(const name of ['project.zip','install.apk','something.exe','report.pdf','page.html','art.svg','script.js','strange.xyz']){
    assert.equal(servedMime(name),'application/octet-stream');
  }
  assert.equal(cleanFilename('C:\\fakepath\\evil<>.apk'),'evil__.apk');
  assert.equal(cleanFilename('../../hello.txt'),'hello.txt');
});
test('common playable media is recognized without trusting upload MIME',()=>{
  for(const name of ['song.mp3','sound.m4a','ambience.ogg','mix.flac','voice.wav','clip.webm','movie.mp4','picture.png']){
    assert.equal(inlineMedia(servedMime(name)),true,name);
  }
  assert.equal(servedMime('malicious.html'),'application/octet-stream');
  assert.equal(servedMime('music.MP3'),'audio/mpeg');
});
test('retention stays bounded across file types',()=>{
  assert.equal(retentionHours('video/mp4',limits),12);
  assert.equal(retentionHours('audio/mpeg',limits),72);
  assert.equal(retentionHours('image/jpeg',limits),72);
  assert.equal(retentionHours('application/octet-stream',limits),72);
});
test('HTTP byte ranges allow playback and seeking',()=>{
  assert.deepEqual(byteRange('bytes=0-1023',10000),{start:0,end:1023});
  assert.deepEqual(byteRange('bytes=9000-',10000),{start:9000,end:9999});
  assert.deepEqual(byteRange('bytes=-500',10000),{start:9500,end:9999});
  assert.deepEqual(byteRange('bytes=0-9999999',10000),{start:0,end:9999});
  assert.equal(byteRange('bytes=10000-',10000),false);
  assert.equal(byteRange('bytes=5-2',10000),false);
  assert.equal(byteRange('bytes=0-1,3-4',10000),false);
  assert.equal(byteRange(null,10000),null);
});
