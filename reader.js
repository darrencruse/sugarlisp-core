/**
* The reader transforms a stream of tokens into a list of
* atoms and/or other lists (where we have atoms of various types:
* symbols, strings, numbers, booleans etc).
*/
var src = require('./source'),
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

var debug = require('debug')('sugarlisp:core:reader:info'),
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

// get a syntax table entry for the text under the current position
// note: if the current entry has already been found, a cached entry is returned
function get_syntaxtable_entry(source) {

  if(!(source.lastSyntaxEntry &&
      source.lastSyntaxEntryPos === source.position)) {
    var entry = invoke_read_function(source, {exec: false});
    if(entry) {
      source.lastSyntaxEntry = entry;
      source.lastSyntaxEntryPos = source.position;
    }
  }
  return source.lastSyntaxEntry;
}

// Read a form and return the form tree for it's s-expression
function read(source, precedence) {

  precedence = precedence || 0;

  var form = read_next_form(source);
  var dialect = dialect || get_current_dialect(sl.sourceOf(form));

  // are we a prefix unary operator?
  var leftForm = form;
  if(sl.isAtom(form)) {
    var opSpec = getOperatorSpecFor(form, dialect);
    if(opSpec && opSpec.prefix && opSpec.prefix.read) {
      leftForm = opSpec.prefix.read(source, opSpec.prefix, form);
    }
  }

  // note flipped check below from < to > because our precedences
  // are currently as you see them here: http://www.scriptingmaster.com/javascript/operator-precedence.asp
  // not as you see them here:  http://journal.stuffwithstuff.com/2011/03/19/pratt-parsers-expression-parsing-made-easy/
  var token, opSpecObj;
  while(!source.eos() && (token = source.peek_token()) &&
    (opSpecObj = getOperatorSpecFor(token.text, dialect)) &&
    opSpecObj && (opSpecObj.infix || opSpecObj.postfix))
  {
    // make sure we don't misinterpet e.g. "(get ++i)" as "(get++ i)"
   if(opSpecObj.prefix && opSpecObj.postfix &&
     (source.onwhitespace(-1) && !source.onwhitespace(token.text.length)))
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

    token = source.next_token();
    leftForm = opSpec.read(source, opSpec, leftForm, sl.atom(token));
  }

  return leftForm;
}

// helper for read above that avoids doing unnecessary lookups
// if a peek was just done
function read_next_form(source) {
  var form;

  // when a peek was just done, often we will still be sitting
  // on the same position and already know the entry to use:
  if(!(source.lastSyntaxEntry &&
      source.lastSyntaxEntryPos === source.position)) {
    // a peek wasn't just done though:
    form = invoke_read_function(source);
  }
  else {
    // read the thing just peeked:
    form = read_from_syntax_entries(source.lastSyntaxEntry, source);
    if(!form) {
      source.error('Invalid response from cached syntax entry for "' + source.snoop(10) + '..."');
    }
    if(isretryablematch(form) ) {
      // so the entry that had been stored (from doing a peek)
      // turned out to not handle the form - go back and try again:
      form = invoke_read_function(source);
    }
  }
  return form;
}

/**
* Find and execute the appropriate read function for the code
* under the current position and return the forms that are read.
*
* The search starts in the current syntax in the current dialect.
* If the read function returns reader.retry_match it will retry
* starting with the next lowest priority syntax entry, and failing
* that, with the next dialect in the closest surrounding lexical scope.
*
* If options.exec is false, instead of executing the read function it
* will simply return the following metadata about the first matching
* syntax entry it finds:
*
*   {
*      match: the matched text (starting from current position)
*      read: the read function to be invoked
*      syntax: the syntax table that holds the read function above
*   }
*
*/

