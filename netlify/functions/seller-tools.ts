import type { Config } from '@netlify/functions';
import { getDatabase } from '@netlify/database';
import { createHash, randomBytes } from 'node:crypto';

const json=(data:unknown,status=200,headers:Record<string,string>={})=>Response.json(data,{status,headers});
const hashToken=(v:string)=>createHash('sha256').update(v).digest('hex');
const slugify=(v:string)=>v.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');

function prepareDbEnv(){
  const value=process.env.DATABASE_URL||process.env.NETLIFY_DB_URL||process.env.NETLIFY_DATABASE_URL;
  if(value){process.env.DATABASE_URL=value;process.env.NETLIFY_DB_URL=value;}
}

async function currentUser(req:Request){
  prepareDbEnv();
  const db=getDatabase();
  const raw=req.headers.get('cookie')||'';
  const token=raw.match(/(?:^|; )market_session=([^;]+)/)?.[1];
  if(!token)return null;
  const rows=await db.sql`SELECT u.id,u.email,u.role,s.id seller_id,s.username,s.display_name FROM sessions x JOIN users u ON u.id=x.user_id LEFT JOIN sellers s ON s.user_id=u.id WHERE x.token_hash=${hashToken(token)} AND x.expires_at>NOW()`;
  return rows[0]||null;
}

async function ensureSeller(user:any){
  prepareDbEnv();
  const db=getDatabase();
  if(user.seller_id)return user;
  const base=slugify((user.email||'seller').split('@')[0])||'seller';
  let username=base;
  let n=1;
  while(true){
    try{
      const [seller]=await db.sql`INSERT INTO sellers(user_id,display_name,username,description,active) VALUES(${user.id},${base},${username},'',TRUE) ON CONFLICT(user_id) DO UPDATE SET updated_at=NOW() RETURNING id,username,display_name`;
      if(user.role==='buyer')await db.sql`UPDATE users SET role='seller',updated_at=NOW() WHERE id=${user.id}`;
      return {...user,seller_id:seller.id,username:seller.username,display_name:seller.display_name};
    }catch(e:any){
      if(e?.code!=='23505')throw e;
      username=`${base}-${++n}`;
    }
  }
}

async function parseBody(req:Request){try{return await req.json() as Record<string,any>}catch{return {}}}

function summarizeSales(query:string,sales:any[],source:string){
  const prices=sales.map(x=>Number(x.price_cents)).filter(Number.isFinite).sort((a,b)=>a-b);
  const average=Math.round(prices.reduce((a,b)=>a+b,0)/prices.length);
  return {query,count:prices.length,low:prices[0],average,high:prices[prices.length-1],lastSale:Number(sales[0].price_cents),lastSaleDate:sales[0].created_at,sales,source,suggestedPrice:average};
}

async function fetchEbaySoldComps(query:string){
  const appId=process.env.EBAY_APP_ID||process.env.EBAY_CLIENT_ID;
  if(!appId)return {configured:false,sales:[] as any[],error:'EBAY_APP_ID is not configured'};
  const params=new URLSearchParams({
    'OPERATION-NAME':'findCompletedItems',
    'SERVICE-VERSION':'1.13.0',
    'SECURITY-APPNAME':appId,
    'RESPONSE-DATA-FORMAT':'JSON',
    'REST-PAYLOAD':'true',
    'keywords':query,
    'categoryId':'212',
    'paginationInput.entriesPerPage':'30',
    'sortOrder':'EndTimeSoonest',
    'itemFilter(0).name':'SoldItemsOnly',
    'itemFilter(0).value':'true',
    'itemFilter(1).name':'Condition',
    'itemFilter(1).value':'Used'
  });
  const response=await fetch(`https://svcs.ebay.com/services/search/FindingService/v1?${params.toString()}`,{headers:{Accept:'application/json'}});
  const data=await response.json() as any;
  if(!response.ok)throw new Error(`eBay comps request failed (${response.status})`);
  const root=data?.findCompletedItemsResponse?.[0];
  const ack=String(root?.ack?.[0]||'');
  if(ack&&!/success|warning/i.test(ack)){
    const message=root?.errorMessage?.[0]?.error?.[0]?.message?.[0]||'eBay completed listings request failed';
    throw new Error(String(message));
  }
  const items=root?.searchResult?.[0]?.item||[];
  const sales=items.flatMap((item:any)=>{
    const sellingState=String(item?.sellingStatus?.[0]?.sellingState?.[0]||'');
    const rawPrice=Number(item?.sellingStatus?.[0]?.currentPrice?.[0]?.__value__||0);
    const shipping=Number(item?.shippingInfo?.[0]?.shippingServiceCost?.[0]?.__value__||0);
    const currency=String(item?.sellingStatus?.[0]?.currentPrice?.[0]?.['@currencyId']||'USD');
    if(sellingState!=='EndedWithSales'||!rawPrice||currency!=='USD')return [];
    return [{
      title:String(item?.title?.[0]||''),
      price_cents:Math.round((rawPrice+shipping)*100),
      item_price_cents:Math.round(rawPrice*100),
      shipping_cents:Math.round(shipping*100),
      created_at:item?.listingInfo?.[0]?.endTime?.[0]||null,
      url:item?.viewItemURL?.[0]||null,
      itemId:item?.itemId?.[0]||null,
      condition:item?.condition?.[0]?.conditionDisplayName?.[0]||null
    }];
  }).sort((a:any,b:any)=>new Date(b.created_at||0).getTime()-new Date(a.created_at||0).getTime());
  return {configured:true,sales,error:null};
}

