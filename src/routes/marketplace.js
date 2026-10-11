import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { pool } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { createNotification } from './notifications.js';

const router = Router();
const COMMISSION_RATE = Number(process.env.PLATFORM_COMMISSION_RATE || 5);
const PAYMENT_MODE = String(process.env.PAYMENT_MODE || 'mock').toLowerCase();
const uploadRoot = path.resolve(process.env.UPLOAD_DIR || './uploads');
const marketRoot = path.join(uploadRoot, 'marketplace');
fs.mkdirSync(marketRoot, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, marketRoot),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(5).toString('hex')}${path.extname(file.originalname).toLowerCase()}`)
});
const imageOnly = (_req, file, cb) => {
  const ok = /^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype);
  cb(ok ? null : new Error('Marketplace uploads must be JPG, PNG, WEBP or GIF images.'), ok);
};
const itemUpload = multer({ storage, fileFilter: imageOnly, limits: { files: 8, fileSize: 12 * 1024 * 1024 } });

const money = v => Number(Number(v || 0).toFixed(2));
const split = total => {
  const gross = money(total);
  const commission = money(gross * COMMISSION_RATE / 100);
  return { rate: COMMISSION_RATE, commission, sellerPayout: money(gross - commission) };
};
const parseJson = (v, fallback=[]) => {
  if (Array.isArray(v)) return v;
  try { return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};
const txView = row => ({
  ...row,
  total_amount: money(row.total_amount),
  commission_rate: Number(row.commission_rate || COMMISSION_RATE),
  platform_commission_amount: row.platform_commission_amount == null ? null : money(row.platform_commission_amount),
  seller_payout_amount: row.seller_payout_amount == null ? null : money(row.seller_payout_amount),
  images: parseJson(row.images),
});

router.get('/items', requireAuth, requireRole('student'), async (req,res,next)=>{
  try {
    const q=String(req.query.q||'').trim();
    const category=String(req.query.category||'').trim();
    const params=[]; let where="i.status='available'";
    if(q){where+=' AND (i.title LIKE ? OR i.description LIKE ? OR i.category LIKE ?)'; params.push(`%${q}%`,`%${q}%`,`%${q}%`);}
    if(category){where+=' AND i.category=?'; params.push(category);}
    const [rows]=await pool.execute(`SELECT i.*,u.full_name AS seller_name,u.phone AS seller_phone FROM marketplace_items i JOIN users u ON u.id=i.seller_id WHERE ${where} ORDER BY i.created_at DESC`,params);
    res.json({success:true,items:rows.map(r=>({...r,price:money(r.price),images:parseJson(r.images)}))});
  }catch(e){next(e)}
});

router.get('/items/mine', requireAuth, requireRole('student'), async (req,res,next)=>{
  try{const [rows]=await pool.execute(`SELECT i.*, (SELECT COUNT(*) FROM marketplace_orders o WHERE o.item_id=i.id) AS order_count FROM marketplace_items i WHERE i.seller_id=? ORDER BY i.created_at DESC`,[req.user.id]);res.json({success:true,items:rows.map(r=>({...r,price:money(r.price),images:parseJson(r.images)}))});}catch(e){next(e)}
});

router.get('/items/:id', requireAuth, requireRole('student'), async(req,res,next)=>{
  try{const [rows]=await pool.execute(`SELECT i.*,u.full_name AS seller_name,u.phone AS seller_phone,u.email AS seller_email FROM marketplace_items i JOIN users u ON u.id=i.seller_id WHERE i.id=? LIMIT 1`,[req.params.id]);if(!rows.length)return res.status(404).json({success:false,message:'Shop item not found.'});const r=rows[0];res.json({success:true,item:{...r,price:money(r.price),images:parseJson(r.images)}});}catch(e){next(e)}
});

router.post('/items', requireAuth, requireRole('student'), itemUpload.array('images',8), async(req,res,next)=>{
  try{
    const title=String(req.body?.title||'').trim();
    const description=String(req.body?.description||'').trim();
    const category=String(req.body?.category||'').trim();
    const condition=String(req.body?.condition||'used').toLowerCase();
    const price=Number(req.body?.price);
    if(!title||!category||!Number.isFinite(price)||price<=0)return res.status(400).json({success:false,message:'Title, category and a valid price are required.'});
    if(!['new','used'].includes(condition))return res.status(400).json({success:false,message:'Condition must be new or used.'});
    if(!req.files?.length)return res.status(400).json({success:false,message:'Upload at least one clear item picture.'});
    const images=req.files.map(f=>({url:`/uploads/marketplace/${f.filename}`,type:'image',name:f.originalname,size:f.size}));
    const [r]=await pool.execute(`INSERT INTO marketplace_items (seller_id,title,description,category,item_condition,price,images,status) VALUES (?,?,?,?,?,?,?,'available')`,[req.user.id,title,description||null,category,condition,money(price),JSON.stringify(images)]);
    res.status(201).json({success:true,message:'Your item is now live in the Student Shop.',item:{id:r.insertId,title,description,category,item_condition:condition,price:money(price),images,status:'available'}});
  }catch(e){next(e)}
});

router.patch('/items/:id', requireAuth, requireRole('student'), async(req,res,next)=>{
  try{const status=String(req.body?.status||'').toLowerCase();if(!['available','hidden'].includes(status))return res.status(400).json({success:false,message:'You can only make your own item available or hidden.'});const [r]=await pool.execute('UPDATE marketplace_items SET status=? WHERE id=? AND seller_id=? AND status IN (\'available\',\'hidden\')',[status,req.params.id,req.user.id]);if(!r.affectedRows)return res.status(404).json({success:false,message:'Item not found or already involved in an order.'});res.json({success:true,message:status==='hidden'?'Item hidden from the shop.':'Item returned to the shop.'});}catch(e){next(e)}
});

router.get('/payout-account', requireAuth, requireRole('student'), async(req,res,next)=>{
  try{const [rows]=await pool.execute(`SELECT id,bank_name,account_name,RIGHT(account_number,4) AS account_number_last4,verification_status,verification_note,verified_at,created_at FROM student_payout_accounts WHERE student_id=? ORDER BY created_at DESC LIMIT 1`,[req.user.id]);res.json({success:true,account:rows[0]||null});}catch(e){next(e)}
});

router.put('/payout-account', requireAuth, requireRole('student'), async(req,res,next)=>{
  try{const bank=String(req.body?.bank_name||'').trim(),name=String(req.body?.account_name||'').trim(),number=String(req.body?.account_number||'').replace(/\s+/g,'');if(!bank||!name||!/^\d{6,32}$/.test(number))return res.status(400).json({success:false,message:'Enter a bank name, account name and valid account number.'});const [existing]=await pool.execute('SELECT id FROM student_payout_accounts WHERE student_id=? ORDER BY created_at DESC LIMIT 1',[req.user.id]);if(existing.length){await pool.execute(`UPDATE student_payout_accounts SET bank_name=?,account_name=?,account_number=?,verification_status='verified',verification_note=NULL,verified_at=NOW() WHERE id=? AND student_id=?`,[bank,name,number,existing[0].id,req.user.id]);}else{await pool.execute(`INSERT INTO student_payout_accounts (student_id,bank_name,account_name,account_number,verification_status,verified_at) VALUES (?,?,?,?,'verified',NOW())`,[req.user.id,bank,name,number]);}res.json({success:true,message:'Student payout account saved for marketplace earnings (test verification).'});}catch(e){next(e)}
});

router.post('/items/:id/buy', requireAuth, requireRole('student'), async(req,res,next)=>{
  const conn=await pool.getConnection();
  try{await conn.beginTransaction();const [rows]=await conn.execute(`SELECT * FROM marketplace_items WHERE id=? FOR UPDATE`,[req.params.id]);if(!rows.length){await conn.rollback();return res.status(404).json({success:false,message:'Shop item not found.'});}const item=rows[0];if(Number(item.seller_id)===Number(req.user.id)){await conn.rollback();return res.status(400).json({success:false,message:'You cannot buy your own item.'});}if(item.status!=='available'){await conn.rollback();return res.status(409).json({success:false,message:'This item is no longer available.'});}const [active]=await conn.execute(`SELECT id FROM marketplace_transactions WHERE item_id=? AND status IN ('pending_payment','payment_processing','funds_protected','confirmed','disputed') LIMIT 1`,[item.id]);if(active.length){await conn.rollback();return res.status(409).json({success:false,message:'This item already has an active purchase.'});}const reference=`SN-SHOP-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;const [o]=await conn.execute(`INSERT INTO marketplace_orders (item_id,buyer_id,seller_id,amount,status) VALUES (?,?,?,?, 'pending_payment')`,[item.id,req.user.id,item.seller_id,item.price]);const [t]=await conn.execute(`INSERT INTO marketplace_transactions (reference,gateway,order_id,item_id,buyer_id,seller_id,total_amount,commission_rate,status) VALUES (?,?,?,?,?,?,?,?,'pending_payment')`,[reference,PAYMENT_MODE==='flutterwave'?'flutterwave':'mock',o.insertId,item.id,req.user.id,item.seller_id,item.price,COMMISSION_RATE]);await conn.commit();res.status(201).json({success:true,message:'Order created. Choose your payment method to protect the item.',transaction:{id:t.insertId,reference,total_amount:money(item.price),status:'pending_payment'},item:{...item,images:parseJson(item.images)}});}catch(e){try{await conn.rollback()}catch{}next(e)}finally{conn.release()}
});

