function normalizeDomain(input) {
  return (input || '').trim().toLowerCase()
    .replace(/^https?:\/\//i, '').replace(/^www\./i, '')
    .replace(/[/?#].*$/, '').replace(/:\d+$/, '');
}

function sendError(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

module.exports = { normalizeDomain, sendError };
