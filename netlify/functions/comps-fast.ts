import type { Config } from '@netlify/functions';
import { runCompsPipeline } from './_comps-pipeline';

const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{
  'Cache-Control':'no-store, no-cache, must-revalidate, max-age=0',
  Pragma:'no-cache',
  Expires:'0'
}});

export default async(req:Request)=>{
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  try{
    const body=await req.json().catch(()=>({})) as Record<string,unknown>;
    const raw=String(body.query||body.title||body.ocrText||'').trim();
    const result=await runCompsPipeline(raw);
    return json(result);
  }catch(e:any){
    console.error('Comps pipeline failed',e);
    return json({
      count:0,
      sales:[],
      source:'manual',
      layer:'manual',
      error:'Comps lookup failed safely',
      detail:e?.message||String(e),
      message:'No historical comps found for this attribute match. Set your asking price manually.'
    },200);
  }
};

export const config:Config={path:'/api/comps-fast'};
