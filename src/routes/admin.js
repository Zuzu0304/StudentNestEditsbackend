import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { createNotification } from './notifications.js';

const router = Router();



router.get('/users', requireAuth, requireRole('admin'), async (req,res,next)=>{
  try {
    const [rows]=await pool.execute(`SELECT id,full_name,email,phone,role,is_verified,is_active,created_at FROM users ORDER BY created_at DESC`);
    res.json({success:true,users:rows});
  } catch(e){next(e)}
});
router.patch('/users/:id/status', requireAuth, requireRole('admin'), async(req,res,next)=>{
  try {
    const active=Boolean(req.body?.is_active);
    const [result]=await pool.execute("UPDATE users SET is_active=? WHERE id=? AND role<>'admin'", [active,req.params.id]);
    if(!result.affectedRows)return res.status(404).json({success:false,message:'User not found or cannot be changed.'});
    res.json({success:true,message:active?'User reactivated.':'User suspended.',is_active:active});
  }catch(e){next(e)}
});

router.get('/access-check', requireAuth, requireRole('admin'), (req, res) =>
  res.json({ success:true, message:'Admin access verified.', user:{id:req.user.id,role:req.user.role} })
);


router.post('/inspectors', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { fullName, email, phone='', password } = req.body || {};
    const e = String(email || '').trim().toLowerCase();
    if (!String(fullName || '').trim() || !e || !password || password.length < 8) {
      return res.status(400).json({ success:false, message:'Full name, email and a password of at least 8 characters are required.' });
    }
    const [exists] = await pool.execute('SELECT id FROM users WHERE email=? LIMIT 1', [e]);
    if (exists.length) return res.status(409).json({ success:false, message:'An account with that email already exists.' });
    const hash = await bcrypt.hash(password, 12);
    const [result] = await pool.execute('INSERT INTO users (full_name,email,phone,password_hash,role,is_verified) VALUES (?,?,?,?,\'inspector\',1)', [String(fullName).trim(), e, String(phone).trim() || null, hash]);
    res.status(201).json({ success:true, message:'Inspector created.', inspector:{id:result.insertId,fullName:String(fullName).trim(),email:e,role:'inspector'} });
  } catch (e) { next(e); }
});


router.get('/inspectors', requireAuth, requireRole('admin'), async(req,res,next)=>{
  try{const [rows]=await pool.execute("SELECT id,full_name,email,phone,is_active,created_at FROM users WHERE role='inspector' ORDER BY full_name ASC");res.json({success:true,inspectors:rows});}catch(e){next(e)}
});


router.post('/payment-disputes/:id/assign-inspector', requireAuth, requireRole('admin'), async(req,res,next)=>{
  try{
    const inspectorId=Number(req.body?.inspector_id ?? req.body?.agent_id);
    if(!inspectorId)return res.status(400).json({success:false,message:'inspector_id is required.'});
    const [inspectors]=await pool.execute("SELECT id,full_name FROM users WHERE id=? AND role='inspector' AND is_active=1 LIMIT 1",[inspectorId]);
    if(!inspectors.length)return res.status(400).json({success:false,message:'Selected inspector is invalid or inactive.'});
    const [disputes]=await pool.execute('SELECT id,property_id FROM payment_disputes WHERE id=? AND status IN (\'open\',\'investigating\') LIMIT 1',[req.params.id]);
    if(!disputes.length)return res.status(404).json({success:false,message:'Open complaint not found.'});
    await pool.execute("UPDATE payment_disputes SET agent_id=?,status='investigating',agent_result='pending',assigned_at=NOW() WHERE id=?",[inspectorId,req.params.id]);
    res.json({success:true,message:`Complaint assigned to ${inspectors[0].full_name}.`,inspector:inspectors[0]});
  }catch(e){next(e)}
});