export default async(req:Request)=>{
  try{
    prepareDbEnv();
    const db=getDatabase();
    const url=new URL(req.url);
    const path=url.pathname.replace(/^\/api\/seller-tools/,'')||'/';
    const user=await currentUser(req);
    if(!user)return json({error:'Login required'},401);
    const seller=await ensureSeller(user);

    if(req.method==='GET'&&path==='/profile'){
      const rows=await db.sql`SELECT id,display_name,username,logo_url,description,active FROM sellers WHERE id=${seller.seller_id}`;
      return json({user:seller,seller:rows[0]});
    }

    if(req.method==='GET'&&path==='/dashboard'){
      const listings=await db.sql`SELECT l.*,(SELECT url FROM listing_images i WHERE i.listing_id=l.id ORDER BY sort_order LIMIT 1) image_url FROM listings l WHERE l.seller_id=${seller.seller_id} ORDER BY l.created_at DESC`;
      const orders=await db.sql`SELECT o.*,l.title FROM orders o JOIN listings l ON l.id=o.listing_id WHERE o.seller_id=${seller.seller_id} ORDER BY o.created_at DESC`;
      const [totals]=await db.sql`SELECT COALESCE(SUM(gross_cents),0) total_sales,COALESCE(SUM(payout_cents) FILTER(WHERE status='pending'),0) pending_payout,COALESCE(SUM(payout_cents) FILTER(WHERE status='paid'),0) paid_payout,COALESCE(SUM(platform_fee_cents),0) platform_fees FROM seller_payout_ledger WHERE seller_id=${seller.seller_id}`;
      return json({user:seller,listings,orders,totals});
    }

    if(req.method==='POST'&&path==='/comps'){
      const b=await parseBody(req);
      const q=String(b.query||b.title||'').trim();
      if(q.length<3)return json({query:q,count:0,sales:[],message:'Enter at least 3 characters'});

      try{
        const ebay=await fetchEbaySoldComps(q);
        if(ebay.sales.length)return json(summarizeSales(q,ebay.sales,'eBay recent sold listings'));
        if(ebay.configured)return json({query:q,count:0,sales:[],source:'eBay recent sold listings',message:'No matching recent eBay sold listings were found. Try removing extra words from the title.'});
      }catch(e:any){
        console.error('eBay comps failed',e);
      }

      const like=`%${q}%`;
      const sales=await db.sql`SELECT o.item_price_cents price_cents,o.quantity,o.created_at,l.title,NULL::text url FROM orders o JOIN listings l ON l.id=o.listing_id WHERE o.payment_status='paid' AND l.title ILIKE ${like} ORDER BY o.created_at DESC LIMIT 25`;
      if(sales.length)return json({...summarizeSales(q,sales,'TurboMarket verified completed sales'),warning:'External eBay comps were unavailable, so internal completed sales are shown.'});

      return json({query:q,count:0,sales:[],source:'Recent sold listings',requiresConfiguration:!Boolean(process.env.EBAY_APP_ID||process.env.EBAY_CLIENT_ID),message:(process.env.EBAY_APP_ID||process.env.EBAY_CLIENT_ID)?'No matching recent sold listings were found. Try a shorter title.':'Recent external comps require EBAY_APP_ID in Netlify environment variables.'});
    }

    if(req.method==='POST'&&path==='/listings'){
      const b=await parseBody(req);
      const title=String(b.title||'').trim();
      const description=String(b.description||'').trim();
      const category=String(b.category||'Sports Cards').trim();
      const condition=String(b.condition||'Raw').trim();
      const price=Math.round(Number(b.price)*100);
      const quantity=Math.max(0,Math.floor(Number(b.quantity||1)));
      const images=(Array.isArray(b.images)?b.images:[]).map(String).filter((x:string)=>x.startsWith('https://')||x.startsWith('data:image/')).slice(0,4);
      if(!title||!description||!Number.isInteger(price)||price<50||quantity<1)return json({error:'Title, description, price of at least $0.50, and quantity are required'},400);
      if(!images.length)return json({error:'Upload at least one card image'},400);
      if(images.some((x:string)=>x.length>1_800_000))return json({error:'Image is too large. Choose a smaller photo.'},413);
      const slug=`${slugify(title)}-${randomBytes(3).toString('hex')}`;
      const [listing]=await db.sql`INSERT INTO listings(seller_id,title,slug,description,category,condition,price_cents,quantity,active,approved) VALUES(${seller.seller_id},${title},${slug},${description},${category},${condition},${price},${quantity},TRUE,TRUE) RETURNING *`;
      for(const [i,img] of images.entries())await db.sql`INSERT INTO listing_images(listing_id,url,sort_order) VALUES(${listing.id},${img},${i})`;
      return json({listing,storefront:`/seller/${seller.username}`},201);
    }

    return json({error:'Not found'},404);
  }catch(e:any){
    console.error('Seller tools error',e);
    return json({error:'Seller service error',detail:e?.message||String(e)},500);
  }
};

export const config:Config={path:['/api/seller-tools','/api/seller-tools/*']};