const { createHandlers } = require('../../../lib/nutrisnap')
export const config = { api: { bodyParser: { sizeLimit: '1mb' } }, maxDuration: 30 }
export default createHandlers().records