router.get('/inspections', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { result='pending', status } = req.query;
    const where=[]; const params=[];
    if (result && ['pending','pass','fail'].includes(result)) { where.push('i.result=?'); params.push(result); }
    if (status && ['assigned','in_progress','completed','cancelled'].includes(status)) { where.push('i.status=?'); params.push(status); }
    const [rows] = await pool.execute(`SELECT i.id,i.property_id,i.agent_id,i.status,i.result,i.notes,i.inspected_at,i.submitted_at,
      p.title AS property_title,p.address,p.area,p.city,p.listing_status,p.verification_status,
      u.full_name AS provider_name,a.full_name AS agent_name
      FROM property_inspections i JOIN properties p ON p.id=i.property_id
      LEFT JOIN users u ON u.id=p.provider_id LEFT JOIN users a ON a.id=i.agent_id
      ${where.length ? 'WHERE '+where.join(' AND ') : ''} ORDER BY i.created_at DESC`, params);
    res.json({success:true,inspections:rows});
  } catch(e){next(e)}
});


router.get('/properties/pending', requireAuth, requireRole('admin'), async (req,res,next)=>{
  try{
    const [rows]=await pool.execute(`SELECT p.*,u.full_name AS provider_name,u.email AS provider_email,u.phone AS provider_phone,
      (SELECT i.id FROM property_inspections i WHERE i.property_id=p.id ORDER BY i.created_at DESC LIMIT 1) AS inspection_id,
      (SELECT i.result FROM property_inspections i WHERE i.property_id=p.id ORDER BY i.created_at DESC LIMIT 1) AS inspection_result,
      (SELECT i.status FROM property_inspections i WHERE i.property_id=p.id ORDER BY i.created_at DESC LIMIT 1) AS inspection_status,
      (SELECT i.submitted_at FROM property_inspections i WHERE i.property_id=p.id ORDER BY i.created_at DESC LIMIT 1) AS inspection_submitted_at,
      (SELECT a.full_name FROM property_inspections i LEFT JOIN users a ON a.id=i.agent_id WHERE i.property_id=p.id ORDER BY i.created_at DESC LIMIT 1) AS inspection_agent_name,
      (SELECT a.email FROM property_inspections i LEFT JOIN users a ON a.id=i.agent_id WHERE i.property_id=p.id ORDER BY i.created_at DESC LIMIT 1) AS inspection_agent_email
      FROM properties p JOIN users u ON u.id=p.provider_id
      WHERE p.listing_status='pending' ORDER BY p.submitted_at ASC`);
    res.json({success:true,properties:rows});
  }catch(e){next(e)}
});

router.get('/properties/:id/inspection-details', requireAuth, requireRole('admin'), async (req,res,next)=>{
  try{
    const [rows]=await pool.execute(`SELECT i.*,p.title AS property_title,p.address,p.area,p.city,p.rent,p.images,p.amenities,
      p.listing_status,p.verification_status,u.full_name AS provider_name,u.email AS provider_email,u.phone AS provider_phone,
      a.full_name AS agent_name,a.email AS agent_email,a.phone AS agent_phone
      FROM property_inspections i JOIN properties p ON p.id=i.property_id
      JOIN users u ON u.id=p.provider_id LEFT JOIN users a ON a.id=i.agent_id
      WHERE p.id=? ORDER BY i.created_at DESC`,[req.params.id]);
    if(!rows.length) return res.status(404).json({success:false,message:'No inspection record exists for this property yet.'});
    res.json({success:true,inspections:rows});
  }catch(e){next(e)}
});


router.post('/properties/:id/decision', requireAuth, requireRole('admin'), async(req,res,next)=>{
  const conn=await pool.getConnection();
  try{
    await conn.beginTransaction();
    const decision=String(req.body?.decision||'').toLowerCase();
    const reason=String(req.body?.reason||'').trim()||null;
    if(!['approve','reject'].includes(decision)){await conn.rollback();return res.status(400).json({success:false,message:'Decision must be approve or reject.'});}
    const [rows]=await conn.execute(`SELECT p.*, (SELECT result FROM property_inspections i WHERE i.property_id=p.id ORDER BY i.created_at DESC LIMIT 1) AS latest_inspection_result FROM properties p WHERE p.id=? FOR UPDATE`,[req.params.id]);
    if(!rows.length){await conn.rollback();return res.status(404).json({success:false,message:'Property not found.'});}
    const p=rows[0];
    if(p.listing_status!=='pending'){await conn.rollback();return res.status(409).json({success:false,message:'Only pending properties can receive a moderation decision.'});}
    if(decision==='approve' && p.latest_inspection_result!=='pass'){await conn.rollback();return res.status(409).json({success:false,message:'Property cannot be approved until a StudentNest inspection passes.'});}
    if(decision==='approve'){
      await conn.execute(`UPDATE properties SET listing_status='approved',is_verified=1,verification_status='inspection_passed',verification_notes=?,rejection_reason=NULL,approved_at=NOW(),verified_at=NOW() WHERE id=?`,[reason,req.params.id]);
    }else{
      await conn.execute(`UPDATE properties SET listing_status='rejected',is_verified=0,rejection_reason=?,verification_status='inspection_failed',approved_at=NULL,verified_at=NULL WHERE id=?`,[reason||'Property was not approved by admin.',req.params.id]);
    }
    await conn.commit();
    res.json({success:true,message:decision==='approve'?'Property approved and published.':'Property rejected.',decision});
  }catch(e){try{await conn.rollback()}catch{}next(e)}finally{conn.release()}
});


