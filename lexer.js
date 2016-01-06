/**
* An instance of "Lexer" creates and categories text tokens
* from the source.
*
* There are really two levels of functions, one that works at
* the chararter level, the other at the "word" i.e. "token"
* level.
*
* In both cases you can "peek" ahead before truly consuming
* the character or token (if you need to).  You can also
* tentatively mark a "rewind point", scan ahead, and get
* back to where you were if something goes wrong (useful
* for looking ahead to resolve ambiguity then trying again
* with an alternative interpretation).
*/
var utils = require('./utils'),
    debug = require('debug')('sugarlisp:core:lexer:debug'),
    trace = require('debug')('sugarlisp:core:lexer:trace');

/**
* A Lexer for the source text we are scanning
*
* note:  Lexer has been done as a javacript prototypal
*   class with instances that hold all state for a
*   given source file as it's being read and transpiled.
*   This is in contrast to the other sugarlisp modules
*   which are pretty much stateless collections of
*   functions.  The main exception to this is the
*   "transpiler-context" which is the non-source-file
*   related state of the transpiler (essentially a
*   "singleton").
*/
function Lexer(sourcetext, filename, options) {
  options = options || {};
  this.options = options || {};
  this.dialects = []; // the "stack" dialects are pushed/popped from
  if(filename) {
    this.filename = filename;
    this.fileext = utils.getFileExt(filename, "sugar");
  }
  this.set_source_text(sourcetext);
}

/**
* Change the source text being lexed on an already created lexer.
*
* note:  normally the source text is passed into the Lexer
*   constructor and you just make a new Lexer for each file
*   being transpiled.  This alternative is used e.g. by the repl
*   where to maintain the Lexer's list of active dialects across
*   the evaluation of multiple "sourcetext" lines being entered
*   by the repl user.
*
* @param sourcetext = the new source text to start lexing.
*/
Lexer.prototype.set_source_text = function(sourcetext, options) {

  if(options) {
// DELETE utils.mergeOnto(this.options, options);
    this.options = options;
  }

  this.text = sourcetext;

  // most of our "state" is no longer valid if/when the source text changes...
  this.position = 0;
  this.lineStartPosition = 0;
  this.line = 0;

  if(this.options.wrapOuterForm !== 'no') {
    // wrap in an extra () because the top level may have multiple
    // expressions and/or comments
    // first return just ensures column numbers aren't off by one on first line
    // second return important to make sure a line comment doesn't eat the closing ")"
    var wrapHeader = this.options.wrapHeader || "(\n";
    var wrapFooter = this.options.wrapFooter || "\n)\n";
    this.text =  wrapHeader + this.text + wrapFooter;
    // but the user doesn't see these added wrapper lines, so
    // adjust the line numbers (as seen e.g. in error messages):
    this.line -= (this.options.wrapHeadHeight ? this.options.wrapHeadHeight : 0);
  }

  debug("lexer reading:", this.text);

  this.col = 0;
  this.preludeStartPosition = 0;
  this.tokenStartPosition = 0;
  this.tokenLineStartPosition = 0;
  this.tokenStartLine = 0;
  this.tokenStartCol = 0;
  this.lastToken = undefined;
  this.lastChar = undefined;
  this.rewindPoints = [];
  this.included = [];
  this.cells = [];
  this.bindingCode = {before: {}, after: {}};
  this.tokenDump = [];
  delete this.peekedToken;
}

/**
* Fetch the next character from the source.
* Returns undefined at the end of the source text
* note:  all char fetches need to happen through this function
*        in order to keep the line and column numbers correct
*/
Lexer.prototype.next_char = function(len) {
  var text = "";
  len = len || 1;
  while(len > 0 && this.position < this.text.length) {
    // we remember the last character read for doing "look back"
    this.lastChar = this.text[this.position];
    //trace("char:", this.lastChar, "line:", this.line, "col:", this.col);
    text += this.lastChar;
    this.position++;
    this.col++;
    if(this.lastChar == '\n') {
      this.lineStartPosition = this.position;
      this.line++;
      trace('starting line:', this.line);
      this.col = 0;
    }
    len--;
  }
  return text;
}

/**
* Peek at the current character without actually fetching it.
* lookahead is the number of characters ahead to peek (default is 0)
* Returns undefined at the end of the source text
*/
Lexer.prototype.peek_char = function(lookahead) {
  var ch;
  lookahead = lookahead || 0;
  if((this.position + lookahead) < this.text.length) {
    ch = this.text[this.position + lookahead];
  }
  return ch;
}

