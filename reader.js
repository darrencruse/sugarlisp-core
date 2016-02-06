/**
* The reader transforms a stream of tokens into a list of
* atoms and/or other lists (where we have atoms of various types:
* symbols, strings, numbers, booleans etc).
*/
var lex = require('./lexer'),
  sl = require('./sl-types'),
  utils = require('./utils'),
  ctx = require('./transpiler-context'),
  filetypes = require('./filetypes'),
  fs,
  path;

var include_dirs = [
  ".",
  "..",
  "../..",
  "../../..",
  "../../../..",
  "../../../../..",
  "../../../../../..",
  "node_modules",
  "../node_modules",
  "../../node_modules",
  __dirname + "/../node_modules",
  __dirname + "/../../node_modules",
  "includes",
  "../includes",
  "../../includes",
  __dirname + "/../includes",
  __dirname + "/../../includes"
];

var debug = require('debug')('sugarlisp:core:reader:debug'),
  trace = require('debug')('sugarlisp:core:reader:trace'),
  slinfo = require('debug')('sugarlisp:info');

// these node modules unavailable/unused in the browser
// note: reliably determining where we're running is complicated
//   because the Atom editor appears as both node *and* a browser!
try {
  fs = require('fs');
  path = require('path');
}
catch(e) {
  debug("failed requiring fs and path (assume we're running in a browser)");
}

/**
* Read the expressions in the provided source code string.
* @param codestr = the source code as a string e.g. from reading a source file.
* @param filenameOrLexer = the name of source file (or the Lexer for the file)
* @return the list (see sl-types) of the expressions in codestr.
*/
function read_from_source(codestr, filenameOrLexer, options) {

  var lexer;
  if(typeof filenameOrLexer === 'string') {
    lexer = initLexerFor(codestr, filenameOrLexer, options);
  }
  else {
    lexer = filenameOrLexer;
    lexer.set_source_text(codestr, options);
  }

  // read the forms
  var forms = read(lexer);

  // it's useful to sometimes look "up" the lexical nesting of forms...
  // to make this easy/reliable - walk the form tree setting "parent"
// I SHOULD TIME THIS?  IF IT'S EXPENSIVE - I'M NOT SURE I EVEN NEED IT ANYMORE?
  if(options.setParents !== 'no' && forms.setParents) {
    forms.setParents();
  }

  return forms;
}

/**
* Create and initialize a lexer for the given code from the given file.
* This is called implicitly when using "read_from_source" above.
* When using this for something like a repl, codestr might be undefined
* (since you'll be passing in code later a line at a time), and the
* filename might be fake, but it's extension allows default dialects
* to be included appropriate for the type of code you're planning to
* evaluate later on.
*
* @param codestr = the source code as a string e.g. from reading a source file.
* @param filenameOrLexer = the name of source file (or the Lexer for the file)
* @return a Lexer for the type of code indicated by the specified filename
*/
function initLexerFor(codestr, filenameOrLexer, options) {

  options = options || {};
  var lexer;
  var filename;
  if(filenameOrLexer instanceof lex.Lexer) {
     lexer = filenameOrLexer;
     filename = lexer.filename;
  }
  else {
    filename = filenameOrLexer;
  }

  // we've had trouble preserving comments -
  // for now, default to leaving them out:
  if (typeof options.includeComments === 'undefined') {
    options.includeComments = false;
  }

  if(!lexer) {
    // create a Lexer object per file that holds state
    // e.g. the current position when reading the file
    lexer = new lex.Lexer(codestr, filename, options);
  }
  else {
    // change the source text being lexed
    // (yet retaining already #used dialects the Lexer already has)
    lexer.set_source_text(codestr, options);
  }

  // All the modules can access the Lexer for the main source file
  // via the transpiler context...
  // note:  this is fairly simplistic right now - it's assuming
  //  just one source file of any importance (as opposed to
  //  transpiling multiple source files with multiple Lexers all
  //  at the same time).  So it's fine for now but might change...
// DELETE? if(!ctx.lexer) {
    ctx.lexer = lexer;
//  }

  var fileext = utils.getFileExt(filename, "slisp");

  // filetypes defines the dialect's this dialect builds upon:
  var baseDialectNames = filetypes[fileext];
  if(!baseDialectNames) {
    throw new Error(filename + " is not a recognized sugarlisp file type.");
  }

  // options.autouse=false can be used to disable the base dialects
  // (but this is not typical)
  if(typeof options.autouse === 'undefined' || options.autouse) {
    // then add the others
    for (var i=baseDialectNames.length; i--; ) {
      var dialectName = baseDialectNames[i];
      // we skip core here because we *always* include core (see below)
//DELETE      if(dialectName !== 'core') {
//DELETE prepend #use statements just as if they'd done it themselves
//DELETE codestr = '#use "' + dialectName +  '"\n' + codestr;
        // bootstrap the core dialect which everything must have
        use_dialect(dialectName, lexer);
//      }
    }
  }

  // bootstrap the core dialect which everything must have
//  use_dialect('core', lexer);

  return lexer;
}

/**
* Return the tokens seen using just the main (non-local) dialects
* for the file.
*
* note:  this is just meant for debugging and will not reflect tokens
*  gotten by local dialects added/removed during then normal read process.
*  Those *true* tokens can be gotten after a read when the lexer is passed
*  {to: "tokens"}.  This alternative is provided mainly because there are
*  times when the read may be blowing up in which case the alternative
*  approach will fail (in which case this option is better than nothing).
* (presumably for debugging but who knows...)
*/
function nonlocal_tokens(codestr, filename) {

  // get the base dialects for this file type:
  var fileext = utils.getFileExt(filename, "slisp");
  var baseDialectNames = filetypes[fileext];
  if(!baseDialectNames) {
    throw new Error(filename + " is not a recognized sugarlisp file type.");
  }

  // note we manually ensure the lexer has the appropriate bases dialects below
  // (this is normally taken care of by reader.read_from_source() but not here)
  var lexer = new lex.Lexer(codestr, filename, {wrapOuterForm: 'no'});

  // we always bootstrap the core dialect which everything must have
  use_dialect('core', lexer);

  // And then add the extension dialects the file depends on
  baseDialectNames.forEach(function(dialectName) {
    use_dialect(dialectName, lexer);
  })

  // Just read each token and return them all...
  var token;
  var tokens = [];
  while(token = lexer.next_token()) {
    // we can't handle local dialects but at least we
    // can handle file level #used ones:
    if(token.text === "#use") {
      tokens.push(token); // push the "#use"
      tokens.push(lexer.next_token()); // push the opening quote
      var dialectNameToken = lexer.next_token();
      tokens.push(dialectNameToken);
      use_dialect(dialectNameToken.text, lexer);
    }
    else {
      tokens.push(token);
    }
  }
  return tokens;
}


