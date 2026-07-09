import type { Config } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import { createHmac, timingSafeEqual } from 'node:crypto';

function validSignature(payload:string,header:string,secret:string){
  const parts=Object.fromEntries(header.split(',').map(x=>x.split('=')));
  if(!parts.t||!parts.v1)return false;
  const expected=createHmac('sha256',secret).update(`${parts.t}.${payload}`).digest('hex');
  const a=Buffer.from(expected); const b=Buffer.from(parts.v1);
  return a.length===b.length&&timingSafeEqual(a,b);
}

export default async(req:Request)=>{
  if(req.method!=='POST')return new Response('Method not allowed',{status:405});
  const secret=process.env.STRIPE_WEBHOOK_SECRET;
  if(!secret)return Response.json({error:'Webhook secret missing'},{status:503});
  const raw=await req.text();
  if(!validSignature(raw,req.headers.get('stripe-signature')||'',secret))return Response.json({error:'Invalid signature'},{status:400});
  const event=JSON.parse(raw); const db=getDatabase(); const obj=event.data?.object||{}; const orderId=obj.metadata?.order_id||obj.client_reference_id;
  try{
    if(event.type==='checkout.session.completed'&&orderId){
      const rows=await db.sql`UPDATE orders SET payment_status='paid',stripe_payment_id=${String(obj.payment_intent||'')},updated_at=NOW() WHERE id=${orderId} AND payment_status<>'paid' RETURNING *`;
      const o=rows[0];
      if(o){
        await db.sql`UPDATE payments SET status='paid',provider_payment_id=${String(obj.payment_intent||'')},raw_event=${raw}::jsonb,updated_at=NOW() WHERE order_id=${orderId}`;
        await db.sql`INSERT INTO seller_payout_ledger(seller_id,order_id,gross_cents,platform_fee_cents,payout_cents,status,note) VALUES(${o.seller_id},${o.id},${o.item_price_cents*o.quantity},${o.platform_fee_cents},${o.seller_payout_cents},'pending','Manual payout required unless Stripe Connect is configured') ON CONFLICT(order_id) DO NOTHING`;
        await db.sql`UPDATE listings SET quantity=GREATEST(0,quantity-${o.quantity}),active=CASE WHEN quantity-${o.quantity}<=0 THEN FALSE ELSE active END,updated_at=NOW() WHERE id=${o.listing_id}`;
      }
    }
    if(event.type==='checkout.session.expired'&&orderId){await db.sql`UPDATE orders SET payment_status='failed',updated_at=NOW() WHERE id=${orderId} AND payment_status='pending'`;await db.sql`UPDATE payments SET status='failed',raw_event=${raw}::jsonb,updated_at=NOW() WHERE order_id=${orderId}`}
    if(event.type==='charge.refunded'){const pid=String(obj.payment_intent||'');await db.sql`UPDATE orders SET payment_status='refunded',updated_at=NOW() WHERE stripe_payment_id=${pid}`;await db.sql`UPDATE payments SET status='refunded',raw_event=${raw}::jsonb,updated_at=NOW() WHERE provider_payment_id=${pid}`}
    return Response.json({received:true});
  }catch(e){console.error(e);return Response.json({error:'Webhook processing failed'},{status:500})}
};

export const config:Config={path:'/api/stripe/webhook'};