/**
* Skip the chars expected token at the current position
* expected = a length, a string, or a regex
* return the text that was skipped
*
* note:  this is a *low level* skip function so use with
*  care, e.g. it does *not* skip whitespace following the
*  chars that you skip, which could break subsequent
*  code if it assumes otherwise.  for these reasons you
*  should typically use skip_text() not skip_char().
*/
Lexer.prototype.skip_char = function(expected) {
  var len;
  expected = expected || 1;
  if(typeof expected === 'number') {
    len = expected;

    trace("skipping", len, "characters");
  }
  else if(typeof expected === 'string') {
    len = expected.length;
    trace("expected token:", expected);
  }
  else if(expected instanceof RegExp) {
    var matched = this.on(expected);
    if(matched) {
      len = matched.length;
      trace("skipping", len, "characters");
    }
    else {
      this.error('Could not skip anything matching ' + expected, this);
    }
  }
  else {
    this.error("Lexer.skip passed something not an integer, string, or regex", this);
  }

  return this.next_char(len);  // skip this many characters
}

/**
* Mark the beginning of a token
*/
Lexer.prototype.mark_token_start = function() {
  trace("mark_token_start:  the next token will start at: " + this.position);
  this.tokenStartPosition = this.position;
  this.tokenLineStartPosition = this.lineStartPosition;
  this.tokenStartLine = this.line;
  this.tokenStartCol = this.col;
}

Lexer.prototype.get_current_prelude = function(consume) {
  var prelude = this.preludeStartPosition < this.tokenStartPosition ?
        this.text.substring(this.preludeStartPosition, this.tokenStartPosition) :
        undefined;

  if(prelude) {
    // remove leading/trailing spaces/tabs/semicolons/commas (but not newlines)
    prelude = prelude.replace(/^[\ \t\;,]+|[\ \t\;,]+$/g,'');

    // the special line comment //-- is *not* sent thru to the output
    prelude = prelude.replace(/\/\/--\s(?:.*)\n/g,'');
  }

  if(consume) {
    // they're getting the prelude to make use of it
    // and so want it "consumed" so it's not returned again:
    this.preludeStartPosition = this.tokenStartPosition;
  }

  return prelude;
}

/**
* Create and return a "token" i.e. some "categorized" source text.
* In addition our token object holds metadata about where in the
* source the token was found (important for generating source maps).
*
* Normally the token is the text between when mark_token_start was called
* and the current position, unless the "text" argument is passed (in which
* case the provided text will be used as the token text).
*
* The category is also optional - if not passed the default token
* category is "symbol".
*/
Lexer.prototype.create_token = function(text, category) {
  var category = category || "symbol";
  var text = text || this.text.substring(this.tokenStartPosition, this.position);

  function maketoken(text, category, filename, line, col, lineStartPosition, preludeText) {

    debug('creating "' + category + '" token: ' + text);
    trace('    (line: ' + line + ', col: ' + col +
                (preludeText ? ', prelude: ' + preludeText : '') + ')');

    var token = {
      text: text,
// FOR ME *ATOMS* HAVE VALUES - DELETE LATER: value: text,
      category: category,
      filename: filename,
      line: line,
      col: col,
      lineStartPosition: lineStartPosition,
      __istoken: true
    };
    if(preludeText) {
      token.prelude = preludeText;
    }
    return token;
  }

  var token = maketoken(text, category, this.filename,
                    this.tokenStartLine, this.tokenStartCol,
                    this.tokenLineStartPosition,
                    this.get_current_prelude());

  // prep for the next token in line
  // (e.g. skip trailing whitespace and/or comments)
  this.advance_to_next_token();

  // remember the last created_token for doing "look back"
  this.lastToken = token;

  // if they've asked for a dump of all the tokens
  if(this.options.to && this.options.to.indexOf('tokens') !== -1) {
    var lastDumped = this.tokenDump.length > 0 ?
                        this.tokenDump[this.tokenDump.length-1] :  undefined;
    if(!lastDumped ||
      (lastDumped.line !== token.line || lastDumped.col !== token.col))
    {
        this.tokenDump.push(token);
    }
  }

  return token;
}

/**
* A utility method to advance over comments and white space to
* prepare for reading the next token.
* note: this is normally called automatically when a token is
*   read but there may be occasions to call it explicitly.
*/
Lexer.prototype.advance_to_next_token = function() {
  trace("Setting prelude start pos for the *next* token to:", this.position);
  this.preludeStartPosition = this.position; // the filler starts here
  this.skip_filler();

  // now we're on a meaningful character...
  this.mark_token_start();
}

