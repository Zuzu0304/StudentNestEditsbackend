import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { createNotification } from './notifications.js';

const router = Router();
const CHAT_ROLES = ['student','provider','inspector','admin'];
const PAYMENT_MODE = String(process.env.PAYMENT_MODE || 'mock').toLowerCase();

async function getConversation(id, userId) {
  const [rows] = await pool.execute(
    `SELECT c.*, u1.full_name AS participant_one_name, u1.role AS participant_one_role,
            u2.full_name AS participant_two_name, u2.role AS participant_two_role,
            p.title AS property_title,
            p.provider_id AS property_provider_id,
            mi.title AS market_item_title,
            (SELECT br.id FROM booking_requests br WHERE br.property_id=c.property_id
              AND ((br.student_id=c.participant_one_id AND br.provider_id=c.participant_two_id)
                OR (br.student_id=c.participant_two_id AND br.provider_id=c.participant_one_id))
              AND br.status IN ('approved','payment_pending','paid','active') ORDER BY br.id DESC LIMIT 1) AS booking_id,
            (SELECT mt.seller_id FROM marketplace_transactions mt WHERE mt.item_id=CAST(SUBSTRING(c.context_key,13) AS UNSIGNED) AND mt.buyer_id IN (c.participant_one_id,c.participant_two_id) AND mt.seller_id IN (c.participant_one_id,c.participant_two_id) AND mt.status IN ('pending_payment','funds_protected','confirmed','disputed','released') ORDER BY mt.id DESC LIMIT 1) AS marketplace_seller_id,
            (SELECT mt.id FROM marketplace_transactions mt WHERE mt.item_id=CAST(SUBSTRING(c.context_key,13) AS UNSIGNED)
              AND mt.buyer_id IN (c.participant_one_id,c.participant_two_id)
              AND mt.seller_id IN (c.participant_one_id,c.participant_two_id)
              AND mt.status IN ('pending_payment','funds_protected','confirmed','disputed','released') ORDER BY mt.id DESC LIMIT 1) AS marketplace_transaction_id,
            rml.area AS roommate_area, rml.name AS roommate_poster_name,
            tkl.title AS takeover_title
     FROM chat_conversations c
     JOIN users u1 ON u1.id=c.participant_one_id
     JOIN users u2 ON u2.id=c.participant_two_id
     LEFT JOIN properties p ON p.id=c.property_id
     LEFT JOIN marketplace_items mi ON c.context_key LIKE 'marketplace:%' AND mi.id=CAST(SUBSTRING(c.context_key,13) AS UNSIGNED)
     LEFT JOIN roommate_listings rml ON c.context_key LIKE 'roommate:%' AND rml.id=CAST(SUBSTRING(c.context_key,10) AS UNSIGNED)
     LEFT JOIN takeover_listings tkl ON c.context_key LIKE 'takeover:%' AND tkl.id=CAST(SUBSTRING(c.context_key,10) AS UNSIGNED)
     WHERE c.id=? AND (c.participant_one_id=? OR c.participant_two_id=?) LIMIT 1`,
    [id, userId, userId]
  );
  const c=rows[0];
  if(!c) return undefined;
  // Admin can access conversations for platform support/operations.
  if(c.participant_one_role==='admin' && Number(c.participant_one_id)===Number(userId)) return c;
  if(c.participant_two_role==='admin' && Number(c.participant_two_id)===Number(userId)) return c;
  if(c.context_key==='support'){
    const otherRole = Number(c.participant_one_id)===Number(userId) ? c.participant_two_role : c.participant_one_role;
    return otherRole==='admin' ? c : undefined;
  }
  if(c.property_id){
    const providerId = c.participant_one_role==='provider' ? Number(c.participant_one_id) : (c.participant_two_role==='provider' ? Number(c.participant_two_id) : null);
    if(providerId===null || Number(c.property_provider_id)!==providerId) return undefined;
    if(c.context_key==='inspection'){
      const inspectorProvider = (c.participant_one_role==='inspector' && c.participant_two_role==='provider') || (c.participant_one_role==='provider' && c.participant_two_role==='inspector');
      if(!inspectorProvider) return undefined;
      return c;
    }
    const studentProvider = (c.participant_one_role==='student' && c.participant_two_role==='provider') || (c.participant_one_role==='provider' && c.participant_two_role==='student');
    if(!studentProvider) return undefined;
    return c;
  }
  if(c.context_key?.startsWith('marketplace:')){
    const itemId=Number(c.context_key.split(':')[1]);
    const [items]=await pool.execute('SELECT seller_id FROM marketplace_items WHERE id=? LIMIT 1',[itemId]);
    if(!items.length || ![Number(c.participant_one_id),Number(c.participant_two_id)].includes(Number(items[0].seller_id))) return undefined;
    return c;
  }
  if(c.context_key?.startsWith('roommate:')){
    const listingId=Number(c.context_key.split(':')[1]);
    const [rows]=await pool.execute('SELECT student_id FROM roommate_listings WHERE id=? LIMIT 1',[listingId]);
    if(!rows.length || ![Number(c.participant_one_id),Number(c.participant_two_id)].includes(Number(rows[0].student_id))) return undefined;
    return c;
  }
  if(c.context_key?.startsWith('takeover:')){
    const listingId=Number(c.context_key.split(':')[1]);
    const [rows]=await pool.execute('SELECT student_id FROM takeover_listings WHERE id=? LIMIT 1',[listingId]);
    if(!rows.length || ![Number(c.participant_one_id),Number(c.participant_two_id)].includes(Number(rows[0].student_id))) return undefined;
    return c;
  }
  // No context means it is an old/unscoped generic chat; ordinary users can no longer access it.
  return undefined;
}

