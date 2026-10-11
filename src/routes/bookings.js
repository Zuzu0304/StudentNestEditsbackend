import { Router } from 'express';
import { pool } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { createNotification } from './notifications.js';

const router = Router();
const ACTIVE_STATUSES = ['pending_provider','pending_student_confirmation','approved','payment_pending','paid','active'];

function money(v) { return Number(Number(v || 0).toFixed(2)); }
function overlapClause() {
  return `NOT (br.end_date IS NOT NULL AND br.end_date < ? OR br.start_date > ?)`;
}


router.post('/', requireAuth, requireRole('student'), async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const propertyId = Number(req.body?.property_id);
    const startDate = String(req.body?.start_date || '').trim();
    const endDate = req.body?.end_date ? String(req.body.end_date).trim() : null;
    const message = String(req.body?.message || '').trim();
    if (!propertyId || !startDate) return res.status(400).json({ success:false, message:'property_id and start_date are required.' });
    if (endDate && endDate < startDate) return res.status(400).json({ success:false, message:'end_date cannot be before start_date.' });

    await conn.beginTransaction();
    const [properties] = await conn.execute(`SELECT p.*, u.full_name AS provider_name FROM properties p JOIN users u ON u.id=p.provider_id WHERE p.id=? AND p.listing_status='approved' AND p.is_verified=1 AND p.availability_status='available' LIMIT 1`, [propertyId]);
    if (!properties.length) { await conn.rollback(); return res.status(404).json({success:false,message:'Property is not available for booking.'}); }
    const p = properties[0];

    const [existing] = await conn.execute(`SELECT id FROM booking_requests br WHERE br.property_id=? AND br.status IN (${ACTIVE_STATUSES.map(()=>'?').join(',')}) AND ${overlapClause()} LIMIT 1`, [propertyId, ...ACTIVE_STATUSES, startDate, endDate || startDate]);
    if (existing.length) { await conn.rollback(); return res.status(409).json({success:false,message:'This property already has an active booking request for the selected period.'}); }

    const rent = money(p.rent), agentFee=money(p.agent_fee), serviceFee=money(p.service_charge), securityDeposit=money(p.security_deposit);
    const total = money(rent+agentFee+serviceFee+securityDeposit);
    const [result] = await conn.execute(`INSERT INTO booking_requests (student_id,provider_id,property_id,start_date,end_date,rent_amount,agent_fee,service_fee,security_deposit,total_amount,message,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending_provider')`, [req.user.id,p.provider_id,propertyId,startDate,endDate,rent,agentFee,serviceFee,securityDeposit,total,message || null]);
    await conn.commit();
    res.status(201).json({success:true,message:'Booking request submitted to the provider.',booking_id:result.insertId,status:'pending_provider',total_amount:total});
  } catch(e) { try { await conn.rollback(); } catch {} next(e); } finally { conn.release(); }
});


router.get('/mine', requireAuth, requireRole('student'), async (req,res,next)=>{
  try {
    const [rows]=await pool.execute(`SELECT br.*, p.title AS property_title, p.address, p.area, p.city, u.full_name AS provider_name FROM booking_requests br JOIN properties p ON p.id=br.property_id JOIN users u ON u.id=br.provider_id WHERE br.student_id=? ORDER BY br.requested_at DESC`,[req.user.id]);
    res.json({success:true,bookings:rows});
  } catch(e){next(e)}
});


router.get('/provider', requireAuth, requireRole('provider'), async (req,res,next)=>{
  try {
    const [rows]=await pool.execute(`SELECT br.*, p.title AS property_title, p.address, p.area, p.city, u.full_name AS student_name, u.email AS student_email FROM booking_requests br JOIN properties p ON p.id=br.property_id JOIN users u ON u.id=br.student_id WHERE br.provider_id=? ORDER BY br.requested_at DESC`,[req.user.id]);
    res.json({success:true,bookings:rows});
  } catch(e){next(e)}
});