/**
* Mark a rewind point at the current position
* This is used at the beginning of some ambiguous grammar that requires lookahead
* We mark the rewind point, attempt to parse the first way,
* and if that fails we rewind and try and parse another way.
*
* Note: think of this as analogous to starting a transaction
*/
Lexer.prototype.mark_rewind_point = function() {

  var marker = {
    position: this.position,
    lineStartPosition: this.lineStartPosition,
    line: this.line,
    col: this.col,
    preludeStartPosition: this.preludeStartPosition,
    tokenStartPosition: this.tokenStartPosition,
    tokenLineStartPosition: this.tokenLineStartPosition,
    tokenStartLine: this.tokenStartLine,
    tokenStartCol: this.tokenStartCol,
    lastToken: this.lastToken,
    lastChar: this.lastChar
  };
  this.rewindPoints.push(marker);
}

/**
* "Commit" to the last rewind point (i.e. you will not be rewinding to it)
* This should be called once the potential ambiguity has been resolved.
* It's especially important with nesting so that the inner construct does
* not leave behind a rewind point that breaks outer one.
*
* Note: think of this as analogous to committing a transaction
*/
Lexer.prototype.commit_rewind_point = function() {
  this.rewindPoints.pop();
}

/**
* Move the current position back to where it was on the last
* call to mark_rewind_point
*
* Note: think of this as analogous to rolling back a transaction
*/
Lexer.prototype.rewind = function() {
  var marker = this.rewindPoints.pop();
  this.position = marker.position;
  this.lineStartPosition = marker.lineStartPosition;
  this.line = marker.line;
  this.col = marker.col;
  this.preludeStartPosition = marker.preludeStartPosition;
  this.tokenStartPosition = marker.tokenStartPosition;
  this.tokenStartLine = marker.tokenStartLine;
  this.tokenStartCol = marker.tokenStartCol;
  this.lastToken = marker.lastToken;
  this.lastChar = marker.lastChar;
  trace('rewound to line:', this.line, 'col:', this.col);
  trace("prelude pos is back to:", this.preludeStartPosition);
}

// Are we at the "end of source"?
Lexer.prototype.eos = function(lookahead) {
  lookahead = lookahead || 0;
  return ((this.position + lookahead) >= this.text.length);
}


/**
* is the source currently sitting on something expected?
*
* @param expected = a string, regex, character predicate function, or
* an array of these (i.e. is the source on any of what's in the array?).
* @param matchPartial = allow matching part of a token (by default
* we require the match end at a reasonable token boundary)
* @return the matched text if a match was found, otherwise false
*
* Note about regexes: Due to limitations in how regexes work when
* matching into the middle of our source text, you must use a global
* match by ending your regex "/g", and you should not start your
* regex with "^".
*/
// COULD I ELIMINATE THIS MATCHPARTIAL BUSINESS?  TRYING IT OUT...
Lexer.prototype.on = function(expected, matchPartial) {

  if(this.eos()) {
    return false;
  }

  var matched = false;

  if(Array.isArray(expected)) {
    for(var i=0; i < expected.length; i++) {
      var result = this.on(expected[i],matchPartial);
      if(result) {
        return result;
      }
    }
  }
  else if(expected instanceof RegExp) {
    // regex'ing text from other than the beginning is tricky...
    // the regex must be "global" i.e. end with "/g"
    // and seemingly it should *not* start with the ^
    // plus we must set lastIndex before *each* exec
    expected.lastIndex = this.position;
    matched = expected.exec(this.text);
    if(matched && matched.index === this.position) {
      // return the text that was matched
      if(matched.length > 1) {
        // they had a group
        matched = matched[1];
      }
      else {
        // no group
        matched = matched[0];
      }
    }
    else {
      matched = false;
    }
    // this has to be awful performance on a large file though:
    // (considering this will happen repeatedly)
    // maybe change it to a function and don't even do the regex if
    // the first digit isn't a number?
    // matched = expected.test(this.text.substring(this.position));
  }
  else if(typeof expected === 'string') {
    matched = true;
    for(var i=0;matched && i<expected.length;i++) {
      if(this.peek_char(i) !== expected.charAt(i)) {
        matched = false;
      }
    }
    if(matched) {
      matched = expected;
    }
  }
  else if(typeof expected === 'function') {
    matched = true;
    var text = "";
    for(var i=0;matched && i<expected.length;i++) {
      var ch = this.peek_char(i);
      if(!expected(ch)) {
        matched = false;
      }
      text += ch;
    }
    if(matched) {
      matched = text;
    }
  }
  else {
    this.error("Unexpected type passed for 'expected' in lexer.on: " + expected, this);
    matched = false;
  }

/*
TRYING WITHOUT THIS MATCHPARTIAL BUSINESS WOULD LIKE TO SIMPLIFY AND DELETE
  if(matched && !matchPartial) {
    // we matched, but are we on a token boundary?
    if(!this.onterminatingchar(matched.length-1) &&
         (!this.eos(matched.length) && !this.onterminatingchar(matched.length))) {
      matched = false;  // this had matched the start of some text with no terminator
    }

  }
*/
  return matched;
}

