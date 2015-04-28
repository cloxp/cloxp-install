var util = require("util");

// genericMock when called with a spyFactory and a nodeunit test object
// can simulate something like the exec function
function genericSpy(bodyFunc) {
    var invovationsToRun = [],
        ignoreUnexpected = false,
        callCount = 0;

    function createInvocation(spec) {
        function invocation() {
            var actualArgs = [];
            for (var i = 0; i < arguments.length; i++) { actualArgs.push(arguments[i]); }
            callCount++;
            return bodyFunc.apply(invocation, [spec].concat(actualArgs));
        }
        invocation.toString = function() { return bodyFunc.name + '<' + util.inspect(spec) + '>' };
        return invocation;
    }

    function run() {
        var spy = invovationsToRun.shift();
        if (!spy) {
            if (ignoreUnexpected) return undefined;
            throw new Error('unepectedly trying to call: ' + bodyFunc.name + ' with ' + util.inspect(arguments));
        }
        return spy.apply(null, arguments);
    }

    run.ignoreUnexpected = function() { ignoreUnexpected = true }

    run.expect = function(/*specs*/) {
        for (var i = 0; i < arguments.length; i++) {
            invovationsToRun.push(createInvocation(arguments[i]));
        }
        return run;
    }

    run.assertAllCalled = function() {
        if (invovationsToRun.length === 0) return;
        throw new Error('spies not called: ' + invovationsToRun);
    }

    run.toString = function() {
        return 'Mock< invovationsToRun:' + invovationsToRun.join('\n') + '>';
    }

    return run;
}

//
// exec
//
exports.execForTest = function(test) {
    return genericSpy(function execSpy(spec, cmd, options, callback) {
        test.equal(cmd, spec.cmd);
        test.equal(options.cwd, spec.cwd);
        if (!callback) {
            throw new Error('No callback for ' + this);
        }
        callback(spec.code || null, spec.out || "");
    });
}

//
// fs
//
exports.fsForTest = function(test) {
    return {
        writeFile: genericSpy(function writeSpy(spec, fn, data, callback) {
            test.equal(fn, spec.file);
            test.equal(data, spec.data);
            callback(spec.code || null);
        }),
        readFile: genericSpy(function readSpy(spec, fn, callback) {
            test.equal(fn, spec.file);
            callback(spec.code || null, spec.data || '');
        })
    }
}

function assertStringMatches(test, actual, expectedStringOrRegExp, msg) {
    if (typeof expectedStringOrRegExp === 'string') {
        test.equal(actual, expectedStringOrRegExp, msg);
        return;
    }
    test.ok(expectedStringOrRegExp.test(actual),
                msg + ': ' + actual + 'does not match ' + expectedStringOrRegExp);
}

exports.shelljs = function(test) {
    var spies = {
        echo: genericSpy(function echoSpy(spec, actualString) {
            test.equal(actualString, spec, "echo not OK");
        }),
        mkdir: genericSpy(function mkdirSpy(spec, flagsOrPath, path) {
            if (!path) {
                path = flagsOrPath;
            } else {
                test.equal(flagsOrPath, spec.flags, "flags not OK " + this);
            }
            test.equal(path, spec.path, "path not OK " + this);
        }),
        test: genericSpy(function testSpy(spec, flags, arg) {
            test.equal(flags, spec.flags, "test flags not OK");
            test.equal(arg, spec.arg, "test arg not OK");
            return spec.returns;
        }),
        exec: genericSpy(function execSpy(spec, cmd, options, callback) {
            assertStringMatches(test, cmd, spec.cmd, 'exec cmd');
            if (spec.options) {
                test.deepEqual(options, spec.options,  'options of ' + this);
            }
            if (callback) {
                callback(null);
            }
        }),
        cd: genericSpy(function cdSpy(spec, dir) {
            test.equal(dir, spec, this + ' dir');
        })
    };
    var spyNames = Object.keys(spies);
    spies.beGlobal = function() {
        spyNames.forEach(function(name) {
            global[name] = spies[name];
        });
        return spies;
    }
    spies.assertAllCalled = function() {
        spyNames.forEach(function(name) { spies[name].assertAllCalled(); })
    }
    return spies;
}