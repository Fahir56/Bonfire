'use strict';
const crypto=require('crypto');
const {ZipWriter,safeArchiveName,messagesCsv,assertExportSize}=require('./evidence-zip');
const downloadTickets=new Map();
const TICKET_LIFETIME_MS=90_000;
const isValidType=x=>x==='channel'||x==='server';
const publicError=(res,err)=>res.status(err.status||500).json({error:err.status?err.message:'Evidence export failed.'});

function installEvidenceExports(app,{auth,shiftOnly,isUuid,isShiftAdmin,pool,query,logModeration}){
  // Ticket handoff avoids exposing long-lived JWTs in URLs and allows a normal browser download.
  // Tickets are random, expire rapidly, and can be used once, even on failed downloads.
  app.post('/api/admin/exports',auth,shiftOnly,async(req,res)=>{
    try{
      const {type,id}=req.body||{};
      if(!isValidType(type)||!isUuid(id))return res.status(400).json({error:'Choose a valid channel or server.'});
      const r=await query(type==='channel'?'SELECT c.id,c.name,c.server_id FROM channels c WHERE c.id=$1':'SELECT id,name FROM servers WHERE id=$1',[id]);
      if(!r.rowCount)return res.status(404).json({error:'That channel or server no longer exists.'});
      const where=type==='channel'?'m.channel_id=$1':'m.server_id=$1';
      const st=(await query(`SELECT COUNT(*)::int AS messages, COUNT(a.id)::int AS files,
        COALESCE(SUM(CASE WHEN a.purged_at IS NULL AND a.expires_at>NOW() THEN a.size_bytes ELSE 0 END),0)::bigint AS bytes
        FROM messages m LEFT JOIN attachments a ON a.id=m.attachment_id WHERE ${where}`,[id])).rows[0];
      assertExportSize(st.messages,st.files,Number(st.bytes));
      // Prevent piling up in-memory one-time secrets.
      for(const [t,v] of downloadTickets)if(v.expires<Date.now())downloadTickets.delete(t);
      if(downloadTickets.size>=30)return res.status(429).json({error:'Too many pending downloads. Try again shortly.'});
      const ticket=crypto.randomBytes(32).toString('hex');
      downloadTickets.set(ticket,{uid:req.user.sub,type,id,expires:Date.now()+TICKET_LIFETIME_MS});
      res.set('Cache-Control','no-store').json({download_url:'/api/admin/exports/'+ticket+'/download',expires_in_seconds:90,estimated_messages:st.messages,estimated_attachment_bytes:Number(st.bytes)});
    }catch(e){console.error('Evidence export ticket',e);publicError(res,e);}
  });
  app.get('/api/admin/exports/:ticket/download',async(req,res)=>{
    const t=String(req.params.ticket||'');const ticket=downloadTickets.get(t);
    downloadTickets.delete(t);
    if(!ticket||ticket.expires<Date.now())return res.status(404).send('Download link expired or already used. Generate a new export from the Control Room.');
    try{if(!(await isShiftAdmin(ticket.uid)))return res.status(403).send('Only Shift can download evidence backups.');}
    catch(e){console.error(e);return res.sendStatus(500);}
    let db,started=false;
    try{
      db=await pool.connect();await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const {id,type}=ticket;
      const get=async(sql,args=[])=>(await db.query(sql,args)).rows;
      const serverId=type==='server'?id:(await get('SELECT server_id FROM channels WHERE id=$1',[id]))[0]?.server_id;
      if(!serverId)return res.sendStatus(404);
      const server=(await get('SELECT id,name,owner_id,created_at FROM servers WHERE id=$1',[serverId]))[0];
      if(!server)return res.sendStatus(404);
      const channels=await get(type==='server'?'SELECT id,server_id,name,topic,kind,created_at FROM channels WHERE server_id=$1 ORDER BY created_at,id':'SELECT id,server_id,name,topic,kind,created_at FROM channels WHERE id=$1',[id]);
      if(!channels.length)return res.sendStatus(404);
      const where=type==='server'?'m.server_id=$1':'m.channel_id=$1';
      const messages=await get(`SELECT m.id,m.server_id,m.channel_id,c.name AS channel_name,m.user_id,u.username,u.display_name,
        m.content,m.created_at,m.edited_at,m.edited_by_admin,m.reply_to,
        a.id AS attachment_id,a.filename,a.mime_type,a.size_bytes,a.created_at AS attachment_created_at,
        a.expires_at,a.purged_at,(a.id IS NOT NULL AND a.purged_at IS NULL AND a.expires_at>NOW()) AS attachment_available
        FROM messages m JOIN users u ON u.id=m.user_id JOIN channels c ON c.id=m.channel_id
        LEFT JOIN attachments a ON a.id=m.attachment_id WHERE ${where}
        ORDER BY m.created_at,m.id`,[id]);
      const uniqueAttachments=new Map();
      for(const m of messages)if(m.attachment_id&&!uniqueAttachments.has(m.attachment_id))uniqueAttachments.set(m.attachment_id,m);
      const liveBytes=[...uniqueAttachments.values()].reduce((sum,a)=>sum+(a.attachment_available?Number(a.size_bytes||0):0),0);
      assertExportSize(messages.length,uniqueAttachments.size,liveBytes);
      const members=await get(`SELECT u.id,u.username,u.display_name,u.profile_rank,sm.joined_at
        FROM server_members sm JOIN users u ON u.id=sm.user_id WHERE sm.server_id=$1 ORDER BY sm.joined_at,u.id`,[serverId]);
      const audits=await get(`SELECT a.id,a.action,a.created_at,a.admin_id,a.target_user_id,a.server_id,a.channel_id,a.message_id,a.details
        FROM moderation_audit a WHERE a.server_id=$1 ${type==='channel'?'AND (a.channel_id=$2 OR a.channel_id IS NULL)':''}
        ORDER BY a.created_at,a.id`,type==='channel'?[serverId,id]:[serverId]);
      const rankAudits=await get(`SELECT ra.id,ra.target_user_id,ra.assigned_by,ra.old_rank,ra.new_rank,ra.created_at
        FROM rank_audit ra JOIN server_members sm ON sm.user_id=ra.target_user_id
        WHERE sm.server_id=$1 ORDER BY ra.created_at,ra.id`,[serverId]);
      const now=new Date().toISOString();
      const filename=`bonfire-evidence-${type}-${safeArchiveName(type==='channel'?channels[0].name:server.name).slice(0,40)}-${now.slice(0,10)}-${id.slice(0,8)}.zip`;
      // No storage on the Bonfire server: each archive streams directly to Shift's machine.
      res.set({'Content-Type':'application/zip','Content-Disposition':`attachment; filename="${filename}"`,'Cache-Control':'no-store, private','Pragma':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
      started=true;
      const zip=new ZipWriter(res);const prefix='bonfire-evidence/';
      await zip.add(prefix+'server.json',JSON.stringify(server,null,2));
      await zip.add(prefix+'channels.json',JSON.stringify(channels,null,2));
      await zip.add(prefix+'members.json',JSON.stringify(members,null,2));
      await zip.add(prefix+'messages.json',JSON.stringify(messages,null,2));
      await zip.add(prefix+'messages.csv',messagesCsv(messages));
      await zip.add(prefix+'moderation-audit.json',JSON.stringify(audits,null,2));
      await zip.add(prefix+'rank-audit.json',JSON.stringify(rankAudits,null,2));
      const missing=[],downloaded=[];
      for(const a of uniqueAttachments.values()){
        if(!a.attachment_available){missing.push({id:a.attachment_id,filename:a.filename,reason:'expired or removed before export'});continue;}
        const found=await get('SELECT data FROM attachments WHERE id=$1 AND purged_at IS NULL AND expires_at>NOW()',[a.attachment_id]);
        if(!found[0]?.data||found[0].data.length!==Number(a.size_bytes)){
          missing.push({id:a.attachment_id,filename:a.filename,reason:'attachment data unavailable or incomplete'});continue;
        }
        const name=prefix+'attachments/'+a.attachment_id+'_'+safeArchiveName(a.filename);
        await zip.add(name,found[0].data);
        downloaded.push({id:a.attachment_id,filename:a.filename,path:name,bytes:found[0].data.length});
      }
      const hashes=zip.checksums.slice();
      const manifest={format:'Bonfire Evidence Backup v1',exported_at_utc:now,scope:type,scope_id:id,server,channels,
        message_count:messages.length,member_count:members.length,moderation_event_count:audits.length,rank_event_count:rankAudits.length,
        attachments_exported:downloaded,attachments_missing:missing,
        message_retention_warning:'Only messages and attachments still present in PostgreSQL at export time are included. Already purged/expired content cannot be recovered.',
        private_dm_warning:'Private direct messages are not included.',
        integrity_note:'SHA-256 hashes detect later file changes. They are not a digital signature or independent proof of authorship.',
        files:hashes};
      await zip.add(prefix+'SHA256SUMS.txt',hashes.map(x=>x.sha256+'  '+x.path).join('\n')+'\n',false);
      await zip.add(prefix+'manifest.json',JSON.stringify(manifest,null,2),false);
      await zip.finish();
      await db.query('COMMIT');
      // Audit the export independently of the read-only consistent snapshot.
      await logModeration(ticket.uid,'evidence_export',{serverId,channelId:type==='channel'?id:null,scope:type,scopeId:id,messageCount:messages.length,files:downloaded.length,missingFiles:missing.length}).catch(e=>console.error('Export audit',e));
    }catch(e){console.error('Evidence export failed',e);if(started){if(!res.writableEnded)res.destroy();}else publicError(res,e);}
    finally{if(db){await db.query('ROLLBACK').catch(()=>{});db.release();}}
  });
}
module.exports={installEvidenceExports};
