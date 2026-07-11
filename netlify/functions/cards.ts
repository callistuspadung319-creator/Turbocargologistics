import type { Config } from '@netlify/functions';
import { getMarketplaceDatabase } from './_database';
import { ensureMarketplaceSchema } from './_ensure-schema';

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
    const q=`%${String(url.searchParams.get('q')||'').trim()}%`;
    const category=String(url.searchParams.get('category')||'').trim();
    const rows=await db.sql`
      SELECT l.*,s.display_name,s.username,
        (SELECT i.url FROM listing_images i WHERE i.listing_id=l.id ORDER BY i.sort_order ASC LIMIT 1) image_url
      FROM listings l
      JOIN sellers s ON s.id=l.seller_id
      WHERE l.active=TRUE
        AND l.approved=TRUE
        AND COALESCE(l.quantity,0)>0
        AND s.active=TRUE
        AND (COALESCE(l.title,'') ILIKE ${q} OR COALESCE(l.description,'') ILIKE ${q})
        AND (${category}='' OR l.category=${category})
      ORDER BY l.created_at DESC
      LIMIT 500
    `;
    const items=Array.isArray(rows)?rows:[];
    return json({ok:true,items,count:items.length,canonicalEndpoint:'/api/marketplace/listings'});
  }catch(e:any){
    console.error('Legacy cards endpoint failed',e);
    return json({ok:false,items:[],count:0,error:'Marketplace listings unavailable',detail:e?.message||String(e)},503);
  }
};

export const config:Config={path:'/api/cards'};
