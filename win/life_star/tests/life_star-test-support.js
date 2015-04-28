/*global module, console, setTimeout*/

var lifeStar = require("./../life_star"),
    fs = require('fs'),
    exec = require('child_process').exec,
    async = require('async'),
    path = require('path'),
    http = require('http'),
    util = require('util'),
    server;

function withLifeStarDo(test, func, options) {
  if (server) throw new Error('life_star already running!');
  options = util._extend(options || {}, {dbConf: {enableVersioning: false, enableRewriting: false}});
  options.host = options.host || 'localhost';
  options.port = options.port || 9999;
  server = lifeStar(options, function(err, server) { func(server); });
  server.on('error', function(e) {
    test.ifError(e);
    test.done();
  });
}

function shutDownLifeStar(thenDo) {
  if (!server) {
    thenDo();
  } else {
    console.log('shutting down server...');
    server.close(function() { console.log('... done'); server = null; thenDo(); });
  }
}

var tempFiles = [], tempDirs = [];
function registerTempFile(filename) {
  tempFiles.push(filename);
}

function createTempFile(filename, content) {
  fs.writeFileSync(filename, content);
  registerTempFile(filename);
  console.log('created ' + filename);
  return filename;
}

function createTempDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  tempDirs.unshift(dir);
}

function cleanupTempFiles(thenDo) {
  async.series(
    tempFiles.map(function(file) {
      return function(cb) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
        else console.warn('trying to cleanup file %s but it did not exist', file);
        cb();
      };
    }).concat(tempDirs.map(function(dir) {
      return function(cb) {
        exec('rm -rfd ' + dir, function(code, out, err) { cb(); });
      }
    })),
    function() {
      tempFiles = [];
      tempDirs = [];
      thenDo && thenDo();
    }
  )
}

function createDirStructure(basePath, spec) {
  // spec is an object like
  // {"foo": {"bar.js": "bla"}}
  // will create dir "foo/" and file foo/bar.js with "bla" as content
  for (var name in spec) {
    var p = path.join(basePath, name);
    if (typeof spec[name] === 'string') {
      createTempFile(p, spec[name]);
      continue;
    }
    if (typeof spec[name] === 'object') {
      createTempDir(p);
      createDirStructure(p, spec[name]);
      continue;
    }
  }
}

function withResponseBodyDo(res, callback) {
  var data = "";
  res.on('data', function(d) { data += d; })
  res.on('end', function(err) {
    callback(err, data);
  });
}

function request(method, path, data, headers, callback) {
  if (typeof data === 'function' && !callback) { callback = data; data = null }
  if (typeof headers === 'function' && !callback) { callback = headers; headers = null }
  var req = http.request({
    hostname: "localhost",
    port: 9999,
    path: path,
    method: method,
    headers: headers
  }, function(res) {
    var data = '';
    res.on('data', function(d) { data += d.toString(); });
    res.on('end', function() { res.body = data; callback && callback(res); });
    res.on("error", function(err) { console.error("life_star-test response error: ", err); });
  });
  req.on("error", function(err) { console.error("life_star-test request error: ", err); });
  if (data) req.write(typeof data === 'object' ? JSON.stringify(data) : data);
  req.end();
  return req;
}

module.exports = {
  withLifeStarDo: withLifeStarDo,
  shutDownLifeStar: shutDownLifeStar,
  registerTempFile: registerTempFile,
  createTempFile: createTempFile,
  cleanupTempFiles: cleanupTempFiles,
  createDirStructure: createDirStructure,
  withResponseBodyDo: withResponseBodyDo,
  GET: request.bind(null, 'GET'),
  PUT: request.bind(null, 'PUT'),
  DEL: request.bind(null, 'DELETE'),
  POST: request.bind(null, 'POST')
}
