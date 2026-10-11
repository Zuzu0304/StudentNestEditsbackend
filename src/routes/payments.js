import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { createNotification } from './notifications.js';

const router = Router();
const PAYMENT_MODE = process.env.PAYMENT_MODE || 'mock';
const FLW_BASE = 'https://api.flutterwave.com/v3';
const CHANNELS = ['card', 'bank_transfer', 'ussd', 'mobilemoneyghana', 'bank'];
const COMMISSION_RATE = Number(process.env.PLATFORM_COMMISSION_RATE || 5);
const PAYER_CHANNELS = ['bank_transfer', 'ussd', 'card', 'direct_debit'];

function money(v) { return Number(Number(v || 0).toFixed(2)); }
function splitCommission(total) {
  const commission = money(Number(total) * COMMISSION_RATE / 100);
  return { rate: COMMISSION_RATE, commission, providerShare: money(Number(total) - commission) };
}
function json(v) { try { return typeof v === 'string' ? JSON.parse(v) : (v ?? []); } catch { return []; } }
async function createProviderPaymentNotice(conn,t){ await createNotification(t.provider_id,'payment_received','StudentNest payment received',`A protected payment was made for property #${t.property_id}. Funds remain protected until the student confirms the property or a dispute is resolved.`,{transaction_id:t.id,property_id:t.property_id},conn); }
function txView(r) {
  return {
    ...r,
    rent_amount: money(r.rent_amount), agent_fee: money(r.agent_fee), service_fee: money(r.service_fee),
    security_deposit: money(r.security_deposit), total_amount: money(r.total_amount), gateway_fee: money(r.gateway_fee),
    evidence: r.evidence ? json(r.evidence) : undefined
  };
}