/**
* Use the specified dialect (e.g. "plus", "html", etc.) for the source
* file being read by the specified Lexer.
*
* A "use" can be at file level (i.e. the "#use" directive) or a a "local
* dialect" with a smaller scope (normally established via a readtab
* entry or a "(use...)" expression).  Local dialects should pass
* options.local=true, otherwise they're assumed to be "file level".
*
* Dialects are simply commonjs modules that export (at least one of):
*    lextab = table of token definitions using regular expressions
*    readtab = table for handling custom syntax
*    gentab = table of javascript code generation and macro functions
*
* Note our "readtab" plays a similar role but is structured a little differently
* than the Common Lisp "read table" (e.g. we are driven by whole tokens not just
* the first characters of them).
*
* A Lexer keeps an array of the dialect modules that have been "used"
* in that particular file (with the most recently used at the front).
*
* Returned is the loaded and prepped dialect object
*  (if the dialect requires code output at the point of "#use", the
*   code has been loaded and is available on the property ".onusecode")
*/
function use_dialect(dialectOrName, lexer, options) {

  options = options || {};
  var dialect;
  var dialectName;
  if(typeof dialectOrName === 'string') {
    dialectName = dialectOrName;
  }
  else {
    dialect = dialectOrName;
  }

  // we only allow one of each "file level" dialect...
  if(!options.local) {
    var alreadyLoadedDialect;
    if(dialectName) {
      // has this named dialect already been loaded?
      alreadyLoadedDialect = lexer.dialects.find(function(dialect) {
        return(dialect.name === dialectName);
      });
    }
    else {
      // has this dialect object already been loaded?
      alreadyLoadedDialect = (lexer.dialects.indexOf(dialect) !== -1);
    }

    // note they can optionally pass options.reload to *force* a reload
    if(alreadyLoadedDialect && !options.reload)
    {
      // just give back the previously loaded file-level dialect
      return alreadyLoadedDialect;
    }
  }

  // note there's some circular dependency issues if dialect-loader
  // is requried at the top of this reader.js file - but it doesn't happen here
  slinfo('using dialect:', dialectName ? dialectName :
                    (dialect && dialect.name ? dialect.name : "?"));
  if(!dialect) {
    dialect = options.preloaded || require('./dialect-loader').load(dialectName);
  }

  // Make sure any dialects this one extends are loaded first
  if(dialect.extends) {
    var extendsArr = (Array.isArray(dialect.extends) ?
                        dialect.extends : [dialect.extends]);
    extendsArr.forEach(function(baseDialectName) {
      use_dialect(baseDialectName, lexer, options);
    });
  }

  // make sure the dialect provides something to work with...
  if(!dialect.lextab && !dialect.readtab && !dialect.gentab ) {
    lexer.error("System error: malformed language extension \"" + dialectName + "\"");
  }

  // but otherwise the lex/read/generate tables are all optional:
  // (e.g. they might be using just one of the three)
  dialect.lextab = dialect.lextab || [];
  dialect.readtab = dialect.readtab || {};
  dialect.gentab = dialect.gentab || {};

  // cull a list of non-parenthesized infix/prefix/suffix "operators"...
  // later "read" transforms these based on precedence (i.e. TDOP "binding powers").
  // note: though here in core, this is mostly for the benefit of the
  //   the "sugared" dialects (e.g. plus and sugarscript).  Since core
  //   is a true lisp it doesn't define infix/prefix/suffix "operators".
  dialect.readtab.__operators = {};
  Object.keys(dialect.readtab).forEach(function(sym) {
    var readfn = dialect.readtab[sym];
    if(readfn.operator) {
      dialect.readtab.__operators[sym] = readfn;
    }
  });
  dialect.readtab.__operatorsymbols = Object.keys(dialect.readtab.__operators);

  // onuse is an optional file containing js to insert in the output
  // at the point of #use.
  // (this may support lispy code in the future but for now we require js)
  if(typeof options.onusecode === 'undefined' || options.onusecode) {
    if(dialect.onuse) {
      dialect.onusecode = read_include_file(dialect.onuse, lexer);
    }
  }

  // Make the new dialect visible within this file
  lexer.push_dialect(dialect);

  // invoke the (optional) dialect initialization functions:
  invokeInitDialectFunctions(dialect, lexer, options);

  // return the newly loaded and prepped dialect
  return dialect;
}

/**
* stop using a dialect
*
* Whereas "use_dialect" enters the scope of a dialect, "unuse_dialect"
* exits that scope.
*
* @params dialectName = the name of the dialect to stop using, or if
*  undefined the most recent dialect "used" in the one that's "unused"
* @params lexer = the lexer for the file being "unused" from.
*
* note:  if options.validate is true, the function will *only* "unuse"
*   the most recent dialect and it's name must match the name you've
*   given, otherwise an error is thrown.  This validates that you
*   haven't (accidentally) failed to "unuse" an inner dialect nested
*   inside another one, leaving the dialect stack in a different state
*   than you think.
*/
function unuse_dialect(dialectName, lexer, options) {
  options = options || {};
  if(dialectName && options.validate &&
    lexer.dialects[0].name !== dialectName)
  {
    lexer.error('Attempt to exit dialect "' + dialectName + '" while "' +
      lexer.dialects[0].name + '" was still active');
  }

  slinfo('removing dialect', dialectName ? ": " + dialectName : "");
  var removedDialect = lexer.pop_dialect(dialectName);
  if(!removedDialect) {
    lexer.error('The dialect ' + (dialectName ? '"' + dialectName + '"': '') +
        ' has never been used');
  }

}

/**
* Init dialect functions can optionally be used to initialize things
* at the time a dialect is "used".
*
* They can be placed on the dialect, it's lextab, readtab, or gentab,
* under a key named "__init" (note we use two underscores).
*
* They receive as arguments the lexer, the dialect, and the overall
* options (as passed to "read_from_source".
*/
function invokeInitDialectFunctions(dialect, lexer, options) {
  var initfnkey = "__init";
  if(dialect[initfnkey]) {
    dialect[initfnkey](lexer, dialect, options);
  }
  if(dialect.lextab[initfnkey]) {
    dialect.lextab[initfnkey](lexer, dialect, options);
  }
  if(dialect.readtab[initfnkey]) {
    dialect.readtab[initfnkey](lexer, dialect, options);
  }
  if(dialect.gentab[initfnkey]) {
    dialect.gentab[initfnkey](lexer, dialect, options);
  }
}

