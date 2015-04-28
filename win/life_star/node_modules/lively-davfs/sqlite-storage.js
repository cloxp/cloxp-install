"use strict"

var util = require("util");
var lvFsUtil = require("./util");
var path = require("path");
var EventEmitter = require("events").EventEmitter;
var d = require('./domain');
var async = require('async');
var sqlite3 = require('sqlite3').verbose();

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

function log(/*args*/) { console.log.apply(console, arguments); }

function dateString(d) {
    if (d.constructor === Date) return d.toISOString();
    if (typeof d === "number") return dateString(new Date(d));
    if (typeof d === "string" && /^[0-9]+$/.test(d)) return dateString(Number(d));
    return d;
}

function ensureDate(row) {
    if (row && typeof row.date === 'string') row.date = new Date(row.date);
}

function sqlPrep(db, stmt) { return db.prepare(stmt, function(err) { console.log(err) }); }

function run(db, stmt, args, thenDo) {
    if (typeof args === 'function') {
        thenDo = args;
        args = undefined;
    }
    db.run(stmt, args, function(err) {
        if (err) log('err: ', err);
        else log('%s -- lastID: %s, changes: %s', stmt, this.lastID, this.changes);
        thenDo(err, {lastID: this.lastID, changes: this.changes});
    });
}

function query(db, stmt, args, thenDo) {
    if (typeof args === 'function') thenDo = args;
    var rows = [];
    try {
        db.all(stmt, args, function(err, rows) {
            err && log('Query error %s, %s: %s', stmt, args, err);
            thenDo && thenDo(err, rows);
        });
    } catch(e) {
        log('Query error %s, %s: %s', stmt, args, e);
        thenDo && thenDo(e, []);
    }
    // in case we want to stream responses at some point:
    // db.each(stmt, args,
    //     function(err, row) {
    //         if (err) log('err: ', err); else rows.push(row);
    //     }, function(err, noRows) {
    //         if (err) log('err: ', err); else log('%s: #%s', stmt, noRows);
    //         thenDo && thenDo(err, rows);
    //     });
}

function initFSTables(db, reset, thenDo) {
    var tasks = [];
    if (reset) {
        tasks = tasks.concat([
            lvFsUtil.curry(run, db, 'DROP TABLE IF EXISTS versioned_objects'),
            lvFsUtil.curry(run, db, "DROP INDEX IF EXISTS versioned_objects_date_index;"),
            lvFsUtil.curry(run, db, "DROP INDEX IF EXISTS versioned_objects_index;"),
            lvFsUtil.curry(run, db, 'DROP TABLE IF EXISTS rewritten_objects'),
            lvFsUtil.curry(run, db, "DROP INDEX IF EXISTS rewritten_objects_registry_id_index;"),
            lvFsUtil.curry(run, db, "DROP INDEX IF EXISTS rewritten_objects_index;")]);
    }
    tasks = tasks.concat([
        lvFsUtil.curry(run, db,
            "CREATE TABLE IF NOT EXISTS versioned_objects ("
          + "  path TEXT,"
          + "  version INTEGER NOT NULL DEFAULT 0,"
          + "  change TEXT,"
          + "  author TEXT,"
          + "  date DATETIME DEFAULT CURRENT_TIMESTAMP,"
          + "  content TEXT,"
          + "  PRIMARY KEY(path,version));"),
        lvFsUtil.curry(run, db, "CREATE INDEX IF NOT EXISTS versioned_objects_index ON versioned_objects(path,version);"),
        lvFsUtil.curry(run, db, "CREATE INDEX IF NOT EXISTS versioned_objects_date_index ON versioned_objects(date,path);"),
        lvFsUtil.curry(run, db,
            "CREATE TABLE IF NOT EXISTS rewritten_objects ("
          + "  path TEXT,"
          + "  version INTEGER NOT NULL,"
          + "  rewrite TEXT,"
          + "  ast TEXT,"
          + "  sourcemap TEXT,"
          + "  registry_id INTEGER NOT NULL,"
          + "  registry_additions TEXT,"
          + "  additions_count INTEGER NOT NULL,"
          + "  PRIMARY KEY(path,version));"),
        lvFsUtil.curry(run, db, "CREATE INDEX IF NOT EXISTS rewritten_objects_index ON rewritten_objects(path,version);"),
        lvFsUtil.curry(run, db, "CREATE INDEX IF NOT EXISTS rewritten_objects_registry_id_index ON rewritten_objects(registry_id);")]);
    async.series(tasks, function(err) {
        log('DONE: CREATE TABLES', err);
        thenDo && thenDo(err);
    });
}

