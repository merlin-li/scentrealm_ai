const { createHandlers } = require('../../../lib/nutrisnap')
export const config = { api: { bodyParser: { sizeLimit: '2kb' } }, maxDuration: 15 }
export default createHandlers().login