function invoke_read_function(source, options) {
  var form = retry_match;
  options = options || {};
  var currDialect = get_current_dialect(source);
  debug('matching in syntax table of "' + currDialect.__dialectname + '"');
  trace(source.message_src_loc("", source, {file:false}));
  // we search in priority (e.g. longest to shortest) order:
  var matchkeys = currDialect.syntax.__matchkeys;
  for(var i = 0; isretryablematch(form) && i < matchkeys.length; i++) {

    // entries are normally just strings but they can also
    // be matcher objects (e.g. using regexes)
    var entry = undefined;
    var syntaxval = currDialect.syntax[matchkeys[i]];

    // if it's a list of entries the most recent takes precedence
    var firstval = (Array.isArray(syntaxval) ? syntaxval[0] : syntaxval);
    if(typeof firstval === 'function') {
      // we "match partial" if this is an operator e.g. "--a" should return "--"
      if(source.on(matchkeys[i], firstval.operator)) {
        entry = {
          match: matchkeys[i],
          read: syntaxval,
          syntax: currDialect.syntax
        };
      }
    }
    else if(typeof firstval === 'object' && firstval.match) {
      entry = match_syntax_matcher(syntaxval, source);
    }
    else {
      // it could be e.g. "__matchkeys"
      // (by convention such things we prefix with two underscores)
      if(matchkeys[i].indexOf('__') === 0) {
        continue;
      }

      // this may be an operator:
      if(typeof firstval === 'object' &&
        (firstval.infix || firstval.prefix || firstval.postfix || firstval.type))
      {
        continue;
      }

      // this seems to be a bad entry in the syntax
      source.error('Malformed syntax entry for "' + matchkeys[i] +
                    '" in dialect "' + currDialect.__dialectname + '"');
    }

    if(entry) {
      debug('syntax entry for "' + entry.match +
                '" found in dialect "' + currDialect.__dialectname + '"' +
                (currDialect.__dialectname != firstval.__dialectname ?
                  ' (inherited from "' + firstval.__dialectname + '")' : ""));

      // they can stop here if they want:
      if(typeof options.exec !== 'undefined' && !options.exec) {
        return entry;
      }

      form = read_from_syntax_entries(entry, source);
      if(!form) {
        source.error('Invalid response from "' + entry.match + '" entry in "' +
          currDialect.__dialectname + '"');
      }
    }
  }

  // if we've tried them all and not found a match...
  if(isretryablematch(form)) {

    var currSyntax = currDialect.syntax;
    if(currSyntax.__readdefault && currSyntax.__readdefaulttoken) {

      // the __readdefault function is an (optional) catchall.
      // it's taken from the current (top most) dialect
      // (though it may have merged up from the lower ones).
      // since it's not clear what token text it will match,
      // they provide the complementary "__readdefaulttoken" which
      // should return the same token "__readdefault" will consume
      debug('using __readdefault...');
      var willmatch = "?";

      // ensure reading the token doesn't advance the
      // current position using "rewind"
      source.mark_rewind_point();
      source.peekingToken = true;
      var willmatchtoken = currSyntax.__readdefaulttoken(source);
      this.peekingToken = false;
      source.rewind();
      if(willmatchtoken) {
        willmatch = willmatchtoken.text;
      }

      var entry = {
        match: willmatch,
        read: currSyntax.__readdefault,
        syntax: currSyntax
      };

      if(typeof options.exec !== 'undefined' && !options.exec) {
        return entry;
      }
      else {
        form = read_from_syntax_entries(entry, source);
        if(!form) {
          source.error('Invalid response from __readdefault in "' + currDialect.__dialectname + '"');
        }
      }
    }
  }
  if(!form || isretryablematch(form)) {
    source.error('Failed to read text starting "' + source.snoop(10) + '..." via "' + currDialect.__dialectname + '"');
  }
  return form;
}

// get the current (closest scoped) dialect
// forForm is the form you're needing the dialect for (it is optional)
// if forForm is omitted you're getting the most recently created dialect (period)
// if there are no local dialects the most recent file level dialect is returned
function get_current_dialect(source, forForm, named) {
  trace("get_current_dialect: " + (forForm ? "using form" : "using source.currentForm"));
  var currDialect = (forForm ?
                        get_closest_scoped_dialect_for(forForm, named) :
                        get_closest_scoped_dialect_for(source.currentForm, named));
  if(!currDialect && source.lastReadList) {
    trace("get_current_dialect checking source.lastReadList")
    currDialect = get_closest_scoped_dialect_for(source.lastReadList, named);
  }
  if(!currDialect) {
    trace("get_current_dialect checking source.dialects[0]")
    // no dialect on a form, use the file last #used file level dialect
    if(named) {
      currDialect = source.dialects.find(function(dialect) {
        return(dialect.__dialectname === named);
      })
      if(!currDialect) {
        console.log("warning: this file is missing a dialect named:", named)
      }
    }
    else {
      currDialect = source.dialects[0];
    }
  }
  return currDialect;
}