/**
* Read the form at the current position in the source.
* @param lexer = the lexer that is reading the source file.
* @param precedence = internal use only (don't pass)
* @return the list (see sl-types) for the expression that was read.
*/
function read(lexer, precedence) {

  precedence = precedence || 0;

  var form = read_via_closest_dialect(lexer);

  // are we a prefix unary operator?
  var leftForm = form;
  if(sl.isAtom(form)) {
    var opSpec = getOperatorSpecFor(form, lexer.dialects);
    if(opSpec && isEnabled(opSpec.prefix) && opSpec.prefix.transform &&
      // "nospace" prefix ops must butt up against their arg so
      // "--i" not "-- i" this way we can't confuse e.g. (- x y)
      //  with (-x y)
      (!opSpec.options || !opSpec.options.nospace || !lexer.onwhitespace(-1)))
    {
      leftForm = opSpec.prefix.transform(lexer, opSpec.prefix, form);
    }
  }

  // note flipped check below from < to > because our precedences
  // are currently as you see them here: http://www.scriptingmaster.com/javascript/operator-precedence.asp
  // not as you see them here:  http://journal.stuffwithstuff.com/2011/03/19/pratt-parsers-expression-parsing-made-easy/
  var token, opSpecObj;
  while(!lexer.eos() && (token = lexer.peek_token()) &&
    (opSpecObj = getOperatorSpecFor(token.text, lexer.dialects)) &&
    opSpecObj && (isEnabled(opSpecObj.infix) || isEnabled(opSpecObj.postfix)))
  {
    // make sure we don't misinterpet e.g. "(get ++i)" as "(get++ i)"
   if(opSpecObj.prefix && opSpecObj.postfix &&
     (lexer.onwhitespace(-1) && !lexer.onwhitespace(token.text.length)))
   {
     break; // let it be prefix next time round
   }

    // we don't distinguish infix from postfix below:
    var opSpec = opSpecObj.infix || opSpecObj.postfix;

    // we only keep scanning if we're hitting *higher* precedence
    if((opSpec.precedence || 0) <= precedence) {
      trace("read of infix/postfix stopping because op precedence " + (opSpec.precedence || 0) +
            " is <= the current precendence of " + precedence);
      break; // stop scanning
    }

    token = lexer.next_token();
    leftForm = opSpec.transform(lexer, opSpec, leftForm, sl.atom(token));
  }

  if(sl.isList(leftForm)) {
    // now that we've finished reading the list,
    // pop any local dialects whose scope has ended
    pop_local_dialects(lexer, leftForm);
  }

  return leftForm;
}

function isEnabled(opSpecObj) {
  return (opSpecObj &&
    ((!opSpecObj.options ||
      (typeof opSpecObj.options.enabled === 'undefined') ||
      opSpecObj.options.enabled)));
}

/**
* Read the form under the current position, using the closest scoped
* dialect that contains a matching entry in it's readtab.
*
* If such an entry returns "reader.retry", try the
* *next* closest dialect with a match (and so on) until one
* of the dialect's reads the form, otherwise it gets read by
* the closest "__default" handler.
*/

function read_via_closest_dialect(lexer, options) {
  trace(lexer.message_src_loc("", lexer, {file:false}));

  // options allow this function to be used when a readtab
  // handler needs to read by invoking a handler that it's
  // overridden, without knowing what dialect was overridden.
  // (see invoke_readfn_overridden_by below)
  options = options || {};
  // normally we start with the close dialect (0)
  var startingDialect = options.startingDialect || 0;

  // And normally we read the source text under the current position
  // unless they give us a token that's already been read)
  var token = options.token;
  if(!token) {
    // we *peek* when determining which readtab read function to call,
    // so the read functions can consume the *entire* form, including the
    // first token (which makes the design of the read functions easier
    // easier to understand and test in isolation).
    token = lexer.peek_token();
  }

  debug('reading expression starting "' + token.text + '"');
  var form = retry;
  var readfn;
  // try the dialects from beginning (inner scope) to end (outer scope)...
  for(var i = startingDialect; isretry(form) && i < lexer.dialects.length; i++) {
    var dialect = lexer.dialects[i];
    debug('looking for "' + token.text + '" in ' + dialect.name + ' readtab');
    readfn = findReadfn(dialect.readtab, token)
    if(readfn) {
      form = read_via_readfn(readfn, lexer, token.text);
      if(!form) {
        lexer.error('Invalid response from "' + token.text + '" readtab function in "' +
          dialect.name + '"');
      }
    }
  }

  // if we've tried all the dialects and either didn't find a match,
  // or found a match that returned "reader.retry"...
  if(isretry(form)) {
    // try all the dialects again, this time looking for "__default"
    // note: most likely this will get all the way to core's __default,
    //   but dialect's *can* override __default if they need to, and
    //   could e.g. "selectively" override it by returning reader.retry in
    //   cases where they want core's __default to handle it instead.
    for(var i = startingDialect; isretry(form) && i < lexer.dialects.length; i++) {
      var dialect = lexer.dialects[i];
      debug('looking for "__default" in ' + dialect.name + ' readtab');
      readfn = dialect.readtab !== undefined ? dialect.readtab['__default'] : undefined;
      if(readfn) {
        form = read_via_readfn(readfn, lexer, token.text);
        if(!form) {
          lexer.error('Invalid response for "' + token.text +
            '" returned by __default function in "' + dialect.name + '"');
        }
      }
    }
  }

  // this should never happen (because of __default) but JIC:
  if(!form || isretry(form)) {
    lexer.error('No dialect handled the text starting "' + lexer.snoop(10) + '...');
  }

  return form;
}

function invoke_readfn_overridden_by(overridingDialectName, readFnName, lexer) {

  // find the overriding dialect's index
  var overriding = -1;
  for(var i = 0; overriding === -1 && i < lexer.dialects.length; i++) {
    if(lexer.dialects[i].name === overridingDialectName) {
      overriding = i;
    }
  }

  return read_via_closest_dialect(lexer, {
            startingDialect: overriding+1,
            token : { text: readFnName, category: 'symbol' }
          });
}

function findReadfn(readtab, token) {
  var readfn;

  if(readtab) {
    // first try just the token text (this is typically what is used)
    readfn = readtab[token.text];

    // but ignore inherited properties e.g. "toString" etc.
    if(readfn && !readtab.hasOwnProperty(token.text)) {
      readfn = undefined;
    }

    if(!readfn && token.category) {
      // next try the token text qualified by it's token category
      readfn = readtab[token.text + ':' + token.category];
      if(!readfn && token.category) {
        // finally try the wildcarded token category (e.g. "*:float")
        readfn = readtab['*:' + token.category];
      }
    }
  }
  return readfn;
}

/**
* invoke a "read function" (found in the readtab) to read the
* form and return it.
*
* If a local dialect is assigned, activate the local dialect
* while reading the form, and assign the local dialect to the
* returned form for use by code generation.
*/
function read_via_readfn(readfn, lexer, text) {
  var form;

  // is there a name specified for a "local dialect"?
  if(readfn.dialect) {
    // use_dialect will load the dialect and push it on the dialect stack
    var localdialect = use_dialect(readfn.dialect, lexer, {local: true});

    // (now when the read function is called, any reading *it* does
    // will have the lextab and readtab of the local dialect available)
  }

  // call the read function...
  form = readfn(lexer, text);

  // if we got a form back and there is a local dialect...
  if(readfn.dialect) {
    if(form && !isretry(form)) {
      // save the local dialect's name on the form so that:
      // a. the local dialect can be popped when the end of
      //    the *containing* list is reached.
      // b. code generation can activate the same dialect
      //    when generating the form's code (without them
      //    having to assign the same dialect in the gentab
      //    that they've already assigned here in the readtab).
      form.dialect = readfn.dialect; // note this is the *name*
    }
    else {
      // didn't work out - so the local dialect doesn't apply:
      unuse_dialect(readfn.dialect, lexer);
    }
  }

  return form;
}