router.get('/transactions/mine', requireAuth, requireRole('student'), async(req,res,next)=>{
  try{const [rows]=await pool.execute(`SELECT t.*,i.title AS item_title,i.category,i.item_condition,i.images,o.status AS order_status,s.full_name AS seller_name,s.phone AS seller_phone,b.full_name AS buyer_name,b.phone AS buyer_phone FROM marketplace_transactions t JOIN marketplace_items i ON i.id=t.item_id JOIN marketplace_orders o ON o.id=t.order_id JOIN users s ON s.id=t.seller_id JOIN users b ON b.id=t.buyer_id WHERE t.buyer_id=? OR t.seller_id=? ORDER BY t.created_at DESC`,[req.user.id,req.user.id]);res.json({success:true,transactions:rows.map(txView)});}catch(e){next(e)}
});

router.post('/transactions/:id/mock-success', requireAuth, requireRole('student'), async(req,res,next)=>{
  if(PAYMENT_MODE!=='mock')return res.status(403).json({success:false,message:'Mock payment is disabled.'});
  const channel=String(req.body?.payment_method||req.body?.channel||'').trim();const name=String(req.body?.account_name||'').trim();const number=String(req.body?.account_number||'').trim();if(!['bank_transfer','ussd','card','direct_debit'].includes(channel))return res.status(400).json({success:false,message:'Choose bank transfer, USSD, card or direct debit.'});if(!name||!number)return res.status(400).json({success:false,message:'Enter the account/card holder name and account number. Test values are fine.'});
  const conn=await pool.getConnection();try{await conn.beginTransaction();const [rows]=await conn.execute(`SELECT * FROM marketplace_transactions WHERE id=? AND buyer_id=? FOR UPDATE`,[req.params.id,req.user.id]);if(!rows.length){await conn.rollback();return res.status(404).json({success:false,message:'Marketplace transaction not found.'});}const t=rows[0];if(t.status!=='pending_payment'){await conn.rollback();return res.status(409).json({success:false,message:'This order is not awaiting payment.'});}const deadline=new Date(Date.now()+7*24*60*60*1000);await conn.execute(`UPDATE marketplace_transactions SET status='funds_protected',gateway_transaction_id=?,paid_at=NOW(),inspection_deadline=?,payment_method=?,payer_channel=?,payer_account_name=?,payer_account_number=? WHERE id=?`,[`MOCK-${t.reference}`,deadline,channel,channel,name,number,t.id]);await conn.execute(`UPDATE marketplace_orders SET status='paid' WHERE id=?`,[t.order_id]);await conn.execute(`UPDATE marketplace_items SET status='reserved' WHERE id=?`,[t.item_id]);await createNotification(t.seller_id,'payment','Marketplace payment received',`${req.user.full_name} paid for a shop item. Funds are protected until the buyer confirms it is satisfactory.`,{marketplace_transaction_id:t.id,item_id:t.item_id},conn);await conn.commit();res.json({success:true,message:'Payment protected. Arrange delivery/inspection in StudentNest chat, then confirm the item when you are satisfied.',status:'funds_protected',inspection_deadline:deadline});}catch(e){try{await conn.rollback()}catch{}next(e)}finally{conn.release()}
});

