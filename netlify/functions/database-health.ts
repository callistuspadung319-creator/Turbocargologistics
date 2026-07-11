import type { Config } from '@netlify/functions';
import { getMarketplaceDatabase } from './_database';

function withTimeout<T>(promise:Promise<T>,milliseconds:number):Promise<T>{
  return Promise.race([
    promise,
    new Promise<T>((_,reject)=>setTimeout(()=>reject(new Error(`Database health check timed out after ${milliseconds}ms`)),milliseconds))
  ]);
}

export default async () => {
  const started=Date.now();
  try {
    const db=getMarketplaceDatabase();
    const rows=await withTimeout(db.sql`SELECT COUNT(*)::int listing_count FROM listings`,5000);
    return Response.json({
      ok:true,
      database:'netlify',
      listingCount:Number(rows?.[0]?.listing_count||0),
      responseMs:Date.now()-started
    },{headers:{'Cache-Control':'no-store'}});
  } catch (error) {
    const message=error instanceof Error?error.message:String(error);
    console.error('Netlify Database health check failed:',error);
    return Response.json({
      ok:false,
      database:'netlify',
      error:message,
      responseMs:Date.now()-started,
      databaseConfigured:Boolean(process.env.NETLIFY_DB_URL||process.env.NETLIFY_DATABASE_URL||process.env.DATABASE_URL)
    },{status:503,headers:{'Cache-Control':'no-store'}});
  }
};

export const config:Config={path:'/api/database-health'};