/* -------------------------------------------------------
   STUDENT SHOP / MARKETPLACE
------------------------------------------------------- */

const marketplaceSplit = (total, rate = Number(process.env.PLATFORM_COMMISSION_RATE || 5)) => {
  const gross = Number(Number(total || 0).toFixed(2));
  const commission = Number((gross * Number(rate) / 100).toFixed(2));
  return { rate:Number(rate), commission, sellerPayout:Number((gross - commission).toFixed(2)) };
};

router.get('/marketplace/items', requireAuth, requireRole('admin'), async (req,res,next)=>{
  try {
    const [rows] = await pool.execute(`SELECT i.*,u.full_name AS seller_name,u.email AS seller_email,u.phone AS seller_phone
      FROM marketplace_items i JOIN users u ON u.id=i.seller_id ORDER BY i.created_at DESC`);
    res.json({success:true,items:rows.map(x=>({...x,images:typeof x.images==='string'?(JSON.parse(x.images||'[]')):x.images}))});
  } catch(e){next(e)}
});

router.get('/marketplace/transactions', requireAuth, requireRole('admin'), async (req,res,next)=>{
  try {
    const status=String(req.query?.status||'').trim(); const params=[]; let where='';
    if(status){where='WHERE t.status=?';params.push(status)}
    const [rows]=await pool.execute(`SELECT t.*,i.title AS item_title,i.category,i.images,
      b.full_name AS buyer_name,b.email AS buyer_email,b.phone AS buyer_phone,
      s.full_name AS seller_name,s.email AS seller_email,s.phone AS seller_phone,
      a.bank_name,a.account_name,a.account_number,a.verification_status AS bank_verification
      FROM marketplace_transactions t JOIN marketplace_items i ON i.id=t.item_id
      JOIN users b ON b.id=t.buyer_id JOIN users s ON s.id=t.seller_id
      LEFT JOIN student_payout_accounts a ON a.id=(SELECT x.id FROM student_payout_accounts x WHERE x.student_id=t.seller_id ORDER BY x.created_at DESC LIMIT 1)
      ${where} ORDER BY t.created_at DESC`,params);
    res.json({success:true,transactions:rows.map(x=>({...x,images:typeof x.images==='string'?JSON.parse(x.images||'[]'):x.images,total_amount:Number(x.total_amount),platform_commission_amount:x.platform_commission_amount==null?null:Number(x.platform_commission_amount),seller_payout_amount:x.seller_payout_amount==null?null:Number(x.seller_payout_amount)}))});
  }catch(e){next(e)}
});

router.get('/marketplace/disputes', requireAuth, requireRole('admin'), async(req,res,next)=>{
  try {
    const [rows]=await pool.execute(`SELECT d.*,t.reference,t.total_amount,i.title AS item_title,i.images,
      b.full_name AS buyer_name,b.email AS buyer_email,b.phone AS buyer_phone,
      s.full_name AS seller_name,s.email AS seller_email,s.phone AS seller_phone,
      a.full_name AS assigned_agent_name
      FROM marketplace_disputes d JOIN marketplace_transactions t ON t.id=d.transaction_id
      JOIN marketplace_items i ON i.id=d.item_id JOIN users b ON b.id=d.buyer_id JOIN users s ON s.id=t.seller_id
      LEFT JOIN users a ON a.id=d.agent_id
      WHERE d.status IN ('open','investigating') ORDER BY d.created_at ASC`);
    res.json({success:true,disputes:rows});
  }catch(e){next(e)}
});

