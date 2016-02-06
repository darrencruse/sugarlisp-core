/**
* The lex table that drives the core lexer's creation of tokens.
*
* Each entry has a token category name, a "match", and a priority.
* NOTE I'M TRYING WITHOUT PRIORITY IT MIGHT GO AWAY
*
* The match is normally a regex, but can also be a string or a
* character predicate function (i.e. a function taking a character
* and returning true or false).  Or it can be an array of these,
* in which case the category is used if any in the array match.
*
* The priority is needed so that when dialects "extend" others they
* can precisely control how their symbols should be prioritized
* relative to that of the other dialect's symbols.
*
* Note whitespace and punctuation delimited words work pretty well
* (even in the "sugarscript" dialect), but where it doesn't, dialects
* can add additional rules for their special cases.
*
* Normally the rules of a dialects are merged with the rules of the
* dialects they extend, and sorted by priority (from high to low) so
* that higher priority rules will match before lower priority ones.
*
* If a dialect once to override (rather than add to) the symbols
* for a given category, they can include the optional property:
*
*   replace: true
*
* Though the lexer does not return tokens for whitespace or line
* comments, they are defined as token categories so a dialect can
* control what *it* considers whitespace or line comments.
*
* The final rule here has a priority of -1000, and it provides a
* "read" function that the other rules don't.  This is the function
* that will be called to read a token value by default (i.e. when no
* other rule matches).  If for some reason a dialect needed a
* different default, a similar rule could be provided in it's
* lex table (e.g. with priority -999 to override the one here).
*
* Lastly note quote characters are returned as standalone tokens
* rather than a "string" category for entire quoted strings.
* This is because when we read template strings with placeholders
* we process what's *inside* the quotes (i.e. strings are handled in
* the reader not here in the lexer).
*/

module.exports = [
  { category: 'float', match: /[-+]?\d+\.\d+/g },
  { category: 'integer', match: /[-+]?\d+/g },
  { category: 'whitespace', match: /[\s,]/ },
  { category: 'linecomment', match: /(\/\/|\;)/g },

  // "special" symbols that don't require whitespace or punctuation to end them.
  // e.g. "...rest" is tokenized "...", "rest"
  { category: 'symbol', match: /(\.\.\.)/g },

  // "punctuation" is special in that it terminates typical symbol tokens
  // (i.e. those read with "next_word_token")
  { category: 'punctuation', match: /(\(|\)|\'|\"|\`)/g },

  // default (when nothing else matches)
  // note lisp is beautifully simple - most symbol tokens are
  // simply "words" delimited by whitespace or "punctuation"
  {
    category: 'symbol',
    default: true,
    read: function(lexer) {
      return lexer.next_word_token();
    }
  }
];
