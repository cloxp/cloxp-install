 /*global require, module*/

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// manifest files are used by web browsers for cacheing see
// http://appcachefacts.info/ and
// http://www.alistapart.com/articles/application-cache-is-a-douchebag/ for
// more info
// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

var exec = require('child_process').exec,
    manifestFileName = "lively.appcache",
    headers = {
      'Content-Type': 'text/cache-manifest',
      'Cache-Control': 'no-cache, private'
    },
    config, lastFileModificationTime, manifestContent;

// -=-=-=-
// helper
// -=-=-=-
var manifestFilePattern = ["*.js", "*.css", "*.ico", "*.png", "*.gif"],
    observeFilePattern = manifestFilePattern.concat(["*.html"]);

function buildFindCommand(patterns) {
  // ignore .git and node_modules dirs
  var findPatternExpr = '\\( -iname "' + patterns.join('" -o -iname "') + '" \\)',
      cmd = 'find .'
          + ' \\( -name lost+found -or -name node_modules -or -name .git \\) -type d -prune'
          + ' -o ' + findPatternExpr;
  return cmd;
}

function findJSFilesForManifest(rootDir, thenDo) {
  // find paths for all matching files
  exec(buildFindCommand(manifestFilePattern) + ' -print',
       {cwd: rootDir},
       function(code, out, err) { thenDo(code, out); });
}

// stat on linux and Mac OS differ...
var lastModInSecsCmd = process.platform === 'darwin' ?
  'stat -f "%m"' : // use formt "%m %N" to also get the filename
  'stat -c "%Y"';

function lastModificationDateOfFilesIn(dir, thenDo) {
  // Find and return recursively the last mod time (in seconds) of the last
  // changed file in dir.
  // NOTE: contrary to the function above we also include html files here.
  // html files are cached implicitly by the browser and we want changes in
  // them to be visible in a browser session as well.
  var cmd = buildFindCommand(observeFilePattern)
          + ' -exec ' + lastModInSecsCmd + ' {} \\;'
          + ' | sort -rn'
          + ' | head -1';
  exec(cmd, {cwd: dir}, function(code, out, err) { thenDo(code, out); });
}

function buildManifestFileContents(baseUri, thenDo) {
  var dir = config.fsNode;
  lastModificationDateOfFilesIn(dir, function(err, lastMod) {
    // 1) check if there are any file modifications
    var shouldGenerate = err
                      || !lastFileModificationTime
                      || lastFileModificationTime !== lastMod
                      || !manifestContent;
    lastFileModificationTime = lastMod;
    // 2) if possible reuse old manifest file
    if (!shouldGenerate) { thenDo(null, manifestContent); return; }
    findJSFilesForManifest(dir, function(err, filesString) {
      // 3) otherwise find all js files and build new manifest
      if (err) { thenDo(err); return; }
      filesString = filesString.replace(/\.\//g, baseUri);
      filesString = filesString.split('\n').map(function(line) { return encodeURI(line); }).join('\n');
      manifestContent = "CACHE MANIFEST\n# timestamp " + lastMod + "\n\n"
                      + 'CACHE:\n' + filesString
                      + '\n\nNETWORK:\n'
                      + '*\nhttp://*\nhttps://*\n';
      thenDo(null, manifestContent);
    });
  });
}

// -=-=-=-=-=-
// the handler
// -=-=-=-=-=-
function ManifestHandler(cfg) {
  config = cfg;
}

ManifestHandler.prototype.registerWith = function(app, server) {
  this.server = server;
  // route for serving the manifest file
  if (!config.useManifestCaching) return;
  function handleRequest(req, res) {
      buildManifestFileContents(server.getBaseUri(), function(err, contents) {
      if (err) {
	console.log(err);
        res.status(500).send('');
      } else {
        res.set(headers);
        res.set('Content-Length', contents.length);
        if (req.method === 'head') res.end();
        else res.send(contents);
      }
    });
  }
  app.get('/' + manifestFileName, handleRequest);
  app.head('/' + manifestFileName, handleRequest);
}

// var newId = (function() {
//   var id = 0;
//   return function() { return ++id }
// })();

ManifestHandler.prototype.addManifestRef = function(req, res) {
  // when serving html files this methods rewrites what is send so that the
  // html source includes a ref to the manifest file
  if (!config.useManifestCaching) return;

  // only when reading html files
  if (!(/\.html$/.test(req.url)) || req.method.toLowerCase() !== 'get') return;

  // that's a bit hacky.... we will capture what is send as a response (HTTP
  // code, headers, and body -- can be send in multiple buffers since response
  // acts as a stream) but not actually send the stuff. What we do:
  // 1) when response.end() is called we will look for "<html>" in the content
  // and replace it with an element declaration that includes the manifest
  // attribute.
  // 2) we path the Content-Length Header
  // 3) we send the header, the patched body content, and finish off by
  // calling the original end()
  var interceptedHeaders, interceptedHeadersCode,
      interceptedData = [],
      writeFunc = res.write,
      endFunc = res.end,
      writeHeadFunc = res.writeHead,
      server = this.server;

  // var id = newId();
  res.writeHead = function(code, headers) {
    // console.log('%s: %s writing code %s and headers %s', id, req.url, code, require('util').inspect(headers));
    interceptedHeadersCode = code;
    interceptedHeaders = headers;
    return this;
  }

  res.write = function(data) {
    var s = data.toString(),
        len = s.length;
    // console.log('%s: %s writing %s chars (%s...%s)', id,
    //             req.url,
    //             len,
    //             s.substring(0, 50),
    //             s.substring(len-50, len));
    interceptedData.push(data);
    return this;
  }

  function addManifestAttributeToResponseBody(buffers) {
    // find the buffer with the "<html>" string.
    // FIXME what if this string is splitted between two buffers...?
    // NOTE: version one simply made one big string out of all buffers and
    // added the ref there, however this does not seem to work for big
    // files...
    for (var i = 0; i < buffers.length; i++) {
	var string = buffers[i].toString(),
	    idx = string.indexOf('<html>');;
	if (idx === -1) continue;
	var manifestRef = ' manifest="' + server.getBaseUri() + manifestFileName + '"';
	string = string.substring(0, idx)
            + '<html' + manifestRef + '>'
            + string.substring(idx + 6);
	var contentLength = Number(interceptedHeaders['content-length']);
	interceptedHeaders['content-length'] = contentLength + manifestRef.length;
	buffers[i] = new Buffer(string);
	return buffers;
    }
    return buffers;
  }

  res.end = function(data) {
    // console.log('%s: %s response.end() called with %s', id, req.url, data && data.toString());
    if (data) interceptedData.push(data);
    interceptedData = addManifestAttributeToResponseBody(interceptedData);
    writeHeadFunc.call(this, interceptedHeadersCode, interceptedHeaders);
    interceptedData.forEach(function(buf) { writeFunc.call(res, buf); });
    return endFunc.call(this);
  }
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

exports.ManifestHandler = ManifestHandler;
