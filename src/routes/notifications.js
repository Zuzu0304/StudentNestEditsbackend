import { Router } from 'express';
import { pool } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

export async function createNotification(userId, type, title, message, data = null, conn = pool) {
  await conn.execute(
    'INSERT INTO notifications (user_id,type,title,message,data) VALUES (?,?,?,?,?)',
    [userId, type, title, message, data ? JSON.stringify(data) : null]
  );
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    const [rows] = await pool.execute(
      `SELECT id,type,title,message,data,is_read,read_at,created_at
       FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT ${limit}`,
      [req.user.id]
    );
    res.json({ success:true, notifications:rows, unread_count:rows.filter(n => !n.is_read).length });
  } catch (e) { next(e); }
});

router.get('/unread-count', requireAuth, async (req,res,next)=>{
  try {
    const [rows]=await pool.execute('SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND is_read=0',[req.user.id]);
    res.json({success:true,unread_count:Number(rows[0].count)});
  } catch(e){next(e)}
});

router.patch('/:id/read', requireAuth, async(req,res,next)=>{
  try {
    const [result]=await pool.execute('UPDATE notifications SET is_read=1,read_at=NOW() WHERE id=? AND user_id=?',[req.params.id,req.user.id]);
    if(!result.affectedRows)return res.status(404).json({success:false,message:'Notification not found.'});
    res.json({success:true,message:'Notification marked as read.'});
  } catch(e){next(e)}
});

router.patch('/read-all', requireAuth, async(req,res,next)=>{
  try { await pool.execute('UPDATE notifications SET is_read=1,read_at=NOW() WHERE user_id=? AND is_read=0',[req.user.id]); res.json({success:true,message:'All notifications marked as read.'}); }
  catch(e){next(e)}
});

export default router;
