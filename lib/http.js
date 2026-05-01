const https = require('https');

function makeRequest(opts, body) {
  return new Promise((resolve, reject) => {
    const payload = body != null
      ? (typeof body === 'string' ? body : JSON.stringify(body))
      : null;
    const options = { ...opts, headers: { ...opts.headers } };
    if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);
    const r = https.request(options, resp => {
      let raw = '';
      resp.on('data', c => raw += c);
      resp.on('end', () => resolve({ status: resp.statusCode, body: raw }));
    });
    r.on('error', reject);
    r.setTimeout(options.timeout || 10000, () => {
      r.destroy();
      reject(new Error(`Timeout: ${options.hostname}`));
    });
    if (payload) r.write(payload);
    r.end();
  });
}

module.exports = { makeRequest };
