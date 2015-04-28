"use strict";

var log = require('./util').log;
var util = require('util');
var concat = require('concat-stream');

var EventEmitter = require('events').EventEmitter;
var jsDAVPlugin = require("jsDAV/lib/DAV/plugin");

var livelyDAVPlugin = module.exports = jsDAVPlugin.extend({
    name: "livelydav",

    initialize: function(handler) {
        this.handler = handler;
        this._putContent = null;
        handler.addEventListener("beforeMethod", this.beforeMethod.bind(this));
        handler.addEventListener("afterCreateFile", this.afterCreateFile.bind(this));
        handler.addEventListener("afterWriteContent", this.afterWriteContent.bind(this));
        handler.addEventListener("beforeCreateFile", this.beforeCreateFile.bind(this));
        handler.addEventListener("beforeWriteContent", this.beforeWriteContent.bind(this));
        handler.addEventListener("beforeUnbind", this.beforeUnbind.bind(this));
    },

    beforeMethod: function(e, method) {
        log("jsDAV event: beforeMethod %s", method);
        if (method.toLowerCase() === 'put') {
            var handler = this.handler,
                req = this.handler.httpRequest,
                content = {buffer: null, isDone: false};

            // rkrk 2014-08-31: We are using the streambuffer addition to read
            // the content from a request here b/c if the DAV handler is invoked
            // delayed (i.e. other handlers were processing the request before,
            // asynchronously delaying other middlewares) then reading from the
            // req stream directly will not give us the req body anymore. For
            // this known issue all express apps (at least) seem to have the
            // "streambuffer" component which provides ondata/onend handlers.
            // ==> CAVEAT:
            // It seems that streambuffer.ondata, streambuffer.onend is only
            // good for *one* invocation. If there are multiple consumers
            // subsequent ondata/onend invocations will not provide the request
            // data!!!
            // To work around this issue I added our own version of
            // streambuffer to life_star and for the tests in this module to
            // tests/tests.js (see installStreambuffer()).
            if (req.streambuffer) {
                req.streambuffer.ondata(function(d) {
                    if (content.buffer) content.buffer = Buffer.concat([content.buffer, d])
                    else content.buffer = d;
                });
                req.streambuffer.onend(function() { content.isDone = true; });
            } else {
                var write = concat(function(data) {
                    content.buffer = data;
                    content.isDone = true;
                });
                write.on('error', function(err) {
                    console.error("error reading from DAV PUT request: ", err);
                });
                req.pipe(write);
            }

            this._putContent = content;
        }
        return e.next();
    },

    beforeWriteContent: function(e, uri, node) {
        log("jsDAV event: beforeWriteContent %s", uri);
        var req = this.handler.httpRequest,
            username = global.lively && global.lively.userData && global.lively.userData.getUserName(req);
        this.emit('fileChanged', {
            username: username,
            uri: uri,
            req: req,
            content: this._putContent});
        this._putContent = null;
        return e.next();
    },

    afterWriteContent: function(e, uri) {
        log("jsDAV event: afterWriteContent %s", uri);
        this.emit('afterFileChanged', {uri: uri});
        return e.next();
    },

    beforeCreateFile: function(e, uri, data, encoding, node) {
        log("jsDAV event: beforeCreateFile %s", uri);
        var req = this.handler.httpRequest,
            username = global.lively && global.lively.userData && global.lively.userData.getUserName(req);
        this.emit('fileCreated', {
            username: username,
            uri: uri,
            req: req,
            content: this._putContent});
        this._putContent = null;
        return e.next();
    },

    afterCreateFile: function(e, uri) {
        log("jsDAV event: afterCreateFile %s", uri);
        var req = this.handler.httpRequest;
        this.emit('afterFileCreated', {uri: uri, req: req});
        return e.next();
    },

    beforeUnbind: function(e, uri) {
        log("jsDAV event: beforeUnbind %s", uri);
        var req = this.handler.httpRequest,
            username = global.lively && global.lively.userData && global.lively.userData.getUserName(req);
        this.emit('fileDeleted', {uri: uri, req: this.handler.httpRequest, username: username});
        return e.next();
    }
}, EventEmitter.prototype);

livelyDAVPlugin.onNew = function(callback) {
    return {
        "new": function(handler) {
            var plugin = livelyDAVPlugin.new(handler);
            callback(plugin);
            return plugin;
        }
    }
}
