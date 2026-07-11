import type { Config } from '@netlify/functions';
import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { ensureMarketplaceSchema } from './_ensure-schema';
import { getMarketplaceDatabase } from './_database';

const json=(data:unknown,status=200,headers:Record<string,string>={})=>Response.json(data,{status,headers});
const slugify=(v:string)=>v.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
const hashToken=(v:string)=>createHash('sha256').update(v).digest('hex');
const hashPassword=(p:string,s=randomBytes(16).toString('hex'))=>`${s}:${pbkdf2Sync(p,s,120000,32,'sha256').toString('hex')}`;
const verifyPassword=(p:string,stored:string)=>{const [s,h]=stored.split(':');if(!s||!h)return false;const a=Buffer.from(h,'hex');const b=pbkdf2Sync(p,s,120000,32,'sha256');return a.length===b.length&&timingSafeEqual(a,b)};
const cookie=(token:string,maxAge=604800)=>`market_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const validEmail=(v:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

async function body(req:Request){try{return await req.json() as Record<string,any>}catch{return {}}}
async function currentUser(req:Request){const db=getMarketplaceDatabase();const raw=req.headers.get('cookie')||'';const token=raw.match(/(?:^|; )market_session=([^;]+)/)?.[1];if(!token)return null;const rows=await db.sql`SELECT u.id,u.email,u.role,s.id AS seller_id,s.username,s.display_name FROM sessions x JOIN users u ON u.id=x.user_id LEFT JOIN sellers s ON s.user_id=u.id WHERE x.token_hash=${hashToken(token)} AND x.expires_at>NOW()`;return rows[0]||null}
async function requireRole(req:Request,roles:string[]){const u=await currentUser(req);return u&&roles.includes(u.role)?u:null}
async function sendEmail(to:string,subject:string,html:string){const key=process.env.RESEND_API_KEY;if(!key){console.warn('RESEND_API_KEY missing; email skipped');return}try{await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({from:'Marketplace <orders@'+new URL(process.env.PUBLIC_APP_URL||'https://example.com').hostname+'>',to:[to],subject,html})})}catch(e){console.warn('Email failed',e)}}

async function recoverLegacyAbandonedCheckouts(db:any){
  try{
    await db.sql`
      WITH stale AS (
        UPDATE orders o
        SET payment_status='failed',updated_at=NOW()
        WHERE o.payment_status='pending'
          AND o.created_at < NOW()-INTERVAL '2 minutes'
          AND EXISTS (
            SELECT 1 FROM listings l
            WHERE l.id=o.listing_id AND l.quantity=0 AND l.active=FALSE
          )
        RETURNING o.id,o.listing_id,o.quantity
      ), totals AS (
        SELECT listing_id,SUM(quantity)::int quantity
        FROM stale GROUP BY listing_id
      ), restored AS (
        UPDATE listings l
        SET quantity=l.quantity+t.quantity,active=TRUE,updated_at=NOW()
        FROM totals t WHERE l.id=t.listing_id
        RETURNING l.id
      )
      UPDATE payments p SET status='failed',updated_at=NOW()
      WHERE p.order_id IN (SELECT id FROM stale)
    `;
  }catch(e){console.warn('Legacy checkout recovery skipped',e)}
}

export default async(req:Request)=>{
 const url=new URL(req.url);const p=url.pathname.replace(/^\/api\/marketplace/,'')||'/';
 try{
  await ensureMarketplaceSchema();
  const db=getMarketplaceDatabase();
  await recoverLegacyAbandonedCheckouts(db);

  if(req.method==='GET'&&p==='/health')return json({ok:true,database:'netlify',schema:'ready',connection:'available'});

  if(req.method==='GET'&&p==='/readiness'){
    const checks:any={database:false,tables:false,stripe:Boolean(process.env.STRIPE_SECRET_KEY),webhook:Boolean(process.env.STRIPE_WEBHOOK_SECRET),publicUrl:Boolean(process.env.PUBLIC_APP_URL),ownerEmail:Boolean(process.env.OWNER_EMAIL),emailProvider:Boolean(process.env.RESEND_API_KEY)};
    try{
      await db.sql`SELECT 1`;
      checks.database=true;
      const rows=await db.sql`SELECT to_regclass('public.users') users,to_regclass('public.sellers') sellers,to_regclass('public.listings') listings,to_regclass('public.orders') orders,to_regclass('public.payments') payments,to_regclass('public.seller_payout_ledger') payouts`;
      checks.tables=Object.values(rows[0]||{}).every(Boolean);
      const [fee]=await db.sql`SELECT value FROM admin_settings WHERE key='platform_fee_percent'`;
      const [active]=await db.sql`SELECT COUNT(*)::int count FROM listings WHERE active=TRUE AND approved=TRUE AND quantity>0`;
      return json({ok:checks.database&&checks.tables&&checks.stripe&&checks.webhook&&checks.publicUrl&&checks.ownerEmail,checks,platformFeePercent:Number(fee?.value||process.env.PLATFORM_FEE_PERCENT||10),activeListings:Number(active?.count||0),optional:{emailProvider:checks.emailProvider}});
    }catch(e:any){return json({ok:false,checks,error:e?.message||String(e)},500)}
  }

  if(req.method==='GET'&&p==='/me')return json({user:await currentUser(req)});

  if(req.method==='POST'&&p==='/register'){
    const b=await body(req);const email=String(b.email||'').trim().toLowerCase();const password=String(b.password||'');const username=slugify(String(b.username||''));const display=String(b.displayName||'').trim();
    if(!validEmail(email)||password.length<8||!username||display.length<2)return json({error:'Valid email, 8+ character password, display name and username are required'},400);
    const role=email===String(process.env.OWNER_EMAIL||'').toLowerCase()?'admin':'seller';
    try{const [u]=await db.sql`INSERT INTO users(email,password_hash,role) VALUES(${email},${hashPassword(password)},${role}) RETURNING id,email,role`;await db.sql`INSERT INTO sellers(user_id,display_name,username,description) VALUES(${u.id},${display},${username},${String(b.description||'')})`;const token=randomBytes(32).toString('hex');await db.sql`INSERT INTO sessions(user_id,token_hash,expires_at) VALUES(${u.id},${hashToken(token)},NOW()+INTERVAL '7 days')`;return json({user:u},201,{'Set-Cookie':cookie(token)})}catch(e:any){console.error('Registration failed',e);return json({error:e?.code==='23505'?'Email or seller username already exists':'Registration failed',detail:e?.message||String(e)},e?.code==='23505'?409:500)}
  }

  if(req.method==='POST'&&p==='/login'){
    const b=await body(req);const email=String(b.email||'').trim().toLowerCase();const rows=await db.sql`SELECT * FROM users WHERE email=${email}`;const u=rows[0];if(!u||!verifyPassword(String(b.password||''),u.password_hash))return json({error:'Invalid email or password'},401);if(email===String(process.env.OWNER_EMAIL||'').toLowerCase()&&u.role!=='admin')await db.sql`UPDATE users SET role='admin',updated_at=NOW() WHERE id=${u.id}`;const token=randomBytes(32).toString('hex');await db.sql`INSERT INTO sessions(user_id,token_hash,expires_at) VALUES(${u.id},${hashToken(token)},NOW()+INTERVAL '7 days')`;return json({ok:true},200,{'Set-Cookie':cookie(token)})
  }

  if(req.method==='POST'&&p==='/logout')return json({ok:true},200,{'Set-Cookie':cookie('',0)});

  if(req.method==='GET'&&p==='/listings'){
    const q=`%${url.searchParams.get('q')||''}%`;const cat=url.searchParams.get('category')||'';
    const rows=await db.sql`SELECT l.*,s.display_name,s.username,(SELECT url FROM listing_images i WHERE i.listing_id=l.id ORDER BY sort_order LIMIT 1) image_url FROM listings l JOIN sellers s ON s.id=l.seller_id WHERE l.active=TRUE AND l.approved=TRUE AND l.quantity>0 AND s.active=TRUE AND (l.title ILIKE ${q} OR l.description ILIKE ${q}) AND (${cat}='' OR l.category=${cat}) ORDER BY l.created_at DESC`;
    return json(rows)
  }

  if(req.method==='GET'&&p.startsWith('/listing/')){
    const id=p.split('/')[2];const rows=await db.sql`SELECT l.*,s.display_name,s.username,s.logo_url,s.description seller_description,COALESCE(json_agg(i.url ORDER BY i.sort_order) FILTER(WHERE i.id IS NOT NULL),'[]') images FROM listings l JOIN sellers s ON s.id=l.seller_id LEFT JOIN listing_images i ON i.listing_id=l.id WHERE (l.id::text=${id} OR l.slug=${id}) AND l.active=TRUE AND l.approved=TRUE AND l.quantity>0 AND s.active=TRUE GROUP BY l.id,s.id`;return rows[0]?json(rows[0]):json({error:'Listing not found or inactive'},404)
  }

  if(req.method==='GET'&&p.startsWith('/seller/')){
    const username=p.split('/')[2];const sellers=await db.sql`SELECT id,display_name,username,logo_url,description FROM sellers WHERE username=${username} AND active=TRUE`;if(!sellers[0])return json({error:'Seller not found'},404);const listings=await db.sql`SELECT l.*,(SELECT url FROM listing_images i WHERE i.listing_id=l.id ORDER BY sort_order LIMIT 1) image_url FROM listings l WHERE l.seller_id=${sellers[0].id} AND l.active=TRUE AND l.approved=TRUE AND l.quantity>0 ORDER BY created_at DESC`;return json({seller:sellers[0],listings})
  }

  if(req.method==='POST'&&p==='/seller/listings'){
    const u=await requireRole(req,['seller','admin']);if(!u?.seller_id)return json({error:'Seller access required'},403);const b=await body(req);const title=String(b.title||'').trim();const description=String(b.description||'').trim();const price=Math.round(Number(b.price)*100);const qty=Math.floor(Number(b.quantity||1));if(title.length<3||description.length<3||!Number.isInteger(price)||price<50||qty<1)return json({error:'Valid title, description, price and quantity required'},400);const slug=`${slugify(title)}-${randomBytes(3).toString('hex')}`;const [l]=await db.sql`INSERT INTO listings(seller_id,title,slug,description,category,condition,price_cents,quantity,active,approved) VALUES(${u.seller_id},${title},${slug},${description},${String(b.category||'Sports Cards')},${String(b.condition||'Raw')},${price},${qty},TRUE,TRUE) RETURNING *`;for(const [idx,img] of (Array.isArray(b.images)?b.images:[]).slice(0,8).entries()){const value=String(img);if(value.startsWith('https://')||value.startsWith('data:image/'))await db.sql`INSERT INTO listing_images(listing_id,url,sort_order) VALUES(${l.id},${value},${idx})`}return json(l,201)
  }

  if(req.method==='GET'&&p==='/seller/dashboard'){
    const u=await requireRole(req,['seller','admin']);if(!u?.seller_id)return json({error:'Seller access required'},403);const listings=await db.sql`SELECT l.*,(SELECT url FROM listing_images i WHERE i.listing_id=l.id ORDER BY sort_order LIMIT 1) image_url FROM listings l WHERE l.seller_id=${u.seller_id} ORDER BY created_at DESC`;const orders=await db.sql`SELECT o.*,l.title FROM orders o JOIN listings l ON l.id=o.listing_id WHERE o.seller_id=${u.seller_id} ORDER BY o.created_at DESC`;const [totals]=await db.sql`SELECT COALESCE(SUM(gross_cents),0) total_sales,COALESCE(SUM(payout_cents) FILTER(WHERE status='pending'),0) pending_payout,COALESCE(SUM(payout_cents) FILTER(WHERE status='paid'),0) paid_payout,COALESCE(SUM(platform_fee_cents),0) platform_fees FROM seller_payout_ledger WHERE seller_id=${u.seller_id}`;return json({user:u,listings,orders,totals})
  }

  if(req.method==='PATCH'&&p.startsWith('/seller/listings/')){
    const u=await requireRole(req,['seller','admin']);if(!u?.seller_id)return json({error:'Seller access required'},403);const id=p.split('/')[3],b=await body(req);await db.sql`UPDATE listings SET active=${Boolean(b.active)},updated_at=NOW() WHERE id=${id} AND seller_id=${u.seller_id}`;return json({ok:true})
  }

  if(req.method==='POST'&&p==='/checkout'){
    if(!process.env.STRIPE_SECRET_KEY)return json({error:'Stripe is not configured'},503);
    const b=await body(req);const qty=Math.max(1,Math.floor(Number(b.quantity||1)));const name=String(b.name||'').trim();const email=String(b.email||'').trim().toLowerCase();const phone=String(b.phone||'').trim();const address=b.shippingAddress||{};
    if(name.length<2||!validEmail(email)||!String(address.line1||'').trim()||!String(address.city||'').trim()||!String(address.state||'').trim()||!String(address.postalCode||'').trim()||!String(address.country||'').trim())return json({error:'Valid buyer name, email and complete shipping address are required'},400);
    const rows=await db.sql`SELECT l.*,s.display_name FROM listings l JOIN sellers s ON s.id=l.seller_id WHERE l.id=${String(b.listingId||'')} AND l.active=TRUE AND l.approved=TRUE AND l.quantity>=${qty} AND s.active=TRUE`;
    const l=rows[0];if(!l)return json({error:'Listing unavailable or insufficient quantity'},409);
    const [setting]=await db.sql`SELECT value FROM admin_settings WHERE key='platform_fee_percent'`;const feePct=Number(setting?.value||process.env.PLATFORM_FEE_PERCENT||10);const gross=l.price_cents*qty,fee=Math.round(gross*feePct/100),payout=gross-fee;
    let order:any;
    try{
      [order]=await db.sql`INSERT INTO orders(buyer_name,buyer_email,buyer_phone,shipping_address,listing_id,seller_id,quantity,item_price_cents,platform_fee_cents,seller_payout_cents) VALUES(${name},${email},${phone},${JSON.stringify(address)}::jsonb,${l.id},${l.seller_id},${qty},${l.price_cents},${fee},${payout}) RETURNING id`;
      const origin=process.env.PUBLIC_APP_URL||url.origin;const form=new URLSearchParams();form.set('mode','payment');form.set('success_url',`${origin}/checkout/success?order=${order.id}&session_id={CHECKOUT_SESSION_ID}`);form.set('cancel_url',`${origin}/checkout/cancel?order=${order.id}`);form.set('customer_email',email);form.set('client_reference_id',order.id);form.set('metadata[order_id]',order.id);form.set('expires_at',String(Math.floor(Date.now()/1000)+1800));form.set('line_items[0][quantity]',String(qty));form.set('line_items[0][price_data][currency]','usd');form.set('line_items[0][price_data][unit_amount]',String(l.price_cents));form.set('line_items[0][price_data][product_data][name]',l.title);
      const sr=await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{Authorization:`Bearer ${process.env.STRIPE_SECRET_KEY}`,'Content-Type':'application/x-www-form-urlencoded'},body:form});const session=await sr.json() as any;
      if(!sr.ok)throw new Error(session.error?.message||'Stripe checkout failed');
      await db.sql`UPDATE orders SET stripe_session_id=${session.id} WHERE id=${order.id}`;await db.sql`INSERT INTO payments(order_id,provider_session_id,amount_cents,status) VALUES(${order.id},${session.id},${gross},'pending')`;return json({url:session.url,orderId:order.id})
    }catch(e:any){if(order?.id)await db.sql`UPDATE orders SET payment_status='failed',updated_at=NOW() WHERE id=${order.id}`;return json({error:e?.message||'Stripe checkout failed'},502)}
  }

  if(req.method==='GET'&&p==='/admin/overview'){
    const u=await requireRole(req,['admin']);if(!u)return json({error:'Admin access required'},403);const users=await db.sql`SELECT id,email,role,created_at FROM users ORDER BY created_at DESC`;const sellers=await db.sql`SELECT s.*,u.email FROM sellers s JOIN users u ON u.id=s.user_id ORDER BY s.created_at DESC`;const listings=await db.sql`SELECT l.*,s.display_name FROM listings l JOIN sellers s ON s.id=l.seller_id ORDER BY l.created_at DESC`;const orders=await db.sql`SELECT o.*,l.title,s.display_name FROM orders o JOIN listings l ON l.id=o.listing_id JOIN sellers s ON s.id=o.seller_id ORDER BY o.created_at DESC`;const payouts=await db.sql`SELECT p.*,s.display_name FROM seller_payout_ledger p JOIN sellers s ON s.id=p.seller_id ORDER BY p.created_at DESC`;const settings=await db.sql`SELECT * FROM admin_settings`;return json({users,sellers,listings,orders,payouts,settings})
  }

  if(req.method==='PATCH'&&p.startsWith('/admin/listings/')){if(!await requireRole(req,['admin']))return json({error:'Admin access required'},403);const id=p.split('/')[3],b=await body(req);await db.sql`UPDATE listings SET active=${Boolean(b.active)},approved=${Boolean(b.approved)},updated_at=NOW() WHERE id=${id}`;return json({ok:true})}
  if(req.method==='PATCH'&&p.startsWith('/admin/payouts/')){if(!await requireRole(req,['admin']))return json({error:'Admin access required'},403);const id=p.split('/')[3];await db.sql`UPDATE seller_payout_ledger SET status='paid',paid_at=NOW(),updated_at=NOW() WHERE id=${id} AND status='pending'`;return json({ok:true})}
  if(req.method==='PUT'&&p==='/admin/settings'){if(!await requireRole(req,['admin']))return json({error:'Admin access required'},403);const b=await body(req),v=String(Math.min(50,Math.max(0,Number(b.platformFeePercent||10))));await db.sql`INSERT INTO admin_settings(key,value,updated_at) VALUES('platform_fee_percent',${v},NOW()) ON CONFLICT(key) DO UPDATE SET value=${v},updated_at=NOW()`;return json({ok:true,value:v})}

  return json({error:'Not found'},404)
 }catch(e:any){console.error('Marketplace error',e);return json({error:'Marketplace server error',detail:e?.message||String(e),databaseConnectionPresent:Boolean(process.env.DATABASE_URL||process.env.NETLIFY_DB_URL||process.env.NETLIFY_DATABASE_URL)},500)}
};

export const config:Config={path:['/api/marketplace','/api/marketplace/*']};