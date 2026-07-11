import type { Config } from '@netlify/functions';
import { ensureMarketplaceSchema } from './_ensure-schema';
import { getMarketplaceDatabase } from './_database';

const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{
  'Cache-Control':'no-store, no-cache, must-revalidate, max-age=0',
  Pragma:'no-cache',
  Expires:'0'
}});

export default async(req:Request)=>{
  if(req.method!=='GET')return json({error:'Method not allowed'},405);
  try{
    await ensureMarketplaceSchema();
    const db=getMarketplaceDatabase();
    const url=new URL(req.url);
    const q=String(url.searchParams.get('q')||'').trim();
    const category=String(url.searchParams.get('category')||'').trim();
    const sort=String(url.searchParams.get('sort')||'new');
    const limit=Math.min(24,Math.max(4,Number(url.searchParams.get('limit')||12)));
    const offset=Math.max(0,Number(url.searchParams.get('offset')||0));
    const like=`%${q}%`;

    const [totalRow]=await db.sql`
      SELECT COUNT(*)::int total
      FROM listings l JOIN sellers s ON s.id=l.seller_id
      WHERE l.active=TRUE AND l.approved=TRUE AND l.quantity>0 AND s.active=TRUE
        AND (${q}='' OR l.title ILIKE ${like} OR l.description ILIKE ${like})
        AND (${category}='' OR l.category=${category})
    `;

    const base=async(order:'new'|'low'|'high')=>{
      if(order==='low')return db.sql`
        SELECT l.id,l.title,l.slug,l.description,l.category,l.condition,l.price_cents,l.quantity,l.created_at,
               s.display_name,s.username,
               (SELECT i.url FROM listing_images i WHERE i.listing_id=l.id ORDER BY i.sort_order LIMIT 1) image_url
        FROM listings l JOIN sellers s ON s.id=l.seller_id
        WHERE l.active=TRUE AND l.approved=TRUE AND l.quantity>0 AND s.active=TRUE
          AND (${q}='' OR l.title ILIKE ${like} OR l.description ILIKE ${like})
          AND (${category}='' OR l.category=${category})
        ORDER BY l.price_cents ASC LIMIT ${limit} OFFSET ${offset}`;
      if(order==='high')return db.sql`
        SELECT l.id,l.title,l.slug,l.description,l.category,l.condition,l.price_cents,l.quantity,l.created_at,
               s.display_name,s.username,
               (SELECT i.url FROM listing_images i WHERE i.listing_id=l.id ORDER BY i.sort_order LIMIT 1) image_url
        FROM listings l JOIN sellers s ON s.id=l.seller_id
        WHERE l.active=TRUE AND l.approved=TRUE AND l.quantity>0 AND s.active=TRUE
          AND (${q}='' OR l.title ILIKE ${like} OR l.description ILIKE ${like})
          AND (${category}='' OR l.category=${category})
        ORDER BY l.price_cents DESC LIMIT ${limit} OFFSET ${offset}`;
      return db.sql`
        SELECT l.id,l.title,l.slug,l.description,l.category,l.condition,l.price_cents,l.quantity,l.created_at,
               s.display_name,s.username,
               (SELECT i.url FROM listing_images i WHERE i.listing_id=l.id ORDER BY i.sort_order LIMIT 1) image_url
        FROM listings l JOIN sellers s ON s.id=l.seller_id
        WHERE l.active=TRUE AND l.approved=TRUE AND l.quantity>0 AND s.active=TRUE
          AND (${q}='' OR l.title ILIKE ${like} OR l.description ILIKE ${like})
          AND (${category}='' OR l.category=${category})
        ORDER BY l.created_at DESC LIMIT ${limit} OFFSET ${offset}`;
    };

    const rows=await base(sort==='low'?'low':sort==='high'?'high':'new');
    const total=Number(totalRow?.total||0);
    return json({ok:true,items:rows,total,offset,limit,hasMore:offset+rows.length<total});
  }catch(e:any){
    console.error('Market feed failed',e);
    return json({ok:false,items:[],total:0,error:'Marketplace feed unavailable',detail:e?.message||String(e)},500);
  }
};

export const config:Config={path:'/api/market-feed'};
