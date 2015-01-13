lively.Config.add('modulesOnWorldLoad', "lively.ide.codeeditor.BetterConfig");

// set uer based on cloxp assignment, also take care of the l2l connection
// which won't work over the proxy
var cookie = document.cookie.split(";").detect(function(ea) { return ea.include("cloxp-assignment"); });
var port = cookie && Number(cookie.split("=").last());
if (port) {
  lively.whenLoaded(function(w) { $world.setCurrentUser("cloxp-user-" + port); })
  lively.Config.addOption("nodeJSWebSocketURL", 'http://lively-web.org:' + port + '/nodejs');
}
