function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return (forwarded ? forwarded.split(',')[0].trim() : null) || req.socket.remoteAddress;
}

const _rateLimits = new Map();

function checkRateLimit(ip, endpoint, maxReqs, windowMs) {
  const key = `${ip}:${endpoint}`;
  const now = Date.now();
  let entry = _rateLimits.get(key);
  if (!entry || now > entry.reset) entry = { count: 0, reset: now + windowMs };
  entry.count++;
  _rateLimits.set(key, entry);
  return entry.count <= maxReqs;
}

module.exports = { getClientIp, checkRateLimit };
