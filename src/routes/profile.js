import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { pool } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
const uploadRoot = path.resolve(process.env.UPLOAD_DIR || './uploads');
fs.mkdirSync(uploadRoot, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadRoot),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2,10)}${path.extname(file.originalname).toLowerCase()}`)
});
const imageVideoOnly = (_req, file, cb) => {
  const allowed = /^image\/(jpeg|png|webp|gif)$|^video\/(mp4|webm|quicktime)$/i.test(file.mimetype);
  cb(allowed ? null : new Error('Only image and video files are allowed.'), allowed);
};
const ninOnly = (_req, file, cb) => {
  const allowed = /^image\/(jpeg|png|webp)$/i.test(file.mimetype);
  cb(allowed ? null : new Error('NIN documents must be image files (JPG, PNG or WEBP).'), allowed);
};
const mediaUpload = multer({ storage, fileFilter: imageVideoOnly, limits: { files: 12, fileSize: 50 * 1024 * 1024 } });
const ninUpload = multer({ storage, fileFilter: ninOnly, limits: { files: 2, fileSize: 10 * 1024 * 1024 } });

function publicUser(u) { return { id:u.id, fullName:u.full_name, email:u.email, phone:u.phone, institution:u.institution, role:u.role, isVerified:Boolean(u.is_verified), isActive:Boolean(u.is_active), ninNumber:u.nin_number || '', ninFrontImage:u.nin_front_image || null, ninBackImage:u.nin_back_image || null }; }

router.get('/me', requireAuth, async (req,res,next) => {
  try {
    const [rows] = await pool.execute('SELECT id,full_name,email,phone,institution,role,is_verified,is_active,nin_number,nin_front_image,nin_back_image FROM users WHERE id=? LIMIT 1',[req.user.id]);
    res.json({ success:true, user:publicUser(rows[0]) });
  } catch(e){ next(e); }
});

router.put('/me', requireAuth, async (req,res,next) => {
  try {
    const name=String(req.body?.fullName ?? '').trim();
    const phone=String(req.body?.phone ?? '').trim();
    const institution=String(req.body?.institution ?? '').trim();
    if(!name) return res.status(400).json({success:false,message:'Name or nickname is required.'});
    if(name.length>150) return res.status(400).json({success:false,message:'Name is too long.'});
    await pool.execute('UPDATE users SET full_name=?,phone=?,institution=? WHERE id=?',[name,phone||null,institution||null,req.user.id]);
    const [rows]=await pool.execute('SELECT id,full_name,email,phone,institution,role,is_verified,is_active,nin_number,nin_front_image,nin_back_image FROM users WHERE id=?',[req.user.id]);
    res.json({success:true,message:'Profile updated successfully.',user:publicUser(rows[0])});
  }catch(e){next(e)}
});

router.post('/provider-documents', requireAuth, requireRole('provider'), ninUpload.fields([{name:'ninFront',maxCount:1},{name:'ninBack',maxCount:1}]), async(req,res,next)=>{
  try{
    const nin=String(req.body?.ninNumber||'').replace(/\s+/g,'');
    if(!/^\d{11}$/.test(nin)) return res.status(400).json({success:false,message:'NIN must contain exactly 11 digits.'});
    const front=req.files?.ninFront?.[0]; const back=req.files?.ninBack?.[0];
    const [old]=await pool.execute('SELECT nin_front_image,nin_back_image FROM users WHERE id=?',[req.user.id]);
    const frontPath=front?`/uploads/${front.filename}`:old[0]?.nin_front_image||null;
    const backPath=back?`/uploads/${back.filename}`:old[0]?.nin_back_image||null;
    if(!frontPath||!backPath) return res.status(400).json({success:false,message:'Please upload both the front and back NIN images.'});
    await pool.execute('UPDATE users SET nin_number=?,nin_front_image=?,nin_back_image=? WHERE id=?',[nin,frontPath,backPath,req.user.id]);
    res.json({success:true,message:'Provider identity documents saved.',ninNumber:nin,ninFrontImage:frontPath,ninBackImage:backPath});
  }catch(e){next(e)}
});

router.post('/property-media', requireAuth, requireRole('provider'), mediaUpload.array('media',12), async(req,res,next)=>{
  try{
    if(!req.files?.length) return res.status(400).json({success:false,message:'Select at least one image or video.'});
    const media=req.files.map(f=>({url:`/uploads/${f.filename}`,type:f.mimetype.startsWith('video/')?'video':'image',name:f.originalname,size:f.size}));
    res.status(201).json({success:true,message:'Media uploaded.',media});
  }catch(e){next(e)}
});

export { uploadRoot, mediaUpload };
export default router;
