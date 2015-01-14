lively.Config.add('modulesOnWorldLoad', "lively.ide.codeeditor.BetterConfig");

// set uer based on cloxp assignment, also take care of the l2l connection
// which won't work over the proxy
var cookie = document.cookie.split(";").filter(function(ea) { return ea.indexOf("cloxp-assignment") > -1; })[0];
var cookieKV = cookie && cookie.split("=")
var port = cookieKV && Number(cookieKV[1]);
if (port) {
  lively.whenLoaded(function(w) { $world.setCurrentUser("cloxp-user-" + port); })
  lively.Config.addOption("nodeJSWebSocketURL", 'http://lively-web.org:' + port + '/nodejs');
}