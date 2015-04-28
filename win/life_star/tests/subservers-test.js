/*global exports, require, JSON, __dirname, console*/

// continously run with:
// nodemon nodeunit tests/subservers-test.js

var testHelper = require('./test-helper'),
    lifeStarTest = require("./life_star-test-support"),
    async = require('async'),
    testSuite = {},
    fs = require('fs');

var simpleSubserverSource = "module.exports = function(baseRoute, app) {\n"
                          + "    app.get(baseRoute, function(req, res) {\n"
                          + "        res.send('hello');\n"
                          + "    });\n"
                          + "}\n";

function createSubserverFile(path, source) {
  source = source || simpleSubserverSource;
  return lifeStarTest.createTempFile(__dirname + '/../' + path, source);
}

testSuite.SubserverTest = {

  setUp: function(run) {
    run();
  },

  tearDown: function(run) {
    lifeStarTest.shutDownLifeStar(function() {
      lifeStarTest.cleanupTempFiles(function() { run(); });
    });
  },

  "life star is running": function(test) {
    lifeStarTest.withLifeStarDo(test, function() {
      test.done();
    });
  },

  "server placed in subserver dir is started and accessible": function(test) {
    createSubserverFile('subservers/foo.js');
    lifeStarTest.withLifeStarDo(test, function() {
      lifeStarTest.GET("/nodejs/foo/", function(res) {
        test.equals('hello', res.body);
        test.done();
      });
    })
  },

  "subservers via options are started": function(test) {
    createSubserverFile('tests/foo.js');
    lifeStarTest.withLifeStarDo(test, function() {
      lifeStarTest.GET('/nodejs/bar/', function(res) {
        test.equals('hello', res.body);
        test.done();

      });
    }, {subservers: {bar: './../tests/foo.js'}});
  }

}

testSuite.SubserverMetaTest = {

  setUp: function(run) {
    run();
  },

  tearDown: function(run) {
    lifeStarTest.cleanupTempFiles(function() {
      lifeStarTest.shutDownLifeStar(run);
    });
  },

  "list subservers": function(test) {
    createSubserverFile('subservers/foo.js');
    lifeStarTest.withLifeStarDo(test, function() {
      lifeStarTest.GET('/nodejs/subservers', function(res) {
          test.deepEqual(['foo'], JSON.parse(res.body), "subserver list");
          test.done();
      });
    })
  },

  "unload subserver": function(test) {
    createSubserverFile('subservers/foo.js');
    lifeStarTest.withLifeStarDo(test, function() {
      lifeStarTest.POST('/nodejs/subservers/foo/unload', null, function(res) {
        var data = '';
        test.equals(200, res.statusCode);
        lifeStarTest.GET('/nodejs/foo/', function(res) {
          test.equals(404, res.statusCode);
          test.done();
        })

      });
    });
  },

  "get subserver source": function(test) {
    createSubserverFile('subservers/foo.js', simpleSubserverSource);
    lifeStarTest.withLifeStarDo(test, function() {
      lifeStarTest.GET('/nodejs/subservers/foo', function(res) {
        test.equals(simpleSubserverSource, res.body);
        test.done();

      });
    });
  },

  "set subserver source": function(test) {
    createSubserverFile('subservers/foo.js', simpleSubserverSource);
    var newSource = "module.exports = function(baseRoute, app) {\n"
                  + "    app.get(baseRoute, function(req, res) {\n"
                  + "        res.send('new source');\n"
                  + "    });\n"
                  + "}\n";
    lifeStarTest.withLifeStarDo(test, function() {
      lifeStarTest.PUT('/nodejs/subservers/foo', newSource, function(res) {
        test.equals(200, res.statusCode);
        lifeStarTest.GET('/nodejs/foo/', function(res) {
          test.equals('new source', res.body);
          test.done();

        });
      });
    });
  },

  "create subserver": function(test) {
    lifeStarTest.withLifeStarDo(test, function() {
      lifeStarTest.PUT('/nodejs/subservers/foo', simpleSubserverSource, function(res) {
        test.equals(201, res.statusCode);
        lifeStarTest.registerTempFile(__dirname + '/../subservers/foo.js');
        lifeStarTest.GET('/nodejs/foo/', function(res) {
          test.equals('hello', res.body);
          test.done();

        });
      });
    });
  },

  "delete subserver": function(test) {
    var file = createSubserverFile('subservers/foo.js');
    lifeStarTest.withLifeStarDo(test, function() {
      lifeStarTest.DEL('/nodejs/subservers/foo', function(res) {
        test.equals(200, res.statusCode, 'delete req did not work');
        lifeStarTest.GET('/nodejs/foo/', function(res) {
          test.equals(404, res.statusCode);
          test.ok(!fs.existsSync(file), "subserver file not deleted");
          lifeStarTest.GET('/nodejs/subservers', function(res) {
            test.ok(JSON.parse(res.body).indexOf('foo') === -1, "subserver foo still in list");
            test.done();
          });
        });
      });
    });
  }

}

exports.testSuite = testSuite;
