import { getStore } from '@netlify/blobs';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export default async (req)=>{
  if(req.method!=='GET') return json({error:'Method not allowed'},405);
  const id=new URL(req.url).searchParams.get('intentId');
  if(!id || !/^[a-zA-Z0-9_-]{20,80}$/.test(id)) return json({error:'Invalid intent'},400);
  const store=getStore('gta-payments');
  const record=await store.get(id,{type:'json'});
  return json({paid:!!record?.paid,orderRef:record?.orderRef||null,generationStatus:record?.generationStatus||'not_started',taskId:record?.taskId||null,videoUrl:record?.videoUrl||null});
};