/**
* assert what the next token should be, otherwise throws
*/
Lexer.prototype.assert = function(expected, error) {

  // skip leading whitespace or comments...
  this.skip_filler();

  var matched = this.on(expected);
  if (!matched) {
    this.error('Expected "' + expected + '" but found "' +
      this.text.substring(this.position, this.position+5) + '...""' +
      (error ? " - " + error : ""), this);
  }
}

/**
* skip text from the current position till the specified end
* returned is the text that was skipped
* end = string or regex (see the "on" function for details)
* includeEnd = whether to include "end" in the returned token
* note if you "includeEnd" you also "skip" the end.
*/
Lexer.prototype.skip_text_till = function(end, includeEnd) {
  var text = "";
  this.mark_token_start();

  var matched;
  while(!this.eos()) {
    matched = this.on(end);
    if(!matched) {
      text += this.next_char();
    }
    else {
      break;
    }
  }

  if(includeEnd) {
    text += matched;
    this.skip_text(end);
  }

  return text;
}

/**
* get the remaining text from the current position till the end of source
*/
Lexer.prototype.rest_of_text = function() {
  var text = "";
  while(!this.eos()) {
    text += this.next_char();
  }
  return text;
}

/**
* scan a token from the current position till the specified end
* returned is a token for the text that was scanned
* end = string or regex (see the "on" function for details)
* includeEnd = whether to include "end" in the returned token
* note if you "includeEnd" you also "skip" the end.
*/
Lexer.prototype.till = function(end, includeEnd) {
  return this.create_token(this.skip_text_till(end, includeEnd));
}

/**
* push a dialect so it becomes the "current" one.
*/
Lexer.prototype.push_dialect = function(dialect) {
  // note: unshift below since we search the dialects starting from 0
  this.dialects.unshift(dialect);
  update_std_category_REs(this);
  delete this.peekedToken;
}

/**
* pop a dialect when the end of it's scope is reached
* @params dialectName (optional) the name of the dialect to remove,
*   otherwise the most recently pushed dialect is removed.
* @return the no longer active dialect
*/
Lexer.prototype.pop_dialect = function(dialectName) {
  var removedDialect;
  if(!dialectName || this.dialects[0].name === dialectName) {
    // note: unshift below since we search the dialects starting from 0
    removedDialect = this.dialects.shift();
  }
  else {
    var index = this.dialects.findIndex(function(dialect) {
      return dialect.name === dialectName;
    });
    if(index !== -1) {
      var removed = this.dialects.splice(index, 1);
      removedDialect = removed[0];
    }
  }

  update_std_category_REs(this);
  delete this.peekedToken;
  return removedDialect;
}

/**
* utility function grabs the 'whitespace', 'linecomment', and
* 'punctuation' regexes whenever a dialect is pushed/popped.
*
* note: this is really just a performance optimization since
*   these regexes are used so much.
*/
function update_std_category_REs(lexer) {
  lexer.whitespaceREs = regexes_for_category(lexer, 'whitespace');
  lexer.linecommentREs = regexes_for_category(lexer, 'linecomment');
  lexer.punctuationREs = regexes_for_category(lexer, 'punctuation');
}

/**
* utility function accumulates all the regular expressions
* for a given token category and returns them in an array
*/
function regexes_for_category(lexer, category) {
  var REs = [];
  var done = false;
  for(var i = 0; !done && i < lexer.dialects.length; i++) {
    var dialect = lexer.dialects[i];
    if(dialect.lextab) {
      var categoryentry = dialect.lextab.find(function(lextabentry) {
         return lextabentry.category == category;
      });
      if(categoryentry) {
        REs.push(categoryentry.match);

        // if they've set entry.replace=true this dialect's
        // entry replaces other dialects' entries:
        done = categoryentry.replace;
      }
    }
  }
  return REs;
}

