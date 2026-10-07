module.exports = require('../server/winebrary.cjs').createWinebraryHandler();
module.exports.config = { api: { bodyParser: { sizeLimit: '3mb' } }, maxDuration: 30 };
