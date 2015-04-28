"use strict"

var async = require("async");
var util = require("util");
var Url = require("url");
var Path = require("path");
var fs = require("fs");

var Repository = require('./repository');
var d = require('./domain');
var EventEmitter = require("events").EventEmitter;

var DavHandler = require('jsDAV/lib/DAV/handler');
var FsTree = require('jsDAV/lib/DAV/backends/fs/tree');
var defaultPlugins = require("jsDAV/lib/DAV/server").DEFAULT_PLUGINS;


function LivelyFsHandler(options) {
    EventEmitter.call(this);
    this.initialize(options);
}

util._extend(LivelyFsHandler.prototype, EventEmitter.prototype);

util._extend(LivelyFsHandler.prototype, d.bindMethods({

    initialize: function(options) {
        options = options || {};
        options.fs = options.fs || process.cwd();
        options.excludedDirectories = options.excludedDirectories || ['.svn', '.git', 'node_modules'];
        options.excludedFiles = options.excludedFiles || ['.DS_Store'];
        options.includedFiles = options.includedFiles || undefined/*allow all*/;
        this.enableVersioning = options.enableVersioning === undefined || !!options.enableVersioning; // default: true
        this.enableRewriting = this.enableVersioning && !!options.enableRewriting; // default: false
        this.bootstrapRewriteFiles = options.bootstrapRewriteFiles || [];
        this.resetDatabase = !!options.resetDatabase;
        this.repository = new Repository(options);
        this.timemachineSettings = (function tmSetup(tmOptions) {
            var allowFileSystemFallback = tmOptions.hasOwnProperty("allowFileSystemFallback") ?
              tmOptions.allowFileSystemFallback : true;
            var path = tmOptions.path;
            if (!path) return null;
            if (path[0] !== '/') path = '/' + path;
            if (path[path.length-1] !== '/') path += '/';
            return {allowFileSystemFallback: allowFileSystemFallback, path: path};
        })(options.timemachine || {path: '/timemachine/'});
    },

    registerWith: function(app, server, thenDo) {
        if (!server) this.emit('error', new Error('livelydavfs request handler needs server!'));
        this.server = server;
        server.davHandler = this;
        var deactivated = !this.enableVersioning;
        var resetDB = this.resetDatabase;
        var handler = this, repo = handler.repository;
        async.series([
            this.patchServer.bind(this, server),
            function(next) {
                deactivated && console.log('no versioning...!');
                if (deactivated) next();
                else repo.start(resetDB, next);
            },
            function(next) {
                server.on('close', repo.close.bind(repo));
                server.on('close', function() { handler.server = null; });
                next();
            }
        ], function(err) {
            if (err) console.error(err);
            console.log('LivelyFsHandler registerWith done');
            thenDo && thenDo(err);
        });
        return this;
    },

    patchServer: function(server, thenDo) {
        // this is what jsDAV expects...
        server.tree = FsTree.new(this.repository.getRootDirectory());
        server.tmpDir = './tmp'; // httpPut writes tmp files
        server.options = {};
        // for showing dir contents
        server.plugins = {
            browser: defaultPlugins.browser};
        if (this.enableVersioning) {
            server.plugins.livelydav = this.repository.getDAVPlugin();
        }
        // https server has slightly different interface
        if (!server.baseUri) server.baseUri = '/';
        if (!server.getBaseUri) server.getBaseUri = function() { return this.baseUri };
        thenDo(null);
    },

    handleRequest: function(req, res, next) {
        if (this.isTimemachineRequest(req)) {
            this.handleTimemachineRequest(req, res, next);
        } else if (this.isRewrittenCodeRequest(req)) {
            // FIXME: temporary divert files named DBG_*.js
            this.handleRewrittenCodeRequest(req, res, next);
        } else {
            // Fix URL to allow non-root installations
            // In Apache config, set:
            //   RequestHeader set x-lively-proxy-path /[your-path]
            var path = '';
            if (req.headers['x-lively-proxy-path']) {
                path = req.headers['x-lively-proxy-path'];
                if (path.substr(-1) == '/') path = path.substr(0, path.length - 1);
            }
            this.server.baseUri = path + '/';
            req.url = path + req.url;
            new DavHandler(this.server, req, res);
        }
    },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // timemachine support
    isTimemachineRequest: function(req) {
        if (!this.timemachineSettings) return false;
        var tmPath = this.timemachineSettings.path;
        return req.url.indexOf(tmPath) === 0;
    },

    makeDateAndTime: function(versionString) {
        versionString = decodeURIComponent(versionString);
        return new Date(versionString);
    },

    handleTimemachineRequest: function(req, res, next) {
        // req.url is something like '/timemachine/2010-08-07%2015%3A33%3A22/foo/bar.js'
        // tmPath = '/timemachine/'

        if (req.method.toLowerCase() !== 'get') {
            res.status(400).end('timemachine request to ' + req.url + ' not supported.');
            return;
        }

        var tmPath = this.timemachineSettings.path,
            allowFileSystemFallback = this.timemachineSettings.allowFileSystemFallback,
            repo = this.repository,
            versionedPath = req.url.slice(tmPath.length),
            version = versionedPath.slice(0, versionedPath.indexOf('/'));

        if (!version) {
            res.status(400).end('cannot read version from path: ' + req.url);
            return;
        }

        var path = versionedPath.slice(version.length);
        if (path[0] === '/') path = path.slice(1);
        var ts = this.makeDateAndTime(version);
        console.log('timemachine into %s, %sing path %s', ts, req.method, path);

        async.waterfall([
            function retrieveVersion(next) {
              repo.getRecords({
                  paths: [path], older: ts,
                  attributes: ['version', 'date', 'author', 'content'],
                  limit: 1
              }, next);
            },
            function fileSystemFallback(records, next) {
              if (records.length || (!records.length && !allowFileSystemFallback)) {
                next(null, records); return;
              }
              console.log("Filesystem fallback for %s", Path.join(repo.fs.getRootDirectory(), path));
              fs.readFile(Path.join(repo.fs.getRootDirectory(), path), function(err, content) {
                next(null, err || !content ? [] : [{content: String(content)}]); });
            }
        ], function(err, records) {
            if (err) { res.writeHead(500); res.end(String(err)); return; }
            if (!records || !records.length) {
                res.writeHead(404);
                res.end(util.format('Nothing stored for %s at %s', path, ts));
                return;
            }
            res.setHeader('content-type', '*/*;charset=utf8')
            var content = records[records.length-1].content;
            res.end(content);
        });
    },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // rewritten code support
    isRewrittenCodeRequest: function(req) {
        if (!this.enableRewriting) return false;
        var filename = Path.basename(Url.parse(req.url).pathname);
        return !!filename.match(/^DBG_(.*)\.[Jj][Ss][Mm]?$/) || (req.url == '/core/lively/ast/BootstrapDebugger.js');
    },

    handleRewrittenCodeRequest: function(req, res, next) {
        if (req.method.toLowerCase() !== 'get') {
            res.status(400).end('rewritten code request to ' + req.url + ' not supported.');
            return;
        }
        if (req.url == '/core/lively/ast/BootstrapDebugger.js') {
            this.handleRewrittenCodeMapRequest(req, res, next);
            return;
        }
        if (Path.extname(req.url).toLowerCase() == '.jsm') {
            this.handleRewrittenSourceMapRequest(req, res, next);
            return;
        }
        var lvfs = this.repository.fs,
            repo = this.repository;
        var path = Url.parse(req.url).pathname;
        var filename = Path.basename(path).match(/^DBG_(.*\.[Jj][Ss])$/)[1];
        path = Path.join(Path.dirname(path), filename).substr(1);
        console.log('%sing rewritten code for %s', req.method, path);
        this.repository.getRecords({
            paths: [path],
            attributes: ['version', 'date', 'author', 'content', 'sourcemap'],
            rewritten: true,
            newest: true
        }, function(err, records) {
            function handleReadResult(err, content) {
                if (!err) {
                    content = content.toString();
                    var record = {
                        change: 'rewrite',
                        version: undefined,
                        author: 'unknown',
                        date: new Date().toISOString().replace(/[0-9]{3}Z/, '000Z'),
                        content: content,
                        path: path,
                        stat: fs.statSync(Path.join(lvfs.rootDirectory, path))
                    };
                    repo.pendingChangeQueue.push({
                        record: record,
                        canBeCommitted: function() { return true; },
                        startTime: Date.now(),
                        callback: function(versionRecord) {
                            if (versionRecord && versionRecord.rewritten)
                                res.status(200).end(versionRecord.rewritten);
                            else
                                res.status(200).end(content);
                        }
                    });
                    repo.commitPendingChanges();
                } else {
                    console.error('error reading file %s:', content, err);
                    res.status(404).end(util.format('Nothing rewritten stored for %s', path));
                }
            }

            if (err) { res.status(500).end(String(err)); return; }
            if (!records.length || (records[0].content == null)) {
                console.log('Nothing rewritten stored for %s', path);
                // try to read the file from the filesystem, rewrite it, put it in the db and ship it
                fs.readFile(Path.join(lvfs.rootDirectory, path), handleReadResult);
                return;
            }
            res.setHeader('content-type', 'application/javascript;charset=utf8')
            var content = records[0].content;
            if (records[0].sourcemap != null)
                content += '\n\n//# sourceMappingURL=DBG_' + filename + 'm';
            res.end(content);
        });
    },

    handleRewrittenCodeMapRequest: function(req, res, next) {
        var files = this.bootstrapRewriteFiles;
        this.repository.getRecords({
            paths: files,
            attributes: ['path', 'ast', 'registry_id', 'registry_additions'],
            rewritten: true,
            newest: true
        }, function(err, records) {
            var code = [
                lively.ast.Rewriting.createClosureBaseDef,
                lively.ast.Rewriting.UnwindExceptionBaseDef,
                "window.LivelyDebuggingASTRegistry={};"
            ];
            var subRegistries = [];
            records.each(function(record) {
                if (subRegistries.indexOf(record.path) == -1) {
                    code.push('LivelyDebuggingASTRegistry["' + record.path + '"]=[];');
                    subRegistries.push(record.path);
                }
                code.push('LivelyDebuggingASTRegistry["' + record.path + '"][' + record.registry_id + ']=' + record.ast + ';');
                var moreRegistry = JSON.parse(record.registry_additions);
                moreRegistry.each(function(entry, idx) {
                    code.push('LivelyDebuggingASTRegistry["' + record.path + '"][' + (record.registry_id + idx + 1) + ']=' + JSON.stringify(entry) + ';');
                });
            });
            code.push(
                '\n// deoptimize AST registry\n' +
                'Object.getOwnPropertyNames(LivelyDebuggingASTRegistry).forEach(function(namespace) {\n' +
                '    function findNodeByAstIndex(ast, astIndexToFind) {\n' +
                '        if (ast.astIndex === astIndexToFind) return ast;\n' +
                '        var i, j, node, nodes, found = null,\n' +
                '            props = Object.getOwnPropertyNames(ast);\n' +
                '        for (i = 0; i < props.length; i++) {\n' +
                '            node = ast[props[i]];\n' +
                '            if (node instanceof Array) {\n' +
                '                nodes = node;\n' +
                '                for (j = 0; j < nodes.length; j++) {\n' +
                '                    node = nodes[j];\n' +
                '                    if (node.key && node.value) {\n' +
                '                        if (node.key.astIndex >= astIndexToFind)\n' +
                '                            found = findNodeByAstIndex(node.key, astIndexToFind);\n' +
                '                        else if (node.value.astIndex >= astIndexToFind)\n' +
                '                            found = findNodeByAstIndex(node.value, astIndexToFind);\n' +
                '                        if (found !== null) break;\n' +
                '                        continue;\n' +
                '                    } else if (!node || (node.type == null) || (node.astIndex < astIndexToFind)) continue;\n' +
                '                    found = findNodeByAstIndex(node, astIndexToFind);\n' +
                '                    if (found !== null) break;\n' +
                '                }\n' +
                '                if (found !== null) break;\n' +
                '                continue;\n' +
                '            } else if (!node || (node.type == null) || (node.astIndex < astIndexToFind)) continue;\n' +
                '            found = findNodeByAstIndex(node, astIndexToFind);\n' +
                '            if (found !== null) break;\n' +
                '        }\n' +
                '        return found;\n' +
                '    }\n' +
                '    LivelyDebuggingASTRegistry[namespace].forEach(function(node, idx) {\n' +
                '        if (node && node.hasOwnProperty("registryRef")) {\n' +
                '            LivelyDebuggingASTRegistry[namespace][idx] = findNodeByAstIndex(LivelyDebuggingASTRegistry[namespace][node.registryRef], node.indexRef);\n' +
                '            LivelyDebuggingASTRegistry[namespace][idx]._parentEntry = node.registryRef;\n' +
                '        }\n' +
                '    });\n' +
                '});\n'
            );
            res.setHeader('content-type', 'application/javascript;charset=utf8')
            res.end(code.join('\n'));
        });
    },

    handleRewrittenSourceMapRequest: function(req, res, next) {
        var path = Url.parse(req.url).pathname;
        var filename = Path.basename(path).match(/^DBG_(.*\.[Jj][Ss])[Mm]$/)[1];
        path = Path.join(Path.dirname(path), filename).substr(1);
        console.log('%sing source map for %s', req.method, path);
        this.repository.getRecords({
            paths: [path],
            attributes: ['sourcemap'],
            rewritten: true,
            newest: true
        }, function(err, records) {
            if (err) { res.status(500).end(String(err)); return; }
            if (!records.length || (records[0].sourcemap == null)) {
                res.status(400).end();
                return;
            }
            res.setHeader('content-type', 'application/json;charset=utf8')
            res.end(records[0].sourcemap);
        });
    }

}));

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// exports
module.exports = LivelyFsHandler;