router.post('/transactions/:id/confirm', requireAuth, requireRole('student'), async(req,res,next)=>{
  const conn=await pool.getConnection();try{await conn.beginTransaction();const [rows]=await conn.execute(`SELECT * FROM marketplace_transactions WHERE id=? AND buyer_id=? FOR UPDATE`,[req.params.id,req.user.id]);if(!rows.length){await conn.rollback();return res.status(404).json({success:false,message:'Marketplace transaction not found.'});}const t=rows[0];if(t.status!=='funds_protected'){await conn.rollback();return res.status(409).json({success:false,message:'This item is not awaiting satisfaction confirmation.'});}await conn.execute(`UPDATE marketplace_transactions SET status='confirmed',confirmed_at=NOW() WHERE id=?`,[t.id]);await conn.execute(`UPDATE marketplace_items SET status='sold' WHERE id=?`,[t.item_id]);await conn.execute(`UPDATE marketplace_orders SET status='completed' WHERE id=?`,[t.order_id]);await conn.commit();res.json({success:true,message:'Item marked satisfactory. The payment is now ready for admin release.',status:'confirmed'});}catch(e){try{await conn.rollback()}catch{}next(e)}finally{conn.release()}
});

router.post('/transactions/:id/dispute', requireAuth, requireRole('student'), async(req,res,next)=>{
  const conn=await pool.getConnection();try{await conn.beginTransaction();const [rows]=await conn.execute(`SELECT * FROM marketplace_transactions WHERE id=? AND buyer_id=? FOR UPDATE`,[req.params.id,req.user.id]);if(!rows.length){await conn.rollback();return res.status(404).json({success:false,message:'Marketplace transaction not found.'});}const t=rows[0];if(t.status!=='funds_protected'){await conn.rollback();return res.status(409).json({success:false,message:'A complaint can only be opened while the payment is protected.'});}const description=String(req.body?.description||'').trim();if(!description)return res.status(400).json({success:false,message:'Please describe the problem with the item.'});const reason=String(req.body?.reason||'Item does not match description').trim();const [d]=await conn.execute(`INSERT INTO marketplace_disputes (transaction_id,item_id,buyer_id,reason,description,evidence) VALUES (?,?,?,?,?,?)`,[t.id,t.item_id,req.user.id,reason,description,JSON.stringify(Array.isArray(req.body?.evidence)?req.body.evidence:[])]);await conn.execute(`UPDATE marketplace_transactions SET status='disputed' WHERE id=?`,[t.id]);await createNotification(t.seller_id,'payment','Marketplace complaint opened',`${req.user.full_name} opened a complaint about an item you sold.`,{marketplace_dispute_id:d.insertId,item_id:t.item_id},conn);await conn.commit();res.status(201).json({success:true,message:'Complaint submitted. Funds remain protected while StudentNest investigates.',dispute_id:d.insertId,status:'disputed'});}catch(e){try{await conn.rollback()}catch{}next(e)}finally{conn.release()}
});

export default router;
