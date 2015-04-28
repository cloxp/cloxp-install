"use strict"

var debug = false;
var util = require("util");

function batchify(list, constrainedFunc, context) {
    // takes elements and fits them into subarrays (=batches) so that for
    // each batch constrainedFunc returns true. Note that contrained func
    // should at least produce 1-length batches, otherwise an error is raised
    // see [$world.browseCode("lively.lang.tests.ExtensionTests.ArrayTest", "testBatchify", "lively.lang.tests.ExtensionTests")]
    // for an example
    function extractBatch(batch, sizes) {
        // Array -> Array -> Array[Array,Array]
        // case 1: no sizes to distribute, we are done
        if (!sizes.length) return [batch, []];
        var first = sizes[0], rest = sizes.slice(1);
        // if batch is empty we have to take at least one
        // if batch and first still fits, add first
        var candidate = batch.concat([first]);
        if (constrainedFunc.call(context, candidate)) return extractBatch(candidate, rest);
        // otherwise leave first out for now
        var batchAndSizes = extractBatch(batch, rest);
        return [batchAndSizes[0], [first].concat(batchAndSizes[1])];
    }
    function findBatches(batches, sizes) {
        if (!sizes.length) return batches;
        var extracted = extractBatch([], sizes);
        if (!extracted[0].length)
            throw new Error('Batchify constrained does not ensure consumption '
                          + 'of at least one item per batch!');
        return findBatches(batches.concat([extracted[0]]), extracted[1]);
    }
    return findBatches([], list);
}

function sum(arr) { return arr.reduce(function(sum,ea) { return sum+ea; },0); }

function sumFileSize(objsWithFilestats) {
    /**/
    return sum(pluck(pluck(objsWithFilestats, 'stat'), 'size'));
}

function pluck(arr, property) {
    var result = new Array(arr.length);
    for (var i = 0; i < arr.length; i++) {
        result[i] = arr[i][property]; }
    return result;
}

function humanReadableByteSize(n) {
    function round(n) { return Math.round(n * 100) / 100 }
    if (n < 1000) return String(round(n)) + 'B'
    n = n / 1024;
    if (n < 1000) return String(round(n)) + 'KB'
    n = n / 1024;
    return String(round(n)) + 'MB'
}

function stringOrRegExp(s) {
    // allows to encode REs in a string like "/\\.css$/i",
    if (util.isArray(s)) return s.map(stringOrRegExp);
    if (typeof s !== 'string') return s;
    if (s[0] !== '/') return s;
    var endMatch = s.match(/\/([a-z]?)$/);
    if (!endMatch) return s;
    var flags = endMatch[1] || undefined;
    var reString = s.slice(1,-endMatch[0].length);
    return new RegExp(reString, flags);
}

function curry(/*func, args*/) {
    // curry(function(a,b) {return a+b},23)(2)
    var func = arguments[0], args = new Array(arguments.length-1);
    for (var i = 1; i < arguments.length; i++) args[i-1] = arguments[i];
    return function() {
        var args2 = new Array(arguments.length);
        for (var i = 0; i < arguments.length; i++) args2[i] = arguments[i];
        return func.apply(null, args.concat(args2));
    }
}

function log(/*args*/) {
    if (debug) console.log.apply(console, arguments);
}

module.exports = {
    curry: curry,
    batchify: batchify,
    pluck: pluck,
    sum: sum,
    sumFileSize: sumFileSize,
    stringOrRegExp: stringOrRegExp,
    humanReadableByteSize: humanReadableByteSize,
    log: log
}
