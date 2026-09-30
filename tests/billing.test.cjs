const {test}=require('node:test');const assert=require('node:assert/strict');const Stripe=require('stripe');
const {createBillingHandler,validatePrice,LIVE_STATUSES}=require('../server/billing.cjs');
const {createWebhookHandler}=require('../server/stripe-webhook.cjs');
const {env,invoke,fixture,user}=require('./billing-helpers.cjs');
function billing(f,e=env){return createBillingHandler({getDb:()=>f.db,env:e,getStripe:()=>f.stripe})}
test('valid prices; reject wrong amount, currency, interval, inactive, mode, transform',()=>{
 const f=fixture();for(const plan of ['monthly','annual'])assert.doesNotThrow(()=>validatePrice(f.prices(plan),plan,env));
 for(const patch of [{active:false},{unit_amount:999},{currency:'eur'},{livemode:true},{type:'one_time'},{billing_scheme:'tiered'},{transform_quantity:{}},{recurring:{interval:'year',interval_count:1}},{recurring:{interval:'month',interval_count:2}}]) assert.throws(()=>validatePrice({...f.prices('monthly'),...patch},'monthly',env));
});
test('plan-only input, fixed URLs, no trial, stable checkout idempotency',async()=>{
 const f=fixture(),h=billing(f);assert.equal((await invoke(h,{action:'checkout-plan',plan:'monthly',price:'evil'})).status,400);
 assert.equal((await invoke(h,{action:'checkout-plan',plan:'monthly'})).status,200);assert.equal((await invoke(h,{action:'checkout-plan',plan:'monthly'})).status,200);
 const calls=f.calls.filter(c=>c[0]==='stripe-checkout');assert.equal(calls[0][2].idempotencyKey,calls[1][2].idempotencyKey);
 assert.equal(calls[0][1].subscription_data.trial_period_days,undefined);assert.equal(calls[0][1].success_url,'https://sommni-beige.vercel.app/link?checkout=returned');
});
test('duplicate guard for every live status including paused, DB and Stripe',async()=>{
 for(const status of LIVE_STATUSES){const f=fixture();f.rows.winelens_entitlements.status=status;assert.equal((await invoke(billing(f),{action:'checkout-plan',plan:'monthly'})).status,409);}
 const f=fixture();f.stripe.subscriptions.list=()=>[{status:'past_due',metadata:{app:'winelens'}}];assert.equal((await invoke(billing(f),{action:'checkout-plan',plan:'annual'})).status,409);
});
test('one open checkout, including token packs',async()=>{
 const f=fixture();assert.equal((await invoke(billing(f),{action:'checkout-plan',plan:'annual'})).status,409);
 f.setAttempt({session_id:'cs_open'});assert.equal((await invoke(billing(f),{action:'checkout-plan',plan:'monthly'})).body.reused,true);
});
test('tokens require Pro; inline fixed packs, same-app metadata',async()=>{
 const f=fixture();assert.equal((await invoke(billing(f),{action:'checkout-tokens',pack:'t5'})).status,403);
 f.setState({pro:true});f.setAttempt({choice:'t5'});assert.equal((await invoke(billing(f),{action:'checkout-tokens',pack:'t5'})).status,200);
 const body=f.calls.find(c=>c[0]==='stripe-checkout')[1];assert.equal(body.line_items[0].price_data.unit_amount,500);assert.deepEqual(body.metadata,{app:'winelens',user_id:user.id,pack:'t5'});
});
test('fail closed; portal and auto spend; no unauthenticated billing',async()=>{
 const f=fixture();assert.equal((await invoke(billing(f,{...env,WINELENS_BILLING_ENABLED:'false'}),{action:'checkout-plan',plan:'monthly'})).body.error,'Not available yet, you have not been charged.');
 assert.equal((await invoke(billing(f),{action:'portal'})).status,200);
 assert.equal((await invoke(billing(f,{...env,WINELENS_BILLING_ENABLED:'false'}),{action:'portal'})).status,200);
 assert.equal((await invoke(billing(f),{action:'auto-spend',enabled:true})).status,403);f.setState({pro:true});assert.equal((await invoke(billing(f),{action:'auto-spend',enabled:true})).status,200);
 assert.equal((await invoke(billing(f),{action:'status'},{headers:{}})).status,401);
 assert.equal((await invoke(billing(f),{action:'status'},{headers:{origin:'https://evil.test'}})).status,403);
});
function event(overrides={}){return {id:'evt_test',type:'checkout.session.completed',created:123,livemode:false,data:{object:{id:'cs_paid',mode:'payment',payment_status:'paid',currency:'usd',amount_total:500,client_reference_id:user.id,metadata:{app:'winelens',user_id:user.id,pack:'t5'}}},...overrides}}
async function sendEvent(f,e,signature){const stripe=new Stripe(env.STRIPE_SECRET_KEY);f.stripe.webhooks=stripe.webhooks;const raw=JSON.stringify(e);return invoke(createWebhookHandler({getDb:()=>f.db,env,getStripe:()=>f.stripe}),Buffer.from(raw),{headers:{'stripe-signature':signature||stripe.webhooks.generateTestHeaderString({payload:raw,secret:env.STRIPE_WEBHOOK_SECRET})}})}
test('actual raw-body Stripe signature verification; one grant per session',async()=>{
 const f=fixture();assert.equal((await sendEvent(f,event(),'bad')).status,400);assert.equal(f.grants.size,0);
 assert.equal((await sendEvent(f,event())).status,200);assert.equal((await sendEvent(f,event({id:'evt_again'}))).status,200);assert.equal(f.grants.size,1);
});
test('webhook ignores other app/unpaid; rejects wrong amount/currency/mode',async()=>{
 for(const patch of [{amount_total:1},{currency:'eur'}]){const f=fixture(),e=event();Object.assign(e.data.object,patch);assert.equal((await sendEvent(f,e)).status,400);assert.equal(f.grants.size,0);}
 for(const patch of [{metadata:{app:'polygot'}},{payment_status:'unpaid'},{mode:'subscription'}]){const f=fixture(),e=event();Object.assign(e.data.object,patch);assert.equal((await sendEvent(f,e)).status,200);assert.equal(f.grants.size,0);}
 const f=fixture();assert.equal((await sendEvent(f,event({livemode:true}))).status,400);
});
test('subscription rereads current state, forwards ordering, ignores other apps before retrieve',async()=>{
 const f=fixture();const sub={id:'sub_new',metadata:{app:'winelens',user_id:user.id},livemode:false,status:'active',customer:'cus_test',created:100,cancel_at_period_end:false,items:{data:[{quantity:1,price:{id:'price_monthly'},current_period_start:100,current_period_end:10000}]}};
 f.stripe.subscriptions.retrieve=async()=>sub;
 const e=event({type:'customer.subscription.updated',data:{object:sub}});assert.equal((await sendEvent(f,e)).status,200);
 const call=f.calls.find(c=>c[0]==='winelens_sync_subscription');assert.equal(call[1].p_subscription.id,'sub_new');assert.equal(call[1].p_event_created,123);
 f.stripe.subscriptions.retrieve=()=>{throw Error('should not retrieve')};e.data.object={...sub,metadata:{app:'polygot'}};assert.equal((await sendEvent(f,e)).status,200);
});

test('webhook reads the raw request stream without touching lazy JSON body parser',async()=>{
 const {Readable}=require('node:stream');const {readRaw}=require('../server/stripe-webhook.cjs');
 const body=Buffer.from('{ "preserve":  "whitespace" }');const req=Readable.from([body]);
 Object.defineProperty(req,'body',{get(){throw Error('must not invoke body parser')}});
 assert.deepEqual(await readRaw(req),body);
});