/*
GETTING INDIVIDUAL DIALECTS DONT MAKE AS MUCH SENSE SINCE WE'RE
NO LONGER MERGING DIALECTS.
THIS SHOULD BE ABLE TO BE DELETED
// get the current (closest scoped) dialect
// forForm is the form you're needing the dialect for (it is optional)
// if forForm is omitted you're getting the most recently created dialect (period)
// if there are no local dialects the most recent file level dialect is returned
function get_current_dialect(lexer, forForm, named) {
  return lexer.dialects[0];

  trace("get_current_dialect: " + (forForm ? "using form" : "using lexer.currentForm"));
  var currDialect = (forForm ?
                        get_closest_scoped_dialect_for(forForm, named) :
                        get_closest_scoped_dialect_for(lexer.currentForm, named));
  if(!currDialect && lexer.lastReadList) {
    trace("get_current_dialect checking lexer.lastReadList")
    currDialect = get_closest_scoped_dialect_for(lexer.lastReadList, named);
  }
  if(!currDialect) {
    trace("get_current_dialect checking lexer.dialects[0]")
    // no dialect on a form, use the file last #used file level dialect
    if(named) {
      currDialect = lexer.dialects.find(function(dialect) {
        return(dialect.name === named);
      })
      if(!currDialect) {
        console.log("warning: this file is missing a dialect named:", named)
      }
    }
    else {
      currDialect = lexer.dialects[0];
    }
  }
  return currDialect;
}
*/

/*
GETTING INDIVIDUAL DIALECTS DONT MAKE AS MUCH SENSE SINCE WE'RE
NO LONGER MERGING DIALECTS.
THIS SHOULD BE ABLE TO BE DELETED
// find the closest dialect from the startingForm
// you may optionally get a dialect with a specified name
function get_closest_scoped_dialect_for(startingForm, named) {
  if(startingForm) {
    if(startingForm.dialect &&
        (typeof named === "undefined" ||
          startingForm.dialect.name === named))
    {
      return startingForm.dialect;
    }
    else if(startingForm.parent) {
      return get_closest_scoped_dialect_for(startingForm.parent);
    }
  }
  return undefined;
}
*/

/*
OLD DELETE
// read by calling the read fn of the specified readtab entry
// THIS FUNCTION NOW SEEMS SILLY - IT REALLY SHOULD JUST BE A CALL TO THE
// READTAB FUNCTION SHOULDNT IT?  IE THIS FUNCTION COULD/SHOULD GO AWAY!
function read_via_readtab_entry(readfn, lexer, token) {
  // invoke the read function
  var form;
if(typeof entry === 'function') {
  form = readfn(lexer, token.text);
}
else {
console.log('IF YOU NEVER SEE THIS (AND YOU SHOULDNT) THEN CLEAN UP read_via_readtab_entry')
 form = readfn.read(lexer, readfn.match);
}
  // did we get a form back?
  // note: syntax fns return undefined to mean "I don't handle this"
  if(typeof form !== 'undefined') {
// SO *ALL* OF THIS STUFF FEELS MISPLACED!!!  IT SHOULD/COULD
// ALL BE DONE MORE APPROPRIATELY ELSEWHERE??!!!

    // as a convenience add toJSON where it's missing
    // (need to confirm - are we really making use of this anymore?)
    if(form && !form.toJSON) {
      form.toJSON = function() {
        return sl.toJSON(form);
      }
    }

    // KIND OF A HACK - AM STILL HOPING TO CLEAN UP AND ASSIGN THE SOURCE ON ALL FORMS PROPERLY
    if(!form.sourcer) {
      form.sourcer = lexer;
    }

    // why is this not in the read_delimited_list function?  can it go there?
    if(!isretry(form) && !isignorableform(form)) {
      lexer.lastReadFormInList = form;
    }
  }

  return form;
}
*/

/**
* read a list of atoms and/or other lists surrounded by delimiters (), [], etc.
* start is the expected opening delimiter as a string (or an existing start token
* if the opening delimiter has already been read)
* end is the expected end delimiter as a string
* initial is an optional array containing values prepopulated in the list
* separatorRE is an optional RE for "separators" to be skipped e.g. /,/
*/
function read_delimited_list(lexer, start, end, initial, separatorRE) {
    start = start || '(';
    end = end || ')';
    separatorRE = separatorRE || /,+/g;
    var startToken = (start && typeof start === 'string' ? lexer.next_token(start) : start);

    var list = (initial && sl.isList(initial) ? initial : sl.listFromArray(initial || []));
    list.setOpening(startToken);

    // starting a new list
    var token;
    while (!lexer.eos() && (token = lexer.peek_token()) && token && token.text !== end) {
      var nextform = read(lexer);

      // some "directives" don't return an actual form:
      if(!isignorableform(nextform)) {
        list.push(nextform);
      }

      // if they gave a separator (e.g. commas)
      if(separatorRE && lexer.on(separatorRE)) {
        lexer.skip_text(separatorRE); // just skip it
      }
    }
    if (!token || lexer.eos()) {
        lexer.error("Missing \"" + end + "\" ?  (expected \"" + end + "\", got EOF)", startToken);
    }
    var endToken = lexer.next_token(end); // skip the end token
    list.setClosing(endToken);

// IF THIS IS HERE IT HAS TO BE SMARTER - IT WAS ELIMINATING THE TOP LEVEL PAREN wrapper
// (AROUND THE WHOLE FILE) AND CAUSING PROBLEMS
// WOULDNT IT ALSO ELIMINATE A NO-ARG CALL?  SOMETHING LIKE (obj.run) ?
    // we can get extra parens when e.g. the user used parens around
    // an infix expression (which the reader reads as a nested list)
    // if(list.length === 1 && sl.isList(list[0])) {
    //   list = list[0];
    // }

/*
DELETE?
IT CANT BE USED ITS CHECKING FOR THE OLD EXTENSION 'lispy'!!!
DOES THIS ALSO MEAN THE __parenoptional STUFF CAN BE DELETED AS WELL??!!
    // in a lispy file they use parens whereas paren-free in a scripty file
    if(list.length === 1 && sl.isList(list[0])
      && list[0].__parenoptional && lexer.fileext === 'lispy')
    {
      // so here we have to *remove* what's otherwise *extra* parens:
      list = list[0];
    }
*/

// OLD DELETE    lexer.lastReadList = list;

    return list;
}

/**
* pop any local dialects enabled within the scope of the
* provided list.
*
* note:  here we intentionally look just one level down at
*   the *direct* children of the list, since "grandchildren"
*   have scopes of their own that are "popped" separately.
*/
function pop_local_dialects(lexer, list) {
  if(list && list.length > 0) {
    // we go in reverse order since the most recently
    // used (pushed) dialects will be at the end
    for(var i = list.length-1; i >= 0; i--) {
      if(list[i].dialect) {
        unuse_dialect(list[i].dialect, lexer);
      }
    }
  }
}

/**
* in javascript certain parens e.g. around conditions for "if" and
* "while" etc. are *required* as part of the grammar.  This function
* accommodates that by "reaching inside" those parens when they wouldn't
* (in a lispy world) have been needed, or otherwise returns the
* s-expression normally.  Consider e.g.:
*   if(true) {...}
* versus
*   if(x > y) {...}
* in the first case we simply return the atom true, whereas in the second
* case the list (> x y).
*/
function read_wrapped_delimited_list(lexer, start, end, initial, separatorRE) {

  var list = read_delimited_list(lexer, start, end, initial, separatorRE);
  if(list.length === 1) // DEL? &&
// DEL?    (sl.isList(list[0]) || sl.typeOf(list[0]) === 'boolean'))
  {
      // there's an extra nesting level than needed:
      list = list[0];
  }
  return list;
}

