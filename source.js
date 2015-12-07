/**
* An instance of "Source" represents a stream of source code
* characters.
*
* It also provides the functions of a lexer to create tokens
* from the source code stream.
*
* There are really two levels of functions, one that works at
* the chararter level, the other at the "word" i.e. "token"
* level.
*
* In both cases you can "peek" ahead before truly consuming
* the chracter or token (if you need to).  You can also
* tentatively mark a "rewind point", scan ahead, and get
* back to where you were if something goes wrong (useful
* for looking ahead to resolve ambiguity then trying again
* with an alternative interpretation).
*/
var utils = require('./utils'),
    debug = require('debug')('sugarlisp:core:source:info'),
    trace = require('debug')('sugarlisp:core:source:trace');

/**
* The source text we are scanning
*
* note:  Source has been done as a javacript prototypal
*   class with instances that hold all state for a
*   given source file as it's being read and transpiled.
*   This is in contrast to the other sugarlisp modules
*   which are pretty much stateless collections of
*   functions.  The main exception to this is the
*   "transpiler-context" which is the non-source-file
*   related state of the transpiler (essentially a
*   "singleton").
*/
function Source(sourcetext, filename, reader, options) {
  this.text = sourcetext;
  this.filename = filename;
  this.fileext = utils.getFileExt(filename, "lispy");
  this.options = options || {};
  this.position = 0;
  this.lineStartPosition = 0;
  this.line = 0;
  if(options.wrapOuterForm !== 'no') {
    // the user doesn't see the wrapper lines we added!!
    this.line -= (options.wrapHeadHeight ? options.wrapHeadHeight : 2);
  }
  this.col = 0;
  this.preludeStartPosition = 0;
  this.tokenStartPosition = 0;
  this.tokenLineStartPosition = 0;
  this.tokenStartLine = 0;
  this.tokenStartCol = 0;
  this.lastToken = undefined;
  this.lastChar = undefined;
  this.rewindPoints = [];
  this.reader = reader;
  this.dialects = [];
  this.included = [];
  this.cells = [];
  this.bindingCode = {before: {}, after: {}};
  this.currentForm = undefined;
  this.lastReadList = undefined;
  this.lastReadFormInList = undefined;
  this.lastSyntaxEntry = undefined;
  this.lastSyntaxEntryPos = undefined;
  if(!this.options.whitespaceRE) {
    this.setWhitespaceRE(/[\s,]/);
  }
  if(!this.options.linecommentRE) {
    this.setLinecommentRE(/(\/\/|\;)/g);
  }
}