function otherUser(c, userId) {
  return Number(c.participant_one_id) === Number(userId)
    ? { id:c.participant_two_id, name:c.participant_two_name, role:c.participant_two_role }
    : { id:c.participant_one_id, name:c.participant_one_name, role:c.participant_one_role };
}

router.get('/users', requireAuth, requireRole('admin'), async (req,res,next)=>{
  try {
    const role = String(req.query.role||'').toLowerCase();
    const params=[req.user.id];
    let where="u.id<>? AND u.is_active=1 AND u.role IN ('student','provider','inspector','admin')";
    if (CHAT_ROLES.includes(role)) { where += ' AND u.role=?'; params.push(role); }
    const q=String(req.query.q||'').trim();
    if(q){where+=' AND (u.full_name LIKE ? OR u.email LIKE ?)';params.push(`%${q}%`,`%${q}%`)}
    const [rows]=await pool.execute(`SELECT u.id,u.full_name,u.email,u.phone,u.role FROM users u WHERE ${where} ORDER BY u.full_name ASC LIMIT 80`,params);
    res.json({success:true,users:rows});
  } catch(e){next(e)}
});

// Normal users can contact StudentNest support without being exposed to an
// admin/user directory. The support participant is resolved server-side.
router.post('/support', requireAuth, async(req,res,next)=>{
  try {
    if(req.user.role==='admin') return res.status(400).json({success:false,message:'Use the admin messaging tools for support conversations.'});
    const [admins]=await pool.execute("SELECT id FROM users WHERE role='admin' AND is_active=1 ORDER BY id ASC LIMIT 1");
    if(!admins.length) return res.status(503).json({success:false,message:'StudentNest support is temporarily unavailable.'});
    const adminId=Number(admins[0].id);
    const [existing]=await pool.execute(`SELECT id FROM chat_conversations WHERE ((participant_one_id=? AND participant_two_id=?) OR (participant_one_id=? AND participant_two_id=?)) AND property_id IS NULL AND context_key='support' LIMIT 1`,[req.user.id,adminId,adminId,req.user.id]);
    if(existing.length) return res.json({success:true,conversation:await getConversation(existing[0].id,req.user.id)});
    const [result]=await pool.execute("INSERT INTO chat_conversations (participant_one_id,participant_two_id,property_id,context_key) VALUES (?,?,NULL,'support')",[req.user.id,adminId]);
    res.status(201).json({success:true,conversation:await getConversation(result.insertId,req.user.id)});
  } catch(e){next(e)}
});

