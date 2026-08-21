import server from '../dist/server/server.js'

export default async function handler(req, res) {
  try {
    const protocol = req.headers['x-forwarded-proto'] || 'https'
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost'
    const url = `${protocol}://${host}${req.url}`

    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) {
        if (Array.isArray(value)) {
          for (const v of value) headers.append(key, v)
        } else {
          headers.set(key, value)
        }
      }
    }

    const method = req.method || 'GET'
    let body = undefined
    if (method !== 'GET' && method !== 'HEAD') {
      body = await new Promise((resolve) => {
        const chunks = []
        req.on('data', (chunk) => chunks.push(chunk))
        req.on('end', () => resolve(Buffer.concat(chunks)))
      })
    }

    const webRequest = new Request(url, {
      method,
      headers,
      body,
    })

    const webResponse = await server.fetch(webRequest)

    res.statusCode = webResponse.status
    webResponse.headers.forEach((value, key) => {
      res.setHeader(key, value)
    })

    if (webResponse.body) {
      const reader = webResponse.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(value)
      }
      res.end()
    } else {
      res.end()
    }
  } catch (error) {
    console.error('Server error:', error)
    res.statusCode = 500
    res.end(error instanceof Error ? error.stack : String(error))
  }
}
