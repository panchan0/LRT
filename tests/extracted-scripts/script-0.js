(()=>{
    globalThis.__ravenUUID=globalThis.__ravenUUID||(()=>{try{if(typeof crypto?.randomUUID==='function')return __ravenUUID()}catch{}const b=new Uint8Array(16);try{crypto.getRandomValues(b)}catch{for(let i=0;i<b.length;i++)b[i]=(Math.random()*256)|0}b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;return [...b].map((v,i)=>(i===4||i===6||i===8||i===10?'-':'')+v.toString(16).padStart(2,'0')).join('')});
    const p=e=>{try{e.preventDefault()}catch{}};
    const editable=e=>e.target instanceof Element&&!!e.target.closest('input,textarea,[contenteditable="true"]');
    const nonEditable=e=>{if(!editable(e))p(e)};
    for(const n of ['gesturestart','gesturechange','gestureend'])addEventListener(n,p,{capture:true,passive:false});
    for(const n of ['contextmenu','dragstart','selectstart'])addEventListener(n,nonEditable,{capture:true,passive:false});
    addEventListener('dblclick',nonEditable,{capture:true,passive:false});
    let lastTouchEnd=0;
    addEventListener('touchend',e=>{const now=Date.now();if(now-lastTouchEnd<360&&!editable(e))p(e);lastTouchEnd=now},{capture:true,passive:false});
    addEventListener('wheel',e=>{
      if(!e.ctrlKey&&!e.metaKey)return;
      p(e);
    },{capture:true,passive:false});
  })();