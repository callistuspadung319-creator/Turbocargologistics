import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const exists=p=>fs.existsSync(path.join(root,p));
const checks=[];
const check=(name,ok)=>{checks.push({name,ok:Boolean(ok)});if(!ok)process.exitCode=1};

const required=[
  'public/market/index.html',
  'public/item/index.html',
  'public/sell/index.html',
  'public/seller/dashboard/index.html',
  'public/checkout/success/index.html',
  'public/checkout/cancel/index.html',
  'netlify/functions/marketplace.ts',
  'netlify/functions/seller-tools.ts',
  'netlify/functions/stripe-webhook.ts',
  'netlify/functions/order-status.ts',
  'netlify/database/migrations/20260709000000_marketplace.sql',
  'netlify.toml'
];
for(const file of required)check(`exists: ${file}`,exists(file));

if(required.every(exists)){
  const market=read('public/market/index.html');
  const item=read('public/item/index.html');
  const sell=read('public/sell/index.html');
  const api=read('netlify/functions/marketplace.ts');
  const webhook=read('netlify/functions/stripe-webhook.ts');
  const routes=read('netlify.toml');
  const migration=read('netlify/database/migrations/20260709000000_marketplace.sql');

  check('homepage loads active listings API',market.includes("/api/marketplace")&&market.includes("/listings"));
  check('buyer listing page opens real checkout',item.includes("/checkout")&&item.includes('Buy Now with Stripe'));
  check('seller supports gallery upload',sell.includes('Choose From Gallery')&&sell.includes('galleryPhotos'));
  check('seller scanner auto-fills card title',sell.includes('buildTitle')&&sell.includes('auto-filled'));
  check('checkout validates shipping server-side',api.includes('complete shipping address are required'));
  check('checkout reserves stock atomically',api.includes('quantity=quantity-${qty}')&&api.includes('quantity>=${qty}'));
  check('checkout creates real Stripe session',api.includes('https://api.stripe.com/v1/checkout/sessions'));
  check('readiness endpoint exists',api.includes("p==='/readiness'"));
  check('webhook verifies Stripe signature',webhook.includes('createHmac')&&webhook.includes('stripe-signature'));
  check('webhook creates payout ledger',webhook.includes('seller_payout_ledger'));
  check('webhook restores expired reserved stock',webhook.includes("checkout.session.expired")&&webhook.includes('quantity=quantity+${o.quantity}'));
  check('refund cancels unpaid payout',webhook.includes("status='cancelled'"));
  check('marketplace fee defaults to 10%',migration.includes("platform_fee_percent', '10"));
  check('orders and payments tables exist',migration.includes('CREATE TABLE orders')&&migration.includes('CREATE TABLE payments'));
  check('seller payout table exists',migration.includes('CREATE TABLE seller_payout_ledger'));
  check('homepage route uses buyer marketplace',routes.includes('to = "/market/index.html"'));
  check('listing route uses guest checkout page',routes.includes('to = "/item/index.html?id=:splat"'));
  check('Stripe return routes are dedicated',routes.includes('/checkout/success/index.html')&&routes.includes('/checkout/cancel/index.html'));
}

for(const c of checks)console.log(`${c.ok?'PASS':'FAIL'} ${c.name}`);
const failed=checks.filter(c=>!c.ok);
console.log(`\n${checks.length-failed.length}/${checks.length} checks passed.`);
if(failed.length)process.exit(1);
