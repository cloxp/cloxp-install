var exec  = require("child_process").exec;

function npmInstall(pkgName, intoDir, thenDo) {
    exec("npm install " + pkgName, {cwd: intoDir}, thenDo);
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

module.exports.npmInstall = npmInstall;