router.post('/conversations', requireAuth, async(req,res,next)=>{
  try {
    const otherId=Number(req.body?.other_user_id);
    const propertyId=req.body?.property_id ? Number(req.body.property_id) : null;
    const contextKey=String(req.body?.context_key||'').trim()||null;
    if(!otherId || otherId===req.user.id) return res.status(400).json({success:false,message:'Choose another user.'});
    const [users]=await pool.execute('SELECT id,role,is_active FROM users WHERE id IN (?,?)',[req.user.id,otherId]);
    if(users.length!==2 || users.some(u=>!u.is_active)) return res.status(404).json({success:false,message:'User not found.'});
    const me=users.find(u=>Number(u.id)===Number(req.user.id));
    const other=users.find(u=>Number(u.id)===otherId);
    const isSupport=contextKey==='support' && propertyId===null && other?.role==='admin';
    if(me?.role!=='admin' && !isSupport){
      if(propertyId && contextKey==='inspection'){
        if(!['inspector','provider'].includes(me?.role) || !['inspector','provider'].includes(other?.role) || me?.role===other?.role) return res.status(403).json({success:false,message:'Inspection conversations are between an inspector and the property provider.'});
      } else if(propertyId){
        if(me?.role!=='student' || other?.role!=='provider') return res.status(403).json({success:false,message:'Property conversations are between a student and the property provider.'});
      } else if(contextKey?.startsWith('marketplace:')) {
        if(!['student','provider'].includes(me?.role) || !['student','provider'].includes(other?.role)) return res.status(403).json({success:false,message:'Student Shop conversations must be between a buyer and seller.'});
      } else if(contextKey?.startsWith('roommate:') || contextKey?.startsWith('takeover:')) {
        if(me?.role!=='student' || other?.role!=='student') return res.status(403).json({success:false,message:'Roommate Finder and Takeover conversations are between students.'});
      } else {
        return res.status(403).json({success:false,message:'Start a conversation from a property or Student Shop listing, or contact StudentNest support.'});
      }
    }
    if(propertyId){
      const [p]=await pool.execute('SELECT id,provider_id FROM properties WHERE id=? LIMIT 1',[propertyId]);
      if(!p.length) return res.status(404).json({success:false,message:'Property not found.'});
      if(![req.user.id,otherId].includes(Number(p[0].provider_id))) return res.status(400).json({success:false,message:'The property provider must be part of this chat.'});
      if(contextKey==='inspection'){
        const inspectorId = me?.role==='inspector' ? req.user.id : otherId;
        const [assigned]=await pool.execute('SELECT id FROM property_inspections WHERE property_id=? AND agent_id=? LIMIT 1',[propertyId,inspectorId]);
        if(!assigned.length && me?.role!=='admin') return res.status(403).json({success:false,message:'Only an inspector assigned to this property can start this conversation.'});
      }
    }
    if(contextKey?.startsWith('marketplace:')){
      const itemId=Number(contextKey.split(':')[1]);
      const [item]=await pool.execute('SELECT id,seller_id,status FROM marketplace_items WHERE id=? LIMIT 1',[itemId]);
      if(!item.length) return res.status(404).json({success:false,message:'Shop item not found.'});
      const sellerId=Number(item[0].seller_id);
      if(![req.user.id,otherId].includes(sellerId)) return res.status(400).json({success:false,message:'The seller must be part of this chat.'});
      if(me?.role!=='admin' && Number(req.user.id)===sellerId) return res.status(403).json({success:false,message:'Sellers reply to buyers from the existing Student Shop conversation.'});
    }
    if(contextKey?.startsWith('roommate:')){
      const listingId=Number(contextKey.split(':')[1]);
      const [rows]=await pool.execute('SELECT student_id FROM roommate_listings WHERE id=? LIMIT 1',[listingId]);
      if(!rows.length) return res.status(404).json({success:false,message:'Roommate listing not found.'});
      const posterId=Number(rows[0].student_id);
      if(![req.user.id,otherId].includes(posterId)) return res.status(400).json({success:false,message:'The listing poster must be part of this chat.'});
      if(me?.role!=='admin' && Number(req.user.id)===posterId) return res.status(403).json({success:false,message:'Posters reply to interested students from the existing conversation.'});
    }
    if(contextKey?.startsWith('takeover:')){
      const listingId=Number(contextKey.split(':')[1]);
      const [rows]=await pool.execute('SELECT student_id FROM takeover_listings WHERE id=? LIMIT 1',[listingId]);
      if(!rows.length) return res.status(404).json({success:false,message:'Takeover listing not found.'});
      const posterId=Number(rows[0].student_id);
      if(![req.user.id,otherId].includes(posterId)) return res.status(400).json({success:false,message:'The listing poster must be part of this chat.'});
      if(me?.role!=='admin' && Number(req.user.id)===posterId) return res.status(403).json({success:false,message:'Posters reply to interested students from the existing conversation.'});
    }
    const [existing]=await pool.execute(`SELECT id FROM chat_conversations WHERE ((participant_one_id=? AND participant_two_id=?) OR (participant_one_id=? AND participant_two_id=?)) AND property_id <=> ? AND context_key <=> ? LIMIT 1`,[req.user.id,otherId,otherId,req.user.id,propertyId,contextKey]);
    if(existing.length) return res.json({success:true,conversation:await getConversation(existing[0].id,req.user.id)});
    const [result]=await pool.execute('INSERT INTO chat_conversations (participant_one_id,participant_two_id,property_id,context_key) VALUES (?,?,?,?)',[req.user.id,otherId,propertyId,contextKey]);
    res.status(201).json({success:true,conversation:await getConversation(result.insertId,req.user.id)});
  } catch(e){next(e)}
});