/**
* scan some delimited text and get it as a string atom
* lexer.options.omitDelimiters = whether to include the include the delimiters or not
*/
function read_delimited_text(lexer, start, end, options) {
  options = options || {includeDelimiters: true};
  var delimited = lexer.next_delimited_token(start, end, options);
  return sl.atom(delimited);
}

/*
OLD DELETE
function match_syntax_matcher(matcherOrArray, lexer) {
  var entry;
  var matched;
  var matcher = Array.isArray(matcherOrArray) ? matcherOrArray[0] : matcherOrArray;
  if(matcher.match instanceof RegExp || typeof matcher.match === 'string') {
    matched = lexer.on(matcher.match)
  }
  else if(matcher.match instanceof Function) {
    // note that lexer.on does accept a function but there it's expect to
    // check single characters whereas in the matcher it's expected to be
    // a full blown replacement for matching the front of the lexer.
    matched = matcher.match(lexer)
  }
  else {
    lexer.error("Unknown match type in readrules: " + matcher);
  }

  if(matched) {
    entry = {
      match: matched,
      read: matcher.read
    };
  }
  return entry;
}
*/

/**
* Read the content of the specified filename
* into the specified lexer file.  If the file has a .js
* extension a string of the js content is returned,
* otherwise the lispy forms are returned.
*
* Note that if a lexer is provided the dialects currently
* in use *are* applied when lexing/reading the included
* file (consistent with the view that an include treats
* it's contents the same as if it had been "inline").
*/
function read_include_file(filename, lexer) {

  var includedForms;
  var foundFile = false;

  var all_dirs = include_dirs.concat([path.dirname(lexer.filename)]);
  all_dirs = all_dirs.concat([path.dirname(filename)]);

  var fullPath;
  all_dirs.forEach(function(prefix) {
    if (foundFile) {
      return;
    }

    fullPath = prefix + '/' + filename;
    try {
      trace("looking for include file at " + fullPath);
      filename = fs.realpathSync(fullPath);
      foundFile = true;
    } catch (err) {
      // not found - intentional ignore
    }
  });

  if (!foundFile) {
    lexer.error('No such include file: ' + filename);
  }
  trace("the include file was found at " + fullPath);

  // assuming we've gotten the lexer we're reading into...
  if(lexer) {
    if(!lexer.included) {
      lexer.included = [];
    }

    // prevent reading the same include file multiple times
    // (e.g. prevent circular includes)
    if (lexer.included.indexOf(filename) === -1) {
      lexer.included.push(filename);
      var code = fs.readFileSync(filename, "utf-8");
      if(path.extname(filename) === '.js') {
        // this was a javascript file just return the code as a string
        return code;
      }
      // this was a sugar file - transform the code to lispy forms
      includedForms = read_from_source(code, filename, {wrapOuterForm: true, includeFile: true});
    }
  }
  else {
    // no lexer given - read it anyway:
    var code = fs.readFileSync(filename)
    includedForms = read_from_source(code, filename, {wrapOuterForm: true});
  }

  return includedForms;
}

/**
* Get the syntax's keys sorted by priority,
* where "priority" is an optional number they can assign
* the syntax entries, otherwise the length of its key
*/
/*
OLD DELETE
function get_prioritized_matchkeys(syntax) {

  // Provide an easy way to search these from longest to shortest
  var keys = Object.keys(syntax);

  keys = keys.filter(function (value) {
    return(value !== "__default" && value !== "__readdefaulttoken");
  });

  keys.sort(function(a, b) {
    var apri = typeof syntax[a].priority !== 'undefined' ? syntax[a].priority : a.length;
    var bpri = typeof syntax[b].priority !== 'undefined' ? syntax[b].priority : b.length;
    return bpri - apri;
  });

  return keys;
}
*/

// generate a random variable name compatible with languages like javascript
function gen_var_name(seedName) {
  var firstPart = sl.valueOf(seedName).match(/^[\$\_a-zA-Z][\$\_a-zA-Z0-9]+/);
  if(!firstPart) {
    firstPart = "var";
  }

  var numPart = Math.floor((Math.random() * 1000000) + 1);

  return "__" + firstPart + "_" + numPart;
}

/**
* Register a dynamic transform so that we know (unlike most
* transforms) that the specification of transform function,
* precedence level, etc. will be gotten from the form returned
* by the specified syntax handler function - dynamically at
* read time.  optype is one of 'unary' or 'binary'.
*/
function registerDynamicTransform(optype, readfn) {
  readfn.operator = { type: optype, style: 'dynamic'}
}

/**
* Merge one dialect's lookup table (the first argument) with properties
* from the other arguments.
*
* If the first argument has a property that matches a later argument's
* property, the property value turned into an array of the property
* values.
*
* (if it helps, you can think of the array as anologous to a prototype chain,
* and the way the lookup tables merge as a kind of multiple inheritance)
*/
/*
OLD DELETE
function mergeLookupTables() {

  // there are certain keys we don't want to merge
  // (there's places in the code that will blow of up if they are)
  var exclude = [
    "__default",
    "__readdefaulttoken",
    "__matchkeys",
    "__terminatingchars",
    "__add_terminatingchars",
    "__nonterminatingchars",
    "__operators",
    "__operatorsymbols"
  ];

  if(!arguments.length || arguments.length === 0)
    return {};
  var out = arguments[0];
  for(var i=1; i<arguments.length; i++) {
    for(var key in arguments[i]) {
      if (arguments[i].hasOwnProperty(key)) {
        if(typeof out[key] === 'undefined') {
          out[key] = arguments[i][key];
        }
        else {
          // the out table is overriding another dialect's symbol
          if(exclude.indexOf(key) === -1 && out[key] !== arguments[i][key]) {
            // for the normal keys, we don't just replace them we
            // keep a list of the them all since overrides can
            // (optionally) delegate to previous entries
            var handlerList = [];
            copyToArray(out[key], handlerList);
            copyToArray(arguments[i][key], handlerList);
            out[key] = handlerList;
          }
        }
      }
    }
  }
  return out;
}
*/

// copy from (which might be an array or not) into array toArray
/*
OLD DELETE
function copyToArray(from, toArray) {
  if(Array.isArray(from)) {
    from.forEach(function(val) {
      if(!isAtEnd(val, toArray)) {
        toArray.push(val);
      }
    })
  }
  else {
    if(!isAtEnd(from, toArray)) {
      toArray.push(from);
    }
  }
}

function isAtEnd(val, arr) {
  var atEnd = false;
  if(arr && arr.length > 0) {
    atEnd = (val === arr[arr.length-1]);
  }
  return atEnd;
}
*/

