import type { Config } from '@netlify/functions';
import { ensureMarketplaceSchema } from './_ensure-schema';
import { getMarketplaceDatabase } from './_database';

const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store, no-cache, must-revalidate, max-age=0'}});

export default async(req:Request)=>{
  if(req.method!=='GET')return json({error:'Method not allowed'},405);
  try{
    await ensureMarketplaceSchema();
    const db=getMarketplaceDatabase();
    const url=new URL(req.url);
    const q=`%${String(url.searchParams.get('q')||'').trim()}%`;
    const category=String(url.searchParams.get('category')||'').trim();

    const rows=await db.sql`
      SELECT
        l.id,l.seller_id,l.title,l.slug,l.description,l.category,l.condition,
        l.price_cents,l.quantity,l.active,l.approved,l.created_at,l.updated_at,
        s.display_name,s.username,
        (SELECT i.url FROM listing_images i WHERE i.listing_id=l.id ORDER BY i.sort_order ASC LIMIT 1) image_url
      FROM listings l
      JOIN sellers s ON s.id=l.seller_id
      WHERE COALESCE(l.active,TRUE)=TRUE
        AND COALESCE(l.approved,TRUE)=TRUE
        AND COALESCE(l.quantity,0)>0
        AND COALESCE(s.active,TRUE)=TRUE
        AND (l.title ILIKE ${q} OR COALESCE(l.description,'') ILIKE ${q})
        AND (${category}='' OR l.category=${category})
      ORDER BY l.created_at DESC
    `;

    return json(rows);
  }catch(e:any){
    console.error('Marketplace feed failed',e);
    return json({error:'Could not load seller cards',detail:e?.message||String(e)},500);
  }
};

export const config:Config={path:'/api/marketplace-feed'};
