var querystring = require('querystring');

module.exports = function(app, logger) {

  var results = {};

  app.post('/test-result/:id', function(req, res) {
    var data = req.body;
    try {
      var testRunId = data.testRunId,
          testResults = JSON.parse(data.testResults);
      results[testRunId] = {
        testRunId: testRunId,
        state: 'done',
        result: JSON.stringify(testResults) // FIXME only for compatibility with miniserver
      };
      logger.info('Test ' + testRunId + ': ' + testResults.runs + ' runs, ' +
                  testResults.fails + ' failed');
      res.send('ok');
    } catch (e) {
      results[req.params.id] = {
        "testRunId": req.params.id,
        "state": "failed"};
      logger.error(e + ' (' + data +')');
      res.send('failed');
    }
    // });
  });

  app.get('/test-result/:id', function(req, res) {
    if (results[req.params.id]) {
      res.send(JSON.stringify(results[req.params.id]));
    } else {
      res.send(JSON.stringify({testRunId: req.params.id}));
    }
  });

  app.get('/test-result', function(req, res) {
    res.send(JSON.stringify(results));
  });
}