/**
* Fetch the next character from the source.
* Returns undefined at the end of the source text
* note:  all char fetches need to happen through this function
*        in order to keep the line and column numbers correct
*/
Source.prototype.next_char = function(len) {
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
Source.prototype.peek_char = function(lookahead) {
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
Source.prototype.skip_char = function(expected) {
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
    this.error("Source.skip passed something not an integer, string, or regex", this);
  }

  return this.next_char(len);  // skip this many characters
}

/**
* Mark the beginning of a token
*/
Source.prototype.mark_token_start = function() {
  trace("mark_token_start:  the next token will start at: " + this.position);
  this.tokenStartPosition = this.position;
  this.tokenLineStartPosition = this.lineStartPosition;
  this.tokenStartLine = this.line;
  this.tokenStartCol = this.col;
}

Source.prototype.get_current_prelude = function(consume) {
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
* Create and return a token (some text plus some metadata about where in the
* source that text was found).
*
* The token is the text between when mark_token_start was called and the
* current position, unless the "text" argument is passed (in which case
* that text will be used as the token text).
*/
Source.prototype.create_token = function(text) {

  var text = text || this.text.substring(this.tokenStartPosition, this.position);
  trace('creating token "' + text + '" prelude pos: ' + this.preludeStartPosition +
            ' start pos: ' + this.tokenStartPosition +
            " end pos: " + this.position);

  function maketoken(text, source, line, col, lineStartPosition, preludeText) {
    return {
      text: text,
      value: text,
      source: source,
      line: line,
      col: col,
      lineStartPosition: lineStartPosition,
      prelude: preludeText,
      __istoken: true
    };
  }

  var token = maketoken(text, this,
                    this.tokenStartLine, this.tokenStartCol,
                    this.tokenLineStartPosition,
                    this.get_current_prelude());

  // prep for the next token in line
  // (e.g. skip trailing whitespace and/or comments)
  this.advance_to_next_token();

  // remember the last created_token for doing "look back"
  this.lastToken = token;

  if(!this.peekingToken) {
    debug("creating token:", token.text);
    if(token.prelude) {
      debug("with prelude:", token.prelude);
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
Source.prototype.advance_to_next_token = function() {
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
Source.prototype.mark_rewind_point = function() {

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
    lastChar: this.lastChar,
    currentForm: this.currentForm,
    lastReadList: this.lastReadList,
    lastReadFormInList: this.lastReadFormInList,
    lastSyntaxEntry: this.lastSyntaxEntry,
    lastSyntaxEntryPos: this.lastSyntaxEntryPos
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
Source.prototype.commit_rewind_point = function() {
  this.rewindPoints.pop();
}

/**
* Move the current position back to where it was on the last
* call to mark_rewind_point
*
* Note: think of this as analogous to rolling back a transaction
*/
Source.prototype.rewind = function() {
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
  this.currentForm = marker.currentForm;
  this.lastReadList = marker.lastReadList;
  this.lastReadFormInList = marker.lastReadFormInList;
  this.lastSyntaxEntry = marker.lastSyntaxEntry;
  this.lastSyntaxEntryPos = marker.lastSyntaxEntryPos;
  trace('rewound to line:', this.line, 'col:', this.col);
  trace("prelude pos is back to:", this.preludeStartPosition);
}

// Are we at the "end of source"?
Source.prototype.eos = function(lookahead) {
  lookahead = lookahead || 0;
  return ((this.position + lookahead) >= this.text.length);
}


/**
* is the source currently sitting on something expected?
* "expected" can be a string, regex, or character predicate function
* returned is the matched text if a match was found
* otherwise falsey is returned
*
* Due to limitations in how regexes work when matching
* into the middle of the text stream, you must use a global
* match by ending your regex "/g", and you should *not*
* start your regex with "^".
*
* matchPartial can be passed to allow matching part of a
* token (otherwise we require the match end at a reasonable
* token boundary)
*/
Source.prototype.on = function(expected, matchPartial) {

  if(this.eos()) {
    return false;
  }

  var matched = false;

  if(expected instanceof RegExp) {
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
    this.error("Unexpected type passed for 'expected' in source.on: " + expected, this);
    matched = false;
  }

  if(matched && !matchPartial) {
    // we matched, but are we on a token boundary?
    if(!this.onterminatingchar(matched.length-1) &&
         (!this.eos(matched.length) && !this.onterminatingchar(matched.length))) {
      matched = false;  // this had matched the start of some text with no terminator
    }

  }
  return matched;
}

// assert what the next token should be, otherwise throws
Source.prototype.assert = function(expected, error) {

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
Source.prototype.skip_text_till = function(end, includeEnd) {
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
* scan a token from the current position till the specified end
* returned is a token for the text that was scanned
* end = string or regex (see the "on" function for details)
* includeEnd = whether to include "end" in the returned token
* note if you "includeEnd" you also "skip" the end.
*/
Source.prototype.till = function(end, includeEnd) {
  return this.create_token(this.skip_text_till(end, includeEnd));
}

/**
* is the source currently sitting on white space?
* note: we treat commas same as whitespace
*/
Source.prototype.onwhitespace = function(lookahead) {

  return this.options.whitespaceRE.test(this.peek_char(lookahead));
}

/**
* skip whitespace at the current position (if any)
*/
Source.prototype.skip_whitespace = function() {
  while(!this.eos() && this.onwhitespace()) {
    this.next_char();
  }
}

/**
* scan whitespace and return it as a token
*/
Source.prototype.whitespace = function() {
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
Source.prototype.skip_comment = function() {
  if(!this.eos()) {
    if(this.on(this.options.linecommentRE, true)) {
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
Source.prototype.skip_filler = function() {
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
* "terminating chars" meaning a char that should terminate a token
* e.g. white space, (, ), [, ], etc.
*/
Source.prototype.onterminatingchar = function(lookahead) {
  var terminating = false;
  var nextChar = this.peek_char(lookahead);

  var nonterm = this.dialects.find(function(dialect) {
      return(dialect.__nonterminatingchars.indexOf(nextChar) !== -1);
    });
  if(!nonterm) {
    terminating = this.onwhitespace(lookahead) ||
      this.dialects.find(function(dialect) {
        return(dialect.__terminatingchars.indexOf(nextChar) !== -1);
      });
  }

  return terminating;
}

/**
* Throw an error message and show it's location in the source file.
* locator = a form or token object (i.e. something with "line" and "col")
*/
Source.prototype.error = function(msg, locator) {
  throw new Error(this.message_src_loc(msg,locator));
}

/**
* Display a message and show it's location in the source file.
* locator = a form or token object (i.e. something with "line" and "col")
*/
Source.prototype.message_src_loc = function(msg, locator, options) {
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
Source.prototype.line_with_caret = function(lineStartPosition, column) {

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

// read the next token (and optionally specify a string or regex matching
// what you expect the token to be)
Source.prototype.next_token = function(expected, options) {
  var token;
  var error;
  var matchPartial;

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

  if(expected instanceof RegExp || typeof expected === 'string') {
    var matched = this.on(expected, matchPartial);
    if(matched) {
      // we know exactly what to read:
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
    // they gave nothing to expect - the syntax table is our guide
    // to what the next token should be
    token = get_next_syntaxtable_token(this);
  }

  return token;
}

Source.prototype.peek_token = function() {

  // skip leading whitespace or comments...
  this.skip_filler();

  // peek ahead but don't change the source position
  this.mark_rewind_point();
  this.peekingToken = true;
  var token = get_next_syntaxtable_token(this);
  this.peekingToken = false;
  this.rewind();
  return token;
}

function get_next_syntaxtable_token(source) {

  // skip leading whitespace or comments...
  source.skip_filler();

  var entry = source.reader.get_syntaxtable_entry(source);
  source.next_char(entry.match.length);  // advance the current position
  return source.create_token(entry.match);
}

/**
* scan and return the chars up till a stop char
* otherwise undefined is returned if end of source
* (this is a low level read of the next delimited "word" meaning a
* token which is not listed in the readmap but
* is delimited naturally e.g. with whitespace)
*/
Source.prototype.next_word_token = function() {
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

Source.prototype.peek_word_token = function() {

  // peek ahead but don't change the source position
  this.mark_rewind_point();
  var token = this.next_word_token();
  this.rewind();
  return token;
}

/**
* scan and return some delimited text
* source.options.omitDelimiters = whether to include the include the delimiters or not
*/
Source.prototype.next_delimited_token = function(start, end, options) {
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

Source.prototype.peek_delimited_token = function(start, end) {

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
Source.prototype.skip_text = function(expected) {

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
Source.prototype.skip_token = function(expected) {
  this.mark_token_start();
  var text = this.skip_text(expected);
  return this.create_token(text);
}

/**
* setWhitespaceRE can be called to change what's considered
* whitespace (after the source has been created).
*
* This is used e.g. if a .sl (as opposed to .scripty) file has a
* #use "scripty" so the source is initially lispy core (where white
* space includes commas /[\s,]/) and then changes to scripty (where
* whitespace omits command but includes semicolons so /[\s;]/).
*
* note: whitespaceRE must *not* use the /g global flag.
*/
Source.prototype.setWhitespaceRE = function(whitespaceRE) {
  this.options.whitespaceRE = whitespaceRE;
}

/**
* setLineCommentRE can be called to change what's considered
* the start of a line comment.
*
* This is used e.g. if a .sl (as opposed to .scripty) file has a
* #use "scripty" so the source is initially lispy core (where line
* comments are both javascript and lisp style /(\/\/|\;)/ and then
* changes to scripty (where line comments are only javascript style
* so just /\/\//).
*
* note: linecommentRE *must* use the /g global flag.
*/
Source.prototype.setLinecommentRE = function(linecommentRE) {
  this.options.linecommentRE = linecommentRE;
}

/**
* semiColonComments can be called to change if semicolons are treated
* as comments or whitespace (after the source has been created).
*
* This is used e.g. if a .sl (as opposed to .scripty) file has a
* "#use dialect-x" so the source is initially lispy core (where semis
* are comments) and then changes to dialect-x (where they are whitespace).
*/
/*
DELETE
Source.prototype.semiColonComments = function(trueOrFalse) {

  this.options.semiColonComments = trueOrFalse;

  // if semicolons aren't comments we treat them as if whitespace:
  this.whitespaceRE = this.options.semiColonComments ? /[\s,]/ : /[\s,;]/;
}
*/

/**
* A little function for grabbing the front of the source stream
* (assumed mostly for debugging)
*/
Source.prototype.snoop = function(length) {
  return this.text.substring(this.position, this.position + length);
}

/**
* Read functions call local_dialect when starting to read a form that
* has it's own syntax or keywords.
*
* They can pass the "dialect" argument if they've already got the preloaded
* dialect or omit "dialect" if they wish it to be loaded as a module using
* the supplied dialect name.
*
* note:  dialects are stored on the forms and the closest lexically
*   scoped dialect is found by walking up the form tree.  Calling
*   this function ensures that calls to the reader use the new
*   dialect's syntax table, even though the form is not yet added
*   in the form tree.
*/
Source.prototype.local_dialect = function(dialectName, dialectRootForm, dialect) {

  dialectRootForm.dialect = this.reader.use_dialect(dialectName, this, {
                                    filelevel: false,
                                    preloaded: dialect
                                  });
  this.currentForm = dialectRootForm;
}

/**
* Do some cleanup upon finishing reading to ensure there's
* no lingering effect (e.g. there was a case where the
* currentForm was read by the keyword transpilation when
* it shouldn't have been)
*/
Source.prototype.reading_completed = function() {
  this.currentForm = undefined;
  this.lastReadList = undefined;
  this.lastReadFormInList = undefined;
  this.lastSyntaxEntry = undefined;
  this.lastSyntaxEntryPos = undefined;
}

module.exports = {
  Source: Source
};