router.patch('/:id/respond', requireAuth, requireRole('provider'), async (req,res,next)=>{
  const conn=await pool.getConnection();
  try{
    const id=Number(req.params.id), decision=String(req.body?.decision||'').toLowerCase(), response=String(req.body?.response||'').trim();
    if(!['approve','reject'].includes(decision)) return res.status(400).json({success:false,message:'decision must be approve or reject.'});
    await conn.beginTransaction();
    const [rows]=await conn.execute(`SELECT * FROM booking_requests WHERE id=? AND provider_id=? FOR UPDATE`,[id,req.user.id]);
    if(!rows.length){await conn.rollback();return res.status(404).json({success:false,message:'Booking request not found.'});}
    const b=rows[0];
    if(b.status!=='pending_provider'){await conn.rollback();return res.status(409).json({success:false,message:'Only pending booking requests can be responded to.'});}
    if(decision==='approve'){
      const [conflict]=await conn.execute(`SELECT id FROM booking_requests WHERE property_id=? AND id<>? AND status IN (${ACTIVE_STATUSES.filter(s=>s!=='pending_provider').map(()=>'?').join(',')}) AND ${overlapClause()} LIMIT 1`,[b.property_id,id,...ACTIVE_STATUSES.filter(s=>s!=='pending_provider'),b.start_date,b.end_date||b.start_date]);
      if(conflict.length){await conn.rollback();return res.status(409).json({success:false,message:'This property is no longer available for the selected period.'});}
      await conn.execute(`UPDATE booking_requests SET status='approved',provider_response=?,responded_at=NOW() WHERE id=?`,[response||null,id]);
      await conn.commit(); return res.json({success:true,message:'Booking request approved. Student can proceed to payment.',status:'approved'});
    }
    await conn.execute(`UPDATE booking_requests SET status='rejected',provider_response=?,responded_at=NOW() WHERE id=?`,[response||null,id]);
    await conn.commit(); res.json({success:true,message:'Booking request rejected.',status:'rejected'});
  }catch(e){try{await conn.rollback()}catch{}next(e)}finally{conn.release()}
});



router.post('/:id/accept', requireAuth, requireRole('student'), async(req,res,next)=>{
  const conn=await pool.getConnection();
  try{
    await conn.beginTransaction();
    const [rows]=await conn.execute('SELECT * FROM booking_requests WHERE id=? AND student_id=? FOR UPDATE',[req.params.id,req.user.id]);
    if(!rows.length){await conn.rollback();return res.status(404).json({success:false,message:'Booking request not found.'});}
    const b=rows[0];
    if(b.status!=='pending_student_confirmation'){await conn.rollback();return res.status(409).json({success:false,message:'This appointment is not waiting for your confirmation.'});}
    if(!b.appointment_date||!b.appointment_time){await conn.rollback();return res.status(409).json({success:false,message:'The provider has not proposed a complete appointment yet.'});}
    await conn.execute("UPDATE booking_requests SET status='approved',student_confirmed_at=NOW() WHERE id=?",[b.id]);
    if(b.inquiry_id) await conn.execute("UPDATE inquiries SET appointment_status='accepted' WHERE id=? AND student_id=?",[b.inquiry_id,req.user.id]);
    await conn.commit();
    await createNotification(b.provider_id,'booking_confirmed','Viewing appointment confirmed',`${req.user.full_name} accepted the viewing appointment for ${b.appointment_date} at ${b.appointment_time}.`,{booking_id:b.id,property_id:b.property_id,appointment_date:b.appointment_date,appointment_time:b.appointment_time});
    res.json({success:true,message:'Viewing appointment accepted. You can now choose to make payment or wait until after inspection.',status:'approved'});
  }catch(e){try{await conn.rollback()}catch{}next(e)}finally{conn.release()}
});


router.patch('/:id/cancel', requireAuth, requireRole('student'), async (req,res,next)=>{
  try{
    const [rows]=await pool.execute(`SELECT id,status FROM booking_requests WHERE id=? AND student_id=? LIMIT 1`,[req.params.id,req.user.id]);
    if(!rows.length)return res.status(404).json({success:false,message:'Booking request not found.'});
    if(!['pending_provider','approved','payment_pending'].includes(rows[0].status))return res.status(409).json({success:false,message:'This booking cannot be cancelled at its current stage.'});
    await pool.execute(`UPDATE booking_requests SET status='cancelled',cancelled_at=NOW() WHERE id=?`,[req.params.id]);
    res.json({success:true,message:'Booking request cancelled.',status:'cancelled'});
  }catch(e){next(e)}
});


router.get('/:id', requireAuth, async (req,res,next)=>{
  try{
    const [rows]=await pool.execute(`SELECT br.*, p.title AS property_title,p.address,p.area,p.city,u.full_name AS student_name,pr.full_name AS provider_name FROM booking_requests br JOIN properties p ON p.id=br.property_id JOIN users u ON u.id=br.student_id JOIN users pr ON pr.id=br.provider_id WHERE br.id=? AND (br.student_id=? OR br.provider_id=? OR ? IN ('admin','agent')) LIMIT 1`,[req.params.id,req.user.id,req.user.id,req.user.role]);
    if(!rows.length)return res.status(404).json({success:false,message:'Booking not found.'});
    res.json({success:true,booking:rows[0]});
  }catch(e){next(e)}
});

export default router;
