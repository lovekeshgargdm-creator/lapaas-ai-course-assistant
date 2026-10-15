import {makeMessages,parseAnswer} from '../lib/retrieval.js';
import {questions} from '../public/flow.js';
import {briefRequest,styleIssues,stylePenalty,revisionInstruction} from '../lib/response-style.js';
const buckets=new Map();
function reply(res,status,body){
 res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
 res.end(JSON.stringify(body));
}
function allowed(req){
 // A small, best-effort per-instance throttle; not a durable global quota.
 const now=Date.now();
 for(const [key,b] of buckets)if(now>b.until)buckets.delete(key);
 const ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim();
 const bucket=buckets.get(ip)||{count:0,until:now+60000};
 if(bucket.count>=8)return false;
 if(buckets.size>5000)buckets.clear();
 bucket.count++;buckets.set(ip,bucket);return true;
}
async function readBody(req){
 if(Number(req.headers['content-length']||0)>24000)throw new Error('BODY_TOO_LARGE');
 if(req.body!==undefined){
  const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);
  if(Buffer.byteLength(raw)>24000)throw new Error('BODY_TOO_LARGE');
  return typeof req.body==='string'?JSON.parse(req.body):req.body;
 }
 const parts=[];let bytes=0;
 for await(const chunk of req){
  bytes+=chunk.length;if(bytes>24000)throw new Error('BODY_TOO_LARGE');parts.push(chunk);
 }
 return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
