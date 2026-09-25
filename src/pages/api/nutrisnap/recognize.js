const { createHandlers } = require('../../../lib/nutrisnap')
// 3 MB binary -> 4 MB base64, below Vercel's 4.5 MB request limit.
export const config = { api: { bodyParser: { sizeLimit: '4300kb' } }, maxDuration: 45 }
export default createHandlers().recognize