/**
* is the source sitting on a char matching a specified token category?
*/
function oncharincategory(lexer, lookahead, categoryREs) {
  var c = lexer.peek_char(lookahead);
  return categoryREs.find(function(re) {
    // because we're matching a single char...
    re.lastIndex = 0; // make sure we start from the start
    return re.test(c);
  });
}

/**
* is the source sitting on punctuation?
* (where "punctuation" is a token category in the lextabs)
*/
Lexer.prototype.onpunctuation = function(lookahead) {
  return oncharincategory(this, lookahead, this.punctuationREs);
}

/**
* is the source sitting on white space?
* (where "whitespace" is a token category in the lextabs)
*/
Lexer.prototype.onwhitespace = function(lookahead) {
  return oncharincategory(this, lookahead, this.whitespaceREs);
}

/**
* skip whitespace at the current position (if any)
*/
Lexer.prototype.skip_whitespace = function() {
  while(!this.eos() && this.onwhitespace()) {
    this.next_char();
  }
}

/**
* scan whitespace and return it as a token
*/
Lexer.prototype.whitespace = function() {
  var white = "";
  this.mark_token_start();

  while(!this.eos() && this.onwhitespace()) {
    white += this.next_char();
  }
  return this.create_token(white);
}

/**
* skip a comment at the current position (if any)
*/
Lexer.prototype.skip_comment = function() {
  if(!this.eos()) {
    if(this.on(this.linecommentREs, true)) {
      this.skip_text_till('\n', true);
    }
    if(this.on('/*')) {
      this.skip_text_till('*/', true);
    }
  }
}

/**
* skip whitespace or comments at the current position
*/
Lexer.prototype.skip_filler = function() {
  var startingAt = this.position;

  this.skip_whitespace();
  this.skip_comment();

  // did we skip something?
  if(startingAt != this.position) {
    // is there *more* whitespace or *another* comment?
    this.skip_filler();
  }
}

/**
* Is the source sitting on one of our terminating chars?
* "terminating chars" meaning a char that matches the
* currently active dialect's lextab definition(s) for
* "whitespace" and/or "punctuation".
*
* Note: Common Lisp has a notion of "terminating" and
*   "nonterminating" characters but here I've attempted
*   to simplify a bit.
*/
Lexer.prototype.onterminatingchar = function(lookahead) {
  return this.onwhitespace(lookahead) || this.onpunctuation(lookahead);
}

/**
* Throw an error message and show it's location in the source file.
* locator = a form or token object (i.e. something with "line" and "col")
*/
Lexer.prototype.error = function(msg, locator) {
  throw new Error(this.message_src_loc(msg,locator));
}

/**
* Display a message and show it's location in the source file.
* locator = a form or token object (i.e. something with "line" and "col")
*/
Lexer.prototype.message_src_loc = function(msg, locator, options) {
  locator = locator || {};
  options = options || this.options || {};
  var filename = locator.filename || this.filename;
  var lineStartPosition = locator.lineStartPosition || this.lineStartPosition;
  var col = locator.col || this.col;
  var line = locator.line || this.line;

  // imitating node's error format here:
  var filemsg = (typeof options.file === 'undefined' || options.file) ?
                  (filename + ":" + line + "\n") : "";
  return filemsg +
          this.line_with_caret(lineStartPosition, col) +
          (msg && msg !== "" ? "\n" + msg : "");
}

/**
* Extract the line starting at the specified position, with
* a caret beneath the specified column location.
*/
Lexer.prototype.line_with_caret = function(lineStartPosition, column) {

  var srcline = "";
  var pos = lineStartPosition;
  var ch;
  while(pos < this.text.length && (ch = this.text.charAt(pos)) && ch !== '\n') {
    srcline += ch;
    pos++;
  }

  var caretline = " ".repeat(column) + "^";

  return "\n" + srcline + "\n" + caretline;
}

// Token based (whereas the above functions are character based)