// find the closest dialect from the startingForm
// you may optionally get a dialect with a specified name
function get_closest_scoped_dialect_for(startingForm, named) {
  if(startingForm) {
    if(startingForm.dialect &&
        (typeof named === "undefined" ||
          startingForm.dialect.__dialectname === named))
    {
      return startingForm.dialect;
    }
    else if(startingForm.parent) {
      return get_closest_scoped_dialect_for(startingForm.parent);
    }
  }
  return undefined;
}

// read from what may be a single syntax table entry or an array of them
// if an array each entry's read fn is called until one says not to retry
function read_from_syntax_entries(entryOrArray, source) {
  var form = retry_match;
  var entries = Array.isArray(entryOrArray) ? entryOrArray : [entryOrArray];
  for(var i = 0; isretryablematch(form) && i < entries.length; i++) {
    if(!Array.isArray(entries[i].read)) {
      // invoke the read function
      form = read_from_syntax_entry(entries[i], source);
    }
    else {
      var readfnarray = entries[i].read;
      for(var j = 0; isretryablematch(form) && j < readfnarray.length; j++) {
        entries[i].read = readfnarray[j];
        form = read_from_syntax_entry(entries[i], source);
      }
      entries[i].read = readfnarray;
    }
  }
  return form;
}

// read by calling the read fn of the specified single syntax table entry
function read_from_syntax_entry(entry, source) {
  // invoke the read function
  var form = entry.read(source, entry.match);

  // did we get a form back?
  // note: syntax fns return undefined to mean "I don't handle this"
  if(typeof form !== 'undefined') {

    // as a convenience add toJSON where it's missing
    // (need to confirm - are we really making use of this anymore?)
    if(form && !form.toJSON) {
      form.toJSON = function() {
        return sl.toJSON(form);
      }
    }

    // KIND OF A HACK - AM STILL HOPING TO CLEAN UP AND ASSIGN THE SOURCE ON ALL FORMS PROPERLY
    if(!form.sourcer) {
      form.sourcer = source;
    }

    // why is this not in the read_delimited_list function?  can it go there?
    if(!isretryablematch(form) && !isignorableform(form)) {
      source.lastReadFormInList = form;
    }
  }

  return form;
}

function read_from_source(codestr, filenameOrSource, options) {

  options = options || {};
  var source;
  var filename;
  if(filenameOrSource instanceof src.Source) {
     source = filenameOrSource;
     filename = source.filename;
  }
  else {
    filename = filenameOrSource;
  }

  var fileext = utils.getFileExt(filename, "slisp");

  var dialectNames = filetypes[fileext];
  if(!dialectNames) {
    throw new Error(filename + " is not a recognized sugarlisp file type.");
  }

  if(typeof options.autouse === 'undefined' || options.autouse) {
    // then add the others
    for (var i=dialectNames.length; i--; ) {
      var dialectName = dialectNames[i];
      if(dialectName !== 'core') {
        // prepend #uses just as if they'd done it themselves
        // DELETE use_dialect(dialectName, source);
        codestr = '#use "' + dialectName +  '"\n' + codestr;
      }
    }
  }

  if (typeof options.includeComments === 'undefined') {
    options.includeComments = false;
  }

  // wrap in an extra () because the top level may have multiple
  // expressions and/or comments
  // first return just ensures column numbers aren't off by one on first line
  // second return important to make sure a line comment doesn't eat the closing ")"
  if(options.wrapOuterForm !== 'no') {
    codestr = "(\n" + codestr + "\n)\n";
    options.wrapHeadHeight = 1;
    debug("reading wrapped code:", codestr);
  }

  if(!source) {
    // create a Source object per file that holds state
    // e.g. the current position when reading the file
    source = new src.Source(codestr, filename, module.exports, options);
  }

  if(!ctx.source) {
    // make the Source we're reading available via the context
    ctx.source = source;
  }

  // bootstrap the core dialect which everything must have
  use_dialect('core', source);

  // read the form
  var forms = read(source);

  // the current form is used during reading but is no longer
  // valid now that reading is complete:
  source.reading_completed();

  // we often look "up" the lexical nesting of forms...
  // to make this easy/reliable - walk the form tree setting "parent"
  if(options.setParents !== 'no') {
    forms.setParents();
  }

  return forms;
}

