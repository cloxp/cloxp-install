"use strict"

var util = require("util");
var EventEmitter = require("events").EventEmitter;
var async = require("async");
var path = require("path");
var fs = require("fs");
var lvFsUtil = require('./util');
var d = require('./domain');

/*
 * This tasks takes finds all the files of a versioned filesystem, splits them
 * up into batches, creates a new version record for each file and commits those
 * as a new version.
 *
 */

function processFile(lvfs, fi, thenDo) {
    var rootDir = lvfs.getRootDirectory();
    fs.readFile(path.join(rootDir, fi.path), handleReadResult);
    function handleReadResult(err, content) {
        if (!err) {
            lvfs.createVersionRecord({
                path: fi.path,
                stat: fi.stat,
                content: content
            }, thenDo);
        } else {
            console.error('error reading file %s:', fi.path, err);
            thenDo(err);
        }
    }
}

function processBatch(lvfs, batch, thenDo) {
    async.mapSeries(batch,
        function(fileinfo, next) { processFile(lvfs, fileinfo, next); },
        function(err, fileRecords) {
            lvfs.addVersions(fileRecords, {onlyImportNew: true}, thenDo); });
}

function createBatches(files, thenDo) {
    var batchMaxFileSize = Math.pow(2, 26)/*64MB*/;
    function batchConstrained(batch) {
        // how to backpack large file array to fit operations in mem
        return batch.length == 1
            || batch.length < batch.length
            || lvFsUtil.sumFileSize(batch) < batchMaxFileSize;
    }
    var batches = lvFsUtil.batchify(files, batchConstrained);
    thenDo(null, batches);
}

function filterFilesThatAreInStorage(lvfs, files, thenDo) {
    // files = [{path: STRING, stat: {mtime: DATE, ...}}]
    var queryLimit = 3, allNewFiles = [];
    var cargo = async.cargo(function(files, next) {
        var paths = files.map(function(f) { return f.path; });
        lvfs.getRecords({paths: paths, newest: true, attributes: ['path','date']}, function(err, versionRecords) {
            if (err) {
                console.error('error in filterFilesThatAreInStorage: ', err);
                thenDo(err, []); return;
            }
            var pathsInDB = versionRecords.map(function(rec) { return rec['path']; }),
                newFiles = files.filter(function(file) {
                    var filePath = lvfs.normalizePath(file.path),
                        idx = pathsInDB.indexOf(filePath),
                        dateInDB = idx > -1 && new Date(versionRecords[idx].date),
                        dateOfFile = file.stat.mtime;
                    if (idx === -1) {
                        // console.log('Importing file %s (not in DB).',file.path)
                    } else if (dateInDB < dateOfFile) {
                        console.log('Importing newer file %s.',file.path);
                    }
                    return idx === -1 ? true : dateInDB < dateOfFile;
                });
            allNewFiles = allNewFiles.concat(newFiles);
            next(null);
        })
    }, queryLimit);
    cargo.push(files);
    cargo.drain = function() {
        thenDo(null, allNewFiles); };
}

function runTask(lvfs, thenDo) {
    // 1) split found files into batches that have a limited file
    //    size (to not exceed the memory)
    // 2) for each batch: read file contents and submit to storage
    // 3) when storage done: rinse and repeat
    var totalFiles = 0, filesProcessed = 0,
        emitter = {};
    util._extend(emitter, EventEmitter.prototype);
    EventEmitter.call(emitter);
    async.waterfall([
        function(next) { lvfs.walkFiles(next); },
        function(findResult, next) {
            filterFilesThatAreInStorage(lvfs, findResult.files, next);
        },
        function(files, next) {
            var fileCount = files.length;
            emitter.emit('filesFound', files);
            createBatches(files, next);
        },
        function processBatches(batches, next) {
            // recurse until batches is empty or error occurs
            var batch = batches.shift();
            if (!batch) { next(null); return; }
            emitter.emit('processBatch', batch);
            processBatch(lvfs, batch, function(err) {
                emitter.emit('progress', {
                    loaded: (filesProcessed = filesProcessed + batch.length),
                    total: totalFiles
                });
                if (err) next(err);
                else processBatches(batches, next);
            });
        }
    ], function(err) {
        emitter.emit('end', err);
        thenDo && thenDo(err);
    });
    return emitter;
}

module.exports = d.bind(runTask);
