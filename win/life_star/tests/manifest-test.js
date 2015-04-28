/*global exports, require, JSON, __dirname, console*/

// continously run with:
// nodemon nodeunit tests/manifest-test.js

var testHelper = require('./test-helper'),
    http = require('http'),
    lifeStarTest = require("./life_star-test-support"),
    testSuite = {},
    fs = require('fs');

function createSimpleHTML() {
  lifeStarTest.createDirStructure(__dirname, {
    "simple.html": "<!DOCTYPE html>\n"
                 + "<html>\n"
                 + "  <head><title>Foo</title></head>\n"
                 + "  <body>Test</body>\n"
                 + "</html>\n"
                 + "\n"
  });
}

function createDirectoryWithVariousFiles() {
  lifeStarTest.createDirStructure(__dirname, {
    testDir: {
      "file1.js": "//Some code in here\nalert('1');",
      "dont-cache.txt": "shouldn't be cached",
      "but.css": "body {\ncolor: red\n}",
      "favicon.ico": "also the icon",
      "foo": {
        "file2.js": "//Some code in here\nalert('2');",
        "someimage.png": "images are cached as well",
        "bar": {
          "file3.js": "//Some code in here\nalert('3');",
          "simple.html": "<!DOCTYPE html>\n"
                       + "<html>\n"
                       + "  <head><title>Foo</title></head>\n"
                       + "  <body>simple</body>\n"
                       + "</html>\n"
        }
      }
    }
  });
}

testSuite.ManifestTest = {

  setUp: function(run) {
    run();
  },

  tearDown: function(run) {
    lifeStarTest.cleanupTempFiles(function() {
      lifeStarTest.shutDownLifeStar(run);
    });
  },

  "life star is embedding manifest ref in html": function(test) {
    // patch html so that the html manifest attribute is added and points to
    // the manifest file
    createSimpleHTML();
    lifeStarTest.withLifeStarDo(test, function() {
      lifeStarTest.GET('/simple.html', function(res) {
        test.equals(200, res.statusCode);
        test.ok(/<html manifest="\/lively.appcache">/.test(res.body),
                'No manifest ref in ' + res.body);
        test.done();
      });
    }, {fsNode: __dirname + '/', useManifestCaching: true});
  },

  "life star is not embedding manifest ref if feature is disabled": function(test) {
    createSimpleHTML();
    lifeStarTest.withLifeStarDo(test, function() {
      lifeStarTest.GET('/simple.html', function(res) {
        test.equals(200, res.statusCode);
        test.ok(/<html>/.test(res.body), 'Manifest unexpectedly in ' + res.body);
        test.done();
      });
    }, {fsNode: __dirname + '/', useManifestCaching: false});
  },

  "don't crash on requests of non-existing files": function(test) {
    test.done(); return;
    lifeStarTest.withLifeStarDo(test, function() {
      lifeStarTest.GET('/does-not-exist.html', function(res) {
        test.equals(404, res.statusCode);
        test.done();
      });
    }, {fsNode: __dirname + '/', useManifestCaching: true});
  },

  "serve manifest file with all js scripts in a dir": function(test) {
    createDirectoryWithVariousFiles();
    var creationTime = Math.floor(Date.now() / 1000);
    lifeStarTest.withLifeStarDo(test, function() {
      lifeStarTest.GET('/lively.appcache', function(res) {
        test.equals(200, res.statusCode);
        test.equals('no-cache, private', res.headers['cache-control']);
        test.ok(res.headers['content-type'].indexOf('text/cache-manifest') === 0, 'content-type header?');
        var expectedFirst = "CACHE MANIFEST\n"
                          + "# timestamp " + creationTime + "\n\n\n",
            // since find sorting can differ between OSes
            expectedSecond = ["CACHE:",
                              "/but.css",
                              "/favicon.ico",
                              "/file1.js",
                              "/foo/bar/file3.js",
                              "/foo/file2.js",
                              "/foo/someimage.png"].sort().join('\n'),
            expectedThird = "\n\n\n"
                          + 'NETWORK:\n'
                          + '*\nhttp://*\nhttps://*\n',
            s = res.body,
            first = s.slice(0, s.indexOf('CACHE:')),
            second = s.slice(s.indexOf('CACHE:'), s.indexOf('\n\n\nNETWORK:')).split('\n').sort().join('\n'),
            third = s.slice(s.indexOf('\n\n\nNETWORK:'));
        test.equals(expectedFirst, first, "\n>>>>\n" + expectedFirst + "\n=====\n" + first + '<<<<');
        test.equals(expectedSecond, second, "\n>>>>\n" + expectedSecond + "\n=====\n" + second + '<<<<');
        test.equals(expectedThird, third, "\n>>>>\n" + expectedThird + "\n=====\n" + third + '<<<<');
        test.done();
      });
    }, {fsNode: __dirname + '/testDir', useManifestCaching: true});
  }

}

exports.testSuite = testSuite;
