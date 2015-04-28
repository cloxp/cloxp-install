var spawn = require('child_process').spawn;

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// auth info from SSL client certificate
// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

// the proxy server can set x-forwarded-* headers for client authorization,
// extract those and assign to the session cookie

function extractEmailFromCert(certSource, session, next) {
  // tries to extract the email from the certificate using the openssl
  // commandline tool
  if (!certSource) { return false };
  // fix the newlines in certSource
  certSource = '-----BEGIN CERTIFICATE-----\n'
             + certSource
               .replace('-----BEGIN CERTIFICATE----- ', '')
               .replace('-----END CERTIFICATE----- ', '')
               .replace(/ /g, '\n')
             + '-----END CERTIFICATE-----\n';
  var openssl = spawn('openssl', ["x509", "-inform", "pem", "-email", "-noout"], {
    stdio: ['pipe', 'pipe', process.stderr]
  });

  var result = '';
  openssl.stdout.on('data', function(data) { result += data.toString(); })

  openssl.on('exit', function() {
    if (result.length > 0) session.email = result.replace(/\n/g, '');
    next();
  });

  // send the cert to openssl stdin, decode it and query for the email
  openssl.stdin.write(certSource);
  openssl.stdin.end();

  return true;
}

function extractApacheClientCertHeadersIntoSession(req, res, next) {
  var subj = req.get('x-forwarded-subjectdn');
  if (subj) res.cookie('ssl-certificate-subject', subj, {httpOnly: false});
  var session = req.session;
  if (!session.user) {
    var user = req.get('x-forwarded-user');
    if (user) session.user = user;
  }
  if (!session.email) {
    var email = req.get('x-forwarded-email');
    if (email && email !== '(null)') session.email = email;
    else if (extractEmailFromCert(req.get('ssl_client_cert'), session, next)) {
      // extractEmailFromCert thinks it can help but is async, so don't
      // call next immediately
      return; }
  }
  next();
}

module.exports = {
  extractApacheClientCertHeadersIntoSession: extractApacheClientCertHeadersIntoSession
};
