import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { pool } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
const uploadRoot = path.resolve(process.env.UPLOAD_DIR || './uploads');
const evidenceRoot = path.join(uploadRoot, 'inspections');
fs.mkdirSync(evidenceRoot, { recursive: true });
const evidenceStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, evidenceRoot),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(5).toString('hex')}${path.extname(file.originalname).toLowerCase()}`)
});
const evidenceImageOnly = (_req, file, cb) => {
  const ok = /^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype);
  cb(ok ? null : new Error('Evidence photos must be JPG, PNG, WEBP or GIF images.'), ok);
};
const evidenceUpload = multer({ storage: evidenceStorage, fileFilter: evidenceImageOnly, limits: { files: 3, fileSize: 10 * 1024 * 1024 } });

function parseJson(value, fallback = []) {
  if (value == null || value === '') return fallback;
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function bool(v) { return v === true || v === 1 || v === '1' || v === 'true'; }

function inspectionView(row) {
  return {
    ...row,
    location_verified: Boolean(row.location_verified),
    property_exists: Boolean(row.property_exists),
    amenities_verified: Boolean(row.amenities_verified),
    photos_verified: Boolean(row.photos_verified),
    rent_verified: Boolean(row.rent_verified),
    availability_verified: Boolean(row.availability_verified),
    condition_verified: Boolean(row.condition_verified),
    evidence: parseJson(row.evidence)
  };
}

const detailSelect = `SELECT i.*, p.title AS property_title, p.address, p.area, p.city,
  p.listing_status, p.verification_status, p.provider_id,
  u.full_name AS provider_name, u.phone AS provider_phone, u.email AS provider_email,
  a.full_name AS agent_name
  FROM property_inspections i
  JOIN properties p ON p.id=i.property_id
  LEFT JOIN users u ON u.id=p.provider_id
  LEFT JOIN users a ON a.id=i.agent_id`;


router.post('/evidence', requireAuth, requireRole('inspector'), evidenceUpload.array('evidence', 3), async (req, res, next) => {
  try {
    if (!req.files?.length) return res.status(400).json({ success:false, message:'Select at least one evidence photo.' });
    const files = req.files.map(f => ({ url:`/uploads/inspections/${f.filename}`, name:f.originalname, size:f.size }));
    res.status(201).json({ success:true, message:'Evidence photos uploaded.', files });
  } catch (e) { next(e); }
});


router.get('/queue', requireAuth, requireRole('inspector', 'admin'), async (req, res, next) => {
  try {
    const [rows] = await pool.execute(`
      SELECT p.id, p.title, p.address, p.area, p.city, p.rent, p.property_type,
             p.amenities, p.images, p.listing_status, p.verification_status,
             p.submitted_at, u.full_name AS provider_name,u.email AS provider_email,u.phone AS provider_phone
      FROM properties p
      JOIN users u ON u.id=p.provider_id
      WHERE p.listing_status='pending'
        AND p.verification_status='pending_inspection'
      ORDER BY p.submitted_at ASC
    `);
    res.json({ success: true, properties: rows.map(r => ({
      ...r,
      rent: Number(r.rent),
      amenities: parseJson(r.amenities),
      images: parseJson(r.images)
    })) });
  } catch (e) { next(e); }
});



router.post('/:propertyId/assign', requireAuth, requireRole('inspector', 'admin'), async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [pRows] = await conn.execute("SELECT id, listing_status, verification_status FROM properties WHERE id=? FOR UPDATE", [req.params.propertyId]);
    if (!pRows.length) { await conn.rollback(); return res.status(404).json({ success:false, message:'Property not found.' }); }
    const p = pRows[0];
    if (p.listing_status !== 'pending' || p.verification_status !== 'pending_inspection') {
      await conn.rollback();
      return res.status(409).json({ success:false, message:'This property is not waiting for inspection.' });
    }

    const requestedInspectorId = req.user.role === 'inspector' ? req.user.id : Number(req.body?.inspectorId || 0);
    if (!requestedInspectorId) { await conn.rollback(); return res.status(400).json({ success:false, message:'inspectorId is required when an admin assigns an inspection.' }); }
    const [aRows] = await conn.execute("SELECT id FROM users WHERE id=? AND role='inspector' AND is_active=1 LIMIT 1", [requestedInspectorId]);
    if (!aRows.length) { await conn.rollback(); return res.status(400).json({ success:false, message:'Selected inspector is invalid or inactive.' }); }

    const [existing] = await conn.execute("SELECT id,agent_id,status FROM property_inspections WHERE property_id=? AND status IN ('assigned','in_progress') LIMIT 1", [req.params.propertyId]);
    if (existing.length) { await conn.rollback(); return res.status(409).json({ success:false, message:'An active inspection already exists for this property.', inspectionId:existing[0].id }); }

    const [result] = await conn.execute("INSERT INTO property_inspections (property_id,agent_id,status) VALUES (?,?, 'assigned')", [req.params.propertyId, requestedInspectorId]);
    await conn.execute("INSERT INTO inspection_activity (inspection_id,actor_id,action,details) VALUES (?,?,?,?)", [result.insertId, req.user.id, 'assigned', `Inspection assigned to inspector ${requestedInspectorId}.`]);
    await conn.commit();
    res.status(201).json({ success:true, message:'Inspection assigned.', inspectionId:result.insertId });
  } catch (e) { try { await conn.rollback(); } catch {} next(e); } finally { conn.release(); }
});


router.get('/mine', requireAuth, requireRole('inspector'), async (req, res, next) => {
  try {
    const [rows] = await pool.execute(`${detailSelect} WHERE i.agent_id=? ORDER BY i.created_at DESC`, [req.user.id]);
    res.json({ success:true, inspections:rows.map(inspectionView) });
  } catch (e) { next(e); }
});




router.get('/complaints', requireAuth, requireRole('inspector'), async(req,res,next)=>{
  try{
    const [rows]=await pool.execute(`SELECT d.id,d.transaction_id,d.property_id,d.student_id,d.reason,d.description,d.evidence,d.status,d.agent_result,d.agent_report,d.assigned_at,d.investigated_at,
      p.title AS property_title,p.address,p.area,p.city,s.full_name AS student_name,s.email AS student_email,s.phone AS student_phone,
      (SELECT a.full_name FROM property_inspections pi JOIN users a ON a.id=pi.agent_id WHERE pi.property_id=d.property_id ORDER BY pi.created_at DESC LIMIT 1) AS initial_inspection_agent
      FROM payment_disputes d JOIN properties p ON p.id=d.property_id JOIN users s ON s.id=d.student_id
      WHERE d.agent_id=? AND d.status IN ('investigating','open') ORDER BY d.assigned_at DESC`,[req.user.id]);
    res.json({success:true,complaints:rows.map(r=>({...r,evidence:parseJson(r.evidence)}))});
  }catch(e){next(e)}
});

router.post('/complaints/:id/submit', requireAuth, requireRole('inspector'), async(req,res,next)=>{
  try{
    const result=String(req.body?.result||'').toLowerCase();
    const report=String(req.body?.report||'').trim();
    if(!['found','not_found'].includes(result))return res.status(400).json({success:false,message:'Result must be found or not_found.'});
    if(report.length<10)return res.status(400).json({success:false,message:'Please provide a detailed investigation report.'});
    const [rows]=await pool.execute('SELECT id,property_id FROM payment_disputes WHERE id=? AND agent_id=? AND status IN (\'investigating\',\'open\') LIMIT 1',[req.params.id,req.user.id]);
    if(!rows.length)return res.status(404).json({success:false,message:'Assigned complaint not found.'});
    await pool.execute("UPDATE payment_disputes SET agent_result=?,agent_report=?,investigated_at=NOW(),status='investigating' WHERE id=? AND agent_id=?",[result,report,req.params.id,req.user.id]);
    res.json({success:true,message:'Investigation report submitted to admin.',result});
  }catch(e){next(e)}
});

/* Student Shop complaint investigations */
router.get('/marketplace-complaints', requireAuth, requireRole('inspector'), async(req,res,next)=>{
  try{
    const [rows]=await pool.execute(`SELECT d.*,t.reference,t.total_amount,i.title AS item_title,i.description AS item_description,i.images,
      b.full_name AS buyer_name,b.email AS buyer_email,b.phone AS buyer_phone,s.full_name AS seller_name,s.email AS seller_email,s.phone AS seller_phone
      FROM marketplace_disputes d JOIN marketplace_transactions t ON t.id=d.transaction_id
      JOIN marketplace_items i ON i.id=d.item_id JOIN users b ON b.id=d.buyer_id JOIN users s ON s.id=t.seller_id
      WHERE d.agent_id=? AND d.status IN ('open','investigating') ORDER BY d.assigned_at DESC`,[req.user.id]);
    res.json({success:true,complaints:rows.map(r=>({...r,images:parseJson(r.images),evidence:parseJson(r.evidence)}))});
  }catch(e){next(e)}
});

router.post('/marketplace-complaints/:id/submit', requireAuth, requireRole('inspector'), async(req,res,next)=>{
  try{
    const result=String(req.body?.result||'').toLowerCase(); const report=String(req.body?.report||'').trim();
    if(!['found','not_found'].includes(result))return res.status(400).json({success:false,message:'Result must be found or not_found.'});
    if(report.length<10)return res.status(400).json({success:false,message:'Please provide a detailed marketplace investigation report.'});
    const [rows]=await pool.execute("SELECT id FROM marketplace_disputes WHERE id=? AND agent_id=? AND status IN ('open','investigating') LIMIT 1",[req.params.id,req.user.id]);
    if(!rows.length)return res.status(404).json({success:false,message:'Assigned marketplace complaint not found.'});
    await pool.execute("UPDATE marketplace_disputes SET agent_result=?,agent_report=?,investigated_at=NOW(),status='investigating' WHERE id=? AND agent_id=?",[result,report,req.params.id,req.user.id]);
    res.json({success:true,message:'Marketplace investigation report submitted to admin.',result});
  }catch(e){next(e)}
});


router.get('/:id', requireAuth, requireRole('inspector', 'admin'), async (req, res, next) => {
  try {
    const [rows] = await pool.execute(`${detailSelect} WHERE i.id=? LIMIT 1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ success:false, message:'Inspection not found.' });
    const inspection = rows[0];
    if (req.user.role === 'inspector' && inspection.agent_id !== req.user.id) return res.status(403).json({ success:false, message:'You are not assigned to this inspection.' });
    res.json({ success:true, inspection:inspectionView(inspection) });
  } catch (e) { next(e); }
});


