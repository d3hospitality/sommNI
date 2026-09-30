module.exports = require('../server/wine-scan.cjs').createScanHandler();
module.exports.config = { api: { bodyParser: { sizeLimit: '3mb' } }, maxDuration: 90 };
