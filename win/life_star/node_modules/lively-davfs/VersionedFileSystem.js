"use strict"

var util = require("util");
var EventEmitter = require("events").EventEmitter;
var async = require("async");
var path = require("path");
var fs = require("fs");
var findit = require('findit');
var SQLiteStore = require('./sqlite-storage');
var importFiles = require('./file-import-task');
var lvFsUtil = require('./util');
var d = require('./domain');
var sourcemap = require("source-map");

var lkLoader = require('lively-loader');

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// helper
function matches(reOrString, pathPart) {
    if (typeof reOrString === 'string' && reOrString === pathPart) return true;
    if (util.isRegExp(reOrString) && reOrString.test(pathPart)) return true;
    return false;
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// versioning data structures
/*
 * maps paths to list of versions
 * a version is {
 *   path: STRING,
 *   version: STRING||NUMBER,
 *   [stat: FILESTAT,]
 *   author: STRING,
 *   date: STRING,
 *   content: STRING,
 *   change: STRING
 * }
 * a change is what kind of operation the version created:
 * ['initial', 'creation', 'deletion', 'contentChange']
 */

function VersionedFileSystem(options) {
    try {
        EventEmitter.call(this);
        this.initialize(options);
    } catch(e) { this.emit('error', e); }
}

util._extend(VersionedFileSystem.prototype, EventEmitter.prototype);

util._extend(VersionedFileSystem.prototype, d.bindMethods({

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // initializing
    initialize: function(options) {
        if (!options.fs) this.emit('error', 'VersionedFileSystem needs location!');
        this.storage = new SQLiteStore(options);
        this.rootDirectory = options.fs;
        this.enableRewriting = !!options.enableRewriting; // default: false
        this.bootstrapRewriteFiles = options.bootstrapRewriteFiles || [];
        this.excludedDirectories = lvFsUtil.stringOrRegExp(options.excludedDirectories) || [];
        this.excludedFiles = lvFsUtil.stringOrRegExp(options.excludedFiles) || [];
        this.includedFiles = lvFsUtil.stringOrRegExp(options.includedFiles) || undefined;

        if (this.enableRewriting) {
            var self = this;
            lkLoader.start({ rootPath: this.rootDirectory + '/' }, function() {
                lively.require('lively.ast.Rewriting').toRun(function() {
                    self.astRegistry = lively.ast.Rewriting.setCurrentASTRegistry({});
                });
            });
        }
    },

    initializeFromDisk: function(resetDb, thenDo) {
        console.log('LivelyFS initialize at %s', this.getRootDirectory());
        var self = this, storage = this.storage;
        // Find files in root directory that should be imported and commit them
        // as a new version (change = "initial") to the storage
        async.series([
            storage.reset.bind(storage, resetDb/*drop tables?*/),
            this.readStateFromFiles.bind(this),
        ], function(err) {
            if (err) console.error('Error initializing versioned fs: %s', err);
            else self.emit('initialized');
            thenDo(err);
        });
    },

    readStateFromFiles: function(thenDo) {
        // syncs db state with what is stored on disk
        var task = importFiles(this);
        task.on('filesFound', function(files) {
            console.log('LivelyFS synching %s (%s MB) files from disk',
                files.length,
                lvFsUtil.humanReadableByteSize(lvFsUtil.sumFileSize(files)));
        });
        task.on('processBatch', function(batch) {
            console.log('Reading %s, files in batch of size %s',
                batch.length,
                lvFsUtil.humanReadableByteSize(lvFsUtil.sumFileSize(batch)));
        });
        task.on('end', thenDo);
    },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // versioning
    createVersionRecord: function(fields, thenDo) {
        // this is what goes into storage
        var record = {
            change: fields.change || 'initial',
            version: fields.version || 0,
            author: fields.author || 'unknown',
            date: fields.date || (fields.stat && fields.stat.mtime.toISOString()) || '',
            content: fields.content ? fields.content.toString() : null,
            rewritten: fields.rewritten ? fields.rewritten.toString() : null,
            path: this.normalizePath(fields.path),
            stat: fields.stat
        }
        thenDo(null, record);
    },

    addVersion: function(versionData, options, thenDo) {
        this.addVersions([versionData], options, thenDo);
    },

    addVersions: function(versionDatasets, options, thenDo) {
        options = options || {};
        var versionDatasets = versionDatasets.filter(function(record) {
            return !this.isExcludedFile(record.path); }, this);
        if (!versionDatasets.length) { thenDo(null); return; }
        var readyToStore = [];
        versionDatasets.forEach(function(record) {
            function declarationForGlobals(rewrittenAst) {
                // _0 has all global variables
                var globalProps = rewrittenAst.body[0].block.body[0].declarations[4].init.properties;
                return globalProps.map(function(prop) {
                    var varName = prop.key.value;
                    return Strings.format('Global["%s"] = _0["%s"];', varName, varName);
                }).join('\n');
            }
            function mapForASTs(origAst, rewrittenAst, origFile, optFilename) {
                var generator = new sourcemap.SourceMapGenerator({ file: optFilename });
                if (isNaN(origAst.astIndex))
                    throw new Error('Source Mapping is done by AST indices but astIndex is missing!');
                var idx, maxIdx = origAst.astIndex;
                for (idx = 0; idx <= maxIdx; idx++) {
                    var origNode = acorn.walk.findNodeByAstIndex(origAst, idx, false);
                    var rewrittenNode = acorn.walk.findNodeByAstIndex(rewrittenAst, idx, false);
                    if (origNode == null || rewrittenNode == null)
                        throw new Error('Could not find AST index ' + idx + ' in given ASTs!');
                    generator.addMapping({
                        original: { line: origNode.loc.start.line, column: origNode.loc.start.column },
                        generated: { line: rewrittenNode.loc.start.line, column: rewrittenNode.loc.start.column },
                        source: origFile
                    });
                }
                return generator.toString();
            }

            if (record.path)
                record.path = this.normalizePath(record.path);

            if (this.enableRewriting && (this.bootstrapRewriteFiles.indexOf(record.path) > -1)) {
                this.storage.getLastRegistryId(record.path, function(err, result) {
                    try {
                        if (err) throw err;
                        var astId = (result.length == 1 ?  result[0].lastId : 0);
                        this.astRegistry[record.path] = Array(astId);
                        var ast = lively.ast.acorn.parse(record.content, { locations: true, directSourceFile: record.path }),
                            rewrittenAst = lively.ast.Rewriting.rewrite(ast, this.astRegistry, record.path),
                            rewrittenCode = escodegen.generate(rewrittenAst);
                        record.rewritten = '(function() {\n' + rewrittenCode + '\n' + declarationForGlobals(rewrittenAst) + '\n})();';
                        record.registryId = astId;
                        record.registryAdditions = JSON.stringify(this.astRegistry[record.path].slice(astId + 1).map(function(ast) {
                            // compact AST registry for BootstrapDebugger.js
                            return { registryRef: astId, indexRef: ast.astIndex };
                        }));
                        record.additionsCount = this.astRegistry[record.path].length - astId - 1;
                        record.ast = JSON.stringify(this.astRegistry[record.path][astId], function(key, value) {
                            if (this.type == 'Literal' && this.value instanceof RegExp && key == 'value')
                                return { regexp: this.raw };
                            else if (key == 'loc' && value.hasOwnProperty('start') && value.hasOwnProperty('end'))
                                return; // omit locations
                            else if (key == 'sourceFile' && ['Program', 'FunctionExpression', 'FunctionDeclaration'].indexOf(this.type) == -1)
                                return; // omit sourceFile for nodes other then Program, FunctionExpression and FunctionDeclaration
                            else
                                return value;
                        }).replace(/\{"regexp":("\/.*?\/[gimy]*")\}/g, 'eval($1)');
                        lively.ast.acorn.rematchAstWithSource(rewrittenAst.body[0], record.rewritten, true, 'body.0.expression.callee.body.body.0');
                        // TODO: make lively.ast.SourceMap.Generator.mapForASTs work?!
                        record.sourceMap = mapForASTs(ast, rewrittenAst, path.basename(record.path));
                        console.log('Done rewriting ' + record.path + '...');
                        readyToStore.push(record);
                        if (readyToStore.length == versionDatasets.length)
                            this.storage.storeAll(versionDatasets, options, thenDo);
                    } catch (e) {
                        console.error('Could not rewrite ' + record.path + '!');
                        console.error(e);
                    }
                }.bind(this));
            } else
                readyToStore.push(record);
        }, this);
        if (readyToStore.length == versionDatasets.length)
            this.storage.storeAll(versionDatasets, options, thenDo);
    },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // accessing
    getVersionsFor: function(fn, thenDo) { this.storage.getRecordsFor(this.normalizePath(fn), thenDo); },
    getRecords: function(options, thenDo) {
        if (options.paths) options.paths = options.paths.map(function(fn) {
            return this.normalizePath(fn); }, this);
        if (options.pathPatterns) options.pathPatterns = options.pathPatterns.map(function(fn) {
            return this.normalizePath(fn); }, this);
        this.storage.getRecords(options, thenDo); },
    getFiles: function(thenDo) { this.storage.getRecords({newest: true}, thenDo); },
    getFileRecord: function(options, thenDo) {
        options = util._extend({paths: [options.path], newest: true}, options);
        this.storage.getRecords(options, function(err, rows) {
            thenDo(err, rows && rows[0]); }); 
    },

    getRootDirectory: function() { return this.rootDirectory; },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // os compat
    normalizePath: (function() {
        var backslashRe = /\\/g;
        return function(fn) { return fn.replace(backslashRe, '/'); }
    })(),

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // filesystem access
    isExcludedDir: function(dirPath) {
        var sep = path.sep, dirParts = dirPath.split(sep);
        for (var i = 0; i < this.excludedDirectories.length; i++) {
            var testDir = matches.bind(null,this.excludedDirectories[i]);
            if (testDir(dirPath) || dirParts.some(testDir)) return true;
        }
        return false;
    },

    isExcludedFile: function(filePath) {
        var basename = path.basename(filePath);
        if (this.includedFiles)
            for (var i = 0; i < this.includedFiles.length; i++)
                if (!matches(this.includedFiles[i], basename)) return true;
        for (var i = 0; i < this.excludedFiles.length; i++)
            if (matches(this.excludedFiles[i], basename)) return true;
        return false;
    },

    walkFiles: function(thenDo) {
        var self = this,
            root = this.rootDirectory,
            find = findit(this.rootDirectory, {followSymlinks: true}),
            result = {files: [], directories: []},
            ended = false;
        find.on('directory', function (dir, stat, stop) {
            var relPath = path.relative(root, dir);
            result.directories.push({path: relPath, stat: stat});
            var base = path.basename(relPath);
            if (self.isExcludedDir(base)) stop();
        });
        find.on('file', function (file, stat) {
            var relPath = path.relative(root, file);
            if (self.isExcludedFile(relPath)) return;
            result.files.push({path: relPath,stat: stat});
        });
        find.on('link', function (link, stat) {});
        var done = false;
        function onEnd() {
            if (done) return;
            done = true; thenDo(null, result);
        }
        find.on('end', onEnd);
        find.on('stop', onEnd);
    }

}));

module.exports = VersionedFileSystem;