/**
* Read the content of the specified filename
* into the specified source file.  If the file has a .js
* extension a string of the js content is returned,
* otherwise the lispy forms are returned.
*
* note: this does *not* expand the expressions read
*  in, that's left up to the downstream processing
*/
function read_include_file(filename, source) {

  var includedForms;
  var foundFile = false;

  var all_dirs = include_dirs.concat([path.dirname(source.filename)]);
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
    source.error('No such include file: ' + filename);
  }
  trace("the include file was found at " + fullPath);

  // assuming we've gotten the source we're reading into...
  if(source) {
    if(!source.included) {
      source.included = [];
    }

    // prevent reading the same include file multiple times
    // (e.g. prevent circular includes)
    if (source.included.indexOf(filename) === -1) {
      source.included.push(filename);
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
    // no source given - read it anyway:
    var code = fs.readFileSync(filename)
    includedForms = read_from_source(code, filename, {wrapOuterForm: true});
  }

  return includedForms;
}

function match_syntax_matcher(matcherOrArray, source) {
  var entry;
  var matched;
  var matcher = Array.isArray(matcherOrArray) ? matcherOrArray[0] : matcherOrArray;
  if(matcher.match instanceof RegExp || typeof matcher.match === 'string') {
    matched = source.on(matcher.match)
  }
  else if(matcher.match instanceof Function) {
    // note that source.on does accept a function but there it's expect to
    // check single characters whereas in the matcher it's expected to be
    // a full blown replacement for matching the front of the source.
    matched = matcher.match(source)
  }
  else {
    source.error("Unknown match type in readrules: " + matcher);
  }

  if(matched) {
    entry = {
      match: matched,
      read: matcher.read
    };
  }
  return entry;
}

