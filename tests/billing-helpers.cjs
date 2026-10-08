const { randomUUID } = require('node:crypto');
const user = { id:'11111111-1111-4111-8111-111111111111',email:'test@example.test',email_confirmed_at:'2026-01-01' };
const sid='22222222-2222-4222-8222-222222222222';
const token = ['e30',Buffer.from(JSON.stringify({sub:user.id,session_id:sid})).toString('base64url'),'fake'].join('.');
const env = { STRIPE_SECRET_KEY:'sk_test_fake_unit_test_only',STRIPE_WEBHOOK_SECRET:'whsec_fake_unit_test_only',STRIPE_PRICE_PRO_MONTHLY:'price_monthly',STRIPE_PRICE_PRO_ANNUAL:'price_annual',WINELENS_BILLING_ENABLED:'true',OPENAI_API_KEY:'fake-unit-test-only' };
async function invoke(handler, body, extra={}) {
 let status=200, result; const headers={};
 const res={setHeader:(k,v)=>headers[k]=v,status(n){status=n;return this},json(x){result=x;return this},end(){return this}};
 await handler({method:'POST',headers:{authorization:'Bearer '+token},body,...extra},res);
 return { status, body:result, headers };
}
function fixture() {
 const calls=[], rows={winelens_entitlements:{user_id:user.id,customer_id:'cus_test',status:'free'}};
 let state={plan:'free',pro:false,tokens:100,allowances:{label_scan:{limit:5,remaining:5}}};
 let attempt={id:randomUUID(),choice:'app',expires_at:new Date(Date.now()+3600000).toISOString()};
 const grants=new Set();
 const db={auth:{getUser:async()=>({data:{user}})},from(table){
   let operation='select',value,filters=[];
   const query={select(){return this},eq(k,v){filters.push([k,v]);return this},is(k,v){filters.push([k,v]);return this},maybeSingle:async()=>({data:rows[table]||null}),
   upsert(v){operation='upsert';value=v;return this},update(v){operation='update';value=v;return this},then(resolve){
    if(operation==='upsert') rows[table] ||= value;
    if(operation==='update' && filters.every(([k,v])=>rows[table]?.[k]===v || (v===null && rows[table]?.[k]==null))) rows[table]={...rows[table],...value};
    resolve({data:null,error:null}); }};return query;
 },async rpc(name,args){calls.push([name,args]);
   if(name==='wl_check_session')return {data:{status:'active'}};
   if(name==='winelens_billing_status')return {data:state};
   if(name==='winelens_reserve_checkout')return {data:attempt};
   if(name==='winelens_grant_tokens'||name==='winelens_grant_app'){const replayed=grants.has(args.p_stripe_session);grants.add(args.p_stripe_session);return {data:{replayed}};}
   return {data:{}};
 }};
 const prices=plan=>({id:env[plan==='monthly'?'STRIPE_PRICE_PRO_MONTHLY':'STRIPE_PRICE_PRO_ANNUAL'],active:true,livemode:false,type:'recurring',currency:'usd',unit_amount:plan==='monthly'?499:3999,billing_scheme:'per_unit',recurring:{interval:plan==='monthly'?'month':'year',interval_count:1}});
 const stripe={prices:{retrieve:async id=>prices(id==='price_monthly'?'monthly':'annual')},customers:{create:async()=>({id:'cus_test'})},subscriptions:{list:()=>[]},checkout:{sessions:{create:async(data,opts)=>{calls.push(['stripe-checkout',data,opts]);return {id:'cs_checkout',url:'https://checkout.stripe.com/c/pay_test'};},retrieve:async()=>({status:'open',url:'https://checkout.stripe.com/c/pay_test'})}},billingPortal:{sessions:{create:async()=>({url:'https://billing.stripe.com/p/session'})}}};
 return {db,stripe,calls,rows,prices,grants,setState(v){state={...state,...v}},setAttempt(v){attempt={...attempt,...v}}};
}
module.exports={user,sid,token,env,invoke,fixture};
