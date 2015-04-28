process.env.LK_SCRIPTS_ROOT = "/Users/robert/Dropbox/Projects/lk-scripts"
process.env.WORKSPACE_LK = process.env.LIVELY
require('./life_star')({
    host: 'localhost',
    port: 9001,
    fsNode: process.env.LIVELY,
    enableTesting: true,
    logLevel: 'debug',
    subservers: {
        "CommandLineServer": "/Users/robert/Dropbox/Projects/LivelyKernel/core/servers/CommandLineServer.js",
        "HanaInterfaceServer": "/Users/robert/Dropbox/Projects/LivelyKernel/core/servers/HanaInterfaceServer.js",
        "HighScoreServer": "/Users/robert/Dropbox/Projects/LivelyKernel/core/servers/HighScoreServer.js",
        "LogServer": "/Users/robert/Dropbox/Projects/LivelyKernel/core/servers/LogServer.js",
        "NodeJSEvalServer": "/Users/robert/Dropbox/Projects/LivelyKernel/core/servers/NodeJSEvalServer.js",
        "QBFScoresServer": "/Users/robert/Dropbox/Projects/LivelyKernel/core/servers/QBFScoresServer.js",
        "RServer": "/Users/robert/Dropbox/Projects/LivelyKernel/core/servers/RServer.js",
        "RServer2": "/Users/robert/Dropbox/Projects/LivelyKernel/core/servers/RServer2.js",
        "SearchServer": "/Users/robert/Dropbox/Projects/LivelyKernel/core/servers/SearchServer.js",
        "SessionTracker": "/Users/robert/Dropbox/Projects/LivelyKernel/core/servers/SessionTracker.js",
        "SimpleSync": "/Users/robert/Dropbox/Projects/LivelyKernel/core/servers/SimpleSync.js",
        "WebSocketExample": "/Users/robert/Dropbox/Projects/LivelyKernel/core/servers/WebSocketExample.js"
    }
});


// var reporter = require('nodeunit').reporters.default;
// reporter.run(['tests/manifest-test.js']);

//     lifeStarTest = require("./tests/life_star-test-support"),


// lifeStarTest.withLifeStarDo({done: function() {  }}, function(server) {

//   // lifeStarTest.GET('/', function(res) {


//   require('child_process').exec('curl http://localhost:9999/simple.html', function(code, out) {
//     // console.log('done %s', out);
//     server.close();
//   });
// });
