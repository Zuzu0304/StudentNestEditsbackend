import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';

function tokenFrom(req) { const h=req.headers.authorization||''; return h.startsWith('Bearer ') ? h.slice(7).trim() : null; }
export async function requireAuth(req,res,next){
  const token=tokenFrom(req); if(!token) return res.status(401).json({success:false,message:'Authentication required.'});
  try { const p=jwt.verify(token,process.env.JWT_SECRET); const [sessionRows]=await pool.execute('SELECT id FROM auth_sessions WHERE jti=? AND user_id=? AND revoked_at IS NULL AND expires_at > NOW() LIMIT 1',[p.jti,p.sub]); if(!sessionRows.length) return res.status(401).json({success:false,message:'Session is no longer valid.'}); const [rows]=await pool.execute('SELECT id,full_name,email,phone,institution,role,is_verified,is_active FROM users WHERE id=? LIMIT 1',[p.sub]); const u=rows[0]; if(!u||!u.is_active) return res.status(401).json({success:false,message:'Account is inactive or no longer exists.'}); req.user=u; req.auth=p; next(); }
  catch(e){ return res.status(401).json({success:false,message:'Invalid or expired authentication token.'}); }
}
export function requireRole(...roles){ return (req,res,next)=> roles.includes(req.user?.role) ? next() : res.status(403).json({success:false,message:'You do not have permission to access this resource.'}); }