router.post('/marketplace/disputes/:id/assign-inspector', requireAuth, requireRole('admin'), async(req,res,next)=>{
  try{
    const inspectorId=Number(req.body?.inspector_id ?? req.body?.agent_id); if(!inspectorId)return res.status(400).json({success:false,message:'inspector_id is required.'});
    const [inspectors]=await pool.execute("SELECT id,full_name FROM users WHERE id=? AND role='inspector' AND is_active=1 LIMIT 1",[inspectorId]);
    if(!inspectors.length)return res.status(400).json({success:false,message:'Selected inspector is invalid or inactive.'});
    const [d]=await pool.execute("SELECT id FROM marketplace_disputes WHERE id=? AND status IN ('open','investigating') LIMIT 1",[req.params.id]);
    if(!d.length)return res.status(404).json({success:false,message:'Open marketplace complaint not found.'});
    await pool.execute("UPDATE marketplace_disputes SET agent_id=?,status='investigating',agent_result='pending',assigned_at=NOW() WHERE id=?",[inspectorId,req.params.id]);
    res.json({success:true,message:`Complaint assigned to ${inspectors[0].full_name}.`,inspector:inspectors[0]});
  }catch(e){next(e)}
});

router.post('/marketplace/disputes/:id/resolve', requireAuth, requireRole('admin'), async(req,res,next)=>{
  const conn=await pool.getConnection();
  try{
    await conn.beginTransaction();
    const decision=String(req.body?.decision||'').toLowerCase(); const note=String(req.body?.note||'').trim()||null;
    if(!['refund','release','reject'].includes(decision)){await conn.rollback();return res.status(400).json({success:false,message:'Decision must be refund, release or reject.'});}
    const [rows]=await conn.execute(`SELECT d.*,t.status AS tx_status,t.total_amount,t.seller_id,t.item_id,t.order_id,t.id AS tx_id,t.commission_rate FROM marketplace_disputes d JOIN marketplace_transactions t ON t.id=d.transaction_id WHERE d.id=? FOR UPDATE`,[req.params.id]);
    if(!rows.length){await conn.rollback();return res.status(404).json({success:false,message:'Marketplace complaint not found.'});}
    const d=rows[0];
    if(decision==='refund'){
      await conn.execute("UPDATE marketplace_transactions SET status='refunded',refunded_at=NOW() WHERE id=? AND status='disputed'",[d.tx_id]);
      await conn.execute("UPDATE marketplace_disputes SET status='resolved_refund',resolution_note=?,resolved_by=?,resolved_at=NOW() WHERE id=?",[note,req.user.id,d.id]);
      await conn.execute("UPDATE marketplace_items SET status='available' WHERE id=?",[d.item_id]);
      await conn.execute("UPDATE marketplace_orders SET status='refunded' WHERE id=?",[d.order_id]);
      await createNotification(d.buyer_id,'payment','Marketplace payment refunded','Your Student Shop payment was refunded after StudentNest resolved the complaint.',{marketplace_dispute_id:d.id,transaction_id:d.tx_id},conn);
      await createNotification(d.seller_id,'payment','Marketplace complaint resolved',`The complaint about your item was refunded to the buyer.`,{marketplace_dispute_id:d.id,transaction_id:d.tx_id},conn);
    } else if(decision==='release'){
      if(d.tx_status!=='disputed'){await conn.rollback();return res.status(409).json({success:false,message:'This marketplace transaction is not awaiting dispute resolution.'});}
      const split=marketplaceSplit(d.total_amount,d.commission_rate||5);
      const [bank]=await conn.execute("SELECT id FROM student_payout_accounts WHERE student_id=? AND verification_status='verified' ORDER BY verified_at DESC LIMIT 1",[d.seller_id]);
      if(!bank.length){await conn.rollback();return res.status(409).json({success:false,message:'The student seller needs a verified payout account before funds can be released.'});}
      await conn.execute(`UPDATE marketplace_transactions SET status='released',confirmed_at=COALESCE(confirmed_at,NOW()),released_at=NOW(),platform_commission_amount=?,seller_payout_amount=? WHERE id=?`,[split.commission,split.sellerPayout,d.tx_id]);
      await conn.execute("UPDATE marketplace_disputes SET status='resolved_release',resolution_note=?,resolved_by=?,resolved_at=NOW() WHERE id=?",[note,req.user.id,d.id]);
      await conn.execute(`INSERT INTO marketplace_payouts (transaction_id,seller_id,bank_account_id,amount,commission_amount,gross_amount,currency,status) VALUES (?,?,?,?,?,?,?,'pending')`,[d.tx_id,d.seller_id,bank[0].id,split.sellerPayout,split.commission,d.total_amount,'NGN']);
      await conn.execute("UPDATE marketplace_items SET status='sold' WHERE id=?",[d.item_id]);
      await conn.execute("UPDATE marketplace_orders SET status='completed' WHERE id=?",[d.order_id]);
      await createNotification(d.seller_id,'payment','Marketplace funds released','StudentNest approved the marketplace payout after investigation.',{marketplace_dispute_id:d.id,transaction_id:d.tx_id},conn);
    } else {
      await conn.execute("UPDATE marketplace_transactions SET status='funds_protected' WHERE id=? AND status='disputed'",[d.tx_id]);
      await conn.execute("UPDATE marketplace_disputes SET status='rejected',resolution_note=?,resolved_by=?,resolved_at=NOW() WHERE id=?",[note,req.user.id,d.id]);
    }
    await conn.commit();
    res.json({success:true,message:`Marketplace complaint ${decision} decision recorded.`});
  }catch(e){try{await conn.rollback()}catch{}next(e)}finally{conn.release()}
});