/**
* Read the next token (and optionally specify a string or regex matching
* what you expect the token to be
*/
Lexer.prototype.next_token = function(expected, options) {
  var token;
  var error;
  var matchPartial;

  if(this.eos()) {
    return undefined;
  }

// THIS MATCHPARTIAL BUSINESS IS BEING REMOVED SO
// THIS SECTION SHOULD BE ABLE TO BE DELETED AS WELL!!??
  // this is a little tricky since we originally just
  // took an optional "error" string as second arg.
  // should clean this up later...
  if(options) {
    if(typeof options === 'object') {
      error = options.error;
      matchPartial = options.matchPartial;
    }
    else if(typeof options === 'string') {
      error = options;
    }
  }

  // skip leading whitespace or comments...
  this.skip_filler();
  this.mark_token_start();

  if(expected instanceof RegExp || typeof expected === 'string') {
    var matched = this.on(expected, matchPartial);
    if(matched) {
      // did we previously peek this token?
      var previouslyPeeked = this.getPeekedToken(matched);
      if(previouslyPeeked) {
        // here the lextab category for the peeked token is returned
        // (which wouldn't be true otherwise - note we haven't hit the lextab)
        return previouslyPeeked;
      }

      // otherwise we know exactly what to read
      // (though we don't know the category - defaults to "symbol")
      this.next_char(matched.length);  // advance the current position
      token = this.create_token(matched);
    }
    else {
      var foundToken = this.peek_word_token();
      var foundText = foundToken.text;
      var firstCh = foundText.charAt(0);
      if(firstCh !== '"' && firstCh !== "'") {
        foundText = '"' + foundText;
      }
      var lastCh = foundText.charAt(foundText.length-1);
      if(lastCh !== '"' && lastCh !== "'") {
        foundText = foundText + '"';
      }
      this.error('Expected "' + expected + '" but found ' + foundText + "..." +
                    (error ? " - " + error : ""), this);
    }
  }
  else {
    // they gave nothing to expect - the lextab is our guide
    // to what the next token should be
    token = next_lextab_token(this);
  }

  if(!this.peeking && token) {
    debug('next token is "' + token.text +
      '" (line: ' + token.line + ', col: ' + token.col + ')');
  }

  return token;
}

/**
* Get the next token under the current source position according
* to the lextab entries of the current dialects.
*/
function next_lextab_token(lexer) {

  var token;

  if(lexer.eos()) {
    return undefined;
  }

  // skip leading whitespace or comments...
  lexer.skip_filler();

  var previouslyPeeked = lexer.getPeekedToken();
  if(previouslyPeeked) {
    return previouslyPeeked;
  }

  lexer.mark_token_start();
  trace(lexer.message_src_loc("", lexer, {file:false}));

  // try and match all token categories except punctuation (and
  // the default handler).  Note that single character punctuation
  // should take a back seat to longer symbols e.g. '...' should
  // match before '.'.
  token = match_in_lextabs(lexer, {omit: ['punctuation','default']});
  if(!token) {
    // okay now try again matching punctuation characters.
    token = match_in_lextabs(lexer, {include: ['punctuation']});
  }
  if(!token) {
    // ok go ahead and try any default handler(s)
    token = match_in_lextabs(lexer, {include: ['default']});
  }

  // we expect they will use an explicit default lextab entry, but JIC:
  if(!token) {
    trace('their lextab has no default handler - defaulting to next word');
    token = lexer.next_word_token();
    if(token) {
      token.category = 'symbol';
    }
  }

  return token;
}

/**
* Helper function returns a token for the source text
* under the current position based on the nearest match
* in the active dialect's lextabs.
*
* You can optionally omit specified token categories from consideration
* ("options.omit"), or include only specified token categories for
* consideration ("options.include").
*
* You can also use the word "default" in options.omit/options.include
* to refer to default lextab entries indicated with "default: true"
*/
function match_in_lextabs(lexer, options) {
  options = options || {};
  var token;
  var replaced = {};

  // for each dialect's lextab...
  for(var d = 0; !token && d < lexer.dialects.length; d++) {
    var dialect = lexer.dialects[d];
    if(!dialect.lextab) {
      continue; // no lextab for the dialect so move on
    }

    // check each entry in order...
// NOTE I AM IGNORING THE 'PRIORITY' PROPERTY RIGHT NOW - MAYBE I CAN DELETE THEM!?
    debug('matching in ' + dialect.name + ' lextable');
    for(var l = 0; !token && l < dialect.lextab.length; l++) {
      var entry = dialect.lextab[l];

      // we don't match tokens against "replaced" categories
      if(!replaced[entry.category] &&
        // and if they've specified categories to include...
        (!options.include ||
          // only consider those
          (options.include.contains(entry.category) ||
          (options.include.contains("default") && entry.default))) &&
        // or if they've specified categories to omit...
        (!options.omit ||
          // make sure we skip over those
          ((!options.omit.contains(entry.category) &&
          !(options.omit.contains("default") && entry.default)))))
      {
        // most functions "match" (with a regex)
        // but they can also just "read" (with a function)
        if(typeof entry.read !== 'function') {
          // are we on a token matching this entry's pattern?
          //trace('matching ' + entry.category + ' pattern');
          var matchedText = lexer.on(entry.match);
          if(matchedText) {
            trace('matched ' + entry.category + ' pattern');
            // advance the current position
            lexer.next_char(matchedText.length);
            // create and return the token object (including line/col info)
            token = lexer.create_token(matchedText, entry.category);
          }
        }
        else {
          // note we use a "read" function for our default entry
          // used when nothing else matches.  Such entries can
          // still set a token category, but they should set
          // "default: true" (so we know to consider them last).
          trace('invoking ' + entry.category + ' read function');
          token = entry.read(lexer);
          if(token) {
            trace('read from ' + entry.category + ' read function');
            token.category = entry.category;
          }
        }
      }

      if(entry.replace) {
        // remember that this category has been replaced
        replaced[entry.category] = true;
      }
    }
  }

  return token;
}

