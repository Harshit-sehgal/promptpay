// Hermetic stub of the Ateva API + attestation provider, used to prove what
// the CLI actually prints during a wait state. No real network, no real creds.
const http = require('http');
const fs = require('fs');

const LOG = process.env.STUB_LOG || '/tmp/stub-calls.log';
function record(line) {
  fs.appendFileSync(LOG, line + '\n');
}

const AD = {
  impressionToken: 'imp_STUB_TOKEN_1',
  campaignId: 'camp_1',
  creativeId: 'cre_1',
  title: 'ACME Cloud Build',
  message: 'Ship faster with 10x parallel CI runners. Free for OSS.',
  label: 'Sponsored',
  displayDomain: 'acme.example',
  destinationUrl: 'https://acme.example/build?utm=ateva',
  ctaText: 'Start free trial',
};

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    record(`${req.method} ${req.url} ${body.slice(0, 400)}`);
    const send = (obj, code = 200) => {
      const s = JSON.stringify(obj);
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(s);
    };
    const path = req.url.split('?')[0];
    switch (path) {
      case '/health':
        return send({ environmentKind: 'development', environmentId: 'stub-dev' });
      case '/extension/register-device':
        return send({ id: 'dev_stub_1', eventSecret: 'stub-event-secret-0123456789abcdef' });
      case '/extension/wait-attestation/session':
        return send({
          attestationSessionId: 'att_stub_1',
          nonce: 'nonce_stub_1',
          operationStartDeadline: new Date(Date.now() + 600000).toISOString(),
          consumeDeadline: new Date(Date.now() + 1800000).toISOString(),
        });
      case '/attest':
        return send({ assertion: 'stub-provider-signed-assertion-value-long-enough-0123456789' });
      case '/extension/ad-request':
        return send({ ad: AD, mode: 'earnings_enabled' });
      default:
        return send({ ok: true });
    }
  });
});

server.listen(Number(process.env.PORT || 4599), '127.0.0.1', () => {
  console.log('stub api listening on', server.address().port);
});