/**
* Terminating characters mark the end of tokens
*
* We infer terminating characters from any of your syntax's
* keys that are single character punctuation symbols (to be more
* precise we look at the *first* char of each of your keys and
* take any that are not alphanumeric).
*
* If this proves incorrect, you can adjust them by entering the
* chararacters in these additional syntax entries:
*   exports.__add_terminatingchars = "...";
*
* Or if you prefer to *completely* specify your terminating
* characters you can specify this alternative syntax entry:
*   exports.__terminatingchars = "...";
*/
/*
OLD DELETE
function findTerminatingChars(syntax, initialChars) {
  var terminatingChars = initialChars || "";
  // did they fully specify their own terminating characters?
  if(syntax.__terminatingchars) {
    // no inference
    for(var i=0;i < syntax.__terminatingchars.length;i++) {
      ch = syntax.__terminatingchars.charAt(i);
      if(terminatingChars.indexOf(ch) === -1) {
        terminatingChars += ch;
      }
    }
  }
  else {
    // attempt to infer a reasonable set of terminating chars
    syntax.__matchkeys.forEach(function(key) {
      if((key !== "__default" && key !== "__readdefaulttoken") &&
        typeof syntax[key] === 'function')
      {
        var firstChar = key.charAt(0);
        if(!/[a-zA-Z0-9]/.test(firstChar)) {
          if(terminatingChars.indexOf(firstChar) === -1) {
            terminatingChars += firstChar;
          }
        }
      }
    });

    // they can also adjust the "inference" via:
    if(syntax.__add_terminatingchars) {
      for(var i=0;i < syntax.__add_terminatingchars.length;i++) {
        ch = syntax.__add_terminatingchars.charAt(i);
        if(terminatingChars.indexOf(ch) === -1) {
          terminatingChars += ch;
        }
      }
    }
  }

  debug("Terminating chars:", terminatingChars);
  return terminatingChars;
}
*/

/**
* When found in the middle of a token, nonterminating
* characters do *not* mark the end of tokens
*
* Examples are things like the question mark in "undefined?"
* and the ">" in the method chaining macro "->".
*
* Note that in general sugarlisp takes a different approach to
* tokenizing than classic lisp in that you enter your terminal
* symbols (keywords etc) in the syntax table and sugarlisp endeavors
* to match the longest one of those it can.  However the grammar
* is "open-ended" in the sense that some symbols are not represented
* (the names of functions or macros, javascript symbols e.g.
* "console" that simply pass through etc).  This is where the
* terminating and non-terminating concepts come into play.
*
* To clarify, for tokens not entered as syntax keys, a "?" or
* ">" will be included in the middle of a token (if they've been
* marked non-terminating) yet they'll be returned by themselves
* when encountered at the start of a token (when they are
* marked as terminating).
*
* Unlike terminating characters, sugarlisp makes no attempt
* to "infer" non-terminating characters.
*
* However nonterminating characters specified in lower dialects
* do merge into higher "mixin" dialects (this is also true for
* terminating characters).
*
* To specify nonterminating characters for your dialect you add
* them in the syntax entry:
*   exports.__nonterminatingchars = "...";
*/
/*
OLD DELETE
function findNonterminatingChars(syntax, initialChars) {
  var nonterminatingChars = initialChars || "";
  // did they specify nonterminating characters?
  if(syntax.__nonterminatingchars) {
    for(var i=0;i < syntax.__nonterminatingchars.length;i++) {
      ch = syntax.__nonterminatingchars.charAt(i);
      if(nonterminatingChars.indexOf(ch) === -1) {
        nonterminatingChars += ch;
      }
    }
  }

  debug("Nonterminating chars:", nonterminatingChars);
  return nonterminatingChars;
}
*/

/**
* You mark a symbol with "reader.unexpected" in your readtab
* if the symbol is read internally by some read function
* without using a readtab entry at all.
*/
function unexpected(lexer) {
  lexer.error("unexpected \"" + lexer.peek_char() + "\" encountered (is something missing before this?)");
}

/**
* A symbol
* Use reader.symbol in their readtab to ensure the lexer
* scans the specified token text correctly as a symbol.
*/
function symbol(lexer, text) {
  var token = lexer.next_token(text);
  return sl.atom(text, {token: token});
}

/**
* A symbol that's aliased to another.
* e.g. We allow them do assignment like either "(set var value)" or
* "(= var value)" by treating "=" as an alias for "set".
* To allow that the symbol table has:
*     exports["="] = reader.symbolAlias("set").
*/
function symbolAlias(aliasFor) {
  return function(lexer, text) {
    var token = lexer.next_token(text);
    return sl.atom(aliasFor, {token: token});
  }
}

/**
* get the "operator spec" for the form (if any).
* this is an object of the form e.g.
*   {
*     type: infix,
*     read: reader.infix2prefix,
*     precedence: 15,
*     options: {altprefix: 'arrowfn'}
*   }
*
* @parm atomOrStr an atom or a symbol string
* @param dialects the "stack" of current dialects
*/
function getOperatorSpecFor(atomOrStr, dialects) {

  var opSpec;

  var atom = typeof atomOrStr !== 'string' ? atomOrStr : undefined;
  var str = typeof atomOrStr === 'string' ? atomOrStr : undefined;
  var sym = str || sl.valueOf(atom);

  // make sure and check the atom first - it takes precedence
  if(atom) {
    // was this form "dynamically" marked as needing to be transformed?
    opSpec = atom.operator;
  }

  if(!opSpec) {
    // no - was it "statically" marked i.e. via it's symbol in a readtab?
    dialects.find(function(dialect) {
      if(dialect.readtab.__operatorsymbols.indexOf(sym) !== -1) {
        var readfn = (!Array.isArray(dialect.readtab.__operators[sym]) ?
                          dialect.readtab.__operators[sym] :
                          dialect.readtab.__operators[sym][0]);
        opSpec = readfn.operator;
        return true;
      }
      return false;
    });
  }

  if(opSpec &&
    !opSpec.infix && !opSpec.prefix && !opSpec.postfix)
  {
    if(opSpec.type) {
      var reformedOpSpec = {};
      reformedOpSpec[opSpec.type] = opSpec;
      opSpec = reformedOpSpec;
    }
    else {
      sl.lexerOf(atom).error("Malformed operator precedence specification for " + sym);
    }
  }

  return opSpec;
}

