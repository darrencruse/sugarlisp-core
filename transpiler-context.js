/**
* The transpiler-context module holds some common flags
* used to communicate between the main "ls" transpiler
* logic and the various syntax/keyword table files that
* collaborate to achieve a compile.
*
* The main transpiler file requires this module and sticks
* the transpiler options specified on the command line
* into it.
*
* The keyword handler functions have this context bound as
* their "this".
*
* They can use the context e.g. to communicate back to the
* main transpiler loop to not add a a semicolon or a "return"
* statement after the statement they've generated by setting
* the "noSemiColon" or "noNewline" flag.
*
* Note that this is a normal module (where modules behave like
* "singletons"), so it's also possible to simply require this
* module to see the current context.
*/

module.exports = {
  filename: undefined,
  fileext: undefined,
  options: undefined,
  source: undefined,
  indentSize: 2,
  indent: 6,
  margin: function() { return " ".repeat(this.indent); },
  tabin: function(times) { times = times || 1; this.indent += (this.indentSize * times); },
  tabout: function(times) { times = times || 1; this.indent -= (this.indentSize * times); },
  noSemiColon: false,
  noNewline: false,
  noReturn: false,
  semi: function() {
                  var s = (!this.noSemiColon ? ";" : "");
                  this.noSemiColon = false;
                  return s;
                },
  beforeCode: [],
  afterCode: []
};
