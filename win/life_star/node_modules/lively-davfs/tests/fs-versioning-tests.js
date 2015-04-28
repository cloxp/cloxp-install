var Repository = require('../repository'),
    path = require("path"),
    fs = require("fs"),
    util = require("util"),
    async = require("async"),
    EventEmitter = require("events").EventEmitter,
    fsHelper = require("lively-fs-helper"),
    baseDirectory = __dirname,
    testDirectory = path.join(baseDirectory, "testDir"),
    sqlite3 = require('sqlite3').verbose(),
    dbFile = path.join(testDirectory, 'test-db.sqlite'),
    testRepo, fakeDAVPlugin, testDb;

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// debugging
function logProgress(msg) {
    return function(thenDo) { console.log(msg); thenDo && thenDo(); }
}
// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// db helpers
function createDB(dbLocation, thenDo) {
    testDb = new sqlite3.Database(':memory:');
    thenDo();
}

function fakeDAVChange(relPath, content, author, date) {
    var request = util._extend({}, EventEmitter.prototype);
    EventEmitter.call(request);
    fakeDAVPlugin.emit('fileChanged', {
        uri: relPath,
        req: request,
        content: {isDone: true, buffer: new Buffer(content)}});
    fs.writeFileSync(path.join(testDirectory, relPath), content);
    fakeDAVPlugin.emit('afterFileChanged', {uri: relPath});
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// tests
var versionedFilesystemTests = {
    setUp: function (callback) {
        async.series([
            function(next) {
                var files = {
                    "testDir": {"aFile.txt": 'foo bar content'}
                };
                // var files = {
                //     "testDir": {
                //         "aFile.txt": 'foo bar content',
                //         "dir1": {
                //             "otherFile.txt": "content content content",
                //             "boing.jpg": "imagin this would be binary",
                //             "dir1.1": {"xxx.txt": 'ui'}
                //         },
                //         "dir2": {
                //             "file1.foo": "1",
                //             "file2.foo": "2"
                //         },
                //         "dir3": {}
                //     }
                // };
                fsHelper.createDirStructure(baseDirectory, files, next);
            },
            logProgress('test files created'),
            function(next) {
                fakeDAVPlugin = util._extend({}, EventEmitter.prototype);
                EventEmitter.call(fakeDAVPlugin);
                testRepo = new Repository({fs: testDirectory});
                testRepo.attachToDAVPlugin(fakeDAVPlugin);
                testRepo.start(true/*resetDatabase*/, next);
            },
            logProgress('repo setup')
        ], callback);
    },
    tearDown: function (callback) {
        async.series([
            testRepo.close.bind(testRepo),
            fsHelper.cleanupTempFiles
        ], callback);
    },

    testNewVersionOnFileChange: function(test) {
        test.expect(15);
        var date = new Date();
        async.series([
            function(next) {
                fakeDAVChange('aFile.txt', 'new content', 'test author', date);
                testRepo.once('synchronized', next);
            },
            function(next) {
                testRepo.getRecords({paths: ['aFile.txt']}, function(err, versions) {
                    test.equal(versions.length, 2, '# versions');
                    test.equal(versions[1].version, 0, 'v1: version ' + versions[1].version);
                    test.equal(versions[0].version, 1, 'v2: version');
                    next();
                });
            },
            function(next) {
                testRepo.getRecords({paths: ['aFile.txt'], version: 0}, function(err, records) {
                    test.ok(records.length === 1, 'no record v0');
                    var record = records[0];
                    test.equal(record.path, 'aFile.txt', 'path');
                    test.equal(record.author, 'unknown', 'author');
                    test.equal(record.content, 'foo bar content', 'content');
                    var stat = fs.statSync(path.join(testDirectory, record.path));
                    test.equal(record.date, stat.mtime.toISOString(), 'date');
                    next();
                });
            },
            function(next) {
                testRepo.getRecords({paths: ['aFile.txt'], version: 1}, function(err, records) {
                    test.ok(records.length === 1, 'no record');
                    var record = records[0];
                    test.equal(record.path, 'aFile.txt', 'path');
                    test.ok(record, 'no record v2');
                    test.equal(record.path, 'aFile.txt', 'path v2');
                    test.equal(record.author, 'unknown', 'author v2');
                    test.equal(record.content, 'new content', 'content v2');
                    var stat = fs.statSync(path.join(testDirectory, record.path));
                    test.equal(record.date, stat.mtime.toISOString(), 'date v2');
                    next();
                });
            }
        ], test.done);
    },

    testDiskReadOnlyImportsUnimportedFiles: function(test) {
        test.expect(2);
        var date = new Date();
        async.series([
            function(next) { testRepo.fs.readStateFromFiles(next); },
            function(next) {
                testRepo.getRecords({paths: ['aFile.txt']}, function(err, versions) {
                    test.equal(versions.length, 1, '# versions');
                    // iso timestamps in sqlite are really coarse so we wait quite a while...
                    setTimeout(next, 1000);
                });
            },
            function(next) { fs.writeFile(path.join(testDirectory, 'aFile.txt'), 'xxx', next); },
            function(next) { testRepo.fs.readStateFromFiles(next); },
            function(next) {
                testRepo.getRecords({paths: ['aFile.txt']}, function(err, versions) {
                    test.equal(versions.length, 2, '# versions');
                    next();
                });
            },
        ], test.done);
    },

    testPathAreNormalizedOnWriteAndRead: function(test) {
        var path = 'C:\\foo\\bar\\baz';
        async.series([
            function(next) {
                var record = {
                    version: undefined,
                    change: 'creation',
                    author: 'unknown',
                    date: new Date().toISOString(),
                    content: 'fooooo',
                    path: path,
                }
                testRepo.fs.addVersions([record], {}, function(err, version) {
                    test.ifError(err);
                    next();
                });
            },
            function(next) {
                testRepo.getRecords({paths: [path]}, function(err, records) {
                    test.equal(records.length, 1, '# versions');
                    test.equal(records[0].content, 'fooooo', 'content');
                    next();
                });
            }
        ], test.done);
    }

};

module.exports = versionedFilesystemTests;
