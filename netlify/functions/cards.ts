import type { Config } from '@netlify/functions';
import { getDatabase } from '@netlify/database';

const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{
  'Cache-Control':'no-store, no-cache, must-revalidate, max-age=0',
  Pragma:'no-cache',
  Expires:'0'
}});

function withTimeout<T>(promise:Promise<T>,milliseconds:number,label:string):Promise<T>{
  return Promise.race([
    promise,
    new Promise<T>((_,reject)=>setTimeout(()=>reject(new Error(`${label} timed out after ${milliseconds}ms`)),milliseconds))
  ]);
}

export default async(req:Request)=>{
  if(req.method!=='GET')return json({error:'Method not allowed'},405);

  try{
    const db=getDatabase();
    const url=new URL(req.url);
    const q=`%${String(url.searchParams.get('q')||'').trim()}%`;
    const category=String(url.searchParams.get('category')||'').trim();

    const rows=await withTimeout(db.sql`
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
      LIMIT 500
    `,8000,'Marketplace database query');

    return json({ok:true,items:Array.isArray(rows)?rows:[],count:Array.isArray(rows)?rows.length:0});
  }catch(e:any){
    const detail=e?.message||String(e);
    console.error('Cards endpoint failed',e);
    return json({
      ok:false,
      items:[],
      count:0,
      error:'Marketplace database is unavailable',
      detail,
      databaseConfigured:Boolean(process.env.NETLIFY_DB_URL||process.env.NETLIFY_DATABASE_URL||process.env.DATABASE_URL)
    },503);
  }
};

export const config:Config={path:'/api/cards'};