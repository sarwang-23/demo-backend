'use strict';
const $=s=>document.querySelector(s);let credential=new URLSearchParams(location.hash.slice(1)).get('token');
// Remove the bearer secret from browser history immediately. It is never stored or logged.
if(location.hash)history.replaceState(null,'',location.pathname);
if(credential){$('#recover').hidden=true;$('#complete').hidden=false;$('#heading').textContent='Set your account password';$('#description').textContent='Complete a verified staff invitation or recover your existing account. Use at least 12 characters.';}
async function submit(form,path,body){const button=form.querySelector('button');button.disabled=true;$('#message').textContent='Working...';$('#message').className='fine';try{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'}),data=await r.json();if(!r.ok)throw Error(data.error?.message||'This action could not be completed.');$('#message').textContent=data.data?.message||'Password saved. Sign in with your new password.';if(path.endsWith('/complete')){credential=null;form.reset();form.hidden=true;}}catch(e){$('#message').className='error';$('#message').textContent=e.message;}finally{button.disabled=false;}}
$('#recover').onsubmit=e=>{e.preventDefault();submit(e.target,'/api/v2/account/recover',Object.fromEntries(new FormData(e.target)));};
$('#complete').onsubmit=e=>{e.preventDefault();submit(e.target,'/api/v2/account/complete',{...Object.fromEntries(new FormData(e.target)),token:credential});};
