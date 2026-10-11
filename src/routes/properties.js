import { Router } from 'express';
import { pool } from '../config/db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
const allowedTypes = new Set(['self-contain', 'single-room', 'room-and-parlour', 'flat', 'hostel', 'duplex', 'apartment', 'house']);
const listingStatuses = new Set(['draft', 'pending', 'approved', 'rejected']);
const availabilityStatuses = new Set(['available', 'reserved', 'occupied', 'unavailable']);

function parseJson(value, fallback = []) {
  if (value == null || value === '') return fallback;
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function normaliseMedia(value) {
  return parseJson(value).map(item => typeof item === 'string' ? { url:item, type:'image' } : item).filter(item => item?.url);
}

function normaliseProperty(row) {
  return {
    ...row,
    rent: Number(row.rent),
    service_charge: Number(row.service_charge || 0),
    agent_fee: Number(row.agent_fee || 0),
    security_deposit: Number(row.security_deposit || 0),
    total_cost: Number(row.total_cost || 0),
    bedrooms: Number(row.bedrooms || 0),
    bathrooms: Number(row.bathrooms || 0),
    amenities: parseJson(row.amenities),
    images: normaliseMedia(row.images),
    is_verified: Boolean(row.is_verified)
  };
}

function validateProperty(body, partial = false) {
  const required = ['title', 'description', 'address', 'area', 'city', 'property_type', 'rent'];
  if (!partial) {
    for (const field of required) if (body[field] === undefined || body[field] === '') return `${field} is required.`;
  }
  if (body.property_type !== undefined && !allowedTypes.has(String(body.property_type).toLowerCase())) return 'Unsupported property type.';
  for (const field of ['rent', 'service_charge', 'agent_fee', 'security_deposit']) {
    if (body[field] !== undefined && (Number.isNaN(Number(body[field])) || Number(body[field]) < 0)) return `${field} must be a non-negative number.`;
  }
  for (const field of ['bedrooms', 'bathrooms']) {
    if (body[field] !== undefined && (!Number.isInteger(Number(body[field])) || Number(body[field]) < 0)) return `${field} must be a non-negative whole number.`;
  }
  if (body.availability_status !== undefined && !availabilityStatuses.has(body.availability_status)) return 'Invalid availability status.';
  if (body.amenities !== undefined && !Array.isArray(body.amenities)) return 'amenities must be an array.';
  if (body.images !== undefined && !Array.isArray(body.images)) return 'images must be an array of image URLs.';
  return null;
}

const baseSelect = `SELECT p.*, u.full_name AS provider_name, u.email AS provider_email, u.phone AS provider_phone
  FROM properties p JOIN users u ON u.id = p.provider_id`;


router.get('/', async (req, res, next) => {
  try {
    const { area, city, property_type, min_rent, max_rent, bedrooms, q } = req.query;
    const where = [`p.listing_status='approved'`, `p.is_verified=1`, `p.availability_status IN ('available','reserved','occupied')`];
    const params = [];
    if (area) { where.push('p.area = ?'); params.push(area); }
    if (city) { where.push('p.city = ?'); params.push(city); }
    if (property_type) { where.push('p.property_type = ?'); params.push(property_type); }
    if (min_rent !== undefined) { where.push('p.rent >= ?'); params.push(Number(min_rent)); }
    if (max_rent !== undefined) { where.push('p.rent <= ?'); params.push(Number(max_rent)); }
    if (bedrooms !== undefined) { where.push('p.bedrooms >= ?'); params.push(Number(bedrooms)); }
    if (q) { where.push('(p.title LIKE ? OR p.description LIKE ? OR p.area LIKE ? OR p.address LIKE ?)'); const x=`%${q}%`; params.push(x,x,x,x); }
    const [rows] = await pool.execute(`${baseSelect} WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC`, params);
    res.json({ success: true, properties: rows.map(normaliseProperty) });
  } catch (e) { next(e); }
});


router.get('/provider/mine', requireAuth, requireRole('provider'), async (req, res, next) => {
  try {
    const [rows] = await pool.execute(`${baseSelect} WHERE p.provider_id=? ORDER BY p.updated_at DESC`, [req.user.id]);
    res.json({ success: true, properties: rows.map(normaliseProperty) });
  } catch (e) { next(e); }
});


router.get('/provider/:providerId', async (req,res,next)=>{
  try {
    const [users]=await pool.execute("SELECT id,full_name,email,phone,institution,is_verified,created_at FROM users WHERE id=? AND role='provider' AND is_active=1 LIMIT 1",[req.params.providerId]);
    if(!users.length) return res.status(404).json({success:false,message:'Provider not found.'});
    const [rows]=await pool.execute(`${baseSelect} WHERE p.provider_id=? AND p.listing_status='approved' AND p.is_verified=1 ORDER BY p.created_at DESC`,[req.params.providerId]);
    res.json({success:true,provider:{id:users[0].id,name:users[0].full_name,isVerified:Boolean(users[0].is_verified),joinedAt:users[0].created_at},properties:rows.map(normaliseProperty)});
  } catch(e){next(e)}
});


router.get('/inspection/:id', requireAuth, requireRole('inspector'), async (req,res,next)=>{
  try {
    const [rows]=await pool.execute(`${baseSelect} WHERE p.id=? LIMIT 1`,[req.params.id]);
    if(!rows.length) return res.status(404).json({success:false,message:'Property not found.'});
    res.json({success:true,property:normaliseProperty(rows[0])});
  } catch(e){next(e)}
});

router.get('/:id', async (req, res, next) => {
  try {
    const [rows] = await pool.execute(`${baseSelect} WHERE p.id=? AND p.listing_status='approved' AND p.is_verified=1 LIMIT 1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Property not found.' });
    res.json({ success: true, property: normaliseProperty(rows[0]) });
  } catch (e) { next(e); }
});

router.post('/', requireAuth, requireRole('provider'), async (req, res, next) => {
  try {
    const error = validateProperty(req.body);
    if (error) return res.status(400).json({ success: false, message: error });
    const b = req.body;
    const rent = Number(b.rent), serviceCharge=Number(b.service_charge||0), agentFee=Number(b.agent_fee||0), securityDeposit=Number(b.security_deposit||0);
    const total = rent + serviceCharge + agentFee + securityDeposit;
    const [result] = await pool.execute(`INSERT INTO properties
      (provider_id,title,description,address,area,city,state,postal_code,property_type,property_subtype,rent,service_charge,agent_fee,security_deposit,total_cost,bedrooms,bathrooms,amenities,images,availability_status,listing_status,is_verified)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'available','draft',0)`,
      [req.user.id,b.title,b.description,b.address,b.area,b.city,b.state||null,b.postal_code||null,b.property_type,b.property_subtype||null,rent,serviceCharge,agentFee,securityDeposit,total,Number(b.bedrooms||1),Number(b.bathrooms||1),JSON.stringify(b.amenities||[]),JSON.stringify(b.images||[])]);
    const [rows] = await pool.execute(`${baseSelect} WHERE p.id=? LIMIT 1`, [result.insertId]);
    res.status(201).json({ success:true, message:'Property saved as draft.', property:normaliseProperty(rows[0]) });
  } catch (e) { next(e); }
});

router.put('/:id', requireAuth, requireRole('provider'), async (req, res, next) => {
  try {
    const error=validateProperty(req.body,true); if(error) return res.status(400).json({success:false,message:error});
    const [existing] = await pool.execute('SELECT * FROM properties WHERE id=? AND provider_id=? LIMIT 1',[req.params.id,req.user.id]);
    if(!existing.length) return res.status(404).json({success:false,message:'Property not found.'});
    if(['pending','approved'].includes(existing[0].listing_status)) return res.status(409).json({success:false,message:'This listing is already under review or approved. Submit changes as a new revision after the moderation workflow is available.'});
    const fields=['title','description','address','area','city','state','postal_code','property_type','property_subtype','rent','service_charge','agent_fee','security_deposit','bedrooms','bathrooms','amenities','images','availability_status'];
    const set=[],params=[];
    for(const field of fields){ if(req.body[field]!==undefined){ let value=req.body[field]; if(['amenities','images'].includes(field)) value=JSON.stringify(value); set.push(`${field}=?`); params.push(value); }}
    if(!set.length) return res.status(400).json({success:false,message:'No changes supplied.'});
    const merged={...existing[0],...req.body};
    const total=Number(merged.rent||0)+Number(merged.service_charge||0)+Number(merged.agent_fee||0)+Number(merged.security_deposit||0);
    set.push('total_cost=?'); params.push(total);
    set.push("listing_status='draft'"); set.push('rejection_reason=NULL');
    params.push(req.params.id,req.user.id);
    await pool.execute(`UPDATE properties SET ${set.join(', ')} WHERE id=? AND provider_id=?`,params);
    const [rows]=await pool.execute(`${baseSelect} WHERE p.id=? LIMIT 1`,[req.params.id]);
    res.json({success:true,message:'Property updated and kept as draft.',property:normaliseProperty(rows[0])});
  }catch(e){next(e);}
});

router.delete('/:id', requireAuth, requireRole('provider'), async (req,res,next)=>{
  try{
    const [result]=await pool.execute("DELETE FROM properties WHERE id=? AND provider_id=? AND listing_status IN ('draft','rejected')",[req.params.id,req.user.id]);
    if(!result.affectedRows) return res.status(409).json({success:false,message:'Only draft or rejected properties can be deleted by the provider.'});
    res.json({success:true,message:'Property deleted.'});
  }catch(e){next(e);}
});

router.post('/:id/submit', requireAuth, requireRole('provider'), async (req,res,next)=>{
  try{
    const [rows]=await pool.execute('SELECT * FROM properties WHERE id=? AND provider_id=? LIMIT 1',[req.params.id,req.user.id]);
    if(!rows.length) return res.status(404).json({success:false,message:'Property not found.'});
    const p=rows[0];
    if(!['draft','rejected'].includes(p.listing_status)) return res.status(409).json({success:false,message:'Only draft or rejected properties can be submitted.'});
    if(!p.title||!p.description||!p.address||!p.area||!p.property_type||Number(p.rent)<=0) return res.status(400).json({success:false,message:'Complete the required property information before submitting.'});
    await pool.execute("UPDATE properties SET listing_status='pending', verification_status='pending_inspection', submitted_at=NOW(), rejection_reason=NULL WHERE id=?",[req.params.id]);
    res.json({success:true,message:'Property submitted for StudentNest inspection and admin approval.'});
  }catch(e){next(e);}
});

export default router;
