'use strict';
// Small, dependency-free ZIP32 writer for authenticated evidence exports.
// Stored entries keep original media bytes intact; each entry is SHA-256 checked.
const crypto = require('crypto');
const MAX_EXPORT_BYTES = 256 * 1024 * 1024;
const MAX_EXPORT_MESSAGES = 20000;
const MAX_EXPORT_FILES = 12000;
const MAX_EXPORT_ENTRIES = 20050;
const crcTable = new Uint32Array(256);
for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;crcTable[n]=c>>>0;}
function crc32(data){let c=0xffffffff;for(let i=0;i<data.length;i++)c=crcTable[(c^data[i])&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function safeArchiveName(name){return String(name||'unnamed').normalize('NFKC').replace(/[\\/\x00-\x1f\x7f<>:"|?*]/g,'_').replace(/\.\./g,'_').replace(/^\.+/,'_').slice(0,110)||'unnamed';}
function csvCell(value){const s=String(value==null?'':value);const protectedValue=/^\s*[=+@\-\t\r]/.test(s)?"'"+s:s;return '"'+protectedValue.replace(/"/g,'""')+'"';}
function messagesCsv(rows){return ['id,channel_id,channel_name,username,display_name,user_id,created_at,edited_at,edited_by_admin,content,attachment_id,attachment_filename',...rows.map(m=>[m.id,m.channel_id,m.channel_name,m.username,m.display_name,m.user_id,m.created_at,m.edited_at,m.edited_by_admin,m.content,m.attachment_id,m.filename].map(csvCell).join(','))].join('\r\n')+'\r\n';}
// Export budget check before headers have been sent; fails closed rather than returning partial archives.
function assertExportSize(messageCount,fileCount,attachmentBytes){
 if(messageCount>MAX_EXPORT_MESSAGES)throw Object.assign(new Error(`Too many messages for one export (limit ${MAX_EXPORT_MESSAGES}). Export smaller channels.`),{status:413});
 if(fileCount>MAX_EXPORT_FILES)throw Object.assign(new Error('Too many attachments for one export. Export separate channels.'),{status:413});
 if(attachmentBytes>MAX_EXPORT_BYTES)throw Object.assign(new Error('Backup exceeds the 256 MiB attachment budget. Export smaller channels.'),{status:413});
}
class ZipWriter {
 constructor(response){this.res=response;this.position=0;this.entries=[];this.checksums=[];this.closed=false;}
 async write(bytes){
   if(this.res.destroyed||this.res.writableEnded)throw Error('Download interrupted');
   if(!this.res.write(bytes))await new Promise((resolve,reject)=>{
     const cleanup=()=>{this.res.off('drain',drain);this.res.off('close',closed);this.res.off('error',failed)};
     const drain=()=>{cleanup();resolve()};
     const closed=()=>{cleanup();reject(Error('Download disconnected'))};
     const failed=e=>{cleanup();reject(e)};
     this.res.on('drain',drain);this.res.on('close',closed);this.res.on('error',failed);
   });
   this.position+=bytes.length;
 }
 async add(name,value,record=true){
   if(this.closed)throw Error('ZIP already closed');
   if(this.entries.length>=MAX_EXPORT_ENTRIES)throw Error('ZIP entry limit exceeded');
   const filename=String(name).replace(/\\/g,'/');
   if(filename.startsWith('/')||filename.split('/').includes('..'))throw Error('Unsafe ZIP entry');
   const encoded=Buffer.from(filename,'utf8');const data=Buffer.isBuffer(value)?value:Buffer.from(String(value));
   if(data.length>0xffffffff||this.position>0xffffffff)throw Error('ZIP32 size limit exceeded');
   const hash=crypto.createHash('sha256').update(data).digest('hex');const crc=crc32(data);const offset=this.position;
   const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(0x0800,6);h.writeUInt16LE(0,8);h.writeUInt32LE(crc,14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(encoded.length,26);
   await this.write(h);await this.write(encoded);await this.write(data);
   this.entries.push({name:filename,encoded,crc,size:data.length,offset});
   if(record)this.checksums.push({path:filename,sha256:hash,bytes:data.length});
 }
 async finish(){
   const centralStart=this.position;
   for(const e of this.entries){const h=Buffer.alloc(46);h.writeUInt32LE(0x02014b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(20,6);h.writeUInt16LE(0x0800,8);h.writeUInt32LE(e.crc,16);h.writeUInt32LE(e.size,20);h.writeUInt32LE(e.size,24);h.writeUInt16LE(e.encoded.length,28);h.writeUInt32LE(e.offset,42);await this.write(h);await this.write(e.encoded);}
   const centralSize=this.position-centralStart;if(this.position>0xffffffff||this.entries.length>0xffff)throw Error('ZIP32 limit exceeded');
   const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(this.entries.length,8);end.writeUInt16LE(this.entries.length,10);end.writeUInt32LE(centralSize,12);end.writeUInt32LE(centralStart,16);await this.write(end);this.closed=true;this.res.end();
 }
}
module.exports={ZipWriter,safeArchiveName,csvCell,messagesCsv,assertExportSize,MAX_EXPORT_BYTES,MAX_EXPORT_MESSAGES,MAX_EXPORT_FILES};