/**
* In sugarlisp an "operator" refers to a symbol that can be used
* infix/prefix/postfix without parentheses.
*
* By configuring your readtab correctly using reader.x(),
* reader.read() will  rearrange the expressions and return a
* traditional (lispy prefix) s-expression list.
*
* There are two ways to call reader.operator() - one way if the
* operator only supports *one* of infix or prefix or postfix, e.g.
*
* reader.operator('postfix', 'unary', tradfncalltosexpr, 17.5, {altprefix: "fncall("})
*
* The other way takes a single object argument when an operator
* can be used in more than one way, e.g. both prefix and postfix:
*
* reader.operator({
*   prefix: reader.operator('prefix', 'unary', readparenthesizedlist, 1),
*   postfix: reader.operator('postfix', 'binary', tradfncalltosexpr, 17.5)
* });
*
* As you can see the properties of the object are simply reader.operator
* calls in the "first way" described above.
*
* @param optypeOrObj = 'infix', 'prefix', or 'postfix', else an object as above
* @param argtype = 'unary' (single argument) or 'binary' (two argument)
* @param transformfn = function as described below
* @param precedence = "priority" or "binding power" (higher numbers bind more tightly)
* @param opts = options to pass to the transform function
*
* transformfn is the function which reads the necessary forms and
* rearranges them into a lispy (prefix) list.  For infix a transformfn
* expects args like e.g.:
*
*    function infix2prefix(lexer, opSpec, leftForm, operatorForm)
*
* Where the job of the transformfn is to read any rightForm(s) and
* return a lispy list i.e. sl.list(operatorForm, leftForm, rightForm)
*
* A similar example for prefix is:
*
*    function prefixexpr(lexer, opSpec, operatorForm) {
*
* Here the job of the transformfn is to read the rightForm(s)
* and likewise return a lispy list e.g. sl.list(operatorForm, rightForm)
*
* And finally for postfix an example is:
*
*    function postfixexpr(lexer, opSpec, leftForm, operatorForm)
*
* For a truly postfix operator in this case you might not need to read
* any rightForm(s), but you will likely need to reverse the order to
* produce a lispy (prefix) expression i.e. sl.list(operatorForm, leftForm)
*
* Precedence levels set the order these operations get transformed,
* where lower levels are performed first (see
*   e.g. https://www.wikiwand.com/en/Order_of_operations).
*
* The opts are optional - if given they allow you to specify
* options at "setup time" that will be passed into the transformfn
* later.
*/
function operator(optypeOrObj, argtype, transformfn, precedence, opts) {
  opts = opts || {};
  // the read function for all the operators just reads their symbol:
  var readfn = function(lexer, text) {
    // operators e.g. "--" need to return from e.g. "--x" even
    // though the "-" has been defined as a non-terminating
    // character (maybe this can be simplified!!??)
    var token = lexer.next_token(text, {matchPartial: true});
    return sl.atom(text, {token: token});
  };
  if(typeof optypeOrObj === 'string') {
    readfn.operator = {
      type: optypeOrObj,
      argtype: argtype,
      transform: transformfn,
      precedence: precedence,
      assoc: opts.assoc,
      options: opts
    };
  }
  else if(typeof optypeOrObj === 'object') {
    // this is an operator that is e.g. prefix and postfix,
    var opSpecObj = optypeOrObj;
    readfn.operator = {
      infix: (optypeOrObj.infix && optypeOrObj.infix.operator ?
                  optypeOrObj.infix.operator :
                  optypeOrObj.infix),
      prefix: (optypeOrObj.prefix && optypeOrObj.prefix.operator ?
                  optypeOrObj.prefix.operator :
                  optypeOrObj.prefix),
      postfix: (optypeOrObj.postfix && optypeOrObj.postfix.operator ?
                  optypeOrObj.postfix.operator :
                  optypeOrObj.postfix)
    };
  }
  return readfn;
}


/**
* infix operator
*
* in sugarlisp an infix operator is an unparenthesized expression
* of the form e.g. "x op y" which gets translated as if it
* had been been "(op x y)"
*
* The opts.altprefix is optional (and normally not used), but it
* allows the prefix form to use a different name than the infix form. e.g.
* in dialect-x we translate infix "=" e.g.:
*   x = 5;
* into prefix "set":
*   (set x 5)
*/
function infix(precedence, opts) {
  return operator('infix', 'binary', infix2prefix, precedence, opts);
}

function infix2prefix(lexer, opSpec, leftForm, opForm) {
  // To handle right-associative operators like "^", we allow a slightly
  // lower precedence when parsing the right-hand side. This will let an
  // operator with the same precedence appear on the right, which will then
  // take *this* operator's result as its left-hand argument.
  var rightForm = read(lexer,
      opSpec.precedence - (opSpec.assoc === "right" ? 1 : 0));

  if(opSpec.options.altprefix) {
    opForm = utils.clone(opForm);
    opForm.value = opSpec.options.altprefix;
    opForm.text = opSpec.options.altprefix;
  }

  return sl.list(opForm, leftForm, rightForm);
}

/**
* prefix operator
*
* in sugarlisp a prefix operator is an unparenthesized expression
* of the form "<op>x" which gets translated as if it
* had been been "(<op> x)"
*
* The opts.altprefix is optional (and normally not used), but it
* allows the translated prefix form to use a different name than what the
* lexer actually uses - e.g. "!x" could be translated as "(not x)".
*/
function prefix(precedence, opts) {
  return operator('prefix', 'unary', prefix2expr, precedence, opts);
}

function prefix2expr(lexer, opSpec, opForm) {
  var rightForm = read(lexer, opSpec.precedence);

  if(opSpec.options.altprefix) {
    opForm = utils.clone(opForm);
    opForm.value = opSpec.options.altprefix;
    opForm.text = opSpec.options.altprefix;
  }

  return sl.list(opForm, rightForm);
}

/**
* postfix operator
*
* in sugarlisp a postfix operator is an unparenthesized expression
* of the form "x<op>" which gets translated as if it
* had been been "(<op> x)"
*
* Note that (for example) if an operator has both a prefix and postfix
* form, and you wish to transpile them differently you can use
* opts.altprefix to have the translated prefix form use a different
* keyword when the operator is used prefix than when it's used postfix.
*/
function postfix(precedence, opts) {
  return operator('postfix', 'unary', postfix2prefix, precedence, opts);
}

function postfix2prefix(lexer, opSpec, leftForm, opForm) {

  if(opSpec.options.altprefix) {
    opForm = utils.clone(opForm);
    opForm.value = opSpec.options.altprefix;
    opForm.text = opSpec.options.altprefix;
  }

  return sl.list(opForm, leftForm);
}

/**
* reader.parenfree<N> = a parens-free keyword of arity <N>
* options is an optional object containing:
*   "alternate" is a name to look up in the dialect's "keywords"
*       table, if it differs from the keyword they actually use
*       in the lexer code.
*   "parenthesized" is meant for use with keywords such as
*       if/while/switch/etc. which (in javascript and sugarscript
*       syntax) *require* parens around the first expression
*       following the keyword.  It's value should be a number
*       representing the position of the parenthesized expression
*       (e.g. "first expression" = 1)
*   "bracketed" is meant for use with keywords such as
*       if/while/switch/etc. which (in javascript and sugarscript
*       syntax) have optional "{...}" brackets around the body.
*       It's value should be a number representing the position
*       of the bracketed expression (e.g. "second expression" = 2)
*       When used the bracketed expressions are "lifted" up i.e.
*       spliced into the parent list of forms.
*   "validate" an optional function to call after the forms are
*       read.  The function receives the lexer, and the newly
*       read list of forms.
*
* @returns a form list just the same as if they'd entered parens
*       explicitly as a true lispy s-expression.
*/
function parenfree(arity, options) {
  options = options || {};
  return function(lexer) {
    var token = lexer.next_token();
    var fnName = options.alternate || token.text;
    var formlist = sl.list(fnName);
    formlist.setOpening(token);

    while(formlist.length < arity + 1) {
      var nextform;
      if(options.parenthesized && options.parenthesized === formlist.length) {
        // "wrapped" here because something like (true) returns simply "true"
        nextform = read_wrapped_delimited_list(lexer, '(', ')');
      }
      // note brackets are *optional* if there's a single expression body
      else if(options.bracketed && options.bracketed === formlist.length
        && lexer.on('{'))
      {
        nextform = read_delimited_list(lexer, '{', '}');
        formlist.pushFromArray(nextform);
        nextform = undefined;  // we've added the forms so no need to below
      }
      else {
        nextform = read(lexer);
      }

      // some directives" don't return an actual form:
      if(nextform && !isignorableform(nextform)) {
        formlist.push(nextform);
      }
    }

    if(options.validate) {
      options.validate(lexer, formlist);
    }

    // this list was read paren free!
    //   (add metadata useful in case they're an old lisp
    //   hacker and used parens *anyway*)
    formlist.__parenoptional = true;

    // note we don't set the closing token's line/col
    // position - since there *is* no closing paren!
    return formlist;
  }
};

