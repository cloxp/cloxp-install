var exec = require('child_process').exec;

task('default', ['install-core'], function(params) {
  exec('mkdir -p tmp');
  exec('npm install');
});

desc('install Lively Kernel core files from GitHub');
task('install-core', [], function(params) {
  exec('git clone git@github.com:LivelyKernel/LivelyKernel.git');
});
