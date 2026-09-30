module.exports = require('../server/stripe-webhook.cjs').createWebhookHandler();
module.exports.config = { api: { bodyParser: false } };
