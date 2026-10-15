import {questions} from './flow.js';
import {summaryHTML,escapeHTML as esc} from './guide.js';
const $=id=>document.getElementById(id);
let answers={},step=-1,view='guide',returnFocus=null,previousOverflow='',busy=false;
let messages=[],lastFailed=null,requestController=null,generation=0;
const dialog=$('assistant-dialog'),guide=$('guide-screen');
function label(q){return q.options.find(o=>o[0]===answers[q.key])?.[1]||'';}
function openAssistant(trigger){
  if(!dialog.hidden)return;
  returnFocus=trigger||document.activeElement;previousOverflow=document.body.style.overflow;
  dialog.hidden=false;$('backdrop').hidden=false;
  document.querySelector('.screen').inert=true;$('assistant-launcher').inert=true;
  $('assistant-launcher').setAttribute('aria-expanded','true');
  document.body.style.overflow='hidden';
  syncMobileViewport();
  (view==='chat'?$('chat-input'):guide.querySelector('button')||$('close-assistant')).focus();
}
function syncMobileViewport(){
 if(!dialog.hidden && window.matchMedia('(max-width: 600px)').matches && window.visualViewport){
  dialog.style.height=window.visualViewport.height+'px';
  dialog.style.top=window.visualViewport.offsetTop+'px';
 }else{dialog.style.height='';dialog.style.top='';}
}
window.visualViewport?.addEventListener('resize',syncMobileViewport);
window.visualViewport?.addEventListener('scroll',syncMobileViewport);
window.addEventListener('resize',syncMobileViewport);
function closeAssistant(){
  dialog.hidden=true;$('backdrop').hidden=true;
  document.querySelector('.screen').inert=false;$('assistant-launcher').inert=false;
  $('assistant-launcher').setAttribute('aria-expanded','false');
  document.body.style.overflow=previousOverflow;dialog.style.height='';dialog.style.top='';returnFocus?.focus();
}
function setView(next){
 view=next;dialog.classList.toggle('chat-mode',next==='chat');$('guide-view').hidden=next!=='guide';$('chat-view').hidden=next!=='chat';
 syncNavigation();
 if(next==='chat'){updateContext();renderMessages();$('chat-input').focus();}
}
function syncNavigation(){
 $('assistant-navigation').hidden=view==='guide'&&step===-1;
}
function updateContext(){
 const count=questions.filter(q=>answers[q.key]).length;
 $('profile-note').hidden=!count;
 $('profile-note').textContent=count===7?'Your seven answers are included in this conversation.':count+' of your guide answers will help personalise the conversation.';
}
function renderGuide(focus=false){
 $('guide-view').classList.toggle('is-home',step===-1);
 $('guide-view').classList.toggle('is-question',step>=0&&step<7);
 if(step===-1){
  guide.innerHTML='<div class="a-welcome"><img class="a-home-logo" src="./assets/lapaas-logo.svg" alt="" aria-hidden="true" width="58" height="58"><div class="kicker">A little clarity before you begin</div><h2>Let’s check if this course fits your goal.</h2><p>Tell us what you want to build, or ask about the course. Start wherever you feel comfortable.</p><div class="a-routes"><button class="a-route" data-action="start"><span><strong>Help me decide</strong><small>Seven quick choices. Guidance for your goal.</small></span><span aria-hidden="true">→</span></button><button class="a-route secondary-route" data-action="chat"><span><strong>Ask a course question</strong><small>Get an answer about learning, access or costs.</small></span><span aria-hidden="true">→</span></button></div></div>';
 }else if(step===7){
  guide.innerHTML=summaryHTML(answers);
 }else{
  const q=questions[step];
  guide.innerHTML=`<div class="kicker">Question ${step+1} of 7 · ${esc(q.label)}</div><div class="progress" aria-label="Question ${step+1} of 7"><span style="width:${(step+1)/7*100}%"></span></div><h2 id="question" tabindex="-1">${esc(q.question)}</h2><div class="options" role="group" aria-labelledby="question">${q.options.map(([value,text])=>`<button class="option" type="button" data-choice="${value}" aria-pressed="${answers[q.key]===value}">${esc(text)}</button>`).join('')}</div><div class="navrow"><button class="btn quiet" type="button" data-action="restart">Start again</button><div class="buttons"><button class="btn" type="button" data-action="back">← Back</button><button class="btn primary" type="button" id="continue" data-action="next" ${answers[q.key]?'':'disabled'}>${step===6?'See my summary':'Continue'} →</button></div></div>`;
 }
 updateContext();syncNavigation();
 if(focus){$('guide-view').scrollTop=0;(guide.querySelector('h2')||$('assistant-title')).setAttribute('tabindex','-1');(guide.querySelector('h2')||$('assistant-title')).focus({preventScroll:true});$('guide-view').scrollTop=0;}
}
function safeText(text){
 // Escape everything before formatting the small Markdown subset used in answers.
 return esc(text).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/^[•-] /gm,'• ');
}
function renderMessages(){
 const log=$('chat-log');
 $('chat-view').classList.toggle('is-empty',!messages.length);
 log.classList.toggle('is-empty',!messages.length);
 if(!messages.length){
  log.innerHTML='<div class="a-chat-intro"><h3>What would you like to know?</h3><p>Ask in your own words. I can explain the course and flag anything that needs confirmation.</p><div class="a-suggestions"><button type="button" data-question="I have no coding experience. How could I start?">Can I start without coding? ↗</button><button type="button" data-question="How could this help me with freelance marketing work?">How could this help my client work? ↗</button><button type="button" data-question="What will I pay for the course and extra AI tools?">What could the total cost be? ↗</button></div></div>';
 }else{
  log.innerHTML=messages.map(m=>`<article class="a-message ${m.role}"><span class="speaker">${m.role==='user'?'You':'Lapaas assistant'}</span><div class="message-text">${safeText(m.content)}</div>${m.sources?.length?`<details class="a-sources"><summary>Course information used</summary><p>${m.sources.map(s=>esc(s.question)).join('<br>')}<br><a href="https://cohort.lapaas.com/" target="_blank" rel="noopener">Official course page ↗</a> · Knowledge checked 14 October 2026</p></details>`:''}</article>`).join('');
 }
 if(busy)log.insertAdjacentHTML('beforeend','<div class="a-loading" role="status">Checking the course information…</div>');
 log.scrollTop=log.scrollHeight;
 $('send-message').disabled=busy;$('clear-chat').disabled=busy;$('retry-message').disabled=busy;
}
async function sendMessage(text,retry=false){
 const question=String(text||'').trim();
 if(!question||busy)return;
 if(question.length>1600)return;
 const myGeneration=generation;
 if(!retry){
   lastFailed=null;
   messages.push({role:'user',content:question});
   $('chat-input').value='';$('chat-input').style.height='auto';
 }
 busy=true;$('chat-error').hidden=true;renderMessages();
 requestController=new AbortController();
 const timer=setTimeout(()=>requestController?.abort(),55000);
 try{
  const history=messages.slice(-12).map(({role,content})=>({role,content}));
  while(history.length>1 && history.reduce((n,m)=>n+m.content.length,0)>14000)history.shift();
  const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:history,profile:answers}),signal:requestController.signal});
  let payload;
  try{payload=await response.json();}catch{throw new Error('The assistant could not connect. Please try again, or use the guide.');}
  if(!response.ok)throw new Error(payload.error||'The assistant is temporarily unavailable. Please try again.');
  if(typeof payload.answer!=='string'||!payload.answer.trim())throw new Error('The assistant returned an empty answer. Please try again.');
  if(myGeneration!==generation)return;
  messages.push({role:'assistant',content:payload.answer,sources:payload.sources||[],needsConfirmation:payload.needsConfirmation===true});
  lastFailed=null;
 }catch(error){
  if(myGeneration!==generation)return;
  lastFailed=question;
  $('error-text').textContent=error.name==='AbortError'?'The answer took too long. Please try again. Your question is still here.':error.message||'The connection was interrupted. Please try again.';
  $('chat-error').hidden=false;
 }finally{
  clearTimeout(timer);
  if(myGeneration===generation){busy=false;requestController=null;renderMessages();}
 }
}
document.addEventListener('click',e=>{
 const launch=e.target.closest('[data-assistant]');if(launch){openAssistant(launch);return;}
 const b=e.target.closest('button');if(!b)return;
 if(b.hasAttribute('data-choice')){
   const q=questions[step];if(!q)return;
   answers[q.key]=b.dataset.choice;
   guide.querySelectorAll('[data-choice]').forEach(el=>el.setAttribute('aria-pressed',el.dataset.choice===answers[q.key]));
   $('continue').disabled=false;updateContext();return;
 }
 if(b.hasAttribute('data-edit')){step=Number(b.dataset.edit);renderGuide(true);return;}
 if(b.hasAttribute('data-question')){sendMessage(b.dataset.question);return;}
 switch(b.dataset.action){
  case 'start':step=0;renderGuide(true);break;
  case 'next':if(answers[questions[step]?.key]){step++;renderGuide(true);}break;
  case 'back':step=Math.max(-1,step-1);renderGuide(true);break;
  case 'restart':answers={};step=-1;renderGuide(true);break;
  case 'edit':step=0;renderGuide(true);break;
  case 'chat':setView('chat');break;
 }
});
$('assistant-home').addEventListener('click',()=>{step=-1;setView('guide');renderGuide(true);});
$('error-guide').addEventListener('click',()=>setView('guide'));
$('close-assistant').addEventListener('click',closeAssistant);
$('backdrop').addEventListener('click',closeAssistant);
$('expand-assistant').addEventListener('click',()=>{
 const expanded=dialog.classList.toggle('fullscreen');
 $('expand-assistant').setAttribute('aria-pressed',expanded);
 $('expand-assistant').setAttribute('aria-label',expanded?'Exit full screen':'Expand to full screen');
 $('expand-assistant').title=expanded?'Exit full screen':'Full screen';
});
$('chat-form').addEventListener('submit',e=>{e.preventDefault();sendMessage($('chat-input').value);});
$('retry-message').addEventListener('click',()=>{if(lastFailed)sendMessage(lastFailed,true);});
$('clear-chat').addEventListener('click',()=>{
 if(busy)return;generation++;messages=[];lastFailed=null;$('chat-error').hidden=true;renderMessages();$('chat-input').focus();
});
$('chat-input').addEventListener('input',e=>{e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,100)+'px';});
$('chat-input').addEventListener('keydown',e=>{
 if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&window.matchMedia('(min-width: 601px)').matches){e.preventDefault();sendMessage(e.target.value);}
});
document.addEventListener('keydown',e=>{
 if(dialog.hidden)return;
 if(e.key==='Escape'){e.preventDefault();closeAssistant();}
 if(e.key==='Tab'){
   const items=[...dialog.querySelectorAll('button:not(:disabled),a[href],textarea,summary,[tabindex="0"]')].filter(el=>!el.closest('[hidden]')&&getComputedStyle(el).display!=='none');
   const first=items[0],last=items.at(-1);
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
   else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
 }
});
renderGuide();renderMessages();
if(new URLSearchParams(location.search).get('assistant')==='open'){openAssistant();dialog.classList.add('fullscreen');$('expand-assistant').setAttribute('aria-pressed','true');$('expand-assistant').setAttribute('aria-label','Exit full screen');}