Lexer.prototype.peek_token = function() {

  debug('peeking what the next token will be');

  // skip leading whitespace or comments...
  this.skip_filler();

  // peek ahead but don't change the source position
  this.mark_rewind_point();
  this.peeking = true; // just to make debugging easier to follow
  var token = this.next_token();
  this.peeking = false;
  this.savePeekedToken(token);

  trace('rewinding so peek doesnt leave side effects');
  this.rewind();

  debug('peeked "' + token.text +
    '" (line: ' + token.line + ', col: ' + token.col + ')');
  return token;
}

/**
* Because of how we use our readtabs, we very often
* peek_token and follow immediately with next_token(text)
* where text was the token of the previously peeked token.
* So here we memoize the peeked token and let next_token
* use it (both the text as well as the category) when
* the conditions allow...
*/
Lexer.prototype.savePeekedToken = function(token) {
  if(token) {
    this.peekedToken = token;
  }
}

/**
* Do we have a memoized token from having peeked?
* @param expectedText = the expected text for such a token (optional)
* @return the previously peeked token if there is one, otherwise undefined
*/
Lexer.prototype.getPeekedToken = function(expectedText) {
  var token;

  // if we have a previously peeked token...
  if(this.peekedToken &&
    // and it was from the position we're currently sitting on
    this.position === (this.peekedToken.lineStartPosition + this.peekedToken.col) &&
    // and it matches the expected text (if any)
    (!expectedText || expectedText === this.peekedToken.text))
  {
      // yup skip over the token and return it
      debug('reusing peeked token ' + this.peekedToken.text +
        ' (line: ' + this.peekedToken.line + ', col: ' + this.peekedToken.col + ')');

      this.next_char(this.peekedToken.text.length);
      this.advance_to_next_token(); // plus trailing whitespace
      token = this.peekedToken;
  }

  // try and catch a potential bug -
  // it seems suspicious if the expected text matches
  // and yet the positions don't...
  if(this.peekedToken &&
    (expectedText && expectedText === this.peekedToken.text &&
      expectedText !== '(' && expectedText !== ')') &&
    this.position !== (this.peekedToken.lineStartPosition + this.peekedToken.col))
  {
      // yup skip over the token and return it
      debug('saved peeked token matches expected "' + expectedText +
        '" but the position is off - current position = ' + this.position +
        ', saved token position = ' +
        (this.peekedToken.lineStartPosition + this.peekedToken.col));
  }

  return token;
}

/**
* return the next "word" i.e. the chars up to some terminating char
* otherwise undefined is returned if end of source
*/
Lexer.prototype.next_word_token = function() {
  var text = "";
  var token;

  this.skip_filler();
  this.mark_token_start();

  if(!this.eos()) {
    // we always read at least *one* char
    // i.e. a terminating char *is* returned when it's in first position
    // (otherwise we'd stop advancing thru the text!)
    var firstChar = this.next_char();
    text += firstChar;

    while(!this.eos() && !this.onterminatingchar()) {
      text += this.next_char();
    }

    // If we started with a quote and we're sitting on a quote
    if(["'", '"', "`"].indexOf(firstChar) !== -1 &&
      this.peek_char() === firstChar)
    {
        // grab the ending quote too:
        text += this.next_char();
    }

    token = this.create_token(text);
  }

  return token;
}

Lexer.prototype.peek_word_token = function() {

  // peek ahead but don't change the source position
  this.mark_rewind_point();
  var token = this.next_word_token();
  this.rewind();
  return token;
}