function validate(body){
 if(!body||!Array.isArray(body.messages)||body.messages.length<1||body.messages.length>12)throw new Error('INVALID_INPUT');
 let total=0;
 const messages=body.messages.map(m=>{
  if(!m||!['user','assistant'].includes(m.role)||typeof m.content!=='string'||!m.content.trim()||m.content.length>(m.role==='user'?1600:7000))throw new Error('INVALID_INPUT');
  total+=m.content.length;return {role:m.role,content:m.content.trim()};
 });
 if(total>20000||messages.at(-1).role!=='user')throw new Error('INVALID_INPUT');
 const profile={};
 for(const q of questions){
  if(q.options.some(([v])=>v===body.profile?.[q.key]))profile[q.key]=body.profile[q.key];
 }
 return {messages,profile};
}
export default async function handler(req,res){
 if(req.method!=='POST'){res.setHeader('Allow','POST');return reply(res,405,{error:'Use the course chat to send a question.'});}
 const contentType=String(req.headers['content-type']||'');
 if(!contentType.startsWith('application/json'))return reply(res,415,{error:'Please send your question through the assistant.'});
 const origin=req.headers.origin;
 const host=req.headers.host;
 if(origin){
  try{if(new URL(origin).host!==host)return reply(res,403,{error:'Please use the assistant on this website.'});}
  catch{return reply(res,403,{error:'Please use the assistant on this website.'});}
 }
 let input;
 try{input=validate(await readBody(req));}
 catch{return reply(res,400,{error:'Please keep your question under 1,600 characters. Clear a long chat and try again.'});}
 const provider=(process.env.AI_PROVIDER||'openrouter').trim().toLowerCase();
 if(!['openrouter','nvidia'].includes(provider))return reply(res,503,{error:'AI chat needs a provider configuration update. Please use the guide for now.'});
 const apiKey=(provider==='nvidia'?process.env.NVIDIA_API_KEY:process.env.OPENROUTER_API_KEY)?.trim();
 if(!apiKey)return reply(res,503,{error:'AI chat is not connected yet. You can still use Help me decide or visit the official course page.'});
 const model=(provider==='nvidia'?(process.env.NVIDIA_MODEL||'nvidia/nemotron-3-super-120b-a12b'):(process.env.OPENROUTER_MODEL||'openrouter/free')).trim();
 // NVIDIA uses its hosted prototype endpoint. OpenRouter stays free-only.
 // There is no automatic fallback to another model or provider.
 if(provider==='openrouter'&&model!=='openrouter/free'&&!model.endsWith(':free'))return reply(res,503,{error:'AI chat needs a free-model configuration update. Please use the guide for now.'});
 if(provider==='nvidia'&&!/^[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(model))return reply(res,503,{error:'AI chat needs a model configuration update. Please use the guide for now.'});
 const endpoint=provider==='nvidia'?'https://integrate.api.nvidia.com/v1/chat/completions':'https://openrouter.ai/api/v1/chat/completions';
 const headers={'Authorization':'Bearer '+apiKey,'Content-Type':'application/json','Accept':'application/json'};
 if(provider==='openrouter')headers['X-OpenRouter-Title']='LAPAAS Course Discovery Assistant';
 const payload={model,messages:makeMessages(input.messages,input.profile,provider==='nvidia'?'text-meta':'json'),temperature:0.2,max_tokens:1600,stream:false};
 if(provider==='nvidia'){
  // NVIDIA uses natural answer text with optional source metadata.
  // parseAnswer normalises and validates the returned answer.
  payload.chat_template_kwargs={enable_thinking:false};
  if(model.startsWith('nvidia/nemotron-3'))payload.chat_template_kwargs.force_nonempty_content=true;

 }else{
  payload.response_format={type:'json_object'};
  payload.reasoning={enabled:false};
 }
 if(!allowed(req)){res.setHeader('Retry-After','60');return reply(res,429,{error:'You have sent several questions quickly. Please wait a minute before trying again.'});}
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),48000);
 try{
  const response=await fetch(endpoint,{
   method:'POST',headers,
   body:JSON.stringify(payload),
   signal:controller.signal
  });
  if(response.status===202)return reply(res,503,{error:'The AI provider is still preparing this answer. Please wait a moment and try again.'});
  if(response.status===429)return reply(res,429,{error:'The free AI service is busy or has reached its request limit. Please try later. The course-fit guide is still available.'});
  if([401,402,403].includes(response.status))return reply(res,503,{error:'The AI connection is unavailable. Please use the guide for now; the site owner needs to check the API settings.'});
  if(!response.ok)return reply(res,503,{error:'The AI provider is temporarily unavailable. Please try later or use the course-fit guide.'});
  const data=await response.json();
  if(data.error)return reply(res,503,{error:'The AI provider could not complete this answer. Please try again later.'});
  const choice=data.choices?.[0];
  if(choice?.finish_reason==='length')return reply(res,502,{error:'The answer was cut short. Please ask a shorter question or try again.'});
  let answer;
  try{answer=parseAnswer(choice?.message?.content,{allowPlainText:provider==='nvidia'});}
  catch(error){
   // Metadata only: never log keys, user questions, evidence or reasoning.
   console.warn('[AI response format]',JSON.stringify({provider,model,finishReason:choice?.finish_reason||null,contentType:typeof choice?.message?.content,contentLength:typeof choice?.message?.content==='string'?choice.message.content.length:0}));
   throw error;
  }
  // One optional model editing pass for an explicitly brief answer. Never
  // truncate text or replace it with a canned course response. The same
  // timeout and evidence context apply to both calls.
  const style=briefRequest(input.messages.at(-1).content);
  const issues=styleIssues(answer.answer,style);
  if(issues.length){
   try{
    const editInstruction=revisionInstruction(answer,issues);
    const revision={...payload,max_tokens:500,messages:[{...payload.messages[0],content:payload.messages[0].content+'\nFINAL EDITING TASK:\n'+editInstruction},...payload.messages.slice(1)]};
    const revisedResponse=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(revision),signal:controller.signal});
    if(revisedResponse.ok){
     const revisedData=await revisedResponse.json();
     const revisedChoice=revisedData.choices?.[0];
     if(revisedChoice?.finish_reason!=='length'){
      const revised=parseAnswer(revisedChoice?.message?.content,{allowPlainText:provider==='nvidia'});
      // Do not silently drop a known uncertainty during a style revision.
      if(stylePenalty(revised.answer,style)<stylePenalty(answer.answer,style)&&(!answer.needsConfirmation||revised.needsConfirmation))answer=revised;
     }
    }
   }catch{
    // Preserve the valid initial answer if the optional editing call fails.
    // No extra warning badge or provider details are shown to the visitor.
   }
  }
  return reply(res,200,answer);
 }catch(error){
  if(error.name==='AbortError')return reply(res,504,{error:'The AI service took too long to answer. Please try again. Your question has been kept.'});
  if(error.message==='INVALID_ANSWER')return reply(res,502,{error:'The assistant could not prepare a reliable answer. Please try again or ask LAPAAS directly.'});
  return reply(res,503,{error:'The AI connection was interrupted. Please try again or use the guide.'});
 }finally{clearTimeout(timer);}
}
