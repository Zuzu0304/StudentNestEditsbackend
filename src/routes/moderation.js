import { Router } from 'express';
import { pool } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router=Router();

async function audit(req,action,type,id,details={}){await pool.execute('INSERT INTO audit_logs (actor_id,action,entity_type,entity_id,details,ip_address,user_agent) VALUES (?,?,?,?,?,?,?)',[req.user.id,action,type,id,JSON.stringify(details),req.ip,String(req.get('user-agent')||'').slice(0,500)||null])}

router.get('/reviews',requireAuth,requireRole('admin'),async(req,res,next)=>{try{const status=req.query.status;const [rows]=await pool.execute(`SELECT r.*,p.title AS property_title,u.full_name AS student_name FROM property_reviews r JOIN properties p ON p.id=r.property_id JOIN users u ON u.id=r.student_id ${['pending','published','hidden','removed'].includes(status)?'WHERE r.status=?':''} ORDER BY r.created_at DESC`,['pending','published','hidden','removed'].includes(status)?[status]:[]);res.json({success:true,reviews:rows});}catch(e){next(e)}});

router.patch('/reviews/:id',requireAuth,requireRole('admin'),async(req,res,next)=>{try{const status=String(req.body?.status||'');if(!['published','hidden','removed'].includes(status))return res.status(400).json({success:false,message:'Status must be published, hidden or removed.'});const [result]=await pool.execute('UPDATE property_reviews SET status=?,moderated_by=?,moderated_at=NOW() WHERE id=?',[status,req.user.id,req.params.id]);if(!result.affectedRows)return res.status(404).json({success:false,message:'Review not found.'});await audit(req,`review_${status}`,'review',req.params.id,{status});res.json({success:true,message:'Review moderation updated.',status});}catch(e){next(e)}});

router.get('/audit-logs',requireAuth,requireRole('admin'),async(req,res,next)=>{try{const limit=Math.min(Math.max(Number(req.query.limit)||100,1),500);const [rows]=await pool.execute(`SELECT a.*,u.full_name AS actor_name,u.email AS actor_email FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT ${limit}`);res.json({success:true,logs:rows});}catch(e){next(e)}});

router.get('/dashboard',requireAuth,requireRole('admin'),async(req,res,next)=>{try{const [[reports],[reviews],[users],[properties]] = await Promise.all([
  pool.execute("SELECT COUNT(*) AS count FROM platform_reports WHERE status IN ('open','investigating')"),
  pool.execute("SELECT COUNT(*) AS count FROM property_reviews WHERE status='pending'"),
  pool.execute("SELECT COUNT(*) AS count FROM users WHERE is_active=1"),
  pool.execute("SELECT COUNT(*) AS count FROM properties WHERE listing_status='pending' OR verification_status='pending_inspection'")
]);res.json({success:true,summary:{open_reports:Number(reports[0].count),pending_reviews:Number(reviews[0].count),active_users:Number(users[0].count),properties_needing_attention:Number(properties[0].count)}});}catch(e){next(e)}});

export default router;
