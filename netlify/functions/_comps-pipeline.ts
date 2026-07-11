import { getMarketplaceDatabase } from './_database';

export type CompSale={
  title:string;
  price_cents:number;
  created_at?:string|null;
  url?:string|null;
  source?:string;
};

export type LayerResult={
  layer:'ebay-api'|'ebay-public'|'internal';
  ok:boolean;
  sales:CompSale[];
  error?:string;
  blocked?:boolean;
};

const YEAR=/\b(?:19|20)\d{2}\b/;
const GRADE=/\b(?:PSA|BGS|SGC)\s*(?:10|9\.5|9|8\.5|8|7\.5|7|6|5|4|3|2|1)\b/i;
const CARD_NUMBER=/#\s*([A-Z]{0,3}\d{1,4})\b/i;
const FAKE_NUMBER=/^(?:F|E|S)?0{2,4}$/i;
const NOISE_WORDS=/\b(?:GEM\s*MT|NM\s*-?\s*MT|CERT|CERTIFICATION|BARCODE|AUTHENTIC|TRADING\s*CARD|SPORTS\s*CARD)\b/gi;

function decodeHtml(value:string){
  return value
    .replace(/&amp;/g,'&')
    .replace(/&quot;/g,'"')
    .replace(/&#x27;|&#39;/g,"'")
    .replace(/&lt;/g,'<')
    .replace(/&gt;/g,'>')
    .replace(/<[^>]+>/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

export function sanitizeCompQuery(input:string){
  const original=String(input||'').replace(/[|_]+/g,' ').replace(/\s+/g,' ').trim();
  if(!original)return {query:'',parts:[],rejected:[] as string[]};

  const rejected:string[]=[];
  let working=original
    .replace(/[^A-Za-z0-9#'&.\- ]+/g,' ')
    .replace(NOISE_WORDS,' ')
    .replace(/\s+/g,' ')
    .trim();

  working=working.replace(/#\s*([A-Z]{0,3}\d{1,4})\b/gi,(full,token)=>{
    const value=String(token).toUpperCase();
    if(FAKE_NUMBER.test(value)){
      rejected.push('#'+value);
      return ' ';
    }
    return '#'+value;
  });

  const year=(working.match(YEAR)||[])[0]||'';
  const grade=(working.match(GRADE)||[])[0]?.toUpperCase()||'';
  const numberMatch=working.match(CARD_NUMBER);
  const cardNumber=numberMatch&&!FAKE_NUMBER.test(numberMatch[1])?'#'+numberMatch[1].toUpperCase():'';

  const knownSets=[
    'Panini Contenders Optic','Panini Donruss Optic','Donruss Optic','Panini Prizm','Panini Select',
    'Panini Absolute','Panini Contenders','Topps Chrome','Bowman Chrome','Bowman Mega Box','Topps Finest',
    'Topps Heritage','Upper Deck','Topps','Bowman'
  ];
  const knownVariants=[
    'Gold Refractor','Superfractor','Orange Refractor','Red Refractor','Blue Refractor','Green Refractor',
    'Black Pandora','Gold Vinyl','Silver Prizm','Color Blast','Stained Glass','Downtown','Kaboom','Manga','Genesis','Refractor','Gold'
  ];

  const lower=working.toLowerCase();
  const set=knownSets.find(v=>lower.includes(v.toLowerCase()))||'';
  const variant=knownVariants.find(v=>lower.includes(v.toLowerCase()))||'';

  let residue=working;
  for(const piece of [year,set,variant,cardNumber,grade]){
    if(piece)residue=residue.replace(new RegExp(piece.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'ig'),' ');
  }
  residue=residue
    .replace(/\b(?:PANINI|TOPPS|BOWMAN|UPPER\s+DECK)\b/gi,' ')
    .replace(/\b(?:CARD|NUMBER|NO)\b/gi,' ')
    .replace(/\s+/g,' ')
    .trim();

  const words=residue.split(' ').filter(Boolean);
  const playerWords=words.filter(w=>!/^\d+$/.test(w)&&w.length>1).slice(0,5);
  const player=playerWords.join(' ');

  const parts=[year,set,player,variant,cardNumber,grade].filter(Boolean);
  let query=parts.join(' ').replace(/\s+/g,' ').trim();

  if(query.length<3){
    query=working
      .split(' ')
      .filter(token=>token.length>1&&!FAKE_NUMBER.test(token.replace(/^#/,'')))
      .slice(0,12)
      .join(' ')
      .trim();
  }

  const nakedNumberOnly=/^#?[A-Z]{0,3}\d{1,4}$/i.test(query);
  if(nakedNumberOnly){
    rejected.push(query);
    query='';
  }

  return {query,parts,rejected};
}

export function ebaySoldSearchUrl(query:string){
  const params=new URLSearchParams({_nkw:query,LH_Sold:'1',LH_Complete:'1',_sop:'13',rt:'nc'});
  return `https://www.ebay.com/sch/i.html?${params.toString()}`;
}

function summarize(query:string,sales:CompSale[],source:string,searchUrl:string,layer:string,diagnostics:unknown[]){
  const sorted=sales.filter(s=>Number.isFinite(s.price_cents)&&s.price_cents>0).sort((a,b)=>(new Date(b.created_at||0).getTime())-(new Date(a.created_at||0).getTime()));
  const prices=sorted.map(s=>s.price_cents).sort((a,b)=>a-b);
  const average=Math.round(prices.reduce((a,b)=>a+b,0)/prices.length);
  return {
    query,count:prices.length,low:prices[0],average,high:prices[prices.length-1],
    lastSale:sorted[0]?.price_cents||prices[prices.length-1],lastSaleDate:sorted[0]?.created_at||null,
    suggestedPrice:average,sales:sorted,source,searchUrl,layer,diagnostics
  };
}

async function withTimeout<T>(label:string,ms:number,work:(signal:AbortSignal)=>Promise<T>):Promise<T>{
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(new Error(`${label} timed out after ${ms}ms`)),ms);
  try{return await work(controller.signal)}finally{clearTimeout(timer)}
}

async function ebayOfficial(query:string):Promise<LayerResult>{
  const appId=process.env.EBAY_APP_ID||process.env.EBAY_CLIENT_ID;
  if(!appId)return {layer:'ebay-api',ok:false,sales:[],error:'Official eBay API credentials are not configured'};
  try{
    const params=new URLSearchParams({
      'OPERATION-NAME':'findCompletedItems','SERVICE-VERSION':'1.13.0','SECURITY-APPNAME':appId,
      'RESPONSE-DATA-FORMAT':'JSON','REST-PAYLOAD':'true','keywords':query,'categoryId':'212',
      'paginationInput.entriesPerPage':'30','sortOrder':'EndTimeSoonest','itemFilter(0).name':'SoldItemsOnly','itemFilter(0).value':'true'
    });
    const data=await withTimeout('Official eBay API',5000,async signal=>{
      const response=await fetch(`https://svcs.ebay.com/services/search/FindingService/v1?${params}`,{headers:{Accept:'application/json'},signal});
      const body=await response.json().catch(()=>null) as any;
      if(!response.ok)throw new Error(body?.errorMessage?.[0]?.error?.[0]?.message?.[0]||`HTTP ${response.status}`);
      return body;
    });
    const root=(data as any)?.findCompletedItemsResponse?.[0];
    const ack=String(root?.ack?.[0]||'');
    if(ack&&!/success|warning/i.test(ack))throw new Error(root?.errorMessage?.[0]?.error?.[0]?.message?.[0]||`eBay API ${ack}`);
    const items=root?.searchResult?.[0]?.item||[];
    const sales:CompSale[]=items.flatMap((item:any)=>{
      const state=String(item?.sellingStatus?.[0]?.sellingState?.[0]||'');
      const price=Number(item?.sellingStatus?.[0]?.currentPrice?.[0]?.__value__||0);
      const currency=String(item?.sellingStatus?.[0]?.currentPrice?.[0]?.['@currencyId']||'USD');
      const shipping=Number(item?.shippingInfo?.[0]?.shippingServiceCost?.[0]?.__value__||0);
      if(state!=='EndedWithSales'||currency!=='USD'||!price)return [];
      return [{title:String(item?.title?.[0]||''),price_cents:Math.round((price+shipping)*100),created_at:item?.listingInfo?.[0]?.endTime?.[0]||null,url:item?.viewItemURL?.[0]||null,source:'ebay-api'}];
    });
    return {layer:'ebay-api',ok:sales.length>0,sales,error:sales.length?'':'No official sold results matched'};
  }catch(e:any){return {layer:'ebay-api',ok:false,sales:[],error:e?.message||String(e)}}
}

async function parsePublicPage(query:string,url:string):Promise<CompSale[]>{
  return withTimeout('Public eBay sold search',4500,async signal=>{
    const response=await fetch(url,{headers:{
      'User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
      Accept:'text/html,application/xhtml+xml','Accept-Language':'en-US,en;q=0.9'
    },redirect:'follow',signal});
    if(response.status===403||response.status===429)throw Object.assign(new Error(`eBay blocked the public parser (${response.status})`),{blocked:true});
    if(!response.ok)throw new Error(`Public eBay search returned HTTP ${response.status}`);
    const html=await response.text();
    if(/captcha|robot check|verify you are human/i.test(html))throw Object.assign(new Error('eBay presented a CAPTCHA'),{blocked:true});
    const blocks=html.split(/<li[^>]+class="[^"]*s-item[^"]*"[^>]*>/i).slice(1,41);
    const out:CompSale[]=[];
    for(const block of blocks){
      const title=decodeHtml(block.match(/class="s-item__title"[^>]*>([\s\S]*?)<\//i)?.[1]||'').replace(/^New Listing\s*/i,'');
      const priceText=decodeHtml(block.match(/class="s-item__price"[^>]*>([\s\S]*?)<\/span>/i)?.[1]||'');
      const href=decodeHtml(block.match(/class="s-item__link"[^>]+href="([^"]+)"/i)?.[1]||'');
      const ended=decodeHtml(block.match(/class="s-item__ended-date"[^>]*>([\s\S]*?)<\//i)?.[1]||'');
      const amount=Number((priceText.match(/\$([\d,]+(?:\.\d{1,2})?)/)||[])[1]?.replace(/,/g,''));
      if(!title||/^Shop on eBay$/i.test(title)||!amount||!Number.isFinite(amount))continue;
      out.push({title,price_cents:Math.round(amount*100),created_at:ended||null,url:href||url,source:'ebay-public'});
    }
    return out;
  });
}

async function ebayPublic(query:string,searchUrl:string):Promise<LayerResult>{
  const attempts=[searchUrl,searchUrl.replace('www.ebay.com','www.ebay.com')+'&_ipg=60'];
  let lastError='No public sold results matched';
  let blocked=false;
  for(const url of attempts){
    try{
      const sales=await parsePublicPage(query,url);
      if(sales.length)return {layer:'ebay-public',ok:true,sales};
      lastError='Public page loaded but no sold prices were exposed';
    }catch(e:any){lastError=e?.message||String(e);blocked=blocked||Boolean(e?.blocked)}
  }
  return {layer:'ebay-public',ok:false,sales:[],error:lastError,blocked};
}

async function internalSales(query:string):Promise<LayerResult>{
  try{
    const db=getMarketplaceDatabase();
    const like=`%${query}%`;
    const rows=await db.sql`
      SELECT o.item_price_cents price_cents,o.created_at,l.title,NULL::text url
      FROM orders o JOIN listings l ON l.id=o.listing_id
      WHERE o.payment_status='paid' AND l.title ILIKE ${like}
      ORDER BY o.created_at DESC LIMIT 25
    `;
    const sales=(Array.isArray(rows)?rows:[]).map((r:any)=>({title:String(r.title||''),price_cents:Number(r.price_cents||0),created_at:r.created_at||null,url:r.url||null,source:'internal'}));
    return {layer:'internal',ok:sales.length>0,sales,error:sales.length?'':'No verified TurboMarket sales matched'};
  }catch(e:any){return {layer:'internal',ok:false,sales:[],error:e?.message||String(e)}}
}

export async function runCompsPipeline(rawInput:string){
  const sanitized=sanitizeCompQuery(rawInput);
  const query=sanitized.query;
  const diagnostics:any[]=[];
  const searchUrl=ebaySoldSearchUrl(query||rawInput||'sports card');
  if(query.length<3){
    return {query,count:0,sales:[],searchUrl,source:'manual',layer:'manual',diagnostics,message:'No historical comps found for this attribute match. Enter a fuller card title or use the sold-search link.',sanitized};
  }

  const official=await ebayOfficial(query);
  diagnostics.push({layer:official.layer,ok:official.ok,error:official.error||null,count:official.sales.length});
  if(official.ok)return {...summarize(query,official.sales,'eBay official sold listings',searchUrl,'ebay-api',diagnostics),sanitized};

  const publicLayer=await ebayPublic(query,searchUrl);
  diagnostics.push({layer:publicLayer.layer,ok:publicLayer.ok,error:publicLayer.error||null,count:publicLayer.sales.length,blocked:Boolean(publicLayer.blocked)});
  if(publicLayer.ok)return {...summarize(query,publicLayer.sales,'eBay public sold/completed listings',searchUrl,'ebay-public',diagnostics),sanitized};

  const internal=await internalSales(query);
  diagnostics.push({layer:internal.layer,ok:internal.ok,error:internal.error||null,count:internal.sales.length});
  if(internal.ok)return {...summarize(query,internal.sales,'TurboMarket verified completed sales',searchUrl,'internal',diagnostics),sanitized};

  return {
    query,count:0,sales:[],source:'manual',layer:'manual',searchUrl,diagnostics,sanitized,
    message:'No historical comps found for this attribute match. Set your asking price manually or open the matching eBay sold search.'
  };
}