router.post('/marketplace/transactions/:id/release', requireAuth, requireRole('admin'), async(req,res,next)=>{
  const conn=await pool.getConnection();
  try{
    await conn.beginTransaction();
    const [rows]=await conn.execute(`SELECT * FROM marketplace_transactions WHERE id=? FOR UPDATE`,[req.params.id]);
    if(!rows.length){await conn.rollback();return res.status(404).json({success:false,message:'Marketplace transaction not found.'});}
    const t=rows[0]; if(t.status!=='confirmed'){await conn.rollback();return res.status(409).json({success:false,message:'The buyer must mark the item satisfactory before release.'});}
    const [bank]=await conn.execute("SELECT id,bank_name,account_name,account_number FROM student_payout_accounts WHERE student_id=? AND verification_status='verified' ORDER BY verified_at DESC LIMIT 1",[t.seller_id]);
    if(!bank.length){await conn.rollback();return res.status(409).json({success:false,message:'The student seller needs a verified payout account before funds can be released.'});}
    const split=marketplaceSplit(t.total_amount,t.commission_rate||5);
    await conn.execute(`UPDATE marketplace_transactions SET status='released',released_at=NOW(),platform_commission_amount=?,seller_payout_amount=? WHERE id=?`,[split.commission,split.sellerPayout,t.id]);
    await conn.execute(`INSERT INTO marketplace_payouts (transaction_id,seller_id,bank_account_id,amount,commission_amount,gross_amount,currency,status) VALUES (?,?,?,?,?,?,?,'pending')`,[t.id,t.seller_id,bank[0].id,split.sellerPayout,split.commission,t.total_amount,t.currency]);
    await conn.execute("UPDATE marketplace_items SET status='sold' WHERE id=?",[t.item_id]);
    await conn.execute("UPDATE marketplace_orders SET status='completed' WHERE id=?",[t.order_id]);
    await createNotification(t.seller_id,'payment','Marketplace funds released',`StudentNest released ${split.sellerPayout.toLocaleString('en-NG')} to your payout account after keeping the 5% platform commission.`,{transaction_id:t.id,item_id:t.item_id},conn);
    await conn.commit();
    res.json({success:true,message:`Release approved: StudentNest keeps ₦${split.commission.toLocaleString('en-NG')} (${split.rate}%) and sends ₦${split.sellerPayout.toLocaleString('en-NG')} to the student seller's account.`,commission:split.commission,seller_payout:split.sellerPayout,commission_rate:split.rate});
  }catch(e){try{await conn.rollback()}catch{}next(e)}finally{conn.release()}
});

export default router;
