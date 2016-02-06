var sl = require('./sl-types'),
    reader = require('./reader'),
    utils = require('./utils'),
    ctx = require('./transpiler-context');

exports['*:float'] = function(lexer) {
  var token = lexer.next_token(/-?[0-9][0-9.]+/g);
  return sl.atom(parseFloat(token.text,10), {token: token});
};

// integer at start of source
exports['*:integer'] = function(lexer) {
  var token = lexer.next_token(/-?[0-9]+/g);
  return sl.atom(parseInt(token.text,10), {token: token});
};

// core supports simple quoted strings
// (plus supports templated strings with ${} escapes)
function handleSimpleString(lexer, quoteChar) {
  return reader.read_delimited_text(lexer, quoteChar, quoteChar);
};
exports['\''] = handleSimpleString;
exports['\"'] = handleSimpleString;
exports['`'] = handleSimpleString;

// a boolean category token is true or false
exports["true"] = function(lexer) {
  return sl.atom(true, {token: lexer.next_token(), category: 'boolean'});
};
exports["false"] = function(lexer) {
  return sl.atom(false, {token: lexer.next_token(), category: 'boolean'});
};

// a null category token can be "null" or "nil"
exports["null"] = function(lexer) {
  return sl.atom(null, {token: lexer.next_token(), category: 'null'});
};
exports["nil"] = exports["null"];

// ellipses are used in macros and match patterns to match the "rest"
// we are using them es6 style meaning they prefix the argument name
exports['...'] = function(lexer) {
  // we just put it back together as a single atom:
  var ellipsisToken = lexer.skip_token('...');
  var argnameToken = lexer.next_word_token();
  return sl.atom('...' + argnameToken.text, {token: ellipsisToken});
};

// parenthesized list expressions
exports['('] = function(lexer) {
  return reader.read_delimited_list(lexer);
};
// read_delimited_list consumes the ending ")"
// so we don't expect it to be read thru the syntax table
exports[')'] = reader.unexpected;

exports[':'] = reader.unexpected;

exports[','] = reader.unexpected;

// '=' is an alias for 'set'
// (we treat 'get' and 'set' as our core commands for
// manipulating variables - everything else is syntax sugar)
exports['='] = reader.symbolAlias('set');

exports['\\'] = reader.unexpected;

// compiler directives //////////////////////////////////////////////////

/**
* Use a dialect (i.e. "language extension") .
*
* This makes custom syntax and/or code generation available within
* the scope of the used dialect.
*
* The scope can be "file level" or "local".
*
* A "file level" dialect is used with "#use" at the top of a
* source file and it's scope is the entire contents of the file.
*
* A "local dialect" has a scope limited to a "#use-local" expression.
* Compare e.g. to the lisp "let" command which establishes variables
* with a scope constrained within "(let...)".
*
* Note that often local dialects are #use-local'ed implicitly, and in
* combination with a file level dialect, e.g. to use the pattern
* matching dialect you must #use "match" at the top of your file,
* and if/when a "match" keyword is used in that file, that
* implicitly creates a local dialect for the scope of that match
* statement (this is done so that the use of "case" and "default"
* are interpreted appropriately for a "match" as opposed to how
* they're interpreted e.g. in a "switch").
*
* note: the reason things like #use/#use-local and #transpile are
*   defined here in the syntax tables not the keyword ("transpile")
*   tables is simply that it's critical they take effect *early*
*   in the transpile process since they can effect reading (and
*   (we do two passes - a read pass *then* a codegen pass).
*/
function handle_use(lexer, text) {
  var useToken = lexer.skip_token(text);
  var dialectName = reader.read(lexer);
  var dialect = reader.use_dialect(sl.valueOfStr(dialectName), lexer,
                    // "#use-local" = local dialect, #use = file level dialect
                    {local: text === '#use-local'});

  // avoid blank lines in the output when no "on use code" is returned...
  if(dialect && dialect.onusecode && dialect.onusecode.length > 0 ||
    (dialect.onusecode &&
      dialect.onusecode.children && dialect.onusecode.children.length > 0)) {
      // they have some js code to insert at the point of #use
      // since we're a reader we'll return it as the (js..) form:
      var list = sl.list("js", dialect.onusecode);
      list.setOpening(useToken);
      return list;
  }

  // nope - nothing real to return
  // but there could be a "prelude" i.e. comments or whitespace
  // before the "#use" to passthru
  return reader.passthru_prelude(useToken);
};

