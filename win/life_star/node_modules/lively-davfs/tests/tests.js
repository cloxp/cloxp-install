var Repository = require('../repository'),
    livelyDAVHandler = require('../request-handler'),
    path = require("path"),
    async = require("async"),
    request = require("request"),
    http = require("http"),
    fsHelper = require("lively-fs-helper"),
    port = 9009, testRepo, testServer, handler,
    baseDirectory = __dirname,
    testDirectory = path.join(baseDirectory, "testDir");

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// debugging
function logProgress(msg) {
    return function(thenDo) { console.log(msg); thenDo && thenDo(); }
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// test server
function createServer(thenDo) {
    var server = testServer = http.createServer();
    server.on('close', function() { console.log('lively fs server for tests closed'); });
    server.listen(port, function() {
        console.log('lively fs server for tests started');
        thenDo(null, server); });
}

function closeServer(server, thenDo) {
    server.close(thenDo);
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// request helpers
function installStreambuffer(req) {
  function invokeCb(cb, arg) {
    try { cb.call(null, arg); } catch (e) {
      console.log("life_star streambuffer callback error: ", e);
    }
  }
  
  var done = false, data = null,
    streamBufferDataHandlers = [],
    streamBufferEndHandlers = [];
  
  req.on("data", function(d) {
    if (data) data = Buffer.concat([data, d]);
    else data = d;
    streamBufferDataHandlers.forEach(function(ea) { invokeCb(ea, d) });
  });
  req.on('end', function() {
    done = true;
    streamBufferEndHandlers.forEach(function(ea) { invokeCb(ea) });
    streamBufferDataHandlers = [];
    streamBufferEndHandlers = [];
  });
  
  req.streambuffer = {
    ondata: function(cb) {
        if (done)  invokeCb(cb, data); 
        else streamBufferDataHandlers.push(cb);
    },
    onend: function(cb) {
        if (done) invokeCb(cb);
        else streamBufferEndHandlers.push(cb);
    }
  }
}

function put(path, content, thenDo) {
    var url = 'http://localhost:' + port + '/' + (path || '');
    request.put(url, {body: content}, function(err, res) {
        console.log('PUT done'); thenDo && thenDo(err); });
}
function del(path, thenDo) {
    var url = 'http://localhost:' + port + '/' + (path || '');
    request(url, {method: 'DELETE'}, function(err, res) {
        console.log('DELETE done'); thenDo && thenDo(err); });
}
function get(path, thenDo) {
    var url = 'http://localhost:' + port + '/' + (path || '');
    request(url, {method: 'GET'}, function(err, res, body) {
        thenDo && thenDo(err, body); });
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// tests
var tests = {
    setUp: function (callback) {
        async.series([
            function(next) {
                var files = {
                    "testDir": {
                        "aFile.txt": 'foo bar content',
                        "ignoredDir": {'ignoredFile.txt': 'ignored'},
                        'ignoredFile2.txt': 'ignored'
                    },
                };
                fsHelper.createDirStructure(baseDirectory, files, next);
            },
            logProgress('test files created'),
            createServer,
            logProgress('server created'),
            function(next) {
                handler = new livelyDAVHandler({
                    resetDatabase: true,
                    fs: testDirectory,
                    excludedDirectories: [/ignoredDir/],
                    excludedFiles: [/^ignoredFile[0-9]*/],
                    timemachine: {path: 'timemachine/'}
                });
                testRepo = handler.repository;
                testServer.on('request', function(req, res, next) {
                    installStreambuffer(req);
                    if (handler.delay) {
                        setTimeout(handler.handleRequest.bind(handler, req, res, next), handler.delay);
                    } else {
                        handler.handleRequest(req, res, next);
                    }
                });
                handler.registerWith(null, testServer, next)
            },
            logProgress('handler setup')
        ], callback);
    },
    tearDown: function (callback) {
        async.series([
            testRepo.close.bind(testRepo),
            function(next) { testServer.close(next); },
            fsHelper.cleanupTempFiles
        ], callback);
    },
    testFileList: function(test) {
        test.expect(3);
        testRepo.getFiles(function(err, files) {
            test.equal(files.length, 1, '# files');
            test.equal(files[0].path, 'aFile.txt', 'file name');
            test.equal(files[0].change, 'initial', 'no change');
            test.done();
        });
    },

    testPutCreatesNewVersion: function(test) {
        test.expect(4);
        async.series([
            function(next) {
                put('aFile.txt', 'test');
                testRepo.once('synchronized', next);
            },
            function(next) {
                testRepo.getFiles(function(err, files) {
                    test.equal(files.length, 1, '# files');
                    test.equal(files[0].path, 'aFile.txt', 'file name');
                    test.equal(files[0].change, 'contentChange', 'no change recorded');
                    test.equal(files[0].content, 'test', 'no content recorded');
                    next();
                });
            }
        ], test.done);
    },

    testSlowPutProcessing: function(test) {
        test.expect(4);
        async.series([
            function(next) {
                handler.delay = 200;
                put('aFile.txt', 'test');
                testRepo.once('synchronized', next);
            },
            function(next) {
                testRepo.getFiles(function(err, files) {
                    test.equal(files.length, 1, '# files');
                    test.equal(files[0].path, 'aFile.txt', 'file name');
                    test.equal(files[0].change, 'contentChange', 'no change recorded');
                    test.equal(files[0].content, 'test', 'no content recorded');
                    next();
                });
            }
        ], test.done);
    },

    testDeleteIsRecorded: function(test) {
        var ts;
        test.expect(6);
        async.series([
            function(next) {
                ts = new Date().toISOString().replace(/[0-9]{3}Z/, '000Z');
                del('aFile.txt'); testRepo.once('synchronized', next); },
            function(next) {
                testRepo.getVersionsFor('aFile.txt', function(err, versions) {
                    test.equal(versions.length, 2, '# versions');
                    test.equal(versions[1].path, 'aFile.txt', 'v1: path');
                    test.equal(versions[1].change, 'initial', 'v1: change');
                    test.equal(versions[0].path, 'aFile.txt', 'v2: path');
                    test.equal(versions[0].change, 'deletion', 'v2: change');
                    test.equal(versions[0].date, ts, 'v2: timestamp');
                    next();
                });
            }
        ], test.done);
    },
    testDAVCreatedFileIsFound: function(test) {
        test.expect(5);
        async.series([
            function(next) { put('writtenFile.txt', 'test'); testRepo.once('synchronized', next); },
            function(next) {
                testRepo.getFiles(function(err, files) {
                    test.equal(files.length, 2, '# files');
                    test.equal(files[0].path, 'aFile.txt', 'file name');
                    test.equal(files[1].path, 'writtenFile.txt', 'file name 2');
                    test.equal(files[1].change, 'created', 'file 2 change');
                    test.equal(files[1].content, 'test', 'no content recorded');
                    next();
                });
            }
        ], test.done);
    },
    testExcludedFilesAndDirsAreIgnored: function(test) {
        test.expect(2);
        testRepo.fs.excludedFiles.push('aFile.txt');
        testRepo.fs.excludedFiles.push(/.*\.foo/);
        async.series([
            function(next) {
                put('aFile.txt', 'test');
                testRepo.once('synchronized', next);
            },
            function(next) {
                testRepo.getVersionsFor('aFile.txt', function(err, versions) {
                    test.equal(versions.length, 1, '# "aFile.txt" not ignored');
                    next();
                });
            },
            function(next) {
                put('aFile.foo', 'test');
                testRepo.once('synchronized', next);
            },
            function(next) {
                testRepo.getVersionsFor('aFile.foo', function(err, versions) {
                    test.equal(versions.length, 0, '# "aFile.foo" not ignored');
                    next();
                });
            }
        ], test.done);
    },

    testTimeMachineHTTPAccess: function(test) {
        test.expect(3);
        async.series([
            function(next) {
                testRepo.fs.addVersions([
                    {path: 'file1.txt', content: 'v1 content', version: 1, date: new Date('2013-10-01 10:55:01 PDT')},
                    {path: 'file1.txt', content: 'v2 content', version: 2, date: new Date('2013-10-01 10:56:01 PDT')},
                    {path: 'file1.txt', content: 'v3 content', version: 3, date: new Date('2013-10-12 10:01:01 PDT')},
                ], {}, next);
            },
            function(next) {
                put('file1.txt', 'v4 content');
                testRepo.once('synchronized', next);
            },
            function(next) {
                get('file1.txt', function(err, content) {
                    test.equal(content, 'v4 content', 'content of simple GET');
                    next(err);
                });
            },
            function(next) {
                testRepo.getVersionsFor('file1.txt', function(err, versions) {
                    test.equal(versions.length, 4, '# version');
                    next();
                });
            },
            function(next) {
                get('timemachine/' + encodeURIComponent('2013-10-12 10:01:01 PDT') + '/file1.txt', function(err, content) {
                    test.equal(content, 'v3 content', 'timemachined GET');
                    next(err);
                });
            },
        ], test.done);
    },

    testTimeMachineHTTPAccessFallsbackToFilesystemIfResourceNotVersioned: function(test) {
        test.expect(3);
        testRepo.fs.excludedFiles.push(/.*\.ignored/);
        async.series([
            function(next) {
                put('aFile.ignored', 'test');
                testRepo.once('synchronized', next);
            },
            function(next) {
                get('aFile.ignored', function(err, content) {
                    test.equal(content, 'test', 'normal GET of existing resource failed');
                    next(err);
                });
            },
            function(next) {
                testRepo.getVersionsFor('aFile.ignored', function(err, versions) {
                    test.equal(versions.length, 0, '# version');
                    next();
                });
            },

            function(next) {
                get('timemachine/' + encodeURIComponent('2013-10-12 10:01:01 PDT') + '/aFile.ignored', function(err, content) {
                    test.equal(content, 'test', 'timemachined GET no filesystem fallback');
                    next(err);
                });
            },
        ], test.done);
    }

};

module.exports = tests;