function storeVersionedObjects(db, dataAccessors, options, thenDo) {
    // this batch-processes inserts
    // dataAccessors is an array of functions that expect one parameter, a
    // callback, that in turn has an error callback and an object
    // {uri, version, json} this should be stored in the db
    // queued so that we do not start open file handles to all worlds at once
    function afterInsert() {}
    function worker(accessor, next) {
        accessor(function(err, data) {
            if (err) {
                console.log('Could not access %s: ', data, err);
                taskCount--; next(); return;
            }
            if (data && data.change == 'rewrite') return afterVersioning(); // skip creation of a new version
            console.log("storing %s...", data && data.path);
            versionStmt.run(
                data.path, data.change, data.author, dateString(data.date), data.content, data.path,
                /* callback */ afterVersioning
            );
            // db can run stuff in parallel, no need to wait for versionStmt to finish
            // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
            function afterVersioning(err) {
                if (err || !data.rewritten) {
                    afterInsert.bind(this)(err);
                    return;
                }
                console.log('storing rewrite for %s...', data && data.path);
                rewriteStmt.run(
                    data.path, data.rewritten, data.ast, data.sourceMap, data.registryId, data.registryAdditions,
                    data.additionsCount || 0, data.path,
                    /* callback */ afterInsert
                );
            }
            function afterInsert(err) {
                if (err) {
                    console.error('Error inserting %s: %s', data && data.path, err);
                } else {
                    importCount++;
                    console.log("... done storing %s", data.path);
                }
                taskCount--;
                next();
                if (taskCount > 0) return;
                versionStmt.finalize();
                console.log("stored new versions of %s objects", importCount);
                thenDo && thenDo(null, data);
            }
        });
    }
    var taskCount = dataAccessors.length,
        importCount = 0,
        parallelReads = 10,
        sqlVersionStmt = 'INSERT INTO versioned_objects '
                       + 'SELECT ?, ifnull(x,0), ?, ?, ?, ? '
                       + 'FROM (SELECT max(CAST(objs2.version as integer)) + 1 AS x '
                       + '      FROM versioned_objects objs2 '
                       + '      WHERE objs2.path = ?);',
        versionStmt = db.prepare(sqlVersionStmt, function(err) {
            // this callback is needed, when it is not defined the server crashes
            // but when it is there the versionStmt.run callback also seems the catch the error...
            err && console.error('error in sql %s: %s', sqlVersionStmt, err); }),
        sqlRewriteStmt = 'INSERT INTO rewritten_objects '
                       + 'SELECT ?, x, ?, ?, ?, ?, ?, ? '
                       + 'FROM (SELECT max(CAST(objs.version as integer)) AS x '
                       + '      FROM versioned_objects objs '
                       + '      WHERE objs.path = ?);',
        rewriteStmt = db.prepare(sqlRewriteStmt, function(err) {
            // this callback is needed, when it is not defined the server crashes
            // but when it is there the sqlRewriteStmt.run callback also seems the catch the error...
            err && console.error('error in sql %s: %s', sqlRewriteStmt, err); }),
        q = async.queue(worker, parallelReads);
    console.log('inserting %s records into versioned_objects table', taskCount);
    q.push(dataAccessors);
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

function SQLiteStore(options) {
    this.db = null;
    this.dbFile = options.dbFile || ":memory:";
    EventEmitter.call(this);
    // Object.freeze(this);
}

util._extend(SQLiteStore.prototype, EventEmitter.prototype);

util._extend(SQLiteStore.prototype, d.bindMethods({

    reset: function(emptyTables, thenDo) {
        this.db = new sqlite3.Database(this.dbFile);
        initFSTables(this.db, emptyTables, thenDo);
    },

    storeAll: function(versionDataSets, options, thenDo) {
        var accessors = versionDataSets.map(function(dataset) {
            return function(callback) { callback(null, dataset); }; });
        storeVersionedObjects(this.db, accessors, options, thenDo);
    },

    getRecordsFor: function(path, thenDo) {
        this.getRecords({paths: [path]}, thenDo);
    },

    getRecords: function(spec, thenDo) {
        // generic query maker for version records. Example: get date and
        // content of most recent version of most recent version of "foo.txt":
        // this.getVersions({paths: ["foo.txt"], attributes: ['date','content'], newest: true});
        // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
        // spec = {
        //   groupByPaths: BOOL, -- return an object with rows grouped (keys of result)
        //   attributes: [STRING], -- which attributes to return from stored records
        //   newest: BOOL, -- only return most recent version of a record
        //   paths: [STRING], -- filter records by path names
        //   pathPatterns: [STRING], -- pattern to match paths
        //   version: [STRING|NUMBER], -- the version number
        //   date: [DATE|STRING], -- last mod date
        //   newer: [DATE|STRING], -- last mod newer
        //   older: [DATE|STRING], -- last mod older
        //   limit: [NUMBER],
        //   rewritten: BOOL, -- return rewritten version as content
        //   astIndex: [NUMBER], -- only if rewritten = true, AST index to lookup
        // }
        spec = spec || {};
        // SELECT caluse
        var defaultAttrs = ["path","version","change","author","date","content"];
        var attrs = spec.attributes || defaultAttrs;
        attrs = attrs.map(function(attr) {
            if (spec.rewritten && attr == 'content')
                return 'reObjs.rewrite AS content';
            else if (spec.rewritten && (defaultAttrs.indexOf(attr) == -1))
                return 'reObjs.' + attr;
            else
                return 'objs.' + attr;
        });
        if (spec.groupByPaths && attrs.indexOf('path') === -1) attrs.push('path');
        if (spec.exists && attrs.indexOf('change') === -1) attrs.push('change');
        var select = util.format("SELECT %s FROM versioned_objects objs", attrs.join(','));
        // JOIN clause
        var join = !spec.rewritten ? '' : 'LEFT JOIN rewritten_objects reObjs USING (path, version)';
        // WHERE clause
        var where = 'WHERE' + (spec.rewritten ? ' reObjs.path IS NOT NULL AND' : '');
        where += ' ('
               + (spec.paths ?
                  spec.paths.map(function(path) {
                        return "objs.path = '" + path.replace(/\'/g, "''") + "'";
                   }).join(' OR ') : "objs.path IS NOT NULL")
               + ')';
        where += ' AND objs.change IS NOT "rewrite"';
        if (spec.pathPatterns) {
            where += " AND ( " + spec.pathPatterns.map(function(pattern) {
                return "objs.path LIKE '" + pattern.replace(/\'/g, "''") + "'";
           }).join(' OR ') + ' )';
        }
        if (spec.exists) {
            where += " AND change != 'deletion'";
        }
        if (spec.date) {
            where += " AND objs.date = '" + dateString(spec.date) + "'";
        }
        if (spec.newer) {
            where += " AND objs.date > '" + dateString(spec.newer) + "'";
        }
        if (spec.older) {
            where += " AND objs.date <= '" + dateString(spec.older) + "'";
        }
        if (spec.newest) {
            where += " AND objs.version = (\n"
                  + "SELECT max(version) AS newestVersion\n"
                  + "FROM versioned_objects objs2 WHERE objs2.path = objs.path)";
        } else if (spec.version !== undefined) {
            where += " AND objs.version = " + spec.version;
        }
        if (spec.astIndex) {
            where += " AND " + spec.astIndex + " BETWEEN reObjs.registry_id AND (reObjs.registry_id + reObjs.additions_count)";
        }
        // ORDER BY
        var orderBy;
        if (spec.orderBy) {
            orderBy = "ORDER BY " + spec.orderBy
        } else {
             orderBy = "ORDER BY version DESC";
        }
        // limit
        var limit = typeof spec.limit === 'number' ? 'LIMIT ' + spec.limit : '';
        // altogether
        var sql = [select, join, where, orderBy, limit].join(' ');
        // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
        var whenDone = spec.groupByPaths ?
            function(err, rows) {
                if (err) { thenDo(err, {}); return; }
                thenDo(null, rows.reduce(function(resultByPaths, row) {
                    var pathRows = resultByPaths[row.path] || (resultByPaths[row.path] = [])
                    pathRows.push(row);
                    return resultByPaths;
                }, {}));
            } : thenDo;
        query(this.db, sql, [], whenDone);
    },

    getLastRegistryId: function(namespace, whenDone) {
        query(this.db, "SELECT registry_id + additions_count AS lastId "
                     + "FROM rewritten_objects "
                     + "WHERE path = '" + namespace.replace(/\'/g, "''") + "' "
                     + "ORDER BY lastId DESC LIMIT 1;", [], whenDone);
    }

}));

module.exports = SQLiteStore;
