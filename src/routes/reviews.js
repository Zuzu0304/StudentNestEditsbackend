import { Router } from 'express';
import { pool } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router=Router();

router.get('/property/:propertyId',async(req,res,next)=>{
  try{const [rows]=await pool.execute(`SELECT r.id,r.rating,r.title,r.comment,r.created_at,u.full_name AS student_name FROM property_reviews r JOIN users u ON u.id=r.student_id WHERE r.property_id=? AND r.status='published' ORDER BY r.created_at DESC`,[req.params.propertyId]);const [avg]=await pool.execute(`SELECT COUNT(*) AS count,ROUND(AVG(rating),1) AS average FROM property_reviews WHERE property_id=? AND status='published'`,[req.params.propertyId]);res.json({success:true,reviews:rows,summary:{count:Number(avg[0].count),average:avg[0].average===null?null:Number(avg[0].average)}});}catch(e){next(e)}
});

router.get('/mine',requireAuth,requireRole('student'),async(req,res,next)=>{
  try{
    // A booking only qualifies for a review once its protected payment has actually
    // been released to the provider — not merely paid or self-confirmed.
    const [rows]=await pool.execute(`SELECT br.id AS booking_id,br.property_id,br.status,br.total_amount,p.title AS property_title,p.images,
      EXISTS(SELECT 1 FROM property_reviews r WHERE r.booking_id=br.id AND r.student_id=br.student_id) AS already_reviewed
      FROM booking_requests br JOIN properties p ON p.id=br.property_id
      JOIN payment_transactions t ON t.id=br.payment_transaction_id AND t.status='released'
      WHERE br.student_id=? ORDER BY br.requested_at DESC`,[req.user.id]);
    res.json({success:true,bookings:rows});
  }catch(e){next(e)}
});

router.post('/',requireAuth,requireRole('student'),async(req,res,next)=>{
  try{const propertyId=Number(req.body?.property_id),bookingId=Number(req.body?.booking_id),rating=Number(req.body?.rating);const title=String(req.body?.title||'').trim();const comment=String(req.body?.comment||'').trim();if(!propertyId||!bookingId||rating<1||rating>5)return res.status(400).json({success:false,message:'property_id, booking_id and a rating from 1 to 5 are required.'});const [b]=await pool.execute(`SELECT br.id,br.property_id,br.student_id,br.status FROM booking_requests br JOIN payment_transactions t ON t.id=br.payment_transaction_id AND t.status='released' WHERE br.id=? AND br.student_id=? AND br.property_id=? LIMIT 1`,[bookingId,req.user.id,propertyId]);if(!b.length)return res.status(403).json({success:false,message:'You can only review a property once StudentNest has released payment to the provider.'});const [existing]=await pool.execute('SELECT id FROM property_reviews WHERE student_id=? AND booking_id=? LIMIT 1',[req.user.id,bookingId]);if(existing.length)return res.status(409).json({success:false,message:'You have already reviewed this booking.'});const [result]=await pool.execute(`INSERT INTO property_reviews (property_id,student_id,booking_id,rating,title,comment,status) VALUES (?,?,?,?,?,?,?)`,[propertyId,req.user.id,bookingId,rating,title||null,comment||null,'pending']);res.status(201).json({success:true,message:'Review submitted for moderation.',review_id:result.insertId,status:'pending'});}catch(e){next(e)}
});

export default router;
