module.exports = require('../server/wine-list.cjs').createWineListHandler();
module.exports.config = { api: { bodyParser: { sizeLimit: '4.5mb' } }, maxDuration: 240 };