router.get('/conversations', requireAuth, async(req,res,next)=>{
  try {
    const [rows]=await pool.execute(`SELECT c.id
      FROM chat_conversations c
      WHERE c.participant_one_id=? OR c.participant_two_id=? ORDER BY COALESCE(c.last_message_at,c.updated_at) DESC`,[req.user.id,req.user.id]);
    const conversations=(await Promise.all(rows.map(r=>getConversation(r.id,req.user.id)))).filter(Boolean);
    res.json({success:true,conversations:conversations.map(c=>({...c,other_user:otherUser(c,req.user.id)}))});
  } catch(e){next(e)}
});

router.get('/conversations/:id/messages', requireAuth, async(req,res,next)=>{
  try {
    const c=await getConversation(req.params.id,req.user.id);
    if(!c) return res.status(404).json({success:false,message:'Conversation not found.'});
    const [rows]=await pool.execute(`SELECT m.*,u.full_name AS sender_name,u.role AS sender_role FROM chat_messages m JOIN users u ON u.id=m.sender_id WHERE m.conversation_id=? ORDER BY m.created_at ASC`,[c.id]);
    await pool.execute('UPDATE chat_messages SET read_at=NOW() WHERE conversation_id=? AND sender_id<>? AND read_at IS NULL',[c.id,req.user.id]);
    res.json({success:true,conversation:c,messages:rows});
  } catch(e){next(e)}
});

