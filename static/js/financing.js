(function(){
  function num(id){ var v=parseFloat(document.getElementById(id).value); return isFinite(v)?v:NaN; }
  function calc(){
    var p=num('fin-price'), d=num('fin-down'), apr=num('fin-apr');
    var n=parseInt(document.getElementById('fin-term').value,10);
    var out=document.getElementById('fin-monthly'), tot=document.getElementById('fin-totals');
    if(!isFinite(p)||p<0||!isFinite(d)||d<0||!isFinite(apr)||apr<0||!isFinite(n)||n<=0){
      out.textContent='—'; tot.textContent='Enter a valid price, down payment, and term.'; return;
    }
    var principal=Math.max(p-d,0), m;
    if(apr===0){ m=principal/n; } else { var r=apr/100/12; m=principal*r/(1-Math.pow(1+r,-n)); }
    out.textContent='$'+Math.round(m).toLocaleString()+'/mo';
    tot.textContent='Total financed: $'+principal.toLocaleString()+' \u00b7 Total paid: $'+Math.round(m*n).toLocaleString();
  }
  ['fin-price','fin-down','fin-apr','fin-term'].forEach(function(id){
    var el=document.getElementById(id);
    el.addEventListener('input',calc); el.addEventListener('change',calc);
  });
  calc();
})();
