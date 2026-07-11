import type { Config } from '@netlify/functions';
import { createHash } from 'node:crypto';
import { getMarketplaceDatabase } from './_database';

const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{
  'Cache-Control':'no-store, no-cache, must-revalidate, max-age=0',
  Pragma:'no-cache',
  Expires:'0'
}});
const hashToken=(v:string)=>createHash('sha256').update(v).digest('hex');

async function currentSeller(req:Request){
  const db=getMarketplaceDatabase();
  const raw=req.headers.get('cookie')||'';
  const token=raw.match(/(?:^|; )market_session=([^;]+)/)?.[1];
  if(!token)return null;
  const rows=await db.sql`
    SELECT u.id,u.email,u.role,s.id seller_id,s.username,s.display_name
    FROM sessions x
    JOIN users u ON u.id=x.user_id
    LEFT JOIN sellers s ON s.user_id=u.id
    WHERE x.token_hash=${hashToken(token)} AND x.expires_at>NOW()
    LIMIT 1
  `;
  return rows[0]||null;
}

export default async(req:Request)=>{
  if(req.method!=='GET')return json({error:'Method not allowed'},405);
  try{
    const db=getMarketplaceDatabase();
    const user=await currentSeller(req);
    if(!user)return json({error:'Login required'},401);
    if(!user.seller_id)return json({error:'Seller profile not found'},404);
    const listings=await db.sql`
      SELECT l.*,
        (SELECT i.url FROM listing_images i WHERE i.listing_id=l.id ORDER BY i.sort_order ASC LIMIT 1) image_url
      FROM listings l
      WHERE l.seller_id=${user.seller_id}
      ORDER BY l.created_at DESC
    `;
    const orders=await db.sql`
      SELECT o.*,l.title
      FROM orders o
      JOIN listings l ON l.id=o.listing_id
      WHERE o.seller_id=${user.seller_id}
      ORDER BY o.created_at DESC
    `;
    const [totals]=await db.sql`
      SELECT
        COALESCE(SUM(gross_cents),0) total_sales,
        COALESCE(SUM(payout_cents) FILTER(WHERE status='pending'),0) pending_payout,
        COALESCE(SUM(payout_cents) FILTER(WHERE status='paid'),0) paid_payout,
        COALESCE(SUM(platform_fee_cents),0) platform_fees
      FROM seller_payout_ledger
      WHERE seller_id=${user.seller_id}
    `;
    return json({user,listings,orders,totals:totals||{}});
  }catch(e:any){
    console.error('Seller dashboard endpoint failed',e);
    return json({error:'Could not load seller dashboard',detail:e?.message||String(e)},500);
  }
};

export const config:Config={path:'/api/seller-dashboard'};