router.post('/conversations/:id/messages', requireAuth, async(req,res,next)=>{
  try {
    const c=await getConversation(req.params.id,req.user.id);
    if(!c) return res.status(404).json({success:false,message:'Conversation not found.'});
    const body=String(req.body?.body||'').trim();
    if(!body) return res.status(400).json({success:false,message:'Message cannot be empty.'});
    if(body.length>5000) return res.status(400).json({success:false,message:'Message is too long.'});
    const [result]=await pool.execute('INSERT INTO chat_messages (conversation_id,sender_id,body) VALUES (?,?,?)',[c.id,req.user.id,body]);
    await pool.execute('UPDATE chat_conversations SET last_message_at=NOW() WHERE id=?',[c.id]);
    const recipient=Number(c.participant_one_id)===Number(req.user.id)?c.participant_two_id:c.participant_one_id;
    await createNotification(recipient,'message','New message',`${req.user.full_name} sent you a message.`,{conversation_id:c.id,message_id:result.insertId});
    res.status(201).json({success:true,message:{id:result.insertId,conversation_id:c.id,sender_id:req.user.id,body,created_at:new Date().toISOString()}});
  } catch(e){next(e)}
});

router.get('/appointments/mine', requireAuth, async(req,res,next)=>{
  try {
    const [rows]=await pool.execute(`SELECT a.*,p.title AS property_title,c.participant_one_id,c.participant_two_id,u1.full_name AS participant_one_name,u2.full_name AS participant_two_name
      FROM chat_appointments a JOIN chat_conversations c ON c.id=a.conversation_id LEFT JOIN properties p ON p.id=a.property_id
      JOIN users u1 ON u1.id=c.participant_one_id JOIN users u2 ON u2.id=c.participant_two_id
      WHERE c.participant_one_id=? OR c.participant_two_id=? ORDER BY a.scheduled_for DESC`,[req.user.id,req.user.id]);
    res.json({success:true,appointments:rows});
  } catch(e){next(e)}
});

router.post('/conversations/:id/appointments', requireAuth, async(req,res,next)=>{
  try {
    const c=await getConversation(req.params.id,req.user.id);
    if(!c) return res.status(404).json({success:false,message:'Conversation not found.'});
    const scheduled=String(req.body?.scheduled_for||'').trim();
    if(!scheduled || Number.isNaN(Date.parse(scheduled))) return res.status(400).json({success:false,message:'Choose a valid appointment date and time.'});
    const when=new Date(scheduled);
    if(when.getTime()<=Date.now()) return res.status(400).json({success:false,message:'Appointment must be in the future.'});
    const note=String(req.body?.note||'').trim().slice(0,500)||null;
    const propertyId=req.body?.property_id ? Number(req.body.property_id) : (c.property_id||null);
    if(propertyId){
      const [p]=await pool.execute('SELECT provider_id FROM properties WHERE id=? LIMIT 1',[propertyId]);
      if(!p.length) return res.status(404).json({success:false,message:'Property not found.'});
      if(![Number(c.participant_one_id),Number(c.participant_two_id)].includes(Number(p[0].provider_id))) return res.status(400).json({success:false,message:'Property provider is not part of this chat.'});
    }
    const [r]=await pool.execute(`INSERT INTO chat_appointments (conversation_id,property_id,created_by,scheduled_for,note,status) VALUES (?,?,?,?,?,'proposed')`,[c.id,propertyId,req.user.id,when,note]);
    const recipient=Number(c.participant_one_id)===Number(req.user.id)?c.participant_two_id:c.participant_one_id;
    await createNotification(recipient,'appointment','Appointment proposed',`${req.user.full_name} proposed an appointment${c.property_title?` for ${c.property_title}`:''}.`,{appointment_id:r.insertId,conversation_id:c.id});
    res.status(201).json({success:true,message:'Appointment proposed. The other person can accept or propose another time.',appointment_id:r.insertId});
  } catch(e){next(e)}
});