async function flutterwave(path, options = {}) {
  if (!process.env.FLW_SECRET_KEY) throw new Error('Flutterwave secret key is not configured. Use PAYMENT_MODE=mock for local testing.');
  const response = await fetch(`${FLW_BASE}${path}`, {
    method: options.method || 'GET',
    headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  if (!response.ok || data.status === false) throw new Error(data.message || 'Payment gateway request failed.');
  return data;
}


router.get('/quote/:propertyId', requireAuth, requireRole('student'), async (req, res, next) => {
  try {
    const [rows] = await pool.execute(`SELECT id,title,rent,agent_fee,service_charge,security_deposit,total_cost,availability_status,listing_status,is_verified
      FROM properties WHERE id=? LIMIT 1`, [req.params.propertyId]);
    if (!rows.length) return res.status(404).json({ success:false, message:'Property not found.' });
    const p = rows[0];
    if (p.listing_status !== 'approved' || !p.is_verified || p.availability_status !== 'available') return res.status(409).json({success:false,message:'This property is not currently available for secure payment.'});
    const rent=money(p.rent), agentFee=money(p.agent_fee), serviceFee=money(p.service_charge), securityDeposit=money(p.security_deposit);
    
    res.json({success:true,quote:{property_id:p.id,title:p.title,currency:'NGN',rent_amount:rent,agent_fee:agentFee,service_fee:serviceFee,security_deposit:securityDeposit,total_amount:money(rent+agentFee+serviceFee+securityDeposit)}});
  } catch(e){next(e)}
});


router.post('/provider/bank-account', requireAuth, requireRole('provider'), async (req,res,next)=>{
  try {
    const {bank_name,account_name,account_number} = req.body || {};
    if(!bank_name || !account_name || !account_number) return res.status(400).json({success:false,message:'Bank name, account name and account number are required.'});
    const values=[String(bank_name).trim(),String(account_name).trim(),String(account_number).trim()];
    const [existing]=await pool.execute('SELECT id FROM provider_bank_accounts WHERE provider_id=? ORDER BY created_at DESC LIMIT 1',[req.user.id]);
    if(existing.length){
      await pool.execute(`UPDATE provider_bank_accounts SET bank_name=?,account_name=?,account_number=?,verification_status='verified',verification_note=NULL,verified_at=NOW() WHERE id=? AND provider_id=?`,[...values,existing[0].id,req.user.id]);
      return res.json({success:true,message:'Payment details updated successfully.',account:{id:existing[0].id,bank_name:values[0],account_name:values[1],account_number_last4:values[2].slice(-4),verification_status:'verified'}});
    }
    const [result]=await pool.execute(`INSERT INTO provider_bank_accounts (provider_id,bank_name,account_name,account_number,verification_status,verified_at) VALUES (?,?,?,?,'verified',NOW())`,[req.user.id,...values]);
    res.status(201).json({success:true,message:'Payment details saved successfully.',account:{id:result.insertId,bank_name:values[0],account_name:values[1],account_number_last4:values[2].slice(-4),verification_status:'verified'}});
  }catch(e){next(e)}
});

router.get('/provider/bank-account', requireAuth, requireRole('provider'), async(req,res,next)=>{
  try { const [rows]=await pool.execute(`SELECT id,bank_name,account_name,RIGHT(account_number,4) AS account_number_last4,verification_status,verification_note,verified_at,created_at FROM provider_bank_accounts WHERE provider_id=? ORDER BY created_at DESC`,[req.user.id]); res.json({success:true,bank_accounts:rows}); }
  catch(e){next(e)}
});


router.post('/initialize', requireAuth, requireRole('student'), async(req,res,next)=>{
  const conn=await pool.getConnection();
  try {
    const propertyId=Number(req.body?.property_id), bookingId=Number(req.body?.booking_id);
    if(!propertyId || !bookingId) return res.status(400).json({success:false,message:'property_id and booking_id are required.'});
    await conn.beginTransaction();
    const [bRows]=await conn.execute(`SELECT * FROM booking_requests WHERE id=? AND student_id=? AND property_id=? FOR UPDATE`,[bookingId,req.user.id,propertyId]);
    if(!bRows.length || bRows[0].status!=='approved'){await conn.rollback();return res.status(409).json({success:false,message:'Only an approved booking request can be paid for.'});}
    const [pRows]=await conn.execute(`SELECT p.*,u.email AS provider_email FROM properties p JOIN users u ON u.id=p.provider_id WHERE p.id=? FOR UPDATE`,[propertyId]);
    if(!pRows.length){await conn.rollback();return res.status(404).json({success:false,message:'Property not found.'});}
    const p=pRows[0];
    if(p.listing_status!=='approved'||!p.is_verified||p.availability_status!=='available'){await conn.rollback();return res.status(409).json({success:false,message:'Property is not eligible for secure payment.'});}
    const [bankRows]=await conn.execute(`SELECT * FROM provider_bank_accounts WHERE provider_id=? AND verification_status='verified' ORDER BY verified_at DESC LIMIT 1`,[p.provider_id]);
    if(!bankRows.length){await conn.rollback();return res.status(409).json({success:false,message:'Provider has not yet added a verified payout account.'});}
    const [active]=await conn.execute(`SELECT id FROM payment_transactions WHERE property_id=? AND status IN ('pending_payment','payment_processing','funds_protected','inspection_pending','disputed') LIMIT 1`,[propertyId]);
    if(active.length){await conn.rollback();return res.status(409).json({success:false,message:'This property already has an active protected transaction.'});}
    const rent=money(p.rent),agentFee=money(p.agent_fee),serviceFee=money(p.service_charge),securityDeposit=money(p.security_deposit),total=money(rent+agentFee+serviceFee+securityDeposit);
    const reference=`SN-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`.toUpperCase();
    const [result]=await conn.execute(`INSERT INTO payment_transactions (reference,gateway,student_id,provider_id,property_id,booking_id,bank_account_id,rent_amount,agent_fee,service_fee,security_deposit,total_amount,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'pending_payment')`,[reference,PAYMENT_MODE==='mock'?'mock':'flutterwave',req.user.id,p.provider_id,propertyId,bookingId,bankRows[0].id,rent,agentFee,serviceFee,securityDeposit,total]);
    await conn.execute("UPDATE booking_requests SET status='payment_pending', payment_transaction_id=? WHERE id=?",[result.insertId,bookingId]);
    await conn.commit();

    if(PAYMENT_MODE==='mock') {
      return res.status(201).json({success:true,mode:'mock',message:'Test transaction created. No real money was charged.',transaction:{id:result.insertId,reference,total_amount:total,currency:'NGN',status:'pending_payment'},test_actions:{mark_paid:`POST /api/payments/${result.insertId}/mock-success`}});
    }

    const payment=await flutterwave('/payments',{method:'POST',body:{tx_ref:reference,amount:total,currency:'NGN',redirect_url:process.env.FLW_REDIRECT_URL||'http://localhost:5173/payment/callback',customer:{email:req.user.email,name:req.user.full_name},payment_options:CHANNELS.join(','),meta:{studentnest_transaction_id:result.insertId,protected_transaction:true}}});
    const link=payment?.data?.link || null;
    await pool.execute(`UPDATE payment_transactions SET status='payment_processing' WHERE id=?`,[result.insertId]);
    res.status(201).json({success:true,mode:'flutterwave',transaction:{id:result.insertId,reference,total_amount:total,currency:'NGN',status:'payment_processing'},authorization_url:link});
  }catch(e){try{await conn.rollback()}catch{}next(e)}finally{conn.release()}
});

router.get('/mine', requireAuth, requireRole('student','provider'), async(req,res,next)=>{
  try {
    const where=req.user.role==='student'?'t.student_id=?':'t.provider_id=?';
    const [rows]=await pool.execute(`SELECT t.*,p.title AS property_title,p.address,p.area,u.full_name AS student_name,u.phone AS student_phone,pr.full_name AS provider_name FROM payment_transactions t JOIN properties p ON p.id=t.property_id JOIN users u ON u.id=t.student_id JOIN users pr ON pr.id=t.provider_id WHERE ${where} ORDER BY t.created_at DESC`,[req.user.id]);
    res.json({success:true,transactions:rows.map(txView)});
  }catch(e){next(e)}
});

router.get('/:id', requireAuth, async(req,res,next)=>{
  try {
    const [rows]=await pool.execute(`SELECT t.*,p.title AS property_title,p.address,p.area,p.city,u.full_name AS student_name,pr.full_name AS provider_name FROM payment_transactions t JOIN properties p ON p.id=t.property_id JOIN users u ON u.id=t.student_id JOIN users pr ON pr.id=t.provider_id WHERE t.id=? AND (t.student_id=? OR t.provider_id=? OR ?='admin') LIMIT 1`,[req.params.id,req.user.id,req.user.id,req.user.role]);
    if(!rows.length)return res.status(404).json({success:false,message:'Transaction not found.'});
    const [disputes]=await pool.execute(`SELECT * FROM payment_disputes WHERE transaction_id=? ORDER BY created_at DESC`,[req.params.id]);
    res.json({success:true,transaction:txView(rows[0]),disputes});
  }catch(e){next(e)}
});


router.post('/:id/mock-success', requireAuth, requireRole('student'), async(req,res,next)=>{
  if(PAYMENT_MODE!=='mock') return res.status(403).json({success:false,message:'Mock payment actions are disabled.'});
  const channel=String(req.body?.payment_method||req.body?.channel||'').trim();
  const accountName=String(req.body?.account_name||'').trim();
  const accountNumber=String(req.body?.account_number||'').trim();
  if(!PAYER_CHANNELS.includes(channel)) return res.status(400).json({success:false,message:'Choose a payment method: bank transfer, USSD, card, or direct debit.'});
  if(!accountName || !accountNumber) return res.status(400).json({success:false,message:'Enter the account name and number you are paying from (test values are fine in mock mode).'});
  const conn=await pool.getConnection();
  try{await conn.beginTransaction();const [rows]=await conn.execute(`SELECT * FROM payment_transactions WHERE id=? AND student_id=? FOR UPDATE`,[req.params.id,req.user.id]);if(!rows.length){await conn.rollback();return res.status(404).json({success:false,message:'Transaction not found.'});}const t=rows[0];if(t.status!=='pending_payment'){await conn.rollback();return res.status(409).json({success:false,message:'Transaction is not awaiting payment.'});}const deadline=new Date(Date.now()+7*24*60*60*1000);await conn.execute(`UPDATE payment_transactions SET status='funds_protected',gateway_transaction_id=?,paid_at=NOW(),inspection_deadline=?,payment_method=?,payer_channel=?,payer_account_name=?,payer_account_number=? WHERE id=?`,[`MOCK-${t.reference}`,deadline,channel,channel,accountName,accountNumber,req.params.id]);await conn.execute(`UPDATE properties SET availability_status='reserved' WHERE id=?`,[t.property_id]);
  await createProviderPaymentNotice(conn,t);
  if(t.booking_id) await conn.execute(`UPDATE booking_requests SET status='paid' WHERE id=? AND status='payment_pending'`,[t.booking_id]);await conn.execute(`INSERT INTO payment_events (transaction_id,gateway,gateway_event_id,event_type,payload,processed) VALUES (?,?,?,?,?,1)`,[req.params.id,'mock',`MOCK-${t.reference}`,'payment.success',JSON.stringify({reference:t.reference,amount:t.total_amount,channel}),]);await conn.commit();res.json({success:true,message:'Test payment recorded. Funds are protected for the 7-day inspection window.',status:'funds_protected',inspection_deadline:deadline});}catch(e){try{await conn.rollback()}catch{}next(e)}finally{conn.release()}
});


router.post('/:id/confirm', requireAuth, requireRole('student'), async(req,res,next)=>{
  const conn=await pool.getConnection();
  try{await conn.beginTransaction();const [rows]=await conn.execute(`SELECT * FROM payment_transactions WHERE id=? AND student_id=? FOR UPDATE`,[req.params.id,req.user.id]);if(!rows.length){await conn.rollback();return res.status(404).json({success:false,message:'Transaction not found.'});}const t=rows[0];if(!['funds_protected','inspection_pending'].includes(t.status)){await conn.rollback();return res.status(409).json({success:false,message:'This transaction is not awaiting confirmation.'});}if(t.inspection_deadline && new Date(t.inspection_deadline)<new Date()){await conn.rollback();return res.status(409).json({success:false,message:'The inspection deadline has passed. Please contact StudentNest support.'});}await conn.execute(`UPDATE payment_transactions SET status='confirmed',confirmed_at=NOW() WHERE id=?`,[req.params.id]);
    await conn.execute(`UPDATE properties SET availability_status='occupied' WHERE id=?`,[t.property_id]);
    if(t.booking_id) await conn.execute(`UPDATE booking_requests SET status='active' WHERE id=? AND status='paid'`,[t.booking_id]);await conn.commit();res.json({success:true,message:'Accommodation confirmed. The transaction is ready for provider release through the payment gateway.',status:'confirmed',next_action:'admin_release'});}catch(e){try{await conn.rollback()}catch{}next(e)}finally{conn.release()}
});

router.post('/:id/dispute', requireAuth, requireRole('student'), async(req,res,next)=>{
  const conn=await pool.getConnection();
  try{await conn.beginTransaction();const [rows]=await conn.execute(`SELECT * FROM payment_transactions WHERE id=? AND student_id=? FOR UPDATE`,[req.params.id,req.user.id]);if(!rows.length){await conn.rollback();return res.status(404).json({success:false,message:'Transaction not found.'});}const t=rows[0];if(!['funds_protected','inspection_pending'].includes(t.status)){await conn.rollback();return res.status(409).json({success:false,message:'A dispute can only be opened while funds are protected.'});}const reason=String(req.body?.reason||'Property does not match listing').trim();const description=String(req.body?.description||'').trim();if(!description)return res.status(400).json({success:false,message:'Please describe the problem.'});const evidence=Array.isArray(req.body?.evidence)?req.body.evidence:[];const [d]=await conn.execute(`INSERT INTO payment_disputes (transaction_id,property_id,student_id,reason,description,evidence) VALUES (?,?,?,?,?,?)`,[req.params.id,t.property_id,req.user.id,reason,description,JSON.stringify(evidence)]);await conn.execute(`UPDATE payment_transactions SET status='disputed' WHERE id=?`,[req.params.id]);await conn.execute(`INSERT INTO payment_events (transaction_id,gateway,gateway_event_id,event_type,payload,processed) VALUES (?,?,?,?,?,1)`,[req.params.id,t.gateway,`DISPUTE-${d.insertId}`,'transaction.disputed',JSON.stringify({reason,description}),]);await conn.commit();res.status(201).json({success:true,message:'Dispute submitted. Funds remain protected while StudentNest investigates.',dispute_id:d.insertId,status:'disputed'});}catch(e){try{await conn.rollback()}catch{}next(e)}finally{conn.release()}
});


router.post('/webhook/flutterwave', async(req,res)=>{
  try {
    const expected=process.env.FLW_SECRET_HASH;
    const received=req.headers['flutterwave-signature'] || req.headers['verif-hash'];
    if(!expected || !received || received!==expected) return res.status(401).json({success:false,message:'Invalid webhook signature.'});
    const data=req.body?.data||{}; const reference=data.tx_ref || data.txRef || null; if(!reference) return res.sendStatus(200);
    const [rows]=await pool.execute(`SELECT * FROM payment_transactions WHERE reference=? LIMIT 1`,[reference]); if(!rows.length)return res.sendStatus(200);
    const t=rows[0]; const eventId=req.body?.id || data.id || `EVENT-${reference}-${data.status}`;
    try { await pool.execute(`INSERT INTO payment_events (transaction_id,gateway,gateway_event_id,event_type,payload,processed) VALUES (?,?,?,?,?,0)`,[t.id,'flutterwave',String(eventId),String(req.body?.type||'payment.update'),JSON.stringify(req.body)]); } catch(e) { if(e.code==='ER_DUP_ENTRY') return res.sendStatus(200); throw e; }
    
    if(data.status==='successful') {
      try {
        const verified=await flutterwave(`/transactions/${data.id}/verify`);
        const vd=verified?.data;
        if(vd?.status==='successful' && Number(vd.amount)===Number(t.total_amount) && String(vd.currency)==='NGN' && String(vd.tx_ref)===String(t.reference)) {
          const deadline=new Date(Date.now()+7*24*60*60*1000);
          await pool.execute(`UPDATE payment_transactions SET status='funds_protected',gateway_transaction_id=?,paid_at=NOW(),inspection_deadline=?,payment_method=?,payer_channel=? WHERE id=? AND status IN ('pending_payment','payment_processing')`,[String(vd.id),deadline,vd.payment_type||null,vd.payment_type||null,t.id]);
          await pool.execute(`UPDATE booking_requests SET status='paid' WHERE id=? AND status='payment_pending'`,[t.booking_id]);
          await pool.execute(`UPDATE properties SET availability_status='reserved' WHERE id=?`,[t.property_id]);
          await createProviderPaymentNotice(pool,t);
          await pool.execute(`UPDATE payment_events SET processed=1 WHERE gateway=? AND gateway_event_id=?`,['flutterwave',String(eventId)]);
        }
      } catch(e) { console.error('Webhook verification failed:',e.message); }
    }
    return res.sendStatus(200);
  } catch(e) { console.error(e); return res.sendStatus(200); }
});

export default router;
