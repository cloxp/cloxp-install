// var subserverStart = require('../lively-server-inspector'),
//     server = require('../lively-pluggable-server'),
//     port = 9003, server;

// subserverStart.route = '/inspect';
// server.start({port: port, subservers: [subserverStart]}, function(err, s) {
//     console.log('running');
// });

var livelyRepositories = require('./repository'),
    path = require("path"),
    async = require("async"),
    request = require("request"),
    fsHelper = require("lively-fs-helper"),
    port = 9003, testRepo;

livelyRepositories.start({
    fs: path.join(process.cwd()), port: port,
}, function(err, repo) { global.testRepo = repo; console.log('started'); })