router.post('/:id/submit', requireAuth, requireRole('inspector'), async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute(`${detailSelect} WHERE i.id=? AND i.agent_id=? LIMIT 1 FOR UPDATE`, [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ success:false, message:'Assigned inspection not found.' });
    const i = rows[0];
    if (!['assigned','in_progress'].includes(i.status)) return res.status(409).json({ success:false, message:'This inspection has already been completed or cancelled.' });

    const b = req.body || {};
    const checks = {
      location_verified: bool(b.location_verified),
      property_exists: bool(b.property_exists),
      amenities_verified: bool(b.amenities_verified),
      photos_verified: bool(b.photos_verified),
      rent_verified: bool(b.rent_verified),
      availability_verified: bool(b.availability_verified),
      condition_verified: bool(b.condition_verified)
    };
    const requiredChecks = Object.values(checks).every(Boolean);
    const result = requiredChecks ? 'pass' : 'fail';
    const evidence = Array.isArray(b.evidence) ? b.evidence : [];
    const notes = String(b.notes || '').trim() || null;

    await conn.execute(`UPDATE property_inspections SET status='completed', result=?,
      location_verified=?, property_exists=?, amenities_verified=?, photos_verified=?,
      rent_verified=?, availability_verified=?, condition_verified=?, notes=?, evidence=?,
      inspected_at=NOW(), submitted_at=NOW() WHERE id=?`,
      [result, checks.location_verified, checks.property_exists, checks.amenities_verified, checks.photos_verified,
       checks.rent_verified, checks.availability_verified, checks.condition_verified, notes, JSON.stringify(evidence), req.params.id]);

    const verificationStatus = result === 'pass' ? 'inspection_passed' : 'inspection_failed';
    await conn.execute('UPDATE properties SET verification_status=?, verification_notes=? WHERE id=?', [verificationStatus, notes, i.property_id]);
    await conn.execute("INSERT INTO inspection_activity (inspection_id,actor_id,action,details) VALUES (?,?,?,?)", [req.params.id, req.user.id, 'submitted', `Inspection submitted with result: ${result}.`]);
    await conn.commit();

    res.json({ success:true, message: result === 'pass' ? 'Inspection passed. Property is ready for admin review.' : 'Inspection failed. Property requires admin review before publication.', result, inspectionId:Number(req.params.id) });
  } catch (e) { try { await conn.rollback(); } catch {} next(e); } finally { conn.release(); }
});


export default router;