router.post('/appointments/:id/respond', requireAuth, async(req,res,next)=>{
  try {
    const [rows]=await pool.execute(`SELECT a.*,c.participant_one_id,c.participant_two_id,p.title AS property_title FROM chat_appointments a JOIN chat_conversations c ON c.id=a.conversation_id LEFT JOIN properties p ON p.id=a.property_id WHERE a.id=? AND (c.participant_one_id=? OR c.participant_two_id=?) LIMIT 1`,[req.params.id,req.user.id,req.user.id]);
    if(!rows.length) return res.status(404).json({success:false,message:'Appointment not found.'});
    const a=rows[0];
    if(a.created_by===req.user.id && !['proposed'].includes(a.status)) return res.status(409).json({success:false,message:'This appointment cannot be changed now.'});
    const decision=String(req.body?.decision||'').toLowerCase();
    if(!['accept','decline','propose'].includes(decision)) return res.status(400).json({success:false,message:'Decision must be accept, decline or propose.'});
    if(decision==='propose'){
      const scheduled=String(req.body?.scheduled_for||'').trim();
      if(!scheduled || Number.isNaN(Date.parse(scheduled)) || new Date(scheduled).getTime()<=Date.now()) return res.status(400).json({success:false,message:'Choose a future date and time.'});
      await pool.execute(`UPDATE chat_appointments SET scheduled_for=?,created_by=?,status='proposed',responded_by=?,responded_at=NOW() WHERE id=?`,[new Date(scheduled),req.user.id,req.user.id,a.id]);
    } else {
      await pool.execute(`UPDATE chat_appointments SET status=?,responded_by=?,responded_at=NOW() WHERE id=?`,[decision==='accept'?'accepted':'declined',req.user.id,a.id]);
    }
    const recipient=Number(a.participant_one_id)===Number(req.user.id)?a.participant_two_id:a.participant_one_id;
    await createNotification(recipient,'appointment',decision==='accept'?'Appointment accepted':decision==='decline'?'Appointment declined':'New appointment time proposed',`${req.user.full_name} ${decision==='accept'?'accepted':decision==='decline'?'declined':'proposed another time'} the appointment${a.property_title?` for ${a.property_title}`:''}.`,{appointment_id:a.id,conversation_id:a.conversation_id});
    res.json({success:true,message:decision==='accept'?'Appointment accepted.':decision==='decline'?'Appointment declined.':'New appointment time proposed.'});
  } catch(e){next(e)}
});

