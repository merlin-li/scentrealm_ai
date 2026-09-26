export default async function handler(req, res) {
  res.status(200).json({
    code: 200,
    msg: 'success',
    success: true,
    data: [
      // '08:D1:F9:12:E8:4E',
      // '08:D1:F9:12:C8:1E',
      // '08:D1:F9:12:CE:D6'
    ]
  })
}
