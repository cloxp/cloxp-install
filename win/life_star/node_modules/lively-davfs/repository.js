"use strict"

var util = require("util");
var fs = require("fs");
var path = require("path");
var EventEmitter = require("events").EventEmitter;
var livelyDAVPlugin = require('./jsDAV-plugin');
var VersionedFileSystem = require('./VersionedFileSystem');
var d = require('./domain');
var log = require('./util').log;

var counter = 0;
function newID() { return ++counter; }

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// Repo
function Repository(options) {
    try {
        EventEmitter.call(this);
        this.initialize(options);
    } catch(e) { this.emit('error', e); }
}

util._extend(Repository.prototype, EventEmitter.prototype);

util._extend(Repository.prototype, d.bindMethods({

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // intialize-release
    initialize: function(options) {
        if (global.lively) lively.repository = this;
        this.fs = new VersionedFileSystem(options);
        // we keep a queue for changes b/c they should be committed to the
        // versioned file system in their incoming order. Before they can be
        // committed async work has to to done, though, which might intermix the
        // change order
        this.pendingChangeQueue = [];
        this.fs.once('initialized', function() { this.emit('initialized'); }.bind(this));
        this._commitPendingChangesWatcherTimer = setInterval(this.commitPendingChangesWatcher.bind(this), 1000);
        Object.freeze(this);
    },

    start: function(resetDatabase, thenDo) {
        // resetDatabase = drop what was stored previously
        this.fs.initializeFromDisk(resetDatabase, thenDo);
    },

    close: function(thenDo) {
        clearInterval(this._commitPendingChangesWatcherTimer);
        this.emit('closed');
        thenDo && thenDo(null);
    },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // DAV
    getDAVPlugin: function() {
        return livelyDAVPlugin.onNew(this.attachToDAVPlugin.bind(this));
    },
    attachToDAVPlugin: function(plugin) {
        plugin.on('fileChanged', this.onFileChange.bind(this));
        plugin.on('afterFileChanged', this.onAfterWrite.bind(this));
        plugin.on('fileCreated', this.onFileCreation.bind(this));
        plugin.on('afterFileCreated', this.onAfterWrite.bind(this));
        plugin.on('fileDeleted', this.onFileDeletion.bind(this));
    },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // change recording
    isSynchronized: function() { return this.pendingChangeQueue.length === 0; },

    commitPendingChangesWatcher: function() {
        if (!this.pendingChangeQueue.length) return;
        var timeToWorry = 60*1000;
        this.pendingChangeQueue.forEach(function(change) {
            if (Date.now() - change.startTime < timeToWorry) return;
            if (!change.statRead) console.warn('Change for %s has no file stat', change.record.path);
            if (!change.requestDataRead) console.warn('Change for %s has no content', change.record.path);
        });
        var change = this.pendingChangeQueue[0];
        if (Date.now() - change.startTime > timeToWorry) {
            console.warn('Took too long to process change for %s, discarding it', change.record.path);
            this.discardPendingChange(change);
        }
    },

    commitPendingChanges: function() {
        var repo = this,
            q = this.pendingChangeQueue,
            toCommit = [];
        for (var i = 0; i < q.length; i++) {
            if (!q[i].canBeCommitted()) break;
            toCommit.push(q[i]);
        }
        log("Commiting %s (change ids %s) changes to DB", toCommit.length, toCommit.map(function(change) { return change.id; }).join(','));
        if (!toCommit.length) return;
        repo.pendingChangeQueue.splice(0, toCommit.length);
        repo.fs.addVersions(toCommit.map(function(elem) { return elem.record; }), {}, function(err, version) {
            if (err) {
                console.error('error in addVersions for records ', toCommit);
            }
            toCommit.forEach(function(change) {
                // FIXME: should check that change and version correlate
                if (change && change.callback instanceof Function)
                    change.callback(version);
            });
            if (!repo.pendingChangeQueue.length) {
                log("all pending changes processed");
                repo.emit('synchronized');
            }
        });
    },

    discardPendingChange: function(change) {
        var idx = this.pendingChangeQueue.indexOf(change);
        if (idx === -1) return;
        this.pendingChangeQueue.splice(idx, 1);
        if (idx === 0) this.commitPendingChanges();
    },

    onAfterWrite: function(evt) {
        log('after write: ', evt.uri);
        if (!evt.uri) return;
        var q = this.pendingChangeQueue, change;
        for (var i = 0; i < q.length; i++)
            if (q[i].record.path === evt.uri) { change = q[i]; break; }
        if (!change) return;
        this.readFileStat(change);
    },

    captureDAVEvt: function(changeType, readBody, readStat, evt) {
        if (!evt.uri) { console.error('Error recording file change, no path', evt); return; }
        var taskData = {
            id: newID(),
            record: {
                version: undefined,
                change: changeType,
                author: evt.username || 'unknown',
                date: evt.stat ? evt.stat.mtime :
                    (readStat ? '' :
                        // don't record the ms
                        new Date().toISOString().replace(/[0-9]{3}Z/, '000Z')),
                content: evt.req && evt.req.body ? evt.req.body : null,
                path: evt.uri,
                stat: evt.stat
            },
            canBeCommitted: function() {
                var waitForStat = readStat && !this.statRead,
                    waitForBody = readBody && !this.requestDataRead;
                waitForBody && log("%s (change %s) cannot yet be committed because no file stat was read", evt.uri, this.id);
                waitForStat && log("%s (change %s) cannot yet be committed because no request data was read", evt.uri, this.id);
                return !waitForBody && !waitForStat;
            },
            startTime: Date.now(),
            requestDataRead: false,
            statRead: !!evt.stat || false,
            request: evt.req,
            incomingContent: evt.content
        }
        log("capturing DAV event %s (%s, %s)", taskData.id , taskData.request.method, taskData.record.path)
        this.pendingChangeQueue.push(taskData);
        readBody && this.startReadingRequestContent(taskData);
        if (!readBody && !readStat) this.commitPendingChanges();
    },

    onFileChange: function(evt) {
        console.log('file change: ', evt.uri);
        this.captureDAVEvt('contentChange', true, true, evt);
    },

    onFileCreation: function(evt) {
        console.log('file created: ', evt.uri);
        this.captureDAVEvt('created', true, true, evt);
    },

    onFileDeletion: function(evt) {
        console.log('file deleted: ', evt.uri);
        this.captureDAVEvt('deletion', false, false, evt);
    },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // change processing
    startReadingRequestContent: function(change) {
        log("startReadingRequestContent for change %s", change.id);
        var repo = this;
        if (!change.incomingContent) change.requestDataRead = true;
        if (change.requestDataRead) { this.commitPendingChanges(); return; }
        var timeout = 60*1000, ts = Date.now();
        if (ts-change.startTime > timeout) {
            console.warn("reading content for %s timed out", change.record.path);
            change.requestDataRead = true;
            this.commitPendingChanges();
            return;
        }
        log("waiting for content of %s", change.record.path);
        if (!change.incomingContent.isDone) {
            setTimeout(this.startReadingRequestContent.bind(
                this, change), 500);
            return;
        }
        change.record.content = (change.incomingContent.buffer || '').toString();
        change.requestDataRead = true;
        log("content for %s read", change.record.path);
        repo.commitPendingChanges();
    },

    readFileStat: function(change) {
        var repo = this;
        log("start reading file stat for %s", change.record.path);
        fs.stat(path.join(repo.getRootDirectory(), change.record.path), function(err, stat) {
            if (err || !stat) {
                console.error('readFileStat: ', err);
                repo.discardPendingChange(change);
                return;
            }
            log("file stat for %s read", change.record.path, stat);
            change.record.stat = stat;
            change.record.date = stat.mtime.toISOString();
            change.statRead = true;
            repo.commitPendingChanges();
        });
    },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // accessors
    getRootDirectory: function() { return this.fs.getRootDirectory(); },
    getFiles: function(thenDo) { this.fs.getFiles(thenDo); },
    getFileRecord: function(options, thenDo) { return this.fs.getFileRecord(options, thenDo); },
    getRecords: function(options, thenDo) { return this.fs.getRecords(options, thenDo); },
    getVersionsFor: function(path, thenDo) { return this.getRecords({paths: [path]}, thenDo); },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // debugging
    logState: function() {
        console.log('log repo state:');
        console.log("versionedFileInfos: ");
        console.dir(this.fs, 1);
    }
}));


// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// exports
module.exports = Repository;
