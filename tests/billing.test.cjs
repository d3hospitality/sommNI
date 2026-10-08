const {test}=require('node:test');const assert=require('node:assert/strict');const Stripe=require('stripe');
const {createBillingHandler}=require('../server/billing.cjs');
const {createWebhookHandler}=require('../server/stripe-webhook.cjs');
const card=require('../shared/rate-card.json');
const {env,invoke,fixture,user}=require('./billing-helpers.cjs');
function billing(f,e=env){return createBillingHandler({getDb:()=>f.db,env:e,getStripe:()=>f.stripe})}
test('the app is free: token packs are one payment at the card price, fixed URLs, stable checkout idempotency',async()=>{
 const f=fixture(),h=billing(f);assert.equal((await invoke(h,{action:'checkout-tokens',pack:'t5',price:'evil'})).status,400);
 assert.equal((await invoke(h,{action:'checkout-tokens',pack:'t5'})).status,200,'no purchase needed before buying tokens');
 assert.equal((await invoke(h,{action:'checkout-tokens',pack:'t5'})).status,200);
 const calls=f.calls.filter(c=>c[0]==='stripe-checkout');assert.equal(calls[0][2].idempotencyKey,calls[1][2].idempotencyKey);
 const body=calls[0][1];assert.equal(body.mode,'payment');assert.equal(body.line_items[0].price_data.unit_amount,500);assert.match(body.line_items[0].price_data.product_data.description,/unlocks wineLENS for life/);
 assert.deepEqual(body.metadata,{app:'winelens',user_id:user.id,pack:'t5'});assert.equal(body.success_url,'https://sommni-beige.vercel.app/link?checkout=returned');
 assert.equal(body.subscription_data,undefined,'no subscription');
});
test('no app purchase or retired plan checkout',async()=>{
 assert.equal((await invoke(billing(fixture()),{action:'checkout-app'})).status,400);
 assert.equal((await invoke(billing(fixture()),{action:'checkout-plan',plan:'monthly'})).status,400);
});
test('one open checkout at a time, reused while open',async()=>{
 const f=fixture();f.setAttempt({choice:'t20'});assert.equal((await invoke(billing(f),{action:'checkout-tokens',pack:'t5'})).status,409);
 const g=fixture();g.setAttempt({session_id:'cs_open'});assert.equal((await invoke(billing(g),{action:'checkout-tokens',pack:'t5'})).body.reused,true);
});
test('inline fixed packs (v3 units), same-app metadata',async()=>{
 const f=fixture();f.setAttempt({choice:'t20'});assert.equal((await invoke(billing(f),{action:'checkout-tokens',pack:'t20'})).status,200);
 const body=f.calls.find(c=>c[0]==='stripe-checkout')[1];assert.equal(body.line_items[0].price_data.unit_amount,2000);assert.match(body.line_items[0].price_data.product_data.name,/100 tokens/);
 assert.deepEqual(body.metadata,{app:'winelens',user_id:user.id,pack:'t20'});
 assert.equal((await invoke(billing(f),{action:'checkout-tokens',pack:'t999'})).status,400);
});
test('fail closed; portal and auto spend; welcome tokens on status; no unauthenticated billing',async()=>{
 const f=fixture();assert.equal((await invoke(billing(f,{...env,WINELENS_BILLING_ENABLED:'false'}),{action:'checkout-tokens',pack:'t5'})).body.error,'Not available yet, you have not been charged.');
 assert.equal((await invoke(billing(f),{action:'portal'})).status,200);
 assert.equal((await invoke(billing(f,{...env,WINELENS_BILLING_ENABLED:'false'}),{action:'portal'})).status,200);
 assert.equal((await invoke(billing(f),{action:'auto-spend',enabled:true})).status,200,'tokens are prepaid: no purchase needed');
 assert.equal((await invoke(billing(f),{action:'status'},{headers:{}})).status,401);
 assert.equal((await invoke(billing(f),{action:'status'},{headers:{origin:'https://evil.test'}})).status,403);
 const status=await invoke(billing(f),{action:'status'});
 assert.deepEqual(status.body.welcome,card.welcome);assert.equal(card.welcome.tokens,3);assert.equal(status.body.app,undefined);
 const welcome=f.calls.filter(c=>c[0]==='winelens_grant_welcome');assert.equal(welcome.length,1);assert.deepEqual(welcome[0][1],{p_user:user.id});
 assert.ok(f.calls.indexOf(welcome[0])<f.calls.lastIndexOf(f.calls.filter(c=>c[0]==='winelens_billing_status').at(-1)),'welcome before the balance is read');
 const g=fixture();g.setState({welcomeFails:true});assert.equal((await invoke(billing(g),{action:'status'})).status,200,'a missing welcome function never blocks status');
});
function event(overrides={},object={}){return {id:'evt_test',type:'checkout.session.completed',created:123,livemode:false,data:{object:{id:'cs_paid',mode:'payment',payment_status:'paid',currency:'usd',amount_total:500,client_reference_id:user.id,metadata:{app:'winelens',user_id:user.id,pack:'t5'},...object}},...overrides}}
async function sendEvent(f,e,signature){const stripe=new Stripe(env.STRIPE_SECRET_KEY);f.stripe.webhooks=stripe.webhooks;const raw=JSON.stringify(e);return invoke(createWebhookHandler({getDb:()=>f.db,env,getStripe:()=>f.stripe}),Buffer.from(raw),{headers:{'stripe-signature':signature||stripe.webhooks.generateTestHeaderString({payload:raw,secret:env.STRIPE_WEBHOOK_SECRET})}})}
test('actual raw-body Stripe signature verification; one grant per session',async()=>{
 const f=fixture();assert.equal((await sendEvent(f,event(),'bad')).status,400);assert.equal(f.grants.size,0);
 assert.equal((await sendEvent(f,event())).status,200);assert.equal((await sendEvent(f,event({id:'evt_again'}))).status,200);assert.equal(f.grants.size,1);
 const grant=f.calls.find(c=>c[0]==='winelens_grant_tokens');assert.equal(grant[1].p_units,card.packs.t5.units);
});
test('a retired app purchase is refused like any unknown pack',async()=>{
 const f=fixture();assert.equal((await sendEvent(f,event({},{amount_total:999,metadata:{app:'winelens',user_id:user.id,purchase:'app'}}))).status,400);assert.equal(f.grants.size,0);
});
test('webhook ignores other app/unpaid/subscriptions; rejects wrong amount/currency/mode',async()=>{
 for(const patch of [{amount_total:1},{currency:'eur'}]){const f=fixture();assert.equal((await sendEvent(f,event({},patch))).status,400);assert.equal(f.grants.size,0);}
 for(const patch of [{metadata:{app:'polygot'}},{payment_status:'unpaid'},{mode:'subscription'}]){const f=fixture();assert.equal((await sendEvent(f,event({},patch))).status,200);assert.equal(f.grants.size,0);}
 const f=fixture();assert.equal((await sendEvent(f,event({livemode:true}))).status,400);
 const g=fixture();assert.equal((await sendEvent(g,event({type:'customer.subscription.updated'},{object:'subscription'}))).status,200);assert.equal(g.calls.filter(c=>c[0].startsWith('winelens_')).length,0);
});
test('webhook reads the raw request stream without touching lazy JSON body parser',async()=>{
 const {Readable}=require('node:stream');const {readRaw}=require('../server/stripe-webhook.cjs');
 const body=Buffer.from('{ "preserve":  "whitespace" }');const req=Readable.from([body]);
 Object.defineProperty(req,'body',{get(){throw Error('must not invoke body parser')}});
 assert.deepEqual(await readRaw(req),body);
});
