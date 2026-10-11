import { Router } from 'express';
import { pool } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router=Router();
const TYPES=['property','user','review','message','booking','payment'];

router.post('/',requireAuth,async(req,res,next)=>{
  try{const targetType=String(req.body?.target_type||'').toLowerCase();const targetId=Number(req.body?.target_id);const reason=String(req.body?.reason||'').trim();const description=String(req.body?.description||'').trim();const evidence=Array.isArray(req.body?.evidence)?req.body.evidence:[];const priority=['low','normal','high','urgent'].includes(req.body?.priority)?req.body.priority:'normal';if(!TYPES.includes(targetType)||!targetId||!reason||!description)return res.status(400).json({success:false,message:'target_type, target_id, reason and description are required.'});const [result]=await pool.execute(`INSERT INTO platform_reports (reporter_id,target_type,target_id,reason,description,evidence,priority) VALUES (?,?,?,?,?,?,?)`,[req.user.id,targetType,targetId,reason,description,JSON.stringify(evidence),priority]);res.status(201).json({success:true,message:'Report submitted to StudentNest moderation.',report_id:result.insertId,status:'open'});}catch(e){next(e)}
});

router.get('/mine',requireAuth,async(req,res,next)=>{try{const [rows]=await pool.execute('SELECT * FROM platform_reports WHERE reporter_id=? ORDER BY created_at DESC',[req.user.id]);res.json({success:true,reports:rows});}catch(e){next(e)}});

router.get('/admin',requireAuth,requireRole('admin'),async(req,res,next)=>{try{const status=req.query.status;const priority=req.query.priority;const where=[];const params=[];if(['open','investigating','resolved','dismissed'].includes(status)){where.push('r.status=?');params.push(status)}if(['low','normal','high','urgent'].includes(priority)){where.push('r.priority=?');params.push(priority)}const [rows]=await pool.execute(`SELECT r.*,u.full_name AS reporter_name,ru.full_name AS resolver_name FROM platform_reports r JOIN users u ON u.id=r.reporter_id LEFT JOIN users ru ON ru.id=r.resolved_by ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY FIELD(r.priority,'urgent','high','normal','low'),r.created_at DESC`,params);res.json({success:true,reports:rows});}catch(e){next(e)}});

router.patch('/admin/:id',requireAuth,requireRole('admin'),async(req,res,next)=>{try{const status=String(req.body?.status||'');const note=String(req.body?.resolution_note||'').trim();if(!['open','investigating','resolved','dismissed'].includes(status))return res.status(400).json({success:false,message:'Invalid report status.'});const [result]=await pool.execute('UPDATE platform_reports SET status=?,resolution_note=?,resolved_by=?,resolved_at=? WHERE id=?',[status,note||null,['resolved','dismissed'].includes(status)?req.user.id:null,['resolved','dismissed'].includes(status)?new Date():null,req.params.id]);if(!result.affectedRows)return res.status(404).json({success:false,message:'Report not found.'});res.json({success:true,message:'Report updated.',status});}catch(e){next(e)}});
export default router;
