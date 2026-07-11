import type { Config } from '@netlify/functions';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getMarketplaceDatabase } from './_database';

function validSignature(payload:string,header:string,secret:string){
  const values:Record<string,string[]>={};
  for(const part of header.split(',')){
    const [k,v]=part.split('=');
    if(k&&v)(values[k]||=[]).push(v);
  }
  const t=values.t?.[0];
  if(!t||!values.v1?.length)return false;
  const expected=createHmac('sha256',secret).update(`${t}.${payload}`).digest('hex');
  return values.v1.some(sig=>{const a=Buffer.from(expected);const b=Buffer.from(sig);return a.length===b.length&&timingSafeEqual(a,b)});
}

async function sendEmail(to:string,subject:string,html:string){
  const key=process.env.RESEND_API_KEY;
  if(!key){console.warn('RESEND_API_KEY missing; email skipped');return}
  try{
    const host=new URL(process.env.PUBLIC_APP_URL||'https://example.com').hostname;
    await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({from:`TurboMarket <orders@${host}>`,to:[to],subject,html})});
  }catch(e){console.warn('Email failed',e)}
}

export default async(req:Request)=>{
  if(req.method!=='POST')return new Response('Method not allowed',{status:405});
  const secret=process.env.STRIPE_WEBHOOK_SECRET;
  if(!secret)return Response.json({error:'Webhook secret missing'},{status:503});
  const raw=await req.text();
  if(!validSignature(raw,req.headers.get('stripe-signature')||'',secret))return Response.json({error:'Invalid signature'},{status:400});

  let event:any;
  try{event=JSON.parse(raw)}catch{return Response.json({error:'Invalid payload'},{status:400})}
  const db=getMarketplaceDatabase();
  const obj=event.data?.object||{};
  const orderId=obj.metadata?.order_id||obj.client_reference_id;

  try{
    const paidEvent=event.type==='checkout.session.completed'||event.type==='checkout.session.async_payment_succeeded';
    if(paidEvent&&orderId&&(!obj.payment_status||obj.payment_status==='paid')){
      const rows=await db.sql`UPDATE orders SET payment_status='paid',stripe_payment_id=${String(obj.payment_intent||'')},updated_at=NOW() WHERE id=${orderId} AND payment_status<>'paid' RETURNING *`;
      const o=rows[0];
      if(o){
        await db.sql`UPDATE payments SET status='paid',provider_payment_id=${String(obj.payment_intent||'')},raw_event=${raw}::jsonb,updated_at=NOW() WHERE order_id=${orderId}`;
        await db.sql`INSERT INTO seller_payout_ledger(seller_id,order_id,gross_cents,platform_fee_cents,payout_cents,status,note) VALUES(${o.seller_id},${o.id},${o.item_price_cents*o.quantity},${o.platform_fee_cents},${o.seller_payout_cents},'pending','Manual payout required unless Stripe Connect is configured') ON CONFLICT(order_id) DO NOTHING`;
        const [listing]=await db.sql`SELECT title FROM listings WHERE id=${o.listing_id}`;
        const [seller]=await db.sql`SELECT u.email,s.display_name FROM sellers s JOIN users u ON u.id=s.user_id WHERE s.id=${o.seller_id}`;
        await sendEmail(o.buyer_email,'Order confirmed',`<h1>Payment received</h1><p>Your order for <strong>${listing?.title||'your item'}</strong> is confirmed.</p><p>Order: ${o.id}</p>`);
        if(seller?.email)await sendEmail(seller.email,'New paid order',`<h1>You have a new order</h1><p>${listing?.title||'Item'} sold. Seller payout: $${(o.seller_payout_cents/100).toFixed(2)}.</p><p>Order: ${o.id}</p>`);
        if(process.env.OWNER_EMAIL)await sendEmail(process.env.OWNER_EMAIL,'New TurboMarket order',`<p>A paid order was received for ${listing?.title||'an item'}.</p><p>Order: ${o.id}</p>`);
      }
    }

    if((event.type==='checkout.session.expired'||event.type==='checkout.session.async_payment_failed')&&orderId){
      const rows=await db.sql`UPDATE orders SET payment_status='failed',updated_at=NOW() WHERE id=${orderId} AND payment_status='pending' RETURNING listing_id,quantity`;
      const o=rows[0];
      if(o){
        await db.sql`UPDATE listings SET quantity=quantity+${o.quantity},active=TRUE,updated_at=NOW() WHERE id=${o.listing_id}`;
        await db.sql`UPDATE payments SET status='failed',raw_event=${raw}::jsonb,updated_at=NOW() WHERE order_id=${orderId}`;
      }
    }

    if(event.type==='charge.refunded'){
      const pid=String(obj.payment_intent||'');
      const rows=await db.sql`UPDATE orders SET payment_status='refunded',updated_at=NOW() WHERE stripe_payment_id=${pid} AND payment_status<>'refunded' RETURNING id`;
      const o=rows[0];
      if(o){
        await db.sql`UPDATE payments SET status='refunded',raw_event=${raw}::jsonb,updated_at=NOW() WHERE provider_payment_id=${pid}`;
        await db.sql`UPDATE seller_payout_ledger SET status='cancelled',note='Cancelled because the Stripe charge was refunded',updated_at=NOW() WHERE order_id=${o.id} AND status<>'paid'`;
      }
    }

    return Response.json({received:true});
  }catch(e){console.error(e);return Response.json({error:'Webhook processing failed'},{status:500})}
};

export const config:Config={path:'/api/stripe/webhook'};
