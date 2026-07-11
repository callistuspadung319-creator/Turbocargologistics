import type { Config } from '@netlify/functions';
import { getMarketplaceDatabase } from './_database';

export default async(req:Request)=>{
  if(req.method!=='GET')return Response.json({error:'Method not allowed'},{status:405});
  const url=new URL(req.url);
  const order=String(url.searchParams.get('order')||'');
  const session=String(url.searchParams.get('session_id')||'');
  if(!order||!session)return Response.json({error:'Order and session are required'},{status:400});
  try{
    const db=getMarketplaceDatabase();
    const rows=await db.sql`SELECT o.id,o.payment_status,o.fulfillment_status,o.quantity,o.item_price_cents,o.created_at,l.title,s.display_name FROM orders o JOIN listings l ON l.id=o.listing_id JOIN sellers s ON s.id=o.seller_id WHERE o.id=${order} AND o.stripe_session_id=${session}`;
    const result=rows[0];
    if(!result)return Response.json({error:'Order not found'},{status:404});
    return Response.json({order:result});
  }catch(e:any){console.error('Order status error',e);return Response.json({error:'Could not check order status',detail:e?.message||String(e)},{status:500})}
};

export const config:Config={path:'/api/order-status'};