/**
* Get the syntax's keys sorted by priority,
* where "priority" is an optional number they can assign
* the syntax entries, otherwise the length of its key
*/
function get_prioritized_matchkeys(syntax) {

  // Provide an easy way to search these from longest to shortest
  var keys = Object.keys(syntax);

  keys = keys.filter(function (value) {
    return(value !== "__readdefault" && value !== "__readdefaulttoken");
  });

  keys.sort(function(a, b) {
    var apri = typeof syntax[a].priority !== 'undefined' ? syntax[a].priority : a.length;
    var bpri = typeof syntax[b].priority !== 'undefined' ? syntax[b].priority : b.length;
    return bpri - apri;
  });

  return keys;
}

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
* Enable the dialect (e.g. "html", "async") within the specified "source" (Source).
*
* Dialects are simply commonjs modules expected to export (at least):
*    syntax (= the read table for handling custom syntax)
*    keywords (javascript code generation and macro functions)
*
* Each Source object keeps a list of the dialect modules enabled via "#use"
* in that particular file, in the reverse order the "#uses" occur.
*
* Returned is the loaded and prepped dialect object
*  (if the dialect requires code output at the point of "#use", the
*   code has been loaded and is available on the property ".onusecode")
*/
function use_dialect(dialectName, source, options) {

  options = options || {};

  // has this dialect already been loaded
  var alreadyLoadedDialect = source.dialects.find(function(dialect) {
    return(dialect.__dialectname === dialectName);
  });

  // they specify options.filelevel = false when they're a "local dialect"
  // or they can pass options.reload to *force* a reload of a dialect
  if(alreadyLoadedDialect &&
    (typeof options.filelevel === 'undefined' || options.filelevel) &&
    !options.reload)
  {
    // but otherwise just give back the previously loaded dialect
    return alreadyLoadedDialect;
  }

  // note there's some circular dependency issues if dialect-loader
  // was loaded at the top of this reader.js file - but that doesn't happen here
  slinfo('using dialect:', dialectName);
  var dialect = options.preloaded || require('./dialect-loader').load(dialectName);
// TEMPORARY HACK TO GET ATOM PREVIEW WORKING?
//console.log('skipping dialect-loader doing straight require of sugarlisp-' + dialectName);
//  var dialect = options.preloaded || require('sugarlisp-' + dialectName);


  // they can specify (optional) init functions at the
  // dialect or the syntax/keyword levels - the naming is like
  // e.g. __html_init:
  var initfnkey = "__" + dialectName + "_init";

  if(alreadyLoadedDialect &&
    typeof options.filelevel !== 'undefined' && !options.filelevel)
  {
    slinfo('cloning local dialect from an already loaded one:', dialectName);

    // this is a local dialect not a file level dialect
    // so make sure they have a clone of the dialect object
    // returned by require.
    dialect = utils.mergeInto({}, dialect);

    // invoke any custom init functions for this new dialect
    invokeInitDialectFunctions(dialect, initfnkey, source, options);

    // and for a local instance of an already loaded dialect
    // this is all we do (yes this is a shallow copy sharing
    // the syntax/keyword etc. tables with the previous.
    return dialect;
  }

  // for debugging it's convenient to have the name visible in the dialect:
  dialect.__dialectname = dialectName;

  // if they do '#use "core"' we take it that they want to
  // *downgrade* the default dialects (which include more
  // than just core) and start over from just core:
// THIS DOESN'T WORK ANYMORE SINCE I STOP THE LOAD ABOVE IF ITS ALREADY LOADED
// I NEED SOME WAY TO DISTINGUISH #use "core" FROM THE "extends" STUFF TO ADD IT BACK
// IT MAY BE LAZY INITIALIZING source.dialects RIGHT NOW BUT THAT IS ALL
  if(dialectName === 'core' || !source.dialects) {
    source.dialects = [];
  }

  // Make sure any dialects this one depends on are loaded first
  // note: the extends feature often leads to modules that assume
  //   the paren-free features of "scripty".  These are sometimes
  //   causing trouble in lispy core files - at least for now
  //   it seems better to just require they fully "#use" *all*
  //   dependent dialects in .slisp files.
  if(source.fileext !== 'slisp' && dialect.extends) {
    var extendsArr = (Array.isArray(dialect.extends) ?
                        dialect.extends : [dialect.extends]);
    extendsArr.forEach(function(dependentDialectName) {
      use_dialect(dependentDialectName, source, options);
    });
  }

  // the syntax and keyword tables are optional:
  dialect.syntax = dialect.syntax || {};
  dialect.keywords = dialect.keywords || {};

  dialect.keywords = dialect.keywords || {};

  // in core only - handlers in the keyword table may
  // have no special (custom) syntax - in that case enter
  // such keywords in the syntax table as symbols (so they
  // don't have to entered there manually).
  // note: this was originally done for *all* the dialects,
  //   but it was leading to "masking" of lower level
  //   dialect's syntax entries.
  if(dialectName === 'core') {
    Object.keys(dialect.keywords).forEach(function(keyword) {
      if(!dialect.syntax[keyword] && keyword !== initfnkey) {
        trace("entering keyword symbol omitted from syntax table:", keyword);
        dialect.syntax[keyword] = symbol;
      }
    });
  }

  // now mark the syntax and keyword handlers so that
  // after merging we still know which dialect they
  // originated in (this is mainly just for debugging)
  Object.keys(dialect.syntax).forEach(function(sym) {
    dialect.syntax[sym].__dialectname = dialectName;
  });
  Object.keys(dialect.keywords).forEach(function(keyword) {
    dialect.keywords[keyword].__dialectname = dialectName;
  });

  // Merge the syntax and keywords from the other dialects into this one,
  // omitting properties if they have the same name (so that this dialect
  // overrides properties of the same name in in't "extends" dialects):

  // note: this is how mixins are traditionally done in javascript
  //   (though see "flight mixin" for a nice alternative).  And this is
  //   also similar to how readtables are handled in Common Lisp - they
  //   copy then modify the current readtable when doing reader macros
  //   to handle custom syntax.

  // note: we merge things such that keys in dialects "#used" later in
  // in the source file win over keys of the same name #used earlier.
  if(typeof options.merge === 'undefined' || options.merge) {
    source.dialects.forEach(function(loadedDialect) {
      if(loadedDialect.syntax) {
        mergeLookupTables(dialect.syntax, loadedDialect.syntax);
      }
      if(loadedDialect.keywords) {
        mergeLookupTables(dialect.keywords, loadedDialect.keywords);
      }
    });
  }

  // cull a short list of just the infix/prefix/suffix operators
  // (that we transform using precedence rules)
  dialect.syntax.__operators = {};
  Object.keys(dialect.syntax).forEach(function(sym) {
    var syntaxentry = dialect.syntax[sym];

    var opSpec = Array.isArray(syntaxentry) && syntaxentry.length > 0 ?
                        syntaxentry[0].operator :
                        syntaxentry.operator;
    if(opSpec) {
      dialect.syntax.__operators[sym] = syntaxentry;
    }
  });
  dialect.syntax.__operatorsymbols = Object.keys(dialect.syntax.__operators);

  // we sort the keys of the syntax table in priority order to ensure that
  // e.g. "<html>" is matched instead of "<", "=>" instead of "=", etc.
  dialect.syntax.__matchkeys = get_prioritized_matchkeys(dialect.syntax);

  // extract the first characters of the keys that terminate tokens,
  // as well as the ones that have been specified to *not* terminate tokens
  var priorDialect = source.dialects.length > 0 ? source.dialects[0] : undefined;
  var priorTerminating = priorDialect ? priorDialect.__terminatingchars : "()\\";
  dialect.__terminatingchars = findTerminatingChars(dialect.syntax, priorTerminating);
  var priorNonterminating = priorDialect ? priorDialect.__nonterminatingchars : "";
  dialect.__nonterminatingchars = findNonterminatingChars(dialect.syntax, priorNonterminating);

  // it makes no sense if there's neither reader nor transpiler extensions though:
  if(!dialect.keywords && !dialect.syntax) {
    source.error("System error: malformed language extension \"" + dialectName + "\"");
  }

  // onuse is an optional file containing js to insert in the output
  // at the point of #use.
  // (this may support lispy code in the future but for now we require js)
  if(typeof options.onusecode === 'undefined' || options.onusecode) {
    if(dialect.onuse) {
      dialect.onusecode = read_include_file(dialect.onuse, source);
    }
  }

  if(typeof options.filelevel === 'undefined' || options.filelevel) {
    // add this dialect to the list of top level dialects for the file
    // note we put this dialect on the *front* since we search
    // front to back i.e. consider earlier in the list to have
    // precedence.
    source.dialects.unshift(dialect);
  }

  // invoke the (optional) initialization functions at each level:
  invokeInitDialectFunctions(dialect, initfnkey, source, options);

  // return the newly loaded and prepped dialect
  return dialect;
}