router.post('/conversations/:id/payment-eligibility', requireAuth, async(req,res,next)=>{
  const conn=await pool.getConnection();
  try{
    const c=await getConversation(req.params.id,req.user.id);
    if(!c) return res.status(404).json({success:false,message:'Conversation not found.'});
    await conn.beginTransaction();
    const p1=Number(c.participant_one_id),p2=Number(c.participant_two_id);
    if(c.property_id){
      if(req.user.role!=='provider' || ![p1,p2].includes(Number(req.user.id))){await conn.rollback();return res.status(403).json({success:false,message:'Only the property provider can approve payment eligibility.'});}
      const providerId=Number(req.user.id);
      const studentId=[p1,p2].find(x=>x!==providerId);
      const [prop]=await conn.execute("SELECT * FROM properties WHERE id=? AND provider_id=? AND listing_status='approved' AND is_verified=1 LIMIT 1",[c.property_id,providerId]);
      if(!prop.length){await conn.rollback();return res.status(404).json({success:false,message:'Approved property not found.'});}
      const [appt]=await conn.execute("SELECT * FROM chat_appointments WHERE conversation_id=? AND property_id=? AND status='accepted' ORDER BY id DESC LIMIT 1",[c.id,c.property_id]);
      if(!appt.length){await conn.rollback();return res.status(409).json({success:false,message:'The appointment must be accepted before payment is approved.'});}
      const [existing]=await conn.execute("SELECT * FROM booking_requests WHERE student_id=? AND provider_id=? AND property_id=? AND status IN ('approved','payment_pending','paid','active') ORDER BY id DESC LIMIT 1",[studentId,providerId,c.property_id]);
      let booking=existing[0];
      if(!booking){
        const rent=Number(prop[0].rent||0),agentFee=Number(prop[0].agent_fee||0),serviceFee=Number(prop[0].service_charge||0),deposit=Number(prop[0].security_deposit||0),total=rent+agentFee+serviceFee+deposit;
        const date=new Date(appt[0].scheduled_for); const dateStr=date.toISOString().slice(0,10); const timeStr=date.toTimeString().slice(0,8);
        const [r]=await conn.execute(`INSERT INTO booking_requests (student_id,provider_id,property_id,start_date,end_date,appointment_date,appointment_time,rent_amount,agent_fee,service_fee,security_deposit,total_amount,message,status,student_confirmed_at,responded_at,provider_response) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'approved',NOW(),NOW(),?)`,[studentId,providerId,c.property_id,dateStr,null,dateStr,timeStr,rent,agentFee,serviceFee,deposit,total,'Approved from chat appointment','Payment approved by provider']);
        const [brows]=await conn.execute('SELECT * FROM booking_requests WHERE id=?',[r.insertId]); booking=brows[0];
      }
      await conn.commit();
      await createNotification(studentId,'payment','Payment is ready',`${c.property_title||'Your property'} is approved for protected payment. You can now pay from Bookings & Payments.`,{booking_id:booking.id,property_id:c.property_id});
      return res.json({success:true,message:'Payment eligibility approved. The student can now pay from Bookings & Payments.',booking_id:booking.id,type:'property'});
    }
    if(String(c.context_key||'').startsWith('marketplace:')){
      const itemId=Number(String(c.context_key).split(':')[1]);
      const [item]=await conn.execute('SELECT * FROM marketplace_items WHERE id=? LIMIT 1',[itemId]);
      if(!item.length){await conn.rollback();return res.status(404).json({success:false,message:'Shop item not found.'});}
      if(Number(item[0].seller_id)!==Number(req.user.id)) {await conn.rollback();return res.status(403).json({success:false,message:'Only the seller can approve payment eligibility.'});}
      if(item[0].status!=='available'){await conn.rollback();return res.status(409).json({success:false,message:'This item is no longer available.'});}
      const buyerId=[p1,p2].find(x=>x!==Number(req.user.id));
      const [active]=await conn.execute("SELECT * FROM marketplace_transactions WHERE item_id=? AND status IN ('pending_payment','payment_processing','funds_protected','confirmed','disputed') LIMIT 1",[itemId]);
      if(active.length){await conn.rollback();return res.json({success:true,message:'Payment is already enabled for this item.',transaction_id:active[0].id,type:'marketplace'});}
      const reference=`SN-SHOP-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const [o]=await conn.execute("INSERT INTO marketplace_orders (item_id,buyer_id,seller_id,amount,status) VALUES (?,?,?,?, 'pending_payment')",[itemId,buyerId,req.user.id,item[0].price]);
      const [t]=await conn.execute("INSERT INTO marketplace_transactions (reference,gateway,order_id,item_id,buyer_id,seller_id,total_amount,commission_rate,status) VALUES (?,?,?,?,?,?,?,?,'pending_payment')",[reference,PAYMENT_MODE==='flutterwave'?'flutterwave':'mock',o.insertId,itemId,buyerId,req.user.id,item[0].price,Number(process.env.PLATFORM_COMMISSION_RATE||5)]);
      await conn.commit();
      await createNotification(buyerId,'payment','Payment is ready',`${item[0].title} is approved for protected payment. You can now pay from Student Shop.`,{marketplace_transaction_id:t.insertId,item_id:itemId});
      return res.json({success:true,message:'Payment eligibility approved. The buyer can now pay this item.',transaction_id:t.insertId,type:'marketplace'});
    }
    await conn.rollback(); return res.status(400).json({success:false,message:'This conversation is not linked to a property or shop item.'});
  }catch(e){try{await conn.rollback()}catch{}next(e)}finally{conn.release()}
});

export default router;