/**
* scan and return some delimited text
* lexer.options.includeDelimiters = whether to include the include the
* delimiters or not (defaults to omitting the delimiters)
*/
Lexer.prototype.next_delimited_token = function(start, end, options) {
  options = options || this.options || {};
  var text = "";
  end = end || start; // sometimes it's the same delimiter on both ends

  // get the prelude before we skip the delimiter
  var prelude = this.get_current_prelude();

  // skip the initial delimiter
  if(start) {
    this.skip_char(start);
  }

  // we default to *excluding* the delimiters from the token
  if(options.includeDelimiters) {
    trace("including delimiter in token returned by next_delimited_token:", start)
    text += start;
  }

  // we take over from the lexer
  // because we're no longer tokenizing delimited "words" from source code
  // (as the lexer is designed to do)
  this.mark_token_start();

  // scan looking for the ending
  while(!this.eos() && !this.on(end)) {
    ch = this.next_char();
    if (ch === "\n") {
      ch = "\\n"; // escape returns
    } else if (ch === "\\") {
      text += ch; // escape the next character
      ch = this.next_char();
    }
    text += ch;
  }

  // we should be at the end of the delimited text now
  if(this.eos() || !this.on(end)) {
    this.error("Missing end \"" + end + "\" for " + (end === '"' ? "string" : "delimited text"), this);
  }

  // we default to *excluding* the delimiters from the token
  if(!this.eos() && options.includeDelimiters) {
     text += end;
  }

  // the token ends here
  var token = this.create_token(text);

  // override the prelude omitting the opening delimiter
  token.prelude = prelude;

  // now we can skip the end delimiter
  this.skip_char(end);
  this.advance_to_next_token();

  return token;
}

Lexer.prototype.peek_delimited_token = function(start, end) {

  // peek ahead but don't change the source position
  this.mark_rewind_point();
  var token = this.next_delimited_token(start, end);
  this.rewind();
  return token;
}

/**
* Skip some expected text at the current position and return
* the text that was skipped.
* expected = a length, a string, or a regex
*/
Lexer.prototype.skip_text = function(expected) {

  // skip the chars matching what they expected
  var text = this.skip_char(expected);

  // they explicitly skipped this text - so it doesn't
  // belong in the "prelude" (meaning whitespace or
  // comments we pass through to the output)
//  this.preludeStartPosition = this.position;

  // then skip to the next token
  this.skip_filler();

  return text;
}

/**
* Skip some expected text at the current position and return
* the token representing that text in the source file.
* expected = a length, a string, or a regex
*/
Lexer.prototype.skip_token = function(expected) {
  this.mark_token_start();
  var text = this.skip_text(expected);
  return this.create_token(text);
}

/**
* A little function for grabbing the front of the source stream
* (assumed mostly for debugging)
*/
Lexer.prototype.snoop = function(length) {
  return this.text.substring(this.position, this.position + length);
}

// note: avoiding """ for " in the below (changing to '"' in that case)
function formatTokenText(token) {
  return (token.text === '"' ? "'\"'" : token.text) + ' ';
}
// see e.g. https://en.wikipedia.org/wiki/Lexical_analysis#Tokenization
function formatTokenSexp(token) {
  return '(' + token.category + ' ' +
    (token.text === '"' ? "'\"'" : '"' + token.text + '" ' + token.line + ':' + token.col) + ') ';
}

/**
* format the token dump into a string
*
* note: we put all the tokens from a line on a line to make this easier
* to match up with the original source when debugging problems.
*
* @tokens = an array of tokens
* @formatter = a function which takes a token and returns a string.
* @resultPrefix = optional string to prepend to the result
* @resultSuffix = optional string to append to the result
* @returns the formatted string.
*/
function formatTokenDump(tokens, formatter, resultPrefix, resultSuffix) {
  var tokensSexpStr = "";
  var currentLine = -999;
  tokens.forEach(function(token, index) {
    // skip the wrapping () it's annoying in the dump
    if(!((index === 0 && token.text === "(") ||
        (index === tokens.length-1 && token.text === ")")))
    {
      // add a return if this starts a different line:
      if(currentLine !== -999 && token.line !== currentLine) {
        tokensSexpStr += '\n';
      }
      tokensSexpStr += formatter(token);
      currentLine = token.line;
    }
  });

  return (resultPrefix ? resultPrefix : "") +
          tokensSexpStr +
          (resultSuffix ? resultSuffix : "");
}

module.exports = {
  Lexer: Lexer,
  formatTokenDump: formatTokenDump,
  formatTokenText: formatTokenText,
  formatTokenSexp: formatTokenSexp
};
