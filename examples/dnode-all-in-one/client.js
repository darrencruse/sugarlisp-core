// Generated by SugarLisp v0.5
var dnode = require('dnode');


var d = dnode.connect(5004);
return d.on('remote', function(remote) {
  return remote.transform('beep', function(err, s) {
    (err ?
      console.log(['an error occurred ', err].join('')) :
      console.log(['beep goes ', s].join('')));
    return d.end();
  });
});