/**
* Reader function to translate binary infix (e.g. "a + b") to prefix (i.e. "+ a b")
* note:  this depends on "look back" to the last form the reader had read
*  within the current list being read.  Note that we may be called with
*  symbol already in prefix position.  In that case we simply return the
*  symbol for the token assuming it's list will read in normally.
*/
/*
DELETE?
function infixtoaltprefix(altfname) {
  return function(lexer, text) {

    var token = lexer.create_token(text);
    lexer.skip_text(text);

    if(!lexer.lastReadFormInList) {
      // already in prefix position since it's first in the list!
      return sl.atom(text, {token: token});
    }

    // the arguments are the prior form then next form...
    // pull in the prior form (which has already been read)
    // we don't *delete* it from parent - that would leave a gap in the array indices!
    // instead we *replace* the prior form with our new binary operation form
    var priorform = lexer.lastReadFormInList;
    var priorformPos;
    var priorParent = priorform.parent;

    // if we don't have an alternate, we assume the operator
    // is what we're assigned to in the syntax table:
    var formlist = sl.list(altfname||text);
    formlist.setOpening(token);

    if(priorParent) {
      priorformPos = priorParent.indexOf(priorform);
      if(priorformPos === -1) {
        lexer.error("could not convert infix \"" + text + "\" to prefix (invalid prior form)");
      }

      formlist.push(priorform);  // note this changes the parent to our new list

      while(!lexer.eos() && formlist.length < 3) {
        var nextform = read(lexer);
        // some directives" don't return an actual form:
        if(!isignorableform(nextform)) {
          formlist.push(nextform);
        }
      }

      // remove the originally read form
      // (since our expression includes it now)
      priorParent.splice(priorformPos,1);
    }
    else {
      lexer.error("could not convert infix \"" + text + "\" to prefix (parent form is required)");
    }
    trace("infixtoprefix returning: " + formlist.toJSON());
    return formlist;
  }
}
*/

/**
* Read functions that just have side effects (e.g. "#use")
* can return "reader.ignore_form" to indicate that there is no
* form to process.
*
* note:  you might expect that returning undefined would be
*   as good - but don't.  Returning undefined is considered
*   an error (since it's so easy to do on accident).
*/
var ignorable_form_key = "___%%SLFORM_IGNORE%%___";
var ignorable_form = sl.atom(ignorable_form_key);
function isignorableform(form) {
  return form && sl.valueOf(form) === ignorable_form_key;
}

/**
* Read functions that just have side effects (e.g. "#use")
* can return "reader.passthru_prelude" to pass comments or
* whitespace that preceded the directive.
*/
function passthru_prelude(tokenOrForm) {
  // the expression returned is a "no-op" represented as (nop)
  // it's only purpose is to have something for the prelude to hang on
  // (note we scrub "(nop)" from the pretty-printed parse trees btw)
  var nop = sl.list("nop");
  if(tokenOrForm && tokenOrForm.prelude) {
    nop.prelude = tokenOrForm.prelude;
  }
  return nop;
}

/**
* Read functions that fail to make sense of their input
* can return "reader.retry" to indicate that they
* would like the reader to try a subsequent (lower
* priority) match.
*
* If no such match is found in the current dialect, then
* lower level dialects will also be tried (which may include
* syntax entries overridden by this dialect).
*
* note:  you might expect that returning undefined would be
*   as good - but don't.  Returning undefined is considered
*   an error (mainly because it's so easy to do on accident).
*/
var retry_key = "___%%SLRETRY%%___";
var retry = sl.atom(retry_key);
function isretry(form) {
  return form && sl.valueOf(form) === retry_key;
}

/**
* Find the first form in the forms tree where predicate returns true.
* predicatefn is a function of the form:
*  function(form, pos, dialect) {
*    return true if found otherwise false
*  }
*
* form is a single form from the forms tree
* pos is the position of that form in it's parent list,
* dialect is the form's closest surrounding dialect
*
* note: this is a depth first tree walk - this corresponds to the natural
*   left-to-right/top-to-bottom order of the original lexer
*/
function finddeep(forms, predicatefn, pos, container, parentDialect) {

  pos = pos || 0;
  parentDialect = parentDialect || get_current_dialect(sl.lexerOf(forms));

  if(Array.isArray(forms)) {
    for (var i = 0, value; i < forms.length; i++) {
      var localDialect = forms[i].dialect || parentDialect;
      value = finddeep(forms[i], predicatefn, i, forms, localDialect);
      if(value) {
        return value;
      }
    }
    return undefined;
  }
  else {
    if(predicatefn(forms, pos, container, parentDialect)) {
      return forms;
    }
  }
  return undefined;

}

// The loaded dialects (we load each dialect just once)
// DELETE exports.dialects = {};

// DELETE exports.getDefaultDialects = getDefaultDialects;

// reading forms
exports.read = read;
exports.read_from_source = read_from_source;
exports.initLexerFor = initLexerFor;
exports.nonlocal_tokens = nonlocal_tokens;
exports.read_include_file = read_include_file;
exports.read_delimited_list = read_delimited_list;
exports.read_wrapped_delimited_list = read_wrapped_delimited_list;
exports.read_delimited_text = read_delimited_text;
exports.invoke_readfn_overridden_by = invoke_readfn_overridden_by;

// dialects
//OLD DELETE exports.get_current_dialect = get_current_dialect;
//OLD DELETE exports.get_closest_scoped_dialect_for = get_closest_scoped_dialect_for;

// other
exports.unexpected = unexpected;
exports.symbol = symbol;
exports.symbolAlias = symbolAlias;
// DELETE exports.applyTreeTransforms = applyTreeTransforms;
exports.operator = operator;
exports.infix = infix;
exports.infix2prefix = infix2prefix;
exports.prefix = prefix;
exports.prefix2expr = prefix2expr;
exports.postfix = postfix;
exports.postfix2prefix = postfix2prefix;
exports.registerDynamicTransform = registerDynamicTransform;

// DELETE exports.infixtoaltprefix = infixtoaltprefix;
// DELETE exports.infixtoprefix = infixtoaltprefix();
exports.ignorable_form = ignorable_form;
exports.isignorableform = isignorableform;
exports.passthru_prelude = passthru_prelude;
exports.retry = retry;
exports.isretry = isretry;
exports.use_dialect = use_dialect;
exports.unuse_dialect = unuse_dialect;
exports.gen_var_name = gen_var_name;
exports.parenfree = parenfree;
exports.finddeep = finddeep;