exports['#use'] = handle_use;
// WHEN I TRIED TO USE SIMPLY "use" FOR LOCAL DIALECTS
// I COULDNT COMPILE THE ECSTATIC.SUGAR FILE JUST
// BECAUSE IT CONTAIN "app.use" IE IT TOOK THE "use"
// IN app.use AS THIS "use"!!!!
// I DIDNT SEE A QUICK FIX OTHER THAN TO RENAME IT SO I DID:
exports['#use-local'] = handle_use;

function handle_unuse(lexer, text) {
  var unuseToken = lexer.skip_token(text);
  var nextToken = lexer.peek_token();
  var dialectName;
  if(nextToken.text === '"' || nextToken.text === "'" ) {
    dialectName = sl.valueOfStr(reader.read(lexer));
  }
  var dialect = reader.unuse_dialect(dialectName, lexer,
                    // "#unuse-local" = local dialect, #unuse = file level dialect
                    {local: text === '#unuse-local'});
  return reader.passthru_prelude(unuseToken);
};

exports['#unuse'] = handle_unuse;
exports['#unuse-local'] = handle_unuse;

// set/override transpile options
// these are the same options you can otherwise set on the command line
// note: this is esp. handy in atom preview where there's no command line
exports['#transpile'] = function(lexer) {
  lexer.skip_text('#transpile');
  // they're expected to give a json options object
  // if a lispy core file that means (object...) otherwise real json {...}
  var optforms = reader.read(lexer);
  if(Array.isArray(optforms) && optforms.length > 0 &&
    sl.typeOf(optforms[0]) === 'symbol' && sl.valueOf(optforms[0]) === 'object') {
    // set these into the transpile options all the files
    // get via the context module
    var options = ctx.evalExpression(optforms);
    utils.mergeOnto(ctx.options.transpile, options);
  }
  else {
    lexer.error("#transpile expects a json object as argument");
  }

  // nothing to generate we've done all that matters
  return reader.ignorable_form;
};

// they can put "#keyword" before a named function in their source
// file to make it available at compile time.  i.e. The function is
// called during compile much as macros are, but it receives and
// returns forms (just a built-in keyword function), and can use
// arbitrary code in creating those returned forms, unlike a macros
// which uses the quote/unquote declarative style.
exports["#keyword"] = function(lexer) {
  lexer.mark_rewind_point();
  lexer.skip_text('#keyword');
  // note that here we read through the reader, ensuring
  // that we get any enhancements to functions that may
  // exist in the active dialects
  var functionForm = reader.read(lexer);
  if(sl.isList(functionForm) &&
    sl.typeOf(functionForm[0]) === 'symbol' &&
    sl.valueOf(functionForm[0]) === "function" &&
    sl.typeOf(functionForm[1]) === 'symbol')
  {
    // this flag is recognized in the transpiler
    // as meaning this function will be eval'ed
    // and registered so it will work at compile
    // time just as if it had been a built-in
    // keyword.
    functionForm.__macrofn = true;
  }
  else {
    lexer.error("#keyword must precede a named function");
  }
  return functionForm;
}

// #if is for conditional code generation
exports['#if'] = reader.parenfree(2, {parenthesized: 1, bracketed: 2});

// #include is an alternative to lispyscript 1's original (include...)
exports['#include'] = reader.parenfree(1);

// #require is for requiring a module at read time (as opposed
// to run time).  It uses the require path as opposed to
// lispy's separate include path.
exports['#require'] = reader.parenfree(1);

/**
* The default read function used when nothing in
* the read table matches the current token.
*/
exports.__default = reader.symbol;
