import dotenv from 'dotenv'
import http from 'http'
import { readFileSync } from 'fs'

dotenv.config()
const port = process.env.PORT ?? 8080
const host = process.env.HOST ?? '0.0.0.0'

http.createServer(function (req, res) {
    const htmlFile = readFileSync('./index.html')
    res.write(htmlFile)
    res.end()
}).listen(port)

console.log(`listening on http://${host}:${port}`)