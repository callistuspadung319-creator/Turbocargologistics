import type { Config } from '@netlify/functions';
import { createHash } from 'node:crypto';
import { getMarketplaceDatabase } from './_database';
import { ensureMarketplaceSchema } from './_ensure-schema';

const json=(data:unknown,status=200)=>Response.json(data,{status});
const hashToken=(v:string)=>createHash('sha256').update(v).digest('hex');

async function currentSeller(req:Request){
  const db=getMarketplaceDatabase();
  const raw=req.headers.get('cookie')||'';
  const token=raw.match(/(?:^|; )market_session=([^;]+)/)?.[1];
  if(!token)return null;
  const rows=await db.sql`SELECT u.id,u.role,s.id seller_id FROM sessions x JOIN users u ON u.id=x.user_id LEFT JOIN sellers s ON s.user_id=u.id WHERE x.token_hash=${hashToken(token)} AND x.expires_at>NOW()`;
  return rows[0]||null;
}

export default async(req:Request)=>{
  try{
    if(req.method!=='DELETE')return json({error:'Method not allowed'},405);
    await ensureMarketplaceSchema();
    const db=getMarketplaceDatabase();
    const user=await currentSeller(req);
    if(!user?.seller_id)return json({error:'Seller login required'},401);
    const id=new URL(req.url).pathname.split('/').filter(Boolean).pop()||'';
    const rows=await db.sql`SELECT id,title FROM listings WHERE id::text=${id} AND seller_id=${user.seller_id}`;
    if(!rows[0])return json({error:'Listing not found'},404);
    const paid=await db.sql`SELECT COUNT(*)::int count FROM orders WHERE listing_id=${rows[0].id} AND payment_status='paid'`;
    if(Number(paid[0]?.count||0)>0)return json({error:'This listing has a paid order and must be kept for order records. Deactivate it instead.'},409);
    await db.sql`DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE listing_id=${rows[0].id} AND payment_status<>'paid')`;
    await db.sql`DELETE FROM orders WHERE listing_id=${rows[0].id} AND payment_status<>'paid'`;
    await db.sql`DELETE FROM listing_images WHERE listing_id=${rows[0].id}`;
    await db.sql`DELETE FROM listings WHERE id=${rows[0].id} AND seller_id=${user.seller_id}`;
    return json({ok:true,title:rows[0].title});
  }catch(e:any){
    console.error('Delete listing failed',e);
    return json({error:'Could not delete listing',detail:e?.message||String(e)},500);
  }
};

export const config:Config={path:'/api/listing-delete/*'};
