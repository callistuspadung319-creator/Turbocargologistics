import type { Config } from '@netlify/functions';
import { getMarketplaceDatabase } from './_database';

const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{
  'Cache-Control':'no-store, no-cache, must-revalidate, max-age=0',
  Pragma:'no-cache',
  Expires:'0'
}});

export default async(req:Request)=>{
  if(req.method!=='GET')return json({error:'Method not allowed'},405);

  try{
    const db=getMarketplaceDatabase();
    const url=new URL(req.url);
    const q=`%${String(url.searchParams.get('q')||'').trim()}%`;
    const category=String(url.searchParams.get('category')||'').trim();

    const [diagnostics]=await db.sql`
      SELECT
        (SELECT COUNT(*)::int FROM listings) total_listings,
        (SELECT COUNT(*)::int FROM listings WHERE COALESCE(quantity,0)>0) available_listings,
        (SELECT COUNT(*)::int FROM sellers) total_sellers
    `;

    const rows=await db.sql`
      SELECT
        l.id,l.seller_id,l.title,l.slug,l.description,l.category,l.condition,
        l.price_cents,l.quantity,l.active,l.approved,l.created_at,l.updated_at,
        s.display_name,s.username,
        (SELECT i.url FROM listing_images i WHERE i.listing_id=l.id ORDER BY i.sort_order ASC LIMIT 1) image_url
      FROM listings l
      LEFT JOIN sellers s ON s.id=l.seller_id
      WHERE COALESCE(l.quantity,0)>0
        AND (COALESCE(l.title,'') ILIKE ${q} OR COALESCE(l.description,'') ILIKE ${q})
        AND (${category}='' OR l.category=${category})
      ORDER BY l.created_at DESC
    `;

    console.log('cards endpoint result',{
      totalListings:Number(diagnostics?.total_listings||0),
      availableListings:Number(diagnostics?.available_listings||0),
      totalSellers:Number(diagnostics?.total_sellers||0),
      returned:rows.length
    });

    return json({
      ok:true,
      items:Array.isArray(rows)?rows:[],
      count:Array.isArray(rows)?rows.length:0,
      diagnostics:{
        totalListings:Number(diagnostics?.total_listings||0),
        availableListings:Number(diagnostics?.available_listings||0),
        totalSellers:Number(diagnostics?.total_sellers||0)
      }
    });
  }catch(e:any){
    console.error('Cards endpoint failed',e);
    return json({
      ok:false,
      items:[],
      count:0,
      error:'Could not load seller cards',
      detail:e?.message||String(e)
    },500);
  }
};

export const config:Config={path:'/api/cards'};
