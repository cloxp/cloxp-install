var d = require('domain').create();

d.on('error', function(err) {
    console.error('LivelyFS encountered error: ', err.stack || err);
    process.exit();
});

d.bindMethods = function(obj) {
    var result = [];
    Object.keys(obj).forEach(function(name) {
        var val = obj[name];
        if (typeof val === 'function') val = d.bind(val);
        result[name] = val;
    });
    return result;
}

module.exports = d;
