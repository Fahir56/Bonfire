const { test }=require('node:test');
const assert=require('node:assert/strict');
const {Writable}=require('stream');
const {ZipWriter,safeArchiveName,csvCell,messagesCsv,assertExportSize,MAX_EXPORT_BYTES}=require('./evidence-zip');
test('ZIP writer generates correct local-file, central and EOCD records',async()=>{
  const packets=[];
  const output=new Writable({write(c,e,cb){packets.push(Buffer.from(c));cb();}});
  const zip=new ZipWriter(output);
  await zip.add('bonfire-evidence/messages.json','[{"content":"test"}]');
  await zip.add('bonfire-evidence/attachments/a_hello.txt',Buffer.from('actual file bytes'));
  await zip.finish();
  await new Promise(resolve=>output.on('finish',resolve));
  const buf=Buffer.concat(packets);
  assert.equal(buf.readUInt32LE(0),0x04034b50);
  assert.equal(buf.readUInt32LE(buf.length-22),0x06054b50);
  assert.equal(buf.readUInt16LE(buf.length-12),2);
  assert.equal(zip.checksums[0].sha256.length,64);
  const fs=require('fs');fs.writeFileSync('/tmp/bonfire-test-evidence.zip',buf);
});
test('filenames are not allowed to break out of attachment folder',()=>{
  assert.equal(safeArchiveName('../../evil.exe'),'____evil.exe');
  assert.equal(safeArchiveName('folder\\bad?.zip'),'folder_bad_.zip');
});
test('export budgets reject excessive attachment bytes and rows',()=>{
  assert.doesNotThrow(()=>assertExportSize(3,2,20));
  assert.throws(()=>assertExportSize(3,2,MAX_EXPORT_BYTES+1),/256 MiB/);
  assert.throws(()=>assertExportSize(20001,2,20),/Too many messages/);
});
test('CSV escapes spreadsheet formulas and double quotes',()=>{
  assert.equal(csvCell('=3+2'),'"\'=3+2"');
  assert.equal(csvCell('hello "friend"'),'"hello ""friend"""');
  assert.match(messagesCsv([{content:'@malicious',id:'id'}]),/"'@malicious"/);
});