/**
* Register a dynamic transform so that we know (unlike most
* transforms) that the specification of transform function,
* precedence level, etc. will be gotten from the form returned
* by the specified syntax handler function - dynamically at
* read time.  optype is one of 'unary' or 'binary'.
*/
function registerDynamicTransform(optype, syntaxfn) {
  syntaxfn.operator = { type: optype, style: 'dynamic'}
}

function invokeInitDialectFunctions(dialect, initfnkey, source, options) {
  if(dialect[initfnkey]) {
    dialect[initfnkey](source, dialect, options);
  }
  if(dialect.syntax[initfnkey]) {
    dialect.syntax[initfnkey](source, dialect, options);
  }
  if(dialect.keywords[initfnkey]) {
    dialect.keywords[initfnkey](source, dialect, options);
  }
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
function mergeLookupTables() {

  // there are certain keys we don't want to merge
  // (there's places in the code that will blow of up if they are)
  var exclude = [
    "__readdefault",
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

// copy from (which might be an array or not) into array toArray
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
      if((key !== "__readdefault" && key !== "__readdefaulttoken") &&
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

/**
* Terminating characters mark the end of tokens
*
* Normally we infer terminating characters from the first
* characters of the keys in your syntax (other than alphanumeric
* ones of course).
*
* But some characters may be read internally by a read function
* without using a syntax entry at all.  In that case putting an
* entry in the syntax with the value "reader.terminating" forces
* (it's first character) to be "terminating".
*/
function unexpected(source) {
  source.error("unexpected \"" + source.peek_char() + "\" encountered (is something missing before this?)");
}

/**
* A symbol
* They can use reader.symbol in their syntax table to ensure the lexer
* scans the specified token text correctly as a symbol
*/
function symbol(source, text) {
  var token = source.next_token(text);
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
  return function(source, text) {
    var token = source.next_token(text);
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
* note: you can pass and atom or symbol string, but if you pass a
*   string you must provide the dialect as well.
*/
function getOperatorSpecFor(atomOrStr, dialect) {

  var opSpec;

  var atom = typeof atomOrStr !== 'string' ? atomOrStr : undefined;
  var str = typeof atomOrStr === 'string' ? atomOrStr : undefined;
  dialect = dialect || (atom ? get_current_dialect(sl.sourceOf(atom)) : undefined);
  var sym = str || sl.valueOf(atom);

  // make sure and check the atom first - it takes precedence
  if(atom) {
    // was this form "dynamically" marked as needing to be transformed?
    opSpec = atom.operator;
  }

  if(!opSpec) {
    // no - was it "statically" marked i.e. by it's symbol?
    if(dialect.syntax.__operatorsymbols.indexOf(sym) !== -1) {
      var syntaxfn = (!Array.isArray(dialect.syntax.__operators[sym]) ?
                          dialect.syntax.__operators[sym] :
                          dialect.syntax.__operators[sym][0]);
      opSpec = syntaxfn.operator;
    }
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
      sl.sourceOf(atom).error("Malformed operator precedence specification for " + sym);
    }
  }

  return opSpec;
}

/**
* operator symbol which (along with it's arguments) gets transformed
* in the forms tree after the reader has parsed the entire source.
*
* Infix and unary operators are examples of these.
*
* readfn is the function which will do the transformation to the
* forms tree.  It expects args like e.g.:
*
*    function //prefix(operatorform, opts) ...
*
* Precedence levels set the order these operations get transformed,
* where lower levels are performed first (see
*   e.g. https://www.wikiwand.com/en/Order_of_operations).
*
* The opts are optional - if given they allow you to specify
* options at "setup time" that will be passed into the readfn
* later.
*/
function operator(optype, argtype, readfn, precedence, opts) {
  opts = opts || {};
  // the read function for all the operators just reads their symbol:
  var syntaxfn = function(source, text) {
    // operators e.g. "--" need to return from e.g. "--x" even
    // though the "-" has been defined as a non-terminating
    // character (maybe this can be simplified!!??)
    var token = source.next_token(text, {matchPartial: true});
    return sl.atom(text, {token: token});
  };
  if(typeof optype === 'string') {
    syntaxfn.operator = {
      type: optype,
      argtype: argtype,
      read: readfn,
      precedence: precedence,
      assoc: opts.assoc,
      options: opts
    };
  }
  else if(typeof optype === 'object') {
    // this is an operator that is e.g. prefix and postfix,
    var opSpecObj = optype;
    syntaxfn.operator = {
      infix: (optype.infix && optype.infix.operator ?
                  optype.infix.operator :
                  optype.infix),
      prefix: (optype.prefix && optype.prefix.operator ?
                  optype.prefix.operator :
                  optype.prefix),
      postfix: (optype.postfix && optype.postfix.operator ?
                  optype.postfix.operator :
                  optype.postfix)
    };
  }
  return syntaxfn;
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

function infix2prefix(source, opSpec, leftForm, opForm) {
  // To handle right-associative operators like "^", we allow a slightly
  // lower precedence when parsing the right-hand side. This will let an
  // operator with the same precedence appear on the right, which will then
  // take *this* operator's result as its left-hand argument.
  var rightForm = read(source,
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
* source actually uses - e.g. "!x" could be translated as "(not x)".
*/
function prefix(precedence, opts) {
  return operator('prefix', 'unary', prefix2expr, precedence, opts);
}

function prefix2expr(source, opSpec, opForm) {
  var rightForm = read(source, opSpec.precedence);

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

function postfix2prefix(source, opSpec, leftForm, opForm) {

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
*       in the source code.
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
*       read.  The function receives the source, and the newly
*       read list of forms.
*
* @returns a form list just the same as if they'd entered parens
*       explicitly as a true lispy s-expression.
*/
function parenfree(arity, options) {
  options = options || {};
  return function(source) {
    var token = source.next_token();
    var fnName = options.alternate || token.text;
    var formlist = sl.list(fnName);
    formlist.setOpening(token);

    while(formlist.length < arity + 1) {
      var nextform;
      if(options.parenthesized && options.parenthesized === formlist.length) {
        // "wrapped" here because something like (true) returns simply "true"
        nextform = read_wrapped_delimited_list(source, '(', ')');
      }
      // note brackets are *optional* if there's a single expression body
      else if(options.bracketed && options.bracketed === formlist.length
        && source.on('{'))
      {
        nextform = read_delimited_list(source, '{', '}');
        formlist.pushFromArray(nextform);
        nextform = undefined;  // we've added the forms so no need to below
      }
      else {
        nextform = read(source);
      }

      // some directives" don't return an actual form:
      if(nextform && !isignorableform(nextform)) {
        formlist.push(nextform);
      }
    }

    if(options.validate) {
      options.validate(source, formlist);
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
* read a list of atoms and/or other lists surrounded by delimiters (), [], etc.
* start is the expected opening delimiter as a string (or an existing start token
* if the opening delimiter has already been read)
* end is the expected end delimiter as a string
* initial is an optional array containing values prepopulated in the list
* separatorRE is an optional RE for "separators" to be skipped e.g. /,/
*/
function read_delimited_list(source, start, end, initial, separatorRE) {
    start = start || '(';
    end = end || ')';
    separatorRE = separatorRE || /,+/g;
    var startToken = (start && typeof start === 'string' ? source.next_token(start) : start);

    var list = (initial && sl.isList(initial) ? initial : sl.listFromArray(initial || []));
    list.setOpening(startToken);

    // starting a new list
    delete source.lastReadFormInList;
    var token;
    while (!source.eos() && (token = source.peek_token()) && token && token.text !== end) {
      var nextform = read(source);

      // some "directives" don't return an actual form:
      if(!isignorableform(nextform)) {
        list.push(nextform);
      }

      // if they gave a separator (e.g. commas)
      if(separatorRE && source.on(separatorRE)) {
        source.skip_text(separatorRE); // just skip it
      }
    }
    if (!token || source.eos()) {
        source.error("Missing \"" + end + "\" ?  (expected \"" + end + "\", got EOF)", startToken);
    }
    var endToken = source.next_token(end); // skip the end token
    list.setClosing(endToken);

// IF THIS IS HERE IT HAS TO BE SMARTER - IT WAS ELIMINATING THE TOP LEVEL PAREN wrapper
// (AROUND THE WHOLE FILE) AND CAUSING PROBLEMS
// WOULDNT IT ALSO ELIMINATE A NO-ARG CALL?  SOMETHING LIKE (obj.run) ?
    // we can get extra parens when e.g. the user used parens around
    // an infix expression (which the reader reads as a nested list)
    // if(list.length === 1 && sl.isList(list[0])) {
    //   list = list[0];
    // }

    // in a lispy file they use parens whereas paren-free in a scripty file
    if(list.length === 1 && sl.isList(list[0])
      && list[0].__parenoptional && source.fileext === 'lispy')
    {
      // so here we have to *remove* what's otherwise *extra* parens:
      list = list[0];
    }

    source.lastReadList = list;

    return list;
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
function read_wrapped_delimited_list(source, start, end, initial, separatorRE) {

  var list = read_delimited_list(source, start, end, initial, separatorRE);
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
* source.options.omitDelimiters = whether to include the include the delimiters or not
*/
function read_delimited_text(source, start, end, options) {
  options = options || {includeDelimiters: true};
  var delimited = source.next_delimited_token(start, end, options);
  return sl.atom(delimited);
}

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
  return function(source, text) {

    var token = source.create_token(text);
    source.skip_text(text);

    if(!source.lastReadFormInList) {
      // already in prefix position since it's first in the list!
      return sl.atom(text, {token: token});
    }

    // the arguments are the prior form then next form...
    // pull in the prior form (which has already been read)
    // we don't *delete* it from parent - that would leave a gap in the array indices!
    // instead we *replace* the prior form with our new binary operation form
    var priorform = source.lastReadFormInList;
    var priorformPos;
    var priorParent = priorform.parent;

    // if we don't have an alternate, we assume the operator
    // is what we're assigned to in the syntax table:
    var formlist = sl.list(altfname||text);
    formlist.setOpening(token);

    if(priorParent) {
      priorformPos = priorParent.indexOf(priorform);
      if(priorformPos === -1) {
        source.error("could not convert infix \"" + text + "\" to prefix (invalid prior form)");
      }

      formlist.push(priorform);  // note this changes the parent to our new list

      while(!source.eos() && formlist.length < 3) {
        var nextform = read(source);
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
      source.error("could not convert infix \"" + text + "\" to prefix (parent form is required)");
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
var ignorable_form_key = "___%%LSFORM_IGNORE%%___";
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
* can return "reader.retry_match" to indicate that they
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
var retry_match_key = "___%%LSRETRY_MATCH%%___";
var retry_match = sl.atom(retry_match_key);
function isretryablematch(form) {
  return form && sl.valueOf(form) === retry_match_key;
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
*   left-to-right/top-to-bottom order of the original source
*/
function finddeep(forms, predicatefn, pos, container, parentDialect) {

  pos = pos || 0;
  parentDialect = parentDialect || get_current_dialect(sl.sourceOf(forms));

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
exports.read_include_file = read_include_file;
exports.read_delimited_list = read_delimited_list;
exports.read_wrapped_delimited_list = read_wrapped_delimited_list;
exports.read_delimited_text = read_delimited_text;

// dialects
exports.get_current_dialect = get_current_dialect;
exports.get_closest_scoped_dialect_for = get_closest_scoped_dialect_for;

// other
exports.get_syntaxtable_entry = get_syntaxtable_entry;
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
exports.retry_match = retry_match;
exports.isretryablematch = isretryablematch;
exports.use_dialect = use_dialect;
exports.gen_var_name = gen_var_name;
exports.parenfree = parenfree;
exports.finddeep = finddeep;
