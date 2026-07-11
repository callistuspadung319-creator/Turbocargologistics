import type { Config } from '@netlify/functions';
import { ensureMarketplaceSchema } from './_ensure-schema';
import { getMarketplaceDatabase } from './_database';

const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store, no-cache, must-revalidate, max-age=0'}});

export default async(req:Request)=>{
  if(req.method!=='GET')return json({error:'Method not allowed'},405);
  try{
    await ensureMarketplaceSchema();
    const db=getMarketplaceDatabase();
    const id=new URL(req.url).pathname.split('/').filter(Boolean).pop()||'';
    if(!id)return json({error:'Missing listing'},400);

    const rows=await db.sql`
      SELECT
        l.*,s.display_name,s.username,s.logo_url,s.description seller_description,
        COALESCE(json_agg(i.url ORDER BY i.sort_order) FILTER(WHERE i.id IS NOT NULL),'[]') images
      FROM listings l
      JOIN sellers s ON s.id=l.seller_id
      LEFT JOIN listing_images i ON i.listing_id=l.id
      WHERE (l.id::text=${id} OR l.slug=${id})
        AND COALESCE(l.active,TRUE)=TRUE
        AND COALESCE(l.approved,TRUE)=TRUE
        AND COALESCE(l.quantity,0)>0
        AND COALESCE(s.active,TRUE)=TRUE
      GROUP BY l.id,s.id
    `;

    return rows[0]?json(rows[0]):json({error:'Listing not found or unavailable'},404);
  }catch(e:any){
    console.error('Listing view failed',e);
    return json({error:'Could not load listing',detail:e?.message||String(e)},500);
  }
};

export const config:Config={path:'/api/listing-view